import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { resolveGameToPlaying } from './support/commander-game';
import { sendRuntimeCommand, type RuntimeWebSocketCommandResult } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const API_HEALTH_URL = process.env['E2E_API_HEALTH_URL'] ?? `${API_BASE_URL}/healthz`;
const API_READY_URL = process.env['E2E_API_READY_URL'] ?? `${API_BASE_URL}/readyz`;
const WEBSOCKET_HEALTH_URL = process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz';
const WEBSOCKET_READY_URL = process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz';
const RUNTIME_HEALTH_URL = process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;
type MaterializationPlayer = {
  token: string;
  refreshToken: string;
  user: RealUserSession['user'];
  credentials: RealUserSession['credentials'];
  deck: BasicCommanderDeckFromDatabaseResult;
};
type MaterializationSetup = { gameId: string; roomId: string; players: MaterializationPlayer[] };
type RequestAudit = { bootstrap: number; snapshot: number };
type BrowserAudit = { frames: JsonObject[]; requests: RequestAudit; errors: string[] };
type RestartState = {
  materializedForAll: string;
  materializedForTargets: string;
  nextPrivateCard: string;
};

test.describe('product placeholder materialization and visibility audience closure gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: MaterializationSetup;
  let restartState: RestartState;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(360_000);
    await assertAllServicesHealthy(request);
    setup = await createThreePlayerGame(request, `placeholder${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
  });

  test('3P live reveal, batch reveal, conceal, movement, refresh and reconnect stay projection-equivalent', async ({ browser, request, baseURL }) => {
    test.setTimeout(480_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const [playerA, playerB, playerC] = setup.players;
    if (!playerA || !playerB || !playerC) {
      throw new Error('Placeholder materialization gate requires exactly three players.');
    }
    const { gameId } = setup;
    const ownerSnapshot = await gameSnapshot(request, gameId, playerA.token);
    const ownerHand = zoneCards(ownerSnapshot, playerA.user.id, 'hand');
    const ownerHandIds = zoneInstanceIds(ownerSnapshot, playerA.user.id, 'hand');
    if (ownerHandIds.length < 6) {
      throw new Error(`Placeholder gate requires at least six owner hand cards, got ${ownerHandIds.length}.`);
    }
    const [targetOnlyId, revealAllId, multiViewerId, publicMoveId, restartRevealId] = ownerHandIds;
    if (!targetOnlyId || !revealAllId || !multiViewerId || !publicMoveId || !restartRevealId) {
      throw new Error('Could not allocate private card fixtures.');
    }
    const realNames = new Set(ownerHand.map((card) => String(card['name'] ?? '')).filter(Boolean));
    assertOwnerPrivateCards(ownerHand, ownerHandIds);

    const initialB = await gameSnapshot(request, gameId, playerB.token);
    const initialC = await gameSnapshot(request, gameId, playerC.token);
    assertOpaqueHandProjection(initialB, playerA.user.id, ownerHandIds, realNames);
    assertOpaqueHandProjection(initialC, playerA.user.id, ownerHandIds, realNames);

    const players = [playerA, playerB, playerC];
    const refreshTokens = await Promise.all(players.map((player) => loginRefreshToken(request, player.credentials)));
    const contexts = await Promise.all(players.map((player, index) =>
      browser.newContext({ baseURL, storageState: authStorageState(baseURL, player.user, refreshTokens[index]!) }),
    ));
    await Promise.all(contexts.map(enableFrontendGameplayV2));

    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const [pageA, pageB, pageC] = pages;
      if (!pageA || !pageB || !pageC) {
        throw new Error('Failed to create three browser pages.');
      }
      const audits = pages.map(createBrowserAudit);

      await Promise.all(pages.map((page) => page.goto(`/games/${gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(audits.map((audit) => waitForGameplayConnection(audit.frames)));
      await Promise.all(pages.map((page) => focusPlayerById(page, playerA.user.id)));

      expect((await handProjection(pageA, playerA.user.id)).map((card) => card.instanceId)).toEqual(ownerHandIds);
      expect((await handProjection(pageB, playerA.user.id)).map((card) => card.instanceId)).toEqual(opaqueHandIds(playerA.user.id, ownerHandIds.length));
      expect((await handProjection(pageC, playerA.user.id)).map((card) => card.instanceId)).toEqual(opaqueHandIds(playerA.user.id, ownerHandIds.length));
      await assertHandCount(pages, playerA.user.id, ownerHandIds.length);

      let baseVersion = Math.max(1, Number(ownerSnapshot['version'] ?? 1));
      let liveRequestBaseline = requestTotal(audits);

      const targeted = await runAudienceCommand(request, audits, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.revealed',
        payload: { playerId: playerA.user.id, instanceId: targetOnlyId, to: [playerB.user.id] },
        expectedOp: 'private.cards.materialize',
        targetIndexes: [1],
        nonTargetIndexes: [0, 2],
      });
      baseVersion = targeted.version;
      expect(materializationEntries(targeted.targetPatches[0]!)).toHaveLength(1);
      await expectHandSlot(pageB, playerA.user.id, 0, targetOnlyId);
      await expectHandSlot(pageC, playerA.user.id, 0, `${playerA.user.id}-hidden-hand-0`);
      assertNoDuplicatePlaceholderAndReal(await handProjection(pageB, playerA.user.id), `${playerA.user.id}-hidden-hand-0`, targetOnlyId);
      await assertHandCount(pages, playerA.user.id, ownerHandIds.length);
      expect(requestTotal(audits)).toBe(liveRequestBaseline);

      const revealAll = await runAudienceCommand(request, audits, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.revealed',
        payload: { playerId: playerA.user.id, instanceId: revealAllId, to: 'all' },
        expectedOp: 'private.cards.materialize',
        targetIndexes: [0, 1, 2],
        nonTargetIndexes: [],
      });
      baseVersion = revealAll.version;
      await Promise.all([pageB, pageC].map((page) => expectHandContains(page, playerA.user.id, revealAllId)));
      expect(requestTotal(audits)).toBe(liveRequestBaseline);

      const multiViewer = await runAudienceCommand(request, audits, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.revealed',
        payload: { playerId: playerA.user.id, instanceId: multiViewerId, to: [playerB.user.id, playerC.user.id] },
        expectedOp: 'private.cards.materialize',
        targetIndexes: [1, 2],
        nonTargetIndexes: [0],
      });
      baseVersion = multiViewer.version;
      expect(multiViewer.targetPatches.every((patch) => String(patch['visibility'] ?? '').startsWith('group:'))).toBe(true);
      await Promise.all([pageB, pageC].map((page) => expectHandContains(page, playerA.user.id, multiViewerId)));
      expect(requestTotal(audits)).toBe(liveRequestBaseline);

      const libraryBefore = await gameSnapshot(request, gameId, playerA.token);
      const libraryTopIds = zoneInstanceIds(libraryBefore, playerA.user.id, 'library').slice(0, 2);
      if (libraryTopIds.length !== 2) {
        throw new Error('Placeholder gate requires two library cards for batch materialization.');
      }
      const libraryBatch = await runAudienceCommand(request, audits, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'library.reveal_top',
        payload: { playerId: playerA.user.id, count: 2, to: [playerB.user.id, playerC.user.id] },
        expectedOp: 'private.cards.materialize',
        targetIndexes: [1, 2],
        nonTargetIndexes: [0],
      });
      baseVersion = libraryBatch.version;
      for (const patch of libraryBatch.targetPatches) {
        const entries = materializationEntries(patch);
        expect(entries).toHaveLength(2);
        expect(entries.map((entry) => (entry['card'] as JsonObject)['instanceId'])).toEqual(libraryTopIds);
      }
      const [libraryB, libraryC] = await Promise.all([
        gameSnapshot(request, gameId, playerB.token),
        gameSnapshot(request, gameId, playerC.token),
      ]);
      expect(zoneInstanceIds(libraryB, playerA.user.id, 'library')).toEqual(libraryTopIds);
      expect(zoneInstanceIds(libraryC, playerA.user.id, 'library')).toEqual(libraryTopIds);
      expect(requestTotal(audits)).toBe(liveRequestBaseline);

      const conceal = await runAudienceCommand(request, audits, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.revealed',
        payload: { playerId: playerA.user.id, instanceId: targetOnlyId, to: [playerB.user.id], revealed: false },
        expectedOp: 'private.cards.conceal',
        targetIndexes: [1],
        nonTargetIndexes: [0, 2],
      });
      baseVersion = conceal.version;
      expect(JSON.stringify(conceal.targetPatches)).not.toContain('cardKey');
      await expectHandSlot(pageB, playerA.user.id, 0, `${playerA.user.id}-hidden-hand-0`);
      await expectHandContains(pageA, playerA.user.id, targetOnlyId);
      expect(await pageB.locator(`[data-testid="game-card"][data-zone="hand"][data-owner-player-id="${playerA.user.id}"][data-card-instance-id="${targetOnlyId}"]`).count()).toBe(0);
      await assertHandCount(pages, playerA.user.id, ownerHandIds.length);
      expect(requestTotal(audits)).toBe(liveRequestBaseline);

      const publicMove = await runMovementCommand(request, audits, {
        gameId,
        token: playerA.token,
        baseVersion,
        instanceId: publicMoveId,
        playerId: playerA.user.id,
        fromZone: 'hand',
        toZone: 'battlefield',
      });
      baseVersion = publicMove.version;
      await Promise.all(pages.map((page) => expect(battlefieldCard(page, playerA.user.id, publicMoveId)).toBeVisible({ timeout: 15_000 })));
      for (const player of [playerA, playerB, playerC]) {
        const projected = await gameSnapshot(request, gameId, player.token);
        assertVisibleIdentity(zoneCard(projected, playerA.user.id, 'battlefield', publicMoveId));
      }
      await assertHandCount(pages, playerA.user.id, ownerHandIds.length - 1);
      expect(requestTotal(audits)).toBe(liveRequestBaseline);

      const privateMove = await runMovementCommand(request, audits, {
        gameId,
        token: playerA.token,
        baseVersion,
        instanceId: publicMoveId,
        playerId: playerA.user.id,
        fromZone: 'battlefield',
        toZone: 'hand',
      });
      baseVersion = privateMove.version;
      await expectHandContains(pageA, playerA.user.id, publicMoveId);
      await expect.poll(async () => (await handProjection(pageB, playerA.user.id)).some((card) => card.instanceId === publicMoveId), { timeout: 15_000 }).toBe(false);
      await expect.poll(async () => (await handProjection(pageC, playerA.user.id)).some((card) => card.instanceId === publicMoveId), { timeout: 15_000 }).toBe(false);
      await assertHandCount(pages, playerA.user.id, ownerHandIds.length);
      expect(requestTotal(audits)).toBe(liveRequestBaseline);

      const bootstrapB = await gameSnapshot(request, gameId, playerB.token);
      const bootstrapC = await gameSnapshot(request, gameId, playerC.token);
      expect((await handProjection(pageB, playerA.user.id)).map((card) => card.instanceId)).toEqual(zoneInstanceIds(bootstrapB, playerA.user.id, 'hand'));
      expect((await handProjection(pageC, playerA.user.id)).map((card) => card.instanceId)).toEqual(zoneInstanceIds(bootstrapC, playerA.user.id, 'hand'));

      const beforeRefresh = requestTotal(audits);
      await pageB.reload();
      await expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(audits[1]!.frames);
      await focusPlayerById(pageB, playerA.user.id);
      const refreshedB = await gameSnapshot(request, gameId, playerB.token);
      expect((await handProjection(pageB, playerA.user.id)).map((card) => card.instanceId)).toEqual(zoneInstanceIds(refreshedB, playerA.user.id, 'hand'));
      expect(requestTotal(audits)).toBeGreaterThan(beforeRefresh);

      const reconnectContext = await browser.newContext({ baseURL, storageState: await contexts[2]!.storageState() });
      await enableFrontendGameplayV2(reconnectContext);
      const reconnectPage = await reconnectContext.newPage();
      const reconnectAudit = createBrowserAudit(reconnectPage);
      await reconnectPage.goto(`/games/${gameId}`);
      await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(reconnectAudit.frames);
      await focusPlayerById(reconnectPage, playerA.user.id);
      const reconnectedC = await gameSnapshot(request, gameId, playerC.token);
      expect((await handProjection(reconnectPage, playerA.user.id)).map((card) => card.instanceId)).toEqual(zoneInstanceIds(reconnectedC, playerA.user.id, 'hand'));
      assertNoUnexpectedRealtime([...audits, reconnectAudit]);
      await reconnectContext.close();

      restartState = {
        materializedForAll: revealAllId,
        materializedForTargets: multiViewerId,
        nextPrivateCard: restartRevealId,
      };
      void baseVersion;
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });

  test('actor restart rebuilds audiences and continues materializing without recovery', async ({ browser, request, baseURL }) => {
    test.setTimeout(300_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }
    const [playerA, playerB, playerC] = setup.players;
    if (!playerA || !playerB || !playerC || !restartState) {
      throw new Error('Actor restart gate is missing the live phase state.');
    }

    await restartRuntimeContainer();
    await expect.poll(async () => serviceReady(request, RUNTIME_READY_URL), { timeout: 60_000 }).toBe(true);

    const players = [playerA, playerB, playerC];
    const refreshTokens = await Promise.all(players.map((player) => loginRefreshToken(request, player.credentials)));
    const contexts = await Promise.all(players.map((player, index) =>
      browser.newContext({ baseURL, storageState: authStorageState(baseURL, player.user, refreshTokens[index]!) }),
    ));
    await Promise.all(contexts.map(enableFrontendGameplayV2));
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const audits = pages.map(createBrowserAudit);
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(audits.map((audit) => waitForGameplayConnection(audit.frames)));
      await Promise.all(pages.map((page) => focusPlayerById(page, playerA.user.id)));

      await Promise.all(pages.map((page) => expectHandContains(page, playerA.user.id, restartState.materializedForAll)));
      await Promise.all([pages[1]!, pages[2]!].map((page) => expectHandContains(page, playerA.user.id, restartState.materializedForTargets)));

      const liveBaseline = requestTotal(audits);
      const baseVersion = await gameVersion(request, setup.gameId, playerA.token);
      const afterRestart = await runAudienceCommand(request, audits, {
        gameId: setup.gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.revealed',
        payload: { playerId: playerA.user.id, instanceId: restartState.nextPrivateCard, to: [playerB.user.id] },
        expectedOp: 'private.cards.materialize',
        targetIndexes: [1],
        nonTargetIndexes: [0, 2],
      });
      expect(afterRestart.version).toBeGreaterThan(baseVersion);
      await expectHandContains(pages[1]!, playerA.user.id, restartState.nextPrivateCard);
      await expect.poll(async () => (await handProjection(pages[2]!, playerA.user.id)).some((card) => card.instanceId === restartState.nextPrivateCard), { timeout: 15_000 }).toBe(false);
      expect(requestTotal(audits)).toBe(liveBaseline);
      assertNoUnexpectedRealtime(audits);
      await assertAllServicesHealthy(request);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function runAudienceCommand(
  request: APIRequestContext,
  audits: BrowserAudit[],
  options: {
    gameId: string;
    token: string;
    baseVersion: number;
    type: string;
    payload: JsonObject;
    expectedOp: 'private.cards.materialize' | 'private.cards.conceal';
    targetIndexes: number[];
    nonTargetIndexes: number[];
  },
): Promise<RuntimeWebSocketCommandResult & { targetPatches: JsonObject[] }> {
  const clientActionId = `placeholder-${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const starts = audits.map((audit) => audit.frames.length);
  const waits = options.targetIndexes.map((index) => waitForPatch(audits[index]!.frames, starts[index]!, clientActionId, options.expectedOp));
  const result = await sendRuntimeCommand(request, { ...options, clientActionId });
  const targetPatches = await Promise.all(waits);
  for (const index of options.nonTargetIndexes) {
    await expect.poll(() => audits[index]!.frames.some((frame, frameIndex) => frameIndex >= starts[index]!
      && frame['ackClientActionId'] === clientActionId), { timeout: 10_000 }).toBe(true);
    const unexpected = audits[index]!.frames.slice(starts[index]).filter((frame) =>
      frame['ackClientActionId'] === clientActionId && hasOp(frame, options.expectedOp),
    );
    expect(unexpected).toEqual([]);
  }
  assertNoUnexpectedRealtime(audits);
  return { ...result, targetPatches };
}

async function runMovementCommand(
  request: APIRequestContext,
  audits: BrowserAudit[],
  options: {
    gameId: string;
    token: string;
    baseVersion: number;
    instanceId: string;
    playerId: string;
    fromZone: string;
    toZone: string;
  },
): Promise<RuntimeWebSocketCommandResult> {
  const clientActionId = `placeholder-move-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const starts = audits.map((audit) => audit.frames.length);
  const waits = audits.map((audit, index) => waitForPatch(
    audit.frames,
    starts[index]!,
    clientActionId,
    index === 0 ? 'zone.cards.move' : options.toZone === 'battlefield' ? 'zone.cards.add' : 'private.cards.conceal',
  ));
  const result = await sendRuntimeCommand(request, {
    gameId: options.gameId,
    token: options.token,
    baseVersion: options.baseVersion,
    type: 'card.moved',
    clientActionId,
    payload: {
      playerId: options.playerId,
      instanceId: options.instanceId,
      fromZone: options.fromZone,
      toZone: options.toZone,
    },
  });
  await Promise.all(waits);
  assertNoUnexpectedRealtime(audits);
  return result;
}

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<MaterializationSetup> {
  const players: MaterializationPlayer[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `pm-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `PM${index + 1} ${runId.slice(-10)}`,
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
      name: `Placeholder Materialization ${runId.slice(-10)}`,
      format: 'commander',
      maxPlayers: 3,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create placeholder room');
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
  await expectApiOk(response, 'join placeholder room');
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokens[0]}` },
    });
    await expectApiOk(roomResponse, 'load placeholder room turn order');
    const payload = await roomResponse.json() as { room?: { players?: Array<{ turnRolls?: number[] }> } };
    if (turnOrderResolved(payload.room?.players ?? [])) {
      return;
    }
    for (const token of tokens) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok() && response.status() !== 409) {
        await expectApiOk(response, 'roll placeholder room turn order');
      }
    }
  }
  throw new Error('Unable to resolve placeholder room turn order.');
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'start placeholder room');
  const payload = await response.json() as { game?: { id?: string } };
  if (!payload.game?.id) {
    throw new Error('Room start did not return game.id.');
  }
  return payload.game.id;
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'load projected game snapshot');
  const payload = await response.json() as { game?: { snapshot?: JsonObject } };
  return payload.game?.snapshot ?? {};
}

