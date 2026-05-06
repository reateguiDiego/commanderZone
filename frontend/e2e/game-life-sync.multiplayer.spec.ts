import { expect, test } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';
import { focusPlayer, readTableLife as readSidebarLife } from './support/game-table';

test.setTimeout(120000);
const POLL_TIMEOUT = 15_000;

test('life changes are synchronized between two isolated player sessions', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    playerAPrefix: 'life-a',
    playerBPrefix: 'life-b',
  });
  const { gameId, playerA, playerB } = setup;

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerA.token, playerA.user),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerB.token, playerB.user),
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([
      pageA.goto(`/games/${gameId}`),
      pageB.goto(`/games/${gameId}`),
    ]);

    await expect(pageA.locator('.game-screen')).toBeVisible();
    await expect(pageB.locator('.game-screen')).toBeVisible();

    await focusPlayer(pageA, playerA.user.displayName);
    await pageA.locator('.focused-board [data-testid="life-value"]').click({ button: 'right' });

    await expect.poll(async () => readSidebarLife(pageA, playerA.user.displayName), { timeout: POLL_TIMEOUT }).toBe(39);
    await expect.poll(async () => readSidebarLife(pageB, playerA.user.displayName), { timeout: POLL_TIMEOUT }).toBe(39);

    await focusPlayer(pageB, playerB.user.displayName);
    await pageB.locator('.focused-board [data-testid="life-value"]').click({ button: 'right' });
    await expect.poll(async () => readSidebarLife(pageB, playerB.user.displayName), { timeout: POLL_TIMEOUT }).toBe(39);
    await pageB.locator('.focused-board [data-testid="life-value"]').click({ button: 'right' });

    await expect.poll(async () => readSidebarLife(pageB, playerB.user.displayName), { timeout: POLL_TIMEOUT }).toBe(38);
    await expect.poll(async () => readSidebarLife(pageA, playerB.user.displayName), { timeout: POLL_TIMEOUT }).toBe(38);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
