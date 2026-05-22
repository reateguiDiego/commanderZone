import { expect, test, type Browser, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks, type CommanderGameWithValidDecksResult } from './support/commander-game';

test.setTimeout(240000);

test('game table requires landscape on mobile and tablet and keeps play surfaces usable there', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    runId: `responsive-${Date.now()}`,
  });

  await assertPortraitOrientationLock(browser, baseURL, setup, { width: 390, height: 844 });
  await assertPortraitOrientationLock(browser, baseURL, setup, { width: 820, height: 1180 });
  await assertLandscapePlaySurface(browser, baseURL, setup, { width: 844, height: 390 });
  await assertLandscapePlaySurface(browser, baseURL, setup, { width: 1180, height: 820 });
});

async function assertPortraitOrientationLock(
  browser: Browser,
  baseURL: string,
  setup: CommanderGameWithValidDecksResult,
  viewport: { width: number; height: number },
): Promise<void> {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    isMobile: true,
    storageState: authStorageState(baseURL, setup.playerA.user, setup.playerA.refreshToken),
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
  });

  try {
    const page = await context.newPage();
    await page.goto(`/games/${setup.gameId}`);

    await expect(page.getByTestId('game-screen')).toBeVisible();
    await expect(page.getByTestId('game-orientation-lock')).toBeVisible();
    await expect(page.getByTestId('game-orientation-lock')).toContainText('landscape');
    await expectOrientationLockToCoverViewport(page, viewport);
    await expectNoHorizontalDocumentOverflow(page);
  } finally {
    await context.close();
  }
}

async function assertLandscapePlaySurface(
  browser: Browser,
  baseURL: string,
  setup: CommanderGameWithValidDecksResult,
  viewport: { width: number; height: number },
): Promise<void> {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    isMobile: true,
    storageState: authStorageState(baseURL, setup.playerA.user, setup.playerA.refreshToken),
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
  });

  try {
    const page = await context.newPage();
    await page.goto(`/games/${setup.gameId}`);

    await expect(page.getByTestId('game-screen')).toBeVisible();
    await expect(page.getByTestId('game-orientation-lock')).toBeHidden();
    await expect(page.getByTestId('battlefield-zone')).toBeVisible();
    await expect(page.getByTestId('hand-area')).toBeVisible();
    await expect(page.getByTestId('zone-piles')).toBeVisible();
    await expect(page.getByTestId('drop-zone').first()).toBeVisible();
    await expectNoHorizontalDocumentOverflow(page);

    const drawer = page.locator('.opponents-drawer-handle');
    const sidebar = page.locator('.player-sidebar');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('aria-expanded', 'false');

    await drawer.click();
    await expect(drawer).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar).toHaveClass(/opponents-open/);
    await expect(page.getByTestId('opponent-mini-board').first()).toBeVisible();
    await expectNoHorizontalDocumentOverflow(page);
  } finally {
    await context.close();
  }
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

async function expectOrientationLockToCoverViewport(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await expect.poll(async () => {
    const box = await page.getByTestId('game-orientation-lock').boundingBox();

    return box !== null
      && Math.round(box.x) === 0
      && Math.round(box.y) === 0
      && Math.round(box.width) === viewport.width
      && Math.round(box.height) === viewport.height;
  }).toBe(true);
}
