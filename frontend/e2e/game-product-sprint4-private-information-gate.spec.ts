import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;
type Player = Awaited<ReturnType<typeof createRealUserSession>> & { deckId: string };
type Setup = { gameId: string; players: Player[] };
type MotionAudit = { kind: string; count: number; mode: string };
type PageAudit = { frames: JsonObject[]; recoveryRequests: string[]; errors: string[]; diagnostics: string[] };
type WindowContract = { windowId: string; expectedEpoch: number; instanceIds: string[] };
type EventStoreState = { count: number; maxVersion: number };

test.describe('Gameplay 1.0 Sprint 4F integrated private-information release gate', () => {
  test.describe.configure({ mode: 'serial' });

  test('3P integrates View X, authoritative batches, hand reveals, motion, tabs and recovery', async ({ browser, request, baseURL }) => {
    test.setTimeout(1_500_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');

    await assertInfrastructureReady(request);
    const setup = await createGame(request, 3, `s4fcore${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const contexts = await createContexts(browser, baseURL, setup, { width: 1180, height: 820 });
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const audits = pages.map(auditPage);
    pages.forEach((page) => page.setDefaultTimeout(25_000));

    try {
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await expectStablePresence(request, setup, pages, audits);

      const [owner, target, third] = pages as [Page, Page, Page];
      await expect(owner.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', 'compact');
      const ownerId = setup.players[0]!.user.id;
      const targetId = setup.players[1]!.user.id;
      const thirdId = setup.players[2]!.user.id;
      const ownerInitial = await snapshot(request, setup, 0);
      const libraryInitial = zoneIds(ownerInitial, ownerId, 'library');
      const handInitial = zoneIds(ownerInitial, ownerId, 'hand');
      if (libraryInitial.length < 10 || handInitial.length < 6) {
        throw new Error(`Sprint 4F requires library>=10 and hand>=6; library=${libraryInitial.length} hand=${handInitial.length}.`);
      }
      const liveRecoveryBaseline = audits.map((audit) => audit.recoveryRequests.length);

      await openEntireView(owner);
      const entireWindow = latestWindowContract(audits[0]!);
      expect(entireWindow.instanceIds).toEqual(libraryInitial);
      expect(await modalCardIds(owner)).toEqual(libraryInitial);
      for (let viewerIndex = 1; viewerIndex < setup.players.length; viewerIndex += 1) {
        const projection = JSON.stringify(await snapshot(request, setup, viewerIndex));
        libraryInitial.forEach((instanceId) => expect(projection).not.toContain(instanceId));
      }
      await owner.keyboard.press('Escape');
      await expect(owner.getByTestId('zone-modal')).toHaveCount(0);

      await openTopView(owner, 5);
      const firstWindow = latestWindowContract(audits[0]!);
      expect(firstWindow.instanceIds).toEqual(libraryInitial.slice(0, 5));
      expect(await modalCardIds(owner)).toEqual(firstWindow.instanceIds);
      await selectModalIds(owner, [firstWindow.instanceIds[0]!]);

      const secondOwnerTab = await contexts[0]!.newPage();
      secondOwnerTab.setDefaultTimeout(25_000);
      const secondOwnerAudit = auditPage(secondOwnerTab);
      await secondOwnerTab.goto(`/games/${setup.gameId}`);
      await expect(secondOwnerTab.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      expect(await secondOwnerTab.locator('[data-view-x-selected="true"]').count()).toBe(0);
      await openTopView(secondOwnerTab, 5);
      const activeWindow = latestWindowContract(secondOwnerAudit);
      expect(activeWindow.windowId).not.toBe(firstWindow.windowId);
      await expect(owner.getByTestId('zone-modal-status')).toBeVisible({ timeout: 30_000 });
      await expect(owner.locator('[data-testid="zone-modal"] [data-card-instance-id]')).toHaveCount(0);
      await expect(owner.locator('[data-testid="zone-modal"] [data-view-x-selected="true"]')).toHaveCount(0);

      const beforeStale = await snapshot(request, setup, 0);
      const staleStore = await eventStoreState(setup.gameId);
      const stale = await sendRuntimeRaw(request, setup, 0, {
        kind: 'command.v2', gameId: setup.gameId, messageId: 's4f-stale-window', clientActionId: 's4f-stale-window',
        baseVersion: Number(beforeStale['version'] ?? 0), type: 'library.selection.move',
        payload: {
          playerId: ownerId, windowId: firstWindow.windowId, expectedEpoch: firstWindow.expectedEpoch,
          orderedInstanceIds: [firstWindow.instanceIds[0]], toZone: 'hand',
        },
      });
      expect(stale['kind']).toBe('command_ack');
      expect(stale['status']).toBe('rejected');
      expect(['LIBRARY_WINDOW_STALE', 'LIBRARY_WINDOW_NOT_FOUND', 'LIBRARY_EPOCH_MISMATCH'])
        .toContain((stale['error'] as JsonObject | undefined)?.['code']);
      expect(Number((await snapshot(request, setup, 0))['version'] ?? 0)).toBe(Number(beforeStale['version'] ?? 0));
      expect(await eventStoreState(setup.gameId)).toEqual(staleStore);
      await closeStaleModal(owner);

      const selectedFaceDown = activeWindow.instanceIds.slice(0, 2);
      await selectModalIds(secondOwnerTab, selectedFaceDown);
      const beforeBatch = await snapshot(request, setup, 0);
      const batchStore = await eventStoreState(setup.gameId);
      await confirmAction(secondOwnerTab, 'battlefield-face-down', 2);
      const afterBatch = await snapshot(request, setup, 0);
      expect(Number(afterBatch['version'] ?? 0)).toBe(Number(beforeBatch['version'] ?? 0) + 1);
      expect(await eventStoreState(setup.gameId)).toEqual({ count: batchStore.count + 1, maxVersion: batchStore.maxVersion + 1 });
      const battlefieldCards = zoneCards(afterBatch, ownerId, 'battlefield')
        .filter((card) => selectedFaceDown.includes(String(card['instanceId'] ?? '')));
      expect(battlefieldCards).toHaveLength(2);
      battlefieldCards.forEach((card) => {
        expect(card['faceDown']).toBe(true);
        expectRatioPosition(card['position']);
      });
      expect(new Set(battlefieldCards.map((card) => JSON.stringify(card['position']))).size).toBe(2);
      await assertPrivateIdsAbsent([target, third], [audits[1]!, audits[2]!], selectedFaceDown);
      for (const viewerIndex of [1, 2]) {
        const projected = await snapshot(request, setup, viewerIndex);
        const serialized = JSON.stringify(projected);
        selectedFaceDown.forEach((instanceId) => expect(serialized).not.toContain(instanceId));
        expect(zoneIds(projected, ownerId, 'battlefield').some((id) => id.startsWith(`${ownerId}-hidden-battlefield-`))).toBe(true);
      }
      await expect.poll(() => secondOwnerAudit.frames.some((frame) =>
        frame['kind'] === 'patch.v2' && Number(frame['version'] ?? 0) === Number(afterBatch['version'] ?? 0),
      )).toBe(true);
      expectRecoveryCounts(audits, liveRecoveryBaseline, 'after library face-down batch');

      const revealCards = zoneIds(afterBatch, ownerId, 'hand').slice(0, 3);
      await openOpponentsDrawer(target);
      await acceptedCommand(request, setup, 0, 'hand.cards.reveal', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [revealCards[0]!], to: targetId,
      }, 's4f-reveal-one-b');
      await expect.poll(() => revealIndicatorCount(target, ownerId)).toBe(1);
      expect(await revealIndicatorCount(third, ownerId)).toBe(0);
      await expect.poll(async () => (await motionAudit(target)).some((entry) => entry.kind === 'indicator')).toBe(true);
      expectRecoveryCounts(audits, liveRecoveryBaseline, 'after single-target reveal');

      const targetIndicator = await visibleIndicator(target, ownerId);
      await targetIndicator.click();
      const targetPanel = target.getByTestId('active-reveal-panel');
      await expect(targetPanel).toHaveAttribute('role', 'dialog');
      await expect(targetPanel).toHaveAttribute('aria-modal', 'true');
      await expect(targetPanel.locator('[data-card-instance-id]')).toHaveCount(1);

      const revealBefore = await snapshot(request, setup, 0);
      const revealStore = await eventStoreState(setup.gameId);
      const revealMessage = {
        kind: 'command.v2', gameId: setup.gameId, messageId: 's4f-reveal-batch-b', clientActionId: 's4f-reveal-batch-b',
        baseVersion: Number(revealBefore['version'] ?? 0), type: 'hand.cards.reveal',
        payload: { playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: revealCards.slice(1), to: targetId },
      } satisfies JsonObject;
      const reveal = await sendRuntimeRaw(request, setup, 0, revealMessage);
      expect(reveal['kind']).toBe('patch.v2');
      const revealAfter = await snapshot(request, setup, 0);
      expect(Number(revealAfter['version'] ?? 0)).toBe(Number(revealBefore['version'] ?? 0) + 1);
      expect(await eventStoreState(setup.gameId)).toEqual({ count: revealStore.count + 1, maxVersion: revealStore.maxVersion + 1 });
      await expect.poll(() => revealIndicatorCount(target, ownerId)).toBe(3);
      await expect(targetPanel.locator('[data-card-instance-id]')).toHaveCount(3);
      await expect.poll(async () => (await motionAudit(target)).some((entry) => entry.kind === 'materialize' && entry.count === 2)).toBe(true);
      const targetMaterializeCount = (await motionAudit(target)).filter((entry) => entry.kind === 'materialize').length;

      const retry = await sendRuntimeRaw(request, setup, 0, revealMessage);
      expect(retry['kind']).toBe('patch.v2');
      expect(Number((await snapshot(request, setup, 0))['version'] ?? 0)).toBe(Number(revealAfter['version'] ?? 0));
      expect(await eventStoreState(setup.gameId)).toEqual({ count: revealStore.count + 1, maxVersion: revealStore.maxVersion + 1 });
      expect((await motionAudit(target)).filter((entry) => entry.kind === 'materialize')).toHaveLength(targetMaterializeCount);
      expectRecoveryCounts(audits, liveRecoveryBaseline, 'after batch reveal retry');

      await expect(targetPanel.getByTestId('active-reveal-recipients')).toHaveCount(0);
      await target.keyboard.press('ArrowRight');
      await expect.poll(() => target.evaluate(() => document.activeElement?.getAttribute('data-card-instance-id') ?? '')).not.toBe('');
      await expectNoGlobalOverflow(target);
      await target.keyboard.press('Escape');
      await expect(targetPanel).toHaveCount(0);
      await expect(targetIndicator).toBeFocused();

      await acceptedCommand(request, setup, 0, 'hand.cards.reveal', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: revealCards, to: [targetId, thirdId],
      }, 's4f-expand-bc');
      await expect.poll(() => revealIndicatorCount(third, ownerId)).toBe(3);
      expect((await motionAudit(target)).filter((entry) => entry.kind === 'materialize')).toHaveLength(targetMaterializeCount);
      expectRecoveryCounts(audits, liveRecoveryBaseline, 'after multiviewer expansion');

      await acceptedCommand(request, setup, 0, 'hand.cards.revoke', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [revealCards[0]!], to: targetId,
      }, 's4f-revoke-one-b');
      await expect.poll(() => revealIndicatorCount(target, ownerId)).toBe(2);
      await expect.poll(() => revealIndicatorCount(third, ownerId)).toBe(3);
      await expect.poll(async () => (await motionAudit(target)).some((entry) => entry.kind === 'conceal' && entry.count === 1)).toBe(true);
      expectRecoveryCounts(audits, liveRecoveryBaseline, 'after partial revoke');

      await expect.poll(() => revealIndicatorCount(owner, ownerId)).toBe(3);
      await (await visibleIndicator(owner, ownerId)).click();
      await expect(owner.getByTestId('active-reveal-recipients')).toBeVisible();
      await expect(owner.getByTestId('active-reveal-panel').getByRole('button', { name: /manage|gestionar/i })).toBeVisible();
      await owner.keyboard.press('Escape');

      const secondTargetTab = await contexts[1]!.newPage();
      secondTargetTab.setDefaultTimeout(25_000);
      const secondTargetAudit = auditPage(secondTargetTab);
      await secondTargetTab.goto(`/games/${setup.gameId}`);
      await expect(secondTargetTab.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => revealIndicatorCount(secondTargetTab, ownerId)).toBe(2);
      expect(await motionAudit(secondTargetTab)).toEqual([]);

      await third.emulateMedia({ reducedMotion: 'reduce' });
      await (await visibleIndicator(third, ownerId)).click();
      await expect(third.getByTestId('active-reveal-panel')).toBeVisible();
      const reducedCard = zoneIds(await snapshot(request, setup, 0), ownerId, 'hand')
        .find((instanceId) => !revealCards.includes(instanceId));
      if (!reducedCard) throw new Error('Sprint 4F could not find a spare hand card for reduced motion.');
      await acceptedCommand(request, setup, 0, 'hand.cards.reveal', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [reducedCard], to: thirdId,
      }, 's4f-reduced-reveal');
      await expect.poll(() => revealIndicatorCount(third, ownerId)).toBe(4);
      await expect.poll(async () => (await motionAudit(third)).some((entry) =>
        entry.kind === 'materialize' && entry.count === 1 && entry.mode === 'reduced',
      )).toBe(true);
      await third.keyboard.press('Escape');
      expectRecoveryCounts(audits, liveRecoveryBaseline, 'after reduced-motion reveal');

      await acceptedCommand(request, setup, 0, 'hand.cards.revoke', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: revealCards.slice(1), to: targetId,
      }, 's4f-revoke-rest-b');
      await expect.poll(() => revealIndicatorCount(target, ownerId)).toBe(0);
      await expect.poll(() => revealIndicatorCount(secondTargetTab, ownerId)).toBe(0);
      await expect(secondTargetTab.getByTestId('active-reveal-panel')).toHaveCount(0);

      expectRecoveryCounts(audits, liveRecoveryBaseline, 'after full target revoke');
      [...audits, secondOwnerAudit, secondTargetAudit].forEach(assertCleanAudit);

      const beforeContinuity = await Promise.all(setup.players.map((_, index) => snapshot(request, setup, index)));
      await owner.reload();
      await expect(owner.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await expect(owner.getByTestId('zone-modal')).toHaveCount(0);
      await target.reload();
      await expect(target.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      expect(await motionAudit(target)).toEqual([]);
      await contexts[2]!.setOffline(true);
      await contexts[2]!.setOffline(false);
      await expect.poll(() => third.getByTestId('game-screen').count(), { timeout: 45_000 }).toBe(1);
      await restartRuntime(request);
      const afterRestart = await Promise.all(setup.players.map((_, index) => snapshot(request, setup, index)));
      afterRestart.forEach((state, index) => expect(canonicalPrivateState(state, ownerId)).toEqual(canonicalPrivateState(beforeContinuity[index]!, ownerId)));
      expect((await motionAudit(target)).filter((entry) => entry.kind === 'materialize')).toHaveLength(0);

      const publicLogs = await Promise.all([1, 2].map(async (index) => JSON.stringify((await snapshot(request, setup, index))['eventLog'] ?? [])));
      for (const log of publicLogs) {
        selectedFaceDown.forEach((instanceId) => expect(log).not.toContain(instanceId));
        expect(log).not.toMatch(/cardKey|cardRef|printId|imageUris|cardFaces|viewerMask|visibleToMask|Unknown Card/i);
      }
      await assertPrivateIdsAbsent([target, third], [audits[1]!, audits[2]!], selectedFaceDown);

      const beforeClose = await snapshot(request, setup, 0);
      await acceptedCommand(request, setup, 0, 'game.close', {}, 's4f-game-close');
      const closed = await snapshot(request, setup, 0);
      const closedStore = await eventStoreState(setup.gameId);
      const rejectedClosed = await sendRuntimeRaw(request, setup, 0, {
        kind: 'command.v2', gameId: setup.gameId, messageId: 's4f-closed-reveal', clientActionId: 's4f-closed-reveal',
        baseVersion: Number(closed['version'] ?? 0), type: 'hand.cards.reveal',
        payload: { playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [reducedCard], to: targetId },
      });
      expect(rejectedClosed['kind']).toBe('command_ack');
      expect(rejectedClosed['status']).toBe('rejected');
      expect(['GAME_CLOSED', 'INVALID_GAME_STATUS']).toContain((rejectedClosed['error'] as JsonObject | undefined)?.['code']);
      expect(Number((await snapshot(request, setup, 0))['version'] ?? 0)).toBe(Number(closed['version'] ?? 0));
      expect(await eventStoreState(setup.gameId)).toEqual(closedStore);
      expect(Number(closed['version'] ?? 0)).toBe(Number(beforeClose['version'] ?? 0) + 1);

      await secondTargetTab.close();
      await secondOwnerTab.close();
      await assertInfrastructureReady(request);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });

  for (const scenario of [
    { playerCount: 2, viewport: { width: 1600, height: 1000 }, state: 'normal', touch: false, topFaceDown: 1 },
    { playerCount: 4, viewport: { width: 900, height: 600 }, state: 'aggressive', touch: false, topFaceDown: 3 },
    { playerCount: 5, viewport: { width: 650, height: 480 }, state: 'minimal', touch: true, topFaceDown: 0 },
    { playerCount: 6, viewport: { width: 650, height: 480 }, state: 'minimal', touch: false, topFaceDown: 5 },
  ] as const) {
    test(`${scenario.playerCount}P combines private library movement and viewer-local reveal UI in ${scenario.state}`, async ({ browser, request, baseURL }) => {
      test.setTimeout(900_000);
      if (!baseURL) throw new Error('Playwright baseURL is required.');
      const setup = await createGame(request, scenario.playerCount, `s4f${scenario.playerCount}p${Date.now().toString(36)}`);
      await resolveGameToPlaying(request, setup.gameId, setup.players);
      const contexts = await createContexts(browser, baseURL, setup, scenario.viewport, scenario.touch);
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const audits = pages.map(auditPage);
      pages.forEach((page) => page.setDefaultTimeout(25_000));
      try {
        await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
        await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
        await expectStablePresence(request, setup, pages, audits);
        const owner = pages[0]!;
        const target = pages[1]!;
        const ownerId = setup.players[0]!.user.id;
        const targetId = setup.players[1]!.user.id;
        await expect(owner.getByTestId('game-screen')).toHaveAttribute('data-player-count', String(scenario.playerCount));
        await expect(owner.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', scenario.state);

        const beforeOpen = await snapshot(request, setup, 0);
        const topThree = zoneIds(beforeOpen, ownerId, 'library').slice(0, 3);
        await openTopView(owner, 3);
        const window = latestWindowContract(audits[0]!);
        expect(window.instanceIds).toEqual(topThree);
        await selectModalIds(owner, [window.instanceIds[0]!], scenario.touch);
        const beforeBatch = await snapshot(request, setup, 0);
        await confirmAction(owner, 'battlefield-face-down', 1, scenario.touch);
        const afterMove = await snapshot(request, setup, 0);
        expect(Number(afterMove['version'] ?? 0)).toBe(Number(beforeBatch['version'] ?? 0) + 1);
        expectRatioPosition(zoneCards(afterMove, ownerId, 'battlefield').find((card) => card['instanceId'] === window.instanceIds[0])?.['position']);
        const privateFaceDownIds = [window.instanceIds[0]!];
        for (let viewerIndex = 1; viewerIndex < setup.players.length; viewerIndex += 1) {
          expect(JSON.stringify(await snapshot(request, setup, viewerIndex))).not.toContain(window.instanceIds[0]!);
        }

        if (scenario.topFaceDown > 0) {
          await openTopView(owner, scenario.topFaceDown);
          const topWindow = latestWindowContract(audits[0]!);
          expect(topWindow.instanceIds).toHaveLength(scenario.topFaceDown);
          const beforeTopBatch = await snapshot(request, setup, 0);
          const beforeTopStore = await eventStoreState(setup.gameId);
          await confirmTopFaceDown(owner, scenario.topFaceDown);
          const afterTopBatch = await snapshot(request, setup, 0);
          expect(Number(afterTopBatch['version'] ?? 0)).toBe(Number(beforeTopBatch['version'] ?? 0) + 1);
          expect(await eventStoreState(setup.gameId)).toEqual({
            count: beforeTopStore.count + 1,
            maxVersion: beforeTopStore.maxVersion + 1,
          });
          const battlefield = zoneCards(afterTopBatch, ownerId, 'battlefield');
          for (const instanceId of topWindow.instanceIds) {
            const card = battlefield.find((entry) => entry['instanceId'] === instanceId);
            expect(card?.['faceDown']).toBe(true);
            expectRatioPosition(card?.['position']);
            privateFaceDownIds.push(instanceId);
          }
          for (let viewerIndex = 1; viewerIndex < setup.players.length; viewerIndex += 1) {
            const projection = JSON.stringify(await snapshot(request, setup, viewerIndex));
            privateFaceDownIds.forEach((instanceId) => expect(projection).not.toContain(instanceId));
          }
        }

        const revealCard = zoneIds(afterMove, ownerId, 'hand')[0]!;
        await acceptedCommand(request, setup, 0, 'hand.cards.reveal', {
          playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [revealCard], to: targetId,
        }, `s4f-${scenario.playerCount}p-reveal`);
        await expect.poll(() => revealIndicatorCount(target, ownerId)).toBe(1);
        for (let viewerIndex = 2; viewerIndex < pages.length; viewerIndex += 1) {
          expect(await revealIndicatorCount(pages[viewerIndex]!, ownerId)).toBe(0);
          expect(await unauthorizedDomContains(pages[viewerIndex]!, [revealCard, ...privateFaceDownIds])).toBe(false);
        }
        const publicLog = JSON.stringify((await snapshot(request, setup, 1))['eventLog'] ?? []);
        privateFaceDownIds.forEach((instanceId) => expect(publicLog).not.toContain(instanceId));
        const indicator = await visibleIndicator(target, ownerId);
        if (scenario.touch) await indicator.tap();
        else await indicator.click();
        await expect(target.getByTestId('active-reveal-panel').locator('[data-card-instance-id]')).toHaveCount(1);
        await expectWithinViewport(target, target.getByTestId('active-reveal-panel'));
        await expectNoGlobalOverflow(target);
        await target.keyboard.press('Escape');
        await expect(indicator).toBeFocused();

        await acceptedCommand(request, setup, 0, 'hand.cards.revoke', {
          playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [revealCard], to: targetId,
        }, `s4f-${scenario.playerCount}p-revoke`);
        await expect.poll(() => revealIndicatorCount(target, ownerId)).toBe(0);
        audits.forEach(assertCleanAudit);
      } finally {
        await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
      }
    });
  }

  test('native Chrome zoom keeps Sprint 4 private-information surfaces usable', async ({ browser, request, baseURL }) => {
    test.skip(process.env['E2E_MANUAL_SPRINT4_ZOOM'] !== '1', 'Run headed and set native Chrome zoom to 80/100/125/150 when prompted.');
    test.setTimeout(25 * 60_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const setup = await createGame(request, 3, `s4fzoom${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const contexts = await createContexts(browser, baseURL, setup, { width: 1180, height: 820 });
    try {
      const owner = await contexts[0]!.newPage();
      const target = await contexts[1]!.newPage();
      await Promise.all([owner.goto(`/games/${setup.gameId}`), target.goto(`/games/${setup.gameId}`)]);
      const ownerId = setup.players[0]!.user.id;
      const targetId = setup.players[1]!.user.id;
      const revealCard = zoneIds(await snapshot(request, setup, 0), ownerId, 'hand')[0]!;
      await acceptedCommand(request, setup, 0, 'hand.cards.reveal', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [revealCard], to: targetId,
      }, 's4f-zoom-reveal');
      const baseDpr = await owner.evaluate(() => devicePixelRatio);
      for (const zoom of [80, 100, 125, 150]) {
        console.log(`NATIVE_SPRINT4_ZOOM_ACTION zoom=${zoom}: set Chrome page zoom to ${zoom}%.`);
        await expect.poll(() => owner.evaluate((base) => devicePixelRatio / base, baseDpr), { timeout: 180_000 }).toBeCloseTo(zoom / 100, 2);
        await openTopView(owner, 3);
        await expectWithinNativeViewport(owner, owner.getByTestId('zone-modal'));
        await owner.getByTestId('zone-modal-close').click();
        await (await visibleIndicator(target, ownerId)).click();
        await expectWithinNativeViewport(target, target.getByTestId('active-reveal-panel'));
        await target.keyboard.press('Escape');
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function acceptedCommand(
  request: APIRequestContext,
  setup: Setup,
  playerIndex: number,
  type: string,
  payload: JsonObject,
  clientActionId: string,
): Promise<JsonObject> {
  const before = await snapshot(request, setup, 0);
  const store = await eventStoreState(setup.gameId);
  const frame = await sendRuntimeRaw(request, setup, playerIndex, {
    kind: 'command.v2', gameId: setup.gameId, messageId: clientActionId, clientActionId,
    baseVersion: Number(before['version'] ?? 0), type, payload,
  });
  expect(frame['kind']).toBe('patch.v2');
  const after = await snapshot(request, setup, 0);
  expect(Number(after['version'] ?? 0)).toBe(Number(before['version'] ?? 0) + 1);
  expect(await eventStoreState(setup.gameId)).toEqual({ count: store.count + 1, maxVersion: store.maxVersion + 1 });
  return frame;
}

async function openTopView(page: Page, count: number): Promise<void> {
  const library = page.locator('[data-testid="drop-zone"][data-zone="library"]').first();
  await expect(library).toBeVisible();
  await library.click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: /^view$/i }).click();
  await expect(menu.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: /look at top x cards/i }).click();
  await page.getByTestId('number-action-input').fill(String(count));
  await page.getByTestId('number-action-confirm').click();
  await expect(page.getByTestId('zone-modal')).toHaveAttribute('data-lifecycle', 'ready', { timeout: 30_000 });
  await expect(page.locator('[data-testid="zone-modal"] [data-card-instance-id]')).toHaveCount(count);
}

async function openEntireView(page: Page): Promise<void> {
  const library = page.locator('[data-testid="drop-zone"][data-zone="library"]').first();
  await expect(library).toBeVisible();
  await library.click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: /^view$/i }).click();
  await expect(menu.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: /^view library$/i }).click();
  await expect(page.getByTestId('zone-modal')).toHaveAttribute('data-lifecycle', 'ready', { timeout: 30_000 });
}

async function selectModalIds(page: Page, ids: readonly string[], touch = false): Promise<void> {
  for (const instanceId of ids) {
    const card = page.locator(`[data-testid="zone-modal"] [data-card-instance-id="${instanceId}"]`);
    if (touch) await card.tap();
    else await card.click();
  }
  await expect(page.locator('[data-testid="zone-modal"] [data-view-x-selected="true"]')).toHaveCount(ids.length);
}

async function confirmAction(page: Page, action: string, count: number, touch = false): Promise<void> {
  const actionButton = page.getByTestId(`zone-modal-action-${action}`);
  if (touch) await actionButton.tap();
  else await actionButton.click();
  const confirmation = page.getByTestId('zone-modal-batch-confirmation');
  await expect(confirmation).toHaveAttribute('role', 'alertdialog');
  await expect(confirmation).toContainText(String(count));
  const confirmButton = page.getByTestId('zone-modal-batch-confirm');
  if (touch) await confirmButton.tap();
  else await confirmButton.click();
  await expect(page.getByTestId('zone-modal')).toHaveCount(0, { timeout: 30_000 });
}

async function confirmTopFaceDown(page: Page, count: number): Promise<void> {
  await page.getByTestId('zone-modal-action-top-face-down').click();
  const confirmation = page.getByTestId('zone-modal-batch-confirmation');
  await expect(confirmation).toHaveAttribute('role', 'alertdialog');
  await expect(confirmation).toContainText(String(count));
  await page.getByTestId('zone-modal-batch-confirm').click();
  await expect(page.getByTestId('zone-modal')).toHaveCount(0, { timeout: 30_000 });
}

function latestWindowContract(audit: PageAudit): WindowContract {
  for (let frameIndex = audit.frames.length - 1; frameIndex >= 0; frameIndex -= 1) {
    const operations = audit.frames[frameIndex]?.['ops'];
    if (!Array.isArray(operations)) continue;
    for (const raw of [...operations].reverse()) {
      const operation = raw as JsonObject;
      if (operation['op'] !== 'library.top.viewed') continue;
      const cards = Array.isArray(operation['cards']) ? operation['cards'] as JsonObject[] : [];
      return {
        windowId: String(operation['windowId'] ?? ''),
        expectedEpoch: Number(operation['expectedEpoch'] ?? -1),
        instanceIds: cards.map((card) => String(card['instanceId'] ?? '')).filter(Boolean),
      };
    }
  }
  throw new Error('Owner did not receive an authoritative library.top.viewed window.');
}

async function modalCardIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid="zone-modal"] [data-card-instance-id]').evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset['cardInstanceId'] ?? ''),
  );
}

