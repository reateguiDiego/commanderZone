import { expect, test, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';

test.setTimeout(240000);

test('game table exposes exactly four responsive states and a clear minimum supported viewport', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithBasicDecks(request, {
    runId: `responsive-${Date.now()}`,
  });
  await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);

  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    isMobile: true,
    storageState: authStorageState(baseURL, setup.playerA.user, setup.playerA.refreshToken),
    viewport: { width: 479, height: 359 },
  });
  context.setDefaultTimeout(10_000);
  try {
    const page = await context.newPage();
    await page.goto(`/games/${setup.gameId}`);
    await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });

    await assertUnsupportedMinimum(page, { width: 479, height: 359 });
    await assertPlaySurface(page, { width: 844, height: 1180 }, 'aggressive');
    await assertPlaySurface(page, { width: 844, height: 390 }, 'minimal');
    await assertPlaySurface(page, { width: 1180, height: 820 }, 'compact');
    await assertPlaySurface(page, { width: 1600, height: 1000 }, 'normal');
  } finally {
    await context.close();
  }
});

async function assertUnsupportedMinimum(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', 'minimal');
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-responsive-supported', 'false');
  await expect(page.getByTestId('game-unsupported-resolution-lock')).toBeVisible();
  await expect(page.getByTestId('game-orientation-lock')).toBeHidden();
  await expectNoHorizontalDocumentOverflow(page);
}

async function assertPlaySurface(
  page: Page,
  viewport: { width: number; height: number },
  expectedState: 'normal' | 'compact' | 'aggressive' | 'minimal',
): Promise<void> {
  await page.setViewportSize(viewport);
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', expectedState);
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-responsive-supported', 'true');
  await expect(page.getByTestId('game-orientation-lock')).toBeHidden();
  await expect(page.getByTestId('game-unsupported-resolution-lock')).toBeHidden();
  await expect(page.getByTestId('battlefield-zone')).toBeVisible();
  await expect(page.getByTestId('hand-area')).toBeVisible();
  await expect(page.getByTestId('zone-piles')).toBeVisible();
  await expect(page.getByTestId('drop-zone').first()).toBeVisible();
  await expectNoHorizontalDocumentOverflow(page);

  const drawer = page.locator('.opponents-drawer-handle');
  const sidebar = page.locator('.player-sidebar');
  if (expectedState === 'normal') {
    await expect(drawer).toBeHidden();
    await expect(sidebar).toBeVisible();
    return;
  }

  await expect(drawer).toBeVisible();
  if (await drawer.getAttribute('aria-expanded') === 'true') {
    await drawer.click();
  }
  await expect(drawer).toHaveAttribute('aria-expanded', 'false');
  await drawer.click();
  await expect(drawer).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar).toHaveClass(/opponents-open/);
  await expect(page.getByTestId('opponent-mini-board').first()).toBeVisible();
  await expectNoHorizontalDocumentOverflow(page);
}

async function expectNoHorizontalDocumentOverflow(page: Page): Promise<void> {
  await expect.poll(async () =>
    page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      const scrollWidth = Math.max(root.scrollWidth, body?.scrollWidth ?? 0);

      return scrollWidth <= root.clientWidth + 1;
    }),
  ).toBe(true);
}
