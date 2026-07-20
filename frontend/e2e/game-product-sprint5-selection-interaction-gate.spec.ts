import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase } from './support/decks';
import { sendRuntimeCommand } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_BASE_URL = process.env['E2E_GAME_RUNTIME_BASE_URL'] ?? 'http://127.0.0.1:8091';
const RUNTIME_METRICS_URL = process.env['E2E_GAME_RUNTIME_METRICS_URL'] ?? `${RUNTIME_BASE_URL}/metrics`;
const BATTLEFIELD_ZOOM_STORAGE_KEY = 'commanderZone.gameTable.battlefieldZoomPercent';
const execFileAsync = promisify(execFile);

const SERVICE_URLS = [
  `${API_BASE_URL}/healthz`,
  `${API_BASE_URL}/readyz`,
  process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz',
  process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz',
  `${RUNTIME_BASE_URL}/healthz`,
  `${RUNTIME_BASE_URL}/readyz`,
  RUNTIME_METRICS_URL,
] as const;

type JsonObject = Record<string, unknown>;
type Point = { x: number; y: number };
type Player = Awaited<ReturnType<typeof createRealUserSession>> & { deckId: string };
type Setup = { gameId: string; roomId: string; players: Player[] };
type EventStoreState = { count: number; maxVersion: number };
type Audit = {
  received: JsonObject[];
  sent: JsonObject[];
  errors: string[];
  recoveryRequests: string[];
};

const PLAYER_MATRIX = [
  { count: 2, viewport: { width: 1600, height: 1000 }, state: 'normal', battlefieldZoom: 70 },
  { count: 3, viewport: { width: 1280, height: 800 }, state: 'compact', battlefieldZoom: 100 },
  { count: 4, viewport: { width: 1050, height: 680 }, state: 'aggressive', battlefieldZoom: 140 },
  { count: 5, viewport: { width: 850, height: 600 }, state: 'minimal', battlefieldZoom: 70 },
  { count: 6, viewport: { width: 1600, height: 1000 }, state: 'normal', battlefieldZoom: 140 },
] as const;

