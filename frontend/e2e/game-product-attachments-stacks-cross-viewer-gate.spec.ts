import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase } from './support/decks';
import { focusPlayer } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const ZOOM_STORAGE_KEY = 'commanderZone.gameTable.battlefieldZoomPercent';
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
type RatioPosition = { x: number; y: number; unit: 'ratio' };
type BrowserAudit = { frames: JsonObject[]; errors: string[] };
type PlayerSession = Awaited<ReturnType<typeof createRealUserSession>> & { deck: { deckId: string } };
type Setup = { gameId: string; players: [PlayerSession, PlayerSession, PlayerSession] };

test.describe('attachments and battlefield stacks cross-viewer gate', () => {
  test.describe.configure({ mode: 'serial' });

  test('keeps one authoritative relation graph through commands, privacy, lifecycle and restart', async ({ browser, request, baseURL }) => {
    test.setTimeout(900_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    await assertServicesReady(request);
    const setup = await createThreePlayerGame(request, `relations${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const [playerA, playerB, playerC] = setup.players;
    const initial = await gameSnapshot(request, setup.gameId, playerA.token);
    const ids = zoneIds(initial, playerA.user.id, 'hand').slice(0, 7);
    expect(ids).toHaveLength(7);
    const [targetId, attachmentOneId, attachmentTwoId, stackOneId, stackTwoId, stackThreeId, stackFourId] = ids as [string, string, string, string, string, string, string];

    const contexts = await Promise.all([
      relationContext(browser, baseURL, playerA, { width: 1440, height: 900 }, 100),
      relationContext(browser, baseURL, playerB, { width: 800, height: 700 }, 70),
      relationContext(browser, baseURL, playerC, { width: 1920, height: 1080 }, 140),
    ]);
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const audits = pages.map((page) => createAudit(page));
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(pages.map((page) => focusOwner(page, playerA.user.id, playerA.user.displayName)));
      const tickets = await Promise.all(setup.players.map((player) => websocketTicket(request, setup.gameId, player.token)));
      let version = Number(initial['version'] ?? 1);

      const accepted = async (actorIndex: 0 | 1 | 2, type: string, payload: JsonObject): Promise<JsonObject> => {
        const result = await sendCommand(pages[actorIndex]!, tickets[actorIndex]!, setup.gameId, version, type, payload, true);
        version = Number(result['version'] ?? version + 1);
        await waitForSnapshotVersion(request, setup.gameId, playerA.token, version);
        return result;
      };
      const rejected = async (actorIndex: 0 | 1 | 2, type: string, payload: JsonObject): Promise<JsonObject> => {
        const before = await graphState(request, setup, version);
        const result = await sendCommand(pages[actorIndex]!, tickets[actorIndex]!, setup.gameId, version, type, payload, false);
        expect(result['version']).toBe(version);
        expect(await graphState(request, setup, version)).toEqual(before);
        return result;
      };

      const startingPositions: Record<string, RatioPosition> = {
        [targetId]: ratio(0.2, 0.38),
        [attachmentOneId]: ratio(0.52, 0.15),
        [attachmentTwoId]: ratio(0.67, 0.15),
        [stackOneId]: ratio(0.14, 0.72),
        [stackTwoId]: ratio(0.34, 0.72),
        [stackThreeId]: ratio(0.54, 0.72),
        [stackFourId]: ratio(0.74, 0.72),
      };
      for (const instanceId of ids) {
        await accepted(0, 'card.moved', {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId,
          position: startingPositions[instanceId],
        });
      }
      await expectAllCardsVisible(pages, playerA.user.id, ids);

      await accepted(0, 'attachment.created', {
        equipmentInstanceId: attachmentOneId,
        attachedToInstanceId: targetId,
      });
      await accepted(0, 'attachment.created', {
        equipmentInstanceId: attachmentTwoId,
        attachedToInstanceId: targetId,
      });
      await accepted(0, 'arrow.created', {
        fromInstanceId: attachmentTwoId,
        toInstanceId: targetId,
        color: 'blue',
      });
      const arrowId = String(snapshotArrows(await gameSnapshot(request, setup.gameId, playerA.token))[0]?.['id'] ?? '');
      expect(arrowId).toBeTruthy();
      let graph = await assertIdenticalGraph(request, setup);
      expect(graph.attachments.map((attachment) => attachment['equipmentInstanceId'])).toEqual([attachmentOneId, attachmentTwoId]);
      expectForbiddenRelationFields(graph);
      await assertProportionalLayout(pages, playerA.user.id, targetId, [attachmentOneId, attachmentTwoId]);
      await assertCardsHaveClickableRegion(pages, playerA.user.id, [targetId, attachmentOneId, attachmentTwoId]);

      for (const [type, payload] of [
        ['attachment.created', { equipmentInstanceId: stackFourId, attachedToInstanceId: targetId }],
        ['attachment.removed', { equipmentInstanceId: attachmentOneId, position: ratio(0.5, 0.4) }],
        ['attachment.reordered', { attachedToInstanceId: targetId, orderedAttachmentIds: graph.attachments.map((item) => item['id']) }],
        ['battlefield.stack.created', { orderedInstanceIds: [stackOneId, stackTwoId], rootInstanceId: stackOneId }],
        ['card.position.changed', { playerId: playerA.user.id, zone: 'battlefield', instanceId: targetId, position: ratio(0.3, 0.3) }],
      ] as Array<[string, JsonObject]>) {
        const refusal = await rejected(1, type, payload);
        expect(String((refusal['error'] as JsonObject | undefined)?.['code'] ?? '')).toMatch(/CONTROLLED|AUTHORITY|PERMISSION/);
      }

      const childPositionsBeforeTargetMove = positions(await gameSnapshot(request, setup.gameId, playerA.token), [attachmentOneId, attachmentTwoId]);
      await accepted(0, 'card.position.changed', {
        playerId: playerA.user.id,
        zone: 'battlefield',
        instanceId: targetId,
        position: ratio(0.32, 0.3),
      });
      expect(positions(await gameSnapshot(request, setup.gameId, playerA.token), [attachmentOneId, attachmentTwoId])).toEqual(childPositionsBeforeTargetMove);
      await assertProportionalLayout(pages, playerA.user.id, targetId, [attachmentOneId, attachmentTwoId]);

      graph = await assertIdenticalGraph(request, setup);
      const reversedAttachmentIds = graph.attachments.map((item) => String(item['id'])).reverse();
      await accepted(0, 'attachment.reordered', {
        attachedToInstanceId: targetId,
        orderedAttachmentIds: reversedAttachmentIds,
      });
      graph = await assertIdenticalGraph(request, setup);
      expect(graph.attachments.map((item) => item['id'])).toEqual(reversedAttachmentIds);

      const detachPosition = ratio(0.58, 0.34);
      await accepted(0, 'attachment.removed', { equipmentInstanceId: attachmentOneId, position: detachPosition });
      expect(findCard(await gameSnapshot(request, setup.gameId, playerA.token), attachmentOneId)?.['position']).toEqual(detachPosition);
      expect((await assertIdenticalGraph(request, setup)).attachments).toHaveLength(1);

      await accepted(0, 'card.face_down.changed', {
        playerId: playerA.user.id,
        instanceId: attachmentTwoId,
        faceDown: true,
      });
      const ownerSnapshotBeforeCounter = await gameSnapshot(request, setup.gameId, playerA.token);
      const attachmentGraphBeforeCounter = relationGraph(ownerSnapshotBeforeCounter);
      expect(attachmentGraphBeforeCounter.attachments).toHaveLength(1);
      expect(snapshotArrows(ownerSnapshotBeforeCounter)).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: arrowId, fromInstanceId: attachmentTwoId, toInstanceId: targetId }),
      ]));
      for (const viewer of [playerB, playerC]) {
        const projected = await gameSnapshot(request, setup.gameId, viewer.token);
        expect(findCard(projected, attachmentTwoId)).toBeUndefined();
        const shell = findOpaqueBattlefieldCard(projected, playerA.user.id, startingPositions[attachmentTwoId]);
        expect(shell?.['faceDown']).toBe(true);
        expect(shell?.['hidden']).toBe(true);
        expect(String(shell?.['instanceId'] ?? '')).toMatch(new RegExp(`^${escapeRegExp(playerA.user.id)}-hidden-battlefield-\\d+$`));
        expect(String(shell?.['instanceId'] ?? '')).not.toContain(attachmentTwoId);
        expect(JSON.stringify(shell)).not.toMatch(/cardKey|cardRef|printId|imageUris|cardFaces|oracleText/);
        expect(relationGraph(projected).attachments).toEqual([]);
        expect(snapshotArrows(projected)).toEqual([]);
        assertNoCanonicalRelationReference(projected, attachmentTwoId);
      }
      await accepted(0, 'card.counter.changed', {
        playerId: playerA.user.id,
        instanceId: attachmentTwoId,
        counter: 'shield',
        value: 2,
      });
      expect(findCard(await gameSnapshot(request, setup.gameId, playerA.token), attachmentTwoId)?.['counters']).toMatchObject({ shield: 2 });
      for (const [viewer, page] of [[playerB, pages[1]], [playerC, pages[2]]] as const) {
        const projected = await gameSnapshot(request, setup.gameId, viewer.token);
        expect(findCard(projected, attachmentTwoId)).toBeUndefined();
        const shell = findOpaqueBattlefieldCard(projected, playerA.user.id, startingPositions[attachmentTwoId]);
        expect(shell?.['counters']).toMatchObject({ shield: 2 });
        const opaqueId = String(shell?.['instanceId'] ?? '');
        await expect(battlefieldCard(page!, playerA.user.id, opaqueId)).toBeVisible({ timeout: 10_000 });
        await expect(battlefieldCard(page!, playerA.user.id, attachmentTwoId)).toHaveCount(0);
      }
      expect(relationGraph(await gameSnapshot(request, setup.gameId, playerA.token))).toEqual(attachmentGraphBeforeCounter);
      for (const viewer of [playerB, playerC]) {
        const projected = await gameSnapshot(request, setup.gameId, viewer.token);
        expect(relationGraph(projected).attachments).toEqual([]);
        expect(snapshotArrows(projected)).toEqual([]);
        assertNoCanonicalRelationReference(projected, attachmentTwoId);
      }
      assertNoRecoveryFailures(audits);
      await accepted(0, 'card.controller.changed', {
        playerId: playerA.user.id,
        instanceId: attachmentTwoId,
        targetPlayerId: playerB.user.id,
      });
      const controllerSnapshot = await gameSnapshot(request, setup.gameId, playerB.token);
      expect(relationGraph(controllerSnapshot).attachments).toHaveLength(1);
      expect(snapshotArrows(controllerSnapshot)).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: arrowId, fromInstanceId: attachmentTwoId, toInstanceId: targetId }),
      ]));
      const thirdSnapshotAfterControl = await gameSnapshot(request, setup.gameId, playerC.token);
      expect(relationGraph(thirdSnapshotAfterControl).attachments).toEqual([]);
      expect(snapshotArrows(thirdSnapshotAfterControl)).toEqual([]);
      assertNoCanonicalRelationReference(thirdSnapshotAfterControl, attachmentTwoId);
      await accepted(1, 'attachment.removed', { equipmentInstanceId: attachmentTwoId, position: ratio(0.68, 0.36) });
      expect((await assertIdenticalGraph(request, setup)).attachments).toEqual([]);

      await accepted(0, 'battlefield.stack.created', {
        orderedInstanceIds: [stackOneId, stackTwoId, stackThreeId],
        rootInstanceId: stackOneId,
        stackKind: 'land',
      });
      graph = await assertIdenticalGraph(request, setup);
      expect(graph.stacks).toHaveLength(1);
      expect(graph.stacks[0]?.['orderedMemberIds']).toEqual([stackOneId, stackTwoId, stackThreeId]);
      expect((graph.stacks[0]?.['orderedMemberIds'] as string[])).not.toContain(stackFourId);
      await assertProportionalLayout(pages, playerA.user.id, stackOneId, [stackTwoId, stackThreeId]);
      await assertIndependentCardNotStacked(pages, playerA.user.id, stackOneId, stackFourId);
      await assertCardsHaveClickableRegion(pages, playerA.user.id, [stackOneId, stackTwoId, stackThreeId]);

      const stackId = String(graph.stacks[0]?.['id']);
      for (const [type, payload] of [
        ['battlefield.stack.reordered', { stackId, orderedInstanceIds: [stackOneId, stackThreeId, stackTwoId], rootInstanceId: stackOneId }],
        ['battlefield.stack.member_removed', { stackId, instanceId: stackTwoId, position: ratio(0.4, 0.6) }],
        ['battlefield.stack.dissolved', { stackId, positions: [stackOneId, stackTwoId, stackThreeId].map((instanceId, index) => ({ instanceId, position: ratio(0.2 + index * 0.15, 0.62) })) }],
      ] as Array<[string, JsonObject]>) {
        const refusal = await rejected(1, type, payload);
        expect(String((refusal['error'] as JsonObject | undefined)?.['code'] ?? '')).toMatch(/CONTROLLED|AUTHORITY|PERMISSION/);
      }

      const memberPositionsBeforeRootMove = positions(await gameSnapshot(request, setup.gameId, playerA.token), [stackTwoId, stackThreeId]);
      await accepted(0, 'card.position.changed', {
        playerId: playerA.user.id,
        zone: 'battlefield',
        instanceId: stackOneId,
        position: ratio(0.26, 0.64),
      });
      expect(positions(await gameSnapshot(request, setup.gameId, playerA.token), [stackTwoId, stackThreeId])).toEqual(memberPositionsBeforeRootMove);

      await accepted(0, 'battlefield.stack.reordered', {
        stackId,
        orderedInstanceIds: [stackTwoId, stackOneId, stackThreeId],
        rootInstanceId: stackTwoId,
      });
      await accepted(0, 'battlefield.stack.member_removed', {
        stackId,
        instanceId: stackOneId,
        position: ratio(0.18, 0.63),
      });
      expect(findCard(await gameSnapshot(request, setup.gameId, playerA.token), stackOneId)?.['position']).toEqual(ratio(0.18, 0.63));
      await accepted(0, 'battlefield.stack.member_added', { stackId, instanceId: stackFourId, index: 2 });
      graph = await assertIdenticalGraph(request, setup);
      expect(graph.stacks[0]?.['orderedMemberIds']).toEqual([stackTwoId, stackThreeId, stackFourId]);

      const dissolvedPositions = [
        { instanceId: stackTwoId, position: ratio(0.25, 0.58) },
        { instanceId: stackThreeId, position: ratio(0.43, 0.58) },
        { instanceId: stackFourId, position: ratio(0.61, 0.58) },
      ];
      await accepted(0, 'battlefield.stack.dissolved', { stackId, positions: dissolvedPositions });
      expect((await assertIdenticalGraph(request, setup)).stacks).toEqual([]);
      expect(positions(await gameSnapshot(request, setup.gameId, playerA.token), [stackTwoId, stackThreeId, stackFourId])).toEqual(
        Object.fromEntries(dissolvedPositions.map((item) => [item.instanceId, item.position])),
      );

      await accepted(0, 'battlefield.stack.created', {
        orderedInstanceIds: [stackTwoId, stackThreeId, stackFourId],
        rootInstanceId: stackTwoId,
        stackKind: 'land',
      });
      const beforeRestart = await graphState(request, setup, version);
      await restartRuntime();
      await assertServicesReady(request);
      await Promise.all(pages.map((page) => page.reload()));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(pages.map((page) => focusOwner(page, playerA.user.id, playerA.user.displayName)));
      expect(await graphState(request, setup, version)).toEqual(beforeRestart);
      expect(findCard(await gameSnapshot(request, setup.gameId, playerA.token), attachmentTwoId)?.['counters']).toMatchObject({ shield: 2 });
      const restartedThirdSnapshot = await gameSnapshot(request, setup.gameId, playerC.token);
      expect(findCard(restartedThirdSnapshot, attachmentTwoId)).toBeUndefined();
      expect(findOpaqueBattlefieldCard(restartedThirdSnapshot, playerA.user.id, ratio(0.68, 0.36))?.['counters']).toMatchObject({ shield: 2 });
      expect(snapshotArrows(restartedThirdSnapshot)).toEqual([]);
      assertNoCanonicalRelationReference(restartedThirdSnapshot, attachmentTwoId);
      const restartedControllerSnapshot = await gameSnapshot(request, setup.gameId, playerB.token);
      expect(snapshotArrows(restartedControllerSnapshot)).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: arrowId, fromInstanceId: attachmentTwoId, toInstanceId: targetId }),
      ]));
      await accepted(1, 'card.controller.changed', {
        playerId: playerB.user.id,
        instanceId: attachmentTwoId,
        targetPlayerId: playerA.user.id,
      });
      await accepted(0, 'arrow.removed', { id: arrowId });
      expect(snapshotArrows(await gameSnapshot(request, setup.gameId, playerA.token))).toEqual([]);
      expect(snapshotArrows(await gameSnapshot(request, setup.gameId, playerB.token))).toEqual([]);
      expect(snapshotArrows(await gameSnapshot(request, setup.gameId, playerC.token))).toEqual([]);

      graph = await assertIdenticalGraph(request, setup);
      const restartedStackId = String(graph.stacks[0]?.['id']);
      await accepted(0, 'card.controller.changed', {
        playerId: playerA.user.id,
        instanceId: stackThreeId,
        targetPlayerId: playerB.user.id,
      });
      expect((await assertIdenticalGraph(request, setup)).stacks).toEqual([]);

      await accepted(0, 'battlefield.stack.created', {
        orderedInstanceIds: [stackOneId, stackTwoId, stackFourId],
        rootInstanceId: stackOneId,
        stackKind: 'land',
      });
      graph = await assertIdenticalGraph(request, setup);
      expect(String(graph.stacks[0]?.['id'])).not.toBe(restartedStackId);
      await accepted(0, 'card.moved', {
        playerId: playerA.user.id,
        fromZone: 'battlefield',
        toZone: 'graveyard',
        instanceId: stackOneId,
      });
      graph = await assertIdenticalGraph(request, setup);
      expect(graph.stacks[0]?.['rootInstanceId']).toBe(stackTwoId);
      expect(graph.stacks[0]?.['orderedMemberIds']).toEqual([stackTwoId, stackFourId]);
      await accepted(0, 'card.moved', {
        playerId: playerA.user.id,
        fromZone: 'battlefield',
        toZone: 'graveyard',
        instanceId: stackTwoId,
      });
      expect((await assertIdenticalGraph(request, setup)).stacks).toEqual([]);

      await accepted(0, 'card.tapped', { playerId: playerA.user.id, instanceId: stackFourId, tapped: true });
      const finalSnapshot = await gameSnapshot(request, setup.gameId, playerA.token);
      expect(findCard(finalSnapshot, stackFourId)?.['tapped']).toBe(true);
      expectForbiddenRelationFields(await assertIdenticalGraph(request, setup));
      assertNoRecoveryFailures(audits);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });

  test('manual headed native zoom keeps dense relation geometry usable at 80, 100, 125 and 150 percent', async ({ browser, request, baseURL }) => {
    test.skip(process.env['E2E_MANUAL_RELATIONS_ZOOM'] !== '1', 'Run headed with E2E_MANUAL_RELATIONS_ZOOM=1 for native browser zoom QA.');
    test.setTimeout(20 * 60_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const setup = await createThreePlayerGame(request, `relationszoom${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const [playerA, playerB, playerC] = setup.players;
    const initial = await gameSnapshot(request, setup.gameId, playerA.token);
    const sources = [
      ...zoneIds(initial, playerA.user.id, 'hand').map((instanceId) => ({ instanceId, fromZone: 'hand' })),
      ...zoneIds(initial, playerA.user.id, 'library').map((instanceId) => ({ instanceId, fromZone: 'library' })),
    ].slice(0, 14);
    expect(sources).toHaveLength(14);
    const allIds = sources.map((source) => source.instanceId);
    const [targetId, ...relatedIds] = allIds;
    const attachmentIds = relatedIds.slice(0, 5);
    const stackIds = relatedIds.slice(5, 13);
    expect(targetId).toBeTruthy();
    expect(attachmentIds).toHaveLength(5);
    expect(stackIds).toHaveLength(8);

    const contexts = await Promise.all([
      relationContext(browser, baseURL, playerA, { width: 1440, height: 900 }, 100),
      relationContext(browser, baseURL, playerB, { width: 800, height: 700 }, 70),
      relationContext(browser, baseURL, playerC, { width: 1920, height: 1080 }, 140),
    ]);
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const [pageA] = pages;
      const audits = pages.map((page) => createAudit(page));
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(pages.map((page) => focusOwner(page, playerA.user.id, playerA.user.displayName)));
      let version = Number(initial['version'] ?? 1);
      const accepted = async (type: string, payload: JsonObject): Promise<JsonObject> => {
        const ticket = await websocketTicket(request, setup.gameId, playerA.token);
        const result = await sendCommand(pageA!, ticket, setup.gameId, version, type, payload, true);
        version = Number(result['version'] ?? version + 1);
        await waitForSnapshotVersion(request, setup.gameId, playerA.token, version);
        await Promise.all(audits.map((audit) => expect.poll(
          () => audit.frames.some((frame) => frame['kind'] === 'patch.v2' && Number(frame['version']) === version),
          { timeout: 20_000 },
        ).toBe(true)));
        return result;
      };

      const startingPositions = Object.fromEntries(allIds.map((instanceId, index) => [
        instanceId,
        index === 0 ? ratio(0.08, 0.3) : index <= 5 ? ratio(0.1 + index * 0.08, 0.12) : ratio(0.62 + (index - 6) * 0.02, 0.76),
      ])) as Record<string, RatioPosition>;
      for (const source of sources) {
        await accepted('card.moved', {
          playerId: playerA.user.id,
          fromZone: source.fromZone,
          toZone: 'battlefield',
          instanceId: source.instanceId,
          position: startingPositions[source.instanceId],
        });
      }
      await expectAllCardsVisible(pages, playerA.user.id, allIds);

      for (const [index, attachmentId] of attachmentIds.entries()) {
        await accepted('attachment.created', { equipmentInstanceId: attachmentId, attachedToInstanceId: targetId });
        if (index === 0 || index === 1 || index === 4) {
          await assertProportionalLayout(pages, playerA.user.id, targetId!, attachmentIds.slice(0, index + 1));
          await assertCardsHaveClickableRegion(pages, playerA.user.id, [targetId!, ...attachmentIds.slice(0, index + 1)]);
        }
      }

      await accepted('battlefield.stack.created', {
        orderedInstanceIds: stackIds.slice(0, 2),
        rootInstanceId: stackIds[0],
        stackKind: 'land',
      });
      let graph = await assertIdenticalGraph(request, setup);
      const stackId = String(graph.stacks[0]?.['id']);
      await assertProportionalLayout(pages, playerA.user.id, stackIds[0]!, stackIds.slice(1, 2));
      for (let index = 2; index < stackIds.length; index += 1) {
        await accepted('battlefield.stack.member_added', { stackId, instanceId: stackIds[index], index });
        if (index === 3 || index === 7) {
          await assertProportionalLayout(pages, playerA.user.id, stackIds[0]!, stackIds.slice(1, index + 1));
          await assertCardsHaveClickableRegion(pages, playerA.user.id, stackIds.slice(0, index + 1));
        }
      }

      graph = await assertIdenticalGraph(request, setup);
      expect(graph.attachments).toHaveLength(5);
      expect(graph.stacks[0]?.['orderedMemberIds']).toEqual(stackIds);
      expectForbiddenRelationFields(graph);
      const baselineGraph = structuredClone(graph);
      const baselinePositions = positions(await gameSnapshot(request, setup.gameId, playerA.token), allIds);
      await markRelationQaWindow(pageA!, 'baseline-100');
      await pageA!.bringToFront();
      const baselineDpr = await pageA!.evaluate(() => window.devicePixelRatio);
      const matrix: Array<{ browserZoom: number; battlefieldZoom: number; dpr: number; result: 'PASS' }> = [];

      for (const browserZoom of [80, 100, 125, 150] as const) {
        await markRelationQaWindow(pageA!, `zoom-${browserZoom}`);
        await pageA!.bringToFront();
        console.log(`NATIVE_RELATIONS_ZOOM_ACTION zoom=${browserZoom}: set Chrome page zoom to ${browserZoom}% using browser chrome.`);
        await expect.poll(
          () => pageA!.evaluate((baseline) => window.devicePixelRatio / baseline, baselineDpr),
          { timeout: 180_000 },
        ).toBeCloseTo(browserZoom / 100, 2);
        const dpr = await pageA!.evaluate(() => window.devicePixelRatio);
        for (const battlefieldZoom of [70, 100, 140] as const) {
          await setBattlefieldZoom(pageA!, battlefieldZoom);
          expect(await assertIdenticalGraph(request, setup)).toEqual(baselineGraph);
          expect(positions(await gameSnapshot(request, setup.gameId, playerA.token), allIds)).toEqual(baselinePositions);
          await assertProportionalLayout(pages, playerA.user.id, targetId!, attachmentIds);
          await assertProportionalLayout(pages, playerA.user.id, stackIds[0]!, stackIds.slice(1));
          await assertCardsIntersectViewport(pages, playerA.user.id, allIds);
          await assertCardsHaveClickableRegion(pages, playerA.user.id, [targetId!, ...attachmentIds, ...stackIds]);
          await test.info().attach(`relations-browser-${browserZoom}-battlefield-${battlefieldZoom}.png`, {
            body: await pageA!.screenshot(),
            contentType: 'image/png',
          });
          matrix.push({ browserZoom, battlefieldZoom, dpr, result: 'PASS' });
        }
      }

      await markRelationQaWindow(pageA!, 'zoom-100-final');
      await pageA!.bringToFront();
      await expect.poll(
        () => pageA!.evaluate((baseline) => window.devicePixelRatio / baseline, baselineDpr),
        { timeout: 180_000 },
      ).toBeCloseTo(1, 2);
      await setBattlefieldZoom(pageA!, 100);
      expect(await assertIdenticalGraph(request, setup)).toEqual(baselineGraph);
      expect(positions(await gameSnapshot(request, setup.gameId, playerA.token), allIds)).toEqual(baselinePositions);

      for (const corner of [ratio(0.01, 0.12), ratio(0.9, 0.12), ratio(0.01, 0.9), ratio(0.9, 0.9)]) {
        await accepted('card.position.changed', {
          playerId: playerA.user.id,
          zone: 'battlefield',
          instanceId: targetId,
          position: corner,
        });
        await assertProportionalLayout(pages, playerA.user.id, targetId!, attachmentIds);
        await assertCardsIntersectViewport(pages, playerA.user.id, [targetId!, ...attachmentIds]);
        await assertCardsHaveClickableRegion(pages, playerA.user.id, [targetId!, ...attachmentIds]);
      }
      await accepted('card.position.changed', {
        playerId: playerA.user.id,
        zone: 'battlefield',
        instanceId: targetId,
        position: baselinePositions[targetId!],
      });
      for (const corner of [ratio(0.01, 0.12), ratio(0.85, 0.12), ratio(0.01, 0.9), ratio(0.85, 0.9)]) {
        await accepted('card.position.changed', {
          playerId: playerA.user.id,
          zone: 'battlefield',
          instanceId: stackIds[0],
          position: corner,
        });
        await assertProportionalLayout(pages, playerA.user.id, stackIds[0]!, stackIds.slice(1));
        await assertCardsIntersectViewport(pages, playerA.user.id, stackIds);
        await assertCardsHaveClickableRegion(pages, playerA.user.id, stackIds);
      }
      await accepted('card.position.changed', {
        playerId: playerA.user.id,
        zone: 'battlefield',
        instanceId: stackIds[0],
        position: baselinePositions[stackIds[0]!],
      });

      const interactiveAttachment = battlefieldCard(pageA!, playerA.user.id, attachmentIds[4]!);
      const exposedAttachmentPoint = await clickableCardPoint(pageA!, playerA.user.id, attachmentIds[4]!);
      await interactiveAttachment.hover({ position: exposedAttachmentPoint });
      await expect(pageA!.locator('.card-preview-overlay')).toBeVisible({ timeout: 10_000 });
      await interactiveAttachment.click({ button: 'right', position: exposedAttachmentPoint });
      await expect(pageA!.getByTestId('context-menu')).toBeVisible({ timeout: 10_000 });
      await pageA!.keyboard.press('Escape');
      await accepted('card.tapped', { playerId: playerA.user.id, instanceId: targetId, tapped: true });
      expect((await assertIdenticalGraph(request, setup)).attachments).toHaveLength(5);

      const attachmentRelationIds = (await assertIdenticalGraph(request, setup)).attachments.map((item) => String(item['id']));
      await accepted('attachment.reordered', { attachedToInstanceId: targetId, orderedAttachmentIds: attachmentRelationIds.reverse() });
      const detachedAttachment = attachmentIds[4]!;
      await accepted('attachment.removed', { equipmentInstanceId: detachedAttachment, position: ratio(0.48, 0.46) });
      await accepted('attachment.created', { equipmentInstanceId: detachedAttachment, attachedToInstanceId: targetId });
      expect((await assertIdenticalGraph(request, setup)).attachments).toHaveLength(5);

      const reorderedStackIds = [stackIds[0]!, ...stackIds.slice(1).reverse()];
      await accepted('battlefield.stack.reordered', { stackId, orderedInstanceIds: reorderedStackIds, rootInstanceId: stackIds[0] });
      await accepted('battlefield.stack.member_removed', { stackId, instanceId: stackIds[7], position: ratio(0.82, 0.52) });
      await accepted('battlefield.stack.member_added', { stackId, instanceId: stackIds[7], index: 7 });
      const dissolvedPositions = stackIds.map((instanceId, index) => ({
        instanceId,
        position: ratio(0.08 + (index % 4) * 0.2, 0.58 + Math.floor(index / 4) * 0.2),
      }));
      await accepted('battlefield.stack.dissolved', { stackId, positions: dissolvedPositions });
      expect((await assertIdenticalGraph(request, setup)).stacks).toEqual([]);
      expect(new Set(Object.values(positions(await gameSnapshot(request, setup.gameId, playerA.token), stackIds)).map((position) => `${position.x}:${position.y}`)).size).toBe(8);

      await accepted('battlefield.stack.created', { orderedInstanceIds: stackIds, rootInstanceId: stackIds[0], stackKind: 'land' });
      await accepted('card.controller.changed', {
        playerId: playerA.user.id,
        instanceId: stackIds[3],
        targetPlayerId: playerB.user.id,
      });
      expect((await assertIdenticalGraph(request, setup)).stacks).toEqual([]);
      await assertCardsIntersectViewport(pages, playerA.user.id, allIds);
      assertNoRecoveryFailures(audits);
      await test.info().attach('real-relations-browser-zoom-results.json', {
        body: Buffer.from(JSON.stringify({ matrix, finalVersion: version }, null, 2)),
        contentType: 'application/json',
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function relationContext(
  browser: Browser,
  baseURL: string,
  player: PlayerSession,
  viewport: { width: number; height: number },
  zoom: number,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL, viewport, storageState: authStorageState(baseURL, player.user, player.refreshToken) });
  await context.addInitScript(({ key, value }) => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
    window.localStorage.setItem(key, String(value));
  }, { key: ZOOM_STORAGE_KEY, value: zoom });
  return context;
}

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<Setup> {
  const players: PlayerSession[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `rel-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, { ownerToken: session.token, name: `Relations ${index + 1} ${runId.slice(-7)}` });
    players.push({ ...session, deck });
  }
  const roomResponse = await request.post(`${API_BASE_URL}/rooms`, {
    headers: bearer(players[0]!.token),
    data: { deckId: players[0]!.deck.deckId, visibility: 'public', name: `Relations ${runId}`, format: 'commander', maxPlayers: 3, mulliganRule: 'LONDON', firstMulliganFree: true },
  });
  await expectApiOk(roomResponse, 'create relations room');
  const roomId = String(((await roomResponse.json()) as { room?: { id?: string } }).room?.id ?? '');
  for (const player of players.slice(1)) {
    await expectApiOk(await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, { headers: bearer(player.token), data: { deckId: player.deck.deckId } }), 'join relations room');
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const room = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: bearer(players[0]!.token) });
    await expectApiOk(room, 'load relations room');
    const entries = ((await room.json()) as { room?: { players?: Array<{ turnRolls?: number[] }> } }).room?.players ?? [];
    if (entries.length === 3 && entries.every((entry) => (entry.turnRolls?.length ?? 0) > 0) && new Set(entries.map((entry) => entry.turnRolls!.join('-'))).size === 3) break;
    for (const player of players) {
      const roll = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: bearer(player.token) });
      if (!roll.ok() && roll.status() !== 409) await expectApiOk(roll, 'roll relations turn order');
    }
  }
  const start = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: bearer(players[0]!.token) });
  await expectApiOk(start, 'start relations room');
  const gameId = String(((await start.json()) as { game?: { id?: string } }).game?.id ?? '');
  return { gameId, players: players as [PlayerSession, PlayerSession, PlayerSession] };
}

async function sendCommand(
  page: Page,
  websocketUrl: string,
  gameId: string,
  baseVersion: number,
  type: string,
  payload: JsonObject,
  shouldAccept: boolean,
): Promise<JsonObject> {
  expect(containsForbiddenLocalGeometry(payload)).toBe(false);
  const actionId = `relations-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const frames = await page.evaluate(async ({ url, command, expectedActionId }) => {
    const socket = new WebSocket(url);
    const received: JsonObject[] = [];
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const timeout = window.setTimeout(() => rejectPromise(new Error('Runtime websocket connection timeout.')), 20_000);
      socket.addEventListener('open', () => { window.clearTimeout(timeout); resolvePromise(); }, { once: true });
      socket.addEventListener('error', () => { window.clearTimeout(timeout); rejectPromise(new Error('Runtime websocket connection failed.')); }, { once: true });
    });
    return new Promise<JsonObject[]>((resolvePromise, rejectPromise) => {
      const timeout = window.setTimeout(() => rejectPromise(new Error(`Runtime command timeout: ${JSON.stringify(received)}`)), 20_000);
      socket.addEventListener('message', (event) => {
        const frame = JSON.parse(String(event.data)) as JsonObject;
        received.push(frame);
        if ((frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === expectedActionId)
          || (frame['kind'] === 'command_ack' && frame['clientActionId'] === expectedActionId)) {
          window.clearTimeout(timeout);
          socket.close();
          resolvePromise(received);
        }
      });
      socket.send(JSON.stringify(command));
    });
  }, {
    url: websocketUrl,
    command: { kind: 'command.v2', gameId, baseVersion, clientActionId: actionId, messageId: actionId, type, payload },
    expectedActionId: actionId,
  });
  expect(frames.some((frame) => frame['kind'] === 'game_patch' || frame['kind'] === 'resync_required')).toBe(false);
  if (shouldAccept) {
    const patch = frames.find((frame) => frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === actionId);
    if (!patch) throw new Error(`Accepted ${type} emitted no Patch.v2: ${JSON.stringify(frames)}`);
    expect(containsForbiddenLocalGeometry(patch)).toBe(false);
    return patch;
  }
  const ack = frames.find((frame) => frame['kind'] === 'command_ack' && frame['clientActionId'] === actionId);
  if (!ack) throw new Error(`Rejected ${type} emitted no command_ack: ${JSON.stringify(frames)}`);
  expect(ack['status']).toBe('rejected');
  expect(frames.some((frame) => frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === actionId)).toBe(false);
  return ack;
}

async function assertIdenticalGraph(request: APIRequestContext, setup: Setup): Promise<{ attachments: JsonObject[]; stacks: JsonObject[] }> {
  const graphs = await Promise.all(setup.players.map(async (player) => relationGraph(await gameSnapshot(request, setup.gameId, player.token))));
  expect(graphs[1]).toEqual(graphs[0]);
  expect(graphs[2]).toEqual(graphs[0]);
  return graphs[0]!;
}

async function graphState(request: APIRequestContext, setup: Setup, expectedVersion: number): Promise<JsonObject> {
  const snapshot = await gameSnapshot(request, setup.gameId, setup.players[0].token);
  expect(Number(snapshot['version'])).toBe(expectedVersion);
  return { version: snapshot['version'], graph: relationGraph(snapshot), eventCount: Array.isArray(snapshot['eventLog']) ? snapshot['eventLog'].length : 0 };
}

function relationGraph(snapshot: JsonObject): { attachments: JsonObject[]; stacks: JsonObject[] } {
  const relations = snapshot['relations'] as JsonObject | undefined;
  const attachments = objectList(relations?.['attachments'] ?? snapshot['attachments']);
  const stacks = objectList(relations?.['battlefieldStacks'] ?? snapshot['battlefieldStacks']);
  return {
    attachments: attachments.sort((left, right) => Number(left['order'] ?? 0) - Number(right['order'] ?? 0) || String(left['id']).localeCompare(String(right['id']))),
    stacks: stacks.sort((left, right) => String(left['id']).localeCompare(String(right['id']))),
  };
}

function snapshotArrows(snapshot: JsonObject): JsonObject[] {
  return objectList(snapshot['arrows']).sort((left, right) => String(left['id']).localeCompare(String(right['id'])));
}

function assertNoCanonicalRelationReference(snapshot: JsonObject, canonicalInstanceId: string): void {
  const relations = {
    arrows: snapshotArrows(snapshot),
    attachments: relationGraph(snapshot).attachments,
    battlefieldStacks: relationGraph(snapshot).stacks,
  };
  expect(JSON.stringify(relations)).not.toContain(canonicalInstanceId);
}

function objectList(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter((item): item is JsonObject => !!item && typeof item === 'object' && !Array.isArray(item));
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).filter((item): item is JsonObject => !!item && typeof item === 'object' && !Array.isArray(item));
  return [];
}

async function assertProportionalLayout(pages: Page[], ownerId: string, rootId: string, orderedChildren: string[]): Promise<void> {
  await expect.poll(async () => {
    const geometries = await Promise.all(pages.map((page) => relationGeometry(page, ownerId, rootId, orderedChildren)));
    let maxDivergence = 0;
    for (let index = 0; index < orderedChildren.length; index += 1) {
      for (const geometry of geometries.slice(1)) {
        maxDivergence = Math.max(
          maxDivergence,
          Math.abs(geometry[index]!.dx - geometries[0]![index]!.dx),
          Math.abs(geometry[index]!.dy - geometries[0]![index]!.dy),
        );
      }
    }
    return maxDivergence;
  }, { timeout: 20_000 }).toBeLessThan(0.05);
  const geometries = await Promise.all(pages.map((page) => relationGeometry(page, ownerId, rootId, orderedChildren)));
  for (const geometry of geometries) {
    expect(geometry.every((item) => Number.isFinite(item.dx) && Number.isFinite(item.dy))).toBe(true);
    expect(new Set(geometry.map((item) => `${item.dx.toFixed(3)}:${item.dy.toFixed(3)}`)).size).toBe(geometry.length);
  }
  for (let index = 0; index < orderedChildren.length; index += 1) {
    expect(geometries[1]![index]!.dx).toBeCloseTo(geometries[0]![index]!.dx, 1);
    expect(geometries[1]![index]!.dy).toBeCloseTo(geometries[0]![index]!.dy, 1);
    expect(geometries[2]![index]!.dx).toBeCloseTo(geometries[0]![index]!.dx, 1);
    expect(geometries[2]![index]!.dy).toBeCloseTo(geometries[0]![index]!.dy, 1);
  }
}

async function relationGeometry(page: Page, ownerId: string, rootId: string, childIds: string[]): Promise<Array<{ dx: number; dy: number }>> {
  const root = battlefieldCard(page, ownerId, rootId);
  await expect(root).toBeVisible({ timeout: 20_000 });
  const rootBox = await root.boundingBox();
  if (!rootBox) throw new Error(`Missing root box ${rootId}.`);
  return Promise.all(childIds.map(async (instanceId) => {
    const child = battlefieldCard(page, ownerId, instanceId);
    await expect(child).toBeVisible({ timeout: 20_000 });
    const box = await child.boundingBox();
    if (!box) throw new Error(`Missing child box ${instanceId}.`);
    return { dx: (box.x - rootBox.x) / rootBox.width, dy: (box.y - rootBox.y) / rootBox.height };
  }));
}

async function assertIndependentCardNotStacked(pages: Page[], ownerId: string, rootId: string, independentId: string): Promise<void> {
  for (const page of pages) {
    const root = await battlefieldCard(page, ownerId, rootId).boundingBox();
    const independent = await battlefieldCard(page, ownerId, independentId).boundingBox();
    if (!root || !independent) throw new Error('Missing card geometry.');
    expect(Math.abs(independent.x - root.x)).toBeGreaterThan(root.width);
  }
}

async function assertCardsHaveClickableRegion(pages: Page[], ownerId: string, instanceIds: string[]): Promise<void> {
  for (const page of pages) {
    for (const instanceId of instanceIds) {
      const inspect = async () => battlefieldCard(page, ownerId, instanceId).evaluate((element) => {
        const card = element as HTMLElement;
        const rect = card.getBoundingClientRect();
        const points = [0.02, 0.08, 0.5, 0.92, 0.98];
        const hits = points.flatMap((y) => points.map((x) => {
          const hit = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
          const hitCard = hit instanceof Element ? hit.closest<HTMLElement>('[data-testid="game-card"]') : null;
          return {
            x,
            y,
            ownsHit: hit === card || (hit instanceof Node && card.contains(hit)),
            hitInstanceId: hitCard?.dataset['cardInstanceId'] ?? null,
            hitTestId: hit instanceof HTMLElement ? hit.dataset['testid'] ?? null : null,
            hitTag: hit?.nodeName ?? null,
          };
        }));
        return {
          clickable: hits.some((hit) => hit.ownsHit),
          viewport: { width: window.innerWidth, height: window.innerHeight },
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
          className: card.className,
          zIndex: window.getComputedStyle(card).zIndex,
          hits,
        };
      });
      try {
        await expect.poll(async () => (await inspect()).clickable, { timeout: 10_000 }).toBe(true);
      } catch (error) {
        const result = await inspect();
        throw new Error(`${instanceId} has no clickable region: ${JSON.stringify(result)}`, { cause: error });
      }
    }
  }
}

async function clickableCardPoint(page: Page, ownerId: string, instanceId: string): Promise<{ x: number; y: number }> {
  const card = battlefieldCard(page, ownerId, instanceId);
  const inspect = async () => card.evaluate((element) => {
    const target = element as HTMLElement;
    const rect = target.getBoundingClientRect();
    const points = [0.02, 0.08, 0.5, 0.92, 0.98];
    for (const y of points) {
      for (const x of points) {
        const hit = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
        if (hit === target || (hit instanceof Node && target.contains(hit))) {
          return { x: rect.width * x, y: rect.height * y };
        }
      }
    }
    return null;
  });
  await expect.poll(async () => (await inspect()) !== null, { timeout: 10_000 }).toBe(true);
  const point = await inspect();
  if (!point) throw new Error(`Dense relation card ${instanceId} has no exposed interaction point.`);
  return point;
}

async function assertCardsIntersectViewport(pages: Page[], ownerId: string, instanceIds: string[]): Promise<void> {
  for (const page of pages) {
    const geometry = await page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerId}"]`).evaluateAll(
      (elements, expectedIds) => elements
        .filter((element) => expectedIds.includes((element as HTMLElement).dataset['cardInstanceId'] ?? ''))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            instanceId: (element as HTMLElement).dataset['cardInstanceId'] ?? '',
            intersects: rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight,
          };
        }),
      instanceIds,
    );
    expect(geometry).toHaveLength(instanceIds.length);
    expect(geometry.every((item) => item.intersects)).toBe(true);
  }
}

