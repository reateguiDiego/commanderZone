import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { resolveGameToPlaying } from './support/commander-game';
import { sendRuntimeCommand, type RuntimeWebSocketCommandResult } from './support/runtime-websocket';

const execFileAsync = promisify(execFile);
const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_HEALTH_URL = process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type TokenGroupPlayer = {
  token: string;
  refreshToken: string;
  user: RealUserSession['user'];
  credentials: RealUserSession['credentials'];
  deck: BasicCommanderDeckFromDatabaseResult;
};
type TokenGroupSetup = { gameId: string; roomId: string; players: TokenGroupPlayer[] };
type PageAudit = {
  frames: JsonObject[];
  consoleErrors: string[];
  pageErrors: string[];
  recoveryRequests: string[];
  commandFallbackRequests: string[];
};

test.describe('authoritative TokenGroup domain gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: TokenGroupSetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertServiceReady(request, RUNTIME_HEALTH_URL, 'game-runtime healthz');
    await assertServiceReady(request, RUNTIME_READY_URL, 'game-runtime readyz');
    setup = await createThreePlayerGame(request, `tg${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
  });

  test('create 1/2/10/20 is continuous across live, retry, refresh, reconnect and restart', async ({ browser, request, baseURL }) => {
    test.setTimeout(540_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }
    const [playerA, playerB, playerC] = setup.players;
    if (!playerA || !playerB || !playerC) {
      throw new Error('TokenGroup domain gate requires exactly three players.');
    }

    const contexts = await Promise.all([playerA, playerB, playerC].map((player) =>
      browser.newContext({ baseURL, storageState: authStorageState(baseURL, player.user, player.refreshToken) }),
    ));
    await Promise.all(contexts.map(enableFrontendGameplayV2));

    const quantities = [1, 2, 10, 20] as const;
    const expectedGroups = new Map<number, JsonObject>();
    const expectedMemberIds = new Set<string>();
    let baseVersion = await gameVersion(request, setup.gameId, playerA.token);
    let retryResult: RuntimeWebSocketCommandResult | null = null;
    let logCountBeforeRetry = 0;
    let logCountAfterRetry = 0;

    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const [pageA, pageB, pageC] = pages;
      if (!pageA || !pageB || !pageC) {
        throw new Error('Failed to create all TokenGroup viewer pages.');
      }
      const audits = pages.map((page) => collectPageAudit(page, setup.gameId));
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(audits.map(waitForGameplayConnection));
      const recoveryBaselines = audits.map((audit) => audit.recoveryRequests.length);

      for (const quantity of quantities) {
        const beforeVersion = baseVersion;
        const clientActionId = `token-group-domain-${quantity}-${Date.now().toString(36)}`;
        const starts = audits.map((audit) => audit.frames.length);
        const result = await sendRuntimeCommand(request, {
          gameId: setup.gameId,
          token: playerA.token,
          baseVersion: beforeVersion,
          clientActionId,
          type: 'card.token.created',
          payload: {
            playerId: playerA.user.id,
            quantity,
            card: {
              name: `Domain Treasure ${quantity}`,
              typeLine: 'Token Artifact - Treasure',
              scryfallId: `token-group-domain-treasure-${quantity}`,
              cardVersion: 'runtime-v1',
              language: 'en',
            },
            position: { x: 0.38, y: 0.46, unit: 'ratio' },
          },
        });
        baseVersion = result.version;
        // Viewer connection control-plane events may advance the shared game
        // version while the three pages are live; the token receipt itself must
        // still be monotonic and its exact one-event effect is covered in Go.
        expect(result.version).toBeGreaterThan(beforeVersion);
        const cards = addedCards(result.patch);
        expect(cards).toHaveLength(quantity);
        const cardIds = cards.map((card) => String(card['instanceId'] ?? ''));
        expect(new Set(cardIds).size).toBe(quantity);
        cardIds.forEach((id) => expectedMemberIds.add(id));

        const ownerGroup = tokenGroupFromPatch(result.patch);
        if (quantity === 1) {
          expect(ownerGroup).toBeNull();
        } else {
          assertTokenGroup(ownerGroup, quantity, cardIds);
          expectedGroups.set(quantity, ownerGroup!);
          const viewerPatches = await Promise.all([
            waitForPatchAfter(audits[1]!, starts[1]!, (frame) => tokenGroupFromPatch(frame)?.['quantity'] === quantity),
            waitForPatchAfter(audits[2]!, starts[2]!, (frame) => tokenGroupFromPatch(frame)?.['quantity'] === quantity),
          ]);
          for (const viewerPatch of viewerPatches) {
            const projected = tokenGroupFromPatch(viewerPatch);
            assertTokenGroup(projected, quantity, cardIds);
            expect(projected?.['groupId']).toBe(ownerGroup?.['groupId']);
          }
        }

        if (quantity === 20) {
          logCountBeforeRetry = gameLog(await gameSnapshot(request, setup.gameId, playerA.token)).length;
          retryResult = await sendRuntimeCommand(request, {
            gameId: setup.gameId,
            token: playerA.token,
            baseVersion: beforeVersion,
            clientActionId,
            type: 'card.token.created',
            payload: {
              playerId: playerA.user.id,
              quantity,
              card: {
                name: `Domain Treasure ${quantity}`,
                typeLine: 'Token Artifact - Treasure',
                scryfallId: `token-group-domain-treasure-${quantity}`,
                cardVersion: 'runtime-v1',
                language: 'en',
              },
              position: { x: 0.38, y: 0.46, unit: 'ratio' },
            },
          });
          logCountAfterRetry = gameLog(await gameSnapshot(request, setup.gameId, playerA.token)).length;
          expect(retryResult.version).toBe(result.version);
          expect(tokenGroupFromPatch(retryResult.patch)).toEqual(ownerGroup);
          expect(logCountAfterRetry).toBe(logCountBeforeRetry);
        }
      }

      expect(retryResult).not.toBeNull();
      const liveBootstraps = await Promise.all(setup.players.map((player) => gameBootstrap(request, setup.gameId, player.token)));
      for (const bootstrap of liveBootstraps) {
        assertBootstrapGroups(bootstrap, expectedGroups);
        expect(countTokenMemberRefs(bootstrap)).toBe(32);
      }

      await pageB.reload();
      await expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(audits[1]!);
      assertBootstrapGroups(await gameBootstrap(request, setup.gameId, playerB.token), expectedGroups);

      await pageC.close();
      const reconnectPage = await contexts[2]!.newPage();
      const reconnectAudit = collectPageAudit(reconnectPage, setup.gameId);
      await reconnectPage.goto(`/games/${setup.gameId}`);
      await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(reconnectAudit);
      assertBootstrapGroups(await gameBootstrap(request, setup.gameId, playerC.token), expectedGroups);

      const beforeRestartBootstrap = await gameBootstrap(request, setup.gameId, playerA.token);
      const beforeRestartLog = gameLog(await gameSnapshot(request, setup.gameId, playerA.token));
      await restartRuntime(request);
      const afterRestartBootstraps = await Promise.all(setup.players.map((player) => gameBootstrap(request, setup.gameId, player.token)));
      expect(normalizedTokenGroups(afterRestartBootstraps[0]!)).toEqual(normalizedTokenGroups(beforeRestartBootstrap));
      for (const bootstrap of afterRestartBootstraps) {
        assertBootstrapGroups(bootstrap, expectedGroups);
      }
      expect(gameLog(await gameSnapshot(request, setup.gameId, playerA.token))).toEqual(beforeRestartLog);

      baseVersion = await gameVersion(request, setup.gameId, playerA.token);
      const validAfterRestart = await sendRuntimeCommand(request, {
        gameId: setup.gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.token.created',
        payload: {
          playerId: playerA.user.id,
          quantity: 1,
          card: { name: 'Post Restart Clue', typeLine: 'Token Artifact - Clue' },
          position: { x: 0.52, y: 0.5, unit: 'ratio' },
        },
      });
      expect(validAfterRestart.version).toBe(baseVersion + 1);
      expect(addedCards(validAfterRestart.patch)).toHaveLength(1);
      expect(tokenGroupFromPatch(validAfterRestart.patch)).toBeNull();

      const allAudits = [...audits, reconnectAudit];
      for (const [index, audit] of allAudits.entries()) {
        expect(audit.frames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
        expect(audit.frames.some((frame) => frame['kind'] === 'resync_required' || frame['status'] === 'resync_required')).toBe(false);
        expect(audit.frames.some((frame) => frame['kind'] === 'command_failed')).toBe(false);
        const unexpectedConsoleErrors = audit.consoleErrors.filter((entry) =>
          !/WebSocket connection .* closed before receiving a handshake response/i.test(entry));
        expect(unexpectedConsoleErrors, `viewer ${index + 1} unexpected console errors`).toEqual([]);
        expect(audit.pageErrors, `viewer ${index + 1} page errors`).toEqual([]);
        expect(audit.commandFallbackRequests, `viewer ${index + 1} HTTP command fallback`).toEqual([]);
      }
      for (const [index, baseline] of recoveryBaselines.entries()) {
        const expectedRefresh = index === 1 ? 1 : 0;
        expect(audits[index]!.recoveryRequests.length).toBeLessThanOrEqual(baseline + expectedRefresh);
      }
      expect(expectedMemberIds.size).toBe(33);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<TokenGroupSetup> {
  const players: TokenGroupPlayer[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `tg-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `TG${index + 1} ${runId.slice(-10)}`,
    });
    players.push({ ...session, deck });
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
    headers: bearer(token),
    data: {
      deckId,
      visibility: 'public',
      name: `TokenGroup Domain ${runId.slice(-10)}`,
      format: 'commander',
      maxPlayers: 3,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create TokenGroup room');
  const payload = await response.json() as { room?: { id?: string } };
  if (!payload.room?.id) {
    throw new Error('Room creation did not return room.id.');
  }
  return payload.room.id;
}

