import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { readTableZoneCounts } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type LibraryRuntimeSetup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;

test.describe('library runtime release gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: LibraryRuntimeSetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertGameRuntimeReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `lib${Date.now().toString(36)}`,
      playerAPrefix: 'la',
      playerBPrefix: 'lb',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('real browser sessions apply library runtime patch.v2 without snapshot refetch', async ({ browser, request, baseURL }) => {
    test.setTimeout(180_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const { gameId, playerA, playerB } = setup;
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

      const initialCountsA = await readTableZoneCounts(pageA, playerA.user.displayName);
      const refetchBaseline = snapshotRefetches;

      const ticket = await websocketTicket(request, gameId, playerA.token);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'library.draw',
        payload: { playerId: playerA.user.id },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.add'),
      });
      const drawOwnerPatch = latestPatchWithOp(framesA, 'zone.cards.add');
      const drawRivalPatch = latestPatch(framesB);
      expect(hasOp(drawOwnerPatch, 'zone.cards.add')).toBe(true);
      expect(hasOp(drawRivalPatch, 'zone.cards.add')).toBe(false);
      expect(hasOnlyPublicCountsForPlayer(drawRivalPatch, playerA.user.id)).toBe(true);
      await expect.poll(async () => readTableZoneCounts(pageA, playerA.user.displayName)).toEqual({
        hand: initialCountsA.hand + 1,
        library: initialCountsA.library - 1,
      });
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'library.draw_many',
        payload: { playerId: playerA.user.id, count: 2 },
        ownerPatch: (patch) => zoneCardsAddedCount(patch) === 2,
      });
      expect(zoneCardsAddedCount(latestPatchWithOp(framesA, 'zone.cards.add'))).toBe(2);
      await expect.poll(async () => readTableZoneCounts(pageA, playerA.user.displayName)).toEqual({
        hand: initialCountsA.hand + 3,
        library: initialCountsA.library - 3,
      });
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'library.view',
        payload: { playerId: playerA.user.id, count: 3 },
        ownerPatch: (patch) => hasOp(patch, 'library.top.viewed'),
      });
      const viewedPatch = latestPatchWithOp(framesA, 'library.top.viewed');
      const viewedIds = cardIdsFromLibraryPatch(viewedPatch, 'library.top.viewed');
      expect(viewedIds.length).toBeGreaterThanOrEqual(3);
      expect(hasOp(latestPatch(framesB), 'library.top.viewed')).toBe(false);
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'library.reorder_top',
        payload: { playerId: playerA.user.id, instanceIds: [...viewedIds.slice(0, 3)].reverse() },
        ownerPatch: (patch) => hasOp(patch, 'library.top.reordered'),
      });
      expect(operation(latestPatchWithOp(framesA, 'library.top.reordered'), 'library.top.reordered')?.['instanceIds']).toEqual([...viewedIds.slice(0, 3)].reverse());
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'library.reveal_top',
        payload: { playerId: playerA.user.id, count: 1, to: [playerA.user.id] },
        ownerPatch: (patch) => hasOp(patch, 'library.top.revealed'),
      });
      const revealOwnerPatch = latestPatchWithOp(framesA, 'library.top.revealed');
      const revealRivalPatch = latestPatch(framesB);
      expect(cardIdsFromLibraryPatch(revealOwnerPatch, 'library.top.revealed').length).toBe(1);
      expect(JSON.stringify(operation(revealOwnerPatch, 'library.top.revealed'))).toContain('cardKey');
      expect(hasOp(revealRivalPatch, 'library.top.revealed')).toBe(false);
      expect(JSON.stringify(revealRivalPatch)).not.toContain('cardKey');
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'library.move_top',
        payload: { playerId: playerA.user.id, count: 1, toZone: 'library', position: 'bottom' },
        ownerPatch: (patch) => hasOp(patch, 'library.top.moved'),
      });
      await expect.poll(async () => readTableZoneCounts(pageA, playerA.user.displayName)).toEqual({
        hand: initialCountsA.hand + 3,
        library: initialCountsA.library - 3,
      });
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'library.shuffle',
        payload: { playerId: playerA.user.id },
        ownerPatch: (patch) => hasOp(patch, 'library.shuffled'),
      });
      const shufflePatch = latestPatchWithOp(framesA, 'library.shuffled');
      expect(Number(operation(shufflePatch, 'library.shuffled')?.['visibilityEpoch'] ?? 0)).toBeGreaterThan(0);
      expect(snapshotRefetches).toBe(refetchBaseline);

      for (const commandType of ['library.draw', 'library.draw_many', 'library.view', 'library.reorder_top', 'library.reveal_top', 'library.move_top', 'library.shuffle']) {
        const health = await waitForActionHealth(debug.frames, commandType);
        const phases = latestActionPhases(health, commandType);
        expect(phases?.['gameplay.runtime_route']).toBe(1);
        expect(phases?.['gameplay.runtime_fallback_count']).toBe(0);
        expect(phases?.['gameplay.runtime_error_count']).toBe(0);
      }

      await commandPage.close();
      await debug.page.close();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { game?: { snapshot?: { version?: number } } };

  return Math.max(1, Number(payload.game?.snapshot?.version ?? 1));
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
): Promise<number> {
  const clientActionId = `library-runtime-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

    return Math.max(options.baseVersion + 1, Number(patch['version'] ?? options.baseVersion + 1));
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
      const socketId = `library-command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
  }).catch((error: unknown) => {
    throw new Error(`${String(error)}\nRecent patches: ${JSON.stringify(frames.filter((message) => message['kind'] === 'patch.v2').slice(-5), null, 2)}`);
  });
}