test.describe('Gameplay 1.0 Sprint 5 integrated selection and interaction release gate', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    await assertServicesAndMetrics(request);
  });

  for (const scenario of PLAYER_MATRIX) {
    test(`${scenario.count}P keeps scoped selection, toolbar authority and one-version batch semantics`, async ({ browser, request, baseURL }) => {
      test.setTimeout(600_000);
      if (!baseURL) throw new Error('Playwright baseURL is required.');

      const setup = await createGame(request, scenario.count, `s5e-matrix-${scenario.count}`);
      await resolveGameToPlaying(request, setup.gameId, setup.players);
      const owner = setup.players[0]!;
      const seeded = await seedIndependentBattlefield(request, setup, 3);
      const contexts = await Promise.all(setup.players.map((player) => playerContext(
        browser,
        baseURL,
        player,
        scenario.viewport,
      )));

      try {
        const pages = await Promise.all(contexts.map((context) => context.newPage()));
        const audits = pages.map((page) => createAudit(page, setup.gameId));
        await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
        await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
        await Promise.all(audits.map(waitForConnection));
        await Promise.all(pages.map((page) => focusPlayerById(page, owner.user.id)));
        const recoveryBaselines = audits.map((audit) => audit.recoveryRequests.length);

        const ownerPage = pages[0]!;
        await expect(ownerPage.getByTestId('game-screen')).toHaveAttribute('data-player-count', String(scenario.count));
        await expect(ownerPage.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', scenario.state);
        await expect(ownerPage.getByTestId('opponent-mini-board')).toHaveCount(scenario.count - 1);
        await setBattlefieldZoom(ownerPage, scenario.battlefieldZoom);

        const root = battlefieldRoot(ownerPage, owner.user.id);
        await root.focus();
        await ownerPage.keyboard.press('Control+a');
        await expectSelectedIds(ownerPage, seeded);
        await expect(ownerPage.getByTestId('selection-action-toolbar')).toBeVisible();
        await expect(ownerPage.getByTestId('selection-action-toolbar')).toBeInViewport();
        await expect(ownerPage.getByTestId('selection-count')).toContainText('3');

        for (const opponentPage of pages.slice(1)) {
          await expectSelectedIds(opponentPage, []);
          await expect(opponentPage.getByTestId('selection-action-toolbar')).toHaveCount(0);
          await expect(battlefieldRoot(opponentPage, owner.user.id)).not.toHaveAttribute('tabindex', '0');
        }

        const beforeStore = await eventStoreState(setup.gameId);
        const beforeSnapshot = await gameSnapshot(request, setup.gameId, owner.token);
        const commandBaseline = commandFrames(audits[0]!.sent).length;
        await clickToolbarAction(ownerPage, 'tap');
        await expect.poll(() => commandFrames(audits[0]!.sent).length, { timeout: 20_000 }).toBe(commandBaseline + 1);
        expect(commandFrames(audits[0]!.sent).at(-1)?.['type']).toBe('cards.tapped.set');
        await expect.poll(async () => Number((await gameSnapshot(request, setup.gameId, owner.token))['version'])).toBe(Number(beforeSnapshot['version']) + 1);
        expect(await eventStoreState(setup.gameId)).toEqual({ count: beforeStore.count + 1, maxVersion: beforeStore.maxVersion + 1 });
        await expectSelectedIds(ownerPage, seeded);
        for (const page of pages) {
          for (const instanceId of seeded) await expect(battlefieldCard(page, owner.user.id, instanceId)).toHaveClass(/tapped/);
        }

        await ownerPage.getByTestId('clear-selection').click();
        await expectSelectedIds(ownerPage, []);
        audits.forEach((audit, index) => expect(audit.recoveryRequests.length).toBe(recoveryBaselines[index]));
        audits.forEach(assertCleanAudit);
        await assertPagesHaveNoOverflow(pages);
      } finally {
        await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
      }
    });
  }

  test('3P composes selection, relations, batch actions, privacy, atomic rejection and continuity', async ({ browser, request, baseURL }) => {
    test.setTimeout(900_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');

    const setup = await createGame(request, 3, 's5e-integrated');
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const [playerA, playerB, playerC] = setup.players as [Player, Player, Player];
    const fixture = await seedIntegratedRelations(request, setup);
    const contexts = await Promise.all(setup.players.map((player) => playerContext(
      browser,
      baseURL,
      player,
      { width: 1440, height: 900 },
    )));

    try {
      let pages = await Promise.all(contexts.map((context) => context.newPage()));
      let audits = pages.map((page) => createAudit(page, setup.gameId));
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(audits.map(waitForConnection));
      await Promise.all(pages.map((page) => focusPlayerById(page, playerA.user.id)));
      const [pageA, pageB, pageC] = pages as [Page, Page, Page];
      const recoveryBaselines = audits.map((audit) => audit.recoveryRequests.length);

      await expect(battlefieldCard(pageB, playerA.user.id, fixture.faceDownId)).toHaveCount(0);
      await expect(battlefieldCard(pageC, playerA.user.id, fixture.faceDownId)).toHaveCount(0);
      expect(JSON.stringify(audits[1]!.received)).not.toContain(fixture.faceDownId);
      expect(JSON.stringify(audits[2]!.received)).not.toContain(fixture.faceDownId);

      await battlefieldCard(pageA, playerA.user.id, fixture.independentIds[0]!).click();
      await expectSelectedIds(pageA, [fixture.independentIds[0]!]);
      await battlefieldCard(pageA, playerA.user.id, fixture.independentIds[1]!).click({ modifiers: ['Control'] });
      await expectSelectedIds(pageA, fixture.independentIds.slice(0, 2));
      await battlefieldCard(pageA, playerA.user.id, fixture.independentIds[1]!).click({ modifiers: ['Shift'] });
      await expectSelectedIds(pageA, [fixture.independentIds[0]!]);
      await battlefieldCard(pageA, playerA.user.id, fixture.independentIds[2]!).click({ modifiers: ['Control', 'Shift'] });
      await expectSelectedIds(pageA, [fixture.independentIds[0]!, fixture.independentIds[2]!]);
      await battlefieldCard(pageA, playerA.user.id, fixture.independentIds[1]!).click({ modifiers: ['Alt'] });
      await expectSelectedIds(pageA, [fixture.independentIds[1]!]);
      await battlefieldCard(pageA, playerA.user.id, fixture.overlapIds[1]!).click();
      await expectSelectedIds(pageA, [fixture.overlapIds[1]!]);
      await battlefieldCard(pageA, playerA.user.id, fixture.overlapIds[1]!).click();
      await expectSelectedIds(pageA, [fixture.overlapIds[1]!]);
      await battlefieldCard(pageA, playerA.user.id, fixture.independentIds[1]!).click({ button: 'right' });
      await expectSelectedIds(pageA, [fixture.independentIds[1]!]);
      await expect(pageA.getByTestId('context-menu')).toBeVisible();
      await pageA.keyboard.press('Escape');
      await expectSelectedIds(pageA, [fixture.independentIds[1]!]);
      await pageA.keyboard.press('Escape');
      await expectSelectedIds(pageA, []);

      const hand = await revealHand(pageA, playerA.user.id);
      const rangeIds = await hand.evaluateAll((elements) => elements.slice(0, 4).map((element) => (element as HTMLElement).dataset['cardInstanceId']!));
      await hand.nth(0).click();
      await hand.nth(3).click({ modifiers: ['Shift'] });
      await expectSelectedIds(pageA, rangeIds);
      await hand.nth(1).click({ modifiers: ['Control', 'Shift'] });
      await expectSelectedIds(pageA, rangeIds);
      await pageA.keyboard.press('Escape');

      const directions = await emptyCornerDirections(pageA, playerA.user.id);
      const marqueeCommandBaseline = commandFrames(audits[0]!.sent).length;
      const marqueeVersionBaseline = Number((await gameSnapshot(request, setup.gameId, playerA.token))['version']);
      for (const [start, end] of directions) {
        await dragMarquee(pageA, start, end);
        await expectSelectedIds(pageA, await visibleSelectableIds(pageA, playerA.user.id));
        await pageA.keyboard.press('Escape');
      }
      expect(commandFrames(audits[0]!.sent)).toHaveLength(marqueeCommandBaseline);
      expect(Number((await gameSnapshot(request, setup.gameId, playerA.token))['version'])).toBe(marqueeVersionBaseline);

      await battlefieldCard(pageA, playerA.user.id, fixture.independentIds[0]!).click();
      await expectSelectedIds(pageA, [fixture.independentIds[0]!]);
      const baseSelection = await selectedIds(pageA);
      await pageA.mouse.move(directions[0]![0].x, directions[0]![0].y);
      await pageA.mouse.down();
      await pageA.mouse.move(directions[0]![1].x, directions[0]![1].y, { steps: 6 });
      await expect(pageA.getByTestId('marquee-selection-rect')).toBeVisible();
      await pageA.keyboard.press('Escape');
      await expect(pageA.getByTestId('marquee-selection-rect')).toHaveCount(0);
      await pageA.mouse.up();
      await expectSelectedIds(pageA, baseSelection);
      await pageA.keyboard.press('Escape');

      await pageA.getByTestId('touch-select-area-mode').click();
      await expect(pageA.getByTestId('touch-select-area-mode')).toHaveAttribute('aria-pressed', 'true');
      await touchDrag(pageA, directions[0]![0], directions[0]![1]);
      await expect(pageA.getByTestId('touch-select-area-mode')).toHaveAttribute('aria-pressed', 'false');
      await expectSelectedIds(pageA, await visibleSelectableIds(pageA, playerA.user.id));
      await pageA.keyboard.press('Escape');

      const navStart = battlefieldCard(pageA, playerA.user.id, fixture.independentIds[0]!);
      await navStart.focus();
      await pageA.keyboard.press('ArrowRight');
      expect(await activeCardId(pageA)).not.toBe(fixture.independentIds[0]);
      await pageA.keyboard.press('Home');
      const homeId = await activeCardId(pageA);
      await pageA.keyboard.press('End');
      expect(await activeCardId(pageA)).not.toBe(homeId);
      const activeId = await activeCardId(pageA);
      expect(activeId).toBeTruthy();
      await pageA.keyboard.press('Space');
      await expect.poll(async () => (await selectedIds(pageA)).includes(activeId!)).toBe(true);
      await pageA.keyboard.press('Escape');

      const stackRoot = battlefieldCard(pageA, playerA.user.id, fixture.stackIds[0]!);
      await stackRoot.click();
      await expectSelectedIds(pageA, [fixture.stackIds[0]!]);
      await expect(pageA.getByTestId('selection-group-count')).toContainText('1');
      await expect(stackRoot).toHaveAttribute('data-selection-group-size', '4');
      for (const hiddenId of fixture.stackIds.slice(1)) {
        await expect(battlefieldCard(pageA, playerA.user.id, hiddenId)).toHaveAttribute('data-selection-hidden', 'true');
        expect(await selectedIds(pageA)).not.toContain(hiddenId);
      }

      await battlefieldCard(pageA, playerA.user.id, fixture.independentIds[0]!).click({ modifiers: ['Control'] });
      const dragCommandBaseline = commandFrames(audits[0]!.sent).length;
      await dragCardBy(pageA, stackRoot, 48, -16);
      await expect.poll(() => commandFrames(audits[0]!.sent).length, { timeout: 20_000 }).toBe(dragCommandBaseline + 1);
      const dragFrame = commandFrames(audits[0]!.sent).at(-1)!;
      expect(dragFrame['type']).toBe('cards.position.changed');
      expect(JSON.stringify(dragFrame)).toContain(fixture.stackIds[0]!);
      for (const hiddenId of fixture.stackIds.slice(1)) expect(JSON.stringify(dragFrame)).not.toContain(hiddenId);
      await expectSelectedIds(pageA, [fixture.stackIds[0]!, fixture.independentIds[0]!]);
      await pageA.keyboard.press('Escape');

      await selectCards(pageA, playerA.user.id, fixture.independentIds);
      await expectAtomicToolbarAction(request, setup, audits[0]!, pageA, 'tap', 'cards.tapped.set');
      await expectSelectedIds(pageA, fixture.independentIds);
      await expectAtomicToolbarAction(request, setup, audits[0]!, pageA, 'untap', 'cards.tapped.set');
      await expectSelectedIds(pageA, fixture.independentIds);

      await clickToolbarAction(pageA, 'faceDown');
      await expectConfirmationFocus(pageA);
      await pageA.keyboard.press('Escape');
      await expect(pageA.getByRole('dialog')).toHaveCount(0);
      await expectSelectedIds(pageA, fixture.independentIds);

      const unauthorizedBaselines = [audits[1]!.received.length, audits[2]!.received.length];
      await expectAtomicToolbarAction(request, setup, audits[0]!, pageA, 'faceDown', 'cards.face_down.set', true);
      await expectSelectedIds(pageA, fixture.independentIds);
      for (const [audit, baseline] of [audits[1]!, audits[2]!].map((audit, index) => [audit, unauthorizedBaselines[index]!] as const)) {
        const projection = JSON.stringify(audit.received.slice(baseline));
        for (const realId of fixture.independentIds) expect(projection).not.toContain(realId);
        expect(projection).not.toMatch(/cardKey|cardRef|printId|imageUris|cardFaces|printedStats|manualOverrides/);
      }
      await expectAtomicToolbarAction(request, setup, audits[0]!, pageA, 'faceUp', 'cards.face_down.set', true);

      await expectAtomicToolbarAction(request, setup, audits[0]!, pageA, 'createStack', 'battlefield.stack.created', true);
      await expectSelectedIds(pageA, [fixture.independentIds[0]!]);
      await expect(pageA.getByTestId('selection-group-count')).toContainText('1');
      await expectAtomicToolbarAction(request, setup, audits[0]!, pageA, 'dissolveStack', 'battlefield.stack.dissolved', true);
      await expectSelectedIds(pageA, [fixture.independentIds[0]!]);
      await expect(pageA.getByTestId('selection-group-count')).toHaveCount(0);

      await pageA.keyboard.press('Escape');
      await battlefieldCard(pageA, playerA.user.id, fixture.equipmentIds[0]!).focus();
      await pageA.keyboard.press('Space');
      await expectAtomicToolbarAction(request, setup, audits[0]!, pageA, 'detach', 'attachment.removed');
      await expectSelectedIds(pageA, [fixture.equipmentIds[0]!]);

      await pageA.keyboard.press('Escape');
      await battlefieldCard(pageA, playerA.user.id, fixture.transferId).click();
      await acceptedRuntimeCommand(request, setup, playerA, 'card.controller.changed', {
        playerId: playerA.user.id,
        instanceId: fixture.transferId,
        targetPlayerId: playerB.user.id,
      });
      await expectSelectedIds(pageA, []);

      await selectCards(pageA, playerA.user.id, fixture.moveIds);
      await expectAtomicToolbarAction(request, setup, audits[0]!, pageA, 'move:graveyard', 'cards.moved', true);
      await expectSelectedIds(pageA, []);

      const rejectionStore = await eventStoreState(setup.gameId);
      const rejectionSnapshot = canonicalAuthoritativeState(await gameSnapshot(request, setup.gameId, playerA.token));
      const currentVersion = Number((await gameSnapshot(request, setup.gameId, playerA.token))['version']);
      const rejectedCases = [
        {
          token: playerB.token,
          type: 'cards.tapped.set',
          payload: { instanceIds: [fixture.independentIds[0]], tapped: true },
        },
        {
          token: playerA.token,
          type: 'cards.tapped.set',
          payload: { instanceIds: [fixture.independentIds[0], fixture.independentIds[0]], tapped: true },
        },
        {
          token: playerA.token,
          type: 'cards.tapped.set',
          payload: { instanceIds: [fixture.independentIds[0], fixture.transferId], tapped: true },
        },
        {
          token: playerA.token,
          type: 'cards.tapped.set',
          payload: { instanceIds: [fixture.moveIds[0]], tapped: true },
        },
        {
          token: playerA.token,
          type: 'cards.tapped.set',
          payload: { instanceIds: ['00000000-0000-4000-8000-000000000000'], tapped: true },
        },
      ];
      for (const [index, rejected] of rejectedCases.entries()) {
        await expect(sendRuntimeCommand(request, {
          gameId: setup.gameId,
          token: rejected.token,
          baseVersion: currentVersion,
          type: rejected.type,
          payload: rejected.payload,
          clientActionId: `s5e-rejected-${index}-${setup.gameId}`,
        })).rejects.toThrow(/rejected/i);
        expect(await eventStoreState(setup.gameId)).toEqual(rejectionStore);
        expect(canonicalAuthoritativeState(await gameSnapshot(request, setup.gameId, playerA.token))).toEqual(rejectionSnapshot);
      }

      const retryIds = fixture.independentIds.slice(0, 2);
      const retryActionId = `s5e-idempotent-${setup.gameId}`;
      const retryBefore = await eventStoreState(setup.gameId);
      const retryVersion = Number((await gameSnapshot(request, setup.gameId, playerA.token))['version']);
      const firstRetry = await sendRuntimeCommand(request, {
        gameId: setup.gameId,
        token: playerA.token,
        baseVersion: retryVersion,
        type: 'cards.tapped.set',
        payload: { instanceIds: retryIds, tapped: true },
        clientActionId: retryActionId,
      });
      expect(firstRetry.version).toBe(retryVersion + 1);
      const afterFirstRetry = await eventStoreState(setup.gameId);
      expect(afterFirstRetry).toEqual({ count: retryBefore.count + 1, maxVersion: retryBefore.maxVersion + 1 });
      const duplicateRetry = await sendRuntimeCommand(request, {
        gameId: setup.gameId,
        token: playerA.token,
        baseVersion: retryVersion,
        type: 'cards.tapped.set',
        payload: { instanceIds: retryIds, tapped: true },
        clientActionId: retryActionId,
      });
      expect(duplicateRetry.version).toBe(firstRetry.version);
      expect(await eventStoreState(setup.gameId)).toEqual(afterFirstRetry);

      await focusPlayerById(pageB, playerA.user.id);
      await focusPlayerById(pageC, playerA.user.id);
      await expect(pageB.getByTestId('selection-action-toolbar')).toHaveCount(0);
      await expect(pageC.getByTestId('selection-action-toolbar')).toHaveCount(0);
      await expectSelectedIds(pageB, []);
      await expectSelectedIds(pageC, []);

      for (const [width, height, state] of [
        [1440, 900, 'normal'],
        [1100, 720, 'compact'],
        [820, 580, 'aggressive'],
        [600, 400, 'minimal'],
      ] as const) {
        await pageA.setViewportSize({ width, height });
        await expect(pageA.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', state);
        await battlefieldCard(pageA, playerA.user.id, fixture.independentIds[0]!).focus();
        await pageA.keyboard.press('Space');
        await expect(pageA.getByTestId('selection-action-toolbar')).toBeInViewport();
        await expect(pageA.getByTestId('touch-select-area-mode')).toBeInViewport();
        await pageA.keyboard.press('Escape');
      }
      await pageA.setViewportSize({ width: 1440, height: 900 });
      for (const zoom of [70, 100, 140] as const) {
        await setBattlefieldZoom(pageA, zoom);
        await expect(battlefieldRoot(pageA, playerA.user.id)).toHaveAttribute('data-selection-interaction', 'idle');
      }

      const beforeContinuity = canonicalAuthoritativeState(await gameSnapshot(request, setup.gameId, playerA.token));
      await battlefieldCard(pageA, playerA.user.id, fixture.stackIds[0]!).click();
      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayerById(pageA, playerA.user.id);
      await expectSelectedIds(pageA, []);
      expect(canonicalAuthoritativeState(await gameSnapshot(request, setup.gameId, playerA.token))).toEqual(beforeContinuity);

      await pageA.close();
      pages[0] = await contexts[0]!.newPage();
      audits[0] = createAudit(pages[0]!, setup.gameId);
      await pages[0]!.goto(`/games/${setup.gameId}`);
      await expect(pages[0]!.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForConnection(audits[0]!);
      await focusPlayerById(pages[0]!, playerA.user.id);
      await expectSelectedIds(pages[0]!, []);

      await battlefieldCard(pages[0]!, playerA.user.id, fixture.stackIds[0]!).click();
      const reconnectRecoveryBaseline = audits[0]!.recoveryRequests.length;
      await restartRuntime(request);
      await expect.poll(() => connectionCount(audits[0]!), { timeout: 60_000 }).toBeGreaterThan(1);
      await expectSelectedIds(pages[0]!, []);
      expect(audits[0]!.recoveryRequests).toHaveLength(reconnectRecoveryBaseline);
      expect(canonicalAuthoritativeState(await gameSnapshot(request, setup.gameId, playerA.token))).toEqual(beforeContinuity);

      await battlefieldCard(pages[0]!, playerA.user.id, fixture.independentIds[0]!).focus();
      await pages[0]!.keyboard.press('Space');
      await expectSelectedIds(pages[0]!, [fixture.independentIds[0]!]);
      await clickToolbarAction(pages[0]!, 'untap');
      await expect(battlefieldCard(pages[0]!, playerA.user.id, fixture.independentIds[0]!)).not.toHaveClass(/tapped/, { timeout: 20_000 });

      audits.forEach((audit, index) => {
        if (index === 0) return;
        expect(audit.recoveryRequests.length).toBe(recoveryBaselines[index]);
      });
      audits.forEach(assertCleanAudit);
      await assertPagesHaveNoOverflow(pages);
      await assertServicesAndMetrics(request, setup.gameId);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });

  test('100-card relation board survives repeated selection, navigation, toolbar and relation cycles', async ({ browser, request, baseURL }) => {
    test.setTimeout(1_200_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');

    const setup = await createGame(request, 2, 's5e-endurance');
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const [playerA] = setup.players;
    const fixture = await seedDenseBoard(request, setup);
    const context = await playerContext(browser, baseURL, playerA!, { width: 1600, height: 1000 }, true);
    const viewerContext = await playerContext(browser, baseURL, setup.players[1]!, { width: 1280, height: 800 });

    try {
      const page = await context.newPage();
      const viewerPage = await viewerContext.newPage();
      const audit = createAudit(page, setup.gameId);
      const viewerAudit = createAudit(viewerPage, setup.gameId);
      await Promise.all([page.goto(`/games/${setup.gameId}`), viewerPage.goto(`/games/${setup.gameId}`)]);
      await Promise.all([page, viewerPage].map((candidate) => expect(candidate.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all([waitForConnection(audit), waitForConnection(viewerAudit)]);
      await Promise.all([focusPlayerById(page, playerA!.user.id), focusPlayerById(viewerPage, playerA!.user.id)]);
      await Promise.all([page, viewerPage].map((candidate) => expect(candidate.locator('app-game-disconnect-vote-modal [role="dialog"]')).toHaveCount(0)));
      await expect(battlefieldCards(page, playerA!.user.id)).toHaveCount(100);
      const recoveryBaseline = audit.recoveryRequests.length;
      const viewerRecoveryBaseline = viewerAudit.recoveryRequests.length;
      const versionBaseline = Number((await gameSnapshot(request, setup.gameId, playerA!.token))['version']);
      const commandBaseline = commandFrames(audit.sent).length;
      const memoryBefore = await javascriptHeapSize(page);

      const directions = await emptyCornerDirections(page, playerA!.user.id);
      const startedAt = Date.now();
      for (let iteration = 0; iteration < 50; iteration += 1) {
        const [start, end] = directions[iteration % directions.length]!;
        await dragMarquee(page, start, end);
      }
      expect(commandFrames(audit.sent)).toHaveLength(commandBaseline);
      expect(Number((await gameSnapshot(request, setup.gameId, playerA!.token))['version'])).toBe(versionBaseline);
      await expect(battlefieldRoot(page, playerA!.user.id)).toHaveAttribute('data-selection-interaction', 'idle');
      await expect(page.getByTestId('marquee-selection-rect')).toHaveCount(0);

      await battlefieldCard(page, playerA!.user.id, fixture.navigationId).focus();
      const spatialBaseline = Number(await page.getByTestId('game-screen').getAttribute('data-spatial-navigation-steps'));
      for (let iteration = 0; iteration < 25; iteration += 1) {
        await page.keyboard.press('End');
        await page.keyboard.press('Home');
      }
      await expect.poll(async () => Number(await page.getByTestId('game-screen').getAttribute('data-spatial-navigation-steps'))).toBe(spatialBaseline + 50);
      expect(await activeCardId(page)).toBeTruthy();

      const root = battlefieldRoot(page, playerA!.user.id);
      for (let iteration = 0; iteration < 20; iteration += 1) {
        await root.focus();
        await page.keyboard.press('Control+a');
        await expect.poll(async () => (await selectedIds(page)).length).toBeGreaterThan(80);
        await page.getByTestId('clear-selection').click();
        await expectSelectedIds(page, []);
      }

      await selectCardsByKeyboard(page, playerA!.user.id, fixture.actionIds);
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const action = iteration % 2 === 0 ? 'tap' : 'untap';
        await clickToolbarAction(page, action);
        await expect(page.getByTestId('selection-action-toolbar')).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
      }

      for (let iteration = 0; iteration < 5; iteration += 1) {
        await page.keyboard.press('Escape');
        await selectCardsByKeyboard(page, playerA!.user.id, fixture.stackCycleIds);
        await clickToolbarAction(page, 'createStack');
        await confirmDialog(page);
        await expect(page.getByTestId('selection-group-count')).toContainText('1');
        await clickToolbarAction(page, 'dissolveStack');
        await confirmDialog(page);
        await expect(page.getByTestId('selection-group-count')).toHaveCount(0);
      }

      await page.keyboard.press('Escape');
      await selectCardsByKeyboard(page, playerA!.user.id, fixture.confirmationIds);
      for (let iteration = 0; iteration < 20; iteration += 1) {
        await clickToolbarAction(page, 'faceDown');
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.getByRole('dialog').locator('button.secondary-button').click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }

      const rootMetrics = await battlefieldRoot(page, playerA!.user.id).evaluate((element) => ({
        boundsCaptures: Number((element as HTMLElement).dataset['marqueeBoundsCaptures'] ?? 0),
        layoutReads: Number((element as HTMLElement).dataset['marqueeLayoutReads'] ?? 0),
        pointerMoves: Number((element as HTMLElement).dataset['marqueePointerMoves'] ?? 0),
        rafUpdates: Number((element as HTMLElement).dataset['marqueeRafUpdates'] ?? 0),
        candidateCount: Number((element as HTMLElement).dataset['marqueeCandidateCount'] ?? 0),
        outcome: (element as HTMLElement).dataset['marqueeOutcome'],
      }));
      expect(rootMetrics.boundsCaptures).toBe(1);
      expect(rootMetrics.layoutReads).toBeLessThanOrEqual(101);
      expect(rootMetrics.candidateCount).toBeGreaterThan(80);
      expect(rootMetrics.rafUpdates).toBeLessThanOrEqual(rootMetrics.pointerMoves);
      expect(rootMetrics.outcome).toBe('commit');
      const longTasks = await page.evaluate(() => (globalThis as unknown as { __sprint5LongTasks?: number[] }).__sprint5LongTasks ?? []);
      expect(Math.max(0, ...longTasks)).toBeLessThan(1_000);
      const memoryAfter = await javascriptHeapSize(page);
      if (memoryBefore !== null && memoryAfter !== null) {
        expect(memoryAfter).toBeLessThan(memoryBefore * 4 + 100_000_000);
      }
      expect(Date.now() - startedAt).toBeLessThan(10 * 60_000);
      expect(audit.recoveryRequests).toHaveLength(recoveryBaseline);
      expect(viewerAudit.recoveryRequests).toHaveLength(viewerRecoveryBaseline);
      assertCleanAudit(audit);
      assertCleanAudit(viewerAudit);
      expect(new Set(await selectedIds(page)).size).toBe((await selectedIds(page)).length);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      await page.keyboard.press('Escape');
      await battlefieldCard(page, playerA!.user.id, fixture.actionIds[0]!).focus();
      await page.keyboard.press('Space');
      await clickToolbarAction(page, 'tap');
      await expect(battlefieldCard(page, playerA!.user.id, fixture.actionIds[0]!)).toHaveClass(/tapped/, { timeout: 20_000 });

      await test.info().attach('sprint5-endurance-metrics.json', {
        body: Buffer.from(JSON.stringify({
          renderedCards: 100,
          marqueeCycles: 50,
          keyboardMoves: 50,
          selectAllClearCycles: 20,
          toolbarActions: 21,
          relationCycles: 5,
          confirmationCycles: 20,
          rootMetrics,
          longTaskCount: longTasks.length,
          maxLongTaskMs: Math.max(0, ...longTasks),
          memoryBefore,
          memoryAfter,
        }, null, 2)),
        contentType: 'application/json',
      });
    } finally {
      await Promise.allSettled([context.close(), viewerContext.close()]);
    }
  });

  test('manual native Chrome zoom certifies Sprint 5 at 80/100/125/150 and BF 70/100/140', async ({ browser, request, baseURL }) => {
    test.skip(process.env['E2E_MANUAL_SPRINT5_ZOOM'] !== '1', 'Run headed with E2E_MANUAL_SPRINT5_ZOOM=1 and change native Chrome zoom when prompted.');
    test.setTimeout(30 * 60_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');

    const setup = await createGame(request, 6, 's5e-native-zoom');
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const owner = setup.players[0]!;
    const ids = await seedIndependentBattlefield(request, setup, 8);
    const context = await playerContext(browser, baseURL, owner, { width: 1280, height: 720 });

    try {
      const page = await context.newPage();
      const audit = createAudit(page, setup.gameId);
      await page.goto(`/games/${setup.gameId}`);
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayerById(page, owner.user.id);
      const baseDpr = await page.evaluate(() => devicePixelRatio);
      const results: JsonObject[] = [];

      for (const browserZoom of [80, 100, 125, 150] as const) {
        await page.bringToFront();
        await page.evaluate((zoom) => { document.title = `CommanderZone Sprint 5 native zoom ${zoom}%`; }, browserZoom);
        console.log(`NATIVE_SPRINT5_ZOOM_ACTION zoom=${browserZoom}: set Chrome page zoom to ${browserZoom}% using browser chrome.`);
        await expect.poll(() => page.evaluate((baseline) => devicePixelRatio / baseline, baseDpr), { timeout: 180_000 }).toBeCloseTo(browserZoom / 100, 2);

        for (const battlefieldZoom of [70, 100, 140] as const) {
          await setBattlefieldZoom(page, battlefieldZoom);
          const directions = await emptyCornerDirections(page, owner.user.id);
          const commandBaseline = commandFrames(audit.sent).length;
          await dragMarquee(page, directions[0]![0], directions[0]![1]);
          expect(commandFrames(audit.sent)).toHaveLength(commandBaseline);
          await expect(page.getByTestId('selection-action-toolbar')).toBeInViewport();
          await expect(page.getByTestId('touch-select-area-mode')).toBeInViewport();
          await clickToolbarAction(page, 'faceDown');
          await expect(page.getByRole('dialog')).toBeInViewport();
          await page.getByRole('dialog').locator('button.secondary-button').click();
          await page.keyboard.press('Escape');
          results.push(await page.evaluate(({ browserZoomValue, battlefieldZoomValue }) => ({
            browserZoom: browserZoomValue,
            battlefieldZoom: battlefieldZoomValue,
            dpr: devicePixelRatio,
            viewportCss: { width: innerWidth, height: innerHeight },
            responsiveState: document.querySelector<HTMLElement>('[data-testid="game-screen"]')?.dataset['responsiveState'],
            bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          }), { browserZoomValue: browserZoom, battlefieldZoomValue: battlefieldZoom }));
        }
      }

      await page.bringToFront();
      console.log('NATIVE_SPRINT5_ZOOM_ACTION zoom=100: return Chrome page zoom to 100%.');
      await expect.poll(() => page.evaluate((baseline) => devicePixelRatio / baseline, baseDpr), { timeout: 180_000 }).toBeCloseTo(1, 2);
      await battlefieldCard(page, owner.user.id, ids[0]!).focus();
      await page.keyboard.press('Space');
      await clickToolbarAction(page, 'tap');
      await expect(battlefieldCard(page, owner.user.id, ids[0]!)).toHaveClass(/tapped/, { timeout: 20_000 });
      assertCleanAudit(audit);

      await test.info().attach('sprint5-native-browser-zoom-results.json', {
        body: Buffer.from(JSON.stringify({
          chromeVersion: browser.version(),
          os: platform(),
          baseDpr,
          results,
        }, null, 2)),
        contentType: 'application/json',
      });
    } finally {
      await context.close();
    }
  });
});

async function createGame(request: APIRequestContext, playerCount: number, prefix: string): Promise<Setup> {
  const runId = `${prefix}-${playerCount}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const players: Player[] = [];
  for (let index = 0; index < playerCount; index += 1) {
    const session = await createRealUserSession(request, `${runId}-${index}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `S5E-${playerCount}-${index}-${runId.slice(-4)}`,
    });
    players.push({ ...session, deckId: deck.deckId });
  }

  const create = await request.post(`${API_BASE_URL}/rooms`, {
    headers: bearer(players[0]!.token),
    data: {
      deckId: players[0]!.deckId,
      visibility: 'private',
      name: `Sprint 5E ${runId}`,
      format: 'commander',
      maxPlayers: playerCount,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(create, 'create Sprint 5E room');
  const roomId = String(((await create.json()) as { room: { id: string } }).room.id);
  for (const player of players.slice(1)) {
    const join = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
      headers: bearer(player.token),
      data: { deckId: player.deckId },
    });
    await expectApiOk(join, 'join Sprint 5E room');
  }
  await resolveTurnOrder(request, roomId, players);
  const start = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: bearer(players[0]!.token) });
  await expectApiOk(start, 'start Sprint 5E room');
  const gameId = String(((await start.json()) as { game: { id: string } }).game.id);
  return { gameId, roomId, players };
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, players: readonly Player[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const room = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: bearer(players[0]!.token) });
    await expectApiOk(room, 'load Sprint 5E room');
    const entries = ((await room.json()) as { room: { players: Array<{ turnRolls?: number[] }> } }).room.players;
    const rolls = entries.map((entry) => entry.turnRolls?.join('-') ?? '');
    if (rolls.length === players.length && rolls.every(Boolean) && new Set(rolls).size === players.length) return;
    for (const player of players) {
      const roll = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: bearer(player.token) });
      if (!roll.ok() && roll.status() !== 409) await expectApiOk(roll, 'roll Sprint 5E turn order');
    }
  }
  throw new Error('Could not resolve Sprint 5E turn order.');
}

