import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { resolveGameToPlaying } from './support/commander-game';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_METRICS_URL = process.env['E2E_GAME_RUNTIME_METRICS_URL'] ?? 'http://127.0.0.1:8091/metrics';
const SERVICE_URLS = [
  `${API_BASE_URL}/healthz`,
  `${API_BASE_URL}/readyz`,
  process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz',
  process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz',
  process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz',
  process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz',
];
const RUNTIME_READY_URL = SERVICE_URLS[5]!;
const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;
type Player = {
  token: string;
  refreshToken: string;
  credentials: RealUserSession['credentials'];
  user: RealUserSession['user'];
  deck: BasicCommanderDeckFromDatabaseResult;
};
type Setup = { gameId: string; players: [Player, Player, Player] };
type BrowserAudit = {
  received: JsonObject[];
  sent: JsonObject[];
  bootstrap: number;
  snapshot: number;
  commandPosts: number;
  errors: string[];
};
type EventStoreState = { count: number; maxVersion: number };
type CanonicalView = {
  version: number;
  players: Record<string, JsonObject>;
  stack: JsonObject[];
  eventLog: JsonObject[];
};
type Fixtures = {
  a1: string;
  transition: string;
  revealTargets: string;
  revealAll: string;
  faceDownA: string;
  stackPrivate: string;
  libraryPutTop: string;
  libraryPutBottom: string;
  b1: string;
  c1: string;
  privateC: string;
  revealedLibrary: string[];
};

