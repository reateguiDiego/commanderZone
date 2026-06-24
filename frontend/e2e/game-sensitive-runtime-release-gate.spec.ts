import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type Setup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;

test.describe('sensitive privacy runtime release gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: Setup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertGameRuntimeReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `sens${Date.now().toString(36)}`,
      playerAPrefix: 'sa',
      playerBPrefix: 'sb',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('real browser sessions apply sensitive runtime patch.v2 without private leaks or snapshot refetch', async ({ browser, request, baseURL }) => {
    test.setTimeout(180_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const { gameId, playerA, playerB } = setup;
    const snapshot = await gameSnapshot(request, gameId, playerA.token);
    const handId = firstInstance(snapshot, playerA.user.id, 'hand');
    if (!handId) {
      throw new Error('Sensitive runtime gate needs at least one owner hand card.');
    }

    let nextBaseVersion = Math.max(1, Number(snapshot['version'] ?? 1));
    const contextA = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken) });
    const contextB = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken) });
    await Promise.all([enableFrontendGameplayV2(contextA), enableFrontendGameplayV2(contextB)]);

    try {
      const debug = await openDebugObserver(contextA, request, gameId, playerA.token);
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      const commandPage = await contextA.newPage();
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

      await Promise.all([commandPage.goto('about:blank'), pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
      await Promise.all([
        expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
      ]);
      await Promise.all([waitForGameplayConnection(framesA), waitForGameplayConnection(framesB)]);
      const refetchBaseline = snapshotRefetches;
      const ticket = await websocketTicket(request, gameId, playerA.token);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.face_down.changed',
        payload: { playerId: playerA.user.id, instanceId: handId, faceDown: true },
        ownerPatch: (patch) => hasOp(patch, 'card.field.set'),
      });
      expect(JSON.stringify(latestPatch(framesB))).not.toContain('cardKey');
      expect(JSON.stringify(latestPatch(framesB))).not.toContain(handId);
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.revealed',
        payload: { playerId: playerA.user.id, instanceId: handId, to: [playerA.user.id] },
        ownerPatch: (patch) => hasOp(patch, 'card.field.set') && JSON.stringify(patch).includes('cardKey'),
      });
      expect(JSON.stringify(latestPatch(framesB))).not.toContain('cardKey');
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.controller.changed',
        payload: { playerId: playerA.user.id, instanceId: handId, targetPlayerId: playerB.user.id },
        ownerPatch: (patch) => hasOp(patch, 'card.field.set'),
      });
      expect(JSON.stringify(latestPatch(framesB))).not.toContain('cardKey');
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'library.reveal',
        payload: { playerId: playerA.user.id, to: [playerA.user.id] },
        ownerPatch: (patch) => hasOp(patch, 'library.revealed.set') && JSON.stringify(patch).includes('cardKey'),
      });
      expect(JSON.stringify(latestPatch(framesB))).not.toContain('cardKey');
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'library.play_top_revealed',
        payload: { playerId: playerA.user.id, enabled: true },
        ownerPatch: (patch) => hasOp(patch, 'library.play_top_revealed.set') && hasOp(patch, 'library.top.revealed'),
      });
      expect(JSON.stringify(latestPatch(framesB))).toContain('library.top.revealed');
      expect(snapshotRefetches).toBe(refetchBaseline);

      await sendRejectedRuntimeCommand(commandPage, ticket.websocketUrl, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'zone.changed',
        payload: {
          playerId: playerA.user.id,
          zone: 'hand',
          cards: [{ instanceId: handId, cardKey: 'must-not-be-accepted' }],
        },
        expectedMessage: 'zone.changed runtime path accepts instanceIds only.',
      });
      expect(snapshotRefetches).toBe(refetchBaseline);

      for (const commandType of ['card.face_down.changed', 'card.revealed', 'card.controller.changed', 'library.reveal', 'library.play_top_revealed']) {
        const health = await waitForActionHealth(debug.frames, commandType);
        const phases = latestActionPhases(health, commandType);
        expect(phases?.['gameplay.runtime_route']).toBe(1);
        expect(phases?.['gameplay.runtime_fallback_count']).toBe(0);
        expect(phases?.['gameplay.runtime_error_count']).toBe(0);
      }
      expect(framesA.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(framesB.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(framesA.some((message) => message['kind'] === 'resync_required')).toBe(false);
      expect(framesB.some((message) => message['kind'] === 'resync_required')).toBe(false);

      await commandPage.close();
      await debug.page.close();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`Game runtime is not reachable at ${RUNTIME_READY_URL}; runtime release gates must not fall back to legacy.`);
  }
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { game?: { snapshot?: JsonObject } };
  return payload.game?.snapshot ?? {};
}

