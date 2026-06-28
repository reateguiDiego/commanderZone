import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { openChat } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

type JsonObject = Record<string, unknown>;

test('chat/reactions stream emits patch.v2 without snapshot refetch or game_patch', async ({ browser, request, baseURL }) => {
  test.setTimeout(120_000);
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithBasicDecks(request, {
    playerAPrefix: 'chat-stream-a',
    playerBPrefix: 'chat-stream-b',
  });
  const { gameId, playerA, playerB } = setup;
  await resolveGameToPlaying(request, gameId, [playerA, playerB]);

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
    const commandPage = await contextB.newPage();
    const framesA = collectWebSocketFrames(pageA);
    const framesB = collectWebSocketFrames(pageB);
    const diagnosticsA = collectPageDiagnostics(pageA, gameId);
    const diagnosticsB = collectPageDiagnostics(pageB, gameId);
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
    try {
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
    } catch (error) {
      throw new Error(`${String(error)}

Player A diagnostics:
${diagnosticsA.join('\n')}

Player B diagnostics:
${diagnosticsB.join('\n')}`);
    }

    await Promise.all([waitForGameplayConnection(framesA), waitForGameplayConnection(framesB)]);
    await Promise.all([openChat(pageA), openChat(pageB)]);

    const refetchBaseline = snapshotRefetches;
    const ticketA = await websocketTicket(request, gameId, playerA.token);
    const nextBaseVersion = await gameVersion(request, gameId, playerA.token);
    const chatText = `stream-chat-${Date.now()}`;
    const messageClientActionId = `chat-message-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const messagePatchPromise = waitForPatchV2(framesB, (patch) =>
      hasOp(patch, 'chat.message.add') && JSON.stringify(patch).includes(chatText),
    );
    const messageSocketId = await openCommandSocketAndSend(commandPage, ticketA.websocketUrl, {
      kind: 'command.v2',
      gameId,
      messageId: messageClientActionId,
      type: 'chat.message',
      payload: { message: chatText },
      baseVersion: nextBaseVersion,
      clientActionId: messageClientActionId,
    });
    const messagePatch = await messagePatchPromise;
    await closeCommandSocket(commandPage, messageSocketId);
    const messageId = firstChatMessageId(messagePatch);
    expect(messageId).not.toBe('');
    await expect.poll(async () => hasChatMessage(pageB, playerA.user.displayName, chatText)).toBe(true);
    expect(snapshotRefetches).toBe(refetchBaseline);

    const ticket = await websocketTicket(request, gameId, playerB.token);
    const reactionClientActionId = `chat-reaction-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const reactionPatchPromise = waitForPatchV2(framesA, (patch) =>
      patch['ackClientActionId'] === reactionClientActionId
      && hasOp(patch, 'chat.reaction.set')
      && JSON.stringify(patch).includes(messageId),
    );
    const socketId = await openCommandSocketAndSend(commandPage, ticket.websocketUrl, {
      kind: 'command.v2',
      gameId,
      messageId: reactionClientActionId,
      type: 'chat.reaction.toggled',
      payload: { messageId, reaction: 'like' },
      baseVersion: Math.max(1, Number(messagePatch['version'] ?? 1)),
      clientActionId: reactionClientActionId,
    });
    await reactionPatchPromise;
    const rawReactionFrames = await commandSocketFrames(commandPage, socketId);
    await closeCommandSocket(commandPage, socketId);
    expect(rawReactionFrames.some((frame) => typeof frame === 'object' && frame !== null && (frame as JsonObject)['kind'] === 'game_patch')).toBe(false);
    expect(snapshotRefetches).toBe(refetchBaseline);

    const chatPhases = await waitForActionPhases(debug.frames, 'chat.message', 'chat.message_route');
    expect(chatPhases?.['chat.message_route']).toBe(1);
    expect(chatPhases?.['chat.snapshot_write_count']).toBe(0);
    expect(Number(chatPhases?.['chat.patch_bytes'] ?? 0)).toBeGreaterThan(0);
    const reactionPhases = await waitForActionPhases(debug.frames, 'chat.reaction.toggled', 'chat.reaction_route');
    expect(reactionPhases?.['chat.reaction_route']).toBe(1);
    expect(reactionPhases?.['chat.snapshot_write_count']).toBe(0);
    expect(Number(reactionPhases?.['chat.patch_bytes'] ?? 0)).toBeGreaterThan(0);

    expect(framesA.some((message) => message['kind'] === 'game_patch')).toBe(false);
    expect(framesB.some((message) => message['kind'] === 'game_patch')).toBe(false);
    expect(framesA.some((message) => message['kind'] === 'resync_required')).toBe(false);
    expect(framesB.some((message) => message['kind'] === 'resync_required')).toBe(false);

    await debug.page.close();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

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

async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { game?: { snapshot?: { version?: number } } };

  return Math.max(1, Number(payload.game?.snapshot?.version ?? 1));
}

async function hasChatMessage(page: Page, displayName: string, message: string): Promise<boolean> {
  const row = page.getByTestId('chat-message').filter({ hasText: displayName }).filter({ hasText: message });

  return (await row.count()) > 0;
}

function waitForPatchV2(frames: JsonObject[], predicate: (message: JsonObject) => boolean): Promise<JsonObject> {
  return expect.poll(() => {
    const patch = frames.find((message) => message['kind'] === 'patch.v2' && predicate(message));
    if (patch) {
      return 'patch';
    }
    if (frames.some((message) => message['kind'] === 'game_patch')) {
      return 'legacy';
    }
    return null;
  }, {
    timeout: 20_000,
  }).not.toBeNull().then(() => {
    const patch = frames.find((message) => message['kind'] === 'patch.v2' && predicate(message));
    if (!patch) {
      const legacyPatch = frames.find((message) => message['kind'] === 'game_patch');
      if (legacyPatch) {
        throw new Error(`Chat stream gate received legacy game_patch. Ensure GAMEPLAY_STREAMS_ENABLED=1 and GAMEPLAY_V2_PATCH_ENABLED=1 on the WebSocket/API services.
Legacy frame:
${JSON.stringify(legacyPatch, null, 2)}`);
      }
      throw new Error(`patch.v2 frame was not captured. Recent frames: ${JSON.stringify(frames.slice(-5), null, 2)}`);
    }
    return patch;
  });
}

async function waitForGameplayConnection(frames: JsonObject[]): Promise<void> {
  await expect.poll(() => frames.some((message) =>
    message['kind'] === 'connection_state' && message['status'] === 'connected',
  ), { timeout: 20_000 }).toBe(true);
}

async function waitForActionPhases(frames: JsonObject[], action: string, metric: string): Promise<JsonObject | null> {
  await expect.poll(() => {
    const phases = latestActionPhases(frames, action);
    return phases !== null && phases[metric] !== undefined;
  }, { timeout: 15_000 }).toBe(true);

  return latestActionPhases(frames, action);
}

function latestActionPhases(frames: JsonObject[], action: string): JsonObject | null {
  for (const health of frames.filter((message) => message['kind'] === 'debug_health').reverse()) {
    const recent = ((((health['health'] as JsonObject | undefined)?.['actions'] as JsonObject | undefined)?.['recent']) ?? []) as JsonObject[];
    const match = recent.filter((item) => item['action'] === action).at(-1);
    const phases = (match?.['phases'] as JsonObject | undefined) ?? null;
    if (phases !== null) {
      return phases;
    }
  }

  return null;
}

function hasOp(message: JsonObject, op: string): boolean {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.some((item) => item['op'] === op);
}

function firstChatMessageId(patch: JsonObject): string {
  const ops = Array.isArray(patch['ops']) ? patch['ops'] as JsonObject[] : [];
  const message = (ops.find((item) => item['op'] === 'chat.message.add')?.['message'] ?? {}) as JsonObject;
  return typeof message['id'] === 'string' ? message['id'] : '';
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  try {
    const parsed = JSON.parse(String(payload)) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

async function openCommandSocketAndSend(page: Page, websocketUrl: string, message: JsonObject): Promise<string> {
  return page.evaluate(
    ({ url, payload }) => new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(url);
      const socketId = `chat-command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