test.describe('Sprint 1 integrated privacy, authority and continuity release gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: Setup;
  let fixtures: Fixtures;
  let expectedByViewer: CanonicalView[];
  let expectedEventStore: EventStoreState;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(360_000);
    await assertServicesHealthy(request);
    setup = await createThreePlayerGame(request, `sprint1${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
  });

  test('3P integrated live, refresh and reconnect preserve privacy and atomic authority', async ({ browser, request, baseURL }) => {
    test.setTimeout(720_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');

    const [playerA, playerB, playerC] = setup.players;
    const initial = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
    const aHand = zoneIds(initial[0]!, playerA.user.id, 'hand');
    const bHand = zoneIds(initial[1]!, playerB.user.id, 'hand');
    const cHand = zoneIds(initial[2]!, playerC.user.id, 'hand');
    if (aHand.length < 7 || bHand.length < 1 || cHand.length < 2) {
      throw new Error(`Integrated gate requires A/B/C hands of 7/1/2 cards; got ${aHand.length}/${bHand.length}/${cHand.length}.`);
    }
    const [transition, revealTargets, revealAll, a1, faceDownA, stackPrivate, libraryPutTop] = aHand;
    const [b1] = bHand;
    const [c1, privateC] = cHand;
    if (!transition || !revealTargets || !revealAll || !a1 || !faceDownA || !stackPrivate || !libraryPutTop || !b1 || !c1 || !privateC) {
      throw new Error('Could not allocate integrated Sprint 1 fixtures.');
    }

    assertOwnerPrivateZone(initial[0]!, playerA.user.id, 'hand', aHand);
    assertOpaquePrivateZone(initial[1]!, playerA.user.id, 'hand', aHand);
    assertOpaquePrivateZone(initial[2]!, playerA.user.id, 'hand', aHand);
    assertNoInternalProjectionKeys(initial[1]!);
    assertNoInternalProjectionKeys(initial[2]!);

    const refreshTokens = await Promise.all(setup.players.map((player) => loginRefreshToken(request, player.credentials)));
    const contexts = await Promise.all(setup.players.map((player, index) => browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, player.user, refreshTokens[index]!),
    })));
    await Promise.all(contexts.map(enableFrontendGameplayV2));
    const extraContexts: BrowserContext[] = [];
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const [pageA, pageB, pageC] = pages;
      const audits = pages.map((page) => createAudit(page, setup.gameId));
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(audits.map((audit) => waitForConnection(audit.received)));
      await Promise.all(pages.map((page) => focusPlayer(page, playerA.user.id)));

      const liveRequestBaseline = requestCount(audits);
      const tickets = await Promise.all(setup.players.map((player) => websocketTicket(request, setup.gameId, player.token)));
      let version = Number(initial[0]!['version'] ?? 1);
      let eventStore = await eventStoreState(setup.gameId);

      const accepted = async (
        actorIndex: number,
        type: string,
        payload: JsonObject,
        clientActionId?: string,
      ): Promise<{ actionId: string; patch: JsonObject; baseVersion: number }> => {
        const baseVersion = version;
        const actionId = clientActionId ?? `sprint1-accepted-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const frames = await sendBrowserCommand(pageA!, tickets[actorIndex]!, {
          kind: 'command.v2', gameId: setup.gameId, messageId: actionId, baseVersion, clientActionId: actionId, type, payload,
        }, actionId);
        const patch = frames.find((frame) => frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === actionId);
        if (!patch) throw new Error(`Accepted ${type} did not return Patch.v2: ${JSON.stringify(frames)}`);
        version = Number(patch['version'] ?? version + 1);
        await expectAllViewerVersion(audits, version);
        expect(frames.some(isLegacyOrRecoveryFrame)).toBe(false);
        return { actionId, patch, baseVersion };
      };

      const rejected = async (
        actorIndex: number,
        type: string,
        payload: JsonObject,
        code: string,
        instanceId: string,
        index?: number,
      ): Promise<void> => {
        const beforeSnapshot = await gameSnapshot(request, setup.gameId, setup.players[actorIndex]!.token);
        const beforePatchCount = patchCount(audits);
        const beforeRequests = requestCount(audits);
        const actionId = `sprint1-rejected-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const frames = await sendBrowserCommand(pageA!, tickets[actorIndex]!, {
          kind: 'command.v2', gameId: setup.gameId, messageId: actionId, baseVersion: version, clientActionId: actionId, type, payload,
        }, actionId);
        const ack = frames.find((frame) => frame['kind'] === 'command_ack' && frame['clientActionId'] === actionId);
        if (!ack) throw new Error(`Rejected ${type} did not return command_ack: ${JSON.stringify(frames)}`);
        const error = ack['error'] as JsonObject;
        expect(ack['status']).toBe('rejected');
        expect(ack['version']).toBe(version);
        expect(error['code']).toBe(code);
        expect(error['commandType']).toBe(type);
        expect(error['instanceId']).toBe(instanceId);
        if (index !== undefined) expect(error['index']).toBe(index);
        expect(error['retryable']).toBe(false);
        expect(JSON.stringify(error)).not.toMatch(/cardKey|cardRef|printId|imageUris|cardFaces|visibilityIndex|viewerMask/i);
        const afterSnapshot = await gameSnapshot(request, setup.gameId, setup.players[actorIndex]!.token);
        expect(canonicalView(afterSnapshot)).toEqual(canonicalView(beforeSnapshot));
        expect(patchCount(audits)).toBe(beforePatchCount);
        expect(requestCount(audits)).toBe(beforeRequests);
        expect(frames.some((frame) => frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === actionId)).toBe(false);
        expect(frames.some(isLegacyOrRecoveryFrame)).toBe(false);
      };

      // Audience + materialization. Direct browser protocol is required for targeted/multiviewer payloads.
      await accepted(0, 'card.revealed', { playerId: playerA.user.id, instanceId: transition, to: [playerB.user.id] });
      let projected = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      assertMaterialized(projected[1]!, playerA.user.id, 'hand', transition);
      assertNotMaterialized(projected[2]!, playerA.user.id, 'hand', transition);
      expect(zoneCards(projected[0]!, playerA.user.id, 'hand')).toHaveLength(aHand.length);
      expect(zoneCards(projected[1]!, playerA.user.id, 'hand')).toHaveLength(aHand.length);
      expect(zoneCards(projected[2]!, playerA.user.id, 'hand')).toHaveLength(aHand.length);

      await accepted(0, 'card.revealed', { playerId: playerA.user.id, instanceId: transition, to: [playerB.user.id, playerC.user.id] });
      await accepted(0, 'card.revealed', { playerId: playerA.user.id, instanceId: transition, to: [playerB.user.id], revealed: false });
      projected = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      assertNotMaterialized(projected[1]!, playerA.user.id, 'hand', transition);
      assertMaterialized(projected[2]!, playerA.user.id, 'hand', transition);

      await accepted(0, 'card.revealed', { playerId: playerA.user.id, instanceId: revealTargets, to: [playerB.user.id, playerC.user.id] });
      await accepted(0, 'card.revealed', { playerId: playerA.user.id, instanceId: revealAll, to: 'all' });
      projected = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      for (const snapshot of projected) assertMaterialized(snapshot, playerA.user.id, 'hand', revealAll);
      for (const snapshot of projected.slice(1)) assertMaterialized(snapshot, playerA.user.id, 'hand', revealTargets);

      const libraryBeforeReveal = await gameSnapshot(request, setup.gameId, playerA.token);
      const revealedLibrary = zoneIds(libraryBeforeReveal, playerA.user.id, 'library').slice(0, 2);
      if (revealedLibrary.length !== 2) throw new Error('Integrated gate requires two library cards for batch reveal.');
      await accepted(0, 'library.reveal_top', { playerId: playerA.user.id, count: 1, to: [playerB.user.id] });
      projected = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      expect(zoneIds(projected[1]!, playerA.user.id, 'library').slice(0, 1)).toEqual(revealedLibrary.slice(0, 1));
      expect(zoneIds(projected[2]!, playerA.user.id, 'library').slice(0, 1)).not.toEqual(revealedLibrary.slice(0, 1));
      await accepted(0, 'library.reveal_top', { playerId: playerA.user.id, count: 2, to: [playerB.user.id, playerC.user.id] });
      projected = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      expect(zoneIds(projected[1]!, playerA.user.id, 'library').slice(0, 2)).toEqual(revealedLibrary);
      expect(zoneIds(projected[2]!, playerA.user.id, 'library').slice(0, 2)).toEqual(revealedLibrary);
      await accepted(0, 'library.reveal_top', { playerId: playerA.user.id, count: 1, to: 'all' });
      projected = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      expect(zoneIds(projected[1]!, playerA.user.id, 'library').slice(0, 1)).toEqual(revealedLibrary.slice(0, 1));
      expect(zoneIds(projected[2]!, playerA.user.id, 'library').slice(0, 1)).toEqual(revealedLibrary.slice(0, 1));
      expect(zoneIds(projected[1]!, playerA.user.id, 'library')[1]).not.toBe(revealedLibrary[1]);
      expect(zoneIds(projected[2]!, playerA.user.id, 'library')[1]).not.toBe(revealedLibrary[1]);

      // Real product UI path for the common private -> public transition.
      const uiCommandStart = audits[0]!.sent.length;
      const transitionCard = handCard(pageA!, playerA.user.id, transition);
      await expect(transitionCard).toBeVisible({ timeout: 15_000 });
      await moveHandCardToBattlefieldViaMenu(pageA!, playerA.user.id, transitionCard);
      await expect.poll(() => audits[0]!.sent.slice(uiCommandStart).some((frame) =>
        frame['kind'] === 'command.v2' && frame['type'] === 'card.moved'
          && (frame['payload'] as JsonObject | undefined)?.['instanceId'] === transition,
      ), { timeout: 20_000 }).toBe(true);
      const uiCommand = audits[0]!.sent.slice(uiCommandStart).find((frame) => frame['kind'] === 'command.v2'
        && frame['type'] === 'card.moved' && (frame['payload'] as JsonObject | undefined)?.['instanceId'] === transition)!;
      const uiActionId = String(uiCommand['clientActionId'] ?? '');
      const uiPatch = await waitForPatch(audits[0]!.received, uiActionId);
      version = Number(uiPatch['version'] ?? version + 1);
      await expectAllViewerVersion(audits, version);
      await Promise.all(pages.map((page) => expect(battlefieldCard(page, playerA.user.id, transition)).toBeVisible({ timeout: 15_000 })));
      projected = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      for (const snapshot of projected) assertPublicIdentity(findCard(snapshot, transition));

      await accepted(0, 'card.moved', { playerId: playerA.user.id, fromZone: 'battlefield', toZone: 'hand', instanceId: transition });
      projected = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      assertMaterialized(projected[0]!, playerA.user.id, 'hand', transition);
      assertNotMaterialized(projected[1]!, playerA.user.id, 'hand', transition);
      assertNotMaterialized(projected[2]!, playerA.user.id, 'hand', transition);
      expect(await pageB!.locator(cardSelector('hand', playerA.user.id, transition)).count()).toBe(0);
      expect(await pageC!.locator(cardSelector('hand', playerA.user.id, transition)).count()).toBe(0);

      // Public permanent, faceDown batches from hand/library, and safe GameLog projections.
      await accepted(0, 'card.moved', { playerId: playerA.user.id, fromZone: 'hand', toZone: 'battlefield', instanceId: a1 });
      await accepted(0, 'cards.moved', {
        playerId: playerA.user.id, fromZone: 'hand', toZone: 'battlefield', instanceIds: [faceDownA, stackPrivate], faceDown: true,
      });
      const libraryFaceDown = zoneIds(await gameSnapshot(request, setup.gameId, playerA.token), playerA.user.id, 'library').slice(0, 2);
      await accepted(0, 'cards.moved', {
        playerId: playerA.user.id, fromZone: 'library', toZone: 'battlefield', instanceIds: libraryFaceDown, faceDown: true,
      });
      projected = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      for (const id of [faceDownA, stackPrivate, ...libraryFaceDown]) {
        expect(findCard(projected[0]!, id)?.['faceDown']).toBe(true);
        assertHiddenIdentity(findCard(projected[1]!, id));
        assertHiddenIdentity(findCard(projected[2]!, id));
      }
      assertPrivateGameLog(projected[1]!, ownerCardNames(initial[0]!, playerA.user.id, [faceDownA, stackPrivate, ...libraryFaceDown]));
      assertPrivateGameLog(projected[2]!, ownerCardNames(initial[0]!, playerA.user.id, [faceDownA, stackPrivate, ...libraryFaceDown]));

      // Stateful library operations and transient library.view.
      const beforeLibraryOps = await gameSnapshot(request, setup.gameId, playerA.token);
      const reorder = zoneIds(beforeLibraryOps, playerA.user.id, 'library').slice(0, 3);
      await accepted(0, 'library.reorder_top', { playerId: playerA.user.id, instanceIds: [...reorder].reverse() });
      await accepted(0, 'library.move_top', { playerId: playerA.user.id, count: 1, toZone: 'library', position: 'bottom' });
      await accepted(0, 'library.put_top', { playerId: playerA.user.id, instanceId: libraryPutTop });
      await accepted(0, 'library.put_bottom', { playerId: playerA.user.id, instanceId: transition });
      const beforeView = await gameSnapshot(request, setup.gameId, playerA.token);
      await accepted(0, 'library.view', { playerId: playerA.user.id, count: 3 });
      const afterView = await gameSnapshot(request, setup.gameId, playerA.token);
      expect(zoneIds(afterView, playerA.user.id, 'library')).toEqual(zoneIds(beforeView, playerA.user.id, 'library'));
      expect(JSON.stringify(afterView)).not.toMatch(/libraryView|library\.viewed|topViewed/i);
      expect(zoneIds(afterView, playerA.user.id, 'library')[0]).toBe(libraryPutTop);
      expect(zoneIds(afterView, playerA.user.id, 'library').at(-1)).toBe(transition);

      // Stack net state, duplicate retry, private source transition, and dungeon marker isolation.
      await accepted(0, 'stack.card_added', { playerId: playerA.user.id, instanceId: faceDownA, stackId: 'sprint1-stack-a' });
      const stackBActionId = `sprint1-stack-b-${Date.now()}`;
      const stackB = await accepted(0, 'stack.card_added', { playerId: playerA.user.id, instanceId: stackPrivate, stackId: 'sprint1-stack-b' }, stackBActionId);
      const eventAfterStackB = await eventStoreState(setup.gameId);
      const duplicateFrames = await sendBrowserCommand(pageA!, tickets[0]!, {
        kind: 'command.v2', gameId: setup.gameId, messageId: stackBActionId, baseVersion: stackB.baseVersion,
        clientActionId: stackBActionId, type: 'stack.card_added',
        payload: { playerId: playerA.user.id, instanceId: stackPrivate, stackId: 'sprint1-stack-b' },
      }, stackBActionId);
      expect(duplicateFrames.some((frame) => frame['kind'] === 'patch.v2' || (frame['kind'] === 'command_ack' && frame['status'] === 'duplicate'))).toBe(true);
      expect(await eventStoreState(setup.gameId)).toEqual(eventAfterStackB);
      expect(stackIds(await gameSnapshot(request, setup.gameId, playerA.token)).filter((id) => id === 'sprint1-stack-b')).toHaveLength(1);
      await accepted(0, 'stack.item_removed', { playerId: playerA.user.id, stackId: 'sprint1-stack-a' });
      await accepted(0, 'card.moved', { playerId: playerA.user.id, fromZone: 'battlefield', toZone: 'hand', instanceId: stackPrivate });
      projected = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      for (const snapshot of projected) expect(stackIds(snapshot)).toEqual(['sprint1-stack-b']);
      expect(JSON.stringify(projected[1]!['stack'] ?? [])).not.toContain(String(findCard(initial[0]!, stackPrivate)?.['cardKey'] ?? 'private-card-key-not-present'));
      expect(JSON.stringify(projected[2]!['stack'] ?? [])).not.toContain(String(findCard(initial[0]!, stackPrivate)?.['cardKey'] ?? 'private-card-key-not-present'));

      await accepted(0, 'card.dungeon_marker.changed', {
        playerId: playerA.user.id, instanceId: a1, dungeonMarker: { x: 0.17, y: 0.29, unit: 'ratio' },
      });
      await accepted(0, 'card.dungeon_marker.changed', {
        playerId: playerA.user.id, instanceId: a1, dungeonMarker: { x: 0.37, y: 0.61, unit: 'ratio' },
      });
      const markerSnapshot = await gameSnapshot(request, setup.gameId, playerA.token);
      expect(findCard(markerSnapshot, a1)?.['dungeonMarker']).toEqual({ x: 0.37, y: 0.61 });
      expect(findCard(markerSnapshot, a1)?.['counters'] ?? {}).toEqual(findCard(projected[0]!, a1)?.['counters'] ?? {});

      // Controller authority, including faceDown controller and return to the owner's zone.
      await accepted(1, 'card.moved', { playerId: playerB.user.id, fromZone: 'hand', toZone: 'battlefield', instanceId: b1 });
      await accepted(2, 'card.moved', { playerId: playerC.user.id, fromZone: 'hand', toZone: 'battlefield', instanceId: c1 });
      await accepted(1, 'card.controller.changed', { playerId: playerB.user.id, instanceId: b1, targetPlayerId: playerC.user.id });
      await accepted(2, 'card.position.changed', { playerId: playerB.user.id, instanceId: b1, position: { x: 0.31, y: 0.46, unit: 'ratio' } });
      await accepted(2, 'card.tapped', { playerId: playerC.user.id, instanceId: b1, tapped: true });
      await accepted(0, 'card.controller.changed', { playerId: playerA.user.id, instanceId: faceDownA, targetPlayerId: playerC.user.id });
      await accepted(2, 'card.position.changed', { playerId: playerA.user.id, instanceId: faceDownA, position: { x: 0.41, y: 0.52, unit: 'ratio' } });
      projected = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      expect(findCard(projected[0]!, faceDownA)?.['controllerId']).toBe(playerC.user.id);
      expect(findCard(projected[2]!, faceDownA)?.['controllerId']).toBe(playerC.user.id);
      assertHiddenIdentity(findCard(projected[1]!, faceDownA));

      const eventBeforeRejections = await eventStoreState(setup.gameId);
      await rejected(1, 'card.tapped', { playerId: playerB.user.id, instanceId: b1, tapped: false }, 'INSTANCE_NOT_CONTROLLED', b1);
      await rejected(0, 'card.moved', { playerId: playerA.user.id, fromZone: 'battlefield', toZone: 'graveyard', instanceId: c1 }, 'INSTANCE_NOT_CONTROLLED', c1);
      await rejected(0, 'card.position.changed', { playerId: playerA.user.id, instanceId: c1, position: { x: 0.8, y: 0.2, unit: 'ratio' } }, 'INSTANCE_NOT_CONTROLLED', c1);
      await rejected(0, 'cards.moved', {
        playerId: playerA.user.id, fromZone: 'battlefield', toZone: 'graveyard', instanceIds: [a1, c1],
      }, 'MIXED_AUTHORITY_BATCH', c1, 1);
      await rejected(0, 'cards.position.changed', {
        playerId: playerA.user.id,
        positions: [
          { instanceId: a1, position: { x: 0.4, y: 0.4, unit: 'ratio' } },
          { instanceId: c1, position: { x: 0.6, y: 0.6, unit: 'ratio' } },
        ],
      }, 'MIXED_AUTHORITY_BATCH', c1, 1);
      await rejected(0, 'cards.moved', {
        playerId: playerA.user.id, fromZone: 'battlefield', toZone: 'graveyard', instanceIds: [a1, a1],
      }, 'DUPLICATE_INSTANCE', a1, 1);
      await rejected(0, 'cards.moved', {
        playerId: playerA.user.id, fromZone: 'battlefield', toZone: 'graveyard', instanceIds: [a1, 'missing-sprint1-instance'],
      }, 'INSTANCE_NOT_FOUND', 'missing-sprint1-instance', 1);
      await rejected(0, 'cards.moved', {
        playerId: playerA.user.id, fromZone: 'hand', toZone: 'graveyard', instanceIds: [a1],
      }, 'ZONE_MISMATCH', a1, 0);
      for (const [type, payload] of [
        ['card.tapped', { playerId: playerA.user.id, instanceId: c1, tapped: true }],
        ['card.counter.changed', { playerId: playerA.user.id, instanceId: c1, counter: 'charge', value: 3 }],
        ['card.power_toughness.changed', { playerId: playerA.user.id, instanceId: c1, power: 9, toughness: 9 }],
        ['card.face.changed', { playerId: playerA.user.id, instanceId: c1, faceIndex: 1 }],
      ] as const) {
        await rejected(0, type, payload, 'INSTANCE_NOT_CONTROLLED', c1);
      }
      await rejected(0, 'card.moved', {
        playerId: playerA.user.id, fromZone: 'hand', toZone: 'graveyard', instanceId: privateC,
      }, 'INSTANCE_NOT_OWNED', privateC);
      expect(await eventStoreState(setup.gameId)).toEqual(eventBeforeRejections);
      expect(findCard(await gameSnapshot(request, setup.gameId, playerA.token), c1)?.['counters'] ?? {}).not.toHaveProperty('charge');

      await accepted(0, 'card.position.changed', { playerId: playerA.user.id, instanceId: a1, position: { x: 0.27, y: 0.39, unit: 'ratio' } });
      await accepted(2, 'card.moved', { playerId: playerC.user.id, fromZone: 'battlefield', toZone: 'graveyard', instanceId: b1 });
      await accepted(2, 'card.moved', { playerId: playerC.user.id, fromZone: 'battlefield', toZone: 'graveyard', instanceId: faceDownA });

      eventStore = await eventStoreState(setup.gameId);
      expect(eventStore.maxVersion).toBe(version);
      expect(requestCount(audits)).toBe(liveRequestBaseline);
      assertGlobalRealtime(audits);
      await assertNoUnknownCard(pages);

      const liveSnapshots = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      const allowedB = new Set([revealTargets, revealAll, ...revealedLibrary]);
      const allowedC = new Set([revealTargets, revealAll, ...revealedLibrary]);
      assertViewerPrivateAuthorization(liveSnapshots[1]!, liveSnapshots[0]!, playerA.user.id, allowedB);
      assertViewerPrivateAuthorization(liveSnapshots[2]!, liveSnapshots[0]!, playerA.user.id, allowedC);
      assertNoInternalProjectionKeys(liveSnapshots[1]!);
      assertNoInternalProjectionKeys(liveSnapshots[2]!);
      expectedByViewer = liveSnapshots.map(canonicalView);

      // A refresh, B reconnect and C disconnect/reconnect must match the same projected state.
      await pageA!.reload();
      await expect(pageA!.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayer(pageA!, playerA.user.id);

      await pageB!.close();
      const reconnectB = await browser.newContext({ baseURL, storageState: await contexts[1]!.storageState() });
      extraContexts.push(reconnectB);
      await enableFrontendGameplayV2(reconnectB);
      const reconnectPageB = await reconnectB.newPage();
      const reconnectAuditB = createAudit(reconnectPageB, setup.gameId);
      await reconnectPageB.goto(`/games/${setup.gameId}`);
      await expect(reconnectPageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForConnection(reconnectAuditB.received);
      await focusPlayer(reconnectPageB, playerA.user.id);

      await pageC!.close();
      const reconnectC = await browser.newContext({ baseURL, storageState: await contexts[2]!.storageState() });
      extraContexts.push(reconnectC);
      await enableFrontendGameplayV2(reconnectC);
      const reconnectPageC = await reconnectC.newPage();
      const reconnectAuditC = createAudit(reconnectPageC, setup.gameId);
      await reconnectPageC.goto(`/games/${setup.gameId}`);
      await expect(reconnectPageC.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForConnection(reconnectAuditC.received);
      await focusPlayer(reconnectPageC, playerA.user.id);

      const continuitySnapshots = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      continuitySnapshots.forEach((snapshot, index) => expect(canonicalView(snapshot)).toEqual(expectedByViewer[index]));
      assertGlobalRealtime([...audits, reconnectAuditB, reconnectAuditC]);
      await assertNoUnknownCard([pageA!, reconnectPageB, reconnectPageC]);

      const metrics = await runtimeMetrics(request);
      assertRuntimeMetrics(metrics, setup.gameId, true);
      fixtures = {
        a1, transition, revealTargets, revealAll, faceDownA, stackPrivate, libraryPutTop,
        libraryPutBottom: transition, b1, c1, privateC, revealedLibrary,
      };
      expectedEventStore = eventStore;
    } finally {
      await Promise.all([...extraContexts, ...contexts].map((context) => context.close().catch(() => undefined)));
    }
  });

  test('actor restart rebuilds the same authorized views and explicit marker removal', async ({ browser, request, baseURL }) => {
    test.setTimeout(360_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    if (!fixtures || !expectedByViewer || !expectedEventStore) throw new Error('Integrated live phase did not produce restart evidence.');

    await restartRuntime();
    await expect.poll(() => serviceReady(request, RUNTIME_READY_URL), { timeout: 60_000 }).toBe(true);

    const persistedBeforeRestart = await eventStoreState(setup.gameId);
    const lifecycleEvents = await eventTypesAfter(setup.gameId, expectedEventStore.maxVersion);
    expect(lifecycleEvents.every((type) => type === 'disconnect.vote.updated'), lifecycleEvents.join(',')).toBe(true);
    let rebuilt = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
    rebuilt.forEach((snapshot, index) => expect(canonicalView(snapshot)).toEqual({
      ...expectedByViewer[index]!, version: persistedBeforeRestart.maxVersion,
    }));
    expect(await eventStoreState(setup.gameId)).toEqual(persistedBeforeRestart);
    expect(findCard(rebuilt[0]!, fixtures.a1)?.['dungeonMarker']).toEqual({ x: 0.37, y: 0.61 });
    expect(stackIds(rebuilt[0]!)).toEqual(['sprint1-stack-b']);

    const restartRefreshTokens = await Promise.all(setup.players.map((player) => loginRefreshToken(request, player.credentials)));
    const contexts = await Promise.all(setup.players.map((player, index) => browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, player.user, restartRefreshTokens[index]!),
    })));
    await Promise.all(contexts.map(enableFrontendGameplayV2));
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const audits = pages.map((page) => createAudit(page, setup.gameId));
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(audits.map((audit) => waitForConnection(audit.received)));
      await Promise.all(pages.map((page) => focusPlayer(page, setup.players[0].user.id)));
      await expect(handCard(pages[1]!, setup.players[0].user.id, fixtures.revealTargets)).toBeVisible({ timeout: 15_000 });
      await expect(handCard(pages[2]!, setup.players[0].user.id, fixtures.revealTargets)).toBeVisible({ timeout: 15_000 });

      const ticket = await websocketTicket(request, setup.gameId, setup.players[0].token);
      const version = Number(rebuilt[0]!['version'] ?? expectedEventStore.maxVersion);
      const clearId = `sprint1-marker-clear-${Date.now()}`;
      const frames = await sendBrowserCommand(pages[0]!, ticket, {
        kind: 'command.v2', gameId: setup.gameId, messageId: clearId, baseVersion: version, clientActionId: clearId,
        type: 'card.dungeon_marker.changed',
        payload: { playerId: setup.players[0].user.id, instanceId: fixtures.a1, dungeonMarker: null },
      }, clearId);
      const patch = frames.find((frame) => frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === clearId);
      expect(patch).toBeTruthy();
      await expectAllViewerVersion(audits, Number(patch?.['version'] ?? version + 1));
      rebuilt = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      for (const snapshot of rebuilt) expect(findCard(snapshot, fixtures.a1)?.['dungeonMarker'] ?? null).toBeNull();
      assertGlobalRealtime(audits);
      await assertNoUnknownCard(pages);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }

    const clearedEventStore = await eventStoreState(setup.gameId);
    await restartRuntime();
    await expect.poll(() => serviceReady(request, RUNTIME_READY_URL), { timeout: 60_000 }).toBe(true);
    const afterClearRestart = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
    for (const snapshot of afterClearRestart) {
      expect(findCard(snapshot, fixtures.a1)?.['dungeonMarker'] ?? null).toBeNull();
      expect(stackIds(snapshot)).toEqual(['sprint1-stack-b']);
      expect(Number(snapshot['version'])).toBe(clearedEventStore.maxVersion);
    }
    expect(await eventStoreState(setup.gameId)).toEqual(clearedEventStore);
    await assertServicesHealthy(request);
    assertRuntimeMetrics(await runtimeMetrics(request), setup.gameId, false);
  });
});

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<Setup> {
  const players: Player[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `s1-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `Sprint1 ${index + 1} ${runId.slice(-8)}`,
    });
    players.push({
      token: session.token,
      refreshToken: session.refreshToken,
      credentials: session.credentials,
      user: session.user,
      deck,
    });
  }
  const room = await request.post(`${API_BASE_URL}/rooms`, {
    headers: auth(players[0]!.token),
    data: {
      deckId: players[0]!.deck.deckId,
      visibility: 'public',
      name: `Sprint 1 ${runId}`,
      format: 'commander',
      maxPlayers: 3,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectOk(room, 'create Sprint 1 room');
  const roomId = String(((await room.json()) as { room?: { id?: string } }).room?.id ?? '');
  for (const player of players.slice(1)) {
    await expectOk(await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
      headers: auth(player.token), data: { deckId: player.deck.deckId },
    }), 'join Sprint 1 room');
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: auth(players[0]!.token) });
    await expectOk(response, 'load Sprint 1 room');
    const entries = ((await response.json()) as { room?: { players?: Array<{ turnRolls?: number[] }> } }).room?.players ?? [];
    if (entries.length === 3 && entries.every((entry) => entry.turnRolls?.length)
      && new Set(entries.map((entry) => entry.turnRolls?.join('-'))).size === 3) break;
    for (const player of players) {
      const roll = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: auth(player.token) });
      if (!roll.ok() && roll.status() !== 409) await expectOk(roll, 'roll Sprint 1 turn order');
    }
  }
  const start = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: auth(players[0]!.token) });
  await expectOk(start, 'start Sprint 1 room');
  const gameId = String(((await start.json()) as { game?: { id?: string } }).game?.id ?? '');
  if (!gameId || players.length !== 3) throw new Error('Could not create Sprint 1 three-player game.');
  return { gameId, players: players as [Player, Player, Player] };
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: auth(token) });
  await expectOk(response, 'load Sprint 1 snapshot');
  return ((await response.json()) as { game?: { snapshot?: JsonObject } }).game?.snapshot ?? {};
}

