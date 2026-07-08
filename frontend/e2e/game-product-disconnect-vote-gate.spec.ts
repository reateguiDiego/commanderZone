import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const API_HEALTH_URL = process.env['E2E_API_HEALTH_URL'] ?? `${API_BASE_URL}/healthz`;
const API_READY_URL = process.env['E2E_API_READY_URL'] ?? `${API_BASE_URL}/readyz`;
const RUNTIME_HEALTH_URL = process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
const RUNTIME_METRICS_URL = process.env['E2E_GAME_RUNTIME_METRICS_URL'] ?? 'http://127.0.0.1:8091/metrics';
const WEBSOCKET_HEALTH_URL = process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz';
const WEBSOCKET_READY_URL = process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz';
const DISCONNECTED_HEADING = /Jugador desconectado|Player disconnected/i;
const EXPEL_BUTTON = /Expulsar|Expel/i;

type JsonObject = Record<string, unknown>;
type DisconnectGatePlayer = {
  token: string;
  refreshToken: string;
  user: RealUserSession['user'];
  credentials: RealUserSession['credentials'];
  deck: BasicCommanderDeckFromDatabaseResult;
};
type DisconnectGateSetup = { gameId: string; roomId: string; players: DisconnectGatePlayer[] };

test.describe('product disconnect vote gate', () => {
  test('runtime presence opens and resolves disconnect vote without fallback or refetch', async ({ browser, request, baseURL }) => {
    test.setTimeout(240_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    await Promise.all([
      assertServiceReady(request, API_HEALTH_URL, 'api healthz'),
      assertServiceReady(request, API_READY_URL, 'api readyz'),
      assertServiceReady(request, WEBSOCKET_HEALTH_URL, 'websocket healthz'),
      assertServiceReady(request, WEBSOCKET_READY_URL, 'websocket readyz'),
      assertServiceReady(request, RUNTIME_HEALTH_URL, 'game-runtime healthz'),
      assertServiceReady(request, RUNTIME_READY_URL, 'game-runtime readyz'),
    ]);

    const setup = await createThreePlayerGame(request, `dcv${Date.now().toString(36)}`);
    const [playerA, playerB, playerC] = setup.players;
    if (!playerA || !playerB || !playerC) {
      throw new Error('Disconnect vote gate requires exactly 3 players.');
    }
    await resolveGameToPlaying(request, setup.gameId, setup.players);

    const contexts = await Promise.all([playerA, playerB, playerC].map((player) =>
      browser.newContext({ baseURL, storageState: authStorageState(baseURL, player.user, player.refreshToken) }),
    ));
    await Promise.all(contexts.map(enableFrontendGameplayV2));

    const requestAudit = { bootstrap: 0, snapshot: 0, disconnectVoteHttpFallback: 0 };
    try {
      const [pageA, pageB, pageC] = await Promise.all(contexts.map((context) => context.newPage()));
      const framesA = collectWebSocketFrames(pageA);
      const framesB = collectWebSocketFrames(pageB);
      const framesC = collectWebSocketFrames(pageC);
      for (const page of [pageA, pageC]) {
        auditUnexpectedRequests(page, setup.gameId, requestAudit);
      }

      await Promise.all([
        pageA.goto(`/games/${setup.gameId}`),
        pageB.goto(`/games/${setup.gameId}`),
        pageC.goto(`/games/${setup.gameId}`),
      ]);
      await Promise.all([
        expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageC.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        waitForGameplayConnection(framesA),
        waitForGameplayConnection(framesB),
        waitForGameplayConnection(framesC),
      ]);

      const refetchBaseline = requestAudit.bootstrap + requestAudit.snapshot;
      const disconnectBaseline = await runtimeDisconnects(request);
      const playerBReconnectStorageState = await contexts[1]!.storageState();

      await contexts[1]!.close();
      await expectDisconnectedModal(pageA);
      await expectDisconnectedModal(pageC);
      await expect.poll(async () => runtimeDisconnects(request), { timeout: 30_000 }).toBeGreaterThan(disconnectBaseline);
      await waitForPresence(framesA, playerB.user.id, 'offline');
      await waitForDisconnectVoteStatus(framesA, playerB.user.id, 'open');
      const firstOpenCount = disconnectVoteStatusCount(framesA, playerB.user.id, 'open');

      const reconnectContext = await browser.newContext({
        baseURL,
        storageState: playerBReconnectStorageState,
      });
      await enableFrontendGameplayV2(reconnectContext);
      try {
        const reconnectPage = await reconnectContext.newPage();
        const reconnectFrames = collectWebSocketFrames(reconnectPage);
        await reconnectPage.goto(`/games/${setup.gameId}`);
        await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
        await waitForGameplayConnection(reconnectFrames);
        await waitForPresence(framesA, playerB.user.id, 'online');
        await waitForDisconnectVoteStatus(framesA, playerB.user.id, 'cancelled');
        await expect(pageA.getByRole('heading', { name: DISCONNECTED_HEADING })).toBeHidden({ timeout: 30_000 });
      } finally {
        await reconnectContext.close().catch(() => undefined);
      }

      await expectDisconnectedModal(pageA);
      await expectDisconnectedModal(pageC);
      await expect.poll(() => disconnectVoteStatusCount(framesA, playerB.user.id, 'open'), { timeout: 30_000 }).toBeGreaterThan(firstOpenCount);

      await disconnectVoteModal(pageA).getByRole('button', { name: EXPEL_BUTTON }).click();
      await waitForDisconnectVoteVote(framesA, playerB.user.id, playerA.user.id, 'expel');

      await disconnectVoteModal(pageC).getByRole('button', { name: EXPEL_BUTTON }).click();
      const resolvedPatch = await waitForPatchV2(framesA, (patch) =>
        hasOp(patch, 'disconnect.vote.set')
        && hasOp(patch, 'player.status.set')
        && disconnectVoteStatus(patch, playerB.user.id) === 'resolved_expel',
      );
      expect(JSON.stringify(resolvedPatch)).toContain(playerB.user.id);

      expect(requestAudit.bootstrap + requestAudit.snapshot).toBe(refetchBaseline);
      expect(requestAudit.disconnectVoteHttpFallback).toBe(0);
      for (const frames of [framesA, framesB, framesC]) {
        assertNoRuntimeFallbackFrames(frames);
      }

      await Promise.all([
        assertServiceReady(request, WEBSOCKET_READY_URL, 'websocket readyz final'),
        assertServiceReady(request, RUNTIME_READY_URL, 'game-runtime readyz final'),
      ]);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<DisconnectGateSetup> {
  const players: DisconnectGatePlayer[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `dcv-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `DCV${index + 1} ${runId.slice(-10)}`,
    });
    players.push({
      token: session.token,
      refreshToken: session.refreshToken,
      user: session.user,
      credentials: session.credentials,
      deck,
    });
  }

  const roomId = await createRoom(request, players[0]!.token, players[0]!.deck.deckId, runId);
  for (const player of players.slice(1)) {
    await joinRoom(request, player.token, roomId, player.deck.deckId);
  }
  await resolveTurnOrder(request, roomId, players.map((player) => player.token));
  const gameId = await startRoom(request, players[0]!.token, roomId);

  return { gameId, roomId, players };
}

async function createRoom(request: APIRequestContext, token: string, deckId: string, runId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      deckId,
      visibility: 'public',
      name: `Disconnect Vote ${runId.slice(-10)}`,
      format: 'commander',
      maxPlayers: 3,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create disconnect vote room');
  const payload = await response.json() as { room?: { id?: string } };
  if (!payload.room?.id) {
    throw new Error('Room creation did not return room.id.');
  }
  return payload.room.id;
}

async function joinRoom(request: APIRequestContext, token: string, roomId: string, deckId: string): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { deckId },
  });
  await expectApiOk(response, 'join disconnect vote room');
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokens[0]}` },
    });
    await expectApiOk(roomResponse, 'load disconnect vote room turn order');
    const payload = await roomResponse.json() as { room?: { players?: Array<{ turnRolls?: number[] }> } };
    if (turnOrderResolved(payload.room?.players ?? [])) {
      return;
    }
    for (const token of tokens) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok() && response.status() !== 409) {
        await expectApiOk(response, 'roll disconnect vote turn order');
      }
    }
  }
  throw new Error('Unable to resolve disconnect vote room turn order.');
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'start disconnect vote room');
  const payload = await response.json() as { game?: { id?: string } };
  if (!payload.game?.id) {
    throw new Error('Room start did not return game.id.');
  }
  return payload.game.id;
}