async function seedIndependentBattlefield(request: APIRequestContext, setup: Setup, count: number): Promise<string[]> {
  const owner = setup.players[0]!;
  const snapshot = await gameSnapshot(request, setup.gameId, owner.token);
  const ids = zoneCards(snapshot, owner.user.id, 'library').slice(0, count).map(cardId);
  expect(ids).toHaveLength(count);
  await acceptedRuntimeCommand(request, setup, owner, 'cards.moved', {
    playerId: owner.user.id,
    fromZone: 'library',
    toZone: 'battlefield',
    instanceIds: ids,
  });
  await acceptedRuntimeCommand(request, setup, owner, 'cards.position.changed', {
    playerId: owner.user.id,
    zone: 'battlefield',
    positions: ids.map((instanceId, index) => ({
      instanceId,
      position: { x: 0.18 + index * 0.22, y: 0.35, unit: 'ratio' },
    })),
  });
  return ids;
}

async function seedIntegratedRelations(request: APIRequestContext, setup: Setup): Promise<{
  independentIds: string[];
  moveIds: string[];
  targetId: string;
  equipmentIds: string[];
  overlapIds: string[];
  faceDownId: string;
  stackIds: string[];
  transferId: string;
}> {
  const owner = setup.players[0]!;
  const snapshot = await gameSnapshot(request, setup.gameId, owner.token);
  const ids = zoneCards(snapshot, owner.user.id, 'library').slice(0, 16).map(cardId);
  expect(ids).toHaveLength(16);
  const independentIds = ids.slice(0, 3);
  const moveIds = ids.slice(3, 5);
  const targetId = ids[5]!;
  const equipmentIds = ids.slice(6, 8);
  const overlapIds = ids.slice(8, 10);
  const faceDownId = ids[10]!;
  const stackIds = ids.slice(11, 15);
  const transferId = ids[15]!;
  await acceptedRuntimeCommand(request, setup, owner, 'cards.moved', {
    playerId: owner.user.id,
    fromZone: 'library',
    toZone: 'battlefield',
    instanceIds: ids,
  });
  const positions = [
    [0.08, 0.14], [0.26, 0.14], [0.44, 0.14], [0.65, 0.12], [0.83, 0.12],
    [0.1, 0.48], [0.16, 0.44], [0.2, 0.42], [0.42, 0.48], [0.44, 0.5],
    [0.64, 0.48], [0.12, 0.76], [0.18, 0.74], [0.24, 0.72], [0.3, 0.7], [0.82, 0.74],
  ];
  await acceptedRuntimeCommand(request, setup, owner, 'cards.position.changed', {
    playerId: owner.user.id,
    zone: 'battlefield',
    positions: ids.map((instanceId, index) => ({
      instanceId,
      position: { x: positions[index]![0], y: positions[index]![1], unit: 'ratio' },
    })),
  });
  await acceptedRuntimeCommand(request, setup, owner, 'card.face_down.changed', {
    playerId: owner.user.id,
    instanceId: faceDownId,
    faceDown: true,
  });
  for (const equipmentInstanceId of equipmentIds) {
    await acceptedRuntimeCommand(request, setup, owner, 'attachment.created', {
      equipmentInstanceId,
      attachedToInstanceId: targetId,
    });
  }
  await acceptedRuntimeCommand(request, setup, owner, 'battlefield.stack.created', {
    orderedInstanceIds: stackIds,
    rootInstanceId: stackIds[0],
    stackKind: 'land',
  });
  return { independentIds, moveIds, targetId, equipmentIds, overlapIds, faceDownId, stackIds, transferId };
}