async function websocketTicket(request: APIRequestContext, gameId: string, token: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, { headers: auth(token) });
  await expectOk(response, 'create Sprint 1 runtime ticket');
  const payload = (await response.json()) as { websocketUrl?: string; route?: string };
  expect(payload.route).toBe('runtime_ws');
  if (!payload.websocketUrl) throw new Error('Runtime ticket did not include websocketUrl.');
  return payload.websocketUrl;
}

async function loginRefreshToken(
  request: APIRequestContext,
  credentials: RealUserSession['credentials'],
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { email: credentials.email, password: credentials.password },
  });
  await expectOk(response, 'refresh Sprint 1 browser authentication');
  const cookie = response.headers()['set-cookie'] ?? '';
  const match = cookie.match(/commanderzone\.refresh=([^;]+)/);
  if (!match?.[1]) throw new Error('Sprint 1 login did not return refresh cookie.');
  return match[1];
}

async function sendBrowserCommand(page: Page, websocketUrl: string, message: JsonObject, actionId: string): Promise<JsonObject[]> {
  return page.evaluate(({ url, payload, expectedActionId }) => new Promise<JsonObject[]>((resolvePromise, rejectPromise) => {
    const frames: JsonObject[] = [];
    const socket = new WebSocket(url);
    const timeout = window.setTimeout(() => {
      socket.close();
      rejectPromise(new Error(`Timed out waiting for ${expectedActionId}. Frames: ${JSON.stringify(frames)}`));
    }, 20_000);
    const finish = (): void => {
      window.clearTimeout(timeout);
      socket.close();
      resolvePromise(frames);
    };
    socket.onopen = () => socket.send(JSON.stringify(payload));
    socket.onerror = () => {
      window.clearTimeout(timeout);
      rejectPromise(new Error(`Runtime WebSocket failed for ${expectedActionId}.`));
    };
    socket.onmessage = (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as JsonObject;
        frames.push(frame);
        if ((frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === expectedActionId)
          || (frame['kind'] === 'command_ack' && frame['clientActionId'] === expectedActionId)) finish();
      } catch {
        // Ignore non-JSON protocol frames.
      }
    };
  }), { url: websocketUrl, payload: message, expectedActionId: actionId });
}