async function loginRefreshToken(request: APIRequestContext, credentials: { email: string; password: string }): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/auth/login`, { data: credentials });
  await expectApiOk(response, 'refresh browser authentication');
  const setCookie = response.headers()['set-cookie'] ?? '';
  const refreshToken = setCookie.match(/commanderzone\.refresh=([^;]+)/)?.[1] ?? '';
  expect(refreshToken.length).toBeGreaterThan(10);
  return refreshToken;
}

async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  return Math.max(1, Number((await gameSnapshot(request, gameId, token))['version'] ?? 1));
}

function zoneCards(snapshot: JsonObject, playerId: string, zone: string): JsonObject[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return zones?.[zone] ?? [];
}

function zoneCard(snapshot: JsonObject, playerId: string, zone: string, instanceId: string): JsonObject {
  const card = zoneCards(snapshot, playerId, zone).find((candidate) => candidate['instanceId'] === instanceId);
  if (!card) {
    throw new Error(`Missing ${zone} card ${instanceId} for ${playerId}.`);
  }
  return card;
}

function zoneInstanceIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  return zoneCards(snapshot, playerId, zone).map((card) => String(card['instanceId'] ?? '')).filter(Boolean);
}

function assertOwnerPrivateCards(cards: JsonObject[], expectedIds: string[]): void {
  expect(cards.map((card) => card['instanceId'])).toEqual(expectedIds);
  for (const card of cards) {
    assertVisibleIdentity(card);
  }
}

function assertOpaqueHandProjection(snapshot: JsonObject, ownerId: string, realIds: string[], realNames: Set<string>): void {
  const cards = zoneCards(snapshot, ownerId, 'hand');
  expect(cards).toHaveLength(realIds.length);
  expect(cards.map((card) => card['instanceId'])).toEqual(opaqueHandIds(ownerId, realIds.length));
  for (const [index, card] of cards.entries()) {
    expect(card['instanceId']).toBe(`${ownerId}-hidden-hand-${index}`);
    expect(card['hidden']).toBe(true);
    expect(card['faceDown']).toBe(true);
    expect(card['cardKey']).toBeUndefined();
    expect(card['printId']).toBeUndefined();
    expect(card['cardVersion']).toBeUndefined();
    expect(card['cardRef']).toBeUndefined();
    expect(realNames.has(String(card['name'] ?? ''))).toBe(false);
    expect(JSON.stringify(card)).not.toContain(realIds[index]!);
  }
}

function assertVisibleIdentity(card: JsonObject): void {
  expect(typeof card['instanceId']).toBe('string');
  expect(typeof card['name']).toBe('string');
  expect(String(card['name'])).not.toMatch(/^(Hidden card|Card|Unknown Card)$/i);
  expect(
    typeof card['cardKey'] === 'string'
    || typeof card['scryfallId'] === 'string'
    || (typeof card['imageUris'] === 'object' && card['imageUris'] !== null),
  ).toBe(true);
}

function opaqueHandIds(ownerId: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${ownerId}-hidden-hand-${index}`);
}

