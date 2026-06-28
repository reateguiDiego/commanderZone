import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { focusPlayer } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type GameplaySemanticsSetup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;

test.describe('product correctness gameplay semantics runtime gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: GameplaySemanticsSetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertGameRuntimeReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `semantics${Date.now().toString(36)}`,
      playerAPrefix: 'sa',
      playerBPrefix: 'sb',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('commander cast count and special counters are runtime-authoritative across refresh and reconnect', async ({ browser, request, baseURL }) => {
    test.setTimeout(300_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const { gameId, playerA, playerB } = setup;
    const initialSnapshot = await gameSnapshot(request, gameId, playerA.token);
    const commander = commandZoneCards(initialSnapshot, playerA.user.id).find((card) => card['isCommander'] === true)
      ?? commandZoneCards(initialSnapshot, playerA.user.id)[0];
    if (!commander) {
      throw new Error('Gameplay semantics gate requires a commander in the command zone.');
    }
    const opposingCommander = commandZoneCards(initialSnapshot, playerB.user.id).find((card) => card['isCommander'] === true)
      ?? commandZoneCards(initialSnapshot, playerB.user.id)[0];
    if (!opposingCommander) {
      throw new Error('Gameplay semantics gate requires an opposing commander in the command zone.');
    }
    const commanderId = String(commander['instanceId']);
    const opposingCommanderId = String(opposingCommander['instanceId']);
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

      const castOutcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'command',
          toZone: 'battlefield',
          instanceId: commanderId,
          position: { x: 0.21, y: 0.24, unit: 'ratio' },
        },
        ownerPatch: (patch) => hasOp(patch, 'game.counters.set') && commanderCastsFromPatch(patch, commanderId) === 1,
      });
      nextBaseVersion = castOutcome.version;
      expect(commanderCastsFromPatch(castOutcome.patch, commanderId)).toBe(1);
      await waitForPatchV2(framesB, (patch) => commanderCastsFromPatch(patch, commanderId) === 1);
      await expect(gameCard(pageA, playerA.user.id, commanderId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      await expect(gameCard(pageB, playerA.user.id, commanderId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      await expect(commanderCastCount(pageA, playerA.user.id, commanderId)).toHaveText('1', { timeout: 15_000 });
      await expect(commanderCastCount(pageB, playerA.user.id, commanderId)).toHaveText('1', { timeout: 15_000 });
      expect(bootstrapRequests).toBe(baselineBootstrapRequests);

      const beforeRetry = await gameSnapshot(request, gameId, playerA.token);
      expect(commanderCastsFromSnapshot(beforeRetry, commanderId)).toBe(1);
      await sendRawRuntimeCommand(commandPage, ticket.websocketUrl, {
        gameId,
        clientActionId: castOutcome.clientActionId,
        baseVersion: castOutcome.baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'command',
          toZone: 'battlefield',
          instanceId: commanderId,
          position: { x: 0.21, y: 0.24, unit: 'ratio' },
        },
      });
      await expect.poll(async () => commanderCastsFromSnapshot(await gameSnapshot(request, gameId, playerA.token), commanderId), {
        timeout: 10_000,
      }).toBe(1);

      let counterOutcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'counter.changed',
        payload: { scope: `player:${playerA.user.id}`, key: 'poison', value: 2 },
        ownerPatch: (patch) => playerCounterFromPatch(patch, playerA.user.id, 'poison') === 2,
      });
      nextBaseVersion = counterOutcome.version;
      counterOutcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'counter.changed',
        payload: { scope: `player:${playerA.user.id}`, key: 'energy', value: 3 },
        ownerPatch: (patch) => playerCounterFromPatch(patch, playerA.user.id, 'energy') === 3,
      });
      nextBaseVersion = counterOutcome.version;
      counterOutcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'counter.changed',
        payload: { scope: `player:${playerA.user.id}`, key: 'experience', value: 4 },
        ownerPatch: (patch) => playerCounterFromPatch(patch, playerA.user.id, 'experience') === 4,
      });
      nextBaseVersion = counterOutcome.version;
      const damageOutcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'commander.damage.changed',
        payload: { targetPlayerId: playerA.user.id, commanderInstanceId: opposingCommanderId, damage: 7 },
        ownerPatch: (patch) => commanderDamageFromPatch(patch, opposingCommanderId) === 7,
      });
      nextBaseVersion = damageOutcome.version;
      const helperOutcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'helper.created',
        payload: {
          playerId: playerA.user.id,
          template: 'citys_blessing',
          scope: 'player',
          ownerPlayerId: playerA.user.id,
          state: { label: 'Runtime blessing' },
        },
        ownerPatch: (patch) => hasOp(patch, 'helper.add'),
      });
      nextBaseVersion = helperOutcome.version;
      void nextBaseVersion;

      const semanticSnapshot = await gameSnapshot(request, gameId, playerA.token);
      expect(commanderCastsFromSnapshot(semanticSnapshot, commanderId)).toBe(1);
      expect(playerCounterFromSnapshot(semanticSnapshot, playerA.user.id, 'poison')).toBe(2);
      expect(playerCounterFromSnapshot(semanticSnapshot, playerA.user.id, 'energy')).toBe(3);
      expect(playerCounterFromSnapshot(semanticSnapshot, playerA.user.id, 'experience')).toBe(4);
      expect(commanderDamageFromSnapshot(semanticSnapshot, playerA.user.id, opposingCommanderId)).toBe(7);
      expect(hasSpecialEntity(semanticSnapshot, 'citys_blessing', playerA.user.id)).toBe(true);

      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayer(pageA, playerA.user.displayName);
      await expect(gameCard(pageA, playerA.user.id, commanderId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      await expect(commanderCastCount(pageA, playerA.user.id, commanderId)).toHaveText('1', { timeout: 15_000 });

      const reconnectRefreshToken = await loginRefreshToken(request, playerB.credentials);
      const reconnectContext = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerB.user, reconnectRefreshToken) });
      await enableFrontendGameplayV2(reconnectContext);
      const reconnectPage = await reconnectContext.newPage();
      const reconnectFrames = collectWebSocketFrames(reconnectPage);
      await reconnectPage.goto(`/games/${gameId}`);
      await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(reconnectFrames);
      await focusPlayer(reconnectPage, playerA.user.displayName);
      await expect(gameCard(reconnectPage, playerA.user.id, commanderId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      await expect(commanderCastCount(reconnectPage, playerA.user.id, commanderId)).toHaveText('1', { timeout: 15_000 });

      expect(framesA.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(framesA.some((message) => message['kind'] === 'resync_required')).toBe(false);
      expect(framesB.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(framesB.some((message) => message['kind'] === 'resync_required')).toBe(false);
      expect(reconnectFrames.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(reconnectFrames.some((message) => message['kind'] === 'resync_required')).toBe(false);
      await reconnectContext.close();
      await commandPage.close();
    } finally {
      await contextA.close();
      await contextB.close().catch(() => undefined);
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
): Promise<{ version: number; patch: JsonObject; clientActionId: string; baseVersion: number }> {
  const clientActionId = `gameplay-semantics-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const patchPromise = waitForPatchV2(frames, (patch) =>
    patch['ackClientActionId'] === clientActionId && options.ownerPatch(patch),
  );
  await sendRawRuntimeCommand(page, websocketUrl, {
    gameId: options.gameId,
    clientActionId,
    baseVersion: options.baseVersion,
    type: options.type,
    payload: options.payload,
  });
  const patch = await patchPromise;
  return { version: Math.max(options.baseVersion + 1, Number(patch['version'] ?? options.baseVersion + 1)), patch, clientActionId, baseVersion: options.baseVersion };
}

async function sendRawRuntimeCommand(
  page: Page,
  websocketUrl: string,
  options: {
    gameId: string;
    clientActionId: string;
    baseVersion: number;
    type: string;
    payload: JsonObject;
  },
): Promise<void> {
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
        messageId: options.clientActionId,
        command: {
          type: options.type,
          payload: options.payload,
          baseVersion: options.baseVersion,
          clientActionId: options.clientActionId,
        },
      },
    },
  );
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

function commanderCastsFromPatch(message: JsonObject, commanderId: string): number | null {
  const counters = operation(message, 'game.counters.set');
  if (counters?.['scope'] !== `commander:${commanderId}`) {
    return null;
  }
  const values = counters['counters'] as JsonObject | undefined;
  return Number(values?.['casts'] ?? Number.NaN);
}

function playerCounterFromPatch(message: JsonObject, playerId: string, key: string): number | null {
  const counters = operation(message, 'player.counters.set');
  if (counters?.['playerId'] !== playerId) {
    return null;
  }
  const values = counters['counters'] as JsonObject | undefined;
  return Number(values?.[key] ?? Number.NaN);
}

function commanderDamageFromPatch(message: JsonObject, commanderId: string): number | null {
  const damage = operation(message, 'player.commanderDamage.set')?.['commanderDamage'] as JsonObject | undefined;
  return Number(damage?.[commanderId] ?? Number.NaN);
}

function commandZoneCards(snapshot: JsonObject, playerId: string): JsonObject[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return zones?.['command'] ?? [];
}

function commanderCastsFromSnapshot(snapshot: JsonObject, commanderId: string): number {
  const counters = snapshot['counters'] as Record<string, JsonObject> | undefined;
  return Number(counters?.[`commander:${commanderId}`]?.['casts'] ?? 0);
}

function playerCounterFromSnapshot(snapshot: JsonObject, playerId: string, key: string): number {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const counters = players?.[playerId]?.['counters'] as JsonObject | undefined;
  return Number(counters?.[key] ?? 0);
}

function commanderDamageFromSnapshot(snapshot: JsonObject, targetPlayerId: string, commanderId: string): number {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const damage = players?.[targetPlayerId]?.['commanderDamage'] as JsonObject | undefined;
  return Number(damage?.[commanderId] ?? 0);
}

function hasSpecialEntity(snapshot: JsonObject, template: string, playerId: string): boolean {
  const entities = Array.isArray(snapshot['specialEntities']) ? snapshot['specialEntities'] as JsonObject[] : [];
  return entities.some((entity) => entity['template'] === template && entity['ownerPlayerId'] === playerId);
}

function gameCard(page: Page, ownerPlayerId: string, instanceId: string, zone: string) {
  return page.locator(`[data-testid="game-card"][data-zone="${zone}"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`);
}

function commanderCastCount(page: Page, playerId: string, commanderId: string) {
  return page.locator(`[data-testid="commander-cast-count"][data-player-id="${playerId}"][data-card-id="${commanderId}"]`);
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
