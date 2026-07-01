import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';
import {
  expectFocusedPlayer,
  expectOpponentVisible,
  focusPlayer,
  openChat,
  readTableLife as readSidebarLife,
  readTableZoneCounts as readSidebarZoneCounts,
} from './support/game-table';
import { sendRuntimeCommand } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const POLL_TIMEOUT = 15_000;

test.setTimeout(300000);

test('full game browser gauntlet: multiplayer open, life sync, chat sync, move card, reconnect, concede, close', async ({
  browser,
  request,
  baseURL,
}) => {
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
    storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken),
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);

    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();

    await expectFocusedPlayer(pageA, playerA.user.displayName);
    await expectOpponentVisible(pageA, playerB.user.displayName);
    await expectFocusedPlayer(pageB, playerB.user.displayName);
    await expectOpponentVisible(pageB, playerA.user.displayName);

    await focusPlayer(pageA, playerA.user.displayName);
    await pageA.locator('.focused-board [data-testid="life-value"]').click({ button: 'right' });
    await expect
      .poll(async () => readSidebarLife(pageA, playerA.user.displayName), { timeout: POLL_TIMEOUT })
      .toBe(39);
    await expect
      .poll(async () => readSidebarLife(pageB, playerA.user.displayName), { timeout: POLL_TIMEOUT })
      .toBe(39);

    await openChat(pageA);
    await openChat(pageB);
    const messageFromA = `gauntlet-a-${Date.now()}`;
    await sendChatMessage(pageA, messageFromA);
    await expect
      .poll(async () => hasChatMessage(pageA, playerA.user.displayName, messageFromA), {
        timeout: POLL_TIMEOUT,
      })
      .toBe(true);
    await expect
      .poll(async () => hasChatMessage(pageB, playerA.user.displayName, messageFromA), {
        timeout: POLL_TIMEOUT,
      })
      .toBe(true);

    const sidebarBeforeMove = await readSidebarZoneCounts(pageB, playerB.user.displayName);
    await focusPlayer(pageB, playerB.user.displayName);
    const handCard = pageB
      .locator(
        `[data-testid="hand-zone"][data-player-id="${playerB.user.id}"] [data-testid="game-card"][data-zone="hand"]`,
      )
      .nth(3);
    await expect(handCard).toBeVisible();
    const movedInstanceId = await handCard.getAttribute('data-card-instance-id');
    if (!movedInstanceId) {
      throw new Error('Expected hand card instance id for gauntlet move.');
    }
    await handCard.dblclick();
    await expect(
      pageB.locator(
        `[data-testid="battlefield-zone"][data-player-id="${playerB.user.id}"] [data-card-instance-id="${movedInstanceId}"]`,
      ),
    ).toBeVisible();
    await expect
      .poll(async () => readSidebarZoneCounts(pageB, playerB.user.displayName), {
        timeout: POLL_TIMEOUT,
      })
      .toEqual({
        hand: sidebarBeforeMove.hand - 1,
        library: sidebarBeforeMove.library,
      });
    await expect
      .poll(async () => readSidebarZoneCounts(pageA, playerB.user.displayName), {
        timeout: POLL_TIMEOUT,
      })
      .toEqual({
        hand: sidebarBeforeMove.hand - 1,
        library: sidebarBeforeMove.library,
      });

    await pageB.reload();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();
    await expectFocusedPlayer(pageB, playerB.user.displayName);
    await expectOpponentVisible(pageB, playerA.user.displayName);
    await expect
      .poll(async () => readSidebarLife(pageB, playerA.user.displayName), { timeout: POLL_TIMEOUT })
      .toBe(39);

    const concedeOutcome = await sendRuntimeCommand(request, {
      gameId,
      token: playerB.token,
      baseVersion: await gameVersion(request, gameId, playerA.token),
      type: 'game.concede',
      payload: { playerId: playerB.user.id },
    });

    await expect
      .poll(async () => {
        const snapshotResponse = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
          headers: {
            Authorization: `Bearer ${playerA.token}`,
          },
        });
        if (!snapshotResponse.ok()) {
          return '';
        }
        const payload = (await snapshotResponse.json()) as {
          game: {
            snapshot: {
              players: Record<string, { user: { displayName: string }; status: string }>;
            };
          };
        };
        const playerEntry = Object.values(payload.game.snapshot.players).find(
          (candidate) => candidate.user.displayName === playerB.user.displayName,
        );

        return playerEntry?.status ?? '';
      })
      .toBe('conceded');

    await sendRuntimeCommand(request, {
      gameId,
      token: playerA.token,
      baseVersion: concedeOutcome.version,
      type: 'game.close',
      payload: {},
    });

    await expect
      .poll(async () => {
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
      })
      .toBe('archived');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function sendChatMessage(page: Page, message: string): Promise<void> {
  const input = page.locator('.chat-form input[name="chatMessage"]');
  await input.fill(message);
  await input.press('Enter');
}

async function hasChatMessage(page: Page, displayName: string, message: string): Promise<boolean> {
  const row = page
    .locator('.panel-feed p')
    .filter({
      has: page.locator('strong', { hasText: displayName }),
    })
    .filter({
      has: page.locator('span', { hasText: message }),
    });

  return (await row.count()) > 0;
}

async function gameVersion(
  request: APIRequestContext,
  gameId: string,
  token: string,
): Promise<number> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { game?: { snapshot?: { version?: unknown } } };

  return Math.max(1, Number(payload.game?.snapshot?.version ?? 1));
}
