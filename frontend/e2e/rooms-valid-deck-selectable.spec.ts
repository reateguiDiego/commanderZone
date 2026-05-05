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

    const deckSelect = page.locator('select[name="deckId"]');
    await expect(deckSelect).toBeVisible();
    await expect(deckSelect.locator(`option[value="${deck.deckId}"]`)).toHaveText(deckName);

    await deckSelect.selectOption(deck.deckId);
    await page.getByRole('button', { name: 'Create room' }).click();

    await expect(page.locator('.room-header strong')).toBeVisible();
    await expect(page.locator('.dense-list.compact-list .list-row small', { hasText: deck.deckId }).first()).toBeVisible();
  } finally {
    await context.close().catch(() => {});
  }
});