function createAudit(page: Page, gameId: string): BrowserAudit {
  const audit: BrowserAudit = { received: [], sent: [], bootstrap: 0, snapshot: 0, commandPosts: 0, errors: [] };
  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => {
      const frame = parseFrame(event.payload);
      if (frame) audit.received.push(frame);
    });
    socket.on('framesent', (event) => {
      const frame = parseFrame(event.payload);
      if (frame) audit.sent.push(frame);
    });
  });
  page.on('request', (httpRequest) => {
    if (httpRequest.method() === 'GET' && httpRequest.url().includes(`/games/${gameId}/bootstrap`)) audit.bootstrap += 1;
    if (httpRequest.method() === 'GET' && httpRequest.url().includes(`/games/${gameId}/snapshot`)) audit.snapshot += 1;
    if (httpRequest.method() === 'POST' && /\/games\/[^/]+\/(commands|command)$/.test(httpRequest.url())) audit.commandPosts += 1;
  });
  page.on('console', (message) => {
    if (message.type() === 'error' || /target_not_found|resync_required|patch contract|Unknown Card/i.test(message.text())) audit.errors.push(message.text());
  });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  return audit;
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  try {
    const value = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
  } catch {
    return null;
  }
}

async function waitForConnection(frames: JsonObject[]): Promise<void> {
  await expect.poll(() => frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), { timeout: 30_000 }).toBe(true);
}

