import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { sendRuntimeCommand, type RuntimeWebSocketCommandResult } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
const WEBSOCKET_READY_URL = process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz';

type JsonObject = Record<string, unknown>;
type ContinuityPlayer = {
  token: string;
  refreshToken: string;
  user: RealUserSession['user'];
  credentials: RealUserSession['credentials'];
  deck: BasicCommanderDeckFromDatabaseResult;
};
type ContinuitySetup = { gameId: string; roomId: string; players: ContinuityPlayer[] };

test.describe('product turn runtime continuity gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: ContinuitySetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertServiceReady(request, RUNTIME_READY_URL, 'game-runtime');
    setup = await createThreePlayerGame(request, `turn${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
  });

  test('turns remain live after long runtime sequence and one player concedes', async ({ browser, request, baseURL }) => {
    test.setTimeout(300_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const [playerA, playerB, playerC] = setup.players;
    if (!playerA || !playerB || !playerC) {
      throw new Error('Turn runtime continuity gate requires exactly 3 players.');
    }

    const { gameId } = setup;
    const requestAudit = { bootstrap: 0, snapshot: 0, fallbackCommands: [] as string[] };
    const commandFrames: JsonObject[] = [];
    let snapshot = await gameSnapshot(request, gameId, playerA.token);
    let baseVersion = Math.max(1, Number(snapshot['version'] ?? 1));
    let activePlayerId = currentActivePlayerId(snapshot, playerA.user.id);
    let turnNumber = Math.max(1, Number((snapshot['turn'] as JsonObject | undefined)?.['number'] ?? 1));
    const playersById = new Map(setup.players.map((player) => [player.user.id, player]));
    const turnOrder = [playerA.user.id, playerB.user.id, playerC.user.id];
    const snapshotC = await gameSnapshot(request, gameId, playerC.token);
    const initialHandA = zoneInstanceIds(snapshot, playerA.user.id, 'hand');
    const initialHandC = zoneInstanceIds(snapshotC, playerC.user.id, 'hand');
    if (initialHandA.length < 3 || initialHandC.length < 2) {
      throw new Error(`Expected enough hand cards for runtime continuity. A=${initialHandA.length} C=${initialHandC.length}`);
    }
    const [aPermanent, aSecondMove, aThirdMove] = initialHandA;
    const [cPermanent, cSecondMove] = initialHandC;

    const contexts = await Promise.all([playerA, playerB, playerC].map((player) =>
      browser.newContext({ baseURL, storageState: authStorageState(baseURL, player.user, player.refreshToken) }),
    ));
    await Promise.all(contexts.map(enableFrontendGameplayV2));

    try {
      const [pageA, pageB, pageC] = await Promise.all(contexts.map((context) => context.newPage()));
      const framesA = collectWebSocketFrames(pageA);
      const framesB = collectWebSocketFrames(pageB);
      const framesC = collectWebSocketFrames(pageC);
      for (const page of [pageA, pageB, pageC]) {
        auditBootstrapRequests(page, gameId, requestAudit);
      }

      await Promise.all([
        pageA.goto(`/games/${gameId}`),
        pageB.goto(`/games/${gameId}`),
        pageC.goto(`/games/${gameId}`),
      ]);
      await Promise.all([
        expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageC.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
      ]);
      await Promise.all([waitForGameplayConnection(framesA), waitForGameplayConnection(framesB), waitForGameplayConnection(framesC)]);
      const liveRequestBaseline = requestAudit.bootstrap + requestAudit.snapshot;

      for (let index = 0; index < 9; index += 1) {
        const active = playerById(playersById, activePlayerId);
        baseVersion = await applyRuntime(request, commandFrames, {
          gameId,
          token: active.token,
          baseVersion,
          type: 'turn.changed',
          payload: { phase: phaseFor(index) },
        });

        if (index === 0) {
          baseVersion = await applyRuntime(request, commandFrames, {
            gameId,
            token: playerA.token,
            baseVersion,
            type: 'library.draw',
            payload: { playerId: playerA.user.id },
          });
        } else if (index === 1) {
          baseVersion = await applyRuntime(request, commandFrames, {
            gameId,
            token: playerA.token,
            baseVersion,
            type: 'card.moved',
            payload: {
              playerId: playerA.user.id,
              fromZone: 'hand',
              toZone: 'battlefield',
              instanceId: aPermanent,
              position: { x: 0.31, y: 0.57, unit: 'ratio' },
            },
          });
        } else if (index === 2) {
          baseVersion = await applyRuntime(request, commandFrames, {
            gameId,
            token: playerA.token,
            baseVersion,
            type: 'card.tapped',
            payload: { playerId: playerA.user.id, instanceId: aPermanent, tapped: true },
          });
        } else if (index === 3) {
          baseVersion = await applyRuntime(request, commandFrames, {
            gameId,
            token: playerA.token,
            baseVersion,
            type: 'card.counter.changed',
            payload: { playerId: playerA.user.id, instanceId: aPermanent, counter: '+1/+1', value: 1 },
          });
        } else if (index === 4) {
          baseVersion = await applyRuntime(request, commandFrames, {
            gameId,
            token: playerC.token,
            baseVersion,
            type: 'library.draw',
            payload: { playerId: playerC.user.id },
          });
        } else if (index === 5) {
          baseVersion = await applyRuntime(request, commandFrames, {
            gameId,
            token: playerC.token,
            baseVersion,
            type: 'card.moved',
            payload: {
              playerId: playerC.user.id,
              fromZone: 'hand',
              toZone: 'battlefield',
              instanceId: cPermanent,
              position: { x: 0.42, y: 0.63, unit: 'ratio' },
            },
          });
        }

        const nextPlayerId = nextTurnPlayer(turnOrder, activePlayerId);
        if (nextPlayerId === turnOrder[0]) {
          turnNumber += 1;
        }
        baseVersion = await applyRuntime(request, commandFrames, {
          gameId,
          token: active.token,
          baseVersion,
          type: 'turn.changed',
          payload: { activePlayerId: nextPlayerId, phase: 'untap', number: turnNumber },
        });
        activePlayerId = nextPlayerId;
      }

      expect(requestAudit.bootstrap + requestAudit.snapshot).toBe(liveRequestBaseline);

      const beforeRefreshRequests = requestAudit.bootstrap + requestAudit.snapshot;
      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(framesA);
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBeGreaterThan(beforeRefreshRequests);

      const reconnectStorageState = await contexts[2]!.storageState();
      const reconnectContext = await browser.newContext({
        baseURL,
        storageState: reconnectStorageState,
      });
      await enableFrontendGameplayV2(reconnectContext);
      const reconnectPage = await reconnectContext.newPage();
      const reconnectFrames = collectWebSocketFrames(reconnectPage);
      auditBootstrapRequests(reconnectPage, gameId, requestAudit);
      await reconnectPage.goto(`/games/${gameId}`);
      await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(reconnectFrames);
      await reconnectContext.close();
      const explicitReconnectRequestCount = requestAudit.bootstrap + requestAudit.snapshot;

      if (activePlayerId !== playerA.user.id) {
        const active = playerById(playersById, activePlayerId);
        baseVersion = await applyRuntime(request, commandFrames, {
          gameId,
          token: active.token,
          baseVersion,
          type: 'turn.changed',
          payload: { activePlayerId: playerA.user.id, phase: 'main-1', number: turnNumber },
        });
        activePlayerId = playerA.user.id;
      }

      const postRefreshPhase = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'turn.changed',
        payload: { phase: 'combat' },
      });
      baseVersion = postRefreshPhase;

      const concedeOutcome = await sendRuntimeCommand(request, {
        gameId,
        token: playerB.token,
        baseVersion,
        type: 'game.concede',
        payload: { playerId: playerB.user.id },
      });
      commandFrames.push(...concedeOutcome.frames);
      expect(concedeOutcome.patch['kind']).toBe('patch.v2');
      expect(hasOp(concedeOutcome.patch, 'player.status.set')).toBe(true);
      baseVersion = concedeOutcome.version;

      snapshot = await gameSnapshot(request, gameId, playerA.token);
      expect(playerStatus(snapshot, playerB.user.id)).toBe('conceded');
      expect(snapshot['gamePhase']).not.toBe('FINISHED');

      const duplicateConcede = await sendRuntimeCommand(request, {
        gameId,
        token: playerB.token,
        baseVersion,
        type: 'game.concede',
        payload: { playerId: playerB.user.id },
      });
      commandFrames.push(...duplicateConcede.frames);
      expect(duplicateConcede.patch['kind']).toBe('patch.v2');
      expect(hasOp(duplicateConcede.patch, 'player.status.set')).toBe(true);
      expect(duplicateConcede.version).toBe(baseVersion);

      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'library.draw',
        payload: { playerId: playerA.user.id },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.tapped',
        payload: { playerId: playerA.user.id, instanceId: aPermanent, tapped: false },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: aSecondMove,
          position: { x: 0.51, y: 0.57, unit: 'ratio' },
        },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'turn.changed',
        payload: { activePlayerId: playerC.user.id, phase: 'untap', number: turnNumber },
      });
      activePlayerId = playerC.user.id;

      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerC.token,
        baseVersion,
        type: 'turn.changed',
        payload: { phase: 'combat' },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerC.token,
        baseVersion,
        type: 'library.draw',
        payload: { playerId: playerC.user.id },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerC.token,
        baseVersion,
        type: 'card.tapped',
        payload: { playerId: playerC.user.id, instanceId: cPermanent, tapped: true },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerC.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerC.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: cSecondMove,
          position: { x: 0.56, y: 0.63, unit: 'ratio' },
        },
      });

      snapshot = await gameSnapshot(request, gameId, playerA.token);
      expect(playerStatus(snapshot, playerB.user.id)).toBe('conceded');
      expect(snapshot['gamePhase']).not.toBe('FINISHED');
      expect(currentActivePlayerId(snapshot, '')).toBe(activePlayerId);
      expect(zoneInstanceIds(snapshot, playerA.user.id, 'battlefield')).toContain(aPermanent);
      expect(zoneInstanceIds(snapshot, playerA.user.id, 'battlefield')).toContain(aSecondMove);
      expect(zoneInstanceIds(snapshot, playerC.user.id, 'battlefield')).toContain(cPermanent);
      expect(zoneInstanceIds(snapshot, playerC.user.id, 'battlefield')).toContain(cSecondMove);
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBe(explicitReconnectRequestCount);

      await assertServiceReady(request, RUNTIME_READY_URL, 'game-runtime');
      await assertServiceReady(request, WEBSOCKET_READY_URL, 'websocket');

      expect(requestAudit.fallbackCommands).toEqual([]);
      for (const frames of [framesA, framesB, framesC, reconnectFrames, commandFrames]) {
        assertNoRuntimeFallbackFrames(frames);
      }
      void aThirdMove;
      void baseVersion;
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<ContinuitySetup> {
  const players: ContinuityPlayer[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `trc-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `TRC${index + 1} ${runId.slice(-10)}`,
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
      name: `Turn Runtime ${runId.slice(-10)}`,
      format: 'commander',
      maxPlayers: 3,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create turn runtime room');
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
  await expectApiOk(response, 'join turn runtime room');
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokens[0]}` },
    });
    await expectApiOk(roomResponse, 'load turn runtime room turn order');
    const payload = await roomResponse.json() as { room?: { players?: Array<{ turnRolls?: number[] }> } };
    if (turnOrderResolved(payload.room?.players ?? [])) {
      return;
    }
    for (const token of tokens) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok() && response.status() !== 409) {
        await expectApiOk(response, 'roll turn runtime turn order');
      }
    }
  }
  throw new Error('Unable to resolve turn runtime room turn order.');
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'start turn runtime room');
  const payload = await response.json() as { game?: { id?: string } };
  if (!payload.game?.id) {
    throw new Error('Room start did not return game.id.');
  }
  return payload.game.id;
}

async function applyRuntime(
  request: APIRequestContext,
  frames: JsonObject[],
  options: Parameters<typeof sendRuntimeCommand>[1],
): Promise<number> {
  const result: RuntimeWebSocketCommandResult = await sendRuntimeCommand(request, options);
  frames.push(...result.frames);
  expect(result.patch['kind']).toBe('patch.v2');
  return result.version;
}

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'load game snapshot');
  const payload = await response.json() as { game?: { snapshot?: JsonObject } };
  return payload.game?.snapshot ?? {};
}

function currentActivePlayerId(snapshot: JsonObject, fallback: string): string {
  const turn = snapshot['turn'] as JsonObject | undefined;
  const activePlayerId = typeof turn?.['activePlayerId'] === 'string' ? turn['activePlayerId'] : '';
  return activePlayerId || fallback;
}

function playerStatus(snapshot: JsonObject, playerId: string): string {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  return String(players?.[playerId]?.['status'] ?? 'active');
}

function zoneInstanceIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return (zones?.[zone] ?? []).map((card) => String(card['instanceId'] ?? '')).filter((id) => id !== '');
}

function playerById(playersById: Map<string, ContinuityPlayer>, playerId: string): ContinuityPlayer {
  const player = playersById.get(playerId);
  if (!player) {
    throw new Error(`Missing player ${playerId}.`);
  }
  return player;
}

function nextTurnPlayer(turnOrder: readonly string[], activePlayerId: string): string {
  const index = turnOrder.indexOf(activePlayerId);
  return turnOrder[(index >= 0 ? index + 1 : 0) % turnOrder.length] ?? turnOrder[0]!;
}

function phaseFor(index: number): string {
  const phases = ['upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'];
  return phases[index % phases.length] ?? 'main-1';
}

function hasOp(message: JsonObject, op: string): boolean {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.some((item) => item['op'] === op);
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

function auditBootstrapRequests(page: Page, gameId: string, audit: { bootstrap: number; snapshot: number; fallbackCommands: string[] }): void {
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'POST' && /\/games\/[^/]+\/commands$/.test(url)) {
      audit.fallbackCommands.push(url);
    }
    if (request.method() === 'GET' && url.includes(`/games/${gameId}/bootstrap`)) {
      audit.bootstrap += 1;
    }
    if (request.method() === 'GET' && url.includes(`/games/${gameId}/snapshot`)) {
      audit.snapshot += 1;
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