async function joinRoom(request: APIRequestContext, token: string, roomId: string, deckId: string): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: bearer(token),
    data: { deckId },
  });
  await expectApiOk(response, 'join TokenGroup room');
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: bearer(tokens[0]!) });
    await expectApiOk(response, 'load TokenGroup room turn order');
    const payload = await response.json() as { room?: { players?: Array<{ turnRolls?: number[] }> } };
    if (turnOrderResolved(payload.room?.players ?? [])) {
      return;
    }
    for (const token of tokens) {
      const roll = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: bearer(token) });
      if (!roll.ok() && roll.status() !== 409) {
        await expectApiOk(roll, 'roll TokenGroup turn order');
      }
    }
  }
  throw new Error('Unable to resolve TokenGroup room turn order.');
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: bearer(token) });
  await expectApiOk(response, 'start TokenGroup room');
  const payload = await response.json() as { game?: { id?: string } };
  if (!payload.game?.id) {
    throw new Error('Room start did not return game.id.');
  }
  return payload.game.id;
}

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1'));
}

function collectPageAudit(page: Page, gameId: string): PageAudit {
  const audit: PageAudit = { frames: [], consoleErrors: [], pageErrors: [], recoveryRequests: [], commandFallbackRequests: [] };
  page.on('websocket', (socket) => {
    audit.frames.push({ kind: 'connection_open', url: socket.url() });
    socket.on('framereceived', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) audit.frames.push(parsed);
    });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') audit.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => audit.pageErrors.push(error.message));
  page.on('request', (outgoing) => {
    const url = outgoing.url();
    if (outgoing.method() === 'POST' && url.includes(`/games/${gameId}/commands`)) audit.commandFallbackRequests.push(url);
    if (outgoing.method() === 'GET' && /\/(snapshot|bootstrap)(?:\?|$)/.test(url) && url.includes(`/games/${gameId}`)) {
      audit.recoveryRequests.push(url);
    }
  });
  return audit;
}

