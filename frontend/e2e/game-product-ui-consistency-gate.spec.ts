import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { focusPlayer } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type UiConsistencySetup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;

test.describe('product correctness UI consistency runtime gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: UiConsistencySetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await assertGameRuntimeReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `ui${Date.now().toString(36)}`,
      playerAPrefix: 'ua',
      playerBPrefix: 'ub',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('patches clear stale selection, preview and context menu state without resync', async ({ browser, request, baseURL }) => {
    test.setTimeout(240_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const { gameId, playerA } = setup;
    const snapshot = await gameSnapshot(request, gameId, playerA.token);
    const handIds = zoneInstanceIds(snapshot, playerA.user.id, 'hand');
    if (handIds.length < 2) {
      throw new Error(`Expected at least 2 hand cards for UI consistency gate, got ${handIds.length}.`);
    }
    const [previewSelectionId, contextMenuId] = handIds;
    let nextBaseVersion = await gameVersion(request, gameId, playerA.token);

    const contextA = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken) });
    await enableFrontendGameplayV2(contextA);

    try {
      const pageA = await contextA.newPage();
      const commandPage = await contextA.newPage();
      const framesA = collectWebSocketFrames(pageA);
      let bootstrapRequests = 0;
      pageA.on('request', (httpRequest) => {
        const url = httpRequest.url();
        if (httpRequest.method() === 'GET' && (url.includes(`/games/${gameId}/snapshot`) || url.includes(`/games/${gameId}/bootstrap`))) {
          bootstrapRequests += 1;
        }
      });

      await Promise.all([commandPage.goto('about:blank'), pageA.goto(`/games/${gameId}`)]);
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(framesA);
      await focusPlayer(pageA, playerA.user.displayName);
      const baselineBootstrapRequests = bootstrapRequests;
      const ticket = await websocketTicket(request, gameId, playerA.token);

      const selectedHandCard = handCard(pageA, playerA.user.id, previewSelectionId);
      await expect(selectedHandCard).toBeVisible({ timeout: 15_000 });
      await selectedHandCard.dispatchEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      await expect(selectedHandCard).toHaveClass(/selected/);
      await selectedHandCard.dispatchEvent('pointerenter', {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      await selectedHandCard.dispatchEvent('mouseenter', {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      await expect(pageA.locator('.card-preview-overlay')).toBeVisible({ timeout: 5_000 });

      const selectionMove = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: previewSelectionId,
          position: { x: 0.32, y: 0.43, unit: 'ratio' },
        },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.move'),
      });
      nextBaseVersion = selectionMove.version;

      const movedBattlefieldCard = battlefieldCard(pageA, playerA.user.id, previewSelectionId);
      await expect(movedBattlefieldCard).toBeVisible({ timeout: 15_000 });
      await expect(movedBattlefieldCard).not.toHaveClass(/selected/);
      await expect(pageA.locator('.card-preview-overlay')).toBeHidden({ timeout: 5_000 });
      expect(bootstrapRequests).toBe(baselineBootstrapRequests);

      const menuHandCard = handCard(pageA, playerA.user.id, contextMenuId);
      await expect(menuHandCard).toBeVisible({ timeout: 15_000 });
      await menuHandCard.dispatchEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 320,
        clientY: 560,
      });
      await expect(pageA.getByTestId('context-menu')).toBeVisible({ timeout: 5_000 });

      const contextMenuMove = await sendRuntimeCommandAndWait(commandPage, ticket.websocketUrl, framesA, {
        gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: contextMenuId,
          position: { x: 0.48, y: 0.43, unit: 'ratio' },
        },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.move'),
      });
      nextBaseVersion = contextMenuMove.version;
      await expect(battlefieldCard(pageA, playerA.user.id, contextMenuId)).toBeVisible({ timeout: 15_000 });
      await expect(pageA.getByTestId('context-menu')).toBeHidden({ timeout: 5_000 });
      expect(bootstrapRequests).toBe(baselineBootstrapRequests);

      await pageA.getByTestId('game-screen').click({ button: 'right' });
      await expect(pageA.getByTestId('context-menu')).toBeVisible({ timeout: 5_000 });
      await pageA.keyboard.press('Escape');
      await expect(pageA.getByTestId('context-menu')).toBeHidden({ timeout: 5_000 });

      expect(framesA.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(framesA.some((message) => message['kind'] === 'resync_required')).toBe(false);
      void nextBaseVersion;
      await commandPage.close();
    } finally {
      await contextA.close();
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
  const clientActionId = `ui-consistency-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

function handCard(page: Page, ownerPlayerId: string, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="hand"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`);
}

function battlefieldCard(page: Page, ownerPlayerId: string, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`);
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