async function handProjection(page: Page, ownerId: string): Promise<Array<{ instanceId: string; name: string; faceDown: boolean; hasImage: boolean }>> {
  return page.locator(`[data-testid="game-card"][data-zone="hand"][data-owner-player-id="${ownerId}"]`).evaluateAll((elements) =>
    elements.map((element) => ({
      instanceId: element.getAttribute('data-card-instance-id') ?? '',
      name: element.getAttribute('data-card-name') ?? '',
      faceDown: element.classList.contains('face-down'),
      hasImage: element.querySelector('img') !== null,
    })),
  );
}

async function expectHandSlot(page: Page, ownerId: string, index: number, instanceId: string): Promise<void> {
  await expect.poll(async () => (await handProjection(page, ownerId))[index]?.instanceId, { timeout: 15_000 }).toBe(instanceId);
}

async function expectHandContains(page: Page, ownerId: string, instanceId: string): Promise<void> {
  await expect.poll(async () => (await handProjection(page, ownerId)).some((card) => card.instanceId === instanceId), { timeout: 15_000 }).toBe(true);
}

function assertNoDuplicatePlaceholderAndReal(cards: Array<{ instanceId: string }>, placeholderId: string, realId: string): void {
  expect(cards.filter((card) => card.instanceId === realId)).toHaveLength(1);
  expect(cards.some((card) => card.instanceId === placeholderId)).toBe(false);
}