async function waitForPatch(frames: JsonObject[], actionId: string): Promise<JsonObject> {
  await expect.poll(() => frames.some((frame) => frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === actionId), { timeout: 20_000 }).toBe(true);
  return frames.find((frame) => frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === actionId)!;
}

async function expectAllViewerVersion(audits: BrowserAudit[], version: number): Promise<void> {
  await Promise.all(audits.map((audit) => expect.poll(
    () => audit.received.some((frame) => frame['kind'] === 'patch.v2' && Number(frame['version']) === version),
    { timeout: 20_000 },
  ).toBe(true)));
}

function requestCount(audits: BrowserAudit[]): number {
  return audits.reduce((sum, audit) => sum + audit.bootstrap + audit.snapshot + audit.commandPosts, 0);
}

function patchCount(audits: BrowserAudit[]): number {
  return audits.reduce((sum, audit) => sum + audit.received.filter((frame) => frame['kind'] === 'patch.v2').length, 0);
}

function isLegacyOrRecoveryFrame(frame: JsonObject): boolean {
  return frame['kind'] === 'game_patch' || frame['kind'] === 'resync_required' || frame['status'] === 'resync_required';
}

function assertGlobalRealtime(audits: BrowserAudit[]): void {
  for (const audit of audits) {
    expect(audit.received.some(isLegacyOrRecoveryFrame)).toBe(false);
    expect(audit.commandPosts).toBe(0);
    expect(JSON.stringify(audit.received)).not.toMatch(/target_not_found|patch_contract_error/i);
    expect(audit.errors.filter((error) => /target_not_found|resync_required|patch contract|Unknown Card/i.test(error))).toEqual([]);
    assertNoInternalProjectionKeys(audit.received);
  }
}

