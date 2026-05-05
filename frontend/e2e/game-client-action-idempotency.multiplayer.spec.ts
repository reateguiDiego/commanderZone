import { expect, test } from '@playwright/test';
import { createCommanderGameWithValidDecks } from './support/commander-game';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test.setTimeout(120000);

test('clientActionId repeated command is idempotent', async ({ request }) => {
  const setup = await createCommanderGameWithValidDecks(request, {
    playerAPrefix: 'idem-a',
    playerBPrefix: 'idem-b',
    roomVisibility: 'public',
  });

  const { gameId, playerA } = setup;
  const clientActionId = `idem-draw-${Date.now()}`;

  const first = await request.post(`${API_BASE_URL}/games/${gameId}/commands`, {
    headers: {
      Authorization: `Bearer ${playerA.token}`,
    },
    data: {
      type: 'library.draw',
      payload: {
        playerId: playerA.user.id,
      },
      clientActionId,
    },
  });
  expect(first.ok()).toBeTruthy();
  const firstPayload = (await first.json()) as {
    applied: boolean;
    snapshot: {
      players: Record<string, { zoneCounts: { hand: number } }>;
    };
  };
  expect(firstPayload.applied).toBe(true);

  const second = await request.post(`${API_BASE_URL}/games/${gameId}/commands`, {
    headers: {
      Authorization: `Bearer ${playerA.token}`,
    },
    data: {
      type: 'library.draw',
      payload: {
        playerId: playerA.user.id,
      },
      clientActionId,
    },
  });
  expect(second.ok()).toBeTruthy();
  const secondPayload = (await second.json()) as {
    applied: boolean;
    snapshot: {
      players: Record<string, { zoneCounts: { hand: number } }>;
    };
  };
  expect(secondPayload.applied).toBe(false);
  expect(secondPayload.snapshot.players[playerA.user.id]?.zoneCounts.hand).toBe(
    firstPayload.snapshot.players[playerA.user.id]?.zoneCounts.hand,
  );
});
