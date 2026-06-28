import { expect, test, type APIRequestContext, type APIResponse, type Browser, type Page } from '@playwright/test';
import { createRealUserSession, type RealUserSession } from './support/auth';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_BASE_URL = process.env['E2E_GAME_RUNTIME_URL'] ?? 'http://127.0.0.1:8091';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? `${RUNTIME_BASE_URL}/readyz`;
const RUNTIME_METRICS_URL = process.env['E2E_GAME_RUNTIME_METRICS_URL'] ?? `${RUNTIME_BASE_URL}/metrics`;
const STRESS_COMMAND_COUNT = Number(process.env['E2E_ACTOR_BACKPRESSURE_COMMANDS'] ?? '100');
const STRESS_DUPLICATE_COUNT = 10;

type JsonObject = Record<string, unknown>;

interface BackpressurePlayer {
  readonly token: string;
  readonly refreshToken: string;
  readonly user: RealUserSession['user'];
  readonly deck: BasicCommanderDeckFromDatabaseResult;
}

interface RuntimeCommandResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly actionId: string;
  readonly body: JsonObject;
}

interface RuntimeMetrics {
  readonly actors?: JsonObject[];
  readonly totals?: JsonObject;
}

test('actor backpressure gate serializes same-game bursts with explicit outcomes and stable metrics', async ({ browser, request }) => {
  test.setTimeout(360_000);

  await assertGameRuntimeReady(request);
  await assertBackendReady(request);

  const runId = `backpressure${Date.now().toString(36)}`;
  const fixture = await createFourPlayerGame(request, runId);
  const playerIds = fixture.players.map((player) => player.user.id);
  const actorId = playerIds[0]!;
  const instanceId = `bp-card-${runId}`;
  const initialState = runtimeInitialState(fixture.gameId, playerIds, instanceId, actorId);

  const idempotentActionId = `bp-idem-${runId}`;
  const first = await postRuntimeCommand(request, actorId, {
    initialState,
    gameId: fixture.gameId,
    baseVersion: 1,
    clientActionId: idempotentActionId,
    type: 'life.changed',
    payload: { playerId: actorId, life: 39 },
  });
  expectRuntimeSuccess(first, 'idempotency first command');
  expect(Number((first.body['event'] as JsonObject)['version'])).toBe(2);
  expectHasActorMetrics(first.body);

  const duplicate = await postRuntimeCommand(request, actorId, {
    gameId: fixture.gameId,
    baseVersion: 1,
    clientActionId: idempotentActionId,
    type: 'life.changed',
    payload: { playerId: actorId, life: 38 },
  });
  expectRuntimeSuccess(duplicate, 'idempotency duplicate command');
  expect(Number((duplicate.body['event'] as JsonObject)['version'])).toBe(2);
  expect(String((duplicate.body['event'] as JsonObject)['clientActionId'])).toBe(idempotentActionId);

  const burst = buildBurstCommands(fixture.gameId, playerIds, instanceId, runId, 2);
  const responses = await Promise.all(burst.map((command) => postRuntimeCommand(request, command.actorId, command)));
  expect(responses).toHaveLength(STRESS_COMMAND_COUNT + STRESS_DUPLICATE_COUNT);
  assertNoLegacyRuntimePayloads(responses);
  assertExplicitOutcomes(responses);
  assertSuccessfulVersionsAreMonotonic(responses);
  assertDuplicateActionIdsAreIdempotent(responses);

  const successfulVersions = responses
    .filter((response) => response.ok)
    .map((response) => Number((response.body['event'] as JsonObject)['version']))
    .filter((version) => Number.isFinite(version));
  expect(successfulVersions.length, 'stress burst must apply at least one command').toBeGreaterThan(0);

  const maxVersion = Math.max(2, ...successfulVersions);
  const followUp = await postRuntimeCommand(request, actorId, {
    gameId: fixture.gameId,
    baseVersion: maxVersion,
    clientActionId: `bp-follow-${runId}`,
    type: 'card.counter.changed',
    payload: { instanceId, counter: 'charge', value: 99 },
  });
  expectRuntimeSuccess(followUp, 'post-burst follow-up command');
  const finalVersion = Number((followUp.body['event'] as JsonObject)['version']);
  expect(finalVersion).toBeGreaterThan(maxVersion);

  await assertSequentialOrdering(request, fixture.gameId, actorId, instanceId, finalVersion, runId);

  const actorMetrics = await waitForActorMetrics(request, fixture.gameId);
  expect(Number(actorMetrics['actor.queue_depth'] ?? -1)).toBe(0);
  expect(Number(actorMetrics['actor.queue_capacity'] ?? 0)).toBeGreaterThan(0);
  const enqueuedCount = Number(actorMetrics['actor.command_enqueued_count'] ?? 0);
  const queueFullCount = Number(actorMetrics['actor.queue_full_count'] ?? 0);
  const uniqueStressVersions = new Set(successfulVersions).size;
  expect(enqueuedCount + queueFullCount).toBeGreaterThanOrEqual(2 + responses.length + 1 + 3);
  expect(Number(actorMetrics['actor.command_applied_count'] ?? 0)).toBeGreaterThanOrEqual(1 + uniqueStressVersions + 1 + 3);
  expect(Number(actorMetrics['actor.command_rejected_count'] ?? 0)).toBeGreaterThanOrEqual(responses.filter((response) => !response.ok).length);
  expect(actorMetrics['actor.queue_full_count']).not.toBeUndefined();
  expect(actorMetrics['actor.command_latency_ms']).not.toBeUndefined();
  expect(actorMetrics['actor.queue_wait_ms']).not.toBeUndefined();

  const queueFullResponses = responses.filter((response) => response.status === 409 && response.body['code'] === 'queue_full');
  for (const response of queueFullResponses) {
    expect(response.body['error']).toBeTruthy();
  }

  await assertRuntimeWebSocketHealthy(browser, request, fixture.gameId, fixture.players[0]!);
  await assertGameRuntimeReady(request);
  await assertBackendReady(request);
});