async function assertNoUnknownCard(pages: Page[]): Promise<void> {
  for (const page of pages) expect(await page.getByText(/Unknown Card/i).count()).toBe(0);
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
      const found = cards.find((card) => card['instanceId'] === instanceId);
      if (found) return found;
    }
  }
  return undefined;
}

function stackIds(snapshot: JsonObject): string[] {
  return (Array.isArray(snapshot['stack']) ? snapshot['stack'] as JsonObject[] : [])
    .map((item) => String(item['stackId'] ?? item['id'] ?? ''))
    .filter(Boolean);
}

function assertOwnerPrivateZone(snapshot: JsonObject, ownerId: string, zone: string, expectedIds: string[]): void {
  const cards = zoneCards(snapshot, ownerId, zone);
  expect(cards.map((card) => card['instanceId'])).toEqual(expectedIds);
  for (const card of cards) assertPublicIdentity(card);
}

function assertOpaquePrivateZone(snapshot: JsonObject, ownerId: string, zone: string, realIds: string[]): void {
  const cards = zoneCards(snapshot, ownerId, zone);
  expect(cards).toHaveLength(realIds.length);
  expect(cards.some((card) => realIds.includes(String(card['instanceId'] ?? '')))).toBe(false);
  for (const card of cards) assertPlaceholder(card);
}

