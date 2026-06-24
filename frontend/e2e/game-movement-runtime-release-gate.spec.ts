import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { focusPlayer, readTableZoneCounts } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type MovementRuntimeSetup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;

test.describe('movement runtime release gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: MovementRuntimeSetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertGameRuntimeReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `move${Date.now().toString(36)}`,
      playerAPrefix: 'ma',
      playerBPrefix: 'mb',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('real browser sessions apply movement runtime patch.v2 without snapshot refetch', async ({ browser, request, baseURL }) => {
    test.setTimeout(240_000);
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

      const snapshot = await gameSnapshot(request, gameId, playerA.token);
      const playerSnapshot = snapshot.players?.[playerA.user.id] as JsonObject | undefined;
      const zones = (playerSnapshot?.['zones'] as JsonObject | undefined) ?? {};
      const handCards = Array.isArray(zones['hand']) ? zones['hand'] as JsonObject[] : [];
      if (handCards.length < 5) {
        throw new Error(`Expected at least 5 hand cards for movement gate, got ${handCards.length}.`);
      }

      const handIds = handCards.map((card) => String(card['instanceId'] ?? '')).filter((id) => id !== '');
      const [handOne, handTwo, handThree, handFour, handFive] = handIds;

      const initialCountsA = await readTableZoneCounts(pageA, playerA.user.displayName);
      const initialGraveyardA = await readFocusedZoneCount(pageA, playerA.user.displayName, 'graveyard');
      const refetchBaseline = snapshotRefetches;
      const ticket = await websocketTicket(request, gameId, playerA.token);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: { playerId: playerA.user.id, fromZone: 'hand', toZone: 'battlefield', instanceId: handOne },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.move'),
      });
      const handToBattlefieldOwner = latestPatchForAck(framesA, 'card.moved');
      const handToBattlefieldRival = latestPatchForAck(framesB, 'card.moved');
      expect(hasOp(handToBattlefieldOwner, 'zone.cards.move')).toBe(true);
      expect(hasOp(handToBattlefieldRival, 'zone.cards.add')).toBe(true);
      expect(JSON.stringify(handToBattlefieldRival)).not.toContain(`"zone":"hand","cardKey"`);
      try {
        await expect.poll(async () => readTableZoneCounts(pageA, playerA.user.displayName)).toEqual({
          hand: initialCountsA.hand - 1,
          library: initialCountsA.library,
        });
      } catch (error) {
        throw new Error(`${String(error)}
Owner patch:
${JSON.stringify(handToBattlefieldOwner, null, 2)}

Recent page A patches:
${JSON.stringify(framesA.filter((message) => message['kind'] === 'patch.v2').slice(-5), null, 2)}

Recent page B patches:
${JSON.stringify(framesB.filter((message) => message['kind'] === 'patch.v2').slice(-5), null, 2)}`);
      }
      await focusPlayer(pageB, playerA.user.displayName);
      await expect(battlefieldCard(pageB, playerA.user.id, handOne)).toBeVisible({ timeout: 15_000 });
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: { playerId: playerA.user.id, fromZone: 'battlefield', toZone: 'graveyard', instanceId: handOne },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.move') || hasOp(patch, 'zone.cards.batchMove'),
      });
      await focusPlayer(pageA, playerA.user.displayName);
      await focusPlayer(pageB, playerA.user.displayName);
      await expect(battlefieldCard(pageA, playerA.user.id, handOne)).toBeHidden({ timeout: 15_000 });
      await expect.poll(async () => readFocusedZoneCount(pageA, playerA.user.displayName, 'graveyard')).toBe(initialGraveyardA + 1);
      await expect.poll(async () => readFocusedZoneCount(pageB, playerA.user.displayName, 'graveyard')).toBe(initialGraveyardA + 1);
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'cards.moved',
        payload: { playerId: playerA.user.id, fromZone: 'hand', toZone: 'battlefield', instanceIds: [handTwo, handThree] },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.batchMove'),
      });
      const batchOwner = latestPatchForAck(framesA, 'cards.moved');
      const batchRival = latestPatchForAck(framesB, 'cards.moved');
      expect(operation(batchOwner, 'zone.cards.batchMove')?.['moves']).toBeTruthy();
      expect(hasOp(batchRival, 'zone.cards.add')).toBe(true);
      await expect.poll(async () => readTableZoneCounts(pageA, playerA.user.displayName)).toEqual({
        hand: initialCountsA.hand - 3,
        library: initialCountsA.library,
      });
      await expect.poll(async () => battlefieldOrder(pageB, playerA.user.id)).toEqual([handTwo, handThree]);
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'zone.changed',
        payload: { playerId: playerA.user.id, zone: 'battlefield', instanceIds: [handThree, handTwo] },
        ownerPatch: (patch) => hasOp(patch, 'zone.reordered'),
      });
      const reorderOwner = latestPatchForAck(framesA, 'zone.changed');
      expect(operation(reorderOwner, 'zone.reordered')?.['instanceIds']).toEqual([handThree, handTwo]);
      await expect.poll(async () => battlefieldOrder(pageA, playerA.user.id)).toEqual([handThree, handTwo]);
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'zone.move_all',
        payload: { playerId: playerA.user.id, fromZone: 'battlefield', toZone: 'graveyard' },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.batchMove'),
      });
      await expect.poll(async () => battlefieldOrder(pageA, playerA.user.id)).toEqual([]);
      await expect.poll(async () => readFocusedZoneCount(pageA, playerA.user.displayName, 'graveyard')).toBe(initialGraveyardA + 3);
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: { playerId: playerA.user.id, fromZone: 'hand', toZone: 'library', instanceId: handFour, position: 'top' },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.move'),
      });
      const handToLibraryTopRival = latestPatchForAck(framesB, 'card.moved');
      expect(hasOp(handToLibraryTopRival, 'zone.cards.move')).toBe(false);
      expect(JSON.stringify(handToLibraryTopRival)).not.toContain(handFour);
      await expect.poll(async () => readTableZoneCounts(pageA, playerA.user.displayName)).toEqual({
        hand: initialCountsA.hand - 4,
        library: initialCountsA.library + 1,
      });
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: { playerId: playerA.user.id, fromZone: 'hand', toZone: 'library', instanceId: handFive, position: 'bottom' },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.move'),
      });
      await expect.poll(async () => readTableZoneCounts(pageA, playerA.user.displayName)).toEqual({
        hand: initialCountsA.hand - 5,
        library: initialCountsA.library + 2,
      });
      expect(snapshotRefetches).toBe(refetchBaseline);

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: { playerId: playerA.user.id, fromZone: 'library', toZone: 'hand', instanceId: handFour },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.move'),
      });
      const libraryToHandRival = latestPatchForAck(framesB, 'card.moved');
      expect(JSON.stringify(libraryToHandRival)).not.toContain(handFour);
      await expect.poll(async () => readTableZoneCounts(pageA, playerA.user.displayName)).toEqual({
        hand: initialCountsA.hand - 4,
        library: initialCountsA.library + 1,
      });
      expect(snapshotRefetches).toBe(refetchBaseline);

      for (const commandType of ['card.moved', 'cards.moved', 'zone.move_all', 'zone.changed']) {
        const phases = await waitForActionHealth(debug.frames, commandType);
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
): Promise<number> {
  const clientActionId = `movement-runtime-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
      const socketId = `movement-command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

function latestPatchForAck(frames: JsonObject[], commandType: string): JsonObject {
  const patch = frames.filter((message) => message['kind'] === 'patch.v2').at(-1);
  if (!patch) {
    throw new Error(`No patch.v2 frame captured for ${commandType}.`);
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

async function readFocusedZoneCount(page: Page, displayName: string, zone: string): Promise<number> {
  await focusPlayer(page, displayName);
  const panel = page.getByTestId('player-panel');
  const playerId = await panel.getAttribute('data-player-id');
  if (!playerId) {
    throw new Error(`Missing focused player id for ${displayName}.`);
  }
  const locator = page.locator(`[data-testid="zone-count"][data-player-id="${playerId}"][data-zone="${zone}"]`);
  const raw = ((await locator.textContent({ timeout: 5_000 })) ?? '').trim();
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Could not parse zone count "${raw}" for ${displayName}/${zone}.`);
  }

  return value;
}

function battlefieldCard(page: Page, ownerPlayerId: string, instanceId: string): Locator {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`);
}

async function battlefieldOrder(page: Page, ownerPlayerId: string): Promise<string[]> {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerPlayerId}"]`)
    .evaluateAll((elements) => elements.map((element) => String(element.getAttribute('data-card-instance-id') ?? '')).filter((id) => id !== ''));
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