async function createFourPlayerGame(
  request: APIRequestContext,
  runId: string,
): Promise<{ gameId: string; roomId: string; players: BackpressurePlayer[] }> {
  const players: BackpressurePlayer[] = [];
  for (let index = 0; index < 4; index += 1) {
    const session = await createRealUserSession(request, `bp-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `BP${index + 1} ${runId.slice(-12)}`,
    });
    players.push({
      token: session.token,
      refreshToken: session.refreshToken,
      user: session.user,
      deck,
    });
  }

  const roomId = await createRoom(request, players[0]!.token, players[0]!.deck.deckId, runId, 4);
  for (const player of players.slice(1)) {
    await joinRoom(request, player.token, roomId, player.deck.deckId);
  }
  await resolveTurnOrder(request, roomId, players.map((player) => player.token));
  const gameId = await startRoom(request, players[0]!.token, roomId);

  return { gameId, roomId, players };
}

async function createRoom(
  request: APIRequestContext,
  token: string,
  deckId: string,
  runId: string,
  maxPlayers: number,
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      deckId,
      visibility: 'public',
      name: `Backpressure ${runId.slice(-10)}`,
      format: 'commander',
      maxPlayers,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create backpressure room');
  const payload = await response.json() as { room?: { id?: string } };
  const roomId = payload.room?.id;
  if (!roomId) {
    throw new Error('Room creation did not return room.id.');
  }
  return roomId;
}

async function joinRoom(request: APIRequestContext, token: string, roomId: string, deckId: string): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { deckId },
  });
  await expectApiOk(response, 'join backpressure room');
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokens[0]}` },
    });
    await expectApiOk(roomResponse, 'load backpressure room turn order');
    const payload = await roomResponse.json() as { room?: { players?: Array<{ turnRolls?: number[] }> } };
    if (turnOrderResolved(payload.room?.players ?? [])) {
      return;
    }

    for (const token of tokens) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok() && response.status() !== 409) {
        await expectApiOk(response, 'roll backpressure turn order');
      }
    }
  }
  throw new Error('Unable to resolve backpressure room turn order.');
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'start backpressure room');
  const payload = await response.json() as { game?: { id?: string } };
  const gameId = payload.game?.id;
  if (!gameId) {
    throw new Error('Room start did not return game.id.');
  }
  return gameId;
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

