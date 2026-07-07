import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { openChat } from './support/game-table';
import { sendRuntimeCommand, type RuntimeWebSocketCommandResult } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const API_READY_URL = process.env['E2E_API_READY_URL'] ?? `${API_BASE_URL}/readyz`;
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
const RUNTIME_METRICS_URL = process.env['E2E_GAME_RUNTIME_METRICS_URL'] ?? 'http://127.0.0.1:8091/metrics';
const WEBSOCKET_READY_URL = process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz';

type JsonObject = Record<string, unknown>;
type ChatGameLogPlayer = {
  token: string;
  refreshToken: string;
  user: RealUserSession['user'];
  credentials: RealUserSession['credentials'];
  deck: BasicCommanderDeckFromDatabaseResult;
};
type ChatGameLogSetup = { gameId: string; roomId: string; players: ChatGameLogPlayer[] };

test.describe('product chat and gamelog runtime gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: ChatGameLogSetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await Promise.all([
      assertServiceReady(request, API_READY_URL, 'api readyz'),
      assertServiceReady(request, WEBSOCKET_READY_URL, 'websocket readyz'),
      assertServiceReady(request, RUNTIME_READY_URL, 'game-runtime readyz'),
    ]);
    setup = await createThreePlayerGame(request, `chatlog${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
  });

  test('chat, reactions and game log stream live and survive refresh/reconnect', async ({ browser, request, baseURL }) => {
    test.setTimeout(300_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const [playerA, playerB, playerC] = setup.players;
    if (!playerA || !playerB || !playerC) {
      throw new Error('Chat/GameLog gate requires exactly 3 players.');
    }

    const { gameId } = setup;
    const requestAudit = { bootstrap: 0, snapshot: 0 };
    const commandFrames: JsonObject[] = [];
    const initialSnapshot = await gameSnapshot(request, gameId, playerA.token);
    const handIds = zoneInstanceIds(initialSnapshot, playerA.user.id, 'hand');
    if (handIds.length < 1) {
      throw new Error('Expected at least one hand card for Chat/GameLog gate.');
    }
    const permanentId = handIds[0]!;
    let baseVersion = Math.max(1, Number(initialSnapshot['version'] ?? 1));
    const metricsBefore = await runtimeGatewayMetrics(request);

    const contexts = await Promise.all([playerA, playerB, playerC].map((player) =>
      browser.newContext({ baseURL, storageState: authStorageState(baseURL, player.user, player.refreshToken) }),
    ));
    await Promise.all(contexts.map(enableFrontendGameplayV2));

    try {
      const [pageA, pageB, pageC] = await Promise.all(contexts.map((context) => context.newPage()));
      const framesA = collectWebSocketFrames(pageA);
      const framesB = collectWebSocketFrames(pageB);
      const framesC = collectWebSocketFrames(pageC);
      for (const page of [pageA, pageB, pageC]) {
        auditBootstrapRequests(page, gameId, requestAudit);
      }

      await Promise.all([
        pageA.goto(`/games/${gameId}`),
        pageB.goto(`/games/${gameId}`),
        pageC.goto(`/games/${gameId}`),
      ]);
      await Promise.all([
        expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageC.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
      ]);
      await Promise.all([waitForGameplayConnection(framesA), waitForGameplayConnection(framesB), waitForGameplayConnection(framesC)]);
      await Promise.all([openChat(pageA), openChat(pageB), openChat(pageC)]);
      const liveRequestBaseline = requestAudit.bootstrap + requestAudit.snapshot;

      const chatText = `chat-gamelog-${Date.now()}`;
      const chatActionId = `chat-message-${Date.now()}`;
      const chatPatchPromise = waitForPatchV2(framesB, (patch) =>
        patch['ackClientActionId'] === chatActionId && hasOp(patch, 'chat.message.add') && JSON.stringify(patch).includes(chatText),
      );
      const chatOutcome = await sendRuntimeCommand(request, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'chat.message',
        payload: { message: chatText },
        clientActionId: chatActionId,
      });
      commandFrames.push(...chatOutcome.frames);
      const chatPatch = await chatPatchPromise;
      const messageId = firstChatMessageId(chatPatch);
      expect(messageId).not.toBe('');
      await Promise.all([
        expectChatMessage(pageA, playerA.user.displayName, chatText),
        expectChatMessage(pageB, playerA.user.displayName, chatText),
        expectChatMessage(pageC, playerA.user.displayName, chatText),
      ]);

      const duplicateChat = await sendRuntimeCommand(request, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'chat.message',
        payload: { message: chatText },
        clientActionId: chatActionId,
      });
      commandFrames.push(...duplicateChat.frames);
      await expect.poll(() => pageB.getByTestId('chat-message').filter({ hasText: chatText }).count(), { timeout: 10_000 }).toBe(1);

      const reactionActionId = `chat-reaction-${Date.now()}`;
      const reactionPatchPromise = waitForPatchV2(framesA, (patch) =>
        patch['ackClientActionId'] === reactionActionId && hasOp(patch, 'chat.reaction.set') && JSON.stringify(patch).includes(messageId),
      );
      const reactionOutcome = await sendRuntimeCommand(request, {
        gameId,
        token: playerB.token,
        baseVersion,
        type: 'chat.reaction.toggled',
        payload: { messageId, reaction: 'like' },
        clientActionId: reactionActionId,
      });
      commandFrames.push(...reactionOutcome.frames);
      await reactionPatchPromise;
      await Promise.all([
        expectChatReactionCount(pageA, chatText, '1'),
        expectChatReactionCount(pageC, chatText, '1'),
      ]);
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBe(liveRequestBaseline);

      await Promise.all([openLog(pageA), openLog(pageB), openLog(pageC)]);
      const drawActionId = `draw-log-${Date.now()}`;
      const drawOutcome = await sendRuntimeCommand(request, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'library.draw',
        payload: { playerId: playerA.user.id },
        clientActionId: drawActionId,
      });
      commandFrames.push(...drawOutcome.frames);
      baseVersion = drawOutcome.version;
      const duplicateDraw = await sendRuntimeCommand(request, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'library.draw',
        payload: { playerId: playerA.user.id },
        clientActionId: drawActionId,
      });
      commandFrames.push(...duplicateDraw.frames);

      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: permanentId,
          position: { x: 0.39, y: 0.62, unit: 'ratio' },
        },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.tapped',
        payload: { instanceId: permanentId, tapped: true },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.counter.changed',
        payload: { instanceId: permanentId, counter: '+1/+1', value: 2 },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.token.created',
        payload: { playerId: playerA.user.id, quantity: 1, card: { name: 'Clue', typeLine: 'Token Artifact', power: null, toughness: null } },
      });
      baseVersion = await applyRuntime(request, commandFrames, {
        gameId,
        token: playerB.token,
        baseVersion,
        type: 'game.concede',
        payload: { playerId: playerB.user.id },
      });

      await expectLogEntry(pageA, /drew a card/i);
      await expectLogEntry(pageA, /moved a card/i);
      await expectLogEntry(pageA, /tapped a permanent/i);
      await expectLogEntry(pageA, /\+1\/\+1/i);
      await expectLogEntry(pageA, /token/i);
      await expectLogEntry(pageA, /conceded/i);
      await expect.poll(() => pageA.getByTestId('game-log-entry').filter({ hasText: /drew a card/i }).count(), { timeout: 10_000 }).toBe(1);
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBe(liveRequestBaseline);

      const snapshotAfterActions = await gameSnapshot(request, gameId, playerA.token);
      expect((snapshotAfterActions['chat'] as JsonObject[] | undefined)?.filter((entry) => entry['message'] === chatText)).toHaveLength(1);
      expect((snapshotAfterActions['eventLog'] as JsonObject[] | undefined)?.some((entry) => String(entry['message'] ?? '').includes('drew a card'))).toBe(true);

      const beforeRefreshRequests = requestAudit.bootstrap + requestAudit.snapshot;
      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await openChat(pageA);
      await expectChatMessage(pageA, playerA.user.displayName, chatText);
      await expectChatReactionCount(pageA, chatText, '1');
      await openLog(pageA);
      await expectLogEntry(pageA, /drew a card/i);
      await expectLogEntry(pageA, /conceded/i);
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBeGreaterThan(beforeRefreshRequests);

      const reconnectStorageState = await contexts[2]!.storageState();
      const reconnectContext = await browser.newContext({ baseURL, storageState: reconnectStorageState });
      await enableFrontendGameplayV2(reconnectContext);
      try {
        const reconnectPage = await reconnectContext.newPage();
        const reconnectFrames = collectWebSocketFrames(reconnectPage);
        auditBootstrapRequests(reconnectPage, gameId, requestAudit);
        await reconnectPage.goto(`/games/${gameId}`);
        await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
        await waitForGameplayConnection(reconnectFrames);
        await openChat(reconnectPage);
        await expectChatMessage(reconnectPage, playerA.user.displayName, chatText);
        await expectChatReactionCount(reconnectPage, chatText, '1');
        await openLog(reconnectPage);
        await expectLogEntry(reconnectPage, /drew a card/i);
        assertNoRuntimeFallbackFrames(reconnectFrames);
      } finally {
        await reconnectContext.close().catch(() => undefined);
      }

      for (const frames of [framesA, framesB, framesC, commandFrames]) {
        assertNoRuntimeFallbackFrames(frames);
      }
      const metricsAfter = await runtimeGatewayMetrics(request);
      expect(Number(metricsAfter['chat.message_route'] ?? 0)).toBeGreaterThan(Number(metricsBefore['chat.message_route'] ?? 0));
      expect(Number(metricsAfter['chat.reaction_route'] ?? 0)).toBeGreaterThan(Number(metricsBefore['chat.reaction_route'] ?? 0));
      expect(Number(metricsAfter['gamelog.runtime_route'] ?? 0)).toBeGreaterThan(Number(metricsBefore['gamelog.runtime_route'] ?? 0));
      expect(Number(metricsAfter['chat.snapshot_write_count'] ?? 0)).toBe(0);
      expect(Number(metricsAfter['gamelog.snapshot_write_count'] ?? 0)).toBe(0);
      void baseVersion;
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<ChatGameLogSetup> {
  const players: ChatGameLogPlayer[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `cgl-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `CGL${index + 1} ${runId.slice(-10)}`,
    });
    players.push({
      token: session.token,
      refreshToken: session.refreshToken,
      user: session.user,
      credentials: session.credentials,
      deck,
    });
  }
  const roomId = await createRoom(request, players[0]!.token, players[0]!.deck.deckId, runId);
  for (const player of players.slice(1)) {
    await joinRoom(request, player.token, roomId, player.deck.deckId);
  }
  await resolveTurnOrder(request, roomId, players.map((player) => player.token));
  const gameId = await startRoom(request, players[0]!.token, roomId);

  return { gameId, roomId, players };
}

