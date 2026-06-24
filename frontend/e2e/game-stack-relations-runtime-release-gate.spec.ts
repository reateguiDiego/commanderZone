import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { focusPlayer } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type StackRelationsRuntimeSetup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;

const STACK_RELATION_COMMANDS = [
  'stack.card_added',
  'stack.item_removed',
  'arrow.created',
  'arrow.removed',
  'attachment.created',
  'attachment.removed',
  'helper.created',
  'helper.updated',
  'helper.removed',
] as const;

test.describe('stack/relations runtime release gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: StackRelationsRuntimeSetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertGameRuntimeReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `sr${Date.now().toString(36)}`,
      playerAPrefix: 'sa',
      playerBPrefix: 'sb',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('real browser sessions apply stack/relation/helper patch.v2 without snapshot refetch', async ({ browser, request, baseURL }) => {
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
      throw new Error(`Expected at least 3 hand cards for stack/relations gate setup, got ${battlefieldIds.length}.`);
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

      const refetchBaseline = snapshotRefetches;
      const ticket = await websocketTicket(request, gameId, playerA.token);

      let outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'stack.card_added',
        payload: { playerId: playerA.user.id, instanceId: battlefieldIds[0], text: 'Runtime stack item' },
        ownerPatch: (patch) => hasOp(patch, 'stack.item.add'),
      });
      nextBaseVersion = outcome.version;
      await waitForPatchV2(framesB, (patch) => hasOp(patch, 'stack.item.add'));
      assertNoStaticPayload(outcome.patch);
      const stackId = stringFromNestedOperation(outcome.patch, 'stack.item.add', ['item', 'stackId'])
        ?? stringFromNestedOperation(outcome.patch, 'stack.item.add', ['item', 'id']);
      expect(stackId).toBeTruthy();
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'stack.item_removed',
        payload: { stackId },
        ownerPatch: (patch) => hasOp(patch, 'stack.item.remove'),
      });
      nextBaseVersion = outcome.version;
      assertNoStaticPayload(outcome.patch);
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'arrow.created',
        payload: {
          playerId: playerA.user.id,
          fromInstanceId: battlefieldIds[0],
          toInstanceId: battlefieldIds[1],
          color: 'blue',
          imageUris: { normal: 'must-not-leak' },
          oracleText: 'must-not-leak',
          cardFaces: ['must-not-leak'],
        },
        ownerPatch: (patch) => hasOp(patch, 'arrow.add'),
      });
      nextBaseVersion = outcome.version;
      await waitForPatchV2(framesB, (patch) => hasOp(patch, 'arrow.add'));
      assertNoStaticPayload(outcome.patch);
      const arrowId = stringFromNestedOperation(outcome.patch, 'arrow.add', ['arrow', 'id']);
      expect(arrowId).toBeTruthy();
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'arrow.removed',
        payload: { id: arrowId },
        ownerPatch: (patch) => hasOp(patch, 'arrow.remove'),
      });
      nextBaseVersion = outcome.version;
      assertNoStaticPayload(outcome.patch);
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'attachment.created',
        payload: {
          playerId: playerA.user.id,
          equipmentInstanceId: battlefieldIds[1],
          attachedToInstanceId: battlefieldIds[0],
        },
        ownerPatch: (patch) => hasOp(patch, 'attachment.add'),
      });
      nextBaseVersion = outcome.version;
      await waitForPatchV2(framesB, (patch) => hasOp(patch, 'attachment.add'));
      assertNoStaticPayload(outcome.patch);
      const attachmentId = stringFromNestedOperation(outcome.patch, 'attachment.add', ['attachment', 'id']);
      expect(attachmentId).toBeTruthy();
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'attachment.removed',
        payload: { id: attachmentId },
        ownerPatch: (patch) => hasOp(patch, 'attachment.remove'),
      });
      nextBaseVersion = outcome.version;
      assertNoStaticPayload(outcome.patch);
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'helper.created',
        payload: {
          playerId: playerA.user.id,
          template: 'citys_blessing',
          scope: 'player',
          ownerPlayerId: playerA.user.id,
          state: { label: 'Runtime blessing' },
          card: {
            scryfallId: 'runtime-citys-blessing',
            name: 'Runtime Citys Blessing',
            imageUris: { normal: 'must-not-leak' },
            oracleText: 'must-not-leak',
            cardFaces: ['must-not-leak'],
          },
        },
        ownerPatch: (patch) => hasOp(patch, 'helper.add'),
      });
      nextBaseVersion = outcome.version;
      await waitForPatchV2(framesB, (patch) => hasOp(patch, 'helper.add'));
      assertNoStaticPayload(outcome.patch);
      const helperId = stringFromNestedOperation(outcome.patch, 'helper.add', ['entity', 'id']);
      expect(helperId).toBeTruthy();
      await expect(pageA.getByTestId('special-entity-strip').filter({ hasText: /City|Blessing/i }).first()).toBeVisible({ timeout: 15_000 });
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'helper.updated',
        payload: { entityId: helperId, state: { label: 'Runtime blessing updated' } },
        ownerPatch: (patch) => hasOp(patch, 'helper.update'),
      });
      nextBaseVersion = outcome.version;
      assertNoStaticPayload(outcome.patch);
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'helper.removed',
        payload: { entityId: helperId },
        ownerPatch: (patch) => hasOp(patch, 'helper.remove'),
      });
      nextBaseVersion = outcome.version;
      assertNoStaticPayload(outcome.patch);
      await expect(pageA.getByTestId('special-entity-strip').filter({ hasText: /City|Blessing/i }).first()).toHaveCount(0, { timeout: 15_000 });
      expect(snapshotRefetches).toBe(refetchBaseline);

      for (const commandType of STACK_RELATION_COMMANDS) {
        const phases = await waitForActionHealth(debug.frames, commandType);
        expect(phases?.['gameplay.runtime_route']).toBe(1);
        expect(phases?.['gameplay.runtime_fallback_count']).toBe(0);
        expect(phases?.['gameplay.runtime_error_count']).toBe(0);
        if (commandType.startsWith('stack.')) {
          expect(phases?.['stack.runtime_route']).toBe(1);
          expect(phases?.['stack.static_payload_bytes']).toBe(0);
        } else {
          expect(phases?.['relations.runtime_route']).toBe(1);
          expect(phases?.['relations.full_scan_count']).toBe(0);
        }
      }

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
  const clientActionId = `stack-relations-runtime-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
      const socketId = `stack-relations-command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

function stringFromNestedOperation(message: JsonObject, op: string, path: readonly string[]): string | null {
  let value: unknown = operation(message, op);
  for (const segment of path) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    value = (value as JsonObject)[segment];
  }

  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function assertNoStaticPayload(message: JsonObject): void {
  const encoded = JSON.stringify(message);
  expect(encoded).not.toContain('imageUris');
  expect(encoded).not.toContain('oracleText');
  expect(encoded).not.toContain('cardFaces');
  expect(encoded).not.toContain('must-not-leak');
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
