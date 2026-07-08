import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { focusPlayer } from './support/game-table';
import { sendRuntimeCommand, type RuntimeWebSocketCommandResult } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const API_HEALTH_URL = process.env['E2E_API_HEALTH_URL'] ?? `${API_BASE_URL}/healthz`;
const API_READY_URL = process.env['E2E_API_READY_URL'] ?? `${API_BASE_URL}/readyz`;
const WEBSOCKET_HEALTH_URL = process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz';
const WEBSOCKET_READY_URL = process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz';
const RUNTIME_HEALTH_URL = process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type DerivedPlayer = {
  token: string;
  refreshToken: string;
  user: RealUserSession['user'];
  credentials: RealUserSession['credentials'];
  deck: BasicCommanderDeckFromDatabaseResult;
};

test.describe('rc hotfix derived gameplay semantics gate', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    await Promise.all([
      assertServiceReady(request, API_HEALTH_URL, 'api healthz'),
      assertServiceReady(request, API_READY_URL, 'api readyz'),
      assertServiceReady(request, WEBSOCKET_HEALTH_URL, 'websocket healthz'),
      assertServiceReady(request, WEBSOCKET_READY_URL, 'websocket readyz'),
      assertServiceReady(request, RUNTIME_HEALTH_URL, 'game-runtime healthz'),
      assertServiceReady(request, RUNTIME_READY_URL, 'game-runtime readyz'),
    ]);
  });

  test('+1/+1 and -1/-1 counters update displayed P/T and commander cast count survives retry/reconnect', async ({ browser, request, baseURL }) => {
    test.setTimeout(300_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const setup = await createCommanderGameWithBasicDecks(request, {
      runId: `derived${Date.now().toString(36)}`,
      playerAPrefix: 'derived-a',
      playerBPrefix: 'derived-b',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);

    const { gameId, playerA, playerB } = setup;
    let baseVersion = await gameVersion(request, gameId, playerA.token);
    const snapshot = await gameSnapshot(request, gameId, playerA.token);
    const commander = zoneCards(snapshot, playerA.user.id, 'command').find((card) => card['isCommander'] === true)
      ?? zoneCards(snapshot, playerA.user.id, 'command')[0];
    if (!commander) {
      throw new Error('Derived semantics gate requires a commander in command zone.');
    }
    const commanderId = String(commander['instanceId']);

    const contextA = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken) });
    const contextB = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken) });
    await Promise.all([enableFrontendGameplayV2(contextA), enableFrontendGameplayV2(contextB)]);

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      const framesA = collectWebSocketFrames(pageA);
      const framesB = collectWebSocketFrames(pageB);

      await Promise.all([
        pageA.goto(`/games/${gameId}`),
        pageB.goto(`/games/${gameId}`),
      ]);
      await Promise.all([
        expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        waitForGameplayConnection(framesA),
        waitForGameplayConnection(framesB),
      ]);
      await Promise.all([
        focusPlayer(pageA, playerA.user.displayName),
        focusPlayer(pageB, playerA.user.displayName),
      ]);

      const commandFrames: JsonObject[] = [];
      const tokenCreate = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.token.created',
        payload: {
          playerId: playerA.user.id,
          quantity: 1,
          card: {
            name: 'Derived Bear',
            typeLine: 'Token Creature - Bear',
            power: 2,
            toughness: 2,
          },
          position: { x: 0.31, y: 0.48, unit: 'ratio' },
        },
      });
      baseVersion = tokenCreate.version;
      const tokenId = firstAddedCardId(tokenCreate.patch);
      await expect(battlefieldCard(pageA, playerA.user.id, tokenId)).toBeVisible({ timeout: 15_000 });
      await expect(statValues(pageA, playerA.user.id, tokenId)).toHaveText(['2', '2'], { timeout: 15_000 });

      const plusOne = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.counter.changed',
        payload: { playerId: playerA.user.id, instanceId: tokenId, counter: '+1/+1', value: 1 },
      });
      baseVersion = plusOne.version;
      expect(counterStatFromPatch(plusOne.patch, 'power')).toBe(3);
      expect(counterStatFromPatch(plusOne.patch, 'toughness')).toBe(3);
      await expect(statValues(pageA, playerA.user.id, tokenId)).toHaveText(['3', '3'], { timeout: 15_000 });

      const minusOne = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.counter.changed',
        payload: { playerId: playerA.user.id, instanceId: tokenId, counter: '-1/-1', value: 1 },
      });
      baseVersion = minusOne.version;
      expect(counterStatFromPatch(minusOne.patch, 'power')).toBe(2);
      expect(counterStatFromPatch(minusOne.patch, 'toughness')).toBe(2);
      await expect(statValues(pageA, playerA.user.id, tokenId)).toHaveText(['2', '2'], { timeout: 15_000 });

      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayer(pageA, playerA.user.displayName);
      await expect(statValues(pageA, playerA.user.id, tokenId)).toHaveText(['2', '2'], { timeout: 15_000 });

      const commanderBaseVersion = baseVersion;
      const commanderMove = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion: commanderBaseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'command',
          toZone: 'battlefield',
          instanceId: commanderId,
          position: { x: 0.44, y: 0.52, unit: 'ratio' },
        },
      });
      baseVersion = commanderMove.version;
      expect(commanderCastsFromPatch(commanderMove.patch, commanderId)).toBe(1);
      expect(movedCard(commanderMove.patch)?.['isCommander']).toBe(true);
      await expect(battlefieldCard(pageA, playerA.user.id, commanderId)).toBeVisible({ timeout: 15_000 });
      await expect(commanderCastCount(pageA, playerA.user.id, commanderId)).toHaveText('1', { timeout: 15_000 });

      await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion: commanderBaseVersion,
        type: 'card.moved',
        clientActionId: commanderMove.clientActionId,
        payload: {
          playerId: playerA.user.id,
          fromZone: 'command',
          toZone: 'battlefield',
          instanceId: commanderId,
          position: { x: 0.44, y: 0.52, unit: 'ratio' },
        },
      }).catch((error: unknown) => {
        if (!String(error).includes('Timed out waiting for runtime patch')) {
          throw error;
        }
      });
      await expect.poll(async () => commanderCastsFromSnapshot(await gameSnapshot(request, gameId, playerA.token), commanderId), {
        timeout: 10_000,
      }).toBe(1);

      const reconnectRefreshToken = await loginRefreshToken(request, playerA.credentials);
      const reconnectContext = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerA.user, reconnectRefreshToken) });
      await enableFrontendGameplayV2(reconnectContext);
      const reconnectPage = await reconnectContext.newPage();
      const reconnectFrames = collectWebSocketFrames(reconnectPage);
      await reconnectPage.goto(`/games/${gameId}`);
      await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(reconnectFrames);
      await focusPlayer(reconnectPage, playerA.user.displayName);
      await expect(statValues(reconnectPage, playerA.user.id, tokenId)).toHaveText(['2', '2'], { timeout: 15_000 });
      await expect(commanderCastCount(reconnectPage, playerA.user.id, commanderId)).toHaveText('1', { timeout: 15_000 });

      await assertNoUnknownCard(pageA);
      await assertNoUnknownCard(pageB);
      await assertNoFalseActionToast(pageA);
      await assertNoFalseActionToast(pageB);
      assertNoRuntimeFallbackFrames([...framesA, ...framesB, ...reconnectFrames, ...commandFrames]);
      await reconnectContext.close();
      void baseVersion;
    } finally {
      await contextA.close().catch(() => undefined);
      await contextB.close().catch(() => undefined);
    }
  });

  test('generous mulligan first hand allows selecting three bottom cards before keep or retry', async ({ browser, request, baseURL }) => {
    test.setTimeout(300_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const setup = await createGenerousGame(request, `generous${Date.now().toString(36)}`);
    const [playerA, playerB] = setup.players;
    if (!playerA || !playerB) {
      throw new Error('Generous mulligan gate requires two players.');
    }

    const contextA = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken) });
    const contextB = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken) });
    await Promise.all([enableFrontendGameplayV2(contextA), enableFrontendGameplayV2(contextB)]);

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      const framesA = collectWebSocketFrames(pageA);
      const framesB = collectWebSocketFrames(pageB);

      await Promise.all([
        pageA.goto(`/games/${setup.gameId}`),
        pageB.goto(`/games/${setup.gameId}`),
      ]);
      await Promise.all([
        expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        waitForGameplayConnection(framesA),
        waitForGameplayConnection(framesB),
      ]);

      await assertFirstGenerousHandCanBottomBeforeKeep(pageA, framesA);
      await assertFirstGenerousHandCanBottomBeforeKeep(pageB, framesB);
      await expect.poll(async () => (await gameSnapshot(request, setup.gameId, playerA.token))['gamePhase'], {
        timeout: 30_000,
      }).toBe('PLAYING');
      await expect(pageA.getByTestId('mulligan-overlay')).toBeHidden({ timeout: 30_000 });
      await expect(pageB.getByTestId('mulligan-overlay')).toBeHidden({ timeout: 30_000 });

      const snapshotA = await gameSnapshot(request, setup.gameId, playerA.token);
      const snapshotB = await gameSnapshot(request, setup.gameId, playerB.token);
      expect(zoneCards(snapshotA, playerA.user.id, 'hand')).toHaveLength(7);
      assertPrivateZoneHasNoCardKeys(snapshotA, playerB.user.id, 'hand');
      assertPrivateZoneHasNoCardKeys(snapshotB, playerA.user.id, 'hand');
      await assertNoUnknownCard(pageA);
      await assertNoUnknownCard(pageB);
      await assertNoFalseActionToast(pageA);
      await assertNoFalseActionToast(pageB);
      assertNoRuntimeFallbackFrames([...framesA, ...framesB]);
    } finally {
      await contextA.close().catch(() => undefined);
      await contextB.close().catch(() => undefined);
    }
  });
});

