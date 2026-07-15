import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase } from './support/decks';
import { focusPlayer } from './support/game-table';

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
const ZOOM_STORAGE_KEY = 'commanderZone.gameTable.battlefieldZoomPercent';

type JsonObject = Record<string, unknown>;
type Setup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;
type BrowserAudit = { frames: JsonObject[]; recoveryRequests: number; errors: string[] };
type RatioPosition = { x: number; y: number; unit: 'ratio' };
type SpatialRestartState = { version: number; controlledId: string; positions: Record<string, RatioPosition> };
type ManualPlayer = Awaited<ReturnType<typeof createRealUserSession>> & {
  deck: { deckId: string };
};
type ManualSetup = { gameId: string; players: [ManualPlayer, ManualPlayer, ManualPlayer] };

test.describe('canonical spatial coordinates cross-viewer gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: Setup;
  let restartState: SpatialRestartState;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertServicesReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `spatial${Date.now().toString(36)}`,
      playerAPrefix: 'spa',
      playerBPrefix: 'spb',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('three isolated viewers preserve logical geometry through zoom, resize, rejection, controller change and reconnect', async ({ browser, request, baseURL }) => {
    test.setTimeout(600_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const { gameId, playerA, playerB } = setup;
    const initial = await gameSnapshot(request, gameId, playerA.token);
    const handIds = zoneIds(initial, playerA.user.id, 'hand');
    if (handIds.length < 4) throw new Error(`Spatial gate needs four hand cards, got ${handIds.length}.`);
    const cardIds = handIds.slice(0, 4);
    const [topLeftId, topRightId, bottomLeftId, bottomRightId] = cardIds;
    const grid: Record<string, RatioPosition> = {
      [topLeftId!]: ratio(0.12, 0.18),
      [topRightId!]: ratio(0.62, 0.18),
      [bottomLeftId!]: ratio(0.12, 0.68),
      [bottomRightId!]: ratio(0.62, 0.68),
    };

    const playerCRefreshToken = await loginRefreshToken(request, playerB.credentials);

    const contextA = await spatialContext(browser, baseURL, playerA, { width: 1440, height: 900 }, 100);
    let contextB = await spatialContext(browser, baseURL, playerB, { width: 800, height: 700 }, 70);
    const contextC = await spatialContext(
      browser,
      baseURL,
      { ...playerB, refreshToken: playerCRefreshToken },
      { width: 1920, height: 1080 },
      140,
    );
    const allContexts: BrowserContext[] = [contextA, contextB, contextC];
    try {
      const pageA = await contextA.newPage();
      let pageB = await contextB.newPage();
      const pageC = await contextC.newPage();
      const pages = [pageA, pageB, pageC];
      const audits = pages.map((page) => createAudit(page, gameId));
      await Promise.all(pages.map((page) => page.goto(`/games/${gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(audits.map((audit) => waitForConnection(audit.frames)));
      await Promise.all(pages.map((page) => focusSpatialPlayer(page, playerA.user.id, playerA.user.displayName)));
      const recoveryBaseline = audits.reduce((sum, audit) => sum + audit.recoveryRequests, 0);
      const ticketA = await websocketTicket(request, gameId, playerA.token);
      const ticketB = await websocketTicket(request, gameId, playerB.token);
      let version = Number(initial['version'] ?? 1);

      const accepted = async (ticket: string, type: string, payload: JsonObject): Promise<JsonObject> => {
        const result = await sendAcceptedCommand(pageA, ticket, gameId, version, type, payload);
        version = Number(result['version'] ?? version + 1);
        await Promise.all(audits.map((audit) => expect.poll(
          () => audit.frames.find((frame) => frame['kind'] === 'patch.v2' && Number(frame['version']) === version) ?? null,
          { timeout: 20_000 },
        ).not.toBeNull()));
        return result;
      };

      for (const [index, instanceId] of cardIds.entries()) {
        const moved = await accepted(ticketA, 'card.moved', {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId,
          position: grid[instanceId],
          ...(index === 3 ? { faceDown: true } : {}),
        });
        const move = operation(moved, 'zone.cards.move');
        expect((move?.['card'] as JsonObject | undefined)?.['position']).toEqual(grid[instanceId]);
      }

      const batch = await accepted(ticketA, 'cards.position.changed', {
        playerId: playerA.user.id,
        zone: 'battlefield',
        positions: cardIds.map((instanceId) => ({ instanceId, position: grid[instanceId] })),
      });
      const batchOp = operation(batch, 'cards.position.set');
      expect(batchOp?.['effectVersion']).toBe(1);
      expect(batchOp?.['positions']).toEqual(cardIds.map((instanceId) => ({ instanceId, position: grid[instanceId] })));
      expect(JSON.stringify(batchOp)).not.toMatch(/viewport|zoom|devicePixelRatio|pointer|offset|width/i);

      await Promise.all(pages.flatMap((page) => cardIds.map((instanceId) =>
        expect(battlefieldCard(page, playerA.user.id, instanceId)).toBeVisible({ timeout: 20_000 }),
      )));
      await assertRenderedGrid(pages, playerA.user.id, grid);
      await assertViewerRatios(request, setup, cardIds, grid, version);

      const beforeLocalGeometryChanges = positionsFromSnapshot(await gameSnapshot(request, gameId, playerA.token), cardIds);
      await pageB.setViewportSize({ width: 1024, height: 760 });
      await setBattlefieldZoom(pageC, 120);
      await assertRenderedGrid([pageB, pageC], playerA.user.id, grid);
      expect(positionsFromSnapshot(await gameSnapshot(request, gameId, playerA.token), cardIds)).toEqual(beforeLocalGeometryChanges);
      expect(await pageB.evaluate((key) => window.localStorage.getItem(key), ZOOM_STORAGE_KEY)).toBe('70');
      expect(await pageC.evaluate((key) => window.localStorage.getItem(key), ZOOM_STORAGE_KEY)).toBe('120');

      const singlePosition = ratio(0.23, 0.31);
      const single = await accepted(ticketA, 'card.position.changed', {
        playerId: playerA.user.id,
        zone: 'battlefield',
        instanceId: topLeftId,
        position: singlePosition,
      });
      expect(operation(single, 'card.position.set')).toMatchObject({
        effectVersion: 1,
        instanceId: topLeftId,
        position: singlePosition,
      });
      grid[topLeftId!] = singlePosition;

      const batchPositions = {
        [topRightId!]: ratio(0.55, 0.28),
        [bottomLeftId!]: ratio(0.18, 0.72),
      };
      await accepted(ticketA, 'cards.position.changed', {
        playerId: playerA.user.id,
        zone: 'battlefield',
        positions: [topRightId, bottomLeftId].map((instanceId) => ({ instanceId, position: batchPositions[instanceId!] })),
      });
      Object.assign(grid, batchPositions);
      await assertViewerRatios(request, setup, cardIds, grid, version);

      const beforeRejected = await gameSnapshot(request, gameId, playerA.token);
      const pagePatchCount = audits.reduce((sum, audit) => sum + patchCount(audit.frames), 0);
      const rejected = await sendRejectedCommand(pageB, ticketB, gameId, version, 'card.position.changed', {
        playerId: playerA.user.id,
        zone: 'battlefield',
        instanceId: topRightId,
        position: ratio(0.9, 0.9),
      });
      expect(rejected['status']).toBe('rejected');
      expect(rejected['version']).toBe(version);
      expect((rejected['error'] as JsonObject)['code']).toBe('INSTANCE_NOT_CONTROLLED');
      expect(JSON.stringify(rejected['error'])).not.toMatch(/cardKey|cardRef|printId|name|secret/i);
      const afterRejected = await gameSnapshot(request, gameId, playerA.token);
      expect(afterRejected['version']).toBe(beforeRejected['version']);
      expect(positionsFromSnapshot(afterRejected, cardIds)).toEqual(positionsFromSnapshot(beforeRejected, cardIds));
      expect(zoneIds(afterRejected, playerA.user.id, 'battlefield')).toEqual(zoneIds(beforeRejected, playerA.user.id, 'battlefield'));
      expect((afterRejected['eventLog'] as unknown[] | undefined)?.length ?? 0).toBe(
        (beforeRejected['eventLog'] as unknown[] | undefined)?.length ?? 0,
      );
      expect(audits.reduce((sum, audit) => sum + patchCount(audit.frames), 0)).toBe(pagePatchCount);

      const faceDownBefore = findCard(beforeRejected, bottomRightId!)?.['position'];
      expect(findCard(await gameSnapshot(request, gameId, playerA.token), bottomRightId!)?.['faceDown']).toBe(true);
      const rivalFaceDown = findCard(await gameSnapshot(request, gameId, playerB.token), bottomRightId!);
      expect(rivalFaceDown?.['position']).toEqual(faceDownBefore);
      expect(rivalFaceDown?.['cardKey']).toBeUndefined();
      expect(emptyRecord(rivalFaceDown?.['imageUris'])).toBe(true);

      const beforeControllerPosition = findCard(await gameSnapshot(request, gameId, playerA.token), topLeftId!)?.['position'];
      await accepted(ticketA, 'card.controller.changed', {
        playerId: playerA.user.id,
        instanceId: topLeftId,
        targetPlayerId: playerB.user.id,
      });
      expect(findCard(await gameSnapshot(request, gameId, playerA.token), topLeftId!)?.['position']).toEqual(beforeControllerPosition);

      const controlledPosition = ratio(0.41, 0.57);
      await accepted(ticketB, 'card.position.changed', {
        playerId: playerA.user.id,
        zone: 'battlefield',
        instanceId: topLeftId,
        position: controlledPosition,
      });
      grid[topLeftId!] = controlledPosition;
      const ownerRejected = await sendRejectedCommand(pageA, ticketA, gameId, version, 'card.position.changed', {
        playerId: playerA.user.id,
        zone: 'battlefield',
        instanceId: topLeftId,
        position: ratio(0.8, 0.8),
      });
      expect((ownerRejected['error'] as JsonObject)['code']).toBe('INSTANCE_NOT_CONTROLLED');
      expect(ownerRejected['version']).toBe(version);

      const beforeRefresh = positionsFromSnapshot(await gameSnapshot(request, gameId, playerA.token), cardIds);
      const refreshBaseline = audits[0]!.recoveryRequests;
      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      expect(audits[0]!.recoveryRequests).toBeGreaterThan(refreshBaseline);
      expect(positionsFromSnapshot(await gameSnapshot(request, gameId, playerA.token), cardIds)).toEqual(beforeRefresh);

      await contextB.close();
      allContexts.splice(allContexts.indexOf(contextB), 1);
      contextB = await spatialContext(
        browser,
        baseURL,
        { ...playerB, refreshToken: await loginRefreshToken(request, playerB.credentials) },
        { width: 1024, height: 760 },
        70,
      );
      allContexts.push(contextB);
      pageB = await contextB.newPage();
      const reconnectAudit = createAudit(pageB, gameId);
      audits.push(reconnectAudit);
      await pageB.goto(`/games/${gameId}`);
      await expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForConnection(reconnectAudit.frames);
      expect(positionsFromSnapshot(await gameSnapshot(request, gameId, playerB.token), cardIds)).toEqual(beforeRefresh);
      expect(audits.reduce((sum, audit) => sum + audit.recoveryRequests, 0)).toBeGreaterThanOrEqual(recoveryBaseline + 2);
      assertNoLegacyRecovery(audits);
      const persisted = await gameSnapshot(request, gameId, playerA.token);
      expect(containsForbiddenSpatialKey(persisted)).toBe(false);
      restartState = { version, controlledId: topLeftId!, positions: positionsFromSnapshot(persisted, cardIds) };
    } finally {
      await Promise.all(allContexts.map((context) => context.close().catch(() => undefined)));
    }
  });

  test('actor restart replays exact ratios and accepts a later canonical movement', async ({ browser, request, baseURL }) => {
    test.setTimeout(180_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    await restartRuntime();
    await expect.poll(async () => {
      try {
        return (await request.get(SERVICE_URLS[5]!, { timeout: 10_000 })).ok();
      } catch {
        return false;
      }
    }, { timeout: 60_000 }).toBe(true);
    const before = await gameSnapshot(request, setup.gameId, setup.playerA.token);
    expect(before['version']).toBe(restartState.version);
    expect(positionsFromSnapshot(before, Object.keys(restartState.positions))).toEqual(restartState.positions);
    expect(containsForbiddenSpatialKey(before)).toBe(false);

    const ticketB = await websocketTicket(request, setup.gameId, setup.playerB.token);
    const context = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      await page.goto('about:blank');
      const finalPosition = ratio(0.46, 0.52);
      const patch = await sendAcceptedCommand(
        page,
        ticketB,
        setup.gameId,
        restartState.version,
        'card.position.changed',
        {
          playerId: setup.playerA.user.id,
          zone: 'battlefield',
          instanceId: restartState.controlledId,
          position: finalPosition,
        },
      );
      expect(Number(patch['version'])).toBe(restartState.version + 1);
      const after = await gameSnapshot(request, setup.gameId, setup.playerA.token);
      expect(findCard(after, restartState.controlledId)?.['position']).toEqual(finalPosition);
    } finally {
      await context.close();
    }
    await assertServicesReady(request);
  });

  test('manual headed browser zoom keeps shared ratios stable at 80, 100, 125 and 150 percent', async ({ browser, request, baseURL }) => {
    test.skip(process.env['E2E_MANUAL_BROWSER_ZOOM'] !== '1', 'Run headed with E2E_MANUAL_BROWSER_ZOOM=1 for native browser zoom QA.');
    test.setTimeout(20 * 60_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const manual = await createManualThreePlayerGame(request, `spatialzoom${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, manual.gameId, manual.players);
    const [playerA, playerB, playerC] = manual.players;
    const contextA = await spatialContext(browser, baseURL, playerA, { width: 1440, height: 900 }, 100);
    const contextB = await spatialContext(browser, baseURL, playerB, { width: 800, height: 700 }, 70);
    let contextC = await spatialContext(browser, baseURL, playerC, { width: 1920, height: 1080 }, 140);
    const contexts: BrowserContext[] = [contextA, contextB, contextC];
    try {
      let pageA = await contextA.newPage();
      let pageB = await contextB.newPage();
      let pageC = await contextC.newPage();
      let auditA = createAudit(pageA, manual.gameId);
      let auditB = createAudit(pageB, manual.gameId);
      let auditC = createAudit(pageC, manual.gameId);
      const allAudits: BrowserAudit[] = [auditA, auditB, auditC];
      const sentCommands: JsonObject[] = [];
      captureSentCommands(pageA, sentCommands);
      captureSentCommands(pageB, sentCommands);
      captureSentCommands(pageC, sentCommands);
      await Promise.all([pageA, pageB, pageC].map((page) => page.goto(`/games/${manual.gameId}`)));
      await Promise.all([pageA, pageB, pageC].map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all([auditA, auditB, auditC].map((audit) => waitForConnection(audit.frames)));
      await Promise.all([pageA, pageB, pageC].map((page) => focusSpatialPlayer(page, playerA.user.id, playerA.user.displayName)));

      let tickets = await Promise.all(manual.players.map((player) => websocketTicket(request, manual.gameId, player.token)));
      let current = await gameSnapshot(request, manual.gameId, playerA.token);
      let version = Number(current['version'] ?? 1);
      const accepted = async (actorIndex: 0 | 1 | 2, type: string, payload: JsonObject): Promise<JsonObject> => {
        const pages = [pageA, pageB, pageC];
        const patch = await sendAcceptedCommand(pages[actorIndex]!, tickets[actorIndex]!, manual.gameId, version, type, payload);
        version = Number(patch['version'] ?? version + 1);
        await Promise.all([auditA, auditB, auditC].map((audit) => expect.poll(
          () => audit.frames.find((frame) => frame['kind'] === 'patch.v2' && Number(frame['version']) === version) ?? null,
          { timeout: 20_000 },
        ).not.toBeNull()));
        return patch;
      };

      const battlefieldSources = [
        ...zoneIds(current, playerA.user.id, 'hand').map((instanceId) => ({ instanceId, fromZone: 'hand' })),
        ...zoneIds(current, playerA.user.id, 'library').map((instanceId) => ({ instanceId, fromZone: 'library' })),
      ].slice(0, 8);
      const singleNonLand = zoneIds(current, playerA.user.id, 'command')[0];
      expect(singleNonLand).toBeTruthy();
      const sources = [...battlefieldSources, { instanceId: singleNonLand!, fromZone: 'command' }];
      expect(sources).toHaveLength(9);
      const [gridTopLeft, gridTopRight, gridBottomLeft, gridBottomRight, cornerTopLeft, cornerTopRight, cornerBottomLeft, cornerBottomRight] = sources.map((source) => source.instanceId);
      const positions: Record<string, RatioPosition> = {
        [gridTopLeft!]: ratio(0.22, 0.25),
        [gridTopRight!]: ratio(0.42, 0.25),
        [gridBottomLeft!]: ratio(0.22, 0.55),
        [gridBottomRight!]: ratio(0.42, 0.58),
        [cornerTopLeft!]: ratio(0.12, 0.12),
        [cornerTopRight!]: ratio(0.88, 0.12),
        [cornerBottomLeft!]: ratio(0.12, 0.88),
        [cornerBottomRight!]: ratio(0.88, 0.88),
        [singleNonLand!]: ratio(0.74, 0.48),
      };
      const instanceIds = Object.keys(positions);
      for (const [index, source] of sources.entries()) {
        const patch = await accepted(0, 'card.moved', {
          playerId: playerA.user.id,
          fromZone: source.fromZone,
          toZone: 'battlefield',
          instanceId: source.instanceId,
          position: positions[source.instanceId],
          ...(source.instanceId === cornerBottomRight ? { faceDown: true } : {}),
        });
        expect((operation(patch, 'zone.cards.move')?.['card'] as JsonObject | undefined)?.['position']).toEqual(positions[source.instanceId]);
        expect(index).toBeLessThan(9);
      }

      await Promise.all([pageA, pageB, pageC].flatMap((page) => instanceIds.map((instanceId) =>
        expect(battlefieldCard(page, playerA.user.id, instanceId)).toBeVisible({ timeout: 20_000 }),
      )));
      await assertRenderedGrid([pageA, pageB, pageC], playerA.user.id, positions);
      await assertThreeViewerRatios(request, manual, instanceIds, positions, version);
      await test.info().attach('initial-ratios.json', {
        body: Buffer.from(JSON.stringify({ version, positions }, null, 2)),
        contentType: 'application/json',
      });

      await markSpatialQaWindow(pageA, 'baseline-100');
      await pageA.bringToFront();
      const baselineDeviceScale = await pageA.evaluate(() => window.devicePixelRatio);
      const zoomMatrix = [80, 100, 125, 150] as const;
      const battlefieldZoomMatrix = [70, 100, 140] as const;
      const matrixResults: Array<{ browserZoom: number; battlefieldZoom: number; dpr: number; result: 'PASS' }> = [];
      const singleTargets = [ratio(0.55, 0.5), ratio(0.3, 0.03), ratio(1, 0.68), ratio(0.7, 1)];
      let singleId = singleNonLand!;
      const singleCandidates = [singleNonLand!];
      const batchIds = [gridTopRight!, gridBottomLeft!, gridBottomRight!];
      const batchBaseline = Object.fromEntries(batchIds.map((instanceId) => [instanceId, positions[instanceId]!]));
      const controlledTransferId = gridTopLeft!;

      for (const browserZoom of zoomMatrix) {
        await markSpatialQaWindow(pageA, `zoom-${browserZoom}`);
        await pageA.bringToFront();
        console.log(`NATIVE_ZOOM_ACTION zoom=${browserZoom}: set Chromium page zoom to ${browserZoom}% in browser chrome and inspect the headed page.`);
        await expect.poll(
          () => pageA.evaluate((baseline) => window.devicePixelRatio / baseline, baselineDeviceScale),
          { timeout: 180_000 },
        ).toBeCloseTo(browserZoom / 100, 2);
        const dpr = await pageA.evaluate(() => window.devicePixelRatio);

        for (const battlefieldZoom of battlefieldZoomMatrix) {
          const positionCommandBaseline = spatialCommands(sentCommands).length;
          const before = positionsFromSnapshot(await gameSnapshot(request, manual.gameId, playerA.token), instanceIds);
          await setBattlefieldZoom(pageA, battlefieldZoom);
          await assertRenderedGrid([pageA, pageB, pageC], playerA.user.id, positions);
          await Promise.all([pageA, pageB, pageC].map((page) => assertVisualSpatialBounds(page, playerA.user.id, instanceIds)));
          await assertThreeViewerRatios(request, manual, instanceIds, positions, version);
          expect(positionsFromSnapshot(await gameSnapshot(request, manual.gameId, playerA.token), instanceIds)).toEqual(before);
          expect(spatialCommands(sentCommands)).toHaveLength(positionCommandBaseline);
          await test.info().attach(`browser-${browserZoom}-battlefield-${battlefieldZoom}.png`, {
            body: await pageA.screenshot(),
            contentType: 'image/png',
          });
          matrixResults.push({ browserZoom, battlefieldZoom, dpr, result: 'PASS' });
        }

        await keepViewerWindowsActive([pageB, pageC, pageA]);
        await expect(pageA.getByRole('heading', { name: /Player disconnected|Jugador desconectado/i })).toHaveCount(0);
        await setBattlefieldZoom(pageA, 100);
        await pageA.keyboard.press('Escape');
        await Promise.all(instanceIds.map((instanceId) => expect(battlefieldCard(pageA, playerA.user.id, instanceId)).not.toHaveClass(/selected/)));
        singleId = await unstackedSingleCard(pageA, playerA.user.id, singleCandidates);
        for (const target of singleTargets) {
          const command = await dragAndWaitForSpatialCommand(
            pageA,
            sentCommands,
            playerA.user.id,
            singleId,
            target,
            'card.position.changed',
          );
          assertCanonicalSpatialCommand(command, 'card.position.changed');
          const payload = command['payload'] as JsonObject;
          positions[singleId] = payload['position'] as RatioPosition;
          version += 1;
          await waitForSnapshotVersion(request, manual.gameId, playerA.token, version);
          await assertPatchForCommand([auditA, auditB, auditC], command, version, 'card.position.set');
          await assertThreeViewerRatios(request, manual, instanceIds, positions, version);
          await assertRenderedGrid([pageA, pageB, pageC], playerA.user.id, positions);
        }

        if (browserZoom === 80 || browserZoom === 125 || browserZoom === 150) {
          const beforeBatch = Object.fromEntries(batchIds.map((instanceId) => [instanceId, positions[instanceId]!]));
          for (const instanceId of batchIds) {
            await battlefieldCard(pageA, playerA.user.id, instanceId).click({ modifiers: ['Shift'] });
          }
          for (const instanceId of batchIds) {
            await expect(battlefieldCard(pageA, playerA.user.id, instanceId)).toHaveClass(/selected/);
          }
          const command = await dragAndWaitForSpatialCommand(
            pageA,
            sentCommands,
            playerA.user.id,
            batchIds[0]!,
            ratio(browserZoom === 125 ? 0.4 : browserZoom === 150 ? 0.5 : 0.45, 1),
            'cards.position.changed',
          );
          assertCanonicalSpatialCommand(command, 'cards.position.changed');
          const payloadPositions = ((command['payload'] as JsonObject)['positions'] as Array<{ instanceId: string; position: RatioPosition }>);
          expect(payloadPositions.map((item) => item.instanceId)).toEqual(batchIds);
          const afterBatch = Object.fromEntries(payloadPositions.map((item) => [item.instanceId, item.position]));
          assertInternalDistancesPreserved(beforeBatch, afterBatch, batchIds);
          Object.assign(positions, afterBatch);
          version += 1;
          await waitForSnapshotVersion(request, manual.gameId, playerA.token, version);
          await assertPatchForCommand([auditA, auditB, auditC], command, version, 'cards.position.set');
          await assertThreeViewerRatios(request, manual, instanceIds, positions, version);
          await assertRenderedGrid([pageA, pageB, pageC], playerA.user.id, positions);
          await pageA.keyboard.press('Escape');
          await Promise.all(batchIds.map((instanceId) => expect(battlefieldCard(pageA, playerA.user.id, instanceId)).not.toHaveClass(/selected/)));
          if (browserZoom !== 150) {
            await accepted(0, 'cards.position.changed', {
              playerId: playerA.user.id,
              zone: 'battlefield',
              positions: batchIds.map((instanceId) => ({ instanceId, position: batchBaseline[instanceId] })),
            });
            Object.assign(positions, batchBaseline);
            await assertThreeViewerRatios(request, manual, instanceIds, positions, version);
            await assertRenderedGrid([pageA, pageB, pageC], playerA.user.id, positions);
          }
        }

        if (browserZoom === 125) {
          await setBattlefieldZoom(pageA, 140);
          const continuityBaseline = positionsFromSnapshot(await gameSnapshot(request, manual.gameId, playerA.token), instanceIds);
          const commandBaseline = spatialCommands(sentCommands).length;
          await pageA.setViewportSize({ width: 1180, height: 760 });
          await assertRenderedGrid([pageA], playerA.user.id, positions);
          await pageA.setViewportSize({ width: 1440, height: 900 });
          await assertRenderedGrid([pageA], playerA.user.id, positions);
          expect(spatialCommands(sentCommands)).toHaveLength(commandBaseline);
          expect(positionsFromSnapshot(await gameSnapshot(request, manual.gameId, playerA.token), instanceIds)).toEqual(continuityBaseline);

          await pageA.reload();
          await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
          await focusSpatialPlayer(pageA, playerA.user.id, playerA.user.displayName);
          expect(await pageA.evaluate((key) => window.localStorage.getItem(key), ZOOM_STORAGE_KEY)).toBe('140');

          await pageB.close();
          pageB = await contextB.newPage();
          auditB = createAudit(pageB, manual.gameId);
          allAudits.push(auditB);
          captureSentCommands(pageB, sentCommands);
          await pageB.goto(`/games/${manual.gameId}`);
          await expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
          await waitForConnection(auditB.frames);
          await focusSpatialPlayer(pageB, playerA.user.id, playerA.user.displayName);

          const oldContextC = contextC;
          await oldContextC.close();
          contexts.splice(contexts.indexOf(oldContextC), 1);
          const reopenedPlayerC = {
            ...playerC,
            refreshToken: await loginRefreshToken(request, playerC.credentials),
          };
          contextC = await spatialContext(browser, baseURL, reopenedPlayerC, { width: 1920, height: 1080 }, 140);
          contexts.push(contextC);
          pageC = await contextC.newPage();
          auditC = createAudit(pageC, manual.gameId);
          allAudits.push(auditC);
          captureSentCommands(pageC, sentCommands);
          await pageC.goto(`/games/${manual.gameId}`);
          await expect(pageC.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
          await waitForConnection(auditC.frames);
          await focusSpatialPlayer(pageC, playerA.user.id, playerA.user.displayName);
          await Promise.all([pageA, pageB].map(closeDisconnectVoteModalIfPresent));
          tickets = await Promise.all(manual.players.map((player) => websocketTicket(request, manual.gameId, player.token)));
          version = Number((await gameSnapshot(request, manual.gameId, playerA.token))['version']);
          await assertThreeViewerRatios(request, manual, instanceIds, positions, version);
          await assertRenderedGrid([pageA, pageB, pageC], playerA.user.id, positions);

          const beforeController = positions[controlledTransferId]!;
          await accepted(0, 'card.controller.changed', {
            playerId: playerA.user.id,
            instanceId: controlledTransferId,
            targetPlayerId: playerB.user.id,
          });
          expect(findCard(await gameSnapshot(request, manual.gameId, playerA.token), controlledTransferId)?.['position']).toEqual(beforeController);
          const transferredPosition = ratio(0.75, 0.45);
          await accepted(1, 'card.position.changed', {
            playerId: playerA.user.id,
            zone: 'battlefield',
            instanceId: controlledTransferId,
            position: transferredPosition,
          });
          positions[controlledTransferId] = transferredPosition;

          const beforeOwnerRejection = await gameSnapshot(request, manual.gameId, playerA.token);
          const ownerRejection = await sendRejectedCommand(pageA, tickets[0]!, manual.gameId, version, 'card.position.changed', {
            playerId: playerA.user.id,
            zone: 'battlefield',
            instanceId: controlledTransferId,
            position: ratio(0.9, 0.9),
          });
          expect((ownerRejection['error'] as JsonObject)['code']).toBe('INSTANCE_NOT_CONTROLLED');
          const mixedBatch = await sendRejectedCommand(pageA, tickets[0]!, manual.gameId, version, 'cards.position.changed', {
            playerId: playerA.user.id,
            zone: 'battlefield',
            positions: [
              { instanceId: batchIds[0], position: ratio(0.1, 0.1) },
              { instanceId: controlledTransferId, position: ratio(0.9, 0.9) },
            ],
          });
          expect((mixedBatch['error'] as JsonObject)['code']).toBe('MIXED_AUTHORITY_BATCH');
          const afterOwnerRejection = await gameSnapshot(request, manual.gameId, playerA.token);
          expect(afterOwnerRejection['version']).toBe(beforeOwnerRejection['version']);
          expect(positionsFromSnapshot(afterOwnerRejection, instanceIds)).toEqual(positionsFromSnapshot(beforeOwnerRejection, instanceIds));
          expect(findCard(afterOwnerRejection, controlledTransferId)?.['controllerId']).toBe(playerB.user.id);
          await assertFaceDownProjection(request, manual, cornerBottomRight!);
        }

        if (browserZoom === 150) {
          const ratioBeforeRefresh = positions[singleId]!;
          await pageA.reload();
          await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
          await focusSpatialPlayer(pageA, playerA.user.id, playerA.user.displayName);
          expect(findCard(await gameSnapshot(request, manual.gameId, playerA.token), singleId)?.['position']).toEqual(ratioBeforeRefresh);
          await assertFaceDownProjection(request, manual, cornerBottomRight!);

          const beforeRestart = await gameSnapshot(request, manual.gameId, playerA.token);
          const restartVersion = Number(beforeRestart['version']);
          const restartPositions = positionsFromSnapshot(beforeRestart, instanceIds);
          await restartRuntime();
          await expect.poll(async () => {
            try {
              return (await request.get(SERVICE_URLS[5]!, { timeout: 10_000 })).ok();
            } catch {
              return false;
            }
          }, { timeout: 60_000 }).toBe(true);
          const afterRestart = await gameSnapshot(request, manual.gameId, playerA.token);
          expect(afterRestart['version']).toBe(restartVersion);
          expect(positionsFromSnapshot(afterRestart, instanceIds)).toEqual(restartPositions);
          expect(findCard(afterRestart, controlledTransferId)?.['controllerId']).toBe(playerB.user.id);
          expect(findCard(afterRestart, cornerBottomRight!)?.['faceDown']).toBe(true);

          const postRestartPosition = ratio(0.47, 0.53);
          tickets[0] = await websocketTicket(request, manual.gameId, playerA.token);
          await accepted(0, 'card.position.changed', {
            playerId: playerA.user.id,
            zone: 'battlefield',
            instanceId: singleId,
            position: postRestartPosition,
          });
          positions[singleId] = postRestartPosition;
          await assertThreeViewerRatios(request, manual, instanceIds, positions, version);
          assertNoLegacyRecovery(allAudits);
        }
      }

      for (const command of spatialCommands(sentCommands)) {
        assertCanonicalSpatialCommand(command, String(command['type']) as 'card.position.changed' | 'cards.position.changed');
      }
      const bootstrap = await gameBootstrap(request, manual.gameId, playerA.token);
      expect(Number(bootstrap['version'])).toBe(version);
      expect(positionsFromSnapshot(bootstrap, instanceIds)).toEqual(positions);
      expect(containsForbiddenSpatialKey(bootstrap)).toBe(false);
      await test.info().attach('real-browser-zoom-results.json', {
        body: Buffer.from(JSON.stringify({ matrixResults, finalVersion: version, positions }, null, 2)),
        contentType: 'application/json',
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function spatialContext(
  browser: Browser,
  baseURL: string,
  player: Setup['playerA'],
  viewport: { width: number; height: number },
  zoom: number,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL,
    viewport,
    storageState: authStorageState(baseURL, player.user, player.refreshToken),
  });
  await context.addInitScript(({ zoomStorageKey, zoomPercent }) => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
    if (window.localStorage.getItem(zoomStorageKey) === null) {
      window.localStorage.setItem(zoomStorageKey, String(zoomPercent));
    }
  }, { zoomStorageKey: ZOOM_STORAGE_KEY, zoomPercent: zoom });
  return context;
}

async function createManualThreePlayerGame(request: APIRequestContext, runId: string): Promise<ManualSetup> {
  const players: ManualPlayer[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `sz-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `SZ${index + 1} ${runId.slice(-8)}`,
    });
    players.push({ ...session, deck });
  }

  const create = await request.post(`${API_BASE_URL}/rooms`, {
    headers: bearer(players[0]!.token),
    data: {
      deckId: players[0]!.deck.deckId,
      visibility: 'public',
      name: `Spatial browser zoom ${runId}`,
      format: 'commander',
      maxPlayers: 3,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(create, 'create spatial browser zoom room');
  const roomId = String(((await create.json()) as { room?: { id?: string } }).room?.id ?? '');
  expect(roomId).not.toBe('');

  for (const player of players.slice(1)) {
    await expectApiOk(await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
      headers: bearer(player.token),
      data: { deckId: player.deck.deckId },
    }), 'join spatial browser zoom room');
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const room = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: bearer(players[0]!.token) });
    await expectApiOk(room, 'load spatial browser zoom room');
    const entries = ((await room.json()) as { room?: { players?: Array<{ turnRolls?: number[] }> } }).room?.players ?? [];
    if (entries.length === 3
      && entries.every((entry) => Array.isArray(entry.turnRolls) && entry.turnRolls.length > 0)
      && new Set(entries.map((entry) => entry.turnRolls!.join('-'))).size === 3) {
      break;
    }
    for (const player of players) {
      const roll = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: bearer(player.token) });
      if (!roll.ok() && roll.status() !== 409) await expectApiOk(roll, 'roll spatial browser zoom turn order');
    }
  }

  const start = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: bearer(players[0]!.token) });
  await expectApiOk(start, 'start spatial browser zoom room');
  const gameId = String(((await start.json()) as { game?: { id?: string } }).game?.id ?? '');
  expect(gameId).not.toBe('');
  return { gameId, players: players as [ManualPlayer, ManualPlayer, ManualPlayer] };
}

function captureSentCommands(page: Page, commands: JsonObject[]): void {
  page.on('websocket', (socket) => socket.on('framesent', (event) => {
    try {
      const frame = JSON.parse(typeof event.payload === 'string' ? event.payload : event.payload.toString('utf8')) as JsonObject;
      if (frame['kind'] === 'command.v2') commands.push(frame);
    } catch {
      // Ignore non-JSON frames.
    }
  }));
}

function spatialCommands(commands: JsonObject[]): JsonObject[] {
  return commands.filter((command) => command['type'] === 'card.position.changed' || command['type'] === 'cards.position.changed');
}

async function markSpatialQaWindow(page: Page, stage: string): Promise<void> {
  await page.evaluate((label) => { document.title = `CZ Spatial QA A ${label}`; }, stage);
}

async function keepViewerWindowsActive(pages: Page[]): Promise<void> {
  for (const page of pages) await page.bringToFront();
}

async function unstackedSingleCard(page: Page, playerId: string, instanceIds: string[]): Promise<string> {
  for (const instanceId of instanceIds) {
    const card = battlefieldCard(page, playerId, instanceId);
    if (await card.isVisible().catch(() => false) && !await card.evaluate((element) => element.classList.contains('land-stack-card'))) {
      return instanceId;
    }
  }
  throw new Error('No unstacked battlefield card is available for the single-drag QA scenario.');
}

async function closeDisconnectVoteModalIfPresent(page: Page): Promise<void> {
  const modal = page.locator('app-game-disconnect-vote-modal');
  const heading = modal.getByRole('heading', { name: /Player disconnected|Jugador desconectado/i });
  if (await heading.isVisible().catch(() => false)) {
    await modal.getByRole('button', { name: /Close|Cerrar/i }).click({ timeout: 5_000 });
    await expect(heading).toHaveCount(0);
  }
}

async function dragAndWaitForSpatialCommand(
  page: Page,
  sentCommands: JsonObject[],
  playerId: string,
  instanceId: string,
  target: RatioPosition,
  expectedType: 'card.position.changed' | 'cards.position.changed',
): Promise<JsonObject> {
  const baseline = spatialCommands(sentCommands).length;
  await dragBattlefieldCardToRatio(page, playerId, instanceId, target);
  await expect.poll(() => spatialCommands(sentCommands).length, { timeout: 20_000 }).toBe(baseline + 1);
  const command = spatialCommands(sentCommands)[baseline];
  expect(command?.['type'], `Unexpected spatial command: ${JSON.stringify(command)}`).toBe(expectedType);
  return command!;
}

async function dragBattlefieldCardToRatio(
  page: Page,
  playerId: string,
  instanceId: string,
  target: RatioPosition,
): Promise<void> {
  const card = battlefieldCard(page, playerId, instanceId);
  const battlefield = page.locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"]`);
  const cardBox = await card.boundingBox();
  const pointerOffset = await card.evaluate((element) => {
    const cardElement = element as HTMLElement;
    const rect = cardElement.getBoundingClientRect();
    const offsets = [0.5, 0.35, 0.65, 0.2, 0.8];
    for (const offsetY of offsets) {
      for (const offsetX of offsets) {
        const hit = document.elementFromPoint(rect.left + rect.width * offsetX, rect.top + rect.height * offsetY);
        if (hit === cardElement || (hit instanceof Node && cardElement.contains(hit))) {
          return { x: rect.width * offsetX, y: rect.height * offsetY };
        }
      }
    }
    throw new Error(`Card ${cardElement.dataset['cardInstanceId'] ?? 'unknown'} has no clickable interior point.`);
  });
  const content = await battlefield.evaluate((element) => {
    const root = element as HTMLElement;
    const rect = root.getBoundingClientRect();
    const style = window.getComputedStyle(root);
    const paddingLeft = Number.parseFloat(style.paddingLeft);
    const paddingRight = Number.parseFloat(style.paddingRight);
    const paddingTop = Number.parseFloat(style.paddingTop);
    const paddingBottom = Number.parseFloat(style.paddingBottom);
    return {
      left: rect.left + paddingLeft,
      top: rect.top + paddingTop,
      width: root.clientWidth - paddingLeft - paddingRight,
      height: root.clientHeight - paddingTop - paddingBottom,
    };
  });
  if (!cardBox) throw new Error(`Card ${instanceId} has no rendered bounding box.`);
  const pointerOffsetX = pointerOffset.x;
  const pointerOffsetY = pointerOffset.y;
  const endX = content.left + target.x * Math.max(1, content.width - cardBox.width) + pointerOffsetX;
  const endY = content.top + target.y * Math.max(1, content.height - cardBox.height) + pointerOffsetY;
  await page.mouse.move(cardBox.x + pointerOffsetX, cardBox.y + pointerOffsetY);
  await page.mouse.down();
  await page.mouse.move((cardBox.x + pointerOffsetX + endX) / 2, (cardBox.y + pointerOffsetY + endY) / 2, { steps: 8 });
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();
}

function assertCanonicalSpatialCommand(
  command: JsonObject,
  expectedType: 'card.position.changed' | 'cards.position.changed',
): void {
  expect(command['kind']).toBe('command.v2');
  expect(command['type']).toBe(expectedType);
  const payload = command['payload'] as JsonObject;
  expect(containsForbiddenSpatialKey(payload)).toBe(false);
  expect(containsForbiddenWriteKey(payload)).toBe(false);
  if (expectedType === 'card.position.changed') {
    assertCanonicalRatio(payload['position']);
    return;
  }
  const positions = payload['positions'];
  expect(Array.isArray(positions)).toBe(true);
  expect((positions as JsonObject[]).length).toBeGreaterThan(1);
  for (const item of positions as JsonObject[]) {
    expect(Object.keys(item).sort()).toEqual(['instanceId', 'position']);
    expect(typeof item['instanceId']).toBe('string');
    assertCanonicalRatio(item['position']);
  }
}

function assertCanonicalRatio(value: unknown): asserts value is RatioPosition {
  expect(value && typeof value === 'object' && !Array.isArray(value)).toBe(true);
  const position = value as JsonObject;
  expect(Object.keys(position).sort()).toEqual(['unit', 'x', 'y']);
  expect(position['unit']).toBe('ratio');
  expect(typeof position['x']).toBe('number');
  expect(typeof position['y']).toBe('number');
  expect(Number.isFinite(position['x']) && Number(position['x']) >= 0 && Number(position['x']) <= 1).toBe(true);
  expect(Number.isFinite(position['y']) && Number(position['y']) >= 0 && Number(position['y']) <= 1).toBe(true);
}

function containsForbiddenWriteKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenWriteKey);
  if (!value || typeof value !== 'object') return false;
  const forbidden = /^(px|viewport|browserZoom|battlefieldZoom|zoom|zoomPercent|devicePixelRatio|rawPointer|domOffset|offsetX|offsetY|cardWidth|cardHeight)$/i;
  return Object.entries(value as JsonObject).some(([key, child]) => forbidden.test(key) || containsForbiddenWriteKey(child));
}

async function assertPatchForCommand(
  audits: BrowserAudit[],
  command: JsonObject,
  version: number,
  expectedOp: 'card.position.set' | 'cards.position.set',
): Promise<void> {
  const actionId = String(command['clientActionId'] ?? '');
  expect(actionId).not.toBe('');
  await Promise.all(audits.map(async (audit) => {
    await expect.poll(() => audit.frames.find((frame) => frame['kind'] === 'patch.v2'
      && frame['ackClientActionId'] === actionId
      && Number(frame['version']) === version) ?? null, { timeout: 20_000 }).not.toBeNull();
    const patch = audit.frames.find((frame) => frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === actionId)!;
    expect(operation(patch, expectedOp)?.['effectVersion']).toBe(1);
    expect(containsForbiddenSpatialKey(patch)).toBe(false);
  }));
}

async function waitForSnapshotVersion(
  request: APIRequestContext,
  gameId: string,
  token: string,
  version: number,
): Promise<void> {
  await expect.poll(async () => Number((await gameSnapshot(request, gameId, token))['version']), { timeout: 20_000 }).toBe(version);
}

async function assertThreeViewerRatios(
  request: APIRequestContext,
  setup: ManualSetup,
  instanceIds: string[],
  expected: Record<string, RatioPosition>,
  version: number,
): Promise<void> {
  const snapshots = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
  for (const snapshot of snapshots) {
    expect(snapshot['version']).toBe(version);
    expect(positionsFromSnapshot(snapshot, instanceIds)).toEqual(expected);
  }
}

async function assertVisualSpatialBounds(page: Page, playerId: string, instanceIds: string[]): Promise<void> {
  await page.mouse.move(1, 1);
  if (await page.locator('app-card-preview-overlay').count() > 0) {
    let contextMenuOpened = false;
    for (const instanceId of instanceIds) {
      try {
        await battlefieldCard(page, playerId, instanceId).click({ button: 'right', timeout: 1_500 });
        await expect(page.getByTestId('context-menu')).toBeVisible({ timeout: 1_500 });
        contextMenuOpened = true;
        break;
      } catch {
        // Try the next card when the pinned preview currently covers this one.
      }
    }
    expect(contextMenuOpened).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('context-menu')).toHaveCount(0);
  }
  await expect(page.locator('app-card-preview-overlay')).toHaveCount(0);
  const result = await page.locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"]`).evaluate((element, ids) => {
    const battlefield = element as HTMLElement;
    const board = battlefield.getBoundingClientRect();
    const cards = ids.map((instanceId) => {
      const card = battlefield.querySelector<HTMLElement>(`[data-testid="game-card"][data-card-instance-id="${instanceId}"]`);
      if (!card) return { instanceId, missing: true };
      const rect = card.getBoundingClientRect();
      const sampleOffsets = [0.2, 0.5, 0.8];
      const hits = sampleOffsets.flatMap((offsetY) => sampleOffsets.map((offsetX) => {
        const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width * offsetX));
        const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height * offsetY));
        return document.elementFromPoint(x, y);
      }));
      return {
        instanceId,
        missing: false,
        inside: rect.left >= board.left - 1.5 && rect.top >= board.top - 1.5
          && rect.right <= board.right + 1.5 && rect.bottom <= board.bottom + 1.5,
        visible: rect.width > 0 && rect.height > 0,
        clickable: hits.some((hit) => hit === card || (hit instanceof Node && card.contains(hit))),
        blockers: [...new Set(hits.filter((hit) => hit && hit !== card && !card.contains(hit)).map((hit) => {
          const element = hit as HTMLElement;
          return `${element.tagName.toLowerCase()}.${element.className || ''}[data-testid=${element.dataset['testid'] ?? ''}]`;
        }))],
      };
    });
    return {
      cards,
      overflowX: battlefield.scrollWidth - battlefield.clientWidth,
      overflowY: battlefield.scrollHeight - battlefield.clientHeight,
    };
  }, instanceIds);
  expect(result.overflowX).toBeLessThanOrEqual(1);
  expect(result.overflowY).toBeLessThanOrEqual(1);
  for (const card of result.cards) {
    expect(card.missing, card.instanceId).toBe(false);
    expect(card.inside, card.instanceId).toBe(true);
    expect(card.visible, card.instanceId).toBe(true);
    expect(card.clickable, JSON.stringify(card)).toBe(true);
  }
}

function assertInternalDistancesPreserved(
  before: Record<string, RatioPosition>,
  after: Record<string, RatioPosition>,
  instanceIds: string[],
): void {
  for (let left = 0; left < instanceIds.length; left += 1) {
    for (let right = left + 1; right < instanceIds.length; right += 1) {
      const leftId = instanceIds[left]!;
      const rightId = instanceIds[right]!;
      expect(after[rightId]!.x - after[leftId]!.x).toBeCloseTo(before[rightId]!.x - before[leftId]!.x, 8);
      expect(after[rightId]!.y - after[leftId]!.y).toBeCloseTo(before[rightId]!.y - before[leftId]!.y, 8);
    }
  }
}

async function assertFaceDownProjection(request: APIRequestContext, setup: ManualSetup, instanceId: string): Promise<void> {
  for (const viewer of setup.players.slice(1)) {
    const card = findCard(await gameSnapshot(request, setup.gameId, viewer.token), instanceId);
    expect(card?.['faceDown']).toBe(true);
    expect(card?.['cardKey']).toBeUndefined();
    expect(card?.['printId']).toBeUndefined();
    expect(emptyRecord(card?.['imageUris'])).toBe(true);
  }
}

async function gameBootstrap(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/bootstrap?contract=v2`, { headers: bearer(token) });
  await expectApiOk(response, 'load spatial bootstrap');
  const payload = await response.json() as JsonObject & { game?: JsonObject };
  return { ...payload, ...(payload.game ?? {}) };
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function expectApiOk(response: { ok(): boolean; status(): number; text(): Promise<string> }, action: string): Promise<void> {
  if (!response.ok()) throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}

async function setBattlefieldZoom(page: Page, zoom: number): Promise<void> {
  const controls = page.getByTestId('battlefield-zoom-controls');
  const slider = page.getByTestId('battlefield-zoom-slider');
  if (await slider.count() === 0) await controls.locator('button').click({ timeout: 10_000 });
  await slider.evaluate((element, value) => {
    const input = element as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, zoom);
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), ZOOM_STORAGE_KEY)).toBe(String(zoom));
}

async function focusSpatialPlayer(page: Page, playerId: string, displayName: string): Promise<void> {
  const focusedPlayerId = await page.getByTestId('player-panel').getAttribute('data-player-id').catch(() => null);
  if (focusedPlayerId === playerId) return;

  const miniBoard = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`).first();
  if (await miniBoard.count() > 0) {
    await miniBoard.evaluate((element) => (element as HTMLElement).click());
    await expect.poll(
      () => page.getByTestId('player-panel').getAttribute('data-player-id'),
      { timeout: 10_000 },
    ).toBe(playerId);
    return;
  }

  await focusPlayer(page, displayName);
}