async function seedDenseBoard(request: APIRequestContext, setup: Setup): Promise<{
  navigationId: string;
  actionIds: string[];
  stackCycleIds: string[];
  confirmationIds: string[];
}> {
  const owner = setup.players[0]!;
  const initial = await gameSnapshot(request, setup.gameId, owner.token);
  for (const zone of ['library', 'hand', 'command'] as const) {
    const ids = zoneCards(initial, owner.user.id, zone).map(cardId);
    if (ids.length === 0) continue;
    await acceptedRuntimeCommand(request, setup, owner, 'cards.moved', {
      playerId: owner.user.id,
      fromZone: zone,
      toZone: 'battlefield',
      instanceIds: ids,
    });
  }
  const dense = await gameSnapshot(request, setup.gameId, owner.token);
  const ids = zoneCards(dense, owner.user.id, 'battlefield').map(cardId);
  expect(ids).toHaveLength(100);
  await acceptedRuntimeCommand(request, setup, owner, 'cards.position.changed', {
    playerId: owner.user.id,
    zone: 'battlefield',
    positions: ids.map((instanceId, index) => ({
      instanceId,
      position: {
        x: 0.25 + (index % 10) * 0.035 + (index < 20 ? 0 : (index % 3) * 0.003),
        y: 0.22 + Math.floor(index / 10) * 0.035,
        unit: 'ratio',
      },
    })),
  });
  const targetId = ids[20]!;
  for (const equipmentInstanceId of ids.slice(21, 26)) {
    await acceptedRuntimeCommand(request, setup, owner, 'attachment.created', { equipmentInstanceId, attachedToInstanceId: targetId });
  }
  const stackIds = ids.slice(30, 38);
  await acceptedRuntimeCommand(request, setup, owner, 'battlefield.stack.created', {
    orderedInstanceIds: stackIds,
    rootInstanceId: stackIds[0],
    stackKind: 'land',
  });
  await acceptedRuntimeCommand(request, setup, owner, 'cards.face_down.set', {
    instanceIds: ids.slice(40, 45),
    faceDown: true,
  });
  return {
    navigationId: ids[0]!,
    actionIds: ids.slice(50, 53),
    stackCycleIds: ids.slice(60, 62),
    confirmationIds: ids.slice(70, 72),
  };
}