async function assertFirstGenerousHandCanBottomBeforeKeep(page: Page, frames: JsonObject[]): Promise<void> {
  await expect(page.getByTestId('mulligan-overlay')).toBeVisible({ timeout: 30_000 });
  const takePatch = waitForNewPatchV2(frames, frames.length, (patch) => hasOp(patch, 'mulligan.hand.replace_private'));
  await page.getByTestId('mulligan-take').click();
  await takePatch;
  await expect(page.locator('.mulligan-card')).toHaveCount(10, { timeout: 15_000 });
  await expect(page.locator('.mulligan-card', { hasText: 'Unknown Card' })).toHaveCount(0);
  await expect(page.getByTestId('mulligan-bottom-selection')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('mulligan-keep')).toBeDisabled();

  for (let index = 0; index < 3; index += 1) {
    const nextButton = page.locator('.bottom-card-action:not(.selected)').first();
    await expect(nextButton).toBeEnabled({ timeout: 10_000 });
    const selectedBefore = await page.getByTestId('mulligan-bottom-pill').count();
    await nextButton.click();
    await expect.poll(() => page.getByTestId('mulligan-bottom-pill').count(), { timeout: 10_000 }).toBe(selectedBefore + 1);
  }

  await expect(page.getByTestId('mulligan-bottom-pill')).toHaveCount(3);
  await expect(page.getByTestId('mulligan-keep')).toBeEnabled({ timeout: 10_000 });
  const keepPatch = waitForNewPatchV2(frames, frames.length, (patch) => hasOp(patch, 'mulligan.completed') || hasOp(patch, 'mulligan.status.set'));
  await page.getByTestId('mulligan-keep').click();
  await keepPatch;
}

