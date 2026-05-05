import { expect, test } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { createValidCommanderDeckFromDatabase } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

interface ValidationErrorIssue {
  code?: string;
  title?: string;
  detail?: string;
}

interface ValidationPayload {
  valid: boolean;
  errors?: Array<string | ValidationErrorIssue>;
}

test('user imports an invalid decklist and sees it as not Commander-usable', async ({ browser, request, baseURL }) => {
  test.setTimeout(180_000);

  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const owner = await createRealUserSession(request, 'deck-import-invalid-owner');
  const ownerSource = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: owner.token,
    name: `Source Deck Invalid Flow ${Date.now()}`,
    seed: 'e2e-ui-import-invalid-seed',
  });
  expect(ownerSource.validation.valid).toBeTruthy();

  const exportResponse = await request.get(`${API_BASE_URL}/decks/${ownerSource.deckId}/export?format=moxfield`, {
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(exportResponse.ok()).toBeTruthy();
  const exportPayload = (await exportResponse.json()) as { content?: string };
  const validDecklist = String(exportPayload.content ?? '').trim();
  expect(validDecklist.length).toBeGreaterThan(10);

  const invalidDecklist = removeCommanderSection(validDecklist);
  expect(invalidDecklist.toLowerCase()).not.toContain('commander');

  const ownerContext = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, owner.token, owner.user),
  });

  let importedDeckId = '';
  try {
    const page = await ownerContext.newPage();
    await page.goto('/decks');

    await page.getByRole('button', { name: 'Create deck' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Create deck' });
    await expect(createDialog).toBeVisible();
    await createDialog.locator('input[name="name"]').fill(`UI Invalid Import ${Date.now()}`);
    await createDialog.getByRole('button', { name: 'Create' }).click();

    const importDialog = page.getByRole('dialog', { name: 'Import decklist' });
    await expect(importDialog).toBeVisible();
    await importDialog.locator('textarea[name="createdDecklist"]').fill(invalidDecklist);
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog.getByText(/missing\./i)).toBeVisible();
    await importDialog.getByRole('link', { name: 'Open deck' }).click();

    await expect(page).toHaveURL(/\/decks\/.+$/);
    await expect(page.locator('.deck-summary strong', { hasText: '99 cards' })).toBeVisible();

    const deckUrl = new URL(page.url(), baseURL);
    importedDeckId = deckUrl.pathname.split('/').filter(Boolean).at(-1) ?? '';
    expect(importedDeckId.length).toBeGreaterThan(0);
  } finally {
    await ownerContext.close().catch(() => {});
  }

  const validationResponse = await request.post(`${API_BASE_URL}/decks/${importedDeckId}/validate-commander`, {
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(validationResponse.ok()).toBeTruthy();
  const validation = (await validationResponse.json()) as ValidationPayload;
  expect(validation.valid).toBeFalsy();
  expect(hasActionableValidationError(validation)).toBeTruthy();
});

function removeCommanderSection(decklist: string): string {
  const lines = decklist.split(/\r?\n/);
  const output: string[] = [];
  let droppingCommanderBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const normalized = line.toLowerCase().replace(/:$/, '');

    if (normalized === 'commander' || normalized === 'commanders' || normalized === 'command zone') {
      droppingCommanderBlock = true;
      continue;
    }
    if (normalized === 'deck' || normalized === 'mainboard' || normalized === 'main') {
      droppingCommanderBlock = false;
      output.push('Deck');
      continue;
    }
    if (droppingCommanderBlock) {
      continue;
    }
    output.push(rawLine);
  }

  return output.join('\n').trim();
}

function hasActionableValidationError(payload: ValidationPayload): boolean {
  const errors = payload.errors ?? [];
  if (errors.length === 0) {
    return false;
  }

  return errors.some((entry) => {
    if (typeof entry === 'string') {
      const normalized = entry.toLowerCase();
      return normalized.includes('commander') || normalized.includes('100') || normalized.includes('size');
    }

    const combined = `${entry.code ?? ''} ${entry.title ?? ''} ${entry.detail ?? ''}`.toLowerCase();
    return combined.includes('commander') || combined.includes('size') || combined.includes('100');
  });
}