async function acceptedRuntimeCommand(
  request: APIRequestContext,
  setup: Setup,
  actor: Player,
  type: string,
  payload: JsonObject,
): Promise<void> {
  const before = await gameSnapshot(request, setup.gameId, actor.token);
  const outcome = await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: actor.token,
    baseVersion: Number(before['version'] ?? 1),
    type,
    payload,
  });
  expect(outcome.version).toBe(Number(before['version']) + 1);
}

async function expectAtomicToolbarAction(
  request: APIRequestContext,
  setup: Setup,
  audit: Audit,
  page: Page,
  actionId: string,
  commandType: string,
  confirmation = false,
): Promise<void> {
  const beforeStore = await eventStoreState(setup.gameId);
  const beforeSnapshot = await gameSnapshot(request, setup.gameId, setup.players[0]!.token);
  const commandBaseline = commandFrames(audit.sent).length;
  await clickToolbarAction(page, actionId);
  if (confirmation) await confirmDialog(page);
  await expect.poll(() => commandFrames(audit.sent).length, { timeout: 20_000 }).toBe(commandBaseline + 1);
  expect(commandFrames(audit.sent).at(-1)?.['type']).toBe(commandType);
  await expect.poll(async () => Number((await gameSnapshot(request, setup.gameId, setup.players[0]!.token))['version'])).toBe(Number(beforeSnapshot['version']) + 1);
  expect(await eventStoreState(setup.gameId)).toEqual({ count: beforeStore.count + 1, maxVersion: beforeStore.maxVersion + 1 });
}