async function closeStaleModal(page: Page): Promise<void> {
  if (await page.getByTestId('zone-modal').count()) {
    await page.getByTestId('zone-modal-close').click();
    await expect(page.getByTestId('zone-modal')).toHaveCount(0);
  }
}

async function visibleIndicator(page: Page, ownerPlayerId: string): Promise<Locator> {
  await openOpponentsDrawer(page);
  const indicator = page.locator(`[data-reveal-indicator-owner="${ownerPlayerId}"]:visible`).first();
  await expect(indicator).toBeVisible();
  return indicator;
}

async function openOpponentsDrawer(page: Page): Promise<void> {
  const toggle = page.getByTestId('opponents-drawer-toggle');
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
}

async function revealIndicatorCount(page: Page, ownerPlayerId: string): Promise<number> {
  const indicators = page.locator(`[data-reveal-indicator-owner="${ownerPlayerId}"]`);
  if (await indicators.count() === 0) return 0;
  return Number((await indicators.first().textContent())?.trim() ?? 0);
}

async function motionAudit(page: Page): Promise<MotionAudit[]> {
  return page.evaluate(() => {
    const auditWindow = window as Window & { __czRevealMotionAudit?: MotionAudit[] };
    return (auditWindow.__czRevealMotionAudit ?? []).map((entry) => ({ ...entry }));
  });
}