async function expectAllCardsVisible(pages: Page[], ownerId: string, instanceIds: string[]): Promise<void> {
  await Promise.all(pages.flatMap((page) => instanceIds.map((instanceId) => expect(battlefieldCard(page, ownerId, instanceId)).toBeVisible({ timeout: 20_000 }))));
}

function expectForbiddenRelationFields(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(/cardKey|cardRef|printId|imageUris|cardFaces|printedStats|oracleText|viewport|browserZoom|battlefieldZoom|devicePixelRatio|domRect|pointer|offsetX|offsetY|cardWidth|cardHeight/);
}

function containsForbiddenLocalGeometry(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenLocalGeometry);
  if (!value || typeof value !== 'object') return false;
  const forbidden = /^(px|viewport|browserZoom|battlefieldZoom|zoom|zoomPercent|devicePixelRatio|rawPointer|domOffset|offsetX|offsetY|cardWidth|cardHeight)$/i;
  return Object.entries(value as JsonObject).some(([key, child]) => forbidden.test(key) || containsForbiddenLocalGeometry(child));
}

function createAudit(page: Page): BrowserAudit {
  const audit: BrowserAudit = { frames: [], errors: [] };
  page.on('websocket', (socket) => socket.on('framereceived', (event) => {
    try { audit.frames.push(JSON.parse(typeof event.payload === 'string' ? event.payload : event.payload.toString('utf8')) as JsonObject); } catch { /* ignore non-JSON */ }
  }));
  page.on('pageerror', (error) => audit.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') audit.errors.push(message.text()); });
  return audit;
}

function assertNoRecoveryFailures(audits: BrowserAudit[]): void {
  for (const audit of audits) {
    expect(audit.frames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
    expect(audit.frames.some((frame) => frame['kind'] === 'resync_required')).toBe(false);
    expect(JSON.stringify(audit.frames)).not.toMatch(/target_not_found|unknown card/i);
    expect(audit.errors.filter((error) => /target_not_found|resync_required|unknown card/i.test(error))).toEqual([]);
  }
}

async function focusOwner(page: Page, playerId: string, displayName: string): Promise<void> {
  if (await page.getByTestId('player-panel').getAttribute('data-player-id').catch(() => null) === playerId) return;
  const mini = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`).first();
  if (await mini.count()) {
    await mini.evaluate((element) => (element as HTMLElement).click());
    await expect.poll(() => page.getByTestId('player-panel').getAttribute('data-player-id'), { timeout: 10_000 }).toBe(playerId);
    return;
  }
  await focusPlayer(page, displayName);
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

async function markRelationQaWindow(page: Page, stage: string): Promise<void> {
  await page.evaluate((label) => { document.title = `CZ Relations QA A ${label}`; }, stage);
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: bearer(token) });
  await expectApiOk(response, 'load game snapshot');
  return ((await response.json()) as { game?: { snapshot?: JsonObject } }).game?.snapshot ?? {};
}

async function websocketTicket(request: APIRequestContext, gameId: string, token: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, { headers: bearer(token) });
  await expectApiOk(response, 'create websocket ticket');
  const payload = await response.json() as { route?: string; websocketUrl?: string };
  expect(payload.route).toBe('runtime_ws');
  if (!payload.websocketUrl) throw new Error('Runtime websocket URL missing.');
  return payload.websocketUrl;
}

async function waitForSnapshotVersion(request: APIRequestContext, gameId: string, token: string, version: number): Promise<void> {
  await expect.poll(async () => Number((await gameSnapshot(request, gameId, token))['version']), { timeout: 20_000 }).toBe(version);
}

async function assertServicesReady(request: APIRequestContext): Promise<void> {
  await Promise.all(SERVICE_URLS.map(async (url) => {
    await expect.poll(async () => {
      try {
        return (await request.get(url, { timeout: 10_000 })).ok();
      } catch {
        return false;
      }
    }, { timeout: 60_000, message: `${url} did not become ready` }).toBe(true);
  }));
}

async function restartRuntime(): Promise<void> {
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], { cwd: resolve(process.cwd(), '..'), timeout: 60_000, windowsHide: true });
}

function battlefieldCard(page: Page, ownerId: string, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerId}"][data-card-instance-id="${instanceId}"]`);
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
      const found = cards.find((card) => card['instanceId'] === instanceId);
      if (found) return found;
    }
  }
  return undefined;
}

