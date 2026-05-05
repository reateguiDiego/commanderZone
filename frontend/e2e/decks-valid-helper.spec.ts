import { expect, test } from '@playwright/test';
import { createRealUserSession } from './support/auth';
import { createValidCommanderDeckFromDatabase } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test('createValidCommanderDeckFromDatabase returns a backend-valid Commander deck', async ({ request }) => {
  test.setTimeout(120_000);

  const owner = await createRealUserSession(request, 'valid-helper');
  const result = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: owner.token,
    name: `Helper Valid Deck ${Date.now()}`,
    seed: 'helper-valid-seed',
  });

  expect(result.validation.valid).toBeTruthy();
  expect(result.validation.counts.total).toBe(100);
  expect(result.validation.counts.commander).toBe(1);
  expect(result.validation.counts.main).toBe(99);
  expect(result.validation.errors).toHaveLength(0);
  expect(result.commander.name.length).toBeGreaterThan(0);

  const validationResponse = await request.post(`${API_BASE_URL}/decks/${result.deckId}/validate-commander`, {
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(validationResponse.ok()).toBeTruthy();
  const validation = (await validationResponse.json()) as { valid: boolean };
  expect(validation.valid).toBeTruthy();
});
