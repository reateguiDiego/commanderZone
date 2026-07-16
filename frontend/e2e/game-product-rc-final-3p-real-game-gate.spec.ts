import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { focusPlayer, openChat } from './support/game-table';
import { sendRuntimeCommand, type RuntimeWebSocketCommandResult } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const API_HEALTH_URL = process.env['E2E_API_HEALTH_URL'] ?? `${API_BASE_URL}/healthz`;
const API_READY_URL = process.env['E2E_API_READY_URL'] ?? `${API_BASE_URL}/readyz`;
const WEBSOCKET_HEALTH_URL = process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz';
const WEBSOCKET_READY_URL = process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz';
const RUNTIME_HEALTH_URL = process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
const RUNTIME_METRICS_URL = process.env['E2E_GAME_RUNTIME_METRICS_URL'] ?? 'http://127.0.0.1:8091/metrics';
const DISCONNECTED_HEADING = /Jugador desconectado|Player disconnected/i;

type JsonObject = Record<string, unknown>;
type RcFinalPlayer = {
  token: string;
  refreshToken: string;
  user: RealUserSession['user'];
  credentials: RealUserSession['credentials'];
  deck: BasicCommanderDeckFromDatabaseResult;
};
type RcFinalSetup = { gameId: string; roomId: string; players: RcFinalPlayer[] };
type RequestAudit = { bootstrap: number; snapshot: number; commandPosts: number; disconnectVoteHttpFallback: number };

