import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { resolveGameToPlaying } from './support/commander-game';
import { sendRuntimeCommand, type RuntimeWebSocketCommandResult } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type StateIntegrityPlayer = {
  token: string;
  refreshToken: string;
  user: RealUserSession['user'];
  credentials: RealUserSession['credentials'];
  deck: BasicCommanderDeckFromDatabaseResult;
};
type StateIntegritySetup = { gameId: string; roomId: string; players: StateIntegrityPlayer[] };

test.describe('product state integrity runtime gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: StateIntegritySetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertGameRuntimeReady(request);
    setup = await createThreePlayerGame(request, `state${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
  });

  test('counter patch, refresh and reconnect preserve battlefield state', async ({ browser, request, baseURL }) => {
    test.setTimeout(300_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const [playerA, playerB, playerC] = setup.players;
    if (!playerA || !playerB || !playerC) {
      throw new Error('State integrity gate requires exactly 3 players.');
    }
    const { gameId } = setup;
    const initialSnapshot = await gameSnapshot(request, gameId, playerA.token);
    const handIds = zoneInstanceIds(initialSnapshot, playerA.user.id, 'hand');
    if (handIds.length < 2) {
      throw new Error(`Expected at least 2 hand cards for state integrity gate, got ${handIds.length}.`);
    }
    const [permanentId, equipmentId] = handIds;
    let baseVersion = Math.max(1, Number(initialSnapshot['version'] ?? 1));

    const contexts = await Promise.all([playerA, playerB, playerC].map((player) =>
      browser.newContext({ baseURL, storageState: authStorageState(baseURL, player.user, player.refreshToken) }),
    ));
    await Promise.all(contexts.map(enableFrontendGameplayV2));
    const requestAudit = { bootstrap: 0, snapshot: 0 };
    const commandFrames: JsonObject[] = [];

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
      await Promise.all([
        focusPlayerById(pageA, playerA.user.id),
        focusPlayerById(pageB, playerA.user.id),
        focusPlayerById(pageC, playerA.user.id),
      ]);
      const liveRequestBaseline = requestAudit.bootstrap + requestAudit.snapshot;

      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: permanentId,
          position: { x: 0.37, y: 0.61, unit: 'ratio' },
        },
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
          instanceId: equipmentId,
          position: { x: 0.58, y: 0.61, unit: 'ratio' },
        },
      });
      await expect(battlefieldCard(pageA, playerA.user.id, permanentId)).toBeVisible({ timeout: 15_000 });

      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.tapped',
        payload: { instanceId: permanentId, tapped: true },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.face_down.changed',
        payload: { playerId: playerA.user.id, instanceId: permanentId, faceDown: true },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.controller.changed',
        payload: { playerId: playerA.user.id, instanceId: permanentId, targetPlayerId: playerB.user.id },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.power_toughness.changed',
        payload: { instanceId: permanentId, power: 5, toughness: 7 },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'arrow.created',
        payload: { fromInstanceId: permanentId, toInstanceId: equipmentId, color: 'blue' },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'attachment.created',
        payload: { equipmentInstanceId: equipmentId, attachedToInstanceId: permanentId },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'life.changed',
        payload: { playerId: playerA.user.id, life: 33 },
      });
      const counterOutcome = await sendRuntimeCommand(request, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.counter.changed',
        payload: { instanceId: permanentId, counter: '+1/+1', value: 3 },
      });
      commandFrames.push(...counterOutcome.frames);
      baseVersion = counterOutcome.version;

      expect(operation(counterOutcome.patch, 'card.counters.patch')).toMatchObject({
        instanceId: permanentId,
        counters: { '+1/+1': 3 },
        power: 8,
        toughness: 10,
      });
      expect(operation(counterOutcome.patch, 'card.field.set')).toBeNull();
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBe(liveRequestBaseline);

      const liveSnapshot = await gameSnapshot(request, gameId, playerA.token);
      assertSnapshotState(liveSnapshot, playerA.user.id, permanentId, {
        position: { x: 0.37, y: 0.61, unit: 'ratio' },
        tapped: true,
        rotation: 90,
        faceDown: true,
        controllerId: playerB.user.id,
        counters: { '+1/+1': 3 },
        power: 8,
        toughness: 10,
      });
      expect(playerLife(liveSnapshot, playerA.user.id)).toBe(33);
      expect(relationCount(liveSnapshot, 'arrows')).toBeGreaterThanOrEqual(1);
      expect(relationCount(liveSnapshot, 'attachments')).toBeGreaterThanOrEqual(1);

      await expect.poll(async () => (await battlefieldCard(pageA, playerA.user.id, permanentId).getAttribute('class')) ?? '').toContain('tapped');
      expect(nonOriginPosition(await cardCssPosition(pageA, playerA.user.id, permanentId))).toBe(true);
      expect(nonOriginPosition(await cardCssPosition(pageB, playerA.user.id, permanentId))).toBe(true);

      const viewerSnapshot = await gameSnapshot(request, gameId, playerC.token);
      const viewerCard = snapshotCard(viewerSnapshot, playerA.user.id, permanentId);
      expect(viewerCard['faceDown']).toBe(true);
      expect(String(viewerCard['name'] ?? '')).not.toContain('Sol Ring');
      expect(String(viewerCard['name'] ?? '')).not.toContain('Lightning Bolt');

      const beforeRefreshRequests = requestAudit.bootstrap + requestAudit.snapshot;
      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayerById(pageA, playerA.user.id);
      await expect(battlefieldCard(pageA, playerA.user.id, permanentId)).toBeVisible({ timeout: 15_000 });
      await expect.poll(async () => (await battlefieldCard(pageA, playerA.user.id, permanentId).getAttribute('class')) ?? '').toContain('tapped');
      expect(nonOriginPosition(await cardCssPosition(pageA, playerA.user.id, permanentId))).toBe(true);
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
      await focusPlayerById(reconnectPage, playerA.user.id);
      await expect(battlefieldCard(reconnectPage, playerA.user.id, permanentId)).toBeVisible({ timeout: 15_000 });
      expect(nonOriginPosition(await cardCssPosition(reconnectPage, playerA.user.id, permanentId))).toBe(true);
      await reconnectContext.close();

      for (const frames of [framesA, framesB, framesC, reconnectFrames, commandFrames]) {
        expect(frames.some((message) => message['kind'] === 'game_patch')).toBe(false);
        expect(frames.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')).toBe(false);
      }
      void baseVersion;
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<StateIntegritySetup> {
  const players: StateIntegrityPlayer[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `si-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `SI${index + 1} ${runId.slice(-10)}`,
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
      name: `State Integrity ${runId.slice(-10)}`,
      format: 'commander',
      maxPlayers: 3,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create state integrity room');
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
  await expectApiOk(response, 'join state integrity room');
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokens[0]}` },
    });
    await expectApiOk(roomResponse, 'load state integrity room turn order');
    const payload = await roomResponse.json() as { room?: { players?: Array<{ turnRolls?: number[] }> } };
    if (turnOrderResolved(payload.room?.players ?? [])) {
      return;
    }
    for (const token of tokens) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok() && response.status() !== 409) {
        await expectApiOk(response, 'roll state integrity turn order');
      }
    }
  }
  throw new Error('Unable to resolve state integrity room turn order.');
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'start state integrity room');
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

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`Game runtime is not reachable at ${RUNTIME_READY_URL}; state integrity gate must not fall back to legacy.`);
  }
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

function assertSnapshotState(snapshot: JsonObject, playerId: string, instanceId: string, expected: JsonObject): void {
  expect(snapshotCard(snapshot, playerId, instanceId)).toMatchObject(expected);
}

function snapshotCard(snapshot: JsonObject, playerId: string, instanceId: string): JsonObject {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  const card = zones?.['battlefield']?.find((candidate) => candidate['instanceId'] === instanceId);
  if (!card) {
    throw new Error(`Missing battlefield card ${instanceId} for player ${playerId}.`);
  }
  return card;
}

function playerLife(snapshot: JsonObject, playerId: string): number {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  return Number(players?.[playerId]?.['life']);
}

function relationCount(snapshot: JsonObject, key: 'arrows' | 'attachments'): number {
  return Array.isArray(snapshot[key]) ? (snapshot[key] as unknown[]).length : 0;
}

function zoneInstanceIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return (zones?.[zone] ?? []).map((card) => String(card['instanceId'] ?? '')).filter((id) => id !== '');
}

function battlefieldCard(page: Page, ownerPlayerId: string, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`);
}