async function assertHandCount(pages: Page[], ownerId: string, expected: number): Promise<void> {
  for (const page of pages) {
    await expect(page.getByTestId('player-panel')).toHaveAttribute('data-player-id', ownerId);
    await expect(page.getByTestId('player-panel')).toHaveAttribute('data-hand-count', String(expected));
    expect(await handProjection(page, ownerId)).toHaveLength(expected);
  }
}

function battlefieldCard(page: Page, ownerId: string, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerId}"][data-card-instance-id="${instanceId}"]`);
}

function createBrowserAudit(page: Page): BrowserAudit {
  const audit: BrowserAudit = { frames: [], requests: { bootstrap: 0, snapshot: 0 }, errors: [] };
  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => {
      const frame = parseFrame(event.payload);
      if (frame) {
        audit.frames.push(frame);
      }
    });
  });
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'GET' && url.includes(`/games/`) && url.includes('/bootstrap')) {
      audit.requests.bootstrap += 1;
    }
    if (request.method() === 'GET' && url.includes(`/games/`) && url.includes('/snapshot')) {
      audit.requests.snapshot += 1;
    }
  });
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' || /target_not_found|resync_required/i.test(text)) {
      audit.errors.push(text);
    }
  });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  return audit;
}

function requestTotal(audits: BrowserAudit[]): number {
  return audits.reduce((sum, audit) => sum + audit.requests.bootstrap + audit.requests.snapshot, 0);
}