async function assertRenderedGrid(pages: Page[], playerId: string, expected: Record<string, RatioPosition>): Promise<void> {
  const ids = Object.keys(expected);
  for (const page of pages) {
    for (const instanceId of ids) {
      try {
        await expect.poll(async () => {
          const rendered = await renderedLogicalPosition(page, playerId, instanceId);
          return Math.max(
            Math.abs(rendered.x - expected[instanceId]!.x),
            Math.abs(rendered.y - expected[instanceId]!.y),
          );
        }, { timeout: 10_000 }).toBeLessThan(0.05);
      } catch (error) {
        const rendered = await renderedLogicalPosition(page, playerId, instanceId);
        const diagnostics = await battlefieldCard(page, playerId, instanceId).evaluate((element) => {
          const card = element as HTMLElement;
          const battlefield = card.closest<HTMLElement>('.battlefield[data-player-id]');
          const summary = battlefield?.closest<HTMLElement>('.focused-board')
            ?.querySelector<HTMLElement>('[data-testid="battlefield-owner-summary"]');
          const battlefieldStyle = battlefield ? window.getComputedStyle(battlefield) : null;
          return {
            responsiveState: card.closest<HTMLElement>('[data-responsive-state]')?.dataset['responsiveState'] ?? null,
            card: { left: card.style.left, top: card.style.top, width: card.offsetWidth, height: card.offsetHeight },
            battlefield: battlefield ? {
              width: battlefield.clientWidth,
              height: battlefield.clientHeight,
              paddingTop: battlefieldStyle?.paddingTop,
              paddingBottom: battlefieldStyle?.paddingBottom,
            } : null,
            summary: summary ? {
              width: summary.getBoundingClientRect().width,
              height: summary.getBoundingClientRect().height,
            } : null,
          };
        });
        const viewport = page.viewportSize();
        throw new Error(`Rendered ratio mismatch for ${instanceId} at ${viewport?.width ?? 0}x${viewport?.height ?? 0}: expected=${JSON.stringify(expected[instanceId])} rendered=${JSON.stringify(rendered)} diagnostics=${JSON.stringify(diagnostics)}`, { cause: error });
      }
    }
    const rendered = Object.fromEntries(await Promise.all(ids.map(async (instanceId) => [
      instanceId,
      await renderedLogicalPosition(page, playerId, instanceId),
    ])));
    for (const instanceId of ids) {
      expect(rendered[instanceId]!.x).toBeCloseTo(expected[instanceId]!.x, 1);
      expect(rendered[instanceId]!.y).toBeCloseTo(expected[instanceId]!.y, 1);
    }
    const uniquePositions = new Set(Object.values(rendered).map((position) => `${position.x.toFixed(2)}:${position.y.toFixed(2)}`));
    expect(uniquePositions.size).toBe(ids.length);
  }
}