test.describe('rc final 3-player real game regression gate', () => {
  test.describe.configure({ mode: 'serial' });

  test('3-player real game sequence keeps closed RC contracts intact', async ({ browser, request, baseURL }) => {
    test.setTimeout(720_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    await Promise.all([
      assertServiceReady(request, API_HEALTH_URL, 'api healthz'),
      assertServiceReady(request, API_READY_URL, 'api readyz'),
      assertServiceReady(request, WEBSOCKET_HEALTH_URL, 'websocket healthz'),
      assertServiceReady(request, WEBSOCKET_READY_URL, 'websocket readyz'),
      assertServiceReady(request, RUNTIME_HEALTH_URL, 'game-runtime healthz'),
      assertServiceReady(request, RUNTIME_READY_URL, 'game-runtime readyz'),
    ]);

    const setup = await createThreePlayerGame(request, `rcfinal${Date.now().toString(36)}`);
    const [playerA, playerB, playerC] = setup.players;
    if (!playerA || !playerB || !playerC) {
      throw new Error('RC final gate requires exactly 3 players.');
    }

    const { gameId, roomId } = setup;
    const metricsBefore = await runtimeGatewayMetrics(request);
    const requestAudit: RequestAudit = { bootstrap: 0, snapshot: 0, commandPosts: 0, disconnectVoteHttpFallback: 0 };
    const commandFrames: JsonObject[] = [];

    const contextA = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken) });
    const contextB = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken) });
    const contextC = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerC.user, playerC.refreshToken) });
    await Promise.all([contextA, contextB, contextC].map(enableFrontendGameplayV2));

    let reconnectContextB: BrowserContext | null = null;
    let reconnectFramesB: JsonObject[] = [];

    try {
      const [pageA, pageB, pageC] = await Promise.all([contextA.newPage(), contextB.newPage(), contextC.newPage()]);
      const framesA = collectWebSocketFrames(pageA);
      const framesB = collectWebSocketFrames(pageB);
      const framesC = collectWebSocketFrames(pageC);
      for (const page of [pageA, pageB, pageC]) {
        auditProductRequests(page, gameId, requestAudit);
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
        waitForGameplayConnection(framesA),
        waitForGameplayConnection(framesB),
        waitForGameplayConnection(framesC),
      ]);
      await Promise.all([assertNoUnknownCard(pageA), assertNoUnknownCard(pageB), assertNoUnknownCard(pageC)]);

      await expect(pageA.getByTestId('mulligan-overlay')).toBeVisible({ timeout: 30_000 });
      await expect(pageA.getByTestId('mulligan-take')).toBeEnabled({ timeout: 30_000 });
      const takePatch = waitForPatchV2(framesA, (patch) => hasOp(patch, 'mulligan.hand.replace_private'));
      await pageA.getByTestId('mulligan-take').click();
      await takePatch;
      await expect(pageA.locator('.mulligan-card')).toHaveCount(10, { timeout: 15_000 });
      await expect(pageA.locator('.mulligan-card', { hasText: 'Unknown Card' })).toHaveCount(0);

      await keepMulliganViaUi(pageA, framesA);
      await keepMulliganViaUi(pageB, framesB);
      await keepMulliganViaUi(pageC, framesC);
      let baseVersion = await gameVersion(request, gameId, playerA.token);

      await expect.poll(async () => (await gameSnapshot(request, gameId, playerA.token))['gamePhase'], { timeout: 30_000 }).toBe('PLAYING');
      await Promise.all([assertNoUnknownCard(pageA), assertNoUnknownCard(pageB), assertNoUnknownCard(pageC)]);
      await expect(pageA.locator('.table-error')).toHaveCount(0);
      let liveRequestBaseline = requestAudit.bootstrap + requestAudit.snapshot;

      let snapshotA = await gameSnapshot(request, gameId, playerA.token);
      let snapshotB = await gameSnapshot(request, gameId, playerB.token);
      assertOwnerPrivateZoneVisible(snapshotA, playerA.user.id, 'hand', 'es');
      assertPrivateZoneHasNoCardKeys(snapshotB, playerA.user.id, 'hand');
      const initialHandCount = zoneInstanceIds(snapshotA, playerA.user.id, 'hand').length;

      let drawOne = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'library.draw',
        payload: { playerId: playerA.user.id },
      });
      baseVersion = drawOne.version;
      let drawMany = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'library.draw_many',
        payload: { playerId: playerA.user.id, count: 5 },
      });
      baseVersion = drawMany.version;
      expect(hasOp(drawMany.patch, 'zone.cards.add')).toBe(true);
      snapshotA = await gameSnapshot(request, gameId, playerA.token);
      snapshotB = await gameSnapshot(request, gameId, playerB.token);
      expect(zoneInstanceIds(snapshotA, playerA.user.id, 'hand')).toHaveLength(initialHandCount + 6);
      assertOwnerPrivateZoneVisible(snapshotA, playerA.user.id, 'hand', 'es');
      assertPrivateZoneHasNoCardKeys(snapshotB, playerA.user.id, 'hand');
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBe(liveRequestBaseline);

      const handIds = zoneInstanceIds(snapshotA, playerA.user.id, 'hand');
      if (handIds.length < 9) {
        throw new Error(`Expected at least 9 cards in A hand after draws, got ${handIds.length}.`);
      }
      const [explicitId, defaultId, batchOneId, batchTwoId, statefulId, equipmentId, faceDownId, libraryMoveReserveId] = handIds;
      if (!explicitId || !defaultId || !batchOneId || !batchTwoId || !statefulId || !equipmentId || !faceDownId || !libraryMoveReserveId) {
        throw new Error('Failed to allocate hand fixtures for RC final gate.');
      }

      await Promise.all([
        focusPlayerForRcGate(pageA, playerA.user.id, playerA.user.displayName),
        focusPlayerForRcGate(pageB, playerA.user.id, playerA.user.displayName),
        focusPlayerForRcGate(pageC, playerA.user.id, playerA.user.displayName),
      ]);

      const explicitMove = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: explicitId,
          position: { x: 0.33, y: 0.56, unit: 'ratio' },
        },
      });
      baseVersion = explicitMove.version;
      snapshotA = await gameSnapshot(request, gameId, playerA.token);
      snapshotB = await gameSnapshot(request, gameId, playerB.token);
      assertVisibleCardIdentity(zoneCard(snapshotA, playerA.user.id, 'battlefield', explicitId), 'public', 'es');
      assertVisibleCardIdentity(zoneCard(snapshotB, playerA.user.id, 'battlefield', explicitId), 'public', 'en');
      await expect(battlefieldCard(pageB, playerA.user.id, explicitId)).toBeVisible({ timeout: 15_000 });
      await assertCardHasImage(pageB, playerA.user.id, explicitId, 'battlefield');

      const defaultMove = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: { playerId: playerA.user.id, fromZone: 'hand', toZone: 'battlefield', instanceId: defaultId },
      });
      baseVersion = defaultMove.version;
      snapshotA = await gameSnapshot(request, gameId, playerA.token);
      expect(validRuntimePosition(zoneCard(snapshotA, playerA.user.id, 'battlefield', defaultId)['position'] as JsonObject | undefined)).toBe(true);
      const batchMove = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'cards.moved',
        payload: { playerId: playerA.user.id, fromZone: 'hand', toZone: 'battlefield', instanceIds: [batchOneId, batchTwoId] },
      });
      baseVersion = batchMove.version;
      snapshotA = await gameSnapshot(request, gameId, playerA.token);
      const batchPositions = [batchOneId, batchTwoId].map((instanceId) =>
        zoneCard(snapshotA, playerA.user.id, 'battlefield', instanceId)['position'] as JsonObject | undefined
      );
      expect(batchPositions.every(validRuntimePosition)).toBe(true);
      expect(JSON.stringify(batchPositions[0])).not.toBe(JSON.stringify(batchPositions[1]));
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBe(liveRequestBaseline);

      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: statefulId,
          position: { x: 0.48, y: 0.63, unit: 'ratio' },
        },
      })).version;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: equipmentId,
          position: { x: 0.59, y: 0.63, unit: 'ratio' },
        },
      })).version;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.tapped',
        payload: { playerId: playerA.user.id, instanceId: statefulId, tapped: true },
      })).version;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'arrow.created',
        payload: { fromInstanceId: statefulId, toInstanceId: equipmentId, color: 'blue' },
      })).version;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'attachment.created',
        payload: { equipmentInstanceId: equipmentId, attachedToInstanceId: statefulId },
      })).version;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'life.changed',
        payload: { playerId: playerA.user.id, life: 31 },
      })).version;
      const beforeCounter = await gameSnapshot(request, gameId, playerA.token);
      const counterResult = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.counter.changed',
        payload: { playerId: playerA.user.id, instanceId: statefulId, counter: '+1/+1', value: 2 },
      });
      baseVersion = counterResult.version;
      expect(hasOp(counterResult.patch, 'card.counters.patch')).toBe(true);
      assertCounterDidNotMutateState(beforeCounter, await gameSnapshot(request, gameId, playerA.token), playerA.user.id, statefulId, equipmentId);
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBe(liveRequestBaseline);

      const beforeRefreshRequests = requestAudit.bootstrap + requestAudit.snapshot;
      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(framesA);
      await focusPlayerForRcGate(pageA, playerA.user.id, playerA.user.displayName);
      await expect(battlefieldCard(pageA, playerA.user.id, statefulId)).toBeVisible({ timeout: 15_000 });
      await expect.poll(async () => (await battlefieldCard(pageA, playerA.user.id, statefulId).getAttribute('class')) ?? '').toContain('tapped');
      expect(validRuntimePosition(zoneCard(await gameSnapshot(request, gameId, playerA.token), playerA.user.id, 'battlefield', statefulId)['position'] as JsonObject)).toBe(true);
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBeGreaterThan(beforeRefreshRequests);
      liveRequestBaseline = requestAudit.bootstrap + requestAudit.snapshot;

      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.controller.changed',
        payload: { playerId: playerA.user.id, instanceId: statefulId, targetPlayerId: playerB.user.id },
      })).version;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerB.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerB.user.id,
          targetPlayerId: playerB.user.id,
          fromZone: 'battlefield',
          toZone: 'graveyard',
          instanceId: statefulId,
        },
      })).version;
      let afterZoneExit = await gameSnapshot(request, gameId, playerA.token);
      const graveyardCard = zoneCard(afterZoneExit, playerA.user.id, 'graveyard', statefulId);
      expect(zoneInstanceIds(afterZoneExit, playerB.user.id, 'graveyard')).not.toContain(statefulId);
      expect(graveyardCard['ownerId']).toBe(playerA.user.id);
      expect(graveyardCard['controllerId']).toBe(playerA.user.id);
      expect(graveyardCard['tapped']).toBe(false);
      expect(Number(graveyardCard['rotation'] ?? 0)).toBe(0);
      expect(emptyRecordPayload(graveyardCard['counters'])).toBe(true);
      expect(graveyardCard['position'] ?? null).toBeNull();
      expect(relationTouches(afterZoneExit, statefulId)).toBe(false);
      expect(playerLife(afterZoneExit, playerA.user.id)).toBe(31);

      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.controller.changed',
        payload: { playerId: playerA.user.id, instanceId: equipmentId, targetPlayerId: playerB.user.id },
      })).version;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerB.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerB.user.id,
          targetPlayerId: playerB.user.id,
          fromZone: 'battlefield',
          toZone: 'exile',
          instanceId: equipmentId,
        },
      })).version;
      afterZoneExit = await gameSnapshot(request, gameId, playerA.token);
      const exileCard = zoneCard(afterZoneExit, playerA.user.id, 'exile', equipmentId);
      expect(zoneInstanceIds(afterZoneExit, playerB.user.id, 'exile')).not.toContain(equipmentId);
      expect(exileCard['ownerId']).toBe(playerA.user.id);
      expect(exileCard['controllerId']).toBe(playerA.user.id);

      const faceDownMove = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: faceDownId,
          faceDown: true,
          position: { x: 0.43, y: 0.73, unit: 'ratio' },
        },
      });
      baseVersion = faceDownMove.version;
      const faceDownOwnerSnapshot = await gameSnapshot(request, gameId, playerA.token);
      const faceDownRivalSnapshot = await gameSnapshot(request, gameId, playerC.token);
      expect(zoneCard(faceDownOwnerSnapshot, playerA.user.id, 'battlefield', faceDownId)['faceDown']).toBe(true);
      assertHiddenForUnauthorized(zoneCard(faceDownRivalSnapshot, playerA.user.id, 'battlefield', faceDownId));
      await pageC.reload();
      await expect(pageC.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayerForRcGate(pageC, playerA.user.id, playerA.user.displayName);
      assertHiddenForUnauthorized(zoneCard(await gameSnapshot(request, gameId, playerC.token), playerA.user.id, 'battlefield', faceDownId));
      liveRequestBaseline = requestAudit.bootstrap + requestAudit.snapshot;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.face_down.changed',
        payload: { playerId: playerA.user.id, instanceId: faceDownId, faceDown: false },
      })).version;
      assertVisibleCardIdentity(zoneCard(await gameSnapshot(request, gameId, playerC.token), playerA.user.id, 'battlefield', faceDownId), 'public', 'en');

      const libraryBeforeView = await gameSnapshot(request, gameId, playerA.token);
      const viewedLibraryId = zoneInstanceIds(libraryBeforeView, playerA.user.id, 'library')[0];
      if (!viewedLibraryId) {
        throw new Error('Expected at least one library card for view/move validation.');
      }
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'library.view',
        payload: { playerId: playerA.user.id, count: 3 },
      })).version;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: { playerId: playerA.user.id, fromZone: 'library', toZone: 'hand', instanceId: viewedLibraryId },
      })).version;
      const rivalAfterViewMove = await gameSnapshot(request, gameId, playerB.token);
      assertPrivateZoneHasNoCardKeys(rivalAfterViewMove, playerA.user.id, 'library');
      assertPrivateZoneHasNoCardKeys(rivalAfterViewMove, playerA.user.id, 'hand');

      const commander = findCommander(await gameSnapshot(request, gameId, playerA.token), playerA.user.id);
      const commanderId = String(commander['instanceId']);
      const castClientActionId = `rc-final-commander-cast-${Date.now()}`;
      const cast = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'command',
          toZone: 'battlefield',
          instanceId: commanderId,
          position: { x: 0.22, y: 0.32, unit: 'ratio' },
        },
        clientActionId: castClientActionId,
      });
      baseVersion = cast.version;
      expect(commanderCastCount(await gameSnapshot(request, gameId, playerA.token), commanderId)).toBe(1);
      const retryCast = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'command',
          toZone: 'battlefield',
          instanceId: commanderId,
          position: { x: 0.22, y: 0.32, unit: 'ratio' },
        },
        clientActionId: castClientActionId,
      });
      expect(retryCast.version).toBe(baseVersion);
      expect(commanderCastCount(await gameSnapshot(request, gameId, playerA.token), commanderId)).toBe(1);
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.power_toughness.changed',
        payload: { instanceId: commanderId, power: 4, toughness: 5 },
      })).version;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.face.changed',
        payload: { playerId: playerA.user.id, instanceId: commanderId, faceIndex: 1 },
      })).version;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.tapped',
        payload: { playerId: playerA.user.id, instanceId: commanderId, tapped: true },
      })).version;
      let commanderSnapshot = await gameSnapshot(request, gameId, playerA.token);
      const commanderBattlefield = zoneCard(commanderSnapshot, playerA.user.id, 'battlefield', commanderId);
      const commanderOverrides = commanderBattlefield['manualOverrides'] as Record<string, JsonObject>;
      expect(commanderOverrides['0']?.['power']).toBe(4);
      expect(commanderOverrides['0']?.['toughness']).toBe(5);
      expect(commanderBattlefield['power']).toBeNull();
      expect(commanderBattlefield['toughness']).toBeNull();
      expect(commanderBattlefield['activeFaceIndex']).toBe(1);
      expect(commanderBattlefield['tapped']).toBe(true);

      const token = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.token.created',
        payload: {
          playerId: playerA.user.id,
          quantity: 1,
          card: {
            name: 'Runtime Soldier',
            typeLine: 'Token Creature - Soldier',
            power: '1',
            toughness: '1',
            imageUris: { normal: 'https://example.test/runtime-soldier.jpg' },
            oracleText: 'must-not-leak',
            cardFaces: [{ name: 'Runtime Soldier', imageUris: { normal: 'https://example.test/runtime-soldier-face.jpg' } }],
          },
        },
      });
      baseVersion = token.version;
      assertNoStaticPayload(token.patch);
      const tokenId = String(addedCards(token.patch)[0]?.['instanceId'] ?? '');
      expect(tokenId).not.toBe('');
      await expect(battlefieldCard(pageA, playerA.user.id, tokenId)).toBeVisible({ timeout: 15_000 });
      const tokenCopy = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.token_copy.created',
        payload: { playerId: playerA.user.id, instanceId: explicitId, targetPlayerId: playerA.user.id },
      });
      baseVersion = tokenCopy.version;
      assertNoStaticPayload(tokenCopy.patch);
      const tokenCopyId = String(addedCards(tokenCopy.patch)[0]?.['instanceId'] ?? '');
      expect(tokenCopyId).not.toBe('');
      await expect(battlefieldCard(pageB, playerA.user.id, tokenCopyId)).toBeVisible({ timeout: 15_000 });

      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayerForRcGate(pageA, playerA.user.id, playerA.user.displayName);
      commanderSnapshot = await gameSnapshot(request, gameId, playerA.token);
      expect(commanderCastCount(commanderSnapshot, commanderId)).toBe(1);
      expect(zoneCard(commanderSnapshot, playerA.user.id, 'battlefield', commanderId)['activeFaceIndex']).toBe(1);
      expect(zoneCard(commanderSnapshot, playerA.user.id, 'battlefield', commanderId)['tapped']).toBe(true);

      const turnBeforeActivation = await gameSnapshot(request, gameId, playerA.token);
      const currentActiveTurnPlayerId = activePlayerIdFromSnapshot(turnBeforeActivation);
      const currentActiveTurnPlayer = setup.players.find((player) => player.user.id === currentActiveTurnPlayerId) ?? playerA;
      const activeTurnStartIndex = framesA.length;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: currentActiveTurnPlayer.token,
        baseVersion,
        type: 'turn.changed',
        payload: { activePlayerId: playerA.user.id, phase: 'main-1' },
      })).version;
      await waitForNewPatchV2(
        framesA,
        activeTurnStartIndex,
        (patch) => hasOp(patch, 'turn.set') && JSON.stringify(patch).includes(playerA.user.id),
      );
      await expect.poll(async () => {
        return activePlayerIdFromSnapshot(await gameSnapshot(request, gameId, playerA.token));
      }, {
        timeout: 15_000,
      }).toBe(playerA.user.id);
      liveRequestBaseline = requestAudit.bootstrap + requestAudit.snapshot;

      await expect(pageA.getByTestId('pass-turn')).toBeVisible({ timeout: 15_000 });
      await expect(pageA.getByTestId('advance-phase')).toBeVisible({ timeout: 15_000 });
      await expect(pageB.getByTestId('pass-turn')).toHaveCount(0);
      const phaseStartIndex = framesA.length;
      const phasePatch = waitForNewPatchV2(framesA, phaseStartIndex, (patch) => hasOp(patch, 'turn.set'));
      await pageA.getByTestId('advance-phase').click();
      const phaseAfterClick = await phasePatch;
      baseVersion = Math.max(baseVersion, Number(phaseAfterClick['version'] ?? baseVersion));
      const drawDuringTurnStartIndex = framesA.length;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'library.draw',
        payload: { playerId: playerA.user.id },
      })).version;
      await waitForNewPatchV2(
        framesA,
        drawDuringTurnStartIndex,
        (patch) => hasOp(patch, 'zone.cards.add') && Number(patch['version'] ?? 0) >= baseVersion,
      );
      const counterDuringTurnStartIndex = framesA.length;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.counter.changed',
        payload: { playerId: playerA.user.id, instanceId: explicitId, counter: '+1/+1', value: 1 },
      })).version;
      await waitForNewPatchV2(
        framesA,
        counterDuringTurnStartIndex,
        (patch) => hasOp(patch, 'card.counters.patch') && Number(patch['version'] ?? 0) >= baseVersion,
      );
      const passStartIndex = framesA.length;
      const passPatch = waitForNewPatchV2(framesA, passStartIndex, (patch) => hasOp(patch, 'turn.set'));
      await pageA.getByTestId('pass-turn').click();
      const passAfterClick = await passPatch;
      baseVersion = Math.max(baseVersion, Number(passAfterClick['version'] ?? baseVersion));
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBe(liveRequestBaseline);

      await Promise.all([openChat(pageA), openChat(pageB), openChat(pageC)]);
      const chatText = `rc-final-chat-${Date.now()}`;
      const chatPatchPromise = waitForPatchV2(framesB, (patch) => hasOp(patch, 'chat.message.add') && JSON.stringify(patch).includes(chatText));
      await pageA.getByTestId('chat-input').fill(chatText);
      await pageA.getByTestId('chat-send').click();
      const chatPatch = await chatPatchPromise;
      const messageId = firstChatMessageId(chatPatch);
      expect(messageId).not.toBe('');
      await Promise.all([
        expectChatMessage(pageA, playerA.user.displayName, chatText),
        expectChatMessage(pageB, playerA.user.displayName, chatText),
        expectChatMessage(pageC, playerA.user.displayName, chatText),
      ]);
      const reactionPatchPromise = waitForPatchV2(framesA, (patch) => hasOp(patch, 'chat.reaction.set') && JSON.stringify(patch).includes(messageId));
      const messageRowB = pageB.getByTestId('chat-message').filter({ hasText: chatText });
      await messageRowB.hover();
      await messageRowB.getByTestId('chat-reaction').first().click({ force: true });
      await reactionPatchPromise;
      await Promise.all([expectChatReactionCount(pageA, chatText, '1'), expectChatReactionCount(pageC, chatText, '1')]);
      await Promise.all([openLog(pageA), openLog(pageB), openLog(pageC)]);
      await expectLogEntry(pageA, /rob\u00f3 una carta|drew a card/i);
      await expectLogEntry(pageA, /movi\u00f3 una carta|moved a card/i);
      await expectLogEntry(pageA, /gir\u00f3 un permanente|tapped a permanent/i);
      await expectLogEntry(pageA, /\+1\/\+1/i);
      await expectLogEntry(pageA, /ficha|token/i);
      await expectLogEntry(pageA, /comandante|commander/i);
      await expect.poll(() => pageA.getByTestId('game-log-entry').filter({ hasText: /rob\u00f3 una carta|drew a card/i }).count(), { timeout: 10_000 }).toBe(2);

      const beforeDisconnects = await runtimeDisconnects(request);
      const reconnectStorageB = await contextB.storageState();
      await contextB.close();
      await expect(pageA.getByRole('heading', { name: DISCONNECTED_HEADING })).toBeVisible({ timeout: 30_000 });
      await expect(pageC.getByRole('heading', { name: DISCONNECTED_HEADING })).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => runtimeDisconnects(request), { timeout: 30_000 }).toBeGreaterThan(beforeDisconnects);
      await waitForPatchV2(framesA, (patch) => hasOp(patch, 'disconnect.vote.set'));

      reconnectContextB = await browser.newContext({ baseURL, storageState: reconnectStorageB });
      await enableFrontendGameplayV2(reconnectContextB);
      const pageBReconnect = await reconnectContextB.newPage();
      reconnectFramesB = collectWebSocketFrames(pageBReconnect);
      auditProductRequests(pageBReconnect, gameId, requestAudit);
      await pageBReconnect.goto(`/games/${gameId}`);
      await expect(pageBReconnect.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(reconnectFramesB);
      await expect(pageA.getByRole('heading', { name: DISCONNECTED_HEADING })).toBeHidden({ timeout: 30_000 });
      await openChat(pageBReconnect);
      await expectChatMessage(pageBReconnect, playerA.user.displayName, chatText);
      await openLog(pageBReconnect);
      await expectLogEntry(pageBReconnect, /drew a card/i);
      baseVersion = await gameVersion(request, gameId, playerA.token);
      liveRequestBaseline = requestAudit.bootstrap + requestAudit.snapshot;

      const concede = await runRuntime(request, commandFrames, {
        gameId,
        token: playerB.token,
        baseVersion,
        type: 'game.concede',
        payload: { playerId: playerB.user.id },
      });
      baseVersion = concede.version;
      let afterConcede = await gameSnapshot(request, gameId, playerA.token);
      expect(playerStatus(afterConcede, playerB.user.id)).toBe('conceded');
      expect(afterConcede['gamePhase']).not.toBe('FINISHED');
      expect(eventLogHas(afterConcede, 'game.concede')).toBe(true);
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'library.draw',
        payload: { playerId: playerA.user.id },
      })).version;
      const turnAfterConcedeSnapshot = await gameSnapshot(request, gameId, playerA.token);
      const activeAfterConcedeId = activePlayerIdFromSnapshot(turnAfterConcedeSnapshot);
      const activeAfterConcedePlayer = setup.players.find((player) => player.user.id === activeAfterConcedeId) ?? playerA;
      baseVersion = (await runRuntime(request, commandFrames, {
        gameId,
        token: activeAfterConcedePlayer.token,
        baseVersion,
        type: 'turn.changed',
        payload: { activePlayerId: playerC.user.id, phase: 'main-1' },
      })).version;
      afterConcede = await gameSnapshot(request, gameId, playerA.token);
      expect(afterConcede['gamePhase']).not.toBe('FINISHED');
      expect(requestAudit.bootstrap + requestAudit.snapshot).toBe(liveRequestBaseline);

      await pageBReconnect.setViewportSize({ width: 479, height: 359 });
      const leaveResponse = pageBReconnect.waitForResponse((response) =>
        response.request().method() === 'POST' && response.url().includes(`/rooms/${roomId}/leave`),
        { timeout: 30_000 },
      );
      await pageBReconnect.getByTestId('unsupported-resolution-leave-room').click();
      const leaveDialog = pageBReconnect.getByRole('dialog', { name: 'Leave table?' });
      await expect(leaveDialog).toBeVisible({ timeout: 15_000 });
      await leaveDialog.getByRole('button', { name: 'Leave table', exact: true }).click();
      expect((await leaveResponse).ok()).toBe(true);
      await expect(pageBReconnect).toHaveURL(/\/rooms$/, { timeout: 30_000 });
      const afterLeave = await gameSnapshot(request, gameId, playerA.token);
      expect(afterLeave['gamePhase']).not.toBe('FINISHED');
      baseVersion = Math.max(baseVersion, Number(afterLeave['version'] ?? baseVersion));

      const close = await runRuntime(request, commandFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'game.close',
        payload: { requestedBy: playerA.user.id },
      });
      baseVersion = close.version;
      const afterClose = await gameSnapshot(request, gameId, playerA.token);
      expect(afterClose['gamePhase']).toBe('FINISHED');
      void baseVersion;

      const metricsAfter = await runtimeGatewayMetrics(request);
      expect(Number(metricsAfter['chat.snapshot_write_count'] ?? 0)).toBe(0);
      expect(Number(metricsAfter['gamelog.snapshot_write_count'] ?? 0)).toBe(0);
      expect(Number(metricsAfter['chat.message_route'] ?? 0)).toBeGreaterThan(Number(metricsBefore['chat.message_route'] ?? 0));
      expect(Number(metricsAfter['chat.reaction_route'] ?? 0)).toBeGreaterThan(Number(metricsBefore['chat.reaction_route'] ?? 0));
      expect(Number(metricsAfter['gamelog.runtime_route'] ?? 0)).toBeGreaterThan(Number(metricsBefore['gamelog.runtime_route'] ?? 0));
      await Promise.all([
        assertNoUnknownCard(pageA),
        assertNoUnknownCard(pageC),
        assertNoFalseActionToast(pageA),
        assertNoFalseActionToast(pageC),
      ]);
      expect(requestAudit.commandPosts).toBe(0);
      expect(requestAudit.disconnectVoteHttpFallback).toBe(0);
      for (const frames of [framesA, framesB, framesC, reconnectFramesB, commandFrames]) {
        assertNoRuntimeFallbackFrames(frames);
      }
      await Promise.all([
        assertServiceReady(request, API_READY_URL, 'api readyz final'),
        assertServiceReady(request, WEBSOCKET_READY_URL, 'websocket readyz final'),
        assertServiceReady(request, RUNTIME_READY_URL, 'game-runtime readyz final'),
      ]);
    } finally {
      await Promise.all([
        contextA.close().catch(() => undefined),
        contextB.close().catch(() => undefined),
        contextC.close().catch(() => undefined),
        reconnectContextB?.close().catch(() => undefined),
      ]);
    }
  });
});