async function createRoom(request: APIRequestContext, token: string, deckId: string, runId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      deckId,
      visibility: 'public',
      name: `Chat GameLog ${runId.slice(-10)}`,
      format: 'commander',
      maxPlayers: 3,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create chat gamelog room');
  const payload = await response.json() as { room?: { id?: string } };
  if (!payload.room?.id) {
    throw new Error('Room creation did not return room.id.');
  }
  return payload.room.id;
}

async function joinRoom(request: APIRequestContext, token: string, roomId: string, deckId: string): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { deckId },
  });
  await expectApiOk(response, 'join chat gamelog room');
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokens[0]}` },
    });
    await expectApiOk(roomResponse, 'load chat gamelog room turn order');
    const payload = await roomResponse.json() as { room?: { players?: Array<{ turnRolls?: number[] }> } };
    if (turnOrderResolved(payload.room?.players ?? [])) {
      return;
    }
    for (const token of tokens) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok() && response.status() !== 409) {
        await expectApiOk(response, 'roll chat gamelog turn order');
      }
    }
  }
  throw new Error('Unable to resolve chat gamelog room turn order.');
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'start chat gamelog room');
  const payload = await response.json() as { game?: { id?: string } };
  if (!payload.game?.id) {
    throw new Error('Room start did not return game.id.');
  }
  return payload.game.id;
}

async function applyRuntime(
  request: APIRequestContext,
  frames: JsonObject[],
  options: Parameters<typeof sendRuntimeCommand>[1],
): Promise<number> {
  const result: RuntimeWebSocketCommandResult = await sendRuntimeCommand(request, options);
  frames.push(...result.frames);
  expect(result.patch['kind']).toBe('patch.v2');
  return result.version;
}

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'load game snapshot');
  const payload = await response.json() as { game?: { snapshot?: JsonObject } };
  return payload.game?.snapshot ?? {};
}

async function runtimeGatewayMetrics(request: APIRequestContext): Promise<JsonObject> {
  const response = await request.get(RUNTIME_METRICS_URL);
  await expectApiOk(response, 'load runtime metrics');
  const payload = await response.json() as { gateway?: JsonObject };
  return payload.gateway ?? {};
}

async function assertServiceReady(request: APIRequestContext, url: string, service: string): Promise<void> {
  const response = await request.get(url, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`${service} is not ready at ${url}: HTTP ${response.status()}`);
  }
}

function zoneInstanceIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return (zones?.[zone] ?? []).map((card) => String(card['instanceId'] ?? '')).filter((id) => id !== '');
}

async function openLog(page: Page): Promise<void> {
  const logTab = page.getByTestId('game-log-open');
  await expect(logTab).toBeVisible();
  await logTab.click();
  await expect(page.getByTestId('game-log-panel')).toBeVisible();
  await expect(page.getByTestId('game-log')).toBeVisible();
}

async function expectChatMessage(page: Page, displayName: string, message: string): Promise<void> {
  await expect(page.getByTestId('chat-message').filter({ hasText: displayName }).filter({ hasText: message })).toBeVisible({ timeout: 15_000 });
}

async function expectChatReactionCount(page: Page, message: string, count: string): Promise<void> {
  const row = page.getByTestId('chat-message').filter({ hasText: message });
  await expect(row.locator('.chat-reaction-pill').filter({ hasText: count })).toBeVisible({ timeout: 15_000 });
}

async function expectLogEntry(page: Page, text: RegExp): Promise<void> {
  await expect(page.getByTestId('game-log-entry').filter({ hasText: text })).toBeVisible({ timeout: 20_000 });
}

function firstChatMessageId(patch: JsonObject): string {
  const op = operation(patch, 'chat.message.add');
  const message = op?.['message'] as JsonObject | undefined;
  return String(message?.['id'] ?? '');
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.find((item) => item['op'] === op) ?? null;
}

function hasOp(message: JsonObject, op: string): boolean {
  return operation(message, op) !== null;
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

function waitForGameplayConnection(frames: JsonObject[]): Promise<void> {
  return expect.poll(() => frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), {
    timeout: 30_000,
  }).toBe(true);
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
    if (frames.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')) {
      return 'resync';
    }
    return null;
  }, {
    timeout: 20_000,
  }).toBe('patch').then(() => {
    const patch = frames.find((message) => message['kind'] === 'patch.v2' && predicate(message));
    if (!patch) {
      throw new Error(`patch.v2 frame was not captured. Recent frames: ${JSON.stringify(frames.slice(-8), null, 2)}`);
    }
    return patch;
  });
}

function auditBootstrapRequests(page: Page, gameId: string, audit: { bootstrap: number; snapshot: number }): void {
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'GET' && url.includes(`/games/${gameId}/bootstrap`)) {
      audit.bootstrap += 1;
    }
    if (request.method() === 'GET' && url.includes(`/games/${gameId}/snapshot`)) {
      audit.snapshot += 1;
    }
  });
}

function assertNoRuntimeFallbackFrames(frames: JsonObject[]): void {
  expect(frames.some((message) => message['kind'] === 'game_patch')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'command_ack' && message['status'] === 'rejected')).toBe(false);
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

function turnOrderResolved(players: Array<{ turnRolls?: number[] }>): boolean {
  if (players.length === 0) {
    return false;
  }
  const rolls = new Set<string>();
  for (const player of players) {
    if (!Array.isArray(player.turnRolls) || player.turnRolls.length === 0) {
      return false;
    }
    const key = player.turnRolls.join('-');
    if (rolls.has(key)) {
      return false;
    }
    rolls.add(key);
  }
  return true;
}

async function expectApiOk(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) {
    return;
  }
  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
