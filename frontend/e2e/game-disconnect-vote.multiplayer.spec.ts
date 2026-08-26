import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks, resolveGameToPlaying } from './support/commander-game';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const SHORT_TIMEOUT = 20_000;
const LONG_TIMEOUT = 420_000;
const DISCONNECTED_HEADING = /player disconnected|jugador desconectado/i;
const EXPEL_BUTTON = /expel|expulsar/i;

test.setTimeout(540_000);

test('disconnect vote expel concedes and removes the offline player from the room', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    playerAPrefix: 'disconnect-vote-expel-a',
    playerBPrefix: 'disconnect-vote-expel-b',
    roomVisibility: 'public',
  });
  await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerA.user, setup.playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerB.user, setup.playerB.refreshToken),
  });
  await Promise.all([enableFrontendGameplayV2(contextA), enableFrontendGameplayV2(contextB)]);

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const framesA = collectWebSocketFrames(pageA);
    const framesB = collectWebSocketFrames(pageB);

    await Promise.all([
      pageA.goto(`/games/${setup.gameId}`),
      pageB.goto(`/games/${setup.gameId}`),
    ]);

    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();
    await Promise.all([waitForGameplayConnection(framesA), waitForGameplayConnection(framesB)]);

    await pageB.close();

    const voteHeading = pageA.getByRole('heading', { name: DISCONNECTED_HEADING });
    await expect(voteHeading).toBeVisible({ timeout: SHORT_TIMEOUT });
    const voteModal = pageA.locator('.modal-panel').filter({ has: voteHeading });
    await voteModal.getByRole('button', { name: EXPEL_BUTTON }).click();

    await expect.poll(
      () => snapshotPlayerStatus(request, setup.playerA.token, setup.gameId, setup.playerB.user.id),
      { timeout: SHORT_TIMEOUT },
    ).toBe('conceded');

    await expect.poll(
      async () => (await roomPlayerIds(request, setup.playerA.token, setup.roomId)).includes(setup.playerB.user.id),
      { timeout: SHORT_TIMEOUT },
    ).toBe(false);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('disconnect vote times out to wait and reopens after cooldown if player stays offline', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    playerAPrefix: 'disconnect-vote-timeout-a',
    playerBPrefix: 'disconnect-vote-timeout-b',
    roomVisibility: 'public',
  });
  await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerA.user, setup.playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerB.user, setup.playerB.refreshToken),
  });
  await Promise.all([enableFrontendGameplayV2(contextA), enableFrontendGameplayV2(contextB)]);

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const framesA = collectWebSocketFrames(pageA);
    const framesB = collectWebSocketFrames(pageB);

    await Promise.all([
      pageA.goto(`/games/${setup.gameId}`),
      pageB.goto(`/games/${setup.gameId}`),
    ]);

    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();
    await Promise.all([waitForGameplayConnection(framesA), waitForGameplayConnection(framesB)]);

    await pageB.close();

    const voteHeading = pageA.getByRole('heading', { name: DISCONNECTED_HEADING });
    await expect(voteHeading).toBeVisible({ timeout: SHORT_TIMEOUT });

    let firstOpenedAt: string | null = null;
    await expect.poll(async () => {
      const snapshot = await gameSnapshot(request, setup.playerA.token, setup.gameId);
      firstOpenedAt = disconnectVoteFor(snapshot, setup.playerB.user.id)?.openedAt ?? null;

      return firstOpenedAt;
    }, { timeout: SHORT_TIMEOUT }).not.toBeNull();
    if (!firstOpenedAt) {
      throw new Error('Expected disconnect vote openedAt timestamp.');
    }

    await expect.poll(async () => {
      const snapshot = await gameSnapshot(request, setup.playerA.token, setup.gameId);
      return {
        voteStatus: disconnectVoteFor(snapshot, setup.playerB.user.id)?.status ?? null,
        playerStatus: snapshot.game.snapshot.players[setup.playerB.user.id]?.status ?? null,
      };
    }, { timeout: 120_000 }).toEqual({
      voteStatus: 'resolved_wait',
      playerStatus: 'active',
    });

    await expect(voteHeading).toBeHidden({ timeout: SHORT_TIMEOUT });

    await expect.poll(async () => {
      const snapshot = await gameSnapshot(request, setup.playerA.token, setup.gameId);
      const vote = disconnectVoteFor(snapshot, setup.playerB.user.id);
      return vote?.status === 'open'
        && vote.targetPlayerId === setup.playerB.user.id
        && typeof vote.openedAt === 'string'
        && vote.openedAt.trim() !== ''
        && vote.openedAt !== firstOpenedAt;
    }, { timeout: LONG_TIMEOUT }).toBe(true);

    await expect(voteHeading).toBeVisible({ timeout: SHORT_TIMEOUT });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

interface SnapshotPayload {
  game: {
    snapshot: {
      players: Record<string, { status: string }>;
      disconnectVotes?: Record<string, DisconnectVoteSnapshot>;
    };
  };
}

interface DisconnectVoteSnapshot {
  targetPlayerId?: string | null;
  status?: string | null;
  openedAt?: string | null;
}

async function gameSnapshot(request: APIRequestContext, token: string, gameId: string): Promise<SnapshotPayload> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();

  return (await response.json()) as SnapshotPayload;
}

async function snapshotPlayerStatus(
  request: APIRequestContext,
  token: string,
  gameId: string,
  playerId: string,
): Promise<string | null> {
  const payload = await gameSnapshot(request, token, gameId);

  return payload.game.snapshot.players[playerId]?.status ?? null;
}

function disconnectVoteFor(snapshot: SnapshotPayload, targetPlayerId: string): DisconnectVoteSnapshot | null {
  return snapshot.game.snapshot.disconnectVotes?.[targetPlayerId] ?? null;
}

async function roomPlayerIds(request: APIRequestContext, token: string, roomId: string): Promise<string[]> {
  const response = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { room: { players: Array<{ user: { id: string } }> } };

  return payload.room.players
    .map((entry) => entry.user.id)
    .filter((playerId): playerId is string => typeof playerId === 'string' && playerId.trim() !== '');
}

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

function collectWebSocketFrames(page: Page): Array<Record<string, unknown>> {
  const frames: Array<Record<string, unknown>> = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => {
      try {
        const payload = JSON.parse(typeof event.payload === 'string' ? event.payload : event.payload.toString('utf8')) as unknown;
        if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
          frames.push(payload as Record<string, unknown>);
        }
      } catch {
        // Ignore non-JSON heartbeat frames.
      }
    });
  });
  return frames;
}

async function waitForGameplayConnection(frames: Array<Record<string, unknown>>): Promise<void> {
  await expect.poll(() => frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), {
    timeout: SHORT_TIMEOUT,
  }).toBe(true);
}
