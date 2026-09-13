import { expect, test } from '@playwright/test';
import { createAuthenticatedContext } from './support/auth';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test('header caches survive public/private navigation and panel bodies load on demand', async ({ browser, request, baseURL }) => {
  test.setTimeout(90_000);
  const session = await createAuthenticatedContext(browser, request, baseURL!, 'header-cache');
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const reads = new Map<string, number>();
  page.on('request', (request) => {
    if (request.method() !== 'GET' || !request.url().startsWith(API_BASE_URL + '/')) return;
    const path = new URL(request.url()).pathname;
    reads.set(path, (reads.get(path) ?? 0) + 1);
  });
  const response = (path: string) => page.waitForResponse((r) => new URL(r.url()).pathname === path && r.request().method() === 'GET' && r.ok(), { timeout: 15_000 });
  try {
    await Promise.all([response('/friends/summary'), response('/messages/summary'), page.goto('/decks')]);
    for (const route of ['/rooms', '/community', '/decks', '/rooms', '/community', '/decks']) {
      if (route === '/community') {
        await page.locator(`app-dashboard-header a[href="${route}"]`).click();
        await expect(page.locator('app-community-page .community-preview-grid')).toBeVisible();
      } else {
        await Promise.all([response(route), page.locator(`app-dashboard-header a[href="${route}"]`).click()]);
      }
      await expect(page).toHaveURL(new RegExp(route + '$'));
    }
    expect(reads.get('/friends/summary')).toBe(1);
    expect(reads.get('/messages/summary')).toBe(1);
    expect(reads.get('/friends') ?? 0).toBe(0);
    expect(reads.get('/friends/requests/incoming') ?? 0).toBe(0);
    expect(reads.get('/friends/requests/outgoing') ?? 0).toBe(0);
    expect(reads.get('/messages') ?? 0).toBe(0);
    await Promise.all([
      response('/friends'), response('/friends/requests/incoming'), response('/friends/requests/outgoing'), response('/rooms/invites/incoming'),
      page.locator('.friends-action').click(),
    ]);
    await expect(page.locator('app-friends-dropdown')).toBeVisible();
    await page.locator('.friends-action').click();
    await expect(page.locator('app-friends-dropdown')).toBeHidden();
    // The unread icon animates continuously; keyboard activation does not
    // require its bounding box to stop moving.
    await page.locator('.messages-action').focus();
    await Promise.all([response('/messages'), page.locator('.messages-action').press('Enter')]);
    await expect(page.locator('app-messages-dropdown')).toBeVisible();
    expect(reads.get('/friends')).toBe(1);
    expect(reads.get('/messages')).toBe(1);
  } finally {
    await session.context.close().catch(() => undefined);
  }
});
