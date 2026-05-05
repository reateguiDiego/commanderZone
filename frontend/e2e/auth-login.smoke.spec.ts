import { expect, test } from '@playwright/test';

test('auth login smoke renders form', async ({ page }) => {
  await page.goto('/auth/login');

  await expect(page.getByRole('heading', { name: 'CommanderZone' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.locator('form button[type="submit"]')).toContainText('Login');
});