async function unauthorizedDomContains(page: Page, privateIds: readonly string[]): Promise<boolean> {
  return page.evaluate((ids) => ids.some((id) => document.documentElement.outerHTML.includes(id)), privateIds);
}

async function assertPrivateIdsAbsent(pages: readonly Page[], audits: readonly PageAudit[], ids: readonly string[]): Promise<void> {
  for (let index = 0; index < pages.length; index += 1) {
    const serializedFrames = JSON.stringify(audits[index]!.frames);
    const body = await pages[index]!.locator('body').innerHTML();
    ids.forEach((instanceId) => {
      expect(serializedFrames).not.toContain(instanceId);
      expect(body).not.toContain(instanceId);
    });
  }
}

async function sendRuntimeRaw(request: APIRequestContext, setup: Setup, playerIndex: number, message: JsonObject): Promise<JsonObject> {
  const response = await request.post(`${API_BASE_URL}/games/${setup.gameId}/websocket-ticket`, {
    headers: auth(setup.players[playerIndex]!.token),
  });
  await expectOk(response, 'create runtime ticket');
  const ticket = await response.json() as { websocketUrl?: string; route?: string };
  if (ticket.route !== 'runtime_ws' || !ticket.websocketUrl) throw new Error('Runtime ticket did not select runtime_ws.');
  return new Promise<JsonObject>((resolvePromise, reject) => {
    const socket = new WebSocket(ticket.websocketUrl!);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out waiting for runtime command result.'));
    }, 20_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify(message)));
    socket.addEventListener('message', async (event) => {
      const text = typeof event.data === 'string' ? event.data : await new Response(event.data).text();
      const frame = JSON.parse(text) as JsonObject;
      const actionId = String(message['clientActionId'] ?? '');
      if ((frame['kind'] === 'command_ack' && frame['clientActionId'] === actionId)
        || (frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === actionId)) {
        clearTimeout(timeout);
        socket.close();
        resolvePromise(frame);
      }
    });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Runtime WebSocket failed.'));
    });
  });
}