async function createGenerousGame(request: APIRequestContext, runId: string): Promise<{ gameId: string; roomId: string; players: DerivedPlayer[] }> {
  const players: DerivedPlayer[] = [];
  for (const label of ['a', 'b'] as const) {
    const session = await createRealUserSession(request, `derived-generous-${label}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `DG ${label.toUpperCase()} ${runId.slice(-8)}`,
    });
    players.push({
      token: session.token,
      refreshToken: session.refreshToken,
      user: session.user,
      credentials: session.credentials,
      deck,
    });
  }
  const first = players[0]!;
  const second = players[1]!;
  const roomId = await createRoom(request, first.token, first.deck.deckId, runId);
  await joinRoom(request, second.token, roomId, second.deck.deckId);
  await resolveTurnOrder(request, roomId, players.map((player) => player.token));
  const gameId = await startRoom(request, first.token, roomId);
  return { gameId, roomId, players };
}

async function createRoom(request: APIRequestContext, token: string, deckId: string, runId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      deckId,
      visibility: 'public',
      name: `Derived Hotfix ${runId.slice(-10)}`,
      format: 'commander',
      maxPlayers: 2,
      mulliganRule: 'GENEROUS',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create generous mulligan room');
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
  await expectApiOk(response, 'join generous mulligan room');
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokens[0]}` },
    });
    await expectApiOk(roomResponse, 'load generous room turn order');
    const payload = await roomResponse.json() as { room?: { players?: Array<{ turnRolls?: number[] }> } };
    if (turnOrderResolved(payload.room?.players ?? [])) {
      return;
    }
    for (const token of tokens) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok() && response.status() !== 409) {
        await expectApiOk(response, 'roll generous room turn order');
      }
    }
  }
  throw new Error('Unable to resolve generous room turn order.');
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'start generous room');
  const payload = await response.json() as { game?: { id?: string } };
  if (!payload.game?.id) {
    throw new Error('Room start did not return game.id.');
  }
  return payload.game.id;
}

