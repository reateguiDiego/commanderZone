import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { resolveGameToPlaying } from './support/commander-game';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const SERVICE_URLS = [
  `${API_BASE_URL}/healthz`,
  `${API_BASE_URL}/readyz`,
  process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz',
  process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz',
  process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz',
  process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz',
];
const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;
type Player = {
  token: string;
  refreshToken: string;
  user: RealUserSession['user'];
  deck: BasicCommanderDeckFromDatabaseResult;
};
type Setup = { gameId: string; players: [Player, Player, Player] };
type BrowserAudit = { frames: JsonObject[]; recoveryRequests: number; errors: string[] };
type RejectedCommand = { actionId: string; ack: JsonObject; frames: JsonObject[] };
type ExpectedRestartState = { version: number; a1: string; b1: string; c1: string; privateC: string };

test.describe('batch authorization and atomicity closure gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: Setup;
  let expectedRestart: ExpectedRestartState;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(360_000);
    await Promise.all(SERVICE_URLS.map(async (url) => expect((await request.get(url)).ok(), url).toBe(true)));
    setup = await createThreePlayerGame(request, `batchauth${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
  });

  test('3P enforces controller/owner authority and rejects mixed batches without side effects', async ({ browser, request, baseURL }) => {
    test.setTimeout(480_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const [playerA, playerB, playerC] = setup.players;
    const initialByPlayer = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
    const aHand = zoneIds(initialByPlayer[0]!, playerA.user.id, 'hand');
    const bHand = zoneIds(initialByPlayer[1]!, playerB.user.id, 'hand');
    const cHand = zoneIds(initialByPlayer[2]!, playerC.user.id, 'hand');
    if (aHand.length < 1 || bHand.length < 1 || cHand.length < 2) {
      throw new Error(`Batch authorization gate needs A/B one hand card and C two; got ${aHand.length}/${bHand.length}/${cHand.length}.`);
    }
    const [a1] = aHand;
    const [b1] = bHand;
    const [c1, privateC] = cHand;

    const contexts = await Promise.all(setup.players.map((player) => browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, player.user, player.refreshToken),
    })));
    await Promise.all(contexts.map(enableFrontendGameplayV2));
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const audits = pages.map((page) => createAudit(page, setup.gameId));
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(audits.map((audit) => waitForConnection(audit.frames)));
      const recoveryBaseline = audits.reduce((sum, audit) => sum + audit.recoveryRequests, 0);
      const commandPage = pages[0]!;
      const tickets = await Promise.all(setup.players.map((player) => websocketTicket(request, setup.gameId, player.token)));
      let version = Number(initialByPlayer[0]!['version'] ?? 1);

      const accepted = async (actorIndex: number, type: string, payload: JsonObject): Promise<JsonObject> => {
        const result = await sendAcceptedCommand(commandPage, tickets[actorIndex]!, setup.gameId, version, type, payload);
        version = Number(result['version'] ?? version + 1);
        await Promise.all(audits.map((audit) => expect.poll(
          () => audit.frames.some((frame) => frame['kind'] === 'patch.v2' && Number(frame['version']) === version),
          { timeout: 20_000 },
        ).toBe(true)));
        return result;
      };
      const rejected = async (
        actorIndex: number,
        type: string,
        payload: JsonObject,
        code: string,
        instanceId: string,
        index?: number,
      ): Promise<RejectedCommand> => {
        const before = await gameSnapshot(request, setup.gameId, setup.players[actorIndex]!.token);
        const pagePatchCount = audits.reduce((sum, audit) => sum + audit.frames.filter((frame) => frame['kind'] === 'patch.v2').length, 0);
        const result = await sendRejectedCommand(commandPage, tickets[actorIndex]!, setup.gameId, version, type, payload);
        const error = result.ack['error'] as JsonObject;
        expect(result.ack['status']).toBe('rejected');
        expect(result.ack['version']).toBe(version);
        expect(error['code']).toBe(code);
        expect(error['commandType']).toBe(type);
        expect(error['instanceId']).toBe(instanceId);
        if (index !== undefined) expect(error['index']).toBe(index);
        expect(error['retryable']).toBe(false);
        expect(JSON.stringify(error)).not.toMatch(/cardKey|cardRef|printId|secret/i);
        const after = await gameSnapshot(request, setup.gameId, setup.players[actorIndex]!.token);
        expect(after['version']).toBe(before['version']);
        expect(Number(after['version'])).toBe(version);
        expect(result.frames.some((frame) => frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === result.actionId)).toBe(false);
        expect(audits.reduce((sum, audit) => sum + audit.frames.filter((frame) => frame['kind'] === 'patch.v2').length, 0)).toBe(pagePatchCount);
        return result;
      };

      await accepted(0, 'card.moved', { playerId: playerA.user.id, fromZone: 'hand', toZone: 'battlefield', instanceId: a1 });
      await accepted(1, 'card.moved', { playerId: playerB.user.id, fromZone: 'hand', toZone: 'battlefield', instanceId: b1 });
      await accepted(2, 'card.moved', { playerId: playerC.user.id, fromZone: 'hand', toZone: 'battlefield', instanceId: c1 });
      await accepted(1, 'card.controller.changed', { playerId: playerB.user.id, instanceId: b1, targetPlayerId: playerC.user.id });

      await accepted(2, 'card.position.changed', {
        playerId: playerB.user.id,
        instanceId: b1,
        position: { x: 0.31, y: 0.46, unit: 'ratio' },
      });
      await accepted(2, 'card.tapped', { playerId: playerC.user.id, instanceId: b1, tapped: true });
      const controlledSnapshot = await gameSnapshot(request, setup.gameId, playerC.token);
      expect(findCard(controlledSnapshot, b1)?.['controllerId']).toBe(playerC.user.id);
      expect(findCard(controlledSnapshot, b1)?.['tapped']).toBe(true);

      await accepted(0, 'card.position.changed', {
        playerId: playerA.user.id,
        instanceId: a1,
        position: { x: 0.22, y: 0.33, unit: 'ratio' },
      });

      await rejected(0, 'card.moved', {
        playerId: playerA.user.id, fromZone: 'battlefield', toZone: 'graveyard', instanceId: c1,
      }, 'INSTANCE_NOT_CONTROLLED', c1!);
      await rejected(0, 'card.position.changed', {
        playerId: playerA.user.id, instanceId: c1, position: { x: 0.8, y: 0.2, unit: 'ratio' },
      }, 'INSTANCE_NOT_CONTROLLED', c1!);

      const beforeMixed = await gameSnapshot(request, setup.gameId, playerA.token);
      await rejected(0, 'cards.moved', {
        playerId: playerA.user.id,
        fromZone: 'battlefield',
        toZone: 'graveyard',
        instanceIds: [a1, c1],
      }, 'MIXED_AUTHORITY_BATCH', c1!, 1);
      const afterMixed = await gameSnapshot(request, setup.gameId, playerA.token);
      expect(cardZone(beforeMixed, a1!)).toBe('battlefield');
      expect(cardZone(afterMixed, a1!)).toBe('battlefield');
      expect(cardZone(afterMixed, c1!)).toBe('battlefield');
      expect(findCard(afterMixed, a1!)?.['position']).toEqual(findCard(beforeMixed, a1!)?.['position']);
      expect(findCard(afterMixed, c1!)?.['position']).toEqual(findCard(beforeMixed, c1!)?.['position']);

      await rejected(0, 'cards.position.changed', {
        playerId: playerA.user.id,
        positions: [
          { instanceId: a1, position: { x: 0.4, y: 0.4, unit: 'ratio' } },
          { instanceId: c1, position: { x: 0.6, y: 0.6, unit: 'ratio' } },
        ],
      }, 'MIXED_AUTHORITY_BATCH', c1!, 1);
      await rejected(0, 'cards.moved', {
        playerId: playerA.user.id, fromZone: 'battlefield', toZone: 'graveyard', instanceIds: [a1, a1],
      }, 'DUPLICATE_INSTANCE', a1!, 1);
      await rejected(0, 'cards.moved', {
        playerId: playerA.user.id, fromZone: 'battlefield', toZone: 'graveyard', instanceIds: [a1, 'missing-instance'],
      }, 'INSTANCE_NOT_FOUND', 'missing-instance', 1);
      await rejected(0, 'cards.moved', {
        playerId: playerA.user.id, fromZone: 'hand', toZone: 'graveyard', instanceIds: [a1],
      }, 'ZONE_MISMATCH', a1!, 0);

      for (const [type, payload] of [
        ['card.tapped', { playerId: playerA.user.id, instanceId: c1, tapped: true }],
        ['card.counter.changed', { playerId: playerA.user.id, instanceId: c1, counter: 'charge', value: 3 }],
        ['card.power_toughness.changed', { playerId: playerA.user.id, instanceId: c1, power: 9, toughness: 9 }],
        ['card.face.changed', { playerId: playerA.user.id, instanceId: c1, faceIndex: 1 }],
      ] as const) {
        await rejected(0, type, payload, 'INSTANCE_NOT_CONTROLLED', c1!);
      }

      const privateAttempt = await rejected(0, 'card.moved', {
        playerId: playerA.user.id, fromZone: 'hand', toZone: 'graveyard', instanceId: privateC,
      }, 'INSTANCE_NOT_OWNED', privateC!);
      expect(JSON.stringify(privateAttempt.ack)).not.toMatch(/cardKey|cardRef|printId|name/i);
      const aView = await gameSnapshot(request, setup.gameId, playerA.token);
      const privateHandForA = zoneCards(aView, playerC.user.id, 'hand');
      expect(privateHandForA.some((card) => card['instanceId'] === privateC)).toBe(false);
      expect(privateHandForA.some((card) => card['cardKey'] || card['cardRef'] || card['printId'])).toBe(false);
      expect(privateHandForA.every((card) => card['name'] === 'Hidden card')).toBe(true);

      await accepted(0, 'card.position.changed', {
        playerId: playerA.user.id,
        instanceId: a1,
        position: { x: 0.27, y: 0.39, unit: 'ratio' },
      });
      const finalSnapshots = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      for (const snapshot of finalSnapshots) {
        expect(snapshot['version']).toBe(version);
        expect(cardZone(snapshot, a1!)).toBe('battlefield');
        expect(cardZone(snapshot, b1!)).toBe('battlefield');
        expect(cardZone(snapshot, c1!)).toBe('battlefield');
      }
      expect(findCard(finalSnapshots[0]!, a1!)?.['position']).toEqual({ x: 0.27, y: 0.39, unit: 'ratio' });
      expect(findCard(finalSnapshots[0]!, c1!)?.['counters'] ?? {}).not.toHaveProperty('charge');
      expect(audits.reduce((sum, audit) => sum + audit.recoveryRequests, 0)).toBe(recoveryBaseline);

      await Promise.all(pages.map((page) => page.reload()));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      const refreshed = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      refreshed.forEach((snapshot) => expect(snapshot['version']).toBe(version));
      assertNoLegacyRecoveryOrLeak(audits);

      expectedRestart = { version, a1: a1!, b1: b1!, c1: c1!, privateC: privateC! };
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });

  test('actor restart preserves only authorized events and runtime remains healthy', async ({ request }) => {
    test.setTimeout(180_000);
    const immediatelyBeforeRestart = await gameSnapshot(request, setup.gameId, setup.players[0].token);
    expectedRestart = { ...expectedRestart, version: Number(immediatelyBeforeRestart['version']) };
    await restartRuntime();
    await expect.poll(async () => {
      try {
        return (await request.get(SERVICE_URLS[5]!)).ok();
      } catch {
        return false;
      }
    }, { timeout: 60_000 }).toBe(true);
    const snapshots = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
    for (const snapshot of snapshots) {
      expect(snapshot['version']).toBe(expectedRestart.version);
      expect(cardZone(snapshot, expectedRestart.a1)).toBe('battlefield');
      expect(cardZone(snapshot, expectedRestart.b1)).toBe('battlefield');
      expect(cardZone(snapshot, expectedRestart.c1)).toBe('battlefield');
      expect(findCard(snapshot, expectedRestart.c1)?.['counters'] ?? {}).not.toHaveProperty('charge');
    }
    const privateHandForA = zoneCards(snapshots[0]!, setup.players[2].user.id, 'hand');
    expect(privateHandForA.some((card) => card['instanceId'] === expectedRestart.privateC)).toBe(false);
    expect(privateHandForA.some((card) => card['cardKey'] || card['cardRef'] || card['printId'])).toBe(false);
    expect(privateHandForA.every((card) => card['name'] === 'Hidden card')).toBe(true);
    await Promise.all(SERVICE_URLS.map(async (url) => expect((await request.get(url)).ok(), url).toBe(true)));
  });
});

async function sendAcceptedCommand(page: Page, websocketUrl: string, gameId: string, baseVersion: number, type: string, payload: JsonObject): Promise<JsonObject> {
  const actionId = `batch-accepted-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const frames = await sendBrowserWebSocketCommand(page, websocketUrl, { kind: 'command.v2', gameId, baseVersion, clientActionId: actionId, messageId: actionId, type, payload }, actionId);
  const patch = frames.find((frame) => frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === actionId);
  if (!patch) throw new Error(`Accepted ${type} did not emit Patch.v2: ${JSON.stringify(frames)}`);
  expect(frames.some((frame) => frame['kind'] === 'game_patch' || frame['kind'] === 'resync_required')).toBe(false);
  return patch;
}

async function sendRejectedCommand(page: Page, websocketUrl: string, gameId: string, baseVersion: number, type: string, payload: JsonObject): Promise<RejectedCommand> {
  const actionId = `batch-rejected-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const frames = await sendBrowserWebSocketCommand(page, websocketUrl, { kind: 'command.v2', gameId, baseVersion, clientActionId: actionId, messageId: actionId, type, payload }, actionId);
  const ack = frames.find((frame) => frame['kind'] === 'command_ack' && frame['clientActionId'] === actionId);
  if (!ack) throw new Error(`Rejected ${type} did not emit command_ack: ${JSON.stringify(frames)}`);
  expect(frames.some((frame) => frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === actionId)).toBe(false);
  expect(frames.some((frame) => frame['kind'] === 'game_patch' || frame['kind'] === 'resync_required' || frame['status'] === 'resync_required')).toBe(false);
  return { actionId, ack, frames };
}

async function sendBrowserWebSocketCommand(page: Page, websocketUrl: string, message: JsonObject, actionId: string): Promise<JsonObject[]> {
  return page.evaluate(({ url, payload, expectedActionId }) => new Promise<JsonObject[]>((resolvePromise, rejectPromise) => {
    const frames: JsonObject[] = [];
    const socket = new WebSocket(url);
    const timeout = window.setTimeout(() => {
      socket.close();
      rejectPromise(new Error(`Timed out waiting for runtime result. Frames: ${JSON.stringify(frames)}`));
    }, 20_000);
    const finish = (): void => {
      window.clearTimeout(timeout);
      socket.close();
      resolvePromise(frames);
    };
    socket.onopen = () => socket.send(JSON.stringify(payload));
    socket.onerror = () => {
      window.clearTimeout(timeout);
      rejectPromise(new Error('Runtime WebSocket failed.'));
    };
    socket.onmessage = (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as JsonObject;
        frames.push(frame);
        if ((frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === expectedActionId)
          || (frame['kind'] === 'command_ack' && frame['clientActionId'] === expectedActionId)) finish();
      } catch {
        // Ignore non-JSON frames.
      }
    };
  }), { url: websocketUrl, payload: message, expectedActionId: actionId });
}

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<Setup> {
  const players: Player[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `ba-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, { ownerToken: session.token, name: `BA${index + 1} ${runId.slice(-8)}` });
    players.push({ token: session.token, refreshToken: session.refreshToken, user: session.user, deck });
  }
  const create = await request.post(`${API_BASE_URL}/rooms`, {
    headers: auth(players[0]!.token),
    data: { deckId: players[0]!.deck.deckId, visibility: 'public', name: `Batch authorization ${runId}`, format: 'commander', maxPlayers: 3, mulliganRule: 'LONDON', firstMulliganFree: true },
  });
  await expectOk(create, 'create batch authorization room');
  const roomId = String(((await create.json()) as { room?: { id?: string } }).room?.id ?? '');
  for (const player of players.slice(1)) {
    await expectOk(await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, { headers: auth(player.token), data: { deckId: player.deck.deckId } }), 'join batch authorization room');
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const room = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: auth(players[0]!.token) });
    const entries = ((await room.json()) as { room?: { players?: Array<{ turnRolls?: number[] }> } }).room?.players ?? [];
    if (entries.length === 3 && new Set(entries.map((entry) => entry.turnRolls?.join('-'))).size === 3 && entries.every((entry) => entry.turnRolls?.length)) break;
    for (const player of players) {
      const roll = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: auth(player.token) });
      if (!roll.ok() && roll.status() !== 409) await expectOk(roll, 'roll batch authorization turn order');
    }
  }
  const start = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: auth(players[0]!.token) });
  await expectOk(start, 'start batch authorization room');
  const gameId = String(((await start.json()) as { game?: { id?: string } }).game?.id ?? '');
  if (!gameId || players.length !== 3) throw new Error('Could not create three-player batch authorization game.');
  return { gameId, players: players as [Player, Player, Player] };
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: auth(token) });
  await expectOk(response, 'load batch authorization snapshot');
  return ((await response.json()) as { game?: { snapshot?: JsonObject } }).game?.snapshot ?? {};
}
async function websocketTicket(request: APIRequestContext, gameId: string, token: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, { headers: auth(token) });
  await expectOk(response, 'create batch authorization websocket ticket');
  const payload = await response.json() as { route?: string; websocketUrl?: string };
  expect(payload.route).toBe('runtime_ws');
  if (!payload.websocketUrl) throw new Error('Runtime WebSocket URL missing.');
  return payload.websocketUrl;
}