async function keepMulliganViaUi(page: Page, frames: JsonObject[]): Promise<void> {
  const bottomSelection = page.getByTestId('mulligan-bottom-selection');
  if (!await bottomSelection.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await expect(page.getByTestId('mulligan-keep')).toBeEnabled({ timeout: 15_000 });
    const startIndex = frames.length;
    const firstKeepPatch = waitForNewPatchV2(
      frames,
      startIndex,
      (patch) => hasOp(patch, 'mulligan.bottom.required.set') || hasOp(patch, 'mulligan.status.set') || hasOp(patch, 'mulligan.completed'),
    );
    await page.getByTestId('mulligan-keep').click();
    const patch = await firstKeepPatch;
    if (hasOp(patch, 'mulligan.completed')) {
      return;
    }
    await expect(bottomSelection).toBeVisible({ timeout: 15_000 });
  }
  await selectRequiredBottomCards(page);
  await expect(page.getByTestId('mulligan-keep')).toBeEnabled({ timeout: 15_000 });
  const startIndex = frames.length;
  const keepPatch = waitForNewPatchV2(frames, startIndex, (patch) => hasOp(patch, 'mulligan.status.set') || hasOp(patch, 'mulligan.completed'));
  await page.getByTestId('mulligan-keep').click();
  await keepPatch;
}

