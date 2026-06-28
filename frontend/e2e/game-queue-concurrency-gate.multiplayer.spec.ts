import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { focusPlayer, readTableLife } from './support/game-table';

test.setTimeout(360_000);
const POLL_TIMEOUT = 60_000;
const LIFE_BURST = 50;

test('multiplayer queue concurrency gate converges and exposes queue telemetry in debug', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithBasicDecks(request, {
    runId: `queue-gate-${Date.now()}`,
  });
  const { gameId, playerA, playerB } = setup;
  await resolveGameToPlaying(request, gameId, [playerA, playerB]);

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken),
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([
      pageA.goto(`/games/${gameId}`),
      pageB.goto(`/games/${gameId}`),
    ]);

    await Promise.all([
      expect(pageA.getByTestId('game-screen')).toBeVisible(),
      expect(pageB.getByTestId('game-screen')).toBeVisible(),
    ]);
    await startQueueMetricsObserver(pageA, gameId);

    await emulateSlowNetwork(contextA, pageA, { latency: 150, downloadKbps: 1_600, uploadKbps: 750 });
    await emulateSlowNetwork(contextB, pageB, { latency: 400, downloadKbps: 750, uploadKbps: 250 });

    await focusPlayer(pageA, playerA.user.displayName);
    await focusPlayer(pageB, playerB.user.displayName);

    await Promise.all([
      burstLifeClicks(pageA, LIFE_BURST),
      burstLifeClicks(pageB, LIFE_BURST),
    ]);

    await expect.poll(async () => readTableLife(pageA, playerA.user.displayName), { timeout: POLL_TIMEOUT }).toBe(40 - LIFE_BURST);
    await expect.poll(async () => readTableLife(pageB, playerA.user.displayName), { timeout: POLL_TIMEOUT }).toBe(40 - LIFE_BURST);
    await expect.poll(async () => readTableLife(pageB, playerB.user.displayName), { timeout: POLL_TIMEOUT }).toBe(40 - LIFE_BURST);
    await expect.poll(async () => readTableLife(pageA, playerB.user.displayName), { timeout: POLL_TIMEOUT }).toBe(40 - LIFE_BURST);

    await expect.poll(async () => debugQueueCounter(pageA, 0), { timeout: POLL_TIMEOUT }).toBeGreaterThan(20);
    await expect.poll(async () => debugQueueCounter(pageA, 1), { timeout: POLL_TIMEOUT }).toBeGreaterThan(20);

    const droppedCommandTypes = await droppedCommandTypesFromDebug(pageA);
    const allowedDropped = new Set(['life.changed', 'counter.changed', 'card.position.changed', 'cards.position.changed', 'commander.damage.changed']);
    expect(droppedCommandTypes.every((commandType) => allowedDropped.has(commandType))).toBe(true);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function burstLifeClicks(page: Page, count: number): Promise<void> {
  const lifeButton = page.getByRole('button', { name: /^Remove 1 life from / });
  for (let index = 0; index < count; index += 1) {
    await lifeButton.click();
  }
}

async function startQueueMetricsObserver(page: Page, gameId: string): Promise<void> {
  await page.evaluate((observedGameId) => {
    const state = window as unknown as {
      __commanderZoneQueueMetrics?: Array<Record<string, unknown>>;
      __commanderZoneDeadLetters?: Array<Record<string, unknown>>;
      __commanderZoneQueueChannel?: BroadcastChannel;
      __commanderZoneQueueTimer?: number;
    };
    state.__commanderZoneQueueMetrics = [];
    state.__commanderZoneDeadLetters = [];
    state.__commanderZoneQueueChannel?.close();
    if (state.__commanderZoneQueueTimer !== undefined) {
      window.clearInterval(state.__commanderZoneQueueTimer);
    }

    const channel = new BroadcastChannel('commanderzone.game-debug.snapshot-metrics');
    state.__commanderZoneQueueChannel = channel;
    channel.onmessage = (event) => {
      const message = event.data as Record<string, unknown>;
      if (message['gameId'] !== observedGameId) {
        return;
      }
      if (message['kind'] === 'queue_metrics') {
        state.__commanderZoneQueueMetrics?.push(message);
      }
      if (message['kind'] === 'dead_letter_event') {
        state.__commanderZoneDeadLetters?.push(message);
      }
    };
    const observe = () => channel.postMessage({
      kind: 'debug_observe',
      gameId: observedGameId,
      observedAt: new Date().toISOString(),
    });
    observe();
    state.__commanderZoneQueueTimer = window.setInterval(observe, 2_000);
  }, gameId);
}

async function debugQueueCounter(page: Page, valueIndex: 0 | 1): Promise<number> {
  return page.evaluate((index) => {
    const state = window as unknown as { __commanderZoneQueueMetrics?: Array<Record<string, unknown>> };
    const latest = state.__commanderZoneQueueMetrics?.at(-1);
    const value = index === 0 ? latest?.['enqueueTotal'] : latest?.['drainTotal'];

    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }, valueIndex);
}

async function droppedCommandTypesFromDebug(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const state = window as unknown as { __commanderZoneDeadLetters?: Array<Record<string, unknown>> };

    return (state.__commanderZoneDeadLetters ?? [])
      .filter((item) => item['reason'] === 'queue_dropped')
      .map((item) => typeof item['commandType'] === 'string' ? item['commandType'] : '')
      .filter((item) => item !== '');
  });
}

async function emulateSlowNetwork(
  context: BrowserContext,
  page: Page,
  profile: { latency: number; downloadKbps: number; uploadKbps: number },
): Promise<void> {
  try {
    const session = await context.newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: profile.latency,
      downloadThroughput: profile.downloadKbps * 1024 / 8,
      uploadThroughput: profile.uploadKbps * 1024 / 8,
      connectionType: 'cellular4g',
    });
  } catch {
    // Browser engines without CDP can still run the gate without network emulation.
  }
}
