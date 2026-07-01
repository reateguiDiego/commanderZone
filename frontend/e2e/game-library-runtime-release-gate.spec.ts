import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { readTableZoneCounts } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
const REQUIRE_DEBUG_HEALTH = isTruthy(
  process.env['E2E_REQUIRE_DEBUG_HEALTH'] ?? process.env['GAME_DEBUG_HEALTH_ENABLED'],
);

type JsonObject = Record<string, unknown>;
type LibraryRuntimeSetup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;
type AuthStorageState = ReturnType<typeof authStorageState>;

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
      storageState: withE2eStaticCardCacheTools(authStorageState(baseURL, playerA.user, playerA.refreshToken), baseURL),
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
      const framesA = await collectWebSocketFrames(pageA);
      const framesB = await collectWebSocketFrames(pageB);
      let snapshotRefetches = 0;
      let commandFallbackPosts = 0;
      const snapshotRefetchUrls: string[] = [];
      const cardCatalogResolveUrls: string[] = [];
      for (const page of [pageA, pageB]) {
        page.on('request', (httpRequest) => {
          const url = httpRequest.url();
          if (httpRequest.method() === 'POST' && url.includes(`/games/${gameId}/commands`)) {
            commandFallbackPosts += 1;
          }
          if (httpRequest.method() === 'GET' && (url.includes(`/games/${gameId}/snapshot`) || url.includes(`/games/${gameId}/bootstrap`))) {
            snapshotRefetches += 1;
            snapshotRefetchUrls.push(url);
          }
          if (page === pageA && httpRequest.method() === 'GET' && /\/cards\/[^/?]+(?:\?|$)/.test(url)) {
            cardCatalogResolveUrls.push(url);
          }
        });
      }

      await Promise.all([
        commandPage.goto('about:blank'),
        gotoGameOrOpenCurrentRoom(pageA, gameId),
        gotoGameOrOpenCurrentRoom(pageB, gameId),
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
      await waitForGameplayConnection(pageA, framesA, diagnosticsA, 'player A');
      await waitForGameplayConnection(pageB, framesB, diagnosticsB, 'player B');

      const removedOwnerStaticCards = await dropTopLibraryStaticCardsForE2e(pageA, playerA.user.id);
      expect(removedOwnerStaticCards).toBeGreaterThan(0);
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
      const drawOwnerAddOp = operation(drawOwnerPatch, 'zone.cards.add');
      const drawnCards = addedCards(drawOwnerPatch);
      const drawnCard = drawnCards[0];
      const drawnPrintId = printIdFromRuntimeCard(drawnCard);
      expect(hasOp(drawOwnerPatch, 'zone.cards.add')).toBe(true);
      expect(drawnCard).toBeTruthy();
      expect(drawnCard?.['cardKey']).toBeTruthy();
      expect(drawnPrintId).toBeTruthy();
      expect(drawOwnerAddOp?.['staticCards']).toBeUndefined();
      expect(hasOp(drawRivalPatch, 'zone.cards.add')).toBe(false);
      expect(hasOnlyPublicCountsForPlayer(drawRivalPatch, playerA.user.id)).toBe(true);
      expect(JSON.stringify(drawRivalPatch)).not.toContain(String(drawnCard?.['cardKey'] ?? ''));
      await expectZoneCounts(pageA, playerA.user.displayName, framesA, diagnosticsA, 'library.draw', {
        hand: initialCountsA.hand + 1,
        library: initialCountsA.library - 1,
      });
      await expectRenderableOwnerHandCard(pageA, playerA.user.id, String(drawnCard?.['instanceId'] ?? ''));
      await expect(pageB.locator(`[data-testid="game-card"][data-card-instance-id="${String(drawnCard?.['instanceId'] ?? '')}"]`)).toHaveCount(0);
      expect(cardCatalogResolveUrls.some((url) => url.includes(`/cards/${encodeURIComponent(drawnPrintId)}`))).toBe(true);
      expectNoSnapshotRefetch(snapshotRefetches, refetchBaseline, snapshotRefetchUrls, diagnosticsA, diagnosticsB, 'library.draw');

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'library.draw_many',
        payload: { playerId: playerA.user.id, count: 2 },
        ownerPatch: (patch) => zoneCardsAddedCount(patch) === 2,
      });
      expect(zoneCardsAddedCount(latestPatchWithOp(framesA, 'zone.cards.add'))).toBe(2);
      await expectZoneCounts(pageA, playerA.user.displayName, framesA, diagnosticsA, 'library.draw_many', {
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
      expectNoSnapshotRefetch(snapshotRefetches, refetchBaseline, snapshotRefetchUrls, diagnosticsA, diagnosticsB, 'library.reveal_top');

      nextBaseVersion = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'library.move_top',
        payload: { playerId: playerA.user.id, count: 1, toZone: 'library', position: 'bottom' },
        ownerPatch: (patch) => hasOp(patch, 'library.top.moved'),
      });
      await expectZoneCounts(pageA, playerA.user.displayName, framesA, diagnosticsA, 'library.move_top', {
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

      if (debug.enabled) {
        for (const commandType of ['library.draw', 'library.draw_many', 'library.view', 'library.reorder_top', 'library.reveal_top', 'library.move_top', 'library.shuffle']) {
          const health = await waitForActionHealth(debug.frames, commandType);
          const phases = latestActionPhases(health, commandType);
          expect(phases?.['gameplay.runtime_route']).toBe(1);
          expect(phases?.['gameplay.runtime_fallback_count']).toBe(0);
          expect(phases?.['gameplay.runtime_error_count']).toBe(0);
        }
      }

      expect(framesA.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(framesB.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(commandFallbackPosts).toBe(0);
      expect(errorDiagnostics(diagnosticsA, diagnosticsB)).toEqual([]);
      expect(webSocketErrors(framesA, framesB)).toEqual([]);
      await commandPage.close();
      await debug.page?.close();
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
    try {
      window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
    } catch {
      // Ignore inaccessible special documents created by the browser before app navigation.
    }
  });
}

function withE2eStaticCardCacheTools(storageState: AuthStorageState, baseURL: string): AuthStorageState {
  const origin = new URL(baseURL).origin;
  const originStorage = storageState.origins.find((candidate) => candidate.origin === origin);
  if (!originStorage) {
    storageState.origins.push({
      origin,
      localStorage: [{ name: 'commanderzone.e2eStaticCardCacheTools', value: '1' }],
    });
    return storageState;
  }

  originStorage.localStorage = [
    ...originStorage.localStorage.filter((item) => item.name !== 'commanderzone.e2eStaticCardCacheTools'),
    { name: 'commanderzone.e2eStaticCardCacheTools', value: '1' },
  ];

  return storageState;
}

async function dropTopLibraryStaticCardsForE2e(page: Page, playerId: string): Promise<number> {
  return page.evaluate((targetPlayerId) => {
    const tools = (window as unknown as {
      commanderZoneE2eStaticCardCache?: { dropTopLibraryStaticCards(playerId: string): number };
    }).commanderZoneE2eStaticCardCache;

    return tools?.dropTopLibraryStaticCards(targetPlayerId) ?? 0;
  }, playerId);
}

async function collectWebSocketFrames(page: Page): Promise<JsonObject[]> {
  const frames: JsonObject[] = [];
  page.on('websocket', (socket) => {
    frames.push({ kind: '__websocket_opened', url: socket.url() });
    socket.on('framereceived', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) {
        frames.push(parsed);
      }
    });
    socket.on('close', () => {
      frames.push({ kind: '__websocket_closed', url: socket.url() });
    });
    socket.on('socketerror', (error) => {
      frames.push({ kind: '__websocket_error', url: socket.url(), error: String(error) });
    });
  });

  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  client.on('Network.webSocketCreated', (event) => {
    frames.push({ kind: '__websocket_opened', url: String(event['url'] ?? '') });
  });
  client.on('Network.webSocketClosed', (event) => {
    frames.push({ kind: '__websocket_closed', requestId: String(event['requestId'] ?? '') });
  });
  client.on('Network.webSocketFrameError', (event) => {
    frames.push({
      kind: '__websocket_error',
      requestId: String(event['requestId'] ?? ''),
      error: String(event['errorMessage'] ?? ''),
    });
  });
  client.on('Network.webSocketFrameReceived', (event) => {
    const response = event['response'];
    const payload = response && typeof response === 'object' && 'payloadData' in response
      ? String((response as { payloadData?: unknown }).payloadData ?? '')
      : '';
    const parsed = parseFrame(payload);
    if (parsed) {
      frames.push(parsed);
    }
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

function errorDiagnostics(...diagnosticsGroups: string[][]): string[] {
  return diagnosticsGroups
    .flat()
    .filter((message) => message.startsWith('[console:error]') || message.startsWith('[pageerror]'));
}

function webSocketErrors(...frameGroups: JsonObject[][]): JsonObject[] {
  return frameGroups
    .flat()
    .filter((message) => message['kind'] === '__websocket_error');
}

async function openDebugObserver(
  context: BrowserContext,
  request: APIRequestContext,
  gameId: string,
  token: string,
): Promise<{ page?: Page; frames: JsonObject[]; enabled: boolean }> {
  if (!REQUIRE_DEBUG_HEALTH) {
    return { frames: [], enabled: false };
  }

  const ticket = await websocketTicket(request, gameId, token);
  const debugUrl = debugWebsocketUrl(ticket.websocketUrl, gameId);
  const debugPage = await context.newPage();
  const frames = await collectWebSocketFrames(debugPage);
  await debugPage.goto('about:blank');
  await debugPage.evaluate((url) => {
    const socket = new WebSocket(url);
    (window as unknown as { __commanderZoneDebugSocket?: WebSocket }).__commanderZoneDebugSocket = socket;
  }, debugUrl);
  await expect.poll(() => frames.some((message) => message['kind'] === 'debug_health'), { timeout: 15_000 }).toBe(true);

  return { page: debugPage, frames, enabled: true };
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

async function gotoGameOrOpenCurrentRoom(page: Page, gameId: string): Promise<void> {
  await page.goto('/rooms');
  if (await openGameLinkIfVisible(page, gameId, 30_000)) {
    await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
    return;
  }

  await page.goto(`/games/${gameId}`);
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
}

async function openGameLinkIfVisible(page: Page, gameId: string, timeout = 0): Promise<boolean> {
  const gameLink = page.locator(`a[href="/games/${gameId}"]`).first();
  if (await isLocatorVisible(gameLink, timeout)) {
    await gameLink.click();
    return true;
  }

  return openCurrentRoomIfVisible(page);
}

async function openCurrentRoomIfVisible(page: Page, timeout = 0): Promise<boolean> {
  const openCurrentRoom = page.getByRole('link', { name: /Open/ }).first();
  if (await isLocatorVisible(openCurrentRoom, timeout)) {
    await openCurrentRoom.click();
    return true;
  }

  const bannerLink = page.locator('.room-current-banner a.primary-button').first();
  if (await isLocatorVisible(bannerLink, timeout)) {
    await bannerLink.click();
    return true;
  }

  return false;
}

async function isLocatorVisible(locator: ReturnType<Page['locator']>, timeout: number): Promise<boolean> {
  await locator.waitFor({ state: 'visible', timeout }).catch(() => undefined);
  return locator.isVisible().catch(() => false);
}

function hasGameplayConnectionFrame(frames: JsonObject[]): boolean {
  return frames.some((message) =>
    message['kind'] === 'connection_state' && message['status'] === 'connected',
  );
}

function hasOpenedGameplayWebSocket(frames: JsonObject[]): boolean {
  return frames.some((message) =>
    message['kind'] === '__websocket_opened' && String(message['url'] ?? '').includes('/games/'),
  );
}

function recentFrameSummary(frames: JsonObject[]): JsonObject[] {
  return frames.slice(-10).map((message) => {
    const summary: JsonObject = { kind: message['kind'] };
    if (typeof message['status'] === 'string') {
      summary['status'] = message['status'];
    }
    if (typeof message['url'] === 'string') {
      summary['url'] = message['url'];
    }
    if (typeof message['version'] === 'number') {
      summary['version'] = message['version'];
    }

    return summary;
  });
}

async function isGameScreenVisible(page: Page): Promise<boolean> {
  return page.getByTestId('game-screen').isVisible().catch(() => false);
}

async function connectionFailureDetails(
  page: Page,
  frames: JsonObject[],
  diagnostics: string[],
  label: string,
): Promise<string> {
  return `${label} did not report gameplay WebSocket connection.
URL: ${page.url()}
Game screen visible: ${await isGameScreenVisible(page)}
Recent frames:
${JSON.stringify(recentFrameSummary(frames), null, 2)}
Recent diagnostics:
${diagnostics.slice(-20).join('\n')}
Body:
${(await page.locator('body').innerText().catch(() => '')).slice(0, 2000)}`;
}

async function waitForGameplayConnection(
  page: Page,
  frames: JsonObject[],
  diagnostics: string[],
  label: string,
): Promise<void> {
  try {
    await expect.poll(async () => {
      if (hasGameplayConnectionFrame(frames)) {
        return true;
      }

      if (!await isGameScreenVisible(page)) {
        await openCurrentRoomIfVisible(page);
        return false;
      }

      return hasOpenedGameplayWebSocket(frames);
    }, { timeout: 20_000 }).toBe(true);
    await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 5_000 });
  } catch (error) {
    throw new Error(`${String(error)}
${await connectionFailureDetails(page, frames, diagnostics, label)}`);
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

async function expectZoneCounts(
  page: Page,
  displayName: string,
  frames: JsonObject[],
  diagnostics: string[],
  commandType: string,
  expected: { hand: number; library: number },
): Promise<void> {
  try {
    await expect
      .poll(async () => readTableZoneCounts(page, displayName), { timeout: 20_000 })
      .toEqual(expected);
  } catch (error) {
    throw new Error(`${String(error)}
Recent patch.v2 frames after ${commandType}:
${JSON.stringify(recentPatchSummary(frames), null, 2)}
Recent page diagnostics:
${diagnostics.slice(-20).join('\n')}`);
  }
}

function expectNoSnapshotRefetch(
  actual: number,
  baseline: number,
  urls: string[],
  diagnosticsA: string[],
  diagnosticsB: string[],
  commandType: string,
): void {
  if (actual === baseline) {
    return;
  }

  throw new Error(`Unexpected snapshot/bootstrap refetch after ${commandType}: got ${actual}, expected ${baseline}
Snapshot/bootstrap URLs:
${urls.join('\n')}
Player A diagnostics:
${diagnosticsA.slice(-30).join('\n')}
Player B diagnostics:
${diagnosticsB.slice(-30).join('\n')}`);
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

function recentPatchSummary(frames: JsonObject[]): JsonObject[] {
  return frames.filter((message) => message['kind'] === 'patch.v2').slice(-5).map((message) => ({
    version: message['version'],
    ackClientActionId: message['ackClientActionId'],
    ops: Array.isArray(message['ops'])
      ? (message['ops'] as JsonObject[]).map((op) => ({
          op: op['op'],
          playerId: op['playerId'],
          zone: op['zone'],
          count: op['count'],
          cards: Array.isArray(op['cards']) ? op['cards'].length : undefined,
        }))
      : [],
  }));
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
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

function addedCards(message: JsonObject): JsonObject[] {
  const op = operation(message, 'zone.cards.add');
  return Array.isArray(op?.['cards']) ? op['cards'] as JsonObject[] : [];
}

function printIdFromRuntimeCard(card: JsonObject | undefined): string {
  const directPrintId = typeof card?.['printId'] === 'string' ? card['printId'].trim() : '';
  if (directPrintId) {
    return directPrintId;
  }

  const directScryfallId = typeof card?.['scryfallId'] === 'string' ? card['scryfallId'].trim() : '';
  if (directScryfallId) {
    return directScryfallId;
  }

  const cardKey = typeof card?.['cardKey'] === 'string' ? card['cardKey'].trim() : '';
  const parts = cardKey.split(':');

  return parts.length >= 3 && parts[0] === 'scryfall' ? parts[1]?.trim() ?? '' : '';
}

async function expectRenderableOwnerHandCard(page: Page, ownerPlayerId: string, instanceId: string): Promise<void> {
  const card = page.locator(`[data-testid="game-card"][data-zone="hand"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => {
    const name = ((await card.getAttribute('data-card-name')) ?? '').trim();
    return name !== '' && name !== 'Card' && name !== 'Unknown Card';
  }, { timeout: 15_000 }).toBe(true);

  const image = card.locator('img').first();
  await expect(image).toBeVisible({ timeout: 15_000 });
  const src = await image.getAttribute('src');
  expect(src ?? '').not.toBe('');
  expect(src ?? '').not.toContain('facedown_card');
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