function firstInstance(snapshot: JsonObject, playerId: string, zone: string): string | null {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const player = players?.[playerId];
  const zones = player?.['zones'] as Record<string, JsonObject[]> | undefined;
  const cards = zones?.[zone] ?? [];
  const instanceId = cards[0]?.['instanceId'];
  return typeof instanceId === 'string' ? instanceId : null;
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

async function openDebugObserver(context: BrowserContext, request: APIRequestContext, gameId: string, token: string): Promise<{ page: Page; frames: JsonObject[] }> {
  const ticket = await websocketTicket(request, gameId, token);
  const url = new URL(ticket.websocketUrl);
  const basePath = url.pathname.replace(/\/games\/[^/]+\/?$/, '');
  url.pathname = `${basePath}/games/${encodeURIComponent(gameId)}/debug`.replace(/\/{2,}/g, '/');
  url.searchParams.delete('lastSeenVersion');
  const debugPage = await context.newPage();
  const frames = collectWebSocketFrames(debugPage);
  await debugPage.goto('about:blank');
  await debugPage.evaluate((debugUrl) => {
    const socket = new WebSocket(debugUrl);
    (window as unknown as { __commanderZoneDebugSocket?: WebSocket }).__commanderZoneDebugSocket = socket;
  }, url.toString());
  await expect.poll(() => frames.some((message) => message['kind'] === 'debug_health'), { timeout: 15_000 }).toBe(true);
  return { page: debugPage, frames };
}

async function waitForGameplayConnection(frames: JsonObject[]): Promise<void> {
  await expect.poll(() => frames.some((message) =>
    message['kind'] === 'connection_state' && message['status'] === 'connected',
  ), { timeout: 20_000 }).toBe(true);
}

async function sendRuntimeCommandAndWait(
  page: Page,
  websocketUrl: string,
  frames: JsonObject[],
  options: { gameId: string; baseVersion: number; type: string; payload: JsonObject; ownerPatch: (patch: JsonObject) => boolean },
): Promise<number> {
  const clientActionId = `sensitive-runtime-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const patchPromise = waitForPatchV2(frames, (patch) => patch['ackClientActionId'] === clientActionId && options.ownerPatch(patch));
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
    return Math.max(options.baseVersion + 1, Number(patch['version'] ?? options.baseVersion + 1));
  } catch (error) {
    const rawFrames = await commandSocketFrames(page, socketId);
    const legacyFallback = rawFrames.some((frame) => typeof frame === 'object' && frame !== null && (frame as JsonObject)['kind'] === 'game_patch');
    if (legacyFallback) {
      throw new Error(`Runtime gate received legacy game_patch for ${options.type}.\nRaw command socket frames:\n${JSON.stringify(rawFrames, null, 2)}`);
    }
    throw new Error(`${String(error)}\nRaw command socket frames:\n${JSON.stringify(rawFrames, null, 2)}`);
  } finally {
    await closeCommandSocket(page, socketId);
  }
}

async function sendRejectedRuntimeCommand(
  page: Page,
  websocketUrl: string,
  options: { gameId: string; baseVersion: number; type: string; payload: JsonObject; expectedMessage: string },
): Promise<void> {
  const clientActionId = `sensitive-runtime-rejected-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
    await expect.poll(async () => {
      const frames = await commandSocketFrames(page, socketId);
      return frames.find((frame) => {
        if (typeof frame !== 'object' || frame === null) {
          return false;
        }
        const message = frame as JsonObject;
        return message['kind'] === 'command_ack'
          && message['clientActionId'] === clientActionId
          && message['status'] === 'rejected'
          && JSON.stringify(message).includes(options.expectedMessage);
      }) ?? null;
    }, { timeout: 15_000 }).not.toBeNull();

    const frames = await commandSocketFrames(page, socketId);
    if (frames.some((frame) => typeof frame === 'object' && frame !== null && (frame as JsonObject)['kind'] === 'game_patch')) {
      throw new Error(`Rejected runtime command unexpectedly produced legacy game_patch:\n${JSON.stringify(frames, null, 2)}`);
    }
  } finally {
    await closeCommandSocket(page, socketId);
  }
}

async function openCommandSocketAndSend(page: Page, websocketUrl: string, message: JsonObject): Promise<string> {
  return page.evaluate(({ url, payload }) => new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(url);
    const socketId = `sensitive-command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
  }), { url: websocketUrl, payload: message });
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
  return expect.poll(() => frames.find((message) => message['kind'] === 'patch.v2' && predicate(message)) ?? null, { timeout: 20_000 })
    .not.toBeNull()
    .then(() => {
      const patch = frames.find((message) => message['kind'] === 'patch.v2' && predicate(message));
      if (!patch) {
        throw new Error(`patch.v2 frame was not captured. Recent patches: ${JSON.stringify(frames.filter((message) => message['kind'] === 'patch.v2').slice(-5), null, 2)}`);
      }
      return patch;
    });
}

function latestPatch(frames: JsonObject[]): JsonObject {
  const patch = frames.filter((message) => message['kind'] === 'patch.v2').at(-1);
  if (!patch) {
    throw new Error('No patch.v2 frame captured.');
  }
  return patch;
}

async function waitForActionHealth(frames: JsonObject[], action: string): Promise<JsonObject> {
  await expect.poll(() => latestActionPhasesFromFrames(frames, action)?.['gameplay.runtime_route'] !== undefined, { timeout: 15_000 }).toBe(true);
  return { health: { actions: { recent: [{ action, phases: latestActionPhasesFromFrames(frames, action) }] } } };
}

function latestActionPhases(health: JsonObject, action: string): JsonObject | null {
  const recent = (((health.health as JsonObject | undefined)?.['actions'] as JsonObject | undefined)?.['recent'] ?? []) as JsonObject[];
  const match = recent.filter((item) => item['action'] === action).at(-1);
  return (match?.['phases'] as JsonObject | undefined) ?? null;
}

function latestActionPhasesFromFrames(frames: JsonObject[], action: string): JsonObject | null {
  for (const health of frames.filter((message) => message['kind'] === 'debug_health').reverse()) {
    const phases = latestActionPhases(health, action);
    if (phases?.['gameplay.runtime_route'] !== undefined) {
      return phases;
    }
  }
  return null;
}

function hasOp(message: JsonObject, op: string): boolean {
  const ops = (message['ops'] ?? []) as JsonObject[];
  return ops.some((operation) => operation['op'] === op);
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  try {
    return JSON.parse(String(payload)) as JsonObject;
  } catch {
    return null;
  }
}
