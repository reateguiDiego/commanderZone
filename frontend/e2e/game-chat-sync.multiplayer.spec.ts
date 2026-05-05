import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test('chat messages are synchronized between two isolated player sessions', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const playerA = await createRealUserSession(request, 'chat-a');
  const playerB = await createRealUserSession(request, 'chat-b');

  const deckAId = await createDeck(request, playerA.token, `Deck ${playerA.user.displayName}`);
  const deckBId = await createDeck(request, playerB.token, `Deck ${playerB.user.displayName}`);
  const roomId = await createRoom(request, playerA.token, deckAId);

  await joinRoom(request, playerB.token, roomId, deckBId);
  const gameId = await startRoom(request, playerA.token, roomId);

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

async function createDeck(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/decks`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      name,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { deck: { id: string } };

  return payload.deck.id;
}

async function createRoom(request: APIRequestContext, token: string, deckId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      deckId,
      visibility: 'public',
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { room: { id: string } };

  return payload.room.id;
}

async function joinRoom(request: APIRequestContext, token: string, roomId: string, deckId: string): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      deckId,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { game: { id: string } };

  return payload.game.id;
}