async function createContexts(
  browser: Browser,
  baseURL: string,
  setup: Setup,
  viewport: { width: number; height: number },
  hasTouch = false,
): Promise<BrowserContext[]> {
  const contexts = await Promise.all(setup.players.map((player) => browser.newContext({
    baseURL,
    viewport,
    hasTouch,
    storageState: authStorageState(baseURL, player.user, player.refreshToken),
  })));
  await Promise.all(contexts.map((context) => context.addInitScript(() =>
    localStorage.setItem('commanderzone.e2eRevealMotionAudit', '1'),
  )));
  return contexts;
}

async function createGame(request: APIRequestContext, playerCount: number, runId: string): Promise<Setup> {
  const players: Player[] = [];
  for (let index = 0; index < playerCount; index += 1) {
    const session = await createRealUserSession(request, `${runId}-${index}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `s4f-${runId.slice(-8)}-${index}`,
      includeWhiteDfc: index === 0,
    });
    players.push({ ...session, deckId: deck.deckId });
  }
  const room = await request.post(`${API_BASE_URL}/rooms`, {
    headers: auth(players[0]!.token),
    data: {
      deckId: players[0]!.deckId,
      visibility: 'private',
      name: runId,
      format: 'commander',
      maxPlayers: playerCount,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectOk(room, 'create Sprint 4F room');
  const roomId = String(((await room.json()) as { room?: { id?: string } }).room?.id ?? '');
  for (const player of players.slice(1)) {
    await expectOk(await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
      headers: auth(player.token),
      data: { deckId: player.deckId },
    }), 'join Sprint 4F room');
  }
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const current = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: auth(players[0]!.token) });
    await expectOk(current, 'load Sprint 4F room');
    const entries = ((await current.json()) as { room?: { players?: Array<{ turnRolls?: number[] }> } }).room?.players ?? [];
    if (entries.length === playerCount && entries.every((entry) => entry.turnRolls?.length)
      && new Set(entries.map((entry) => entry.turnRolls?.join('-'))).size === playerCount) break;
    for (const player of players) {
      const roll = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: auth(player.token) });
      if (!roll.ok() && roll.status() !== 409) await expectOk(roll, 'roll Sprint 4F turn order');
    }
  }
  const started = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: auth(players[0]!.token) });
  await expectOk(started, 'start Sprint 4F game');
  const gameId = String(((await started.json()) as { game?: { id?: string } }).game?.id ?? '');
  if (!gameId) throw new Error('Sprint 4F game did not start.');
  return { gameId, players };
}

async function snapshot(request: APIRequestContext, setup: Setup, viewerIndex: number): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${setup.gameId}/snapshot`, {
    headers: auth(setup.players[viewerIndex]!.token),
  });
  await expectOk(response, 'load Sprint 4F snapshot');
  return ((await response.json()) as { game: { snapshot: JsonObject } }).game.snapshot;
}

async function eventStoreState(gameId: string): Promise<EventStoreState> {
  if (!/^[0-9a-f-]{36}$/i.test(gameId)) throw new Error(`Unsafe game id: ${gameId}`);
  const query = `SELECT COUNT(*), COALESCE(MAX(version), 0) FROM game_event WHERE game_id = '${gameId}';`;
  const { stdout } = await execFileAsync('docker', [
    'compose', 'exec', '-T', 'database', 'psql', '-U', 'commanderzone', '-d', 'commanderzone', '-tA', '-F', '|', '-c', query,
  ], { cwd: resolve(process.cwd(), '..'), timeout: 30_000, windowsHide: true });
  const [count, maxVersion] = stdout.trim().split('|').map(Number);
  if (!Number.isFinite(count) || !Number.isFinite(maxVersion)) throw new Error(`Invalid event-store result: ${stdout}`);
  return { count: count!, maxVersion: maxVersion! };
}

async function expectStablePresence(
  request: APIRequestContext,
  setup: Setup,
  pages: readonly Page[],
  audits: readonly PageAudit[],
): Promise<void> {
  await Promise.all(audits.map((audit) => expect.poll(
    () => audit.frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'),
    { timeout: 30_000 },
  ).toBe(true)));
  await expect.poll(async () => {
    const live = await snapshot(request, setup, 0);
    const presence = (live['presence'] ?? {}) as Record<string, JsonObject>;
    return setup.players.every((player) => presence[player.user.id]?.['connected'] !== false);
  }, { timeout: 30_000 }).toBe(true);
  await Promise.all(pages.map((page) => expect(page.locator('app-game-disconnect-vote-modal [role="dialog"]')).toHaveCount(0)));
}

async function restartRuntime(request: APIRequestContext): Promise<void> {
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], {
    cwd: resolve(process.cwd(), '..'),
    timeout: 60_000,
    windowsHide: true,
  });
  await expect.poll(async () => {
    try {
      return (await request.get(RUNTIME_READY_URL)).ok();
    } catch {
      return false;
    }
  }, { timeout: 60_000 }).toBe(true);
}