function runtimeInitialState(gameId: string, playerIds: readonly string[], instanceId: string, ownerId: string): JsonObject {
  const players: Record<string, JsonObject> = {};
  const zones: Record<string, JsonObject> = {};
  const mulliganStatus: Record<string, JsonObject> = {};
  const readyPlayers: Record<string, boolean> = {};
  for (const playerId of playerIds) {
    players[playerId] = { life: 40, counters: {}, commanderDamage: {} };
    zones[playerId] = {
      library: [],
      hand: [],
      battlefield: playerId === ownerId ? [instanceId] : [],
      graveyard: [],
      exile: [],
      command: [],
    };
    mulliganStatus[playerId] = {
      status: 'READY',
      mulliganCount: 0,
      effectiveMulligans: 0,
      currentHandSize: 7,
      cardsToBottom: 0,
      bottomPending: false,
      scryPending: false,
    };
    readyPlayers[playerId] = true;
  }

  return {
    gameId,
    version: 1,
    status: 'playing',
    phase: 'PLAYING',
    players,
    sharedCounters: {},
    turn: { activePlayerId: ownerId, phase: 'main', number: 1 },
    instances: {
      [instanceId]: {
        instanceId,
        cardKey: `backpressure-card-${gameId}`,
        ownerId,
        controllerId: ownerId,
        zone: 'battlefield',
        isCommander: false,
        isToken: false,
        tapped: false,
        rotation: 0,
        counters: {},
        mutableStats: {},
        position: { x: 0.35, y: 0.45, unit: 'ratio' },
        faceDown: false,
        activeFace: 0,
      },
    },
    zones,
    loc: {
      [instanceId]: { playerId: ownerId, zone: 'battlefield', index: 0, controllerId: ownerId },
    },
    visibility: { instanceMasks: {}, libraryEpochByOwner: {}, topRevealWindows: {} },
    relations: { attachments: {}, arrows: {}, helpers: {}, indexes: { bySource: {}, byTarget: {} } },
    stack: [],
    mulligan: {
      rule: 'LONDON',
      firstMulliganFree: true,
      playerStatus: mulliganStatus,
      readyPlayers,
      completed: true,
    },
  };
}

function buildBurstCommands(
  gameId: string,
  playerIds: readonly string[],
  instanceId: string,
  runId: string,
  baseVersion: number,
): Array<{
  actorId: string;
  gameId: string;
  baseVersion: number;
  clientActionId: string;
  type: string;
  payload: JsonObject;
}> {
  const commands = Array.from({ length: STRESS_COMMAND_COUNT }, (_, index) => {
    const playerId = playerIds[index % playerIds.length]!;
    const typeIndex = index % 3;
    const clientActionId = `bp-${runId}-${index}`;
    if (typeIndex === 0) {
      return {
        actorId: playerId,
        gameId,
        baseVersion,
        clientActionId,
        type: 'life.changed',
        payload: { playerId, delta: index % 2 === 0 ? -1 : 1 },
      };
    }
    if (typeIndex === 1) {
      return {
        actorId: playerId,
        gameId,
        baseVersion,
        clientActionId,
        type: 'card.tapped',
        payload: { instanceId, tapped: index % 4 === 1 },
      };
    }
    return {
      actorId: playerId,
      gameId,
      baseVersion,
      clientActionId,
      type: 'card.counter.changed',
      payload: { instanceId, counter: 'charge', value: (index % 7) + 1 },
    };
  });

  const duplicates = commands.slice(0, STRESS_DUPLICATE_COUNT).map((command) => ({ ...command }));
  return stableShuffle([...commands, ...duplicates], runId);
}

