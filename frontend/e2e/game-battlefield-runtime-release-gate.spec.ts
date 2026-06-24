import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { focusPlayer, readTableLife, readTableZoneCounts } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type BattlefieldRuntimeSetup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;

test.describe('battlefield/counters runtime release gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: BattlefieldRuntimeSetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertGameRuntimeReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `bf${Date.now().toString(36)}`,
      playerAPrefix: 'ba',
      playerBPrefix: 'bb',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('real browser sessions apply battlefield/counters runtime patch.v2 without snapshot refetch', async ({ browser, request, baseURL }) => {
    test.setTimeout(240_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const { gameId, playerA, playerB } = setup;
    const initialSnapshot = await gameSnapshot(request, gameId, playerA.token);
    const playerSnapshot = initialSnapshot.players?.[playerA.user.id] as JsonObject | undefined;
    const playerZones = (playerSnapshot?.['zones'] as JsonObject | undefined) ?? {};
    const handCards = Array.isArray(playerZones['hand']) ? playerZones['hand'] as JsonObject[] : [];
    const battlefieldIds = handCards
      .map((card) => String(card['instanceId'] ?? ''))
      .filter((id) => id !== '')
      .slice(0, 3);
    if (battlefieldIds.length < 3) {
      throw new Error(`Expected at least 3 hand cards for battlefield gate setup, got ${battlefieldIds.length}.`);
    }
    for (const instanceId of battlefieldIds) {
      await sendHttpCommand(request, gameId, playerA.token, 'card.moved', {
        playerId: playerA.user.id,
        fromZone: 'hand',
        toZone: 'battlefield',
        instanceId,
      });
    }
    let nextBaseVersion = await gameVersion(request, gameId, playerA.token);

    const contextA = await browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
    });
    const contextB = await browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken),
    });
    await Promise.all([
      enableFrontendGameplayV2(contextA),
      enableFrontendGameplayV2(contextB),
    ]);

    try {
      const debug = await openDebugObserver(contextA, request, gameId, playerA.token);
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      const commandPage = await contextA.newPage();
      const diagnosticsA = collectPageDiagnostics(pageA, gameId);
      const diagnosticsB = collectPageDiagnostics(pageB, gameId);
      const framesA = collectWebSocketFrames(pageA);
      const framesB = collectWebSocketFrames(pageB);
      let snapshotRefetches = 0;

      for (const page of [pageA, pageB]) {
        page.on('request', (httpRequest) => {
          const url = httpRequest.url();
          if (httpRequest.method() === 'GET' && (url.includes(`/games/${gameId}/snapshot`) || url.includes(`/games/${gameId}/bootstrap`))) {
            snapshotRefetches += 1;
          }
        });
      }

      await Promise.all([
        commandPage.goto('about:blank'),
        pageA.goto(`/games/${gameId}`),
        pageB.goto(`/games/${gameId}`),
      ]);
      try {
        await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
        await expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      } catch (error) {
        throw new Error(`${String(error)}

Player A diagnostics:
${diagnosticsA.join('\n')}
Player A URL: ${pageA.url()}
Player A body:
${(await pageA.locator('body').innerText().catch(() => '')).slice(0, 2000)}

Player B diagnostics:
${diagnosticsB.join('\n')}
Player B URL: ${pageB.url()}
Player B body:
${(await pageB.locator('body').innerText().catch(() => '')).slice(0, 2000)}`);
      }

      await Promise.all([
        waitForGameplayConnection(framesA),
        waitForGameplayConnection(framesB),
      ]);
      await focusPlayer(pageA, playerA.user.displayName);
      await focusPlayer(pageB, playerA.user.displayName);
      await expect(battlefieldCard(pageA, playerA.user.id, battlefieldIds[0])).toBeVisible({ timeout: 15_000 });
      await expect(battlefieldCard(pageB, playerA.user.id, battlefieldIds[0])).toBeVisible({ timeout: 15_000 });

      const initialCountsA = await readTableZoneCounts(pageA, playerA.user.displayName);
      const initialLifeA = await readTableLife(pageA, playerA.user.displayName);
      const refetchBaseline = snapshotRefetches;
      const ticket = await websocketTicket(request, gameId, playerA.token);

      let outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.tapped',
        payload: { instanceId: battlefieldIds[0], tapped: true },
        ownerPatch: (patch) => hasFieldPatch(patch, battlefieldIds[0], { tapped: true }),
      });
      nextBaseVersion = outcome.version;
      await waitForPatchV2(framesB, (patch) => hasFieldPatch(patch, battlefieldIds[0], { tapped: true }));
      await expect.poll(async () => (await battlefieldCard(pageA, playerA.user.id, battlefieldIds[0]).getAttribute('class')) ?? '').toContain('tapped');
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'battlefield.untap_all',
        payload: { playerId: playerA.user.id },
        ownerPatch: (patch) => hasFieldPatch(patch, battlefieldIds[0], { tapped: false }),
      });
      nextBaseVersion = outcome.version;
      await expect.poll(async () => (await battlefieldCard(pageA, playerA.user.id, battlefieldIds[0]).getAttribute('class')) ?? '').not.toContain('tapped');
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.position.changed',
        payload: { instanceId: battlefieldIds[0], position: { x: 0.4, y: 0.2, unit: 'ratio' } },
        ownerPatch: (patch) => hasFieldPatch(patch, battlefieldIds[0], { position: { x: 0.4, y: 0.2, unit: 'ratio' } }),
      });
      nextBaseVersion = outcome.version;
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'cards.position.changed',
        payload: {
          playerId: playerA.user.id,
          positions: [
            { instanceId: battlefieldIds[1], position: { x: 0.3, y: 0.35, unit: 'ratio' } },
            { instanceId: battlefieldIds[2], position: { x: 0.55, y: 0.45, unit: 'ratio' } },
          ],
        },
        ownerPatch: (patch) => fieldPatchCount(patch, 'position') >= 2,
      });
      nextBaseVersion = outcome.version;
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.counter.changed',
        payload: { instanceId: battlefieldIds[0], counter: 'charge', value: 2 },
        ownerPatch: (patch) => hasOp(patch, 'card.counters.patch'),
      });
      nextBaseVersion = outcome.version;
      expect(operation(outcome.patch, 'card.counters.patch')?.['counters']).toMatchObject({ charge: 2 });
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'counter.changed',
        payload: { scope: `player:${playerA.user.id}`, key: 'poison', value: 2 },
        ownerPatch: (patch) => hasOp(patch, 'player.counters.set'),
      });
      nextBaseVersion = outcome.version;
      expect(operation(outcome.patch, 'player.counters.set')?.['counters']).toMatchObject({ poison: 2 });
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'commander.damage.changed',
        payload: { targetPlayerId: playerA.user.id, commanderInstanceId: `${playerB.user.id}:commander`, damage: 7 },
        ownerPatch: (patch) => hasOp(patch, 'player.commanderDamage.set'),
      });
      nextBaseVersion = outcome.version;
      expect(operation(outcome.patch, 'player.commanderDamage.set')?.['commanderDamage']).toMatchObject({ [`${playerB.user.id}:commander`]: 7 });
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.power_toughness.changed',
        payload: { instanceId: battlefieldIds[0], power: 5, toughness: 6 },
        ownerPatch: (patch) => hasFieldPatch(patch, battlefieldIds[0], { power: 5, toughness: 6 }),
      });
      nextBaseVersion = outcome.version;
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'life.changed',
        payload: { playerId: playerA.user.id, delta: -1 },
        ownerPatch: (patch) => hasOp(patch, 'player.life.set'),
      });
      nextBaseVersion = outcome.version;
      await expect.poll(async () => readTableLife(pageA, playerA.user.displayName)).toBe(initialLifeA - 1);
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'turn.changed',
        payload: { activePlayerId: playerA.user.id, phase: 'combat', number: 2 },
        ownerPatch: (patch) => hasOp(patch, 'turn.set'),
      });
      nextBaseVersion = outcome.version;
      expect(operation(outcome.patch, 'turn.set')?.['turn']).toMatchObject({ activePlayerId: playerA.user.id, phase: 'combat', number: 2 });
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'dice.rolled',
        payload: { kind: 'd20', result: 13, playerId: playerA.user.id },
        ownerPatch: (patch) => hasOp(patch, 'dice.result'),
      });
      nextBaseVersion = outcome.version;
      expect(operation(outcome.patch, 'dice.result')).toMatchObject({ kind: 'd20', result: 13, playerId: playerA.user.id });
      expect(snapshotRefetches).toBe(refetchBaseline);

      for (const commandType of [
        'card.tapped',
        'battlefield.untap_all',
        'card.position.changed',
        'cards.position.changed',
        'card.counter.changed',
        'counter.changed',
        'commander.damage.changed',
        'card.power_toughness.changed',
        'life.changed',
        'turn.changed',
        'dice.rolled',
      ]) {
        const phases = await waitForActionHealth(debug.frames, commandType);
        expect(phases?.['gameplay.runtime_route']).toBe(1);
        expect(phases?.['gameplay.runtime_fallback_count']).toBe(0);
        expect(phases?.['gameplay.runtime_error_count']).toBe(0);
      }

      expect(initialCountsA.hand).toBeGreaterThanOrEqual(0);
      expect(framesA.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(framesB.some((message) => message['kind'] === 'game_patch')).toBe(false);
      await commandPage.close();
      await debug.page.close();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

async function sendHttpCommand(
  request: APIRequestContext,
  gameId: string,
  token: string,
  type: string,
  payload: JsonObject,
): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/commands`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type, payload },
  });
  expect(response.ok()).toBeTruthy();
}

async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { game?: { snapshot?: { version?: number } } };

  return Math.max(1, Number(payload.game?.snapshot?.version ?? 1));
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { game?: { snapshot?: JsonObject } };
  return (payload.game?.snapshot ?? {}) as JsonObject;
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

function collectPageDiagnostics(page: Page, gameId: string): string[] {
  const diagnostics: string[] = [];
  page.on('console', (message) => {
    diagnostics.push(`[console:${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    diagnostics.push(`[pageerror] ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    diagnostics.push(`[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes(`/games/${gameId}`) && response.status() >= 400) {
      diagnostics.push(`[response:${response.status()}] ${url}`);
    }
  });

  return diagnostics;
}

async function openDebugObserver(
  context: BrowserContext,
  request: APIRequestContext,
  gameId: string,
  token: string,
): Promise<{ page: Page; frames: JsonObject[] }> {
  const ticket = await websocketTicket(request, gameId, token);
  const debugUrl = debugWebsocketUrl(ticket.websocketUrl, gameId);
  const debugPage = await context.newPage();
  const frames = collectWebSocketFrames(debugPage);
  await debugPage.goto('about:blank');
  await debugPage.evaluate((url) => {
    const socket = new WebSocket(url);
    (window as unknown as { __commanderZoneDebugSocket?: WebSocket }).__commanderZoneDebugSocket = socket;
  }, debugUrl);
  await expect.poll(() => frames.some((message) => message['kind'] === 'debug_health'), { timeout: 15_000 }).toBe(true);

  return { page: debugPage, frames };
}

function debugWebsocketUrl(websocketUrl: string, gameId: string): string {
  const url = new URL(websocketUrl);
  const basePath = url.pathname.replace(/\/games\/[^/]+\/?$/, '');
  url.pathname = `${basePath}/games/${encodeURIComponent(gameId)}/debug`.replace(/\/{2,}/g, '/');
  url.searchParams.delete('lastSeenVersion');

  return url.toString();
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

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`Game runtime is not reachable at ${RUNTIME_READY_URL}; runtime release gates must not fall back to legacy.`);
  }
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
): Promise<{ version: number; patch: JsonObject; clientActionId: string }> {
  const clientActionId = `battlefield-runtime-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const patchPromise = waitForPatchV2(frames, (patch) =>
    patch['ackClientActionId'] === clientActionId && options.ownerPatch(patch),
  );
  const socketId = await openCommandSocketAndSend(page, websocketUrl, {
    kind: 'command',
    gameId: options.gameId,
    messageId: clientActionId,
    command: {
      type: options.type,
      payload: options.payload,
      baseVersion: options.baseVersion,
      clientActionId,
    },
  });

  try {
    const patch = await patchPromise;
    return {
      version: Math.max(options.baseVersion + 1, Number(patch['version'] ?? options.baseVersion + 1)),
      patch,
      clientActionId,
    };
  } catch (error) {
    const rawFrames = await commandSocketFrames(page, socketId);
    const legacyFallback = rawFrames.some((frame) =>
      typeof frame === 'object'
      && frame !== null
      && (frame as JsonObject)['kind'] === 'game_patch',
    );
    if (legacyFallback) {
      throw new Error(`Runtime gate received legacy game_patch for ${options.type}. Check GAME_RUNTIME_INTERNAL_URL, network alias game-runtime and allowlist before running this gate.
Raw command socket frames:
${JSON.stringify(rawFrames, null, 2)}`);
    }
    throw new Error(`${String(error)}
Raw command socket frames:
${JSON.stringify(rawFrames, null, 2)}`);
  } finally {
    await closeCommandSocket(page, socketId);
  }
}

async function openCommandSocketAndSend(page: Page, websocketUrl: string, message: JsonObject): Promise<string> {
  return page.evaluate(
    ({ url, payload }) => new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(url);
      const socketId = `battlefield-command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const timeout = window.setTimeout(() => {
        socket.close();
        reject(new Error('Timed out sending raw WebSocket command.'));
      }, 15_000);
      socket.onopen = () => {
        socket.send(JSON.stringify(payload));
        window.clearTimeout(timeout);
        const store = window as unknown as { __commanderZoneCommandSockets?: Record<string, WebSocket> };
        store.__commanderZoneCommandSockets = store.__commanderZoneCommandSockets ?? {};
        store.__commanderZoneCommandSockets[socketId] = socket;
        resolve(socketId);
      };
      socket.onmessage = (event) => {
        const store = window as unknown as { __commanderZoneCommandSocketFrames?: Record<string, unknown[]> };
        store.__commanderZoneCommandSocketFrames = store.__commanderZoneCommandSocketFrames ?? {};
        store.__commanderZoneCommandSocketFrames[socketId] = store.__commanderZoneCommandSocketFrames[socketId] ?? [];
        try {
          store.__commanderZoneCommandSocketFrames[socketId].push(JSON.parse(String(event.data)) as unknown);
        } catch {
          store.__commanderZoneCommandSocketFrames[socketId].push(String(event.data));
        }
      };
      socket.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Raw WebSocket connection failed.'));
      };
    }),
    { url: websocketUrl, payload: message },
  );
}

