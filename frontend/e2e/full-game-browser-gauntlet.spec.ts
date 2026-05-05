import { expect, test, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test.setTimeout(300000);

test('full game browser gauntlet: multiplayer open, life sync, chat sync, move card, reconnect, concede, close', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    playerAPrefix: 'gauntlet-a',
    playerBPrefix: 'gauntlet-b',
    roomVisibility: 'public',
  });
  const { gameId, roomId, playerA, playerB } = setup;

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

    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();

    await expect(pageA.locator('.player-sidebar .player-thumb strong', { hasText: playerA.user.displayName })).toBeVisible();
    await expect(pageA.locator('.player-sidebar .player-thumb strong', { hasText: playerB.user.displayName })).toBeVisible();
    await expect(pageB.locator('.player-sidebar .player-thumb strong', { hasText: playerA.user.displayName })).toBeVisible();
    await expect(pageB.locator('.player-sidebar .player-thumb strong', { hasText: playerB.user.displayName })).toBeVisible();

    await focusPlayer(pageA, playerA.user.displayName);
    await pageA.locator('.focused-board .life-pill button').first().click();
    await expect.poll(async () => readSidebarLife(pageA, playerA.user.displayName)).toBe(39);
    await expect.poll(async () => readSidebarLife(pageB, playerA.user.displayName)).toBe(39);

    await openChat(pageA);
    await openChat(pageB);
    const messageFromA = `gauntlet-a-${Date.now()}`;
    await sendChatMessage(pageA, messageFromA);
    await expect.poll(async () => hasChatMessage(pageA, playerA.user.displayName, messageFromA)).toBe(true);
    await expect.poll(async () => hasChatMessage(pageB, playerA.user.displayName, messageFromA)).toBe(true);

    const sidebarBeforeMove = await readSidebarZoneCounts(pageB, playerB.user.displayName);
    await focusPlayer(pageB, playerB.user.displayName);
    const handCard = pageB
      .locator(`[data-testid="hand-zone"][data-player-id="${playerB.user.id}"] [data-testid="game-card"][data-zone="hand"]`)
      .first();
    await expect(handCard).toBeVisible();
    const movedInstanceId = await handCard.getAttribute('data-card-instance-id');
    if (!movedInstanceId) {
      throw new Error('Expected hand card instance id for gauntlet move.');
    }
    await handCard.dblclick();
    await expect(pageB.locator(`[data-testid="battlefield-zone"][data-player-id="${playerB.user.id}"] [data-card-instance-id="${movedInstanceId}"]`)).toBeVisible();
    await expect.poll(async () => readSidebarZoneCounts(pageB, playerB.user.displayName)).toEqual({
      hand: sidebarBeforeMove.hand - 1,
      library: sidebarBeforeMove.library,
    });
    await expect.poll(async () => readSidebarZoneCounts(pageA, playerB.user.displayName)).toEqual({
      hand: sidebarBeforeMove.hand - 1,
      library: sidebarBeforeMove.library,
    });

    await pageB.reload();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.locator('.player-sidebar .player-thumb strong', { hasText: playerA.user.displayName })).toBeVisible();
    await expect(pageB.locator('.player-sidebar .player-thumb strong', { hasText: playerB.user.displayName })).toBeVisible();
    await expect.poll(async () => readSidebarLife(pageB, playerA.user.displayName)).toBe(39);

    const concedeResponse = await request.post(`${API_BASE_URL}/games/${gameId}/commands`, {
      headers: {
        Authorization: `Bearer ${playerB.token}`,
      },
      data: {
        type: 'game.concede',
        payload: {},
      },
    });
    expect(concedeResponse.ok()).toBeTruthy();

    await expect.poll(async () => {
      const snapshotResponse = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
        headers: {
          Authorization: `Bearer ${playerA.token}`,
        },
      });
      if (!snapshotResponse.ok()) {
        return '';
      }
      const payload = (await snapshotResponse.json()) as {
        game: { snapshot: { players: Record<string, { user: { displayName: string }; status: string }> } };
      };
      const playerEntry = Object.values(payload.game.snapshot.players)
        .find((candidate) => candidate.user.displayName === playerB.user.displayName);

      return playerEntry?.status ?? '';
    }).toBe('conceded');

    const closeResponse = await request.post(`${API_BASE_URL}/games/${gameId}/commands`, {
      headers: {
        Authorization: `Bearer ${playerA.token}`,
      },
      data: {
        type: 'game.close',
        payload: {},
      },
    });
    expect(closeResponse.ok()).toBeTruthy();

    await expect.poll(async () => {
      const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
        headers: {
          Authorization: `Bearer ${playerA.token}`,
        },
      });
      if (!roomResponse.ok()) {
        return '';
      }
      const roomPayload = (await roomResponse.json()) as { room: { status: string } };

      return roomPayload.room.status;
    }).toBe('archived');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function focusPlayer(page: Page, displayName: string): Promise<void> {
  const thumb = page.locator('.player-sidebar .player-thumb').filter({
    has: page.locator('strong', { hasText: displayName }),
  });
  await expect(thumb).toBeVisible();
  await thumb.click();
  await expect(page.locator('.focused-board h1')).toHaveText(displayName);
}

async function readSidebarLife(page: Page, displayName: string): Promise<number> {
  const thumb = page.locator('.player-sidebar .player-thumb').filter({
    has: page.locator('strong', { hasText: displayName }),
  });
  const raw = await thumb.locator('.player-thumb-header span').first().innerText();
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Could not parse life total "${raw}" for ${displayName}`);
  }

  return value;
}

async function openChat(page: Page): Promise<void> {
  await page.locator('.floating-handle button').filter({ hasText: /^Chat$/ }).click();
  await expect(page.locator('.chat-form input[name="chatMessage"]')).toBeVisible();
}

async function readSidebarZoneCounts(page: Page, displayName: string): Promise<{ hand: number; library: number }> {
  const thumb = page.locator('.player-sidebar .player-thumb').filter({
    has: page.locator('strong', { hasText: displayName }),
  });
  const text = await thumb.locator('small').innerText();
  const match = /(\d+)\s+hand\s+[^\d]+\s+(\d+)\s+library/.exec(text.trim());
  if (!match) {
    throw new Error(`Could not parse sidebar zone counts for ${displayName}: "${text}"`);
  }

  return {
    hand: Number.parseInt(match[1] ?? '', 10),
    library: Number.parseInt(match[2] ?? '', 10),
  };
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