async function renderedLogicalPosition(page: Page, playerId: string, instanceId: string): Promise<{ x: number; y: number }> {
  return battlefieldCard(page, playerId, instanceId).evaluate((element) => {
    const card = element as HTMLElement;
    const battlefield = card.closest<HTMLElement>('.battlefield[data-player-id]');
    if (!battlefield) throw new Error('Card is not inside a battlefield.');
    const style = window.getComputedStyle(battlefield);
    const width = battlefield.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
    const height = battlefield.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
    const availableX = Math.max(1, width - card.offsetWidth);
    const availableY = Math.max(1, height - card.offsetHeight);
    return {
      x: Number.parseFloat(card.style.left || '0') / availableX,
      y: Number.parseFloat(card.style.top || '0') / availableY,
    };
  });
}

async function assertViewerRatios(
  request: APIRequestContext,
  game: Setup,
  cardIds: string[],
  expected: Record<string, RatioPosition>,
  version: number,
): Promise<void> {
  const snapshots = await Promise.all([
    gameSnapshot(request, game.gameId, game.playerA.token),
    gameSnapshot(request, game.gameId, game.playerB.token),
  ]);
  for (const snapshot of snapshots) {
    expect(snapshot['version']).toBe(version);
    expect(positionsFromSnapshot(snapshot, cardIds)).toEqual(expected);
  }
}