async function assertInfrastructureReady(request: APIRequestContext): Promise<void> {
  for (const url of [
    `${API_BASE_URL}/healthz`,
    `${API_BASE_URL}/readyz`,
    'http://127.0.0.1:8081/healthz',
    'http://127.0.0.1:8081/readyz',
    'http://127.0.0.1:8091/healthz',
    RUNTIME_READY_URL,
    'http://127.0.0.1:8091/metrics',
  ]) {
    expect((await request.get(url)).ok(), url).toBe(true);
  }
}

function auditPage(page: Page): PageAudit {
  const audit: PageAudit = { frames: [], errors: [], recoveryRequests: [], diagnostics: [] };
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    try {
      audit.frames.push(JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as JsonObject);
    } catch {
      // Ping/non-JSON transport frame.
    }
  }));
  page.on('request', (outgoing) => {
    if (/\/snapshot(?:\?|$)|\/bootstrap(?:\?|$)/.test(outgoing.url())) audit.recoveryRequests.push(outgoing.url());
  });
  page.on('console', (message) => {
    if (/CommanderZone gameplay realtime|refetch|resync|target_not_found|version_gap/i.test(message.text())) {
      audit.diagnostics.push(message.text());
    }
    if (message.type() === 'error') audit.errors.push(message.text());
  });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  return audit;
}