async function expectDisconnectedModal(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: DISCONNECTED_HEADING })).toBeVisible({ timeout: 30_000 });
}

function disconnectVoteModal(page: Page) {
  const heading = page.getByRole('heading', { name: DISCONNECTED_HEADING });
  return page.locator('.modal-panel').filter({ has: heading });
}

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

function collectWebSocketFrames(page: Page): JsonObject[] {
  const frames: JsonObject[] = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) {
        frames.push(parsed);
      }
    });
  });
  return frames;
}

function waitForGameplayConnection(frames: JsonObject[]): Promise<void> {
  return expect.poll(() => frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), {
    timeout: 30_000,
  }).toBe(true);
}

async function waitForPresence(frames: JsonObject[], playerId: string, status: string): Promise<void> {
  await expect.poll(() => frames.some((frame) =>
    frame['kind'] === 'player_presence_changed'
    && frame['playerId'] === playerId
    && frame['status'] === status,
  ), { timeout: 30_000 }).toBe(true);
}

async function waitForPatchV2(frames: JsonObject[], predicate: (patch: JsonObject) => boolean): Promise<JsonObject> {
  await expect.poll(() => frames.some((message) => message['kind'] === 'patch.v2' && predicate(message)), { timeout: 30_000 }).toBe(true);
  const patch = frames.find((message) => message['kind'] === 'patch.v2' && predicate(message));
  if (!patch) {
    throw new Error(`patch.v2 frame was not captured. Recent frames: ${JSON.stringify(frames.slice(-5), null, 2)}`);
  }
  return patch;
}

