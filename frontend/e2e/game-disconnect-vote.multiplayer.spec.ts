import { expect, test, type APIRequestContext } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const SHORT_TIMEOUT = 20_000;

test.setTimeout(540_000);

test('disconnect vote expel concedes while retaining the player room projection', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    playerAPrefix: 'dv-expel-a',
    playerBPrefix: 'dv-expel-b',
    roomVisibility: 'public',
  });

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerA.user, setup.playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerB.user, setup.playerB.refreshToken),
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([
      pageA.goto(`/games/${setup.gameId}`),
      pageB.goto(`/games/${setup.gameId}`),
    ]);

    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();

    await pageB.close();

    const voteHeading = pageA.getByRole('heading', { name: 'Jugador desconectado' });
    await expect(voteHeading).toBeVisible({ timeout: SHORT_TIMEOUT });
    const voteModal = pageA.locator('.modal-panel').filter({ has: voteHeading });
    await voteModal.getByRole('button', { name: 'Expulsar', exact: true }).click();

    await expect.poll(
      () => snapshotPlayerStatus(request, setup.playerA.token, setup.gameId, setup.playerB.user.id),
      { timeout: SHORT_TIMEOUT },
    ).toBe('conceded');

    await expect.poll(
      async () => (await roomPlayerIds(request, setup.playerA.token, setup.roomId)).includes(setup.playerB.user.id),
      { timeout: SHORT_TIMEOUT },
    ).toBe(true);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('disconnect vote times out to wait and persists a target cooldown', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    playerAPrefix: 'dv-timeout-a',
    playerBPrefix: 'dv-timeout-b',
    roomVisibility: 'public',
  });

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerA.user, setup.playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerB.user, setup.playerB.refreshToken),
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([
      pageA.goto(`/games/${setup.gameId}`),
      pageB.goto(`/games/${setup.gameId}`),
    ]);

    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();

    await pageB.close();

    const voteHeading = pageA.getByRole('heading', { name: 'Jugador desconectado' });
    await expect(voteHeading).toBeVisible({ timeout: SHORT_TIMEOUT });

    let firstOpenedAt: string | null = null;
    await expect.poll(async () => {
      const snapshot = await gameSnapshot(request, setup.playerA.token, setup.gameId);
      firstOpenedAt = snapshot.game.snapshot.disconnectVote?.openedAt ?? null;

      return firstOpenedAt;
    }, { timeout: SHORT_TIMEOUT }).not.toBeNull();
    if (!firstOpenedAt) {
      throw new Error('Expected disconnect vote openedAt timestamp.');
    }

    await expect.poll(async () => {
      const snapshot = await gameSnapshot(request, setup.playerA.token, setup.gameId);
      return {
        voteStatus: snapshot.game.snapshot.disconnectVote?.status ?? null,
        playerStatus: snapshot.game.snapshot.players[setup.playerB.user.id]?.status ?? null,
      };
    }, { timeout: 120_000 }).toEqual({
      voteStatus: 'expired',
      playerStatus: 'active',
    });

    await expect(voteHeading).toBeHidden({ timeout: SHORT_TIMEOUT });

    const expired = await gameSnapshot(request, setup.playerA.token, setup.gameId);
    expect(expired.game.snapshot.disconnectVote?.cooldownUntil).toMatch(/T/);
    expect(expired.game.snapshot.disconnectVote?.openedAt).toBe(firstOpenedAt);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

interface SnapshotPayload {
  game: {
    snapshot: {
      players: Record<string, { status: string }>;
      disconnectVote?: {
        targetPlayerId?: string | null;
        status?: string | null;
        openedAt?: string | null;
        cooldownUntil?: string | null;
      } | null;
    };
  };
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