async function selectRequiredBottomCards(page: Page): Promise<void> {
  const bottomSelection = page.getByTestId('mulligan-bottom-selection');
  if (!await bottomSelection.isVisible({ timeout: 1_000 }).catch(() => false)) {
    return;
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await page.getByTestId('mulligan-keep').isEnabled().catch(() => false)) {
      return;
    }
    const nextButton = page.locator('.bottom-card-action:not(.selected)').first();
    await expect(nextButton).toBeVisible({ timeout: 5_000 });
    const selectedBefore = await page.getByTestId('mulligan-bottom-pill').count();
    if (await nextButton.isEnabled().catch(() => false)) {
      await nextButton.click();
    } else {
      const nextCard = page.locator('.mulligan-card:not(.bottom-selected) [data-testid="game-card"]').first();
      await expect(nextCard).toBeVisible({ timeout: 5_000 });
      await nextCard.dispatchEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    }
    await expect.poll(() => page.getByTestId('mulligan-bottom-pill').count(), { timeout: 5_000 }).toBeGreaterThan(selectedBefore);
  }
}

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<RcFinalSetup> {
  const players: RcFinalPlayer[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `rcf-${index + 1}-${runId}`);
    await updateUserLanguage(request, session.token, index === 0 ? 'es' : 'en');
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `RCF${index + 1} ${runId.slice(-10)}`,
      includeWhiteDfc: index === 0,
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

async function updateUserLanguage(request: APIRequestContext, token: string, language: 'en' | 'es'): Promise<void> {
  const response = await request.patch(`${API_BASE_URL}/me`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { appLanguage: language, cardLanguage: language },
  });
  await expectApiOk(response, 'update user language');
}

