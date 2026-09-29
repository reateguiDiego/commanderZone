import { expect, test } from '@playwright/test';

test('auth login smoke renders form', async ({ page }) => {
  await page.goto('/auth/login');

  await expect(page.getByRole('img', { name: 'CommanderZone' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email or username' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^Password/ })).toBeVisible();
  await expect(page.locator('form button[type="submit"]')).toContainText('Login');
});