async function cardCssPosition(page: Page, ownerPlayerId: string, instanceId: string): Promise<{ left: number; top: number }> {
  return battlefieldCard(page, ownerPlayerId, instanceId).evaluate((element) => ({
    left: Number.parseFloat((element as HTMLElement).style.left || '0'),
    top: Number.parseFloat((element as HTMLElement).style.top || '0'),
  }));
}

function nonOriginPosition(position: { left: number; top: number }): boolean {
  return Number.isFinite(position.left) && Number.isFinite(position.top) && (position.left > 1 || position.top > 1);
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.find((item) => item['op'] === op) ?? null;
}

function collectWebSocketFrames(page: Page): JsonObject[] {
  const frames: JsonObject[] = [];
  page.on('websocket', (socket) => {
    frames.push({ kind: 'connection_open', url: socket.url() });
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
  return expect.poll(() => frames.some((frame) =>
    frame['kind'] === 'connection_open' || (frame['kind'] === 'connection_state' && frame['status'] === 'connected'),
  ), {
    timeout: 30_000,
  }).toBe(true);
}

function auditBootstrapRequests(page: Page, gameId: string, audit: { bootstrap: number; snapshot: number }): void {
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'GET' && url.includes(`/games/${gameId}/bootstrap`)) {
      audit.bootstrap += 1;
    }
    if (request.method() === 'GET' && url.includes(`/games/${gameId}/snapshot`)) {
      audit.snapshot += 1;
    }
  });
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

async function focusPlayerById(page: Page, playerId: string): Promise<void> {
  await expect(page.getByTestId('player-panel')).toBeVisible({ timeout: 15_000 });
  if (await focusedPlayerId(page) === playerId) {
    return;
  }

  const board = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`);
  await expect(board).toBeVisible({ timeout: 15_000 });
  await board.click();
  await expect.poll(() => focusedPlayerId(page), { timeout: 10_000 }).toBe(playerId);
}

async function focusedPlayerId(page: Page): Promise<string | null> {
  return page.getByTestId('player-panel').getAttribute('data-player-id');
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

async function expectApiOk(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) {
    return;
  }
  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
