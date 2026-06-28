import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { focusPlayer, readTableZoneCounts } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type IdentitySetup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;

test.describe('product correctness identity runtime gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: IdentitySetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertGameRuntimeReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `identity${Date.now().toString(36)}`,
      playerAPrefix: 'ia',
      playerBPrefix: 'ib',
      playerALanguage: 'es',
      playerBLanguage: 'en',
      includePlayerAWhiteDfc: true,
    });
    await expectUserCardLanguage(request, setup.playerA.token, 'es');
    await expectUserCardLanguage(request, setup.playerB.token, 'en');
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('visible card identity survives draw, public move, tokens, refresh and reconnect', async ({ browser, request, baseURL }) => {
    test.setTimeout(300_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const { gameId, playerA, playerB } = setup;
    const initialSnapshot = await gameSnapshot(request, gameId, playerA.token);
    const handIds = zoneInstanceIds(initialSnapshot, playerA.user.id, 'hand');
    const dfc = findDfcInstance(initialSnapshot, playerA.user.id);
    if (handIds.length < 2) {
      throw new Error(`Expected at least 2 hand cards for identity gate, got ${handIds.length}.`);
    }
    const moveId = handIds.find((instanceId) => instanceId !== dfc.instanceId) ?? handIds[0]!;
    let nextBaseVersion = await gameVersion(request, gameId, playerA.token);

    const contextA = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken) });
    const contextB = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken) });
    await Promise.all([enableFrontendGameplayV2(contextA), enableFrontendGameplayV2(contextB)]);

    let pageA: Page | null = null;
    let pageB: Page | null = null;
    let ownerMoveLiveImageSrc = '';
    let rivalMoveLiveImageSrc = '';
    let ownerTokenLiveImageSrc = '';
    let rivalTokenLiveImageSrc = '';
    let ownerTokenCopyLiveImageSrc = '';
    let rivalTokenCopyLiveImageSrc = '';
    try {
      pageA = await contextA.newPage();
      pageB = await contextB.newPage();
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
      await focusPlayer(pageA, playerA.user.displayName);
      await focusPlayer(pageB, playerA.user.displayName);
      const refetchBaseline = snapshotRefetches;
      const ticket = await websocketTicket(request, gameId, playerA.token);

      let outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'library.draw',
        payload: { playerId: playerA.user.id },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.add'),
      });
      nextBaseVersion = outcome.version;
      const drawn = addedCards(outcome.patch);
      expect(drawn.length).toBeGreaterThan(0);
      for (const card of drawn) {
        assertVisibleCardIdentity(card, 'private');
        await expect(gameCard(pageA, playerA.user.id, String(card['instanceId']), 'hand')).toBeVisible({ timeout: 15_000 });
        await expectCardImage(pageA, playerA.user.id, String(card['instanceId']), 'hand');
      }
      await expect(pageA.locator(`[data-testid="game-card"][data-zone="hand"][data-owner-player-id="${playerA.user.id}"]`, { hasText: 'Unknown Card' })).toHaveCount(0);
      expect(snapshotRefetches).toBe(refetchBaseline);

      const initialCountsA = await readTableZoneCounts(pageA, playerA.user.displayName);
      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: { playerId: playerA.user.id, fromZone: 'hand', toZone: 'battlefield', instanceId: moveId },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.move'),
      });
      nextBaseVersion = outcome.version;
      const rivalMovePatch = latestPatchWithOp(framesB, 'zone.cards.add');
      const rivalMoved = addedCards(rivalMovePatch).find((card) => card['instanceId'] === moveId);
      expect(rivalMoved).toBeTruthy();
      assertVisibleCardIdentity(rivalMoved!, 'public', 'en');
      const ownerMove = operation(outcome.patch, 'zone.cards.move')?.['card'];
      if (ownerMove && typeof ownerMove === 'object' && !Array.isArray(ownerMove)) {
        assertVisibleCardIdentity(ownerMove as JsonObject, 'public', 'es');
      }
      await expect(gameCard(pageA, playerA.user.id, moveId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      await expect(gameCard(pageB, playerA.user.id, moveId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      ownerMoveLiveImageSrc = await expectCardImageSrc(pageA, playerA.user.id, moveId, 'battlefield');
      rivalMoveLiveImageSrc = await expectCardImageSrc(pageB, playerA.user.id, moveId, 'battlefield');
      await expect.poll(async () => readTableZoneCounts(pageA!, playerA.user.displayName)).toEqual({
        hand: initialCountsA.hand - 1,
        library: initialCountsA.library,
      });
      await assertNoPublicUnknown(pageA, playerA.user.id);
      await assertNoPublicUnknown(pageB, playerA.user.id);
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.token.created',
        payload: {
          playerId: playerA.user.id,
          quantity: 1,
          card: {
            name: 'Runtime Goblin',
            scryfallId: 'runtime-goblin',
            imageUris: { normal: 'https://example.test/runtime-goblin.jpg' },
            oracleText: 'heavy text must not be in runtime patch',
            cardFaces: [{ name: 'Runtime Goblin', imageUris: { normal: 'https://example.test/runtime-goblin-face.jpg' } }],
          },
        },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.add') && addedCards(patch).some((card) => card['isToken'] === true),
      });
      nextBaseVersion = outcome.version;
      assertNoStaticPayload(outcome.patch);
      const token = addedCards(outcome.patch)[0]!;
      assertVisibleCardIdentity(token, 'public', 'es');
      const tokenId = String(token['instanceId']);
      await expect(gameCard(pageA, playerA.user.id, tokenId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      ownerTokenLiveImageSrc = await expectCardImageSrc(pageA, playerA.user.id, tokenId, 'battlefield');
      rivalTokenLiveImageSrc = await expectCardImageSrc(pageB, playerA.user.id, tokenId, 'battlefield');
      await assertNoPublicUnknown(pageA, playerA.user.id);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.token_copy.created',
        payload: { playerId: playerA.user.id, instanceId: moveId, targetPlayerId: playerA.user.id },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.add') && JSON.stringify(patch).includes('copiedFromInstanceId'),
      });
      nextBaseVersion = outcome.version;
      assertNoStaticPayload(outcome.patch);
      const tokenCopy = addedCards(outcome.patch)[0]!;
      assertVisibleCardIdentity(tokenCopy, 'public', 'es');
      const tokenCopyId = String(tokenCopy['instanceId']);
      await expect(gameCard(pageA, playerA.user.id, tokenCopyId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      ownerTokenCopyLiveImageSrc = await expectCardImageSrc(pageA, playerA.user.id, tokenCopyId, 'battlefield');
      rivalTokenCopyLiveImageSrc = await expectCardImageSrc(pageB, playerA.user.id, tokenCopyId, 'battlefield');
      await assertNoPublicUnknown(pageA, playerA.user.id);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: { playerId: playerA.user.id, fromZone: dfc.zone, toZone: 'battlefield', instanceId: dfc.instanceId },
        ownerPatch: (patch) => hasOp(patch, dfc.zone === 'battlefield' ? 'card.field.set' : 'zone.cards.move') || hasOp(patch, 'zone.cards.add'),
      });
      nextBaseVersion = outcome.version;
      const dfcMoveCard = movedCard(outcome.patch) ?? addedCards(outcome.patch).find((card) => card['instanceId'] === dfc.instanceId);
      expect(dfcMoveCard).toBeTruthy();
      assertVisibleCardIdentity(dfcMoveCard!, 'public', 'es');
      await expect(gameCard(pageA, playerA.user.id, dfc.instanceId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      await expectCardImage(pageA, playerA.user.id, dfc.instanceId, 'battlefield');
      const dfcToggle = gameCard(pageA, playerA.user.id, dfc.instanceId, 'battlefield').locator('.double-face-toggle');
      if (await dfcToggle.count() === 0) {
        const dfcMove = operation(outcome.patch, 'zone.cards.move');
        const ops = Array.isArray(outcome.patch['ops']) ? outcome.patch['ops'] as JsonObject[] : [];
        throw new Error(`DFC identity rendered without face toggle: ${JSON.stringify({
          card: dfcMoveCard,
          staticCard: dfcMove?.['staticCard'] ?? null,
          patchOps: ops.map((op) => op['op']),
        })}`);
      }
      await expect(gameCard(pageA, playerA.user.id, dfc.instanceId, 'battlefield').locator('.double-face-toggle')).toBeVisible({ timeout: 15_000 });
      await assertNoPublicUnknown(pageA, playerA.user.id);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.face.changed',
        payload: { playerId: playerA.user.id, instanceId: dfc.instanceId, faceIndex: 1 },
        ownerPatch: (patch) => hasCardField(patch, dfc.instanceId, 'activeFaceIndex'),
      });
      nextBaseVersion = outcome.version;
      expect(JSON.stringify(outcome.patch)).not.toContain('cardFaces');
      await expect(gameCard(pageA, playerA.user.id, dfc.instanceId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      await expect(gameCard(pageA, playerA.user.id, dfc.instanceId, 'battlefield')).not.toHaveAttribute('data-card-name', 'Unknown Card');
      await expectCardImage(pageA, playerA.user.id, dfc.instanceId, 'battlefield');
      await assertNoPublicUnknown(pageA, playerA.user.id);

      const beforeRefreshRefetches = snapshotRefetches;
      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayer(pageA, playerA.user.displayName);
      await expect(gameCard(pageA, playerA.user.id, moveId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      await expect(gameCard(pageA, playerA.user.id, tokenId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      await expect(gameCard(pageA, playerA.user.id, tokenCopyId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      await expect(gameCard(pageA, playerA.user.id, dfc.instanceId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      expect(await expectCardImageSrc(pageA, playerA.user.id, moveId, 'battlefield')).toBe(ownerMoveLiveImageSrc);
      expect(await expectCardImageSrc(pageA, playerA.user.id, tokenId, 'battlefield')).toBe(ownerTokenLiveImageSrc);
      expect(await expectCardImageSrc(pageA, playerA.user.id, tokenCopyId, 'battlefield')).toBe(ownerTokenCopyLiveImageSrc);
      await expectCardImage(pageA, playerA.user.id, dfc.instanceId, 'battlefield');
      await assertNoPublicUnknown(pageA, playerA.user.id);
      expect(snapshotRefetches).toBeGreaterThan(beforeRefreshRefetches);

      await contextB.close();
      const reconnectRefreshToken = await loginRefreshToken(request, playerB.credentials);
      const reconnectContext = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerB.user, reconnectRefreshToken) });
      await enableFrontendGameplayV2(reconnectContext);
      const reconnectPage = await reconnectContext.newPage();
      const reconnectFrames = collectWebSocketFrames(reconnectPage);
      await reconnectPage.goto(`/games/${gameId}`);
      await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(reconnectFrames);
      await focusPlayer(reconnectPage, playerA.user.displayName);
      await expect(gameCard(reconnectPage, playerA.user.id, moveId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      await expect(gameCard(reconnectPage, playerA.user.id, tokenId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      await expect(gameCard(reconnectPage, playerA.user.id, tokenCopyId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      await expect(gameCard(reconnectPage, playerA.user.id, dfc.instanceId, 'battlefield')).toBeVisible({ timeout: 15_000 });
      expect(await expectCardImageSrc(reconnectPage, playerA.user.id, moveId, 'battlefield')).toBe(rivalMoveLiveImageSrc);
      expect(await expectCardImageSrc(reconnectPage, playerA.user.id, tokenId, 'battlefield')).toBe(rivalTokenLiveImageSrc);
      expect(await expectCardImageSrc(reconnectPage, playerA.user.id, tokenCopyId, 'battlefield')).toBe(rivalTokenCopyLiveImageSrc);
      await expectCardImage(reconnectPage, playerA.user.id, dfc.instanceId, 'battlefield');
      await assertNoPublicUnknown(reconnectPage, playerA.user.id);
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
      if (pageB && !pageB.isClosed()) {
        await contextB.close();
      }
      if (pageA && !pageA.isClosed()) {
        await contextA.close();
      }
    }
  });
});

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`Game runtime is not reachable at ${RUNTIME_READY_URL}; runtime release gates must not fall back to legacy.`);
  }
}

async function expectUserCardLanguage(request: APIRequestContext, token: string, expectedLanguage: 'en' | 'es'): Promise<void> {
  const response = await request.get(`${API_BASE_URL}/me`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { user?: { preferences?: { cardLanguage?: unknown } } };
  expect(payload.user?.preferences?.cardLanguage).toBe(expectedLanguage);
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

function findDfcInstance(snapshot: JsonObject, playerId: string): { instanceId: string; zone: string } {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const player = players?.[playerId];
  const zones = player?.['zones'] as Record<string, JsonObject[]> | undefined;
  for (const [zone, cards] of Object.entries(zones ?? {})) {
    for (const card of cards) {
      const name = typeof card['name'] === 'string' ? card['name'] : '';
      const faces = Array.isArray(card['cardFaces']) ? card['cardFaces'] : [];
      const instanceId = typeof card['instanceId'] === 'string' ? card['instanceId'] : '';
      if (instanceId && (name.includes('The Restoration of Eiganjo') || faces.length >= 2)) {
        return { instanceId, zone };
      }
    }
  }

  throw new Error('Identity gate could not find the white DFC instance in player A snapshot.');
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

async function websocketTicket(request: APIRequestContext, gameId: string, token: string): Promise<{ websocketUrl: string }> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, { headers: { Authorization: `Bearer ${token}` } });
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

async function waitForGameplayConnection(frames: JsonObject[]): Promise<void> {
  await expect.poll(() => frames.some((message) => message['kind'] === 'connection_state' && message['status'] === 'connected'), { timeout: 20_000 }).toBe(true);
}

async function sendRuntimeCommandAndWait(
  page: Page,
  websocketUrl: string,
  frames: JsonObject[],
  options: { gameId: string; baseVersion: number; type: string; payload: JsonObject; ownerPatch: (patch: JsonObject) => boolean },
): Promise<{ version: number; patch: JsonObject }> {
  const clientActionId = `identity-runtime-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
    return { version: Math.max(options.baseVersion + 1, Number(patch['version'] ?? options.baseVersion + 1)), patch };
  } finally {
    await closeCommandSocket(page, socketId);
  }
}

async function openCommandSocketAndSend(page: Page, websocketUrl: string, message: JsonObject): Promise<string> {
  return page.evaluate(({ url, payload }) => new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(url);
    const socketId = `identity-command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
    socket.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Raw WebSocket connection failed.'));
    };
  }), { url: websocketUrl, payload: message });
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

function addedCards(message: JsonObject): JsonObject[] {
  const op = operation(message, 'zone.cards.add');
  return Array.isArray(op?.['cards']) ? op['cards'] as JsonObject[] : [];
}

function movedCard(message: JsonObject): JsonObject | null {
  const card = operation(message, 'zone.cards.move')?.['card'];
  return card !== null && typeof card === 'object' && !Array.isArray(card) ? card as JsonObject : null;
}

function hasCardField(message: JsonObject, instanceId: string, field: string): boolean {
  const op = operation(message, 'card.field.set');
  return op?.['instanceId'] === instanceId && op[field] !== undefined;
}

function assertVisibleCardIdentity(card: JsonObject, expectedVisibility: 'private' | 'public', expectedLanguage?: 'en' | 'es'): void {
  expect(card['cardKey']).toBeTruthy();
  expect(card['printId']).toBeTruthy();
  expect(card['cardVersion']).toBeTruthy();
  expect(card['language']).toBeTruthy();
  expect(card['viewerVisibility']).toBe(expectedVisibility);
  if (expectedLanguage) {
    expect(card['language']).toBe(expectedLanguage);
  }
}

function gameCard(page: Page, ownerPlayerId: string, instanceId: string, zone: 'hand' | 'battlefield') {
  return page.locator(`[data-testid="game-card"][data-zone="${zone}"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`);
}

async function expectCardImage(page: Page, ownerPlayerId: string, instanceId: string, zone: 'hand' | 'battlefield'): Promise<void> {
  await expectCardImageSrc(page, ownerPlayerId, instanceId, zone);
}

async function expectCardImageSrc(page: Page, ownerPlayerId: string, instanceId: string, zone: 'hand' | 'battlefield'): Promise<string> {
  const image = gameCard(page, ownerPlayerId, instanceId, zone).locator('img').first();
  await expect(image).toBeVisible({ timeout: 15_000 });
  const src = await image.getAttribute('src');
  expect(src ?? '').not.toBe('');
  expect(src ?? '').not.toContain('facedown_card');
  return src ?? '';
}

async function assertNoPublicUnknown(page: Page, ownerPlayerId: string): Promise<void> {
  await expect(page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerPlayerId}"]`, { hasText: 'Unknown Card' })).toHaveCount(0);
}

function assertNoStaticPayload(message: JsonObject): void {
  const encoded = JSON.stringify(message);
  expect(encoded).not.toContain('oracleText');
  expect(encoded).not.toContain('must-not-leak');
  for (const card of [...addedCards(message), movedCard(message)].filter((item): item is JsonObject => item !== null)) {
    expect(card).not.toHaveProperty('imageUris');
    expect(card).not.toHaveProperty('oracleText');
    expect(card).not.toHaveProperty('cardFaces');
  }
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