async function createRoom(request: APIRequestContext, token: string, deckId: string, runId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      deckId,
      visibility: 'public',
      name: `RC Final ${runId.slice(-10)}`,
      format: 'commander',
      maxPlayers: 3,
      mulliganRule: 'GENEROUS',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create RC final room');
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
  await expectApiOk(response, 'join RC final room');
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokens[0]}` },
    });
    await expectApiOk(roomResponse, 'load RC final room turn order');
    const payload = await roomResponse.json() as { room?: { players?: Array<{ turnRolls?: number[] }> } };
    if (turnOrderResolved(payload.room?.players ?? [])) {
      return;
    }
    for (const token of tokens) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok() && response.status() !== 409) {
        await expectApiOk(response, 'roll RC final turn order');
      }
    }
  }
  throw new Error('Unable to resolve RC final room turn order.');
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'start RC final room');
  const payload = await response.json() as { game?: { id?: string } };
  if (!payload.game?.id) {
    throw new Error('Room start did not return game.id.');
  }
  return payload.game.id;
}

async function runRuntime(
  request: APIRequestContext,
  frames: JsonObject[],
  options: Parameters<typeof sendRuntimeCommand>[1],
): Promise<RuntimeWebSocketCommandResult> {
  const result = await sendRuntimeCommand(request, options);
  frames.push(...result.frames);
  expect(result.patch['kind']).toBe('patch.v2');
  return result;
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

async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  return Math.max(1, Number((await gameSnapshot(request, gameId, token))['version'] ?? 1));
}

async function runtimeGatewayMetrics(request: APIRequestContext): Promise<JsonObject> {
  const response = await request.get(RUNTIME_METRICS_URL, { timeout: 10_000 });
  await expectApiOk(response, 'load runtime metrics');
  const payload = await response.json() as { gateway?: JsonObject };
  return payload.gateway ?? {};
}

async function runtimeDisconnects(request: APIRequestContext): Promise<number> {
  const metrics = await runtimeGatewayMetrics(request);
  return Number(metrics['RuntimeDisconnects'] ?? 0);
}

async function assertServiceReady(request: APIRequestContext, url: string, service: string): Promise<void> {
  const response = await request.get(url, { timeout: 10_000 });
  if (!response.ok()) {
    throw new Error(`${service} is not ready at ${url}: HTTP ${response.status()} ${await response.text()}`);
  }
}

async function focusPlayerForRcGate(page: Page, playerId: string, displayName: string): Promise<void> {
  if (await page.getByTestId('player-panel').getAttribute('data-player-id').catch(() => null) === playerId) {
    return;
  }

  const byId = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`);
  if (await byId.count() > 0) {
    const drawer = page.getByTestId('opponents-drawer-toggle');
    if (await drawer.isVisible() && await drawer.getAttribute('aria-expanded') !== 'true') {
      await drawer.click();
      await expect(drawer).toHaveAttribute('aria-expanded', 'true');
    }
    await expect(byId.first()).toBeVisible({ timeout: 10_000 });
    await byId.first().click();
    await expect.poll(() => page.getByTestId('player-panel').getAttribute('data-player-id'), { timeout: 10_000 }).toBe(playerId);
    return;
  }

  await focusPlayer(page, displayName);
}