async function sendAcceptedCommand(page: Page, websocketUrl: string, gameId: string, baseVersion: number, type: string, payload: JsonObject): Promise<JsonObject> {
  const actionId = `spatial-accepted-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const frames = await sendBrowserWebSocketCommand(page, websocketUrl, {
    kind: 'command.v2', gameId, baseVersion, clientActionId: actionId, messageId: actionId, type, payload,
  }, actionId);
  const patch = frames.find((frame) => frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === actionId);
  if (!patch) throw new Error(`Accepted ${type} did not emit Patch.v2: ${JSON.stringify(frames)}`);
  expect(frames.some((frame) => frame['kind'] === 'game_patch' || frame['kind'] === 'resync_required')).toBe(false);
  return patch;
}

async function sendRejectedCommand(page: Page, websocketUrl: string, gameId: string, baseVersion: number, type: string, payload: JsonObject): Promise<JsonObject> {
  const actionId = `spatial-rejected-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const frames = await sendBrowserWebSocketCommand(page, websocketUrl, {
    kind: 'command.v2', gameId, baseVersion, clientActionId: actionId, messageId: actionId, type, payload,
  }, actionId);
  const ack = frames.find((frame) => frame['kind'] === 'command_ack' && frame['clientActionId'] === actionId);
  if (!ack) throw new Error(`Rejected ${type} did not emit command_ack: ${JSON.stringify(frames)}`);
  expect(frames.some((frame) => frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === actionId)).toBe(false);
  expect(frames.some((frame) => frame['kind'] === 'game_patch' || frame['kind'] === 'resync_required')).toBe(false);
  return ack;
}