function assertCleanAudit(audit: PageAudit): void {
  const serialized = JSON.stringify(audit.frames);
  expect(serialized).not.toMatch(/target_not_found|resync_required|recovery_required|Unknown Card|fallback/i);
  expect(audit.frames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
  expect(audit.errors.filter((error) => /target_not_found|resync_required|Unknown Card|fallback/i.test(error))).toEqual([]);
}

function expectRecoveryCounts(audits: readonly PageAudit[], baselines: readonly number[], phase: string): void {
  for (let index = 0; index < audits.length; index += 1) {
    expect(
      audits[index]!.recoveryRequests.length,
      `${phase}: viewer ${index} requested ${JSON.stringify(audits[index]!.recoveryRequests)}; diagnostics=${JSON.stringify(audits[index]!.diagnostics.slice(-12))}`,
    ).toBe(baselines[index]);
  }
}

function zoneCards(state: JsonObject, playerId: string, zone: string): JsonObject[] {
  const player = ((state['players'] as Record<string, JsonObject> | undefined) ?? {})[playerId];
  return ((player?.['zones'] as Record<string, JsonObject[]> | undefined) ?? {})[zone] ?? [];
}

function zoneIds(state: JsonObject, playerId: string, zone: string): string[] {
  return zoneCards(state, playerId, zone).map((card) => String(card['instanceId'] ?? '')).filter(Boolean);
}

function canonicalPrivateState(state: JsonObject, ownerId: string): JsonObject {
  return {
    status: state['status'],
    version: state['version'],
    zones: Object.fromEntries(['library', 'hand', 'battlefield', 'graveyard', 'exile'].map((zone) => [
      zone,
      zoneCards(state, ownerId, zone).map((card) => ({
        instanceId: card['instanceId'],
        faceDown: card['faceDown'] ?? false,
        position: card['position'] ?? null,
        revealedTo: card['revealedTo'] ?? [],
      })),
    ])),
    eventLog: state['eventLog'],
  };
}

function expectRatioPosition(raw: unknown): void {
  const position = raw as JsonObject | null;
  expect(position?.['unit']).toBe('ratio');
  expect(Number(position?.['x'])).toBeGreaterThanOrEqual(0);
  expect(Number(position?.['x'])).toBeLessThanOrEqual(1);
  expect(Number(position?.['y'])).toBeGreaterThanOrEqual(0);
  expect(Number(position?.['y'])).toBeLessThanOrEqual(1);
}

async function expectWithinViewport(page: Page, locator: Locator): Promise<void> {
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    return box !== null && viewport !== null && box.x >= 0 && box.y >= 0
      && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
  }).toBe(true);
}

async function expectWithinNativeViewport(page: Page, locator: Locator): Promise<void> {
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    return box !== null && box.x >= 0 && box.y >= 0
      && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
  }).toBe(true);
}

async function expectNoGlobalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({
    width: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }))).toEqual({ width: 0, height: 0 });
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function expectOk(response: Pick<APIResponse, 'ok' | 'status' | 'text'>, action: string): Promise<void> {
  if (!response.ok()) throw new Error(`${action} failed (${response.status()}): ${await response.text()}`);
}
