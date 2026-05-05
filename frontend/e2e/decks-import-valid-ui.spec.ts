import { expect, test } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { createValidCommanderDeckFromDatabase } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

interface ValidationPayload {
  valid: boolean;
  counts?: {
    total: number;
    commander: number;
    main: number;
    sideboard: number;
    maybeboard: number;
  };
  errors?: string[];
}

test('user imports a Commander-valid decklist using existing UI flow', async ({ browser, request, baseURL }) => {
  test.setTimeout(180_000);

  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const user = await createRealUserSession(request, 'deck-import-valid');
  const source = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: user.token,
    name: `Source Commander Deck ${Date.now()}`,
    seed: 'e2e-ui-import-valid-seed',
  });
  expect(source.validation.valid).toBeTruthy();
  const exportResponse = await request.get(`${API_BASE_URL}/decks/${source.deckId}/export?format=moxfield`, {
    headers: {
      Authorization: `Bearer ${user.token}`,
    },
  });
  expect(exportResponse.ok()).toBeTruthy();
  const exportPayload = (await exportResponse.json()) as { content?: string };
  const validDecklist = String(exportPayload.content ?? '').trim();
  expect(validDecklist.length).toBeGreaterThan(10);

  const context = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, user.token, user.user),
  });

  try {
    const page = await context.newPage();
    await page.goto('/decks');

    await page.getByRole('button', { name: 'Create deck' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Create deck' });
    await expect(createDialog).toBeVisible();
    await createDialog.locator('input[name="name"]').fill(`UI Import Deck ${Date.now()}`);
    await createDialog.getByRole('button', { name: 'Create' }).click();

    const importDialog = page.getByRole('dialog', { name: 'Import decklist' });
    await expect(importDialog).toBeVisible();
    await importDialog.locator('textarea[name="createdDecklist"]').fill(validDecklist);
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog.getByText(/0 missing\./i)).toBeVisible();
    await importDialog.getByRole('link', { name: 'Open deck' }).click();

    await expect(page).toHaveURL(/\/decks\/.+$/);
    await expect(page.locator('.deck-summary strong', { hasText: '100 cards' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Comandante \(1\)/i })).toBeVisible();

    const deckUrl = new URL(page.url(), baseURL);
    const deckId = deckUrl.pathname.split('/').filter(Boolean).at(-1);
    if (!deckId) {
      throw new Error('Deck id not found in URL after import.');
    }

    const validationResponse = await request.post(`${API_BASE_URL}/decks/${deckId}/validate-commander`, {
      headers: {
        Authorization: `Bearer ${user.token}`,
      },
    });
    expect(validationResponse.ok()).toBeTruthy();
    const validation = (await validationResponse.json()) as ValidationPayload;
    if (!validation.valid) {
      throw new Error(`Imported deck validation failed: ${JSON.stringify(validation)}`);
    }
    expect(validation.valid).toBeTruthy();
    if (validation.counts) {
      expect(validation.counts.total).toBe(100);
      expect(validation.counts.commander).toBe(1);
      expect(validation.counts.main).toBe(99);
      expect(validation.counts.sideboard).toBe(0);
      expect(validation.counts.maybeboard).toBe(0);
    }
  } finally {
    await context.close().catch(() => {});
  }
});