function zoneCards(snapshot: JsonObject, playerId: string, zone: string): JsonObject[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return zones?.[zone] ?? [];
}

function zoneCard(snapshot: JsonObject, playerId: string, zone: string, instanceId: string): JsonObject {
  const card = zoneCards(snapshot, playerId, zone).find((candidate) => candidate['instanceId'] === instanceId);
  if (!card) {
    throw new Error(`Missing ${zone} card ${instanceId} for player ${playerId}.`);
  }
  return card;
}

function zoneInstanceIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  return zoneCards(snapshot, playerId, zone).map((card) => String(card['instanceId'] ?? '')).filter((id) => id !== '');
}

function assertOwnerPrivateZoneVisible(snapshot: JsonObject, playerId: string, zone: string, expectedLanguage: 'en' | 'es'): void {
  const cards = zoneCards(snapshot, playerId, zone);
  expect(cards.length).toBeGreaterThan(0);
  for (const card of cards) {
    assertVisibleCardIdentity(card, 'private', expectedLanguage);
  }
}

function assertPrivateZoneHasNoCardKeys(snapshot: JsonObject, playerId: string, zone: string): void {
  for (const card of zoneCards(snapshot, playerId, zone)) {
    expect(card['cardKey']).toBeUndefined();
    expect(emptyImagePayload(card['imageUris'])).toBe(true);
    expect(emptyArrayPayload(card['cardFaces'])).toBe(true);
  }
}

