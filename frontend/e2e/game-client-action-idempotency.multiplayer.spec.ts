import { expect, test } from '@playwright/test';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { sendRuntimeCommand } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test.setTimeout(120000);

test('clientActionId repeated command is idempotent', async ({ request }) => {
  const setup = await createCommanderGameWithBasicDecks(request, {
    playerAPrefix: 'idem-a',
    playerBPrefix: 'idem-b',
    roomVisibility: 'public',
  });

  const { gameId, playerA } = setup;
  await resolveGameToPlaying(request, gameId, [setup.playerA, setup.playerB]);
  const clientActionId = `idem-draw-${Date.now()}`;
  const baseVersion = await gameVersion(request, gameId, playerA.token);

  const first = await sendRuntimeCommand(request, {
    gameId,
    token: playerA.token,
    baseVersion,
    type: 'library.draw',
    payload: {
      playerId: playerA.user.id,
    },
    clientActionId,
  });
  const firstSnapshot = await gameSnapshot(request, gameId, playerA.token);
  const firstHandCount = firstSnapshot.players[playerA.user.id]?.zoneCounts.hand;
  if (typeof firstHandCount !== 'number') {
    throw new Error('Expected runtime draw snapshot to include player hand count.');
  }
  expect(firstHandCount).toBeGreaterThan(0);

  const second = await sendRuntimeCommand(request, {
    gameId,
    token: playerA.token,
    baseVersion,
    type: 'library.draw',
    payload: {
      playerId: playerA.user.id,
    },
    clientActionId,
  });
  const secondSnapshot = await gameSnapshot(request, gameId, playerA.token);

  expect(second.version).toBe(first.version);
  expect(secondSnapshot.players[playerA.user.id]?.zoneCounts.hand).toBe(firstHandCount);
});

async function gameVersion(
  request: import('@playwright/test').APIRequestContext,
  gameId: string,
  token: string,
): Promise<number> {
  const snapshot = await gameSnapshot(request, gameId, token);
  return Math.max(1, Number(snapshot.version ?? 1));
}

async function gameSnapshot(
  request: import('@playwright/test').APIRequestContext,
  gameId: string,
  token: string,
): Promise<{ version?: unknown; players: Record<string, { zoneCounts: { hand: number } }> }> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    game?: {
      snapshot?: {
        version?: unknown;
        players?: Record<string, { zoneCounts: { hand: number } }>;
      };
    };
  };

  return {
    version: payload.game?.snapshot?.version,
    players: payload.game?.snapshot?.players ?? {},
  };
}