async function postRuntimeCommand(
  request: APIRequestContext,
  actorId: string,
  command: {
    initialState?: JsonObject;
    gameId: string;
    baseVersion: number;
    clientActionId: string;
    type: string;
    payload: JsonObject;
  },
): Promise<RuntimeCommandResponse> {
  const response = await request.post(`${RUNTIME_BASE_URL}/commands`, {
    timeout: 15_000,
    data: {
      actorId,
      initialState: command.initialState,
      command: {
        gameId: command.gameId,
        baseVersion: command.baseVersion,
        clientActionId: command.clientActionId,
        type: command.type,
        payload: command.payload,
      },
    },
  });
  const text = await response.text();
  const body = parseJsonObject(text);
  return {
    status: response.status(),
    ok: response.ok(),
    actionId: command.clientActionId,
    body,
  };
}

function expectRuntimeSuccess(response: RuntimeCommandResponse, action: string): void {
  if (response.ok) {
    return;
  }
  throw new Error(`${action} failed with HTTP ${response.status}: ${JSON.stringify(response.body)}`);
}

function assertExplicitOutcomes(responses: readonly RuntimeCommandResponse[]): void {
  for (const response of responses) {
    if (response.ok) {
      expect(response.status).toBe(200);
      expect(response.body['event']).toBeTruthy();
      continue;
    }
    expect(response.status, `unexpected non-controlled status for ${response.actionId}: ${JSON.stringify(response.body)}`).toBe(409);
    expect(['command_failed', 'queue_full']).toContain(String(response.body['code'] ?? ''));
    expect(response.body['error']).toBeTruthy();
  }
}

function assertSuccessfulVersionsAreMonotonic(responses: readonly RuntimeCommandResponse[]): void {
  const versionToActionIds = new Map<number, Set<string>>();
  for (const response of responses) {
    if (!response.ok) {
      continue;
    }
    const event = response.body['event'] as JsonObject;
    const version = Number(event['version']);
    expect(Number.isFinite(version)).toBe(true);
    const actionIds = versionToActionIds.get(version) ?? new Set<string>();
    actionIds.add(String(event['clientActionId'] ?? response.actionId));
    versionToActionIds.set(version, actionIds);
  }

  const versions = [...versionToActionIds.keys()].sort((left, right) => left - right);
  for (let index = 1; index < versions.length; index += 1) {
    expect(versions[index]!).toBeGreaterThan(versions[index - 1]!);
  }
  for (const [version, actionIds] of versionToActionIds) {
    expect(actionIds.size, `version ${version} was assigned to multiple distinct clientActionId values`).toBe(1);
  }
}

function assertDuplicateActionIdsAreIdempotent(responses: readonly RuntimeCommandResponse[]): void {
  const versionsByActionId = new Map<string, number>();
  for (const response of responses) {
    if (!response.ok) {
      continue;
    }
    const event = response.body['event'] as JsonObject;
    const actionId = String(event['clientActionId'] ?? response.actionId);
    const version = Number(event['version']);
    const previous = versionsByActionId.get(actionId);
    if (previous !== undefined) {
      expect(version, `duplicate action ${actionId} returned a different version`).toBe(previous);
    }
    versionsByActionId.set(actionId, version);
  }
}

function assertNoLegacyRuntimePayloads(responses: readonly RuntimeCommandResponse[]): void {
  const serialized = JSON.stringify(responses);
  expect(serialized.includes('"game_patch"')).toBe(false);
  expect(serialized.includes('"resync_required"')).toBe(false);
}

async function assertSequentialOrdering(
  request: APIRequestContext,
  gameId: string,
  actorId: string,
  instanceId: string,
  baseVersion: number,
  runId: string,
): Promise<void> {
  let version = baseVersion;
  for (let index = 0; index < 3; index += 1) {
    const response = await postRuntimeCommand(request, actorId, {
      gameId,
      baseVersion: version,
      clientActionId: `bp-order-${runId}-${index}`,
      type: 'card.tapped',
      payload: { instanceId, tapped: index % 2 === 0 },
    });
    expectRuntimeSuccess(response, `ordering command ${index + 1}`);
    const nextVersion = Number((response.body['event'] as JsonObject)['version']);
    expect(nextVersion).toBe(version + 1);
    version = nextVersion;
  }
}

