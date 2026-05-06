import { expect, test, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';
import { expectFocusedPlayer, expectOpponentVisible, focusPlayer } from './support/game-table';

test.setTimeout(120000);

test('game starts with two full decks and both players can see required zones', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    runId: `full-decks-${Date.now()}`,
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

    await expectFocusedPlayer(pageA, setup.playerA.user.displayName);
    await expectOpponentVisible(pageA, setup.playerB.user.displayName);
    await expectFocusedPlayer(pageB, setup.playerB.user.displayName);
    await expectOpponentVisible(pageB, setup.playerA.user.displayName);

    await focusPlayer(pageA, setup.playerA.user.displayName);
    await focusPlayer(pageB, setup.playerB.user.displayName);

    await assertRequiredZones(pageA, setup.playerA.user.id);
    await assertRequiredZones(pageB, setup.playerB.user.id);

    await assertDeckCountersAreCoherent(pageA, setup.playerA.user.id);
    await assertDeckCountersAreCoherent(pageB, setup.playerB.user.id);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function assertRequiredZones(page: Page, playerId: string): Promise<void> {
  await expect(page.locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="hand-zone"][data-player-id="${playerId}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="zone"][data-player-id="${playerId}"][data-zone="library"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="zone"][data-player-id="${playerId}"][data-zone="graveyard"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="zone"][data-player-id="${playerId}"][data-zone="exile"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="zone"][data-player-id="${playerId}"][data-zone="command"]`)).toBeVisible();
}

async function assertDeckCountersAreCoherent(page: Page, playerId: string): Promise<void> {
  const library = await readZoneCount(page, playerId, 'library');
  const graveyard = await readZoneCount(page, playerId, 'graveyard');
  const exile = await readZoneCount(page, playerId, 'exile');
  const command = await readZoneCount(page, playerId, 'command');

  const hand = await page
    .locator(`[data-testid="hand-zone"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="hand"]`)
    .count();
  const battlefield = await page
    .locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="battlefield"]`)
    .count();

  expect(library + hand + battlefield + graveyard + exile + command).toBe(100);
}

async function readZoneCount(page: Page, playerId: string, zone: string): Promise<number> {
  const text = await page
    .locator(`[data-testid="zone-count"][data-player-id="${playerId}"][data-zone="${zone}"]`)
    .innerText();

  const value = Number.parseInt(text.trim(), 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Could not parse zone count "${text}" for ${zone} (${playerId}).`);
  }

  return value;
}

