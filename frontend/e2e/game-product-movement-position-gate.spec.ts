import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { focusPlayer } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type MovementPositionSetup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;
type CssPosition = { left: number; top: number };

test.describe('product correctness movement position runtime gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: MovementPositionSetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertGameRuntimeReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `pos${Date.now().toString(36)}`,
      playerAPrefix: 'pa',
      playerBPrefix: 'pb',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('battlefield positions survive movement, refresh and reconnect', async ({ browser, request, baseURL }) => {
    test.setTimeout(300_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const { gameId, playerA, playerB } = setup;
    const snapshot = await gameSnapshot(request, gameId, playerA.token);
    const handIds = zoneInstanceIds(snapshot, playerA.user.id, 'hand');
    if (handIds.length < 5) {
      throw new Error(`Expected at least 5 hand cards for movement position gate, got ${handIds.length}.`);
    }
    const [explicitId, defaultId, batchOneId, batchTwoId, returnId] = handIds;
    let nextBaseVersion = await gameVersion(request, gameId, playerA.token);

    const contextA = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken) });
    const contextB = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken) });
    await Promise.all([enableFrontendGameplayV2(contextA), enableFrontendGameplayV2(contextB)]);

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      const commandPage = await contextA.newPage();
      const framesA = collectWebSocketFrames(pageA);
      const framesB = collectWebSocketFrames(pageB);
      let bootstrapRequests = 0;
      for (const page of [pageA, pageB]) {
        page.on('request', (httpRequest) => {
          const url = httpRequest.url();
          if (httpRequest.method() === 'GET' && (url.includes(`/games/${gameId}/snapshot`) || url.includes(`/games/${gameId}/bootstrap`))) {
            bootstrapRequests += 1;
          }
        });
      }

      await Promise.all([commandPage.goto('about:blank'), pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
      await Promise.all([
        expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
      ]);
      await Promise.all([waitForGameplayConnection(framesA), waitForGameplayConnection(framesB)]);
      await Promise.all([focusPlayer(pageA, playerA.user.displayName), focusPlayer(pageB, playerA.user.displayName)]);
      const baselineBootstrapRequests = bootstrapRequests;
      const ticket = await websocketTicket(request, gameId, playerA.token);

      let outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: explicitId,
          position: { x: 0.37, y: 0.61, unit: 'ratio' },
        },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.move'),
      });
      nextBaseVersion = outcome.version;
      expect(movedCard(outcome.patch)?.['position']).toEqual({ x: 0.37, y: 0.61, unit: 'ratio' });
      await expect(battlefieldCard(pageA, playerA.user.id, explicitId)).toBeVisible({ timeout: 15_000 });
      await expect(battlefieldCard(pageB, playerA.user.id, explicitId)).toBeVisible({ timeout: 15_000 });
      const explicitOwnerPosition = await cardCssPosition(pageA, playerA.user.id, explicitId);
      const explicitRivalPosition = await cardCssPosition(pageB, playerA.user.id, explicitId);
      expect(nonOriginPosition(explicitOwnerPosition)).toBe(true);
      expect(nearPosition(explicitOwnerPosition, explicitRivalPosition)).toBe(true);
      expect(bootstrapRequests).toBe(baselineBootstrapRequests);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: { playerId: playerA.user.id, fromZone: 'hand', toZone: 'battlefield', instanceId: defaultId },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.move'),
      });
      nextBaseVersion = outcome.version;
      const defaultPosition = movedCard(outcome.patch)?.['position'] as JsonObject | undefined;
      expect(validRuntimePosition(defaultPosition)).toBe(true);
      await expect(battlefieldCard(pageA, playerA.user.id, defaultId)).toBeVisible({ timeout: 15_000 });
      const defaultCssPosition = await cardCssPosition(pageA, playerA.user.id, defaultId);
      expect(nonOriginPosition(defaultCssPosition)).toBe(true);
      expect(overlaps(explicitOwnerPosition, defaultCssPosition)).toBe(false);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'cards.moved',
        payload: { playerId: playerA.user.id, fromZone: 'hand', toZone: 'battlefield', instanceIds: [batchOneId, batchTwoId] },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.batchMove'),
      });
      nextBaseVersion = outcome.version;
      const batchPositions = batchMoveCards(outcome.patch).map((card) => card['position'] as JsonObject | undefined);
      expect(batchPositions.every(validRuntimePosition)).toBe(true);
      expect(JSON.stringify(batchPositions[0])).not.toBe(JSON.stringify(batchPositions[1]));
      await expect(battlefieldCard(pageA, playerA.user.id, batchOneId)).toBeVisible({ timeout: 15_000 });
      await expect(battlefieldCard(pageA, playerA.user.id, batchTwoId)).toBeVisible({ timeout: 15_000 });
      const batchOneCss = await cardCssPosition(pageA, playerA.user.id, batchOneId);
      const batchTwoCss = await cardCssPosition(pageA, playerA.user.id, batchTwoId);
      expect(overlaps(batchOneCss, batchTwoCss)).toBe(false);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: { playerId: playerA.user.id, fromZone: 'hand', toZone: 'graveyard', instanceId: returnId },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.move'),
      });
      nextBaseVersion = outcome.version;
      expect(movedCard(outcome.patch)?.['position'] ?? null).toBeNull();

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: { playerId: playerA.user.id, fromZone: 'graveyard', toZone: 'battlefield', instanceId: returnId },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.move'),
      });
      nextBaseVersion = outcome.version;
      expect(validRuntimePosition(movedCard(outcome.patch)?.['position'] as JsonObject | undefined)).toBe(true);
      await expect(battlefieldCard(pageB, playerA.user.id, returnId)).toBeVisible({ timeout: 15_000 });
      const returnCss = await cardCssPosition(pageA, playerA.user.id, returnId);
      expect(nonOriginPosition(returnCss)).toBe(true);

      const snapshotAfterMoves = await gameSnapshot(request, gameId, playerA.token);
      for (const instanceId of [explicitId, defaultId, batchOneId, batchTwoId, returnId]) {
        const position = snapshotCardPosition(snapshotAfterMoves, playerA.user.id, instanceId);
        expect(validRuntimePosition(position), `snapshot position for ${instanceId}: ${JSON.stringify(position)}`).toBe(true);
      }

      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayer(pageA, playerA.user.displayName);
      for (const instanceId of [explicitId, defaultId, batchOneId, batchTwoId, returnId]) {
        await expect(battlefieldCard(pageA, playerA.user.id, instanceId)).toBeVisible({ timeout: 15_000 });
        expect(nonOriginPosition(await cardCssPosition(pageA, playerA.user.id, instanceId))).toBe(true);
      }

      const reconnectRefreshToken = await loginRefreshToken(request, playerB.credentials);
      const reconnectContext = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerB.user, reconnectRefreshToken) });
      await enableFrontendGameplayV2(reconnectContext);
      const reconnectPage = await reconnectContext.newPage();
      const reconnectFrames = collectWebSocketFrames(reconnectPage);
      await reconnectPage.goto(`/games/${gameId}`);
      await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(reconnectFrames);
      await focusPlayer(reconnectPage, playerA.user.displayName);
      for (const instanceId of [explicitId, defaultId, batchOneId, batchTwoId, returnId]) {
        await expect(battlefieldCard(reconnectPage, playerA.user.id, instanceId)).toBeVisible({ timeout: 15_000 });
        expect(nonOriginPosition(await cardCssPosition(reconnectPage, playerA.user.id, instanceId))).toBe(true);
      }
      expect(framesA.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(framesA.some((message) => message['kind'] === 'resync_required')).toBe(false);
      expect(framesB.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(framesB.some((message) => message['kind'] === 'resync_required')).toBe(false);
      expect(reconnectFrames.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(reconnectFrames.some((message) => message['kind'] === 'resync_required')).toBe(false);
      await reconnectContext.close();
      await commandPage.close();
      void nextBaseVersion;
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`Game runtime is not reachable at ${RUNTIME_READY_URL}; runtime release gates must not fall back to legacy.`);
  }
}

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { game?: { snapshot?: JsonObject } };
  return (payload.game?.snapshot ?? {}) as JsonObject;
}