async function waitForGameplayConnection(audit: PageAudit): Promise<void> {
  await expect.poll(() => audit.frames.some((frame) =>
    frame['kind'] === 'connection_open' || frame['kind'] === 'connection_ready' || frame['kind'] === 'patch.v2'),
  { timeout: 30_000 }).toBe(true);
}

async function waitForPatchAfter(
  audit: PageAudit,
  start: number,
  predicate: (frame: JsonObject) => boolean,
): Promise<JsonObject> {
  let found: JsonObject | undefined;
  await expect.poll(() => {
    found = audit.frames.slice(start).find((frame) => frame['kind'] === 'patch.v2' && predicate(frame));
    return found !== undefined;
  }, { timeout: 20_000 }).toBe(true);
  return found!;
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: bearer(token) });
  await expectApiOk(response, 'load TokenGroup snapshot');
  const payload = await response.json() as { game?: { snapshot?: JsonObject } };
  if (!payload.game?.snapshot) throw new Error('Snapshot response did not include game.snapshot.');
  return payload.game.snapshot;
}

async function gameBootstrap(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/bootstrap?contract=v2`, { headers: bearer(token) });
  await expectApiOk(response, 'load TokenGroup bootstrap');
  const payload = await response.json() as JsonObject & { game?: JsonObject };
  return { ...payload, ...(isRecord(payload['game']) ? payload['game'] as JsonObject : {}) };
}

async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  return Math.max(1, Number((await gameSnapshot(request, gameId, token))['version'] ?? 1));
}

async function restartRuntime(request: APIRequestContext): Promise<void> {
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], {
    cwd: resolve(process.cwd(), '..'),
    timeout: 60_000,
    windowsHide: true,
  });
  await expect.poll(async () => {
    try {
      const response = await request.get(RUNTIME_READY_URL, { timeout: 3_000 });
      return response.ok();
    } catch {
      return false;
    }
  }, { timeout: 60_000 }).toBe(true);
}

function addedCards(message: JsonObject): JsonObject[] {
  const cards = operation(message, 'zone.cards.add')?.['cards'];
  return Array.isArray(cards) ? cards.filter(isRecord) : [];
}

function tokenGroupFromPatch(message: JsonObject): JsonObject | null {
  const group = operation(message, 'token.group.set')?.['group'];
  return isRecord(group) ? group : null;
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'].filter(isRecord) : [];
  return ops.find((item) => item['op'] === op) ?? null;
}

function assertTokenGroup(group: JsonObject | null, quantity: number, memberIds: readonly string[]): void {
  expect(group).not.toBeNull();
  expect(group?.['quantity']).toBe(quantity);
  expect(group?.['revision']).toBe(1);
  expect(group?.['effectVersion']).toBe(1);
  expect(group?.['memberRefs']).toEqual(memberIds);
  expect(group?.['rootRef']).toBe(memberIds[0]);
  expect(typeof group?.['groupId']).toBe('string');
  expect(String(group?.['groupId'] ?? '')).not.toContain(memberIds[0]!);
  expect(group).not.toHaveProperty('orderedMemberIds');
  expect(group).not.toHaveProperty('createdByPlayerId');
}

function assertBootstrapGroups(bootstrap: JsonObject, expected: ReadonlyMap<number, JsonObject>): void {
  const groups = normalizedTokenGroups(bootstrap);
  expect(groups).toHaveLength(expected.size);
  for (const [quantity, liveGroup] of expected) {
    const group = groups.find((candidate) => candidate['quantity'] === quantity);
    expect(group, `missing bootstrap TokenGroup quantity ${quantity}`).toBeTruthy();
    expect(group?.['groupId']).toBe(liveGroup['groupId']);
    expect(group?.['rootRef']).toBe(liveGroup['rootRef']);
    expect(group?.['memberRefs']).toEqual(liveGroup['memberRefs']);
    expect(group?.['revision']).toBe(1);
    expect(group?.['effectVersion']).toBe(1);
  }
  expect(JSON.stringify(groups)).not.toContain('createdByPlayerId');
  expect(JSON.stringify(groups)).not.toContain('orderedMemberIds');
}

function normalizedTokenGroups(bootstrap: JsonObject): JsonObject[] {
  const relations = isRecord(bootstrap['relations']) ? bootstrap['relations'] as JsonObject : {};
  const groups = Array.isArray(relations['tokenGroups']) ? relations['tokenGroups'].filter(isRecord) : [];
  return [...groups].sort((left, right) => Number(left['quantity']) - Number(right['quantity']));
}

function countTokenMemberRefs(bootstrap: JsonObject): number {
  return normalizedTokenGroups(bootstrap).reduce((total, group) =>
    total + (Array.isArray(group['memberRefs']) ? group['memberRefs'].length : 0), 0);
}

function gameLog(snapshot: JsonObject): JsonObject[] {
  const entries = snapshot['eventLog'];
  return Array.isArray(entries) ? entries.filter(isRecord) : [];
}

function turnOrderResolved(players: Array<{ turnRolls?: number[] }>): boolean {
  if (players.length === 0) return false;
  const rolls = new Set<string>();
  for (const player of players) {
    if (!Array.isArray(player.turnRolls) || player.turnRolls.length === 0) return false;
    const key = player.turnRolls.join('-');
    if (rolls.has(key)) return false;
    rolls.add(key);
  }
  return true;
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  try {
    const parsed = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function assertServiceReady(request: APIRequestContext, url: string, label: string): Promise<void> {
  const response = await request.get(url, { timeout: 5_000 });
  if (!response.ok()) throw new Error(`${label} is not reachable at ${url}. HTTP ${response.status()}: ${await response.text()}`);
}

async function expectApiOk(response: { ok(): boolean; status(): number; text(): Promise<string> }, action: string): Promise<void> {
  if (!response.ok()) throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