function assertHiddenForUnauthorized(card: JsonObject): void {
  expect(card['faceDown']).toBe(true);
  expect(card['cardKey']).toBeUndefined();
  expect(emptyImagePayload(card['imageUris'])).toBe(true);
  expect(emptyArrayPayload(card['cardFaces'])).toBe(true);
}

function assertCounterDidNotMutateState(before: JsonObject, after: JsonObject, playerId: string, instanceId: string, relatedId: string): void {
  const previous = zoneCard(before, playerId, 'battlefield', instanceId);
  const current = zoneCard(after, playerId, 'battlefield', instanceId);
  expect(current['position']).toEqual(previous['position']);
  expect(current['tapped']).toBe(previous['tapped']);
  expect(current['rotation']).toBe(previous['rotation']);
  expect(current['faceDown']).toBe(previous['faceDown']);
  expect(current['controllerId']).toBe(previous['controllerId']);
  expect(playerLife(after, playerId)).toBe(playerLife(before, playerId));
  expect(relationTouches(after, instanceId)).toBe(true);
  expect(relationTouches(after, relatedId)).toBe(true);
}

function findCommander(snapshot: JsonObject, playerId: string): JsonObject {
  const commander = zoneCards(snapshot, playerId, 'command').find((card) => card['isCommander'] === true)
    ?? zoneCards(snapshot, playerId, 'command')[0];
  if (!commander) {
    throw new Error(`No commander found for player ${playerId}.`);
  }
  expect(Array.isArray(commander['cardFaces']) && (commander['cardFaces'] as unknown[]).length > 1).toBe(true);
  return commander;
}

function commanderCastCount(snapshot: JsonObject, commanderId: string): number {
  const counters = snapshot['counters'] as JsonObject | undefined;
  const casts = counters?.['commanderCasts'] as Record<string, unknown> | undefined;
  const scoped = counters?.[`commander:${commanderId}`] as JsonObject | undefined;
  return Number(scoped?.['casts'] ?? casts?.[commanderId] ?? 0);
}

function activePlayerIdFromSnapshot(snapshot: JsonObject): string {
  const turn = snapshot['turn'];
  return String(turn !== null && typeof turn === 'object' && !Array.isArray(turn)
    ? (turn as JsonObject)['activePlayerId'] ?? ''
    : '');
}

function playerStatus(snapshot: JsonObject, playerId: string): string {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  return String(players?.[playerId]?.['status'] ?? 'active');
}

function eventLogHas(snapshot: JsonObject, type: string): boolean {
  const entries = Array.isArray(snapshot['eventLog']) ? snapshot['eventLog'] as JsonObject[] : [];
  return entries.some((entry) => entry['type'] === type);
}

function playerLife(snapshot: JsonObject, playerId: string): number {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  return Number(players?.[playerId]?.['life']);
}

function relationTouches(snapshot: JsonObject, instanceId: string): boolean {
  const arrows = Array.isArray(snapshot['arrows']) ? snapshot['arrows'] as JsonObject[] : [];
  const attachments = Array.isArray(snapshot['attachments']) ? snapshot['attachments'] as JsonObject[] : [];
  return arrows.some((arrow) => arrow['fromInstanceId'] === instanceId || arrow['toInstanceId'] === instanceId)
    || attachments.some((attachment) => attachment['equipmentInstanceId'] === instanceId || attachment['attachedToInstanceId'] === instanceId);
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.find((item) => item['op'] === op) ?? null;
}

function hasOp(message: JsonObject, op: string): boolean {
  return operation(message, op) !== null;
}

function addedCards(message: JsonObject): JsonObject[] {
  const op = operation(message, 'zone.cards.add');
  return Array.isArray(op?.['cards']) ? op['cards'] as JsonObject[] : [];
}

function movedCard(message: JsonObject): JsonObject | null {
  const card = operation(message, 'zone.cards.move')?.['card'];
  return card !== null && typeof card === 'object' && !Array.isArray(card) ? card as JsonObject : null;
}

function movedOrAddedCard(message: JsonObject, instanceId: string): JsonObject | null {
  const moved = movedCard(message);
  if (moved?.['instanceId'] === instanceId) {
    return moved;
  }
  return addedCards(message).find((card) => card['instanceId'] === instanceId) ?? null;
}

function batchMoveCards(message: JsonObject): JsonObject[] {
  const op = operation(message, 'zone.cards.batchMove');
  return Array.isArray(op?.['cards']) ? op['cards'] as JsonObject[] : [];
}