async function waitForDisconnectVoteStatus(frames: JsonObject[], targetPlayerId: string, status: string): Promise<void> {
  await waitForPatchV2(frames, (patch) => disconnectVoteStatus(patch, targetPlayerId) === status);
}

async function waitForDisconnectVoteVote(
  frames: JsonObject[],
  targetPlayerId: string,
  voterPlayerId: string,
  vote: string,
): Promise<void> {
  await waitForPatchV2(frames, (patch) => {
    const state = disconnectVoteFromPatch(patch, targetPlayerId);
    const votes = state?.['votes'] as Record<string, JsonObject> | undefined;
    return votes?.[voterPlayerId]?.['vote'] === vote;
  });
}

function disconnectVoteStatusCount(frames: JsonObject[], targetPlayerId: string, status: string): number {
  return frames.filter((frame) =>
    frame['kind'] === 'patch.v2'
    && disconnectVoteStatus(frame, targetPlayerId) === status,
  ).length;
}

function disconnectVoteStatus(patch: JsonObject, targetPlayerId: string): string | null {
  const state = disconnectVoteFromPatch(patch, targetPlayerId);
  return typeof state?.['status'] === 'string' ? state['status'] : null;
}

function disconnectVoteFromPatch(patch: JsonObject, targetPlayerId: string): JsonObject | null {
  const ops = Array.isArray(patch['ops']) ? patch['ops'] as JsonObject[] : [];
  for (const op of ops) {
    if (op['op'] !== 'disconnect.vote.set') {
      continue;
    }
    const state = op['disconnectVote'] as JsonObject | undefined;
    if (state?.['targetPlayerId'] === targetPlayerId) {
      return state;
    }
  }
  return null;
}

function hasOp(message: JsonObject, op: string): boolean {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.some((item) => item['op'] === op);
}

function auditUnexpectedRequests(page: Page, gameId: string, audit: { bootstrap: number; snapshot: number; disconnectVoteHttpFallback: number }): void {
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'GET' && url.includes(`/games/${gameId}/bootstrap`)) {
      audit.bootstrap += 1;
    }
    if (request.method() === 'GET' && url.includes(`/games/${gameId}/snapshot`)) {
      audit.snapshot += 1;
    }
    if (request.method() === 'POST' && url.includes(`/games/${gameId}/disconnect-vote`)) {
      audit.disconnectVoteHttpFallback += 1;
    }
  });
}

function assertNoRuntimeFallbackFrames(frames: JsonObject[]): void {
  expect(frames.some((message) => message['kind'] === 'game_patch')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'command_failed' || message['status'] === 'rejected')).toBe(false);
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  try {
    const text = typeof payload === 'string' ? payload : payload.toString('utf8');
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

function turnOrderResolved(players: Array<{ turnRolls?: number[] }>): boolean {
  if (players.length === 0) {
    return false;
  }
  const rolls = new Set<string>();
  for (const player of players) {
    if (!Array.isArray(player.turnRolls) || player.turnRolls.length === 0) {
      return false;
    }
    const key = player.turnRolls.join('-');
    if (rolls.has(key)) {
      return false;
    }
    rolls.add(key);
  }
  return true;
}

async function runtimeDisconnects(request: APIRequestContext): Promise<number> {
  const response = await request.get(RUNTIME_METRICS_URL, { timeout: 10_000 });
  expect(response.ok()).toBe(true);
  const body = await response.json() as { gateway?: { RuntimeDisconnects?: number } };

  return Number(body.gateway?.RuntimeDisconnects ?? 0);
}

async function assertServiceReady(request: APIRequestContext, url: string, service: string): Promise<void> {
  const response = await request.get(url, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`${service} is not ready at ${url}: ${response.status()} ${await response.text()}`);
  }
}

async function expectApiOk(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) {
    return;
  }
  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
