import { expect, test, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';

test('chat messages are synchronized between two isolated player sessions', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    playerAPrefix: 'chat-a',
    playerBPrefix: 'chat-b',
  });
  const { gameId, playerA, playerB } = setup;

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerA.token, playerA.user),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerB.token, playerB.user),
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([
      pageA.goto(`/games/${gameId}`),
      pageB.goto(`/games/${gameId}`),
    ]);

    await expect(pageA.locator('.game-screen')).toBeVisible();
    await expect(pageB.locator('.game-screen')).toBeVisible();

    await openChat(pageA);
    await openChat(pageB);

    const messageFromA = `hello-from-a-${Date.now()}`;
    const messageFromB = `reply-from-b-${Date.now()}`;

    await sendChatMessage(pageA, messageFromA);
    await expect.poll(async () => hasChatMessage(pageA, playerA.user.displayName, messageFromA)).toBe(true);
    await expect.poll(async () => hasChatMessage(pageB, playerA.user.displayName, messageFromA)).toBe(true);

    await sendChatMessage(pageB, messageFromB);
    await expect.poll(async () => hasChatMessage(pageB, playerB.user.displayName, messageFromB)).toBe(true);
    await expect.poll(async () => hasChatMessage(pageA, playerB.user.displayName, messageFromB)).toBe(true);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function openChat(page: Page): Promise<void> {
  await page.locator('.floating-handle button').filter({ hasText: /^Chat$/ }).click();
  await expect(page.locator('.chat-form input[name="chatMessage"]')).toBeVisible();
}

async function sendChatMessage(page: Page, message: string): Promise<void> {
  const input = page.locator('.chat-form input[name="chatMessage"]');
  await input.fill(message);
  await input.press('Enter');
}

async function hasChatMessage(page: Page, displayName: string, message: string): Promise<boolean> {
  const row = page.locator('.panel-feed p').filter({
    has: page.locator('strong', { hasText: displayName }),
  }).filter({
    has: page.locator('span', { hasText: message }),
  });

  return (await row.count()) > 0;
}
