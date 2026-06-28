import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { drawMine, focusPlayer, readTableLife, readTableZoneCounts } from './support/game-table';

const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

test.describe('false action toast runtime gate', () => {
  test('successful runtime actions do not surface the failure toast', async ({ browser, request, baseURL }) => {
    test.setTimeout(180_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }
    await assertGameRuntimeReady(request);

    const setup = await createCommanderGameWithBasicDecks(request, {
      runId: `toast${Date.now().toString(36)}`,
      playerAPrefix: 'toast-a',
      playerBPrefix: 'toast-b',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);

    const context = await browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, setup.playerA.user, setup.playerA.refreshToken),
    });
    await enableFrontendGameplayV2(context);

    try {
      const page = await context.newPage();
      const frames = collectWebSocketFrames(page);
      await page.goto(`/games/${setup.gameId}`);
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(frames);
      await focusPlayer(page, setup.playerA.user.displayName);
      await startTableErrorObserver(page);

      const initialCounts = await readTableZoneCounts(page, setup.playerA.user.displayName);
      await drawMine(page);
      await expect.poll(async () => readTableZoneCounts(page, setup.playerA.user.displayName), { timeout: 20_000 }).toEqual({
        hand: initialCounts.hand + 1,
        library: initialCounts.library - 1,
      });
      await expectNoObservedTableErrors(page);

      const lifeBefore = await readTableLife(page, setup.playerA.user.displayName);
      await playerSummary(page, setup.playerA.user.displayName).getByTestId('life-decrease').click();
      await expect.poll(async () => readTableLife(page, setup.playerA.user.displayName), { timeout: 20_000 }).toBe(lifeBefore - 1);
      await expectNoObservedTableErrors(page);

      await playerSummary(page, setup.playerA.user.displayName).getByTestId('life-increase').click();
      await expect.poll(async () => readTableLife(page, setup.playerA.user.displayName), { timeout: 20_000 }).toBe(lifeBefore);
      await expectNoObservedTableErrors(page);

      expect(frames.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(frames.some((message) => message['kind'] === 'resync_required')).toBe(false);
    } finally {
      await context.close();
    }
  });
});

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`Game runtime is not reachable at ${RUNTIME_READY_URL}; runtime gates must not fall back to legacy.`);
  }
}

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

function collectWebSocketFrames(page: Page): Array<Record<string, unknown>> {
  const frames: Array<Record<string, unknown>> = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) {
        frames.push(parsed);
      }
    });
  });
  return frames;
}

async function waitForGameplayConnection(frames: Array<Record<string, unknown>>): Promise<void> {
  await expect.poll(() => frames.some((message) =>
    message['kind'] === 'connection_state' && message['status'] === 'connected',
  ), { timeout: 20_000 }).toBe(true);
}

function parseFrame(payload: string | Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(typeof payload === 'string' ? payload : payload.toString());
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function startTableErrorObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as typeof window & { __czTableErrors?: string[]; __czTableErrorObserver?: MutationObserver };
    win.__czTableErrors = [];
    win.__czTableErrorObserver?.disconnect();
    const capture = () => {
      for (const element of Array.from(document.querySelectorAll('.table-error'))) {
        const text = element.textContent?.trim();
        if (text) {
          win.__czTableErrors?.push(text);
        }
      }
    };
    capture();
    win.__czTableErrorObserver = new MutationObserver(capture);
    win.__czTableErrorObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}

async function expectNoObservedTableErrors(page: Page): Promise<void> {
  const errors = await page.evaluate(() => ((window as typeof window & { __czTableErrors?: string[] }).__czTableErrors ?? []));
  expect(errors).toEqual([]);
  await expect(page.locator('.table-error')).toHaveCount(0);
}

function playerSummary(page: Page, displayName: string): Locator {
  return page.getByTestId('player-summary-panel').filter({
    has: page.getByTestId('focused-player-name').filter({ hasText: displayName }),
  }).first();
}
