import { expect, test } from '@playwright/test';
import { createAuthenticatedContext } from './support/auth';

test('can create authenticated browser context from real backend auth', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const { context } = await createAuthenticatedContext(browser, request, baseURL, 'auth-smoke');

  try {
    const page = await context.newPage();
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Game Control' })).toBeVisible();
  } finally {
    await context.close();
  }
});