async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  const snapshot = await gameSnapshot(request, gameId, token);
  return Math.max(1, Number(snapshot['version'] ?? 1));
}

function zoneInstanceIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const player = players?.[playerId];
  const zones = player?.['zones'] as Record<string, JsonObject[]> | undefined;
  return (zones?.[zone] ?? []).map((card) => String(card['instanceId'] ?? '')).filter((id) => id !== '');
}

async function websocketTicket(request: APIRequestContext, gameId: string, token: string): Promise<{ websocketUrl: string }> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { websocketUrl?: string };
  if (!payload.websocketUrl) {
    throw new Error('WebSocket ticket response did not include websocketUrl.');
  }
  return { websocketUrl: payload.websocketUrl };
}

async function loginRefreshToken(request: APIRequestContext, credentials: { email: string; password: string }): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/auth/login`, {
    data: {
      email: credentials.email,
      password: credentials.password,
    },
  });
  expect(response.ok()).toBeTruthy();
  const setCookie = response.headers()['set-cookie'] ?? '';
  const match = setCookie.match(/commanderzone\.refresh=([^;]+)/);
  const refreshToken = match?.[1] ?? '';
  expect(refreshToken.length).toBeGreaterThan(10);
  return refreshToken;
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

async function sendRuntimeCommandAndWait(
  page: Page,
  websocketUrl: string,
  frames: JsonObject[],
  options: {
    gameId: string;
    baseVersion: number;
    type: string;
    payload: JsonObject;
    ownerPatch: (patch: JsonObject) => boolean;
  },
): Promise<{ version: number; patch: JsonObject }> {
  const clientActionId = `movement-position-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const patchPromise = waitForPatchV2(frames, (patch) =>
    patch['ackClientActionId'] === clientActionId && options.ownerPatch(patch),
  );
  await page.evaluate(
    ({ url, payload }) => new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      const timeout = window.setTimeout(() => {
        socket.close();
        reject(new Error('Timed out sending raw WebSocket command.'));
      }, 15_000);
      socket.onopen = () => {
        socket.send(JSON.stringify(payload));
        window.clearTimeout(timeout);
        resolve();
      };
      socket.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Raw WebSocket connection failed.'));
      };
    }),
    {
      url: websocketUrl,
      payload: {
        kind: 'command',
        gameId: options.gameId,
        messageId: clientActionId,
        command: {
          type: options.type,
          payload: options.payload,
          baseVersion: options.baseVersion,
          clientActionId,
        },
      },
    },
  );
  const patch = await patchPromise;
  return { version: Math.max(options.baseVersion + 1, Number(patch['version'] ?? options.baseVersion + 1)), patch };
}