function assertMaterialized(snapshot: JsonObject, ownerId: string, zone: string, instanceId: string): void {
  const matches = zoneCards(snapshot, ownerId, zone).filter((card) => card['instanceId'] === instanceId);
  expect(matches).toHaveLength(1);
  assertPublicIdentity(matches[0]);
}

function assertNotMaterialized(snapshot: JsonObject, ownerId: string, zone: string, instanceId: string): void {
  expect(zoneCards(snapshot, ownerId, zone).filter((card) => card['instanceId'] === instanceId)).toHaveLength(0);
}

function assertPublicIdentity(card: JsonObject | undefined): void {
  expect(card).toBeTruthy();
  expect(String(card?.['instanceId'] ?? '')).not.toBe('');
  expect(String(card?.['name'] ?? '')).not.toMatch(/^Hidden card$|Unknown Card/i);
  expect(
    typeof card?.['cardKey'] === 'string'
    || typeof card?.['cardRef'] === 'string'
    || typeof card?.['printId'] === 'string'
    || typeof card?.['scryfallId'] === 'string'
    || (typeof card?.['imageUris'] === 'object' && card?.['imageUris'] !== null),
  ).toBe(true);
}

function assertPlaceholder(card: JsonObject): void {
  expect(String(card['instanceId'] ?? '')).toContain('-hidden-');
  expect(card['cardKey'] ?? '').toBe('');
  expect(card['cardRef'] ?? '').toBe('');
  expect(card['printId'] ?? '').toBe('');
  expect(card['imageUris'] ?? {}).toEqual({});
  expect(card['cardFaces'] ?? []).toEqual([]);
  expect(String(card['name'] ?? '')).not.toMatch(/Unknown Card/i);
}

function assertHiddenIdentity(card: JsonObject | undefined): void {
  expect(card).toBeTruthy();
  expect(card?.['faceDown']).toBe(true);
  expect(card?.['cardKey'] ?? '').toBe('');
  expect(card?.['cardRef'] ?? '').toBe('');
  expect(card?.['printId'] ?? '').toBe('');
  expect(String(card?.['name'] ?? '')).not.toMatch(/Unknown Card/i);
}

function assertViewerPrivateAuthorization(viewer: JsonObject, owner: JsonObject, ownerId: string, allowed: Set<string>): void {
  for (const zone of ['hand', 'library']) {
    const realIds = new Set(zoneIds(owner, ownerId, zone));
    for (const card of zoneCards(viewer, ownerId, zone)) {
      const id = String(card['instanceId'] ?? '');
      if (realIds.has(id)) {
        expect(allowed.has(id), `Unexpected materialized ${zone} card ${id}`).toBe(true);
        assertPublicIdentity(card);
      } else {
        assertPlaceholder(card);
      }
    }
  }
}

function ownerCardNames(snapshot: JsonObject, ownerId: string, ids: string[]): string[] {
  return ids.map((id) => String(findCard(snapshot, id)?.['name'] ?? ''))
    .filter((name) => name !== '' && name !== 'Hidden card');
}

function assertPrivateGameLog(snapshot: JsonObject, privateNames: string[]): void {
  const eventLog = JSON.stringify(snapshot['eventLog'] ?? []);
  for (const name of privateNames) expect(eventLog).not.toContain(name);
}

function assertNoInternalProjectionKeys(value: unknown): void {
  const forbidden = new Set(['visibilityIndex', 'loc', 'viewerMask', 'visibleToMask']);
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node as JsonObject)) {
      expect(forbidden.has(key), `Internal projection key leaked: ${key}`).toBe(false);
      visit(child);
    }
  };
  visit(value);
}

