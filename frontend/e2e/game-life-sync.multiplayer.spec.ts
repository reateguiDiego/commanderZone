import { expect, test, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';

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
    await pageA.locator('.focused-board .life-pill button').first().click();

    await expect.poll(async () => readSidebarLife(pageA, playerA.user.displayName)).toBe(39);
    await expect.poll(async () => readSidebarLife(pageB, playerA.user.displayName)).toBe(39);

    await focusPlayer(pageB, playerB.user.displayName);
    await pageB.locator('.focused-board .life-pill button').first().click();
    await expect.poll(async () => readSidebarLife(pageB, playerB.user.displayName)).toBe(39);
    await pageB.locator('.focused-board .life-pill button').first().click();

    await expect.poll(async () => readSidebarLife(pageB, playerB.user.displayName)).toBe(38);
    await expect.poll(async () => readSidebarLife(pageA, playerB.user.displayName)).toBe(38);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function focusPlayer(page: Page, displayName: string): Promise<void> {
  const thumb = page.locator('.player-sidebar .player-thumb').filter({
    has: page.locator('strong', { hasText: displayName }),
  });
  await expect(thumb).toBeVisible();
  await thumb.click();
  await expect(page.locator('.focused-board h1')).toHaveText(displayName);
}

async function readSidebarLife(page: Page, displayName: string): Promise<number> {
  const thumb = page.locator('.player-sidebar .player-thumb').filter({
    has: page.locator('strong', { hasText: displayName }),
  });
  const raw = await thumb.locator('.player-thumb-header span').first().innerText();
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Could not parse life total "${raw}" for ${displayName}`);
  }

  return value;
}