function latestPatchWithCard(frames: JsonObject[], instanceId: string): JsonObject {
  const patch = frames
    .filter((message) => message['kind'] === 'patch.v2' && JSON.stringify(message).includes(instanceId))
    .at(-1);
  if (!patch) {
    throw new Error(`No patch.v2 found for card ${instanceId}. Recent frames: ${JSON.stringify(frames.slice(-8), null, 2)}`);
  }
  return patch;
}

function firstChatMessageId(patch: JsonObject): string {
  const message = operation(patch, 'chat.message.add')?.['message'] as JsonObject | undefined;
  return String(message?.['id'] ?? '');
}

function assertVisibleCardIdentity(card: JsonObject | null, expectedVisibility: 'private' | 'public', expectedLanguage?: 'en' | 'es'): void {
  expect(card).toBeTruthy();
  expect(String(card?.['name'] ?? '')).not.toBe('Unknown Card');
  expect(
    Boolean(card?.['cardKey'])
      || Boolean(card?.['scryfallId'])
      || Boolean(card?.['name'])
      || !emptyImagePayload(card?.['imageUris']),
  ).toBe(true);
  if (card?.['viewerVisibility'] !== undefined) {
    expect(card?.['viewerVisibility']).toBe(expectedVisibility);
  }
  if (expectedLanguage && card?.['language'] !== undefined) {
    expect(card?.['language']).toBe(expectedLanguage);
  }
}

function assertNoStaticPayload(message: JsonObject): void {
  const encoded = JSON.stringify(message);
  expect(encoded).not.toContain('oracleText');
  expect(encoded).not.toContain('must-not-leak');
  for (const card of [...addedCards(message), movedCard(message)].filter((item): item is JsonObject => item !== null)) {
    expect(card).not.toHaveProperty('imageUris');
    expect(card).not.toHaveProperty('oracleText');
    expect(card).not.toHaveProperty('cardFaces');
  }
}

function validRuntimePosition(position: JsonObject | undefined): boolean {
  if (!position) {
    return false;
  }
  const x = Number(position['x']);
  const y = Number(position['y']);
  return Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0 && !(x === 0 && y === 0);
}

function emptyImagePayload(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

function emptyArrayPayload(value: unknown): boolean {
  return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
}

function emptyRecordPayload(value: unknown): boolean {
  return value === undefined
    || value === null
    || (Array.isArray(value) && value.length === 0)
    || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

function battlefieldCard(page: Page, ownerPlayerId: string, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`);
}

async function assertCardHasImage(page: Page, ownerPlayerId: string, instanceId: string, zone: 'hand' | 'battlefield'): Promise<void> {
  const image = page.locator(`[data-testid="game-card"][data-zone="${zone}"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"] img`).first();
  await expect(image).toBeVisible({ timeout: 15_000 });
  const src = await image.getAttribute('src');
  expect(src ?? '').not.toBe('');
  expect(src ?? '').not.toContain('facedown_card');
}

async function openLog(page: Page): Promise<void> {
  const logTab = page.getByTestId('game-log-open');
  await expect(logTab).toBeVisible();
  await logTab.click();
  await expect(page.getByTestId('game-log-panel')).toBeVisible();
}

async function expectChatMessage(page: Page, displayName: string, message: string): Promise<void> {
  await expect(page.getByTestId('chat-message').filter({ hasText: displayName }).filter({ hasText: message })).toBeVisible({ timeout: 15_000 });
}

async function expectChatReactionCount(page: Page, message: string, count: string): Promise<void> {
  const row = page.getByTestId('chat-message').filter({ hasText: message });
  await expect(row.locator('.chat-reaction-pill').filter({ hasText: count })).toBeVisible({ timeout: 15_000 });
}

async function expectLogEntry(page: Page, text: RegExp): Promise<void> {
  await expect(page.getByTestId('game-log-entry').filter({ hasText: text }).first()).toBeVisible({ timeout: 20_000 });
}

async function assertNoUnknownCard(page: Page): Promise<void> {
  await expect(page.locator('body')).not.toContainText('Unknown Card', { timeout: 5_000 });
}

async function assertNoFalseActionToast(page: Page): Promise<void> {
  await expect(page.locator('.table-error', { hasText: /failed|could not|error/i })).toHaveCount(0);
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
  return waitForNewPatchV2(frames, 0, predicate);
}

function waitForNewPatchV2(frames: JsonObject[], startIndex: number, predicate: (message: JsonObject) => boolean): Promise<JsonObject> {
  return expect.poll(() => {
    const recent = frames.slice(startIndex);
    const patch = recent.find((message) => message['kind'] === 'patch.v2' && predicate(message));
    if (patch) {
      return 'patch';
    }
    if (recent.some((message) => message['kind'] === 'game_patch')) {
      return 'legacy';
    }
    if (recent.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')) {
      return 'resync';
    }
    if (recent.some((message) => message['kind'] === 'command_ack' && message['status'] === 'rejected')) {
      return 'rejected';
    }
    return null;
  }, {
    timeout: 30_000,
  }).toBe('patch').then(() => {
    const patch = frames.slice(startIndex).find((message) => message['kind'] === 'patch.v2' && predicate(message));
    if (!patch) {
      throw new Error(`patch.v2 frame was not captured. Recent frames: ${JSON.stringify(frames.slice(-8), null, 2)}`);
    }
    return patch;
  });
}

function auditProductRequests(page: Page, gameId: string, audit: RequestAudit): void {
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'GET' && url.includes(`/games/${gameId}/bootstrap`)) {
      audit.bootstrap += 1;
    }
    if (request.method() === 'GET' && url.includes(`/games/${gameId}/snapshot`)) {
      audit.snapshot += 1;
    }
    if (request.method() === 'POST' && url.includes(`/games/${gameId}/commands`)) {
      audit.commandPosts += 1;
    }
    if (request.method() === 'POST' && url.includes(`/games/${gameId}/disconnect-vote`)) {
      audit.disconnectVoteHttpFallback += 1;
    }
  });
}

function assertNoRuntimeFallbackFrames(frames: JsonObject[]): void {
  expect(frames.some((message) => message['kind'] === 'game_patch')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'command_failed')).toBe(false);
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