function canonicalView(snapshot: JsonObject): CanonicalView {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const canonicalPlayers: Record<string, JsonObject> = {};
  for (const [playerId, player] of Object.entries(players ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const zones = player['zones'] as Record<string, JsonObject[]> | undefined;
    const canonicalZones: Record<string, JsonObject[]> = {};
    for (const zone of ['hand', 'library', 'battlefield', 'graveyard', 'exile', 'command']) {
      canonicalZones[zone] = (zones?.[zone] ?? []).map(canonicalCard);
    }
    canonicalPlayers[playerId] = {
      handCount: Number(player['handCount'] ?? canonicalZones['hand']!.length),
      libraryCount: Number(player['libraryCount'] ?? canonicalZones['library']!.length),
      zones: canonicalZones,
    };
  }
  return {
    version: Number(snapshot['version'] ?? 0),
    players: canonicalPlayers,
    stack: (Array.isArray(snapshot['stack']) ? snapshot['stack'] as JsonObject[] : []).map(canonicalRecord),
    eventLog: (Array.isArray(snapshot['eventLog']) ? snapshot['eventLog'] as JsonObject[] : []).map(canonicalRecord),
  };
}

function canonicalCard(card: JsonObject): JsonObject {
  return canonicalRecord({
    instanceId: card['instanceId'] ?? '',
    ownerId: card['ownerId'] ?? '',
    controllerId: card['controllerId'] ?? '',
    cardKey: card['cardKey'] ?? '',
    cardRef: card['cardRef'] ?? '',
    printId: card['printId'] ?? '',
    name: card['name'] ?? '',
    faceDown: card['faceDown'] === true,
    tapped: card['tapped'] === true,
    position: card['position'] ?? null,
    counters: card['counters'] ?? {},
    power: card['power'] ?? null,
    toughness: card['toughness'] ?? null,
    faceIndex: card['faceIndex'] ?? null,
    dungeonMarker: card['dungeonMarker'] ?? null,
    revealedTo: card['revealedTo'] ?? [],
  });
}

function canonicalRecord(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function handCard(page: Page, ownerId: string, instanceId: string) {
  return page.locator(cardSelector('hand', ownerId, instanceId));
}

function battlefieldCard(page: Page, ownerId: string, instanceId: string) {
  return page.locator(cardSelector('battlefield', ownerId, instanceId));
}

async function moveHandCardToBattlefieldViaMenu(page: Page, ownerId: string, card: Locator): Promise<void> {
  const handArea = page.locator(`[data-testid="hand-area"][data-player-id="${ownerId}"]`);
  await expect(handArea).toBeVisible({ timeout: 15_000 });
  await expect(handArea).not.toHaveClass(/hand-motion-active/, { timeout: 15_000 });
  await handArea.locator('.hand-hover-strip').hover();
  await expect(handArea).toHaveClass(/hand-revealed/, { timeout: 15_000 });
  await card.click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible({ timeout: 10_000 });
  await menu.getByRole('button', { name: /move to|mover/i }).click();
  await menu.getByRole('menuitem', { name: /battlefield|campo/i }).click();
}

function cardSelector(zone: string, ownerId: string, instanceId: string): string {
  return `[data-testid="game-card"][data-zone="${zone}"][data-owner-player-id="${ownerId}"][data-card-instance-id="${instanceId}"]`;
}

async function focusPlayer(page: Page, playerId: string): Promise<void> {
  await expect(page.getByTestId('player-panel')).toBeVisible({ timeout: 20_000 });
  if (await page.getByTestId('player-panel').getAttribute('data-player-id') === playerId) return;
  const drawerToggle = page.getByTestId('opponents-drawer-toggle');
  if (await drawerToggle.isVisible() && await drawerToggle.getAttribute('aria-expanded') === 'false') {
    await drawerToggle.click();
  }
  const miniBoard = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`);
  await expect(miniBoard).toBeVisible({ timeout: 20_000 });
  await miniBoard.click();
  await expect(page.getByTestId('player-panel')).toHaveAttribute('data-player-id', playerId);
}

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1'));
}

async function eventStoreState(gameId: string): Promise<EventStoreState> {
  if (!/^[0-9a-f-]{36}$/i.test(gameId)) throw new Error(`Unsafe game id for event-store assertion: ${gameId}`);
  const query = `SELECT COUNT(*), COALESCE(MAX(version), 0) FROM game_event WHERE game_id = '${gameId}';`;
  const { stdout } = await execFileAsync('docker', [
    'compose', 'exec', '-T', 'database', 'psql', '-U', 'commanderzone', '-d', 'commanderzone', '-tA', '-F', '|', '-c', query,
  ], { cwd: resolve(process.cwd(), '..'), timeout: 30_000, windowsHide: true });
  const [count, maxVersion] = stdout.trim().split('|').map(Number);
  if (!Number.isFinite(count) || !Number.isFinite(maxVersion)) throw new Error(`Invalid event-store result: ${stdout}`);
  return { count: count!, maxVersion: maxVersion! };
}

async function eventTypesAfter(gameId: string, version: number): Promise<string[]> {
  if (!/^[0-9a-f-]{36}$/i.test(gameId) || !Number.isInteger(version) || version < 0) {
    throw new Error(`Unsafe event-store range: ${gameId}@${version}`);
  }
  const query = `SELECT type FROM game_event WHERE game_id = '${gameId}' AND version > ${version} ORDER BY version;`;
  const { stdout } = await execFileAsync('docker', [
    'compose', 'exec', '-T', 'database', 'psql', '-U', 'commanderzone', '-d', 'commanderzone', '-tA', '-c', query,
  ], { cwd: resolve(process.cwd(), '..'), timeout: 30_000, windowsHide: true });
  return stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

async function runtimeMetrics(request: APIRequestContext): Promise<JsonObject> {
  const response = await request.get(RUNTIME_METRICS_URL);
  await expectOk(response, 'load runtime metrics');
  return await response.json() as JsonObject;
}

function assertRuntimeMetrics(metrics: JsonObject, gameId: string, actorExpected: boolean): void {
  const actors = Array.isArray(metrics['actors']) ? metrics['actors'] as JsonObject[] : [];
  const actor = actors.find((entry) => entry['gameId'] === gameId);
  if (actorExpected) expect(actor, `Missing runtime metrics for ${gameId}`).toBeTruthy();
  if (actor) {
    expect(actor['command.runtime_coverage_percent']).toBe(100);
    expect(actor['command.legacy_fallback_count']).toBe(0);
    expect(actor['command.unsupported_count']).toBe(0);
    expect(actor['actor.queue_full_count']).toBe(0);
    expect(actor['actor.snapshot_post_append_failure_count']).toBe(0);
    expect(actor['actor.version_conflict_count']).toBe(0);
  }
  const gateway = metrics['gateway'] as JsonObject | undefined;
  expect(gateway?.['ReconnectsRequiringSync'] ?? 0).toBe(0);
  expect(gateway?.['PatchReplayResyncCount'] ?? 0).toBe(0);
  const runtime = metrics['runtime'] as JsonObject | undefined;
  expect(runtime?.['command.legacy_fallback_count'] ?? 0).toBe(0);
  expect(runtime?.['command.runtime_coverage_percent'] ?? 100).toBe(100);
}

async function restartRuntime(): Promise<void> {
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], {
    cwd: resolve(process.cwd(), '..'), timeout: 60_000, windowsHide: true,
  });
}

async function assertServicesHealthy(request: APIRequestContext): Promise<void> {
  await Promise.all(SERVICE_URLS.map(async (url) => expect((await request.get(url)).ok(), url).toBe(true)));
}

async function serviceReady(request: APIRequestContext, url: string): Promise<boolean> {
  try {
    return (await request.get(url, { timeout: 5_000 })).ok();
  } catch {
    return false;
  }
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function expectOk(response: APIResponse, action: string): Promise<void> {
  if (!response.ok()) throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