async function waitForActorMetrics(request: APIRequestContext, gameId: string): Promise<JsonObject> {
  let latest: RuntimeMetrics | null = null;
  await expect.poll(async () => {
    const response = await request.get(RUNTIME_METRICS_URL, { timeout: 5_000 });
    await expectApiOk(response, 'load runtime metrics');
    latest = await response.json() as RuntimeMetrics;
    const actorMetrics = (latest.actors ?? []).find((candidate) => candidate['gameId'] === gameId);
    if (!actorMetrics) {
      return 'missing';
    }
    return String(actorMetrics['actor.queue_depth'] ?? 'missing');
  }, { timeout: 20_000 }).toBe('0');

  const actorMetrics = (latest?.actors ?? []).find((candidate) => candidate['gameId'] === gameId);
  if (!actorMetrics) {
    throw new Error(`Runtime metrics did not include actor ${gameId}. Snapshot=${JSON.stringify(latest)}`);
  }
  return actorMetrics;
}

function expectHasActorMetrics(body: JsonObject): void {
  const metrics = body['metrics'] as JsonObject | undefined;
  expect(metrics).toBeTruthy();
  expect(metrics?.['actor.queue_depth']).not.toBeUndefined();
  expect(metrics?.['actor.queue_capacity']).not.toBeUndefined();
  expect(metrics?.['actor.command_enqueued_count']).not.toBeUndefined();
  expect(metrics?.['actor.command_applied_count']).not.toBeUndefined();
}

async function assertRuntimeWebSocketHealthy(
  browser: Browser,
  request: APIRequestContext,
  gameId: string,
  player: BackpressurePlayer,
): Promise<void> {
  const ticket = await websocketTicket(request, gameId, player.token);
  const page = await (await browser.newContext()).newPage();
  try {
    await openWebSocketAndWaitForConnected(page, ticket.websocketUrl);
  } finally {
    await page.context().close().catch(() => undefined);
  }
}

async function websocketTicket(request: APIRequestContext, gameId: string, token: string): Promise<{ websocketUrl: string }> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'create backpressure websocket ticket');
  const payload = await response.json() as { websocketUrl?: string };
  if (!payload.websocketUrl) {
    throw new Error('WebSocket ticket response did not include websocketUrl.');
  }
  return { websocketUrl: payload.websocketUrl };
}

async function openWebSocketAndWaitForConnected(page: Page, websocketUrl: string): Promise<void> {
  await page.evaluate(
    (url) => new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      const timeout = window.setTimeout(() => {
        socket.close();
        reject(new Error('Timed out waiting for runtime WebSocket connection_state.'));
      }, 15_000);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (message['kind'] === 'connection_state' && message['status'] === 'connected') {
            window.clearTimeout(timeout);
            socket.close();
            resolve();
          }
        } catch (error) {
          window.clearTimeout(timeout);
          socket.close();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      socket.onerror = () => {
        window.clearTimeout(timeout);
        socket.close();
        reject(new Error('Runtime WebSocket connection failed.'));
      };
    }),
    websocketUrl,
  );
}

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`Game runtime is not reachable at ${RUNTIME_READY_URL}; backpressure gate must not fall back to legacy.`);
  }
}

async function assertBackendReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(`${API_BASE_URL}/readyz`, { timeout: 5_000 });
  await expectApiOk(response, 'load backend readyz');
}

async function expectApiOk(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) {
    return;
  }
  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}

function parseJsonObject(text: string): JsonObject {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : { raw: text };
  } catch {
    return { raw: text };
  }
}

function stableShuffle<T>(items: T[], seed: string): T[] {
  const random = mulberry32(hashStringToUint32(seed));
  const shuffled = items.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex]!;
    shuffled[swapIndex] = current!;
  }
  return shuffled;
}

function hashStringToUint32(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