async function waitForGameplayConnection(frames: JsonObject[]): Promise<void> {
  await expect.poll(() => frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), {
    timeout: 30_000,
  }).toBe(true);
}

async function waitForPatch(frames: JsonObject[], start: number, clientActionId: string, op: string): Promise<JsonObject> {
  let found: JsonObject | undefined;
  try {
    await expect.poll(() => {
      found = frames.slice(start).find((frame) => frame['kind'] === 'patch.v2'
        && frame['ackClientActionId'] === clientActionId
        && hasOp(frame, op));
      return found !== undefined;
    }, { timeout: 20_000 }).toBe(true);
  } catch (error) {
    throw new Error(`Missing ${op} for ${clientActionId}. Recent frames: ${JSON.stringify(frames.slice(start).slice(-8))}`, { cause: error });
  }
  return found!;
}

function hasOp(frame: JsonObject, op: string): boolean {
  return operations(frame).some((operation) => operation['op'] === op);
}

function operations(frame: JsonObject): JsonObject[] {
  return Array.isArray(frame['ops']) ? frame['ops'] as JsonObject[] : [];
}

function materializationEntries(frame: JsonObject): JsonObject[] {
  const operation = operations(frame).find((candidate) => candidate['op'] === 'private.cards.materialize');
  return Array.isArray(operation?.['entries']) ? operation['entries'] as JsonObject[] : [];
}