async function sendBrowserWebSocketCommand(page: Page, websocketUrl: string, message: JsonObject, actionId: string): Promise<JsonObject[]> {
  return page.evaluate(async ({ url, payload, expectedActionId }) => {
    type SpatialQaWindow = Window & { __czSpatialQaCommandSockets?: Record<string, WebSocket> };
    const qaWindow = window as SpatialQaWindow;
    const sockets = qaWindow.__czSpatialQaCommandSockets ??= {};
    let socket = sockets[url];
    if (!socket || socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
      socket = new WebSocket(url);
      sockets[url] = socket;
    }
    if (socket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const timeout = window.setTimeout(() => rejectPromise(new Error('Spatial Runtime WebSocket connection timed out.')), 20_000);
        socket!.addEventListener('open', () => {
          window.clearTimeout(timeout);
          resolvePromise();
        }, { once: true });
        socket!.addEventListener('error', () => {
          window.clearTimeout(timeout);
          rejectPromise(new Error('Spatial Runtime WebSocket failed.'));
        }, { once: true });
      });
    }

    return new Promise<JsonObject[]>((resolvePromise, rejectPromise) => {
    const frames: JsonObject[] = [];
    const timeout = window.setTimeout(() => {
      socket!.removeEventListener('message', onMessage);
      rejectPromise(new Error(`Timed out waiting for spatial runtime result. Frames: ${JSON.stringify(frames)}`));
    }, 20_000);
    const finish = (): void => {
      window.clearTimeout(timeout);
      socket!.removeEventListener('message', onMessage);
      resolvePromise(frames);
    };
    const onMessage = (event: MessageEvent): void => {
      try {
        const frame = JSON.parse(String(event.data)) as JsonObject;
        frames.push(frame);
        if ((frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === expectedActionId)
          || (frame['kind'] === 'command_ack' && frame['clientActionId'] === expectedActionId)) finish();
      } catch {
        // Ignore non-JSON runtime frames.
      }
    };
    socket!.addEventListener('message', onMessage);
    socket!.send(JSON.stringify(payload));
    socket!.addEventListener('error', () => {
      window.clearTimeout(timeout);
      socket!.removeEventListener('message', onMessage);
      rejectPromise(new Error('Spatial Runtime WebSocket failed.'));
    }, { once: true });
    });
  }, { url: websocketUrl, payload: message, expectedActionId: actionId });
}

