import { expect, test } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { createValidCommanderDeckFromDatabase } from './support/decks';

test('a Commander-valid deck appears selectable in Rooms UI', async ({ browser, request, baseURL }) => {
  test.setTimeout(120_000);

  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const user = await createRealUserSession(request, 'rooms-valid-selectable');
  const deckName = `Rooms Selectable ${Date.now()}`;
  const deck = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: user.token,
    name: deckName,
    seed: 'e2e-rooms-valid-selectable-seed',
  });
  expect(deck.validation.valid).toBeTruthy();

  const context = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, user.token, user.user),
  });

  try {
    const page = await context.newPage();
    await page.goto('/rooms');

    const createPanel = page.locator('.rooms-create-panel');
    await createPanel.getByPlaceholder('Ej. La taberna del comandante').fill(`Mesa Seleccionable ${Date.now()}`);
    await createPanel.getByRole('button', { name: '4 players' }).click();
    await createPanel.getByRole('button', { name: /Public/i }).click();
    await createPanel.getByRole('button', { name: 'Create room' }).click();

    const deckSelect = page.locator('select[name="waitingDeckId"]');
    await expect(deckSelect).toBeVisible();
    await expect(deckSelect.locator(`option[value="${deck.deckId}"]`)).toHaveText(deckName);

    await deckSelect.selectOption(deck.deckId);
    await page.getByRole('button', { name: 'Update deck for this room' }).click();

    await expect(page.locator('.waiting-hero h2')).toBeVisible();
    await expect(page.locator('.player-card.current .ready-state')).toHaveText('Roll pending');
    await expect(page.getByRole('button', { name: 'Roll d20' })).toBeEnabled();
  } finally {
    await context.close().catch(() => {});
  }
});