function assertNoUnexpectedRealtime(audits: BrowserAudit[]): void {
  for (const audit of audits) {
    expect(audit.frames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
    expect(audit.frames.some((frame) => frame['kind'] === 'resync_required' || frame['status'] === 'resync_required')).toBe(false);
    expect(JSON.stringify(audit.frames)).not.toContain('target_not_found');
    expect(audit.errors.filter((error) => /target_not_found|resync_required|Identity contract violation/i.test(error))).toEqual([]);
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

async function focusPlayerById(page: Page, playerId: string): Promise<void> {
  await expect(page.getByTestId('player-panel')).toBeVisible({ timeout: 15_000 });
  if (await page.getByTestId('player-panel').getAttribute('data-player-id') === playerId) {
    return;
  }
	const drawer = page.getByTestId('opponents-drawer-toggle');
	if (await drawer.isVisible() && await drawer.getAttribute('aria-expanded') !== 'true') {
		await drawer.click();
		await expect(drawer).toHaveAttribute('aria-expanded', 'true');
	}
  const board = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`);
  await expect(board).toBeVisible({ timeout: 15_000 });
  await board.click();
  await expect(page.getByTestId('player-panel')).toHaveAttribute('data-player-id', playerId, { timeout: 10_000 });
}

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
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

async function restartRuntimeContainer(): Promise<void> {
  const repositoryRoot = resolve(process.cwd(), '..');
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], {
    cwd: repositoryRoot,
    timeout: 60_000,
    windowsHide: true,
  });
}

async function assertAllServicesHealthy(request: APIRequestContext): Promise<void> {
  await Promise.all([
    assertServiceReady(request, API_HEALTH_URL, 'api healthz'),
    assertServiceReady(request, API_READY_URL, 'api readyz'),
    assertServiceReady(request, WEBSOCKET_HEALTH_URL, 'websocket healthz'),
    assertServiceReady(request, WEBSOCKET_READY_URL, 'websocket readyz'),
    assertServiceReady(request, RUNTIME_HEALTH_URL, 'runtime healthz'),
    assertServiceReady(request, RUNTIME_READY_URL, 'runtime readyz'),
  ]);
}

async function assertServiceReady(request: APIRequestContext, url: string, label: string): Promise<void> {
  const response = await request.get(url, { timeout: 5_000 });
  await expectApiOk(response, label);
}

async function serviceReady(request: APIRequestContext, url: string): Promise<boolean> {
  try {
    return (await request.get(url, { timeout: 3_000 })).ok();
  } catch {
    return false;
  }
}

async function expectApiOk(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) {
    return;
  }
  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