async function runRuntime(
  request: APIRequestContext,
  frames: JsonObject[],
  options: Parameters<typeof sendRuntimeCommand>[1],
): Promise<RuntimeWebSocketCommandResult> {
  const result = await sendRuntimeCommand(request, options);
  frames.push(...result.frames);
  expect(result.patch['kind']).toBe('patch.v2');
  return result;
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

async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  return Math.max(1, Number((await gameSnapshot(request, gameId, token))['version'] ?? 1));
}

async function loginRefreshToken(request: APIRequestContext, credentials: { email: string; password: string }): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/auth/login`, {
    data: {
      email: credentials.email,
      password: credentials.password,
    },
  });
  await expectApiOk(response, 'refresh reconnect auth token');
  const setCookie = response.headers()['set-cookie'] ?? '';
  const match = setCookie.match(/commanderzone\.refresh=([^;]+)/);
  const refreshToken = match?.[1] ?? '';
  expect(refreshToken.length).toBeGreaterThan(10);
  return refreshToken;
}

async function assertServiceReady(request: APIRequestContext, url: string, service: string): Promise<void> {
  const response = await request.get(url, { timeout: 10_000 });
  if (!response.ok()) {
    throw new Error(`${service} is not ready at ${url}: HTTP ${response.status()} ${await response.text()}`);
  }
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

function waitForNewPatchV2(frames: JsonObject[], startIndex: number, predicate: (message: JsonObject) => boolean): Promise<JsonObject> {
  return expect.poll(() => {
    const recent = frames.slice(startIndex);
    if (recent.some((message) => message['kind'] === 'patch.v2' && predicate(message))) {
      return 'patch';
    }
    if (recent.some((message) => message['kind'] === 'game_patch')) {
      return 'legacy';
    }
    if (recent.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')) {
      return 'resync';
    }
    if (recent.some((message) => message['kind'] === 'command_ack' && message['status'] === 'rejected')) {
      return 'rejected';
    }
    return null;
  }, {
    timeout: 30_000,
  }).toBe('patch').then(() => {
    const patch = frames.slice(startIndex).find((message) => message['kind'] === 'patch.v2' && predicate(message));
    if (!patch) {
      throw new Error(`patch.v2 frame was not captured. Recent frames: ${JSON.stringify(frames.slice(-8), null, 2)}`);
    }
    return patch;
  });
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.find((item) => item['op'] === op) ?? null;
}

function hasOp(message: JsonObject, op: string): boolean {
  return operation(message, op) !== null;
}

function firstAddedCardId(message: JsonObject): string {
  const cards = operation(message, 'zone.cards.add')?.['cards'];
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error(`Expected zone.cards.add in patch: ${JSON.stringify(message)}`);
  }
  return String((cards[0] as JsonObject)['instanceId'] ?? '');
}

function counterStatFromPatch(message: JsonObject, field: 'power' | 'toughness'): number {
  const op = operation(message, 'card.counters.patch');
  return Number(op?.[field] ?? Number.NaN);
}

function movedCard(message: JsonObject): JsonObject | null {
  const card = operation(message, 'zone.cards.move')?.['card'];
  return card !== null && typeof card === 'object' && !Array.isArray(card) ? card as JsonObject : null;
}

function commanderCastsFromPatch(message: JsonObject, commanderId: string): number | null {
  const op = operation(message, 'game.counters.set');
  if (op?.['scope'] !== `commander:${commanderId}`) {
    return null;
  }
  const counters = op['counters'] as JsonObject | undefined;
  return Number(counters?.['casts'] ?? Number.NaN);
}

function commanderCastsFromSnapshot(snapshot: JsonObject, commanderId: string): number {
  const counters = snapshot['counters'] as JsonObject | undefined;
  const scoped = counters?.[`commander:${commanderId}`] as JsonObject | undefined;
  const legacy = counters?.['commanderCasts'] as JsonObject | undefined;
  return Number(scoped?.['casts'] ?? legacy?.[commanderId] ?? 0);
}

function zoneCards(snapshot: JsonObject, playerId: string, zone: string): JsonObject[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return zones?.[zone] ?? [];
}

function assertPrivateZoneHasNoCardKeys(snapshot: JsonObject, playerId: string, zone: string): void {
  for (const card of zoneCards(snapshot, playerId, zone)) {
    expect(card['cardKey']).toBeUndefined();
    expect(card['scryfallId']).toBeUndefined();
    const imageUris = card['imageUris'];
    expect(
      imageUris === undefined
      || imageUris === null
      || (typeof imageUris === 'object' && !Array.isArray(imageUris) && Object.keys(imageUris).length === 0),
    ).toBe(true);
  }
}

function battlefieldCard(page: Page, ownerPlayerId: string, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`);
}

function statValues(page: Page, ownerPlayerId: string, instanceId: string) {
  return battlefieldCard(page, ownerPlayerId, instanceId).locator('.power-toughness-overlay span');
}

function commanderCastCount(page: Page, playerId: string, commanderId: string) {
  return page.locator(`[data-testid="commander-cast-count"][data-player-id="${playerId}"][data-card-id="${commanderId}"]`);
}

async function assertNoUnknownCard(page: Page): Promise<void> {
  await expect(page.locator('body')).not.toContainText('Unknown Card', { timeout: 5_000 });
}

async function assertNoFalseActionToast(page: Page): Promise<void> {
  await expect(page.locator('.table-error', { hasText: /failed|could not|error/i })).toHaveCount(0);
}

function assertNoRuntimeFallbackFrames(frames: JsonObject[]): void {
  expect(frames.some((message) => message['kind'] === 'game_patch')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'command_failed')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'command_ack' && message['status'] === 'rejected')).toBe(false);
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

async function expectApiOk(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) {
    return;
  }
  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