function waitForPatchV2(frames: JsonObject[], predicate: (message: JsonObject) => boolean): Promise<JsonObject> {
  return expect.poll(() => frames.find((message) => message['kind'] === 'patch.v2' && predicate(message)) ?? null, {
    timeout: 20_000,
  }).not.toBeNull().then(() => {
    const patch = frames.find((message) => message['kind'] === 'patch.v2' && predicate(message));
    if (!patch) {
      throw new Error(`patch.v2 frame was not captured. Recent patches: ${JSON.stringify(frames.filter((message) => message['kind'] === 'patch.v2').slice(-5), null, 2)}`);
    }
    return patch;
  });
}

async function waitForGameplayConnection(frames: JsonObject[]): Promise<void> {
  await expect.poll(() => frames.some((message) =>
    message['kind'] === 'connection_state' && message['status'] === 'connected',
  ), { timeout: 20_000 }).toBe(true);
}

function hasOp(message: JsonObject, op: string): boolean {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.some((item) => item['op'] === op);
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.find((item) => item['op'] === op) ?? null;
}

function movedCard(message: JsonObject): JsonObject | null {
  const move = operation(message, 'zone.cards.move');
  const card = move?.['card'];
  return card && typeof card === 'object' && !Array.isArray(card) ? card as JsonObject : null;
}

function batchMoveCards(message: JsonObject): JsonObject[] {
  const batch = operation(message, 'zone.cards.batchMove');
  const moves = Array.isArray(batch?.['moves']) ? batch['moves'] as JsonObject[] : [];
  return moves
    .map((move) => move['card'])
    .filter((card): card is JsonObject => Boolean(card) && typeof card === 'object' && !Array.isArray(card));
}

function battlefieldCard(page: Page, ownerPlayerId: string, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`);
}

async function cardCssPosition(page: Page, ownerPlayerId: string, instanceId: string): Promise<CssPosition> {
  return battlefieldCard(page, ownerPlayerId, instanceId).evaluate((element) => ({
    left: Number.parseFloat((element as HTMLElement).style.left || '0'),
    top: Number.parseFloat((element as HTMLElement).style.top || '0'),
  }));
}

function snapshotCardPosition(snapshot: JsonObject, playerId: string, instanceId: string): JsonObject | undefined {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const player = players?.[playerId];
  const zones = player?.['zones'] as Record<string, JsonObject[]> | undefined;
  return zones?.['battlefield']?.find((card) => card['instanceId'] === instanceId)?.['position'] as JsonObject | undefined;
}

function validRuntimePosition(position: JsonObject | undefined): boolean {
  if (!position || position['unit'] !== 'ratio') {
    return false;
  }
  const x = Number(position['x']);
  const y = Number(position['y']);
  return Number.isFinite(x) && Number.isFinite(y) && (x > 0 || y > 0);
}

function nonOriginPosition(position: CssPosition): boolean {
  return Number.isFinite(position.left) && Number.isFinite(position.top) && (position.left > 1 || position.top > 1);
}

function overlaps(left: CssPosition, right: CssPosition): boolean {
  return Math.abs(left.left - right.left) < 2 && Math.abs(left.top - right.top) < 2;
}

function nearPosition(left: CssPosition, right: CssPosition): boolean {
  return Math.abs(left.left - right.left) < 12 && Math.abs(left.top - right.top) < 12;
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
