import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type LifecycleSnapshot = {
  players: Record<string, { status?: string }>;
  rematch?: { votes?: Record<string, { vote?: string }> };
};

test.describe.configure({ mode: 'serial' });

test('lifecycle runtime emits patch.v2 without snapshot refetch or game_patch', async ({ browser, request, baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }
  await assertGameRuntimeReady(request);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const setup = await createCommanderGameWithBasicDecks(request, {
    playerAPrefix: `lcy-a-${suffix.slice(-7)}`,
    playerBPrefix: `lcy-b-${suffix.slice(-7)}`,
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
      waitForGameplayConnection(framesA),
      waitForGameplayConnection(framesB),
    ]);

    const refetchBaseline = snapshotRefetches;

    const ticketB = await websocketTicket(request, gameId, playerB.token);
    const concedeOutcome = await sendRuntimeCommandAndWait(commandPage, ticketB.websocketUrl, framesA, {
      gameId,
      baseVersion: await gameVersion(request, gameId, playerB.token),
      type: 'game.concede',
      payload: { playerId: playerB.user.id },
      ownerPatch: (patch) => hasOp(patch, 'player.status.set'),
    });
    const concedePatch = concedeOutcome.patch;
    expect(concedePatch['kind']).toBe('patch.v2');
    expect(JSON.stringify(concedePatch)).toContain(playerB.user.id);
    expect(snapshotRefetches).toBe(refetchBaseline);

    const secondConcede = await sendRuntimeCommandExpectRejected(commandPage, ticketB.websocketUrl, {
      gameId,
      baseVersion: concedeOutcome.version,
      type: 'game.concede',
      payload: { playerId: playerB.user.id },
    });
    expect(secondConcede['status']).toBe('rejected');
    expect(JSON.stringify(secondConcede)).toContain('already conceded');

    const ticketA = await websocketTicket(request, gameId, playerA.token);
    const closeOutcome = await sendRuntimeCommandAndWait(commandPage, ticketA.websocketUrl, framesB, {
      gameId,
      baseVersion: concedeOutcome.version,
      type: 'game.close',
      payload: { requestedBy: playerA.user.id },
      ownerPatch: (patch) => hasOp(patch, 'game.status.set'),
    });
    const closePatch = closeOutcome.patch;
    const rawCloseFrames = closeOutcome.rawFrames;
    expect(closePatch['kind']).toBe('patch.v2');
    expect(JSON.stringify(closePatch)).toContain('finished');
    expect(rawCloseFrames.some((frame) => typeof frame === 'object' && frame !== null && (frame as JsonObject)['kind'] === 'game_patch')).toBe(false);
    expect(snapshotRefetches).toBe(refetchBaseline);

    const concedePhases = await waitForActionPhases(debug.frames, 'game.concede', 'lifecycle.runtime_route');
    expect(concedePhases?.['lifecycle.runtime_route']).toBe(1);
    expect(concedePhases?.['lifecycle.snapshot_write_count']).toBe(0);
    const closePhases = await waitForActionPhases(debug.frames, 'game.close', 'lifecycle.runtime_route');
    expect(closePhases?.['lifecycle.runtime_route']).toBe(1);
    expect(closePhases?.['lifecycle.snapshot_write_count']).toBe(0);

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

test('disconnect vote emits patch.v2 without snapshot refetch or game_patch', async ({ browser, request, baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }
  await assertGameRuntimeReady(request);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const setup = await createCommanderGameWithBasicDecks(request, {
    playerAPrefix: `dcv-a-${suffix.slice(-7)}`,
    playerBPrefix: `dcv-b-${suffix.slice(-7)}`,
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
    const framesA = collectWebSocketFrames(pageA);
    const framesB = collectWebSocketFrames(pageB);
    let snapshotRefetches = 0;

    pageA.on('request', (httpRequest) => {
      const url = httpRequest.url();
      if (httpRequest.method() === 'GET' && (url.includes(`/games/${gameId}/snapshot`) || url.includes(`/games/${gameId}/bootstrap`))) {
        snapshotRefetches += 1;
      }
    });

    await Promise.all([pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
    await Promise.all([
      expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
      expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
      waitForGameplayConnection(framesA),
      waitForGameplayConnection(framesB),
    ]);
    const refetchBaseline = snapshotRefetches;

    await pageB.close();
    const voteHeading = pageA.getByRole('heading', { name: 'Jugador desconectado' });
    await expect(voteHeading).toBeVisible({ timeout: 30_000 });

    await pageA.locator('.modal-panel').filter({ has: voteHeading }).getByRole('button', { name: 'Expulsar', exact: true }).click();
    const votePatch = await waitForPatchV2(framesA, (patch) => hasOp(patch, 'disconnect.vote.set') && hasOp(patch, 'player.status.set'));
    expect(JSON.stringify(votePatch)).toContain(playerB.user.id);
    expect(snapshotRefetches).toBe(refetchBaseline);
    expect(framesA.some((message) => message['kind'] === 'game_patch')).toBe(false);
    expect(framesA.some((message) => message['kind'] === 'resync_required')).toBe(false);

    const phases = await waitForActionPhases(debug.frames, 'disconnect.vote', 'disconnect.vote_route');
    expect(phases?.['disconnect.vote_route']).toBe(1);
    expect(phases?.['disconnect.snapshot_write_count']).toBe(0);
    await debug.page.close();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('leave table concedes through runtime and navigates back to rooms', async ({ browser, request, baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }
  await assertGameRuntimeReady(request);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const setup = await createCommanderGameWithBasicDecks(request, {
    playerAPrefix: `lvr-a-${suffix.slice(-7)}`,
    playerBPrefix: `lvr-b-${suffix.slice(-7)}`,
  });
  const { gameId, roomId, playerA, playerB } = setup;
  await resolveGameToPlaying(request, gameId, [playerA, playerB]);

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
  });
  await enableFrontendGameplayV2(contextA);

  try {
    const debug = await openDebugObserver(contextA, request, gameId, playerA.token);
    const pageA = await contextA.newPage();
    const framesA = collectWebSocketFrames(pageA);
    let snapshotRefetches = 0;
    let leaveRoomResponseStatus: number | null = null;

    pageA.on('request', (httpRequest) => {
      const url = httpRequest.url();
      if (httpRequest.method() === 'GET' && (url.includes(`/games/${gameId}/snapshot`) || url.includes(`/games/${gameId}/bootstrap`))) {
        snapshotRefetches += 1;
      }
    });
    pageA.on('response', (response) => {
      if (response.url().includes(`/rooms/${roomId}/leave`)) {
        leaveRoomResponseStatus = response.status();
      }
    });

    await pageA.setViewportSize({ width: 740, height: 500 });
    await pageA.goto(`/games/${gameId}`);
    await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
    await waitForGameplayConnection(framesA);
    const refetchBaseline = snapshotRefetches;

    await pageA.getByTestId('unsupported-resolution-leave-room').click();
    const leaveDialog = pageA.getByRole('dialog', { name: 'Leave table?' });
    await expect(leaveDialog).toBeVisible();

    const patchPromise = waitForPatchV2(framesA, (patch) => hasOp(patch, 'player.status.set') && typeof patch['ackClientActionId'] === 'string');
    const leaveRoomPromise = pageA.waitForResponse((response) =>
      response.url().includes(`/rooms/${roomId}/leave`),
      { timeout: 30_000 },
    );
    await leaveDialog.getByRole('button', { name: 'Leave table', exact: true }).click();
    const patch = await patchPromise;
    const leaveRoomResponse = await leaveRoomPromise;

    expect(patch['kind']).toBe('patch.v2');
    expect(JSON.stringify(patch)).toContain(playerA.user.id);
    expect(leaveRoomResponse.ok()).toBe(true);
    expect(leaveRoomResponseStatus).toBe(leaveRoomResponse.status());
    await expect(pageA).toHaveURL(/\/rooms$/, { timeout: 30_000 });

    const snapshotAfterLeave = await gameSnapshot(request, gameId, playerB.token);
    const leavingPlayer = snapshotAfterLeave.players[playerA.user.id];
    expect(leavingPlayer?.status).toBe('conceded');
    expect(snapshotAfterLeave.rematch?.votes?.[playerA.user.id]?.vote).toBe('leave');

    expect(snapshotRefetches).toBe(refetchBaseline);
    expect(framesA.some((message) => message['kind'] === 'game_patch')).toBe(false);
    expect(framesA.some((message) => message['kind'] === 'resync_required')).toBe(false);

    const concedePhases = await waitForActionPhases(debug.frames, 'game.concede', 'lifecycle.runtime_route');
    expect(concedePhases?.['lifecycle.runtime_route']).toBe(1);
    expect(concedePhases?.['lifecycle.snapshot_write_count']).toBe(0);
    await debug.page.close();
  } finally {
    await contextA.close();
  }
});

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 10_000 });
  if (!response.ok()) {
    throw new Error(`game-runtime is not ready at ${RUNTIME_READY_URL}: ${response.status()} ${await response.text()}`);
  }
}

async function openDebugObserver(context: BrowserContext, request: APIRequestContext, gameId: string, token: string): Promise<{ page: Page; frames: JsonObject[] }> {
  const ticket = await websocketTicket(request, gameId, token);
  const page = await context.newPage();
  const frames = collectWebSocketFrames(page);
  await page.goto(`/games/${gameId}/debug?token=${encodeURIComponent(ticket.token)}`);
  await expect.poll(() => frames.some((message) => message['kind'] === 'debug_health'), { timeout: 15_000 }).toBe(true);
  return { page, frames };
}

function collectWebSocketFrames(page: Page): JsonObject[] {
  const messages: JsonObject[] = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) {
        messages.push(parsed);
      }
    });
  });
  return messages;
}