async function playerContext(
  browser: Browser,
  baseURL: string,
  player: Player,
  viewport: { width: number; height: number },
  observeLongTasks = false,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL,
    viewport,
    storageState: authStorageState(baseURL, player.user, player.refreshToken),
  });
  context.setDefaultTimeout(12_000);
  await context.addInitScript(({ longTasks }) => {
    localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
    if (!longTasks || typeof PerformanceObserver === 'undefined') return;
    const durations: number[] = [];
    (globalThis as unknown as { __sprint5LongTasks: number[] }).__sprint5LongTasks = durations;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) durations.push(entry.duration);
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      // Long Task API is optional; the functional duration gate remains active.
    }
  }, { longTasks: observeLongTasks });
  return context;
}

function createAudit(page: Page, gameId: string): Audit {
  const audit: Audit = { received: [], sent: [], errors: [], recoveryRequests: [] };
  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => { const frame = parseFrame(event.payload); if (frame) audit.received.push(frame); });
    socket.on('framesent', (event) => { const frame = parseFrame(event.payload); if (frame) audit.sent.push(frame); });
  });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || /target_not_found|resync_required|fallback|unknown card/i.test(message.text())) {
      audit.errors.push(message.text());
    }
  });
  page.on('request', (outgoing) => {
    if (outgoing.method() === 'GET' && /\/(snapshot|bootstrap)(?:\?|$)/.test(outgoing.url()) && outgoing.url().includes(`/games/${gameId}`)) {
      audit.recoveryRequests.push(outgoing.url());
    }
  });
  return audit;
}