function createAudit(page: Page, gameId: string): BrowserAudit {
  const audit: BrowserAudit = { frames: [], recoveryRequests: 0, errors: [] };
  page.on('websocket', (socket) => socket.on('framereceived', (event) => {
    try {
      audit.frames.push(JSON.parse(typeof event.payload === 'string' ? event.payload : event.payload.toString('utf8')) as JsonObject);
    } catch {
      // Ignore non-JSON frames.
    }
  }));
  page.on('request', (httpRequest) => {
    if (httpRequest.method() === 'GET' && new RegExp(`/games/${gameId}/(bootstrap|snapshot)`).test(httpRequest.url())) {
      audit.recoveryRequests += 1;
    }
  });
  page.on('console', (message) => { if (message.type() === 'error') audit.errors.push(message.text()); });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  return audit;
}

function assertNoLegacyRecovery(audits: BrowserAudit[]): void {
  for (const audit of audits) {
    expect(audit.frames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
    expect(audit.frames.some((frame) => frame['kind'] === 'resync_required' || frame['status'] === 'resync_required')).toBe(false);
    expect(JSON.stringify(audit.frames)).not.toMatch(/target_not_found/i);
    expect(audit.errors.filter((error) => /target_not_found|resync_required/i.test(error))).toEqual([]);
  }
}

async function waitForConnection(frames: JsonObject[]): Promise<void> {
  await expect.poll(() => frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), { timeout: 30_000 }).toBe(true);
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok()) throw new Error(`Snapshot failed with HTTP ${response.status()}: ${await response.text()}`);
  return ((await response.json()) as { game?: { snapshot?: JsonObject } }).game?.snapshot ?? {};
}

