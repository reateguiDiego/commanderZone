import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { focusPlayer } from './support/game-table';
import { sendRuntimeCommand } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL =
  process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
const REQUIRE_DEBUG_HEALTH = isTruthy(
  process.env['E2E_REQUIRE_DEBUG_HEALTH'] ?? process.env['GAME_DEBUG_HEALTH_ENABLED'],
);

type JsonObject = Record<string, unknown>;
type EdgeRuntimeSetup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;

const EDGE_COMMANDS = [
  'card.token.created',
  'card.token_copy.created',
  'zone.random_card.selected',
  'card.dungeon_marker.changed',
  'card.face.changed',
  'library.put_top',
  'library.put_bottom',
] as const;

test.describe('edge gameplay runtime release gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: EdgeRuntimeSetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertGameRuntimeReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `edge${Date.now().toString(36)}`,
      playerAPrefix: 'ea',
      playerBPrefix: 'eb',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('real browser sessions apply edge runtime patch.v2 without leaks or snapshot refetch', async ({
    browser,
    request,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const { gameId, playerA, playerB } = setup;
    const initialSnapshot = await gameSnapshot(request, gameId, playerA.token);
    const handIds = zoneInstanceIds(initialSnapshot, playerA.user.id, 'hand');
    if (handIds.length < 5) {
      throw new Error(
        `Expected at least 5 hand cards for edge runtime gate, got ${handIds.length}.`,
      );
    }
    const battlefieldIds = handIds.slice(0, 2);
    let nextBaseVersion = Math.max(1, Number(initialSnapshot['version'] ?? 1));
    for (const instanceId of battlefieldIds) {
      const setupMove = await sendRuntimeCommand(request, {
        gameId,
        token: playerA.token,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId,
        },
      });
      nextBaseVersion = setupMove.version;
    }
    const randomHandId = handIds[2] ?? '';
    const putTopId = handIds[3] ?? '';
    const putBottomId = handIds[4] ?? '';

    const contextA = await browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
    });
    const contextB = await browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken),
    });
    await Promise.all([enableFrontendGameplayV2(contextA), enableFrontendGameplayV2(contextB)]);

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
          if (
            httpRequest.method() === 'GET' &&
            (url.includes(`/games/${gameId}/snapshot`) ||
              url.includes(`/games/${gameId}/bootstrap`))
          ) {
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
${(
  await pageA
    .locator('body')
    .innerText()
    .catch(() => '')
).slice(0, 2000)}

Player B diagnostics:
${diagnosticsB.join('\n')}
Player B URL: ${pageB.url()}
Player B body:
${(
  await pageB
    .locator('body')
    .innerText()
    .catch(() => '')
).slice(0, 2000)}`);
      }
      await Promise.all([waitForGameplayConnection(framesA), waitForGameplayConnection(framesB)]);
      await focusPlayer(pageA, playerA.user.displayName);
      await focusPlayer(pageB, playerA.user.displayName);

      const refetchBaseline = snapshotRefetches;
      const ticket = await websocketTicket(request, gameId, playerA.token);

      let outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.token.created',
        payload: {
          playerId: playerA.user.id,
          quantity: 2,
          card: {
            name: 'Runtime Goblin',
            scryfallId: 'runtime-goblin',
            imageUris: { normal: 'https://example.test/runtime-goblin.jpg' },
            oracleText: 'must-not-leak',
            cardFaces: [
              {
                name: 'Runtime Goblin',
                imageUris: { normal: 'https://example.test/runtime-goblin-face.jpg' },
              },
            ],
            power: 1,
            toughness: 1,
          },
        },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.add') && zoneCardsAddedCount(patch) === 2,
      });
      nextBaseVersion = outcome.version;
      assertNoStaticPayload(outcome.patch);
      const tokenCards = addedCards(outcome.patch);
      expect(tokenCards).toHaveLength(2);
      try {
        for (const tokenCard of tokenCards) {
          assertVisibleCardIdentity(tokenCard);
          await expect(
            battlefieldCard(pageA, playerA.user.id, String(tokenCard['instanceId'])),
          ).toBeVisible({ timeout: 15_000 });
        }
      } catch (error) {
        throw new Error(`${String(error)}

Token patch:
${JSON.stringify(outcome.patch, null, 2)}

Player A diagnostics:
${diagnosticsA.join('\n')}

Player A cards:
${await visibleCardDebug(pageA)}

Player A body:
${(
  await pageA
    .locator('body')
    .innerText()
    .catch(() => '')
).slice(0, 2000)}`);
      }
      await expect(
        pageA.locator(
          `[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${playerA.user.id}"]`,
          { hasText: 'Unknown Card' },
        ),
      ).toHaveCount(0);
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.token_copy.created',
        payload: {
          playerId: playerA.user.id,
          instanceId: battlefieldIds[0],
          targetPlayerId: playerA.user.id,
        },
        ownerPatch: (patch) =>
          hasOp(patch, 'zone.cards.add') && JSON.stringify(patch).includes('copiedFromInstanceId'),
      });
      nextBaseVersion = outcome.version;
      assertNoStaticPayload(outcome.patch);
      const copiedCards = addedCards(outcome.patch);
      expect(copiedCards).toHaveLength(1);
      assertVisibleCardIdentity(copiedCards[0]!);
      const copiedInstanceId = String(copiedCards[0]!['instanceId']);
      await expect(battlefieldCard(pageA, playerA.user.id, copiedInstanceId)).toBeVisible({
        timeout: 15_000,
      });
      await expect(battlefieldCard(pageA, playerA.user.id, copiedInstanceId)).not.toHaveAttribute(
        'data-card-name',
        'Unknown Card',
      );
      await expect(
        pageA.locator(
          `[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${playerA.user.id}"]`,
          { hasText: 'Unknown Card' },
        ),
      ).toHaveCount(0);
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'zone.random_card.selected',
        payload: { playerId: playerA.user.id, zone: 'hand', instanceId: randomHandId },
        ownerPatch: (patch) =>
          hasOp(patch, 'zone.random_card.selected') && JSON.stringify(patch).includes(randomHandId),
      });
      nextBaseVersion = outcome.version;
      const rivalRandomPatch = latestPatchWithOp(framesB, 'zone.random_card.selected');
      expect(JSON.stringify(rivalRandomPatch)).not.toContain(randomHandId);
      expect(JSON.stringify(rivalRandomPatch)).not.toContain('cardKey');
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.dungeon_marker.changed',
        payload: {
          playerId: playerA.user.id,
          instanceId: battlefieldIds[0],
          position: { x: 0.2, y: 0.4, unit: 'ratio' },
        },
        ownerPatch: (patch) => hasCardField(patch, battlefieldIds[0], 'dungeonMarker'),
      });
      nextBaseVersion = outcome.version;
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.face.changed',
        payload: { playerId: playerA.user.id, instanceId: battlefieldIds[0], faceIndex: 1 },
        ownerPatch: (patch) => hasCardField(patch, battlefieldIds[0], 'activeFaceIndex'),
      });
      nextBaseVersion = outcome.version;
      expect(JSON.stringify(outcome.patch)).not.toContain('cardFaces');
      await expect(battlefieldCard(pageA, playerA.user.id, battlefieldIds[0])).toBeVisible({
        timeout: 15_000,
      });
      await expect(battlefieldCard(pageA, playerA.user.id, battlefieldIds[0])).not.toHaveAttribute(
        'data-card-name',
        'Unknown Card',
      );
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'library.put_top',
        payload: { playerId: playerA.user.id, instanceId: putTopId },
        ownerPatch: (patch) =>
          hasOp(patch, 'zone.cards.add') && JSON.stringify(patch).includes(putTopId),
      });
      nextBaseVersion = outcome.version;
      assertNoStaticPayload(outcome.patch);
      expect(snapshotRefetches).toBe(refetchBaseline);

      outcome = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'library.put_bottom',
        payload: { playerId: playerA.user.id, instanceId: putBottomId },
        ownerPatch: (patch) =>
          hasOp(patch, 'zone.cards.add') && JSON.stringify(patch).includes(putBottomId),
      });
      nextBaseVersion = outcome.version;
      assertNoStaticPayload(outcome.patch);
      expect(snapshotRefetches).toBe(refetchBaseline);
      void nextBaseVersion;

      if (debug.enabled) {
        for (const commandType of EDGE_COMMANDS) {
          const phases = await waitForActionHealth(debug.frames, commandType);
          expect(phases?.['gameplay.runtime_route']).toBe(1);
          expect(phases?.['gameplay.runtime_fallback_count']).toBe(0);
          expect(phases?.['gameplay.runtime_error_count']).toBe(0);
        }
      }
      expect(framesA.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(framesB.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(framesA.some((message) => message['kind'] === 'resync_required')).toBe(false);
      expect(framesB.some((message) => message['kind'] === 'resync_required')).toBe(false);

      await commandPage.close();
      await debug.page?.close();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

async function gameSnapshot(
  request: APIRequestContext,
  gameId: string,
  token: string,
): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { game?: { snapshot?: JsonObject } };
  return (payload.game?.snapshot ?? {}) as JsonObject;
}

function zoneInstanceIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const player = players?.[playerId];
  const zones = player?.['zones'] as Record<string, JsonObject[]> | undefined;
  return (zones?.[zone] ?? [])
    .map((card) => String(card['instanceId'] ?? ''))
    .filter((id) => id !== '');
}

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(
      `Game runtime is not reachable at ${RUNTIME_READY_URL}; runtime release gates must not fall back to legacy.`,
    );
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