function assertCleanAudit(audit: Audit): void {
  expect(audit.received.some((frame) => frame['kind'] === 'game_patch' || frame['kind'] === 'resync_required')).toBe(false);
  expect(JSON.stringify(audit.received)).not.toMatch(/target_not_found|unknown card/i);
  expect(audit.errors.filter((error) => /target_not_found|resync_required|fallback|unknown card|uncaught/i.test(error))).toEqual([]);
}

async function assertServicesAndMetrics(request: APIRequestContext, gameId?: string): Promise<void> {
  for (const url of SERVICE_URLS) {
    await expect.poll(async () => {
      try { return (await request.get(url, { timeout: 10_000 })).ok(); } catch { return false; }
    }, { timeout: 60_000, message: `${url} did not become ready` }).toBe(true);
  }
  const response = await request.get(RUNTIME_METRICS_URL, { timeout: 10_000 });
  const metrics = await response.json() as JsonObject;
  expect(metrics['runtime']).toBeDefined();
  expect(metrics['gateway']).toBeDefined();
  expect(metrics['totals']).toBeDefined();
  if (gameId) {
    const actors = metrics['actors'] as JsonObject[] | undefined ?? [];
    const actor = actors.find((candidate) => candidate['gameId'] === gameId);
    expect(actor, `Runtime metrics are missing actor ${gameId}`).toBeDefined();
    expect(Number(actor?.['actor.queue_depth'] ?? -1)).toBe(0);
  }
}

async function restartRuntime(request: APIRequestContext): Promise<void> {
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], {
    cwd: resolve(process.cwd(), '..'),
    timeout: 60_000,
    windowsHide: true,
  });
  await expect.poll(async () => {
    try { return (await request.get(`${RUNTIME_BASE_URL}/readyz`, { timeout: 5_000 })).ok(); } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
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

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: bearer(token) });
  await expectApiOk(response, 'load Sprint 5E snapshot');
  return ((await response.json()) as { game?: { snapshot?: JsonObject } }).game?.snapshot ?? {};
}

function canonicalAuthoritativeState(snapshot: JsonObject): JsonObject {
  return stripVolatileProjectionFields({
    version: snapshot['version'],
    phase: snapshot['phase'],
    status: snapshot['status'],
    players: snapshot['players'],
    attachments: snapshot['attachments'],
    battlefieldStacks: snapshot['battlefieldStacks'],
    turn: snapshot['turn'],
  }) as JsonObject;
}

function stripVolatileProjectionFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatileProjectionFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as JsonObject)
    .filter(([key]) => key !== 'updatedAt')
    .map(([key, entry]) => [key, stripVolatileProjectionFields(entry)]));
}

function zoneCards(snapshot: JsonObject, playerId: string, zone: string): JsonObject[] {
  return ((snapshot['players'] as Record<string, JsonObject> | undefined)?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined)?.[zone] ?? [];
}

function cardId(card: JsonObject): string {
  return String(card['instanceId'] ?? '');
}

function battlefieldRoot(page: Page, playerId: string): Locator {
  return page.locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"]`).first();
}

function battlefieldCards(page: Page, playerId: string): Locator {
  return battlefieldRoot(page, playerId).locator('[data-testid="game-card"][data-zone="battlefield"]');
}

function battlefieldCard(page: Page, playerId: string, instanceId: string): Locator {
  return battlefieldRoot(page, playerId).locator(`[data-testid="game-card"][data-card-instance-id="${instanceId}"]`);
}