async function websocketTicket(request: APIRequestContext, gameId: string, token: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok()) throw new Error(`WebSocket ticket failed with HTTP ${response.status()}: ${await response.text()}`);
  const payload = await response.json() as { route?: string; websocketUrl?: string };
  expect(payload.route).toBe('runtime_ws');
  if (!payload.websocketUrl) throw new Error('Runtime WebSocket URL missing.');
  return payload.websocketUrl;
}

async function loginRefreshToken(
  request: APIRequestContext,
  credentials: { email: string; password: string },
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/auth/login`, { data: credentials });
  if (!response.ok()) throw new Error(`Login for isolated viewer failed with HTTP ${response.status()}: ${await response.text()}`);
  const cookie = response.headers()['set-cookie'] ?? '';
  const refreshToken = cookie.match(/commanderzone\.refresh=([^;]+)/)?.[1] ?? '';
  expect(refreshToken.length).toBeGreaterThan(10);
  return refreshToken;
}

async function assertServicesReady(request: APIRequestContext): Promise<void> {
  await Promise.all(SERVICE_URLS.map(async (url) => {
    const response = await request.get(url, { timeout: 10_000 });
    expect(response.ok(), `${url}: HTTP ${response.status()}`).toBe(true);
  }));
}

async function restartRuntime(): Promise<void> {
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], {
    cwd: resolve(process.cwd(), '..'),
    timeout: 60_000,
    windowsHide: true,
  });
}

function battlefieldCard(page: Page, ownerPlayerId: string, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`);
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.find((item) => item['op'] === op) ?? null;
}

