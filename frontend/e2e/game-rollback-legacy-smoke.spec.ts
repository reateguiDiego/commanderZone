import { expect, test, type APIRequestContext } from '@playwright/test';
import { createCommanderGameWithBasicDecks } from './support/commander-game';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

type JsonObject = Record<string, unknown>;

test('runtime-off rollback accepts legacy HTTP gameplay commands', async ({ request }) => {
  test.setTimeout(120_000);

  const setup = await createCommanderGameWithBasicDecks(request, {
    runId: `rollback${Date.now().toString(36)}`,
    playerAPrefix: 'rollback-a',
    playerBPrefix: 'rollback-b',
    roomVisibility: 'public',
  });

  await postLegacyCommand(request, setup.gameId, setup.playerA.token, {
    type: 'mulligan.keep',
    clientActionId: `rollback-keep-a-${Date.now()}`,
    payload: {},
  });
  await postLegacyCommand(request, setup.gameId, setup.playerB.token, {
    type: 'mulligan.keep',
    clientActionId: `rollback-keep-b-${Date.now()}`,
    payload: {},
  });

  const before = await gameSnapshot(request, setup.gameId, setup.playerA.token);
  expect(before['gamePhase']).toBe('PLAYING');
  const lifeBefore = playerLife(before, setup.playerA.user.id);

  const lifeCommand = await postLegacyCommand(request, setup.gameId, setup.playerA.token, {
    type: 'life.changed',
    clientActionId: `rollback-life-${Date.now()}`,
    payload: {
      playerId: setup.playerA.user.id,
      delta: -1,
    },
  });

  expect(lifeCommand['applied']).toBe(true);
  expect(lifeCommand['snapshot']).toBeTruthy();
  expect(lifeCommand['event']).toMatchObject({ type: 'life.changed' });

  const after = await gameSnapshot(request, setup.gameId, setup.playerA.token);
  expect(playerLife(after, setup.playerA.user.id)).toBe(lifeBefore - 1);
});

async function postLegacyCommand(
  request: APIRequestContext,
  gameId: string,
  token: string,
  command: { type: string; clientActionId: string; payload: JsonObject },
): Promise<JsonObject> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/commands`, {
    headers: { Authorization: `Bearer ${token}` },
    data: command,
  });
  if (!response.ok()) {
    throw new Error(
      `Legacy command ${command.type} failed with HTTP ${response.status()}: ${await response.text()}`,
    );
  }

  return (await response.json()) as JsonObject;
}

async function gameSnapshot(
  request: APIRequestContext,
  gameId: string,
  token: string,
): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { game?: { snapshot?: JsonObject } };

  return payload.game?.snapshot ?? {};
}

function playerLife(snapshot: JsonObject, playerId: string): number {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const life = Number(players?.[playerId]?.['life']);
  if (!Number.isFinite(life)) {
    throw new Error(`Snapshot does not include numeric life for ${playerId}.`);
  }

  return life;
}