function collectPageDiagnostics(page: Page, gameId: string): string[] {
  const diagnostics: string[] = [];
  page.on('console', (message) =>
    diagnostics.push(`[console:${message.type()}] ${message.text()}`),
  );
  page.on('pageerror', (error) => diagnostics.push(`[pageerror] ${error.message}`));
  page.on('requestfailed', (request) =>
    diagnostics.push(
      `[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`,
    ),
  );
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
): Promise<{ page?: Page; frames: JsonObject[]; enabled: boolean }> {
  if (!REQUIRE_DEBUG_HEALTH) {
    return { frames: [], enabled: false };
  }

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
    (window as unknown as { __commanderZoneDebugSocket?: WebSocket }).__commanderZoneDebugSocket =
      socket;
  }, url.toString());
  await expect
    .poll(() => frames.some((message) => message['kind'] === 'debug_health'), { timeout: 15_000 })
    .toBe(true);
  return { page: debugPage, frames, enabled: true };
}

async function websocketTicket(
  request: APIRequestContext,
  gameId: string,
  token: string,
): Promise<{ websocketUrl: string }> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { websocketUrl?: string };
  if (!payload.websocketUrl) {
    throw new Error('WebSocket ticket response did not include websocketUrl.');
  }
  return { websocketUrl: payload.websocketUrl };
}