async function waitForPatchV2(frames: JsonObject[], predicate: (patch: JsonObject) => boolean): Promise<JsonObject> {
  await expect.poll(() => frames.some((message) => message['kind'] === 'patch.v2' && predicate(message)), { timeout: 30_000 }).toBe(true);
  const patch = frames.find((message) => message['kind'] === 'patch.v2' && predicate(message));
  if (!patch) {
    throw new Error(`patch.v2 frame was not captured. Recent frames: ${JSON.stringify(frames.slice(-5), null, 2)}`);
  }
  return patch;
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

async function sendRuntimeCommandAndWait(
  page: Page,
  websocketUrl: string,
  frames: JsonObject[],
  options: { gameId: string; baseVersion: number; type: string; payload: JsonObject; ownerPatch: (patch: JsonObject) => boolean },
): Promise<{ version: number; patch: JsonObject; rawFrames: JsonObject[] }> {
  const clientActionId = `lifecycle-runtime-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const patchPromise = waitForPatchV2(frames, (patch) => patch['ackClientActionId'] === clientActionId && options.ownerPatch(patch));
  const socketId = await openCommandSocketAndSend(page, websocketUrl, {
    kind: 'command.v2',
    gameId: options.gameId,
    messageId: clientActionId,
    type: options.type,
    payload: options.payload,
    baseVersion: options.baseVersion,
    clientActionId,
  });
  try {
    const patch = await patchPromise;
    const rawFrames = await commandSocketFrames(page, socketId);
    if (rawFrames.some((frame) => typeof frame === 'object' && frame !== null && (frame as JsonObject)['kind'] === 'game_patch')) {
      throw new Error(`Runtime gate received legacy game_patch for ${options.type}.\nRaw command socket frames:\n${JSON.stringify(rawFrames, null, 2)}`);
    }
    return {
      version: Math.max(options.baseVersion + 1, Number(patch['version'] ?? options.baseVersion + 1)),
      patch,
      rawFrames,
    };
  } catch (error) {
    const rawFrames = await commandSocketFrames(page, socketId);
    throw new Error(`${String(error)}\nRaw command socket frames:\n${JSON.stringify(rawFrames, null, 2)}`);
  } finally {
    await closeCommandSocket(page, socketId);
  }
}

async function sendRuntimeCommandExpectRejected(
  page: Page,
  websocketUrl: string,
  options: { gameId: string; baseVersion: number; type: string; payload: JsonObject },
): Promise<JsonObject> {
  const clientActionId = `lifecycle-rejected-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const socketId = await openCommandSocketAndSend(page, websocketUrl, {
    kind: 'command.v2',
    gameId: options.gameId,
    messageId: clientActionId,
    type: options.type,
    payload: options.payload,
    baseVersion: options.baseVersion,
    clientActionId,
  });
  try {
    await expect.poll(async () => {
      const frames = await commandSocketFrames(page, socketId);
      return frames.some((frame) => frame['kind'] === 'command_ack' && frame['status'] === 'rejected');
    }, { timeout: 15_000 }).toBe(true);
    const frames = await commandSocketFrames(page, socketId);
    const rejected = frames.find((frame) => frame['kind'] === 'command_ack' && frame['status'] === 'rejected');
    if (!rejected) {
      throw new Error(`Rejected command_ack was not captured. Frames: ${JSON.stringify(frames, null, 2)}`);
    }
    if (frames.some((frame) => frame['kind'] === 'patch.v2')) {
      throw new Error(`Rejected lifecycle command emitted patch.v2. Frames: ${JSON.stringify(frames, null, 2)}`);
    }
    return rejected;
  } catch (error) {
    const frames = await commandSocketFrames(page, socketId);
    throw new Error(`${String(error)}\nRejected command socket frames:\n${JSON.stringify(frames, null, 2)}`);
  } finally {
    await closeCommandSocket(page, socketId);
  }
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
      const socketId = `lifecycle-command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const timeout = window.setTimeout(() => {
        socket.close();
        reject(new Error('Timed out sending raw WebSocket command.'));
      }, 15_000);
      socket.onopen = () => {
        window.__czLifecycleSockets = window.__czLifecycleSockets ?? {};
        window.__czLifecycleSockets[socketId] = { socket, frames: [] };
        socket.send(JSON.stringify(payload));
        window.clearTimeout(timeout);
        resolve(socketId);
      };
      socket.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Raw WebSocket connection failed.'));
      };
      socket.onmessage = (event) => {
        const entry = window.__czLifecycleSockets?.[socketId];
        if (entry) {
          entry.frames.push(event.data);
        }
      };
    }),
    { url: websocketUrl, payload: message },
  );
}

async function commandSocketFrames(page: Page, socketId: string): Promise<JsonObject[]> {
  return page.evaluate((id) => {
    const entry = window.__czLifecycleSockets?.[id];
    return (entry?.frames ?? []).map((frame) => {
      try {
        return JSON.parse(String(frame)) as JsonObject;
      } catch {
        return null;
      }
    }).filter((frame): frame is JsonObject => frame !== null);
  }, socketId);
}

async function closeCommandSocket(page: Page, socketId: string): Promise<void> {
  await page.evaluate((id) => {
    window.__czLifecycleSockets?.[id]?.socket.close();
    if (window.__czLifecycleSockets) {
      delete window.__czLifecycleSockets[id];
    }
  }, socketId);
}

async function websocketTicket(request: APIRequestContext, gameId: string, token: string): Promise<{ websocketUrl: string; token: string }> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBe(true);
  return await response.json();
}

async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json() as { game?: { snapshot?: { version?: number } } };
  return Number(body.game?.snapshot?.version ?? 1);
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<LifecycleSnapshot> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json() as { game?: { snapshot?: JsonObject } };
  if (!body.game?.snapshot) {
    throw new Error('Snapshot response did not include game.snapshot.');
  }
  return body.game.snapshot as LifecycleSnapshot;
}

declare global {
  interface Window {
    __czLifecycleSockets?: Record<string, { socket: WebSocket; frames: string[] }>;
  }
}