async function waitForGameplayConnection(frames: JsonObject[]): Promise<void> {
  await expect.poll(() => frames.some((message) =>
    message['kind'] === 'connection_state' && message['status'] === 'connected',
  ), { timeout: 20_000 }).toBe(true);
}

async function waitForActionHealth(frames: JsonObject[], action: string): Promise<JsonObject> {
  try {
    await expect.poll(() => {
      const phases = actionPhasesWithMetric(frames, action);
      return phases !== null && phases['gameplay.runtime_route'] !== undefined;
    }, { timeout: 15_000 }).toBe(true);
  } catch (error) {
    throw new Error(`${String(error)}
Recent debug health frames:
${JSON.stringify(frames.filter((message) => message['kind'] === 'debug_health').slice(-3), null, 2)}`);
  }
  const phases = actionPhasesWithMetric(frames, action);
  return { health: { actions: { recent: [{ action, phases }] } } };
}

function latestDebugHealth(frames: JsonObject[]): JsonObject | null {
  return frames.filter((message) => message['kind'] === 'debug_health').at(-1) ?? null;
}

function latestActionPhases(health: JsonObject, action: string): JsonObject | null {
  const recent = (((health.health as JsonObject | undefined)?.['actions'] as JsonObject | undefined)?.['recent'] ?? []) as JsonObject[];
  const match = recent.filter((item) => item['action'] === action).at(-1);
  return (match?.['phases'] as JsonObject | undefined) ?? null;
}

function actionPhasesWithMetric(frames: JsonObject[], action: string): JsonObject | null {
  for (const health of frames.filter((message) => message['kind'] === 'debug_health').reverse()) {
    const phases = latestActionPhases(health, action);
    if (phases?.['gameplay.runtime_route'] !== undefined) {
      return phases;
    }
  }

  return null;
}

function latestPatch(frames: JsonObject[]): JsonObject {
  const patch = frames.filter((message) => message['kind'] === 'patch.v2').at(-1);
  if (!patch) {
    throw new Error('No patch.v2 frame captured.');
  }

  return patch;
}

function latestPatchWithOp(frames: JsonObject[], op: string): JsonObject {
  const patch = frames.filter((message) => message['kind'] === 'patch.v2' && hasOp(message, op)).at(-1);
  if (!patch) {
    throw new Error(`No patch.v2 frame captured for op ${op}.`);
  }

  return patch;
}

function hasOp(message: JsonObject, op: string): boolean {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.some((item) => item['op'] === op);
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.find((item) => item['op'] === op) ?? null;
}

function zoneCardsAddedCount(message: JsonObject): number {
  const op = operation(message, 'zone.cards.add');
  const cards = Array.isArray(op?.['cards']) ? op['cards'] as JsonObject[] : [];

  return cards.length;
}

function cardIdsFromLibraryPatch(message: JsonObject, opName: string): string[] {
  const op = operation(message, opName);
  const cards = Array.isArray(op?.['cards']) ? op['cards'] as JsonObject[] : [];

  return cards.map((card) => String(card['instanceId'] ?? '')).filter((id) => id !== '');
}

function hasOnlyPublicCountsForPlayer(message: JsonObject, playerId: string): boolean {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.length > 0 && ops.every((op) =>
    op['op'] === 'zone.count.set'
    && op['playerId'] === playerId
    && (op['zone'] === 'library' || op['zone'] === 'hand')
    && typeof op['count'] === 'number',
  );
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
