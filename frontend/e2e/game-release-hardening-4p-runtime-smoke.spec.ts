import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import {
  createBasicCommanderDeckFromDatabase,
  type BasicCommanderDeckFromDatabaseResult,
} from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL =
  process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;

interface ReleasePlayer {
  readonly token: string;
  readonly refreshToken: string;
  readonly user: RealUserSession['user'];
  readonly deck: BasicCommanderDeckFromDatabaseResult;
}

test('release hardening 4-player runtime smoke converges without legacy patches or resync', async ({
  browser,
  request,
  baseURL,
}) => {
  test.setTimeout(360_000);
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }
  await assertGameRuntimeReady(request);

  const runId = `release4p${Date.now().toString(36)}`;
  const players = await createFourPlayerGame(request, runId);
  await resolveGameToPlaying(request, players.gameId, players.players);

  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const frameSets: JsonObject[][] = [];
  try {
    for (const player of players.players) {
      const context = await browser.newContext({
        baseURL,
        storageState: authStorageState(baseURL, player.user, player.refreshToken),
      });
      await enableFrontendGameplayV2(context);
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      frameSets.push(collectWebSocketFrames(page));
    }

    await Promise.all(pages.map((page) => page.goto(`/games/${players.gameId}`)));
    await Promise.all(
      pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })),
    );
    await Promise.all(frameSets.map((frames) => waitForGameplayConnection(frames)));

    let nextBaseVersion = await gameVersion(request, players.gameId, players.players[0]!.token);
    const commandPage = pages[0]!;

    for (const player of players.players) {
      const ticket = await websocketTicket(request, players.gameId, player.token);
      const outcome = await sendRuntimeCommandAndWait(
        commandPage,
        ticket.websocketUrl,
        frameSets[0]!,
        {
          gameId: players.gameId,
          baseVersion: nextBaseVersion,
          type: 'library.draw',
          payload: { playerId: player.user.id },
          ownerPatch: (patch) => hasOp(patch, 'zone.cards.add'),
        },
      );
      nextBaseVersion = outcome.version;
    }

    const snapshot = await gameSnapshot(request, players.gameId, players.players[0]!.token);
    const publicMoveId = zoneInstanceIds(snapshot, players.players[0]!.user.id, 'hand')[0];
    if (!publicMoveId) {
      throw new Error('Release smoke needs player A to have at least one hand card after draw.');
    }

    const playerATicket = await websocketTicket(request, players.gameId, players.players[0]!.token);
    const moveOutcome = await sendRuntimeCommandAndWait(
      commandPage,
      playerATicket.websocketUrl,
      frameSets[0]!,
      {
        gameId: players.gameId,
        baseVersion: nextBaseVersion,
        type: 'card.moved',
        payload: {
          playerId: players.players[0]!.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: publicMoveId,
          position: { x: 0.42, y: 0.44, unit: 'ratio' },
        },
        ownerPatch: (patch) => hasOp(patch, 'zone.cards.move'),
      },
    );
    nextBaseVersion = moveOutcome.version;

    for (const page of pages) {
      await expect(cardByInstanceId(page, publicMoveId)).toBeVisible({ timeout: 20_000 });
      await expect(
        page.locator('[data-testid="game-card"][data-zone="battlefield"]', {
          hasText: 'Unknown Card',
        }),
      ).toHaveCount(0);
    }

    for (const [index, frames] of frameSets.entries()) {
      expect(
        frames.some((message) => message['kind'] === 'game_patch'),
        `viewer ${index + 1} received game_patch`,
      ).toBe(false);
      expect(
        frames.some((message) => message['kind'] === 'resync_required'),
        `viewer ${index + 1} received resync_required`,
      ).toBe(false);
    }
    expect(nextBaseVersion).toBeGreaterThan(1);
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
  }
});

