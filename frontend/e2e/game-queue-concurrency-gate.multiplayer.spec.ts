import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';
import { drawMine, focusPlayer, readTableLife, readTableZoneCounts } from './support/game-table';

test.setTimeout(360_000);
const POLL_TIMEOUT = 60_000;
const LIFE_BURST = 50;
const TAP_BURST = 20;
const MOVE_BURST = 5;

test('multiplayer queue concurrency gate converges and exposes queue telemetry in debug', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    runId: `queue-gate-${Date.now()}`,
    deckSize: 100,
  });
  const { gameId, playerA, playerB } = setup;

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
    const debugPage = await contextA.newPage();

    await Promise.all([
      pageA.goto(`/games/${gameId}`),
      pageB.goto(`/games/${gameId}`),
      debugPage.goto(`/games/${gameId}/debug`),
    ]);

    await Promise.all([
      expect(pageA.getByTestId('game-screen')).toBeVisible(),
      expect(pageB.getByTestId('game-screen')).toBeVisible(),
      expect(debugPage.locator('main.debug-page')).toBeVisible(),
    ]);

    await emulateSlowNetwork(contextA, pageA, { latency: 150, downloadKbps: 1_600, uploadKbps: 750 });
    await emulateSlowNetwork(contextB, pageB, { latency: 400, downloadKbps: 750, uploadKbps: 250 });

    await focusPlayer(pageA, playerA.user.displayName);
    await focusPlayer(pageB, playerB.user.displayName);

    await Promise.all([
      drawMultiple(pageA, MOVE_BURST),
      drawMultiple(pageB, MOVE_BURST),
    ]);

    const movedByA = await moveCardsToBattlefield(pageA, playerA.user.id, MOVE_BURST);
    const movedByB = await moveCardsToBattlefield(pageB, playerB.user.id, MOVE_BURST);

    await Promise.all([
      expect.poll(async () => readTableZoneCounts(pageA, playerA.user.displayName), { timeout: POLL_TIMEOUT }).toEqual({
        hand: 0,
        library: 94,
      }),
      expect.poll(async () => readTableZoneCounts(pageB, playerB.user.displayName), { timeout: POLL_TIMEOUT }).toEqual({
        hand: 0,
        library: 94,
      }),
    ]);

    const tapTargetA = movedByA[0];
    const tapTargetB = movedByB[0];
    if (!tapTargetA || !tapTargetB) {
      throw new Error('Missing moved battlefield cards for tap burst.');
    }

    await Promise.all([
      burstLifeClicks(pageA, LIFE_BURST),
      burstLifeClicks(pageB, LIFE_BURST),
      burstTapCard(pageA, playerA.user.id, tapTargetA, TAP_BURST),
      burstTapCard(pageB, playerB.user.id, tapTargetB, TAP_BURST),
    ]);

    await expect.poll(async () => readTableLife(pageA, playerA.user.displayName), { timeout: POLL_TIMEOUT }).toBe(40 - LIFE_BURST);
    await expect.poll(async () => readTableLife(pageB, playerA.user.displayName), { timeout: POLL_TIMEOUT }).toBe(40 - LIFE_BURST);
    await expect.poll(async () => readTableLife(pageB, playerB.user.displayName), { timeout: POLL_TIMEOUT }).toBe(40 - LIFE_BURST);
    await expect.poll(async () => readTableLife(pageA, playerB.user.displayName), { timeout: POLL_TIMEOUT }).toBe(40 - LIFE_BURST);

    await focusPlayer(pageA, playerA.user.displayName);
    await focusPlayer(pageB, playerA.user.displayName);
    await expect.poll(async () => isCardTapped(pageA, playerA.user.id, tapTargetA), { timeout: POLL_TIMEOUT }).toBe(false);
    await expect.poll(async () => isCardTapped(pageB, playerA.user.id, tapTargetA), { timeout: POLL_TIMEOUT }).toBe(false);

    await focusPlayer(pageA, playerB.user.displayName);
    await focusPlayer(pageB, playerB.user.displayName);
    await expect.poll(async () => isCardTapped(pageA, playerB.user.id, tapTargetB), { timeout: POLL_TIMEOUT }).toBe(false);
    await expect.poll(async () => isCardTapped(pageB, playerB.user.id, tapTargetB), { timeout: POLL_TIMEOUT }).toBe(false);

    await focusPlayer(pageA, playerA.user.displayName);
    await focusPlayer(pageB, playerA.user.displayName);
    const battlefieldAOnA = await battlefieldInstanceIds(pageA, playerA.user.id);
    const battlefieldAOnB = await battlefieldInstanceIds(pageB, playerA.user.id);
    expect(new Set(battlefieldAOnA).size).toBe(battlefieldAOnA.length);
    expect(new Set(battlefieldAOnB).size).toBe(battlefieldAOnB.length);
    expect(movedByA.every((instanceId) => battlefieldAOnA.includes(instanceId))).toBe(true);
    expect(movedByA.every((instanceId) => battlefieldAOnB.includes(instanceId))).toBe(true);

    await focusPlayer(pageA, playerB.user.displayName);
    await focusPlayer(pageB, playerB.user.displayName);
    const battlefieldBOnA = await battlefieldInstanceIds(pageA, playerB.user.id);
    const battlefieldBOnB = await battlefieldInstanceIds(pageB, playerB.user.id);
    expect(new Set(battlefieldBOnA).size).toBe(battlefieldBOnA.length);
    expect(new Set(battlefieldBOnB).size).toBe(battlefieldBOnB.length);
    expect(movedByB.every((instanceId) => battlefieldBOnA.includes(instanceId))).toBe(true);
    expect(movedByB.every((instanceId) => battlefieldBOnB.includes(instanceId))).toBe(true);

    await expect.poll(async () => debugQueueCounter(debugPage, 'Enqueue/Drain', 0), { timeout: POLL_TIMEOUT }).toBeGreaterThan(20);
    await expect.poll(async () => debugQueueCounter(debugPage, 'Enqueue/Drain', 1), { timeout: POLL_TIMEOUT }).toBeGreaterThan(20);

    const droppedCommandTypes = await droppedCommandTypesFromDebug(debugPage);
    const allowedDropped = new Set(['life.changed', 'counter.changed', 'card.position.changed', 'cards.position.changed', 'commander.damage.changed']);
    expect(droppedCommandTypes.every((commandType) => allowedDropped.has(commandType))).toBe(true);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function drawMultiple(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await drawMine(page);
  }
}