async function visibleSelectableIds(page: Page, playerId: string): Promise<string[]> {
  return battlefieldCards(page, playerId).evaluateAll((elements) => elements.flatMap((element) => {
    const card = element as HTMLButtonElement;
    const bounds = card.getBoundingClientRect();
    return card.dataset['selectionHidden'] !== 'true' && !card.disabled && bounds.width > 0 && bounds.height > 0
      ? [card.dataset['cardInstanceId'] ?? '']
      : [];
  }).filter(Boolean));
}

async function selectedIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid="game-card"][aria-selected="true"]').evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset['cardInstanceId'] ?? '').filter(Boolean));
}

async function expectSelectedIds(page: Page, expected: readonly string[]): Promise<void> {
  await expect.poll(async () => (await selectedIds(page)).toSorted(), { timeout: 15_000 }).toEqual([...expected].toSorted());
  expect(new Set(await selectedIds(page)).size).toBe(expected.length);
}

async function selectCards(page: Page, playerId: string, ids: readonly string[]): Promise<void> {
  for (let index = 0; index < ids.length; index += 1) {
    await battlefieldCard(page, playerId, ids[index]!).click(index === 0 ? {} : { modifiers: ['Control'] });
  }
  await expectSelectedIds(page, ids);
}

async function selectCardsByKeyboard(page: Page, playerId: string, ids: readonly string[]): Promise<void> {
  for (const instanceId of ids) {
    await battlefieldCard(page, playerId, instanceId).focus();
    await page.keyboard.press('Space');
    await expect.poll(async () => (await selectedIds(page)).includes(instanceId)).toBe(true);
  }
  await expectSelectedIds(page, ids);
}

async function revealHand(page: Page, playerId: string): Promise<Locator> {
  const area = page.locator(`[data-testid="hand-area"][data-player-id="${playerId}"]`);
  if (!(await area.evaluate((element) => element.classList.contains('hand-revealed')))) {
    await area.locator('.hand-hover-strip').hover();
  }
  await expect(area).toHaveClass(/hand-revealed/);
  const cards = area.locator('[data-testid="game-card"][data-zone="hand"]');
  expect(await cards.count()).toBeGreaterThanOrEqual(4);
  return cards;
}

async function emptyCornerDirections(page: Page, playerId: string): Promise<Array<[Point, Point]>> {
  const corners = await battlefieldRoot(page, playerId).evaluate((element) => {
    const root = element as HTMLElement;
    const rect = root.getBoundingClientRect();
    const empty: Point[] = [];
    for (let row = 1; row < 30; row += 1) {
      for (let column = 1; column < 30; column += 1) {
        const point = { x: rect.left + rect.width * column / 30, y: rect.top + rect.height * row / 30 };
        if (document.elementFromPoint(point.x, point.y) === root) empty.push(point);
      }
    }
    if (empty.length < 4) throw new Error('Battlefield does not expose four empty marquee points.');
    const pick = (score: (point: Point) => number) => empty.toSorted((left, right) => score(left) - score(right))[0]!;
    return {
      topLeft: pick((point) => point.x + point.y),
      topRight: pick((point) => -point.x + point.y),
      bottomLeft: pick((point) => point.x - point.y),
      bottomRight: pick((point) => -point.x - point.y),
    };
  });
  return [
    [corners.topLeft, corners.bottomRight],
    [corners.bottomRight, corners.topLeft],
    [corners.topRight, corners.bottomLeft],
    [corners.bottomLeft, corners.topRight],
  ];
}

async function dragMarquee(page: Page, start: Point, end: Point): Promise<void> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('marquee-selection-rect')).toHaveCount(0);
}

async function touchDrag(page: Page, start: Point, end: Point): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end.x, y: end.y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

async function dragCardBy(page: Page, card: Locator, dx: number, dy: number): Promise<void> {
  const box = await card.boundingBox();
  if (!box) throw new Error('Selected card has no rendered bounds.');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
  await page.mouse.up();
}

async function clickToolbarAction(page: Page, actionId: string): Promise<void> {
  const toolbar = page.getByTestId('selection-action-toolbar');
  const direct = page.getByTestId(`selection-action-${actionId}`);
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  const directButtons = toolbar.locator('.selection-toolbar__actions--full button[data-testid]');
  const testIds = await directButtons.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-testid')));
  const index = testIds.indexOf(`selection-action-${actionId}`);
  if (index < 0) throw new Error(`Toolbar does not expose selection action ${actionId}.`);
  const overflow = toolbar.locator('details.selection-toolbar__overflow');
  if (!(await overflow.evaluate((element) => (element as HTMLDetailsElement).open))) await overflow.locator('summary').click();
  const menuButton = overflow.locator('[role="menu"] button').nth(index);
  await expect(menuButton).toBeVisible();
  await menuButton.click();
}

async function confirmDialog(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('button.primary-button').click();
  await expect(dialog).toHaveCount(0);
}

async function expectConfirmationFocus(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
}

async function activeCardId(page: Page): Promise<string | null> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset['cardInstanceId'] ?? null);
}

async function focusPlayerById(page: Page, playerId: string): Promise<void> {
  const panel = page.getByTestId('player-panel');
  if (await panel.getAttribute('data-player-id') === playerId) return;
  const drawer = page.locator('.opponents-drawer-handle');
  if (await drawer.isVisible() && await drawer.getAttribute('aria-expanded') !== 'true') {
    await drawer.click();
    await expect(drawer).toHaveAttribute('aria-expanded', 'true');
  }
  const board = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`);
  await expect(board).toBeVisible();
  await board.scrollIntoViewIfNeeded();
  await board.click();
  await expect(panel).toHaveAttribute('data-player-id', playerId);
}

async function setBattlefieldZoom(page: Page, zoom: 70 | 100 | 140): Promise<void> {
  const controls = page.getByTestId('battlefield-zoom-controls');
  const slider = page.getByTestId('battlefield-zoom-slider');
  if (!(await slider.isVisible())) await controls.locator('button').first().click();
  await slider.evaluate((node, value) => {
    const input = node as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, zoom);
  await expect(slider).toHaveValue(String(zoom));
  const stored = await page.evaluate((key) => localStorage.getItem(key), BATTLEFIELD_ZOOM_STORAGE_KEY);
  if (stored !== null || zoom !== 100) expect(stored).toBe(String(zoom));
}

async function assertPagesHaveNoOverflow(pages: readonly Page[]): Promise<void> {
  for (const page of pages) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
}

async function javascriptHeapSize(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
    return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null;
  });
}

function commandFrames(frames: readonly JsonObject[]): JsonObject[] {
  return frames.filter((frame) => frame['kind'] === 'command.v2' || frame['kind'] === 'command');
}

function connectionCount(audit: Audit): number {
  return audit.received.filter((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected').length;
}

async function waitForConnection(audit: Audit): Promise<void> {
  await expect.poll(() => connectionCount(audit), { timeout: 30_000 }).toBeGreaterThan(0);
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function expectApiOk(response: { ok(): boolean; status(): number; text(): Promise<string> }, action: string): Promise<void> {
  if (response.ok()) return;
  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  try {
    const value = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
  } catch {
    return null;
  }
}
