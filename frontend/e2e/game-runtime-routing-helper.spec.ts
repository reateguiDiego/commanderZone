import { expect, test, type APIRequestContext } from '@playwright/test';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL =
  process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

test('shared E2E mulligan setup resolves to playing through runtime websocket', async ({
  request,
}) => {
  test.setTimeout(120_000);
  await assertGameRuntimeReady(request);
  const setup = await createCommanderGameWithBasicDecks(request, {
    runId: `routing${Date.now().toString(36)}`,
    playerAPrefix: 'routing-a',
    playerBPrefix: 'routing-b',
  });

  await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);

  const response = await request.get(`${API_BASE_URL}/games/${setup.gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${setup.playerA.token}` },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { game?: { snapshot?: { gamePhase?: unknown } } };
  expect(payload.game?.snapshot?.gamePhase).toBe('PLAYING');
});

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(
      `Game runtime is not reachable at ${RUNTIME_READY_URL}; runtime routing tests must not fall back to legacy.`,
    );
  }
}