async function moveCardsToBattlefield(page: Page, playerId: string, count: number): Promise<string[]> {
  const moved: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const handCard = page
      .locator(`[data-testid="hand-zone"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="hand"]`)
      .nth(0);
    await expect(handCard).toBeVisible({ timeout: 10_000 });
    const instanceId = await handCard.getAttribute('data-card-instance-id');
    if (!instanceId) {
      throw new Error(`Missing hand card instance id for ${playerId}.`);
    }

    await handCard.dblclick({ timeout: 10_000 });
    await expect.poll(async () =>
      page.locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"] [data-card-instance-id="${instanceId}"]`).count(),
    ).toBe(1);
    moved.push(instanceId);
  }

  return moved;
}

async function burstLifeClicks(page: Page, count: number): Promise<void> {
  const lifeValue = page.locator('.focused-board [data-testid="life-value"]');
  for (let index = 0; index < count; index += 1) {
    await lifeValue.click({ button: 'right' });
  }
}

async function burstTapCard(page: Page, playerId: string, instanceId: string, count: number): Promise<void> {
  const card = page.locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"] [data-card-instance-id="${instanceId}"]`);
  await expect(card).toBeVisible({ timeout: 10_000 });
  for (let index = 0; index < count; index += 1) {
    await card.dblclick({ timeout: 10_000 });
  }
}

async function isCardTapped(page: Page, playerId: string, instanceId: string): Promise<boolean> {
  const classes = (await page
    .locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"] [data-card-instance-id="${instanceId}"]`)
    .first()
    .getAttribute('class')) ?? '';
  return classes.includes('tapped');
}

async function battlefieldInstanceIds(page: Page, playerId: string): Promise<string[]> {
  const cards = page.locator(
    `[data-testid="battlefield-zone"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="battlefield"]`,
  );
  const count = await cards.count();
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = await cards.nth(index).getAttribute('data-card-instance-id');
    if (value) {
      ids.push(value);
    }
  }
  return ids;
}

async function debugQueueCounter(debugPage: Page, cardLabel: string, valueIndex: 0 | 1): Promise<number> {
  const section = debugPage.locator('section').filter({ hasText: 'Cola gameplay local' });
  const article = section.locator('article').filter({ hasText: cardLabel }).first();
  const raw = ((await article.locator('strong').textContent()) ?? '').trim();
  const values = raw.split('/').map((value) => Number.parseInt(value.trim(), 10));
  const parsed = values[valueIndex];
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

async function droppedCommandTypesFromDebug(debugPage: Page): Promise<string[]> {
  const rows = debugPage
    .locator('section')
    .filter({ hasText: 'Dead-letter local' })
    .locator('tbody tr')
    .filter({ hasText: 'queue_dropped' });
  const count = await rows.count();
  const commandTypes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const commandType = ((await rows.nth(index).locator('td').nth(1).textContent()) ?? '').trim();
    if (commandType !== '') {
      commandTypes.push(commandType);
    }
  }

  return commandTypes;
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
