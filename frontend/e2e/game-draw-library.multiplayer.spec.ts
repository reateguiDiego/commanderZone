import { expect, test, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';

test.setTimeout(240000);

test('drawing from library updates library and hand for both players in real time', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    runId: `draw-library-${Date.now()}`,
    deckSize: 100,
  });

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerA.token, setup.playerA.user),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerB.token, setup.playerB.user),
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([
      pageA.goto(`/games/${setup.gameId}`),
      pageB.goto(`/games/${setup.gameId}`),
    ]);

    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();

    const initialA = await readSidebarZoneCounts(pageA, setup.playerA.user.displayName);
    await pageA.getByRole('button', { name: 'Draw mine' }).click();

    await expect.poll(async () => readSidebarZoneCounts(pageA, setup.playerA.user.displayName)).toEqual({
      hand: initialA.hand + 1,
      library: initialA.library - 1,
    });
    await expect.poll(async () => readSidebarZoneCounts(pageB, setup.playerA.user.displayName)).toEqual({
      hand: initialA.hand + 1,
      library: initialA.library - 1,
    });

    await focusPlayer(pageA, setup.playerA.user.displayName);

    const visibleHandCardsForA = await pageA
      .locator(`[data-testid="hand-zone"][data-player-id="${setup.playerA.user.id}"] [data-testid="game-card"][data-zone="hand"]`)
      .count();
    expect(visibleHandCardsForA).toBe(initialA.hand + 1);
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

async function readSidebarZoneCounts(page: Page, displayName: string): Promise<{ hand: number; library: number }> {
  const thumb = page.locator('.player-sidebar .player-thumb').filter({
    has: page.locator('strong', { hasText: displayName }),
  });
  const text = await thumb.locator('small').innerText();
  const match = /(\d+)\s+hand\s+·\s+(\d+)\s+library/.exec(text.trim());
  if (!match) {
    throw new Error(`Could not parse sidebar zone counts for ${displayName}: "${text}"`);
  }

  return {
    hand: Number.parseInt(match[1] ?? '', 10),
    library: Number.parseInt(match[2] ?? '', 10),
  };
}

