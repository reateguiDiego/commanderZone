import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { resolveGameToPlaying } from './support/commander-game';
import { sendRuntimeCommand, type RuntimeWebSocketCommandResult } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type ZoneVisibilityPlayer = {
  token: string;
  refreshToken: string;
  user: RealUserSession['user'];
  credentials: RealUserSession['credentials'];
  deck: BasicCommanderDeckFromDatabaseResult;
};
type ZoneVisibilitySetup = { gameId: string; roomId: string; players: ZoneVisibilityPlayer[] };

test.describe('product zone visibility runtime gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: ZoneVisibilitySetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertGameRuntimeReady(request);
    setup = await createThreePlayerGame(request, `zone${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
  });

  test('zone transitions preserve owner/controller rules and private visibility', async ({ browser, request, baseURL }) => {
    test.setTimeout(300_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const [playerA, playerB, playerC] = setup.players;
    if (!playerA || !playerB || !playerC) {
      throw new Error('Zone visibility gate requires exactly 3 players.');
    }
    const { gameId } = setup;
    const initialSnapshot = await gameSnapshot(request, gameId, playerA.token);
    const handIds = zoneInstanceIds(initialSnapshot, playerA.user.id, 'hand');
    if (handIds.length < 4) {
      throw new Error(`Expected at least 4 hand cards for zone visibility gate, got ${handIds.length}.`);
    }
    const [controlledId, equipmentId, faceDownId] = handIds;
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
          instanceId: controlledId,
          position: { x: 0.36, y: 0.6, unit: 'ratio' },
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
          position: { x: 0.58, y: 0.6, unit: 'ratio' },
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
          instanceId: faceDownId,
          faceDown: true,
          position: { x: 0.47, y: 0.72, unit: 'ratio' },
        },
      });
      await expect(battlefieldCard(pageA, playerA.user.id, controlledId)).toBeVisible({ timeout: 15_000 });
      await expect(battlefieldCard(pageB, playerA.user.id, faceDownId)).toHaveCount(0);
      await expect(opaqueBattlefieldShell(pageB, playerA.user.id)).toBeVisible({ timeout: 15_000 });

      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.tapped',
        payload: { instanceId: controlledId, tapped: true },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.counter.changed',
        payload: { instanceId: controlledId, counter: '+1/+1', value: 2 },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'arrow.created',
        payload: { fromInstanceId: controlledId, toInstanceId: equipmentId, color: 'blue' },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'attachment.created',
        payload: { equipmentInstanceId: equipmentId, attachedToInstanceId: controlledId },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'life.changed',
        payload: { playerId: playerA.user.id, life: 34 },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.controller.changed',
        payload: { playerId: playerA.user.id, instanceId: controlledId, targetPlayerId: playerB.user.id },
      });

      const faceDownOwnerSnapshot = await gameSnapshot(request, gameId, playerA.token);
      const faceDownRivalSnapshot = await gameSnapshot(request, gameId, playerC.token);
      expect(zoneCard(faceDownOwnerSnapshot, playerA.user.id, 'battlefield', faceDownId)['faceDown']).toBe(true);
      expect(findZoneCard(faceDownRivalSnapshot, playerA.user.id, 'battlefield', faceDownId)).toBeUndefined();
      assertHiddenForUnauthorized(opaqueBattlefieldSnapshotCard(faceDownRivalSnapshot, playerA.user.id));

      const moveToGraveyard = await sendRuntimeCommand(request, {
        gameId,
        token: playerB.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerB.user.id,
          fromZone: 'battlefield',
          toZone: 'graveyard',
          targetPlayerId: playerB.user.id,
          instanceId: controlledId,
        },
      });
      commandFrames.push(...moveToGraveyard.frames);
      baseVersion = moveToGraveyard.version;
      expect(moveToGraveyard.patch['kind']).toBe('patch.v2');
      expect(operation(moveToGraveyard.patch, 'zone.cards.move') ?? operation(moveToGraveyard.patch, 'zone.cards.add')).not.toBeNull();

      const afterExit = await gameSnapshot(request, gameId, playerA.token);
      const graveyardCard = zoneCard(afterExit, playerA.user.id, 'graveyard', controlledId);
      expect(zoneInstanceIds(afterExit, playerB.user.id, 'graveyard')).not.toContain(controlledId);
      expect(graveyardCard['ownerId']).toBe(playerA.user.id);
      expect(graveyardCard['controllerId']).toBe(playerA.user.id);
      expect(graveyardCard['tapped']).toBe(false);
      expect(Number(graveyardCard['rotation'] ?? 0)).toBe(0);
      expect(graveyardCard['faceDown']).toBe(false);
      expect(emptyRecordPayload(graveyardCard['counters'])).toBe(true);
      expect(graveyardCard['position'] ?? null).toBeNull();
      expect(playerLife(afterExit, playerA.user.id)).toBe(34);
      expect(relationTouches(afterExit, controlledId)).toBe(false);
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBe(liveRequestBaseline);

      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.controller.changed',
        payload: { playerId: playerA.user.id, instanceId: equipmentId, targetPlayerId: playerB.user.id },
      });
      const moveToExile = await sendRuntimeCommand(request, {
        gameId,
        token: playerB.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerB.user.id,
          fromZone: 'battlefield',
          toZone: 'exile',
          targetPlayerId: playerB.user.id,
          instanceId: equipmentId,
        },
      });
      commandFrames.push(...moveToExile.frames);
      baseVersion = moveToExile.version;
      expect(moveToExile.patch['kind']).toBe('patch.v2');
      const afterExile = await gameSnapshot(request, gameId, playerA.token);
      const exileCard = zoneCard(afterExile, playerA.user.id, 'exile', equipmentId);
      expect(zoneInstanceIds(afterExile, playerB.user.id, 'exile')).not.toContain(equipmentId);
      expect(exileCard['ownerId']).toBe(playerA.user.id);
      expect(exileCard['controllerId']).toBe(playerA.user.id);
      expect(exileCard['tapped']).toBe(false);
      expect(Number(exileCard['rotation'] ?? 0)).toBe(0);
      expect(exileCard['faceDown']).toBe(false);
      expect(emptyRecordPayload(exileCard['counters'])).toBe(true);
      expect(exileCard['position'] ?? null).toBeNull();
      expect(playerLife(afterExile, playerA.user.id)).toBe(34);
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBe(liveRequestBaseline);

      const libraryBeforeView = await gameSnapshot(request, gameId, playerA.token);
      const libraryIds = zoneInstanceIds(libraryBeforeView, playerA.user.id, 'library');
      if (libraryIds.length < 2) {
        throw new Error(`Expected at least 2 library cards before view, got ${libraryIds.length}.`);
      }
      const viewedLibraryId = libraryIds[0]!;
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'library.view',
        payload: { playerId: playerA.user.id, count: 2 },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'library',
          toZone: 'hand',
          instanceId: viewedLibraryId,
        },
      });
      const rivalAfterViewMove = await gameSnapshot(request, gameId, playerC.token);
      assertPrivateZoneHasNoCardKeys(rivalAfterViewMove, playerA.user.id, 'library');
      assertPrivateZoneHasNoCardKeys(rivalAfterViewMove, playerA.user.id, 'hand');

      const beforeRefreshRequests = requestAudit.bootstrap + requestAudit.snapshot;
      await pageB.reload();
      await expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayerById(pageB, playerA.user.id);
      await expect(battlefieldCard(pageB, playerA.user.id, faceDownId)).toHaveCount(0);
      await expect(opaqueBattlefieldShell(pageB, playerA.user.id)).toBeVisible({ timeout: 15_000 });
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBeGreaterThan(beforeRefreshRequests);

      const reconnectContext = await browser.newContext({
        baseURL,
        storageState: await contexts[2]!.storageState(),
      });
      await enableFrontendGameplayV2(reconnectContext);
      const reconnectPage = await reconnectContext.newPage();
      const reconnectFrames = collectWebSocketFrames(reconnectPage);
      auditBootstrapRequests(reconnectPage, gameId, requestAudit);
      await reconnectPage.goto(`/games/${gameId}`);
      await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(reconnectFrames);
      await focusPlayerById(reconnectPage, playerA.user.id);
      await expect(battlefieldCard(reconnectPage, playerA.user.id, faceDownId)).toHaveCount(0);
      await expect(opaqueBattlefieldShell(reconnectPage, playerA.user.id)).toBeVisible({ timeout: 15_000 });
      await reconnectContext.close();

      const rivalAfterReconnect = await gameSnapshot(request, gameId, playerC.token);
      expect(findZoneCard(rivalAfterReconnect, playerA.user.id, 'battlefield', faceDownId)).toBeUndefined();
      assertHiddenForUnauthorized(opaqueBattlefieldSnapshotCard(rivalAfterReconnect, playerA.user.id));
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

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<ZoneVisibilitySetup> {
  const players: ZoneVisibilityPlayer[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `zv-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `ZV${index + 1} ${runId.slice(-10)}`,
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
      name: `Zone Visibility ${runId.slice(-10)}`,
      format: 'commander',
      maxPlayers: 3,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create zone visibility room');
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
  await expectApiOk(response, 'join zone visibility room');
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokens[0]}` },
    });
    await expectApiOk(roomResponse, 'load zone visibility room turn order');
    const payload = await roomResponse.json() as { room?: { players?: Array<{ turnRolls?: number[] }> } };
    if (turnOrderResolved(payload.room?.players ?? [])) {
      return;
    }
    for (const token of tokens) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok() && response.status() !== 409) {
        await expectApiOk(response, 'roll zone visibility turn order');
      }
    }
  }
  throw new Error('Unable to resolve zone visibility room turn order.');
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'start zone visibility room');
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
    throw new Error(`Game runtime is not reachable at ${RUNTIME_READY_URL}; zone visibility gate must not fall back to legacy.`);
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

function zoneCards(snapshot: JsonObject, playerId: string, zone: string): JsonObject[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return zones?.[zone] ?? [];
}

function zoneCard(snapshot: JsonObject, playerId: string, zone: string, instanceId: string): JsonObject {
  const card = findZoneCard(snapshot, playerId, zone, instanceId);
  if (!card) {
    throw new Error(`Missing ${zone} card ${instanceId} for player ${playerId}.`);
  }
  return card;
}

function findZoneCard(snapshot: JsonObject, playerId: string, zone: string, instanceId: string): JsonObject | undefined {
  return zoneCards(snapshot, playerId, zone).find((candidate) => candidate['instanceId'] === instanceId);
}

function opaqueBattlefieldSnapshotCard(snapshot: JsonObject, ownerId: string): JsonObject {
  const card = zoneCards(snapshot, ownerId, 'battlefield').find((candidate) =>
    String(candidate['instanceId'] ?? '').startsWith(`${ownerId}-hidden-battlefield-`));
  if (!card) throw new Error(`Missing opaque battlefield shell for player ${ownerId}.`);
  return card;
}

function zoneInstanceIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  return zoneCards(snapshot, playerId, zone).map((card) => String(card['instanceId'] ?? '')).filter((id) => id !== '');
}

function assertHiddenForUnauthorized(card: JsonObject): void {
  expect(card['faceDown']).toBe(true);
  expect(card['cardKey']).toBeUndefined();
  expect(emptyImagePayload(card['imageUris'])).toBe(true);
  expect(emptyArrayPayload(card['cardFaces'])).toBe(true);
}

function assertPrivateZoneHasNoCardKeys(snapshot: JsonObject, playerId: string, zone: string): void {
  for (const card of zoneCards(snapshot, playerId, zone)) {
    expect(card['cardKey']).toBeUndefined();
    expect(emptyImagePayload(card['imageUris'])).toBe(true);
    expect(emptyArrayPayload(card['cardFaces'])).toBe(true);
  }
}

function emptyImagePayload(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

function emptyArrayPayload(value: unknown): boolean {
  return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
}

function emptyRecordPayload(value: unknown): boolean {
  return value === undefined
    || value === null
    || (Array.isArray(value) && value.length === 0)
    || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

function playerLife(snapshot: JsonObject, playerId: string): number {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  return Number(players?.[playerId]?.['life']);
}

function relationTouches(snapshot: JsonObject, instanceId: string): boolean {
  const arrows = Array.isArray(snapshot['arrows']) ? snapshot['arrows'] as JsonObject[] : [];
  const attachments = Array.isArray(snapshot['attachments']) ? snapshot['attachments'] as JsonObject[] : [];
  return arrows.some((arrow) => arrow['fromInstanceId'] === instanceId || arrow['toInstanceId'] === instanceId)
    || attachments.some((attachment) => attachment['equipmentInstanceId'] === instanceId || attachment['attachedToInstanceId'] === instanceId);
}

function battlefieldCard(page: Page, ownerPlayerId: string, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`);
}

function opaqueBattlefieldShell(page: Page, ownerPlayerId: string) {
  return page.locator(
    `[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id^="${ownerPlayerId}-hidden-battlefield-"]`,
  ).first();
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.find((item) => item['op'] === op) ?? null;
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

  const drawerToggle = page.getByTestId('opponents-drawer-toggle');
  if (await drawerToggle.isVisible() && await drawerToggle.getAttribute('aria-expanded') === 'false') {
    await drawerToggle.click();
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