async function waitForGameplayConnection(frames: JsonObject[]): Promise<void> {
  await expect
    .poll(
      () =>
        frames.some(
          (message) => message['kind'] === 'connection_state' && message['status'] === 'connected',
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
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
  const clientActionId = `edge-runtime-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const patchPromise = waitForPatchV2(
    frames,
    (patch) => patch['ackClientActionId'] === clientActionId && options.ownerPatch(patch),
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
      version: Math.max(
        options.baseVersion + 1,
        Number(patch['version'] ?? options.baseVersion + 1),
      ),
      patch,
    };
  } catch (error) {
    const rawFrames = await commandSocketFrames(page, socketId);
    const legacyFallback = rawFrames.some(
      (frame) =>
        typeof frame === 'object' &&
        frame !== null &&
        (frame as JsonObject)['kind'] === 'game_patch',
    );
    if (legacyFallback) {
      throw new Error(
        `Runtime gate received legacy game_patch for ${options.type}.\nRaw command socket frames:\n${JSON.stringify(rawFrames, null, 2)}`,
      );
    }
    throw new Error(
      `${String(error)}\nRaw command socket frames:\n${JSON.stringify(rawFrames, null, 2)}`,
    );
  } finally {
    await closeCommandSocket(page, socketId);
  }
}

async function openCommandSocketAndSend(
  page: Page,
  websocketUrl: string,
  message: JsonObject,
): Promise<string> {
  return page.evaluate(
    ({ url, payload }) =>
      new Promise<string>((resolve, reject) => {
        const socket = new WebSocket(url);
        const socketId = `edge-command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const timeout = window.setTimeout(() => {
          socket.close();
          reject(new Error('Timed out sending raw WebSocket command.'));
        }, 15_000);
        socket.onopen = () => {
          socket.send(JSON.stringify(payload));
          window.clearTimeout(timeout);
          const store = window as unknown as {
            __commanderZoneCommandSockets?: Record<string, WebSocket>;
          };
          store.__commanderZoneCommandSockets = store.__commanderZoneCommandSockets ?? {};
          store.__commanderZoneCommandSockets[socketId] = socket;
          resolve(socketId);
        };
        socket.onmessage = (event) => {
          const store = window as unknown as {
            __commanderZoneCommandSocketFrames?: Record<string, unknown[]>;
          };
          store.__commanderZoneCommandSocketFrames = store.__commanderZoneCommandSocketFrames ?? {};
          store.__commanderZoneCommandSocketFrames[socketId] =
            store.__commanderZoneCommandSocketFrames[socketId] ?? [];
          try {
            store.__commanderZoneCommandSocketFrames[socketId].push(
              JSON.parse(String(event.data)) as unknown,
            );
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
    const store = window as unknown as {
      __commanderZoneCommandSocketFrames?: Record<string, unknown[]>;
    };
    return store.__commanderZoneCommandSocketFrames?.[id] ?? [];
  }, socketId);
}

async function closeCommandSocket(page: Page, socketId: string): Promise<void> {
  await page.evaluate((id) => {
    const store = window as unknown as {
      __commanderZoneCommandSockets?: Record<string, WebSocket>;
    };
    const socket = store.__commanderZoneCommandSockets?.[id];
    if (socket) {
      socket.close();
      if (store.__commanderZoneCommandSockets) {
        delete store.__commanderZoneCommandSockets[id];
      }
    }
  }, socketId);
}

function waitForPatchV2(
  frames: JsonObject[],
  predicate: (message: JsonObject) => boolean,
): Promise<JsonObject> {
  return expect
    .poll(
      () => frames.find((message) => message['kind'] === 'patch.v2' && predicate(message)) ?? null,
      { timeout: 20_000 },
    )
    .not.toBeNull()
    .then(() => {
      const patch = frames.find((message) => message['kind'] === 'patch.v2' && predicate(message));
      if (!patch) {
        throw new Error(
          `patch.v2 frame was not captured. Recent patches: ${JSON.stringify(frames.filter((message) => message['kind'] === 'patch.v2').slice(-5), null, 2)}`,
        );
      }
      return patch;
    });
}

function latestPatchWithOp(frames: JsonObject[], op: string): JsonObject {
  const patch = frames
    .filter((message) => message['kind'] === 'patch.v2' && hasOp(message, op))
    .at(-1);
  if (!patch) {
    throw new Error(`No patch.v2 frame captured for op ${op}.`);
  }
  return patch;
}

async function waitForActionHealth(
  frames: JsonObject[],
  action: string,
): Promise<JsonObject | null> {
  await expect
    .poll(
      () => {
        const phases = actionPhasesWithMetric(frames, action);
        return phases !== null && phases['gameplay.runtime_route'] !== undefined;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return actionPhasesWithMetric(frames, action);
}

function actionPhasesWithMetric(frames: JsonObject[], action: string): JsonObject | null {
  for (const health of frames.filter((message) => message['kind'] === 'debug_health').reverse()) {
    const recent = ((
      (health['health'] as JsonObject | undefined)?.['actions'] as JsonObject | undefined
    )?.['recent'] ?? []) as JsonObject[];
    const match = recent.filter((item) => item['action'] === action).at(-1);
    const phases = (match?.['phases'] as JsonObject | undefined) ?? null;
    if (phases?.['gameplay.runtime_route'] !== undefined) {
      return phases;
    }
  }
  return null;
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

function hasOp(message: JsonObject, op: string): boolean {
  const ops = Array.isArray(message['ops']) ? (message['ops'] as JsonObject[]) : [];
  return ops.some((item) => item['op'] === op);
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? (message['ops'] as JsonObject[]) : [];
  return ops.find((item) => item['op'] === op) ?? null;
}

function zoneCardsAddedCount(message: JsonObject): number {
  const op = operation(message, 'zone.cards.add');
  const cards = Array.isArray(op?.['cards']) ? (op['cards'] as JsonObject[]) : [];
  return cards.length;
}

function addedCards(message: JsonObject): JsonObject[] {
  const op = operation(message, 'zone.cards.add');
  return Array.isArray(op?.['cards']) ? (op['cards'] as JsonObject[]) : [];
}

function assertVisibleCardIdentity(card: JsonObject): void {
  expect(card['cardKey']).toBeTruthy();
  expect(card['printId']).toBeTruthy();
  expect(card['cardVersion']).toBeTruthy();
  expect(card['language']).toBeTruthy();
  expect(card['viewerVisibility']).toBe('public');
}

function hasCardField(message: JsonObject, instanceId: string, field: string): boolean {
  const op = operation(message, 'card.field.set');
  return op?.['instanceId'] === instanceId && op[field] !== undefined;
}

function battlefieldCard(page: Page, ownerPlayerId: string, instanceId: string) {
  return page.locator(
    `[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`,
  );
}

async function visibleCardDebug(page: Page): Promise<string> {
  return page
    .locator('[data-testid="game-card"], [data-testid="mini-battlefield-card"]')
    .evaluateAll((elements) =>
      JSON.stringify(
        elements.map((element) => ({
          testId: element.getAttribute('data-testid'),
          instanceId: element.getAttribute('data-card-instance-id'),
          ownerId:
            element.getAttribute('data-owner-player-id') ??
            element.getAttribute('data-arrow-card-player-id'),
          zone: element.getAttribute('data-zone'),
          name:
            element.getAttribute('data-card-name') ??
            element.getAttribute('alt') ??
            element.textContent?.trim().slice(0, 80),
          text: element.textContent?.trim().slice(0, 80),
        })),
        null,
        2,
      ),
    )
    .catch((error) => `Could not read cards: ${String(error)}`);
}

function assertNoStaticPayload(message: JsonObject): void {
  const ops = Array.isArray(message['ops']) ? (message['ops'] as JsonObject[]) : [];
  for (const op of ops) {
    for (const card of cardsFromOperation(op)) {
      const encodedCard = JSON.stringify(card);
      expect(encodedCard).not.toContain('imageUris');
      expect(encodedCard).not.toContain('oracleText');
      expect(encodedCard).not.toContain('cardFaces');
    }
  }
  const encoded = JSON.stringify(message);
  expect(encoded).not.toContain('oracleText');
  expect(encoded).not.toContain('must-not-leak');
}

function cardsFromOperation(op: JsonObject): JsonObject[] {
  const cards = op['cards'];
  if (Array.isArray(cards)) {
    return cards.filter(
      (card): card is JsonObject =>
        card !== null && typeof card === 'object' && !Array.isArray(card),
    );
  }
  const card = op['card'];
  if (card !== null && typeof card === 'object' && !Array.isArray(card)) {
    return [card as JsonObject];
  }
  return [];
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  try {
    const text = typeof payload === 'string' ? payload : payload.toString('utf8');
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : null;
  } catch {
    return null;
  }
}