async function createFourPlayerGame(
  request: APIRequestContext,
  runId: string,
): Promise<{ gameId: string; roomId: string; players: ReleasePlayer[] }> {
  const players: ReleasePlayer[] = [];
  for (let index = 0; index < 4; index += 1) {
    const session = await createRealUserSession(request, `release-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `R${index + 1} ${runId.slice(-12)}`,
    });
    players.push({
      token: session.token,
      refreshToken: session.refreshToken,
      user: session.user,
      deck,
    });
  }

  const roomId = await createRoom(request, players[0]!.token, players[0]!.deck.deckId, runId, 4);
  for (const player of players.slice(1)) {
    await joinRoom(request, player.token, roomId, player.deck.deckId);
  }
  await resolveTurnOrder(
    request,
    roomId,
    players.map((player) => player.token),
  );
  const gameId = await startRoom(request, players[0]!.token, roomId);

  return { gameId, roomId, players };
}

async function createRoom(
  request: APIRequestContext,
  token: string,
  deckId: string,
  runId: string,
  maxPlayers: number,
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      deckId,
      visibility: 'public',
      name: `Release ${runId.slice(-10)}`,
      format: 'commander',
      maxPlayers,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create release room');
  const payload = (await response.json()) as { room?: { id?: string } };
  const roomId = payload.room?.id;
  if (!roomId) {
    throw new Error('Room creation did not return room.id.');
  }
  return roomId;
}

async function joinRoom(
  request: APIRequestContext,
  token: string,
  roomId: string,
  deckId: string,
): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { deckId },
  });
  await expectApiOk(response, 'join release room');
}

async function resolveTurnOrder(
  request: APIRequestContext,
  roomId: string,
  tokens: readonly string[],
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokens[0]}` },
    });
    await expectApiOk(roomResponse, 'load release room turn order');
    const payload = (await roomResponse.json()) as {
      room?: { players?: Array<{ turnRolls?: number[] }> };
    };
    if (turnOrderResolved(payload.room?.players ?? [])) {
      return;
    }

    for (const token of tokens) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok() && response.status() !== 409) {
        await expectApiOk(response, 'roll release turn order');
      }
    }
  }
  throw new Error('Unable to resolve release room turn order.');
}

async function startRoom(
  request: APIRequestContext,
  token: string,
  roomId: string,
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'start release room');
  const payload = (await response.json()) as { game?: { id?: string } };
  const gameId = payload.game?.id;
  if (!gameId) {
    throw new Error('Room start did not return game.id.');
  }
  return gameId;
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

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(
      `Game runtime is not reachable at ${RUNTIME_READY_URL}; runtime release gates must not fall back to legacy.`,
    );
  }
}

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

async function gameSnapshot(
  request: APIRequestContext,
  gameId: string,
  token: string,
): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'load release game snapshot');
  const payload = (await response.json()) as { game?: { snapshot?: JsonObject } };
  return (payload.game?.snapshot ?? {}) as JsonObject;
}

async function gameVersion(
  request: APIRequestContext,
  gameId: string,
  token: string,
): Promise<number> {
  const snapshot = await gameSnapshot(request, gameId, token);
  return Math.max(1, Number(snapshot['version'] ?? 1));
}

function zoneInstanceIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const player = players?.[playerId];
  const zones = player?.['zones'] as Record<string, JsonObject[]> | undefined;
  return (zones?.[zone] ?? [])
    .map((card) => String(card['instanceId'] ?? ''))
    .filter((id) => id !== '');
}

async function websocketTicket(
  request: APIRequestContext,
  gameId: string,
  token: string,
): Promise<{ websocketUrl: string }> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'create release websocket ticket');
  const payload = (await response.json()) as { websocketUrl?: string };
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
  const clientActionId = `release-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const patchPromise = waitForPatchV2(
    frames,
    (patch) => patch['ackClientActionId'] === clientActionId && options.ownerPatch(patch),
  );
  await page.evaluate(
    ({ url, payload }) =>
      new Promise<void>((resolve, reject) => {
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
  return {
    version: Math.max(options.baseVersion + 1, Number(patch['version'] ?? options.baseVersion + 1)),
    patch,
  };
}

function waitForPatchV2(
  frames: JsonObject[],
  predicate: (message: JsonObject) => boolean,
): Promise<JsonObject> {
  return expect
    .poll(
      () => frames.find((message) => message['kind'] === 'patch.v2' && predicate(message)) ?? null,
      {
        timeout: 20_000,
      },
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

function hasOp(message: JsonObject, op: string): boolean {
  const ops = Array.isArray(message['ops']) ? (message['ops'] as JsonObject[]) : [];
  return ops.some((item) => item['op'] === op);
}

function cardByInstanceId(page: Page, instanceId: string) {
  return page.locator(`[data-card-instance-id="${instanceId}"]`).first();
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

async function expectApiOk(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) {
    return;
  }
  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