async function commandSocketFrames(page: Page, socketId: string): Promise<unknown[]> {
  return page.evaluate((id) => {
    const store = window as unknown as { __commanderZoneCommandSocketFrames?: Record<string, unknown[]> };
    return store.__commanderZoneCommandSocketFrames?.[id] ?? [];
  }, socketId);
}

async function closeCommandSocket(page: Page, socketId: string): Promise<void> {
  await page.evaluate((id) => {
    const store = window as unknown as { __commanderZoneCommandSockets?: Record<string, WebSocket> };
    const socket = store.__commanderZoneCommandSockets?.[id];
    if (socket) {
      socket.close();
      if (store.__commanderZoneCommandSockets) {
        delete store.__commanderZoneCommandSockets[id];
      }
    }
  }, socketId);
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

async function waitForActionHealth(frames: JsonObject[], action: string): Promise<JsonObject | null> {
  await expect.poll(() => {
    const phases = actionPhasesWithMetric(frames, action);
    return phases !== null && phases['gameplay.runtime_route'] !== undefined;
  }, { timeout: 15_000 }).toBe(true);

  return actionPhasesWithMetric(frames, action);
}

function actionPhasesWithMetric(frames: JsonObject[], action: string): JsonObject | null {
  for (const health of frames.filter((message) => message['kind'] === 'debug_health').reverse()) {
    const recent = ((((health['health'] as JsonObject | undefined)?.['actions'] as JsonObject | undefined)?.['recent']) ?? []) as JsonObject[];
    const match = recent.filter((item) => item['action'] === action).at(-1);
    const phases = (match?.['phases'] as JsonObject | undefined) ?? null;
    if (phases?.['gameplay.runtime_route'] !== undefined) {
      return phases;
    }
  }

  return null;
}

function hasOp(message: JsonObject, op: string): boolean {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.some((item) => item['op'] === op);
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.find((item) => item['op'] === op) ?? null;
}

function hasFieldPatch(message: JsonObject, instanceId: string, expected: JsonObject): boolean {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.some((item) => {
    if (item['op'] !== 'card.field.set' || item['instanceId'] !== instanceId) {
      return false;
    }
    return Object.entries(expected).every(([key, value]) => deepEqual(item[key], value));
  });
}

function fieldPatchCount(message: JsonObject, field: string): number {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.filter((item) => item['op'] === 'card.field.set' && item[field] !== undefined).length;
}

function battlefieldCard(page: Page, ownerPlayerId: string, instanceId: string): Locator {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(leftRecord[key], rightRecord[key]));
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