function patchCount(frames: JsonObject[]): number {
  return frames.filter((frame) => frame['kind'] === 'patch.v2').length;
}

function zoneIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return (zones?.[zone] ?? []).map((card) => String(card['instanceId'] ?? '')).filter(Boolean);
}

function findCard(snapshot: JsonObject, instanceId: string): JsonObject | undefined {
  const instances = snapshot['instances'] as Record<string, JsonObject> | undefined;
  if (instances?.[instanceId]) return instances[instanceId];
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

function positionsFromSnapshot(snapshot: JsonObject, instanceIds: string[]): Record<string, RatioPosition> {
  return Object.fromEntries(instanceIds.map((instanceId) => {
    const position = findCard(snapshot, instanceId)?.['position'] as RatioPosition | undefined;
    expect(position?.unit, instanceId).toBe('ratio');
    expect(Number.isFinite(position?.x) && position!.x >= 0 && position!.x <= 1, instanceId).toBe(true);
    expect(Number.isFinite(position?.y) && position!.y >= 0 && position!.y <= 1, instanceId).toBe(true);
    return [instanceId, position!];
  }));
}

function containsForbiddenSpatialKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenSpatialKey);
  if (!value || typeof value !== 'object') return false;
  const forbidden = /^(viewport|browserZoom|battlefieldZoom|zoomPercent|devicePixelRatio|rawPointer|domOffset)$/i;
  return Object.entries(value as JsonObject).some(([key, child]) => forbidden.test(key) || containsForbiddenSpatialKey(child));
}

function emptyRecord(value: unknown): boolean {
  return !value || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as JsonObject).length === 0);
}

function ratio(x: number, y: number): RatioPosition {
  return { x, y, unit: 'ratio' };
}