function findOpaqueBattlefieldCard(snapshot: JsonObject, ownerId: string, expectedPosition: RatioPosition): JsonObject | undefined {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[ownerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return (zones?.['battlefield'] ?? []).find((card) => {
    const position = card['position'] as RatioPosition | undefined;
    return card['hidden'] === true
      && card['faceDown'] === true
      && position?.x === expectedPosition.x
      && position?.y === expectedPosition.y;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function positions(snapshot: JsonObject, instanceIds: string[]): Record<string, RatioPosition> {
  return Object.fromEntries(instanceIds.map((instanceId) => {
    const position = findCard(snapshot, instanceId)?.['position'] as RatioPosition | undefined;
    expect(position?.['unit']).toBe('ratio');
    expect(Number.isFinite(position?.['x']) && Number(position?.['x']) >= 0 && Number(position?.['x']) <= 1).toBe(true);
    expect(Number.isFinite(position?.['y']) && Number(position?.['y']) >= 0 && Number(position?.['y']) <= 1).toBe(true);
    return [instanceId, position!];
  }));
}

function ratio(x: number, y: number): RatioPosition {
  return { x, y, unit: 'ratio' };
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function expectApiOk(response: { ok(): boolean; status(): number; text(): Promise<string> }, action: string): Promise<void> {
  if (!response.ok()) throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