function zoneCards(snapshot: JsonObject, playerId: string, zone: string): JsonObject[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  return ((players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined)?.[zone]) ?? [];
}
function zoneIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  return zoneCards(snapshot, playerId, zone).map((card) => String(card['instanceId'] ?? '')).filter(Boolean);
}
function findCard(snapshot: JsonObject, instanceId: string): JsonObject | undefined {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  for (const player of Object.values(players ?? {})) {
    const zones = player['zones'] as Record<string, JsonObject[]> | undefined;
    for (const cards of Object.values(zones ?? {})) {
      const card = cards.find((candidate) => candidate['instanceId'] === instanceId);
      if (card) return card;
    }
  }
  return undefined;
}
function cardZone(snapshot: JsonObject, instanceId: string): string | null {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  for (const player of Object.values(players ?? {})) {
    const zones = player['zones'] as Record<string, JsonObject[]> | undefined;
    for (const [zone, cards] of Object.entries(zones ?? {})) {
      if (cards.some((card) => card['instanceId'] === instanceId)) return zone;
    }
  }
  return null;
}

function createAudit(page: Page, gameId: string): BrowserAudit {
  const audit: BrowserAudit = { frames: [], recoveryRequests: 0, errors: [] };
  page.on('websocket', (socket) => socket.on('framereceived', (event) => {
    try { audit.frames.push(JSON.parse(typeof event.payload === 'string' ? event.payload : event.payload.toString('utf8')) as JsonObject); } catch { /* ignore */ }
  }));
  page.on('request', (request) => {
    if (request.method() === 'GET' && new RegExp(`/games/${gameId}/(bootstrap|snapshot)`).test(request.url())) audit.recoveryRequests += 1;
  });
  page.on('console', (message) => { if (message.type() === 'error') audit.errors.push(message.text()); });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  return audit;
}
function assertNoLegacyRecoveryOrLeak(audits: BrowserAudit[]): void {
  for (const audit of audits) {
    expect(audit.frames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
    expect(audit.frames.some((frame) => frame['kind'] === 'resync_required' || frame['status'] === 'resync_required')).toBe(false);
    expect(JSON.stringify(audit.frames)).not.toMatch(/target_not_found|cardKey.*secret/i);
    expect(audit.errors.filter((error) => /target_not_found|resync_required/i.test(error))).toEqual([]);
  }
}
async function waitForConnection(frames: JsonObject[]): Promise<void> {
  await expect.poll(() => frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), { timeout: 30_000 }).toBe(true);
}
async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1'));
}
async function restartRuntime(): Promise<void> {
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], { cwd: resolve(process.cwd(), '..'), timeout: 60_000, windowsHide: true });
}
function auth(token: string): Record<string, string> { return { Authorization: `Bearer ${token}` }; }
async function expectOk(response: APIResponse, action: string): Promise<void> {
  if (!response.ok()) throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
