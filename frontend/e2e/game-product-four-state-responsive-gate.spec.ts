import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase } from './support/decks';
import { sendRuntimeCommand } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const BATTLEFIELD_ZOOM_STORAGE_KEY = 'commanderZone.gameTable.battlefieldZoomPercent';
const RESPONSIVE_STATES = ['normal', 'compact', 'aggressive', 'minimal'] as const;

type ResponsiveState = (typeof RESPONSIVE_STATES)[number];
type JsonObject = Record<string, unknown>;
type Player = Awaited<ReturnType<typeof createRealUserSession>> & { deckId: string };
type Setup = { gameId: string; players: Player[] };
type RelationFixture = {
  attachmentTargetId: string;
  attachmentMemberId: string;
  stackRootId: string;
  stackMemberId: string;
  faceDownId: string;
};
type BrowserAudit = {
  sentCommands: JsonObject[];
  gamePatch: number;
  resyncRequired: number;
  fallback: number;
  targetNotFound: number;
};

const PAIRWISE_SCENARIOS: ReadonlyArray<{
  players: number;
  viewport: { width: number; height: number };
  state: ResponsiveState;
  battlefieldZoom: 70 | 100 | 140;
}> = [
  { players: 2, viewport: { width: 1600, height: 1000 }, state: 'normal', battlefieldZoom: 70 },
  { players: 3, viewport: { width: 1280, height: 800 }, state: 'compact', battlefieldZoom: 100 },
  { players: 4, viewport: { width: 1050, height: 680 }, state: 'aggressive', battlefieldZoom: 140 },
  { players: 5, viewport: { width: 850, height: 600 }, state: 'minimal', battlefieldZoom: 70 },
  { players: 6, viewport: { width: 1600, height: 1000 }, state: 'normal', battlefieldZoom: 140 },
];

const STATE_TOKEN: Readonly<Record<ResponsiveState, string>> = {
  normal: '1',
  compact: '0.92',
  aggressive: '0.84',
  minimal: '0.74',
};

test.describe('Gameplay 1.0 Sprint 3C four-state responsive gate', () => {
  test.describe.configure({ mode: 'serial' });

  for (const scenario of PAIRWISE_SCENARIOS) {
    test(`${scenario.players}P keeps ${scenario.state} usable at BF zoom ${scenario.battlefieldZoom}%`, async ({ browser, request, baseURL }) => {
      test.setTimeout(420_000);
      if (!baseURL) throw new Error('Playwright baseURL is required.');

      const setup = await createGame(request, scenario.players);
      let relationFixture: RelationFixture | null = null;
      if (scenario.players !== 2) {
        await resolveGameToPlaying(request, setup.gameId, setup.players);
      }
      if (scenario.players === 6) {
        relationFixture = await seedResponsiveRelations(request, setup);
      }
      if (scenario.players !== 2) {
        await seedZoneModalCard(request, setup);
      }

      const contexts = await Promise.all(setup.players.map((player, index) => responsiveContext(
				browser,
				baseURL,
				player,
				index === 0
					? scenario.viewport
					: (index === 1 && scenario.players === 5 ? { width: 1500, height: 900 } : (index === 1 ? { width: 900, height: 620 } : { width: 1600, height: 1000 })),
				index === 0 ? scenario.battlefieldZoom : (index === 1 && scenario.battlefieldZoom === 140 ? 70 : 140),
			)));
      try {
				const pages = await Promise.all(contexts.map((context) => context.newPage()));
				const owner = pages[0]!;
				const viewer = pages[1]!;
        const ownerAudit = auditPage(owner);
        const viewerAudit = auditPage(viewer);
				await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
				await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
				await expectStablePresence(request, setup, pages);

        if (scenario.players === 2) {
          await assertMulliganAcrossFourStates(owner);
          await resolveGameToPlaying(request, setup.gameId, setup.players);
          await seedZoneModalCard(request, setup);
          await expect(owner.getByTestId('mulligan-overlay')).toBeHidden({ timeout: 30_000 });
          await owner.setViewportSize(scenario.viewport);
        }

        await assertResponsiveSurface(owner, scenario.state, scenario.players);
        await assertResponsiveSurface(viewer, expectedState(await viewer.evaluate(() => innerWidth), await viewer.evaluate(() => innerHeight), scenario.players), scenario.players);
        await assertOpponentProjection(owner, scenario.players);
        await assertOpponentProjection(viewer, scenario.players);
        await setBattlefieldZoom(owner, scenario.battlefieldZoom);
        await assertResponsiveSurface(owner, scenario.state, scenario.players);
        await assertZoneModalFits(owner);

        if (scenario.players === 6) {
          await assertRelationsAcrossStateTransitions(owner, viewer, request, setup, ownerAudit, relationFixture!);
        }

        await assertNoForbiddenRuntimeTraffic(ownerAudit);
        await assertNoForbiddenRuntimeTraffic(viewerAudit);
        await Promise.all([owner, viewer].map((page) => expect(page.locator('body')).not.toContainText('Unknown Card')));
      } finally {
        await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
      }
    });
  }

  test('manual native Chrome zoom resolves normal, compact, aggressive and minimal without shared mutations', async ({ browser, request, baseURL }) => {
    test.skip(process.env['E2E_MANUAL_RESPONSIVE_ZOOM'] !== '1', 'Run headed with E2E_MANUAL_RESPONSIVE_ZOOM=1 for native Chrome zoom QA.');
    test.setTimeout(20 * 60_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');

    const setup = await createGame(request, 6);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const relationFixture = await seedResponsiveRelations(request, setup);
    const contextA = await responsiveContext(browser, baseURL, setup.players[0]!, { width: 1280, height: 720 }, 100);
    const contextB = await responsiveContext(browser, baseURL, setup.players[1]!, { width: 1920, height: 1080 }, 140);
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      const auditA = auditPage(pageA);
      const auditB = auditPage(pageB);
      await Promise.all([pageA, pageB].map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all([pageA, pageB].map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all([pageA, pageB].map((page) => focusPlayerById(page, setup.players[0]!.user.id)));
      const baseline = await canonicalSharedState(request, setup);
      const baselineDpr = await pageA.evaluate(() => devicePixelRatio);
      const matrix = [
        { zoom: 80, state: 'normal' },
        { zoom: 100, state: 'compact' },
        { zoom: 125, state: 'aggressive' },
        { zoom: 150, state: 'minimal' },
      ] as const;
      const results: Array<{ browserZoom: number; battlefieldZoom: number; state: ResponsiveState; dpr: number; result: 'PASS' }> = [];

      for (const entry of matrix) {
        await pageA.bringToFront();
        await pageA.evaluate((zoom) => { document.title = `CZ Responsive QA zoom-${zoom}`; }, entry.zoom);
        console.log(`NATIVE_RESPONSIVE_ZOOM_ACTION zoom=${entry.zoom}: set Chrome page zoom to ${entry.zoom}% using browser chrome.`);
        await expect.poll(
          () => pageA.evaluate((base) => devicePixelRatio / base, baselineDpr),
          { timeout: 180_000 },
        ).toBeCloseTo(entry.zoom / 100, 2);
        await expect(pageA.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', entry.state);

        for (const battlefieldZoom of [70, 100, 140] as const) {
          const commandBaseline = responsiveMutationCommands(auditA.sentCommands).length;
          await setBattlefieldZoom(pageA, battlefieldZoom);
          await assertResponsiveSurface(pageA, entry.state, 6);
          await assertRelationCardsUsable(pageA, setup.players[0]!.user.id, relationFixture, true);
          await assertResponsiveSurface(pageB, 'normal', 6);
          expect(await canonicalSharedState(request, setup)).toEqual(baseline);
          expect(responsiveMutationCommands(auditA.sentCommands)).toHaveLength(commandBaseline);
          results.push({
            browserZoom: entry.zoom,
            battlefieldZoom,
            state: entry.state,
            dpr: await pageA.evaluate(() => devicePixelRatio),
            result: 'PASS',
          });
          await test.info().attach(`responsive-browser-${entry.zoom}-bf-${battlefieldZoom}.png`, {
            body: await pageA.screenshot(),
            contentType: 'image/png',
          });
        }
      }

      await pageA.bringToFront();
      await pageA.evaluate(() => { document.title = 'CZ Responsive QA zoom-100-final'; });
      console.log('NATIVE_RESPONSIVE_ZOOM_ACTION zoom=100: return Chrome page zoom to 100%.');
      await expect.poll(
        () => pageA.evaluate((base) => devicePixelRatio / base, baselineDpr),
        { timeout: 180_000 },
      ).toBeCloseTo(1, 2);
      await expect(pageA.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', 'compact');
      expect(await canonicalSharedState(request, setup)).toEqual(baseline);
      await assertNoForbiddenRuntimeTraffic(auditA);
      await assertNoForbiddenRuntimeTraffic(auditB);
      await test.info().attach('four-state-native-browser-zoom-results.json', {
        body: Buffer.from(JSON.stringify(results, null, 2)),
        contentType: 'application/json',
      });
    } finally {
      await Promise.all([contextA.close(), contextB.close()]);
    }
  });
});

async function responsiveContext(
  browser: Browser,
  baseURL: string,
  player: Player,
  viewport: { width: number; height: number },
  battlefieldZoom: number,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL,
    viewport,
    storageState: authStorageState(baseURL, player.user, player.refreshToken),
  });
  await context.addInitScript(({ key, zoom }) => {
    localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
    localStorage.setItem(key, String(zoom));
  }, { key: BATTLEFIELD_ZOOM_STORAGE_KEY, zoom: battlefieldZoom });
  return context;
}

async function assertMulliganAcrossFourStates(page: Page): Promise<void> {
  const states = [
    { viewport: { width: 1600, height: 1000 }, state: 'normal' },
    { viewport: { width: 1180, height: 820 }, state: 'compact' },
    { viewport: { width: 900, height: 600 }, state: 'aggressive' },
    { viewport: { width: 650, height: 480 }, state: 'minimal' },
  ] as const;
  for (const entry of states) {
    await page.setViewportSize(entry.viewport);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', entry.state);
    await expect(page.getByTestId('mulligan-overlay')).toBeVisible();
    await expect(page.getByTestId('mulligan-keep')).toBeVisible();
    await expect(page.getByTestId('mulligan-take')).toBeVisible();
    await expectElementInsideViewport(page, page.getByTestId('mulligan-overlay'));
    await expectNoGlobalOverflow(page);
  }
}

async function assertResponsiveSurface(page: Page, state: ResponsiveState, playerCount: number): Promise<void> {
  const screen = page.getByTestId('game-screen');
  await expect(screen).toHaveAttribute('data-responsive-state', state);
  await expect(screen).toHaveAttribute('data-responsive-supported', 'true');
  await expect(screen).toHaveAttribute('data-player-count', String(playerCount));
  expect(RESPONSIVE_STATES).toContain(await screen.getAttribute('data-responsive-state'));
  await expect.poll(() => screen.evaluate((node) => getComputedStyle(node).getPropertyValue('--game-responsive-card-scale').trim())).toBe(STATE_TOKEN[state]);
  await expect(page.getByTestId('battlefield-zone')).toBeVisible();
  await expect(page.getByTestId('hand-area')).toBeVisible();
  await expect(page.getByTestId('zone-piles')).toBeVisible();
  await expect(page.getByTestId('player-summary-panel').first()).toBeVisible();
  await expect(page.getByTestId('battlefield-zoom-controls')).toBeVisible();
  await expectElementInsideViewport(page, page.getByTestId('battlefield-zoom-controls'));
  await expect(page.getByTestId('game-unsupported-resolution-lock')).toBeHidden();
  await expectNoGlobalOverflow(page);
}

async function assertOpponentProjection(page: Page, playerCount: number): Promise<void> {
  const drawer = page.locator('.opponents-drawer-handle');
  if (await drawer.isVisible()) {
    await drawer.click();
    await expect(drawer).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(page.getByTestId('opponent-mini-board')).toHaveCount(playerCount - 1);
  const boards = page.getByTestId('opponent-mini-board');
  const visibleBoardCount = await drawer.isVisible() ? await boards.count() : Math.min(1, await boards.count());
  for (let index = 0; index < visibleBoardCount; index += 1) {
    await expect(boards.nth(index)).toBeVisible();
    await expectElementInsideViewport(page, boards.nth(index));
  }
  await expectNoGlobalOverflow(page);
  if (await drawer.isVisible() && await drawer.getAttribute('aria-expanded') === 'true') {
    await drawer.click();
    await expect(drawer).toHaveAttribute('aria-expanded', 'false');
  }
}

async function assertZoneModalFits(page: Page): Promise<void> {
  const graveyard = page.locator('[data-testid="drop-zone"][data-zone="graveyard"]');
  await graveyard.click();
  const modal = page.getByTestId('zone-modal');
  await expect(modal).toBeVisible();
  await expectElementInsideViewport(page, modal);
  await expect(page.getByTestId('zone-modal-close')).toBeVisible();
  await page.getByTestId('zone-modal-close').click();
  await expect(modal).toBeHidden();
}

async function assertRelationsAcrossStateTransitions(
  owner: Page,
  viewer: Page,
  request: APIRequestContext,
  setup: Setup,
  audit: BrowserAudit,
  fixture: RelationFixture,
): Promise<void> {
  await Promise.all([owner, viewer].map((page) => focusPlayerById(page, setup.players[0]!.user.id)));
  const baseline = await canonicalSharedState(request, setup);
  const mutationBaseline = responsiveMutationCommands(audit.sentCommands).length;
  await installResponsiveStateObserver(owner);
  const transitions = [
    { viewport: { width: 1400, height: 850 }, state: 'compact' },
    { viewport: { width: 1150, height: 700 }, state: 'aggressive' },
    { viewport: { width: 900, height: 600 }, state: 'minimal' },
    { viewport: { width: 1150, height: 700 }, state: 'aggressive' },
    { viewport: { width: 1400, height: 850 }, state: 'compact' },
    { viewport: { width: 1600, height: 1000 }, state: 'normal' },
  ] as const;
  for (const transition of transitions) {
    await owner.setViewportSize(transition.viewport);
    await assertResponsiveSurface(owner, transition.state, 6);
    await assertRelationCardsUsable(owner, setup.players[0]!.user.id, fixture, true);
  }
  expect(await observedResponsiveStates(owner)).toEqual(transitions.map((item) => item.state));
  expect(await canonicalSharedState(request, setup)).toEqual(baseline);
  expect(responsiveMutationCommands(audit.sentCommands)).toHaveLength(mutationBaseline);
  await assertRelationCardsUsable(viewer, setup.players[0]!.user.id, fixture, false);
}

async function assertRelationCardsUsable(
  page: Page,
  ownerId: string,
  fixture: RelationFixture,
  authorizedOwner: boolean,
): Promise<void> {
  for (const instanceId of Object.values(fixture)) {
    const isPrivateFaceDown = instanceId === fixture.faceDownId && !authorizedOwner;
    const card = isPrivateFaceDown
      ? opaqueBattlefieldShell(page, ownerId)
      : page.locator(`[data-testid="game-card"][data-owner-player-id="${ownerId}"][data-card-instance-id="${instanceId}"]`);
    if (isPrivateFaceDown) {
      await expect(page.locator(`[data-testid="game-card"][data-card-instance-id="${instanceId}"]`)).toHaveCount(0);
    }
    await expect(card).toBeVisible();
    await expect.poll(async () => {
      const box = await card.boundingBox();
      return box !== null && box.width >= 12 && box.height >= 12;
    }).toBe(true);
  }
}

function opaqueBattlefieldShell(page: Page, ownerId: string): Locator {
  return page.locator(
    `[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerId}"][data-card-instance-id^="${ownerId}-hidden-battlefield-"]`,
  ).first();
}

async function setBattlefieldZoom(page: Page, zoom: 70 | 100 | 140): Promise<void> {
  const controls = page.getByTestId('battlefield-zoom-controls');
  const slider = page.getByTestId('battlefield-zoom-slider');
  if (!(await slider.isVisible())) {
    await controls.locator('button').first().click();
  }
  await slider.evaluate((node, value) => {
    const input = node as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, zoom);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), BATTLEFIELD_ZOOM_STORAGE_KEY)).toBe(String(zoom));
  await expect(controls).toBeVisible();
}

async function focusPlayerById(page: Page, playerId: string): Promise<void> {
  const panel = page.getByTestId('player-panel');
  if (await panel.getAttribute('data-player-id') === playerId) return;
  const drawer = page.locator('.opponents-drawer-handle');
  const drawerVisible = await drawer.isVisible();
  if (drawerVisible && await drawer.getAttribute('aria-expanded') !== 'true') {
    await drawer.click();
    await expect(drawer).toHaveAttribute('aria-expanded', 'true');
  }
  const board = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`);
  await expect(board).toBeVisible();
	if (drawerVisible) await expectWithinViewport(page, board);
  await board.click();
  await expect(panel).toHaveAttribute('data-player-id', playerId);
}

async function expectWithinViewport(page: Page, locator: Locator): Promise<void> {
	await expect.poll(async () => {
		const box = await locator.boundingBox();
		const viewport = page.viewportSize();
		return box !== null && viewport !== null && box.x >= 0 && box.y >= 0
			&& box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
	}).toBe(true);
}

function auditPage(page: Page): BrowserAudit {
  const audit: BrowserAudit = { sentCommands: [], gamePatch: 0, resyncRequired: 0, fallback: 0, targetNotFound: 0 };
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      const frame = parseJsonFrame(payload);
      if (frame?.['kind'] === 'command.v2') audit.sentCommands.push(frame);
    });
    socket.on('framereceived', ({ payload }) => {
      const frame = parseJsonFrame(payload);
      if (!frame) return;
      const serialized = JSON.stringify(frame);
      if (frame['kind'] === 'game_patch') audit.gamePatch++;
      if (frame['kind'] === 'resync_required' || frame['status'] === 'resync_required') audit.resyncRequired++;
      if (frame['kind'] === 'fallback' || frame['kind'] === 'recovery_required') audit.fallback++;
      if (/target_not_found/i.test(serialized)) audit.targetNotFound++;
    });
  });
  return audit;
}

async function assertNoForbiddenRuntimeTraffic(audit: BrowserAudit): Promise<void> {
  expect(audit.gamePatch).toBe(0);
  expect(audit.resyncRequired).toBe(0);
  expect(audit.fallback).toBe(0);
  expect(audit.targetNotFound).toBe(0);
}

function responsiveMutationCommands(commands: JsonObject[]): JsonObject[] {
  return commands.filter((command) => {
    const type = String(command['type'] ?? '');
    return type === 'card.position.changed'
      || type === 'cards.position.changed'
      || type.startsWith('attachment.')
      || type.startsWith('battlefield.stack.');
  });
}

async function installResponsiveStateObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="game-screen"]');
    if (!root) throw new Error('game screen missing');
    const target = window as Window & { __responsiveStates?: string[]; __responsiveObserver?: MutationObserver };
    target.__responsiveStates = [];
    target.__responsiveObserver?.disconnect();
    target.__responsiveObserver = new MutationObserver(() => {
      const state = root.dataset['responsiveState'];
      if (state && target.__responsiveStates?.at(-1) !== state) target.__responsiveStates?.push(state);
    });
    target.__responsiveObserver.observe(root, { attributes: true, attributeFilter: ['data-responsive-state'] });
  });
}

async function observedResponsiveStates(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as Window & { __responsiveStates?: string[] }).__responsiveStates ?? []);
}

async function expectElementInsideViewport(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) return false;
    return box.x >= -1
      && box.y >= -1
      && box.x + Math.min(box.width, viewport.width) <= viewport.width + 1
      && box.y + Math.min(box.height, viewport.height) <= viewport.height + 1;
  }).toBe(true);
}

async function expectNoGlobalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(root.scrollWidth, document.body.scrollWidth) <= root.clientWidth + 1;
  })).toBe(true);
}

function expectedState(width: number, height: number, playerCount: number): ResponsiveState {
  const usableWidth = width - Math.max(0, playerCount - 2) * 48 - (width < height ? 48 : 0);
  const usableHeight = height - Math.max(0, playerCount - 4) * 18;
  if (usableWidth >= 1280 && usableHeight >= 820) return 'normal';
  if (usableWidth >= 960 && usableHeight >= 650) return 'compact';
  if (usableWidth >= 720 && usableHeight >= 520) return 'aggressive';
  return 'minimal';
}

async function seedResponsiveRelations(request: APIRequestContext, setup: Setup): Promise<RelationFixture> {
  const snapshot = await gameSnapshot(request, setup.gameId, setup.players[0]!.token);
  let version = Number(snapshot['version'] ?? 1);
  const ownerId = setup.players[0]!.user.id;
  const ids = zoneIds(snapshot, ownerId, 'hand').slice(0, 5);
  expect(ids).toHaveLength(5);
  for (const [index, instanceId] of ids.entries()) {
    const result = await sendRuntimeCommand(request, {
      gameId: setup.gameId,
      token: setup.players[0]!.token,
      baseVersion: version,
      type: 'card.moved',
      payload: {
        playerId: ownerId,
        fromZone: 'hand',
        toZone: 'battlefield',
        instanceId,
        position: { x: 0.14 + index * 0.17, y: index < 2 ? 0.3 : 0.68, unit: 'ratio' },
      },
    });
    version = result.version;
  }
  version = (await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'attachment.created',
    payload: { equipmentInstanceId: ids[1], attachedToInstanceId: ids[0] },
  })).version;
  version = (await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'battlefield.stack.created',
    payload: { orderedInstanceIds: [ids[2], ids[3]], rootInstanceId: ids[2], stackKind: 'land' },
  })).version;
  await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'card.face_down.changed',
    payload: { playerId: ownerId, instanceId: ids[4], faceDown: true },
  });

  return {
    attachmentTargetId: ids[0]!,
    attachmentMemberId: ids[1]!,
    stackRootId: ids[2]!,
    stackMemberId: ids[3]!,
    faceDownId: ids[4]!,
  };
}

async function seedZoneModalCard(request: APIRequestContext, setup: Setup): Promise<void> {
  const snapshot = await gameSnapshot(request, setup.gameId, setup.players[0]!.token);
  const ownerId = setup.players[0]!.user.id;
  const instanceId = zoneIds(snapshot, ownerId, 'hand')[0];
  expect(instanceId).toBeTruthy();
  await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: Number(snapshot['version'] ?? 1),
    type: 'card.moved',
    payload: {
      playerId: ownerId,
      fromZone: 'hand',
      toZone: 'graveyard',
      instanceId,
    },
  });
}

async function canonicalSharedState(request: APIRequestContext, setup: Setup): Promise<JsonObject> {
  const snapshot = await gameSnapshot(request, setup.gameId, setup.players[0]!.token);
  const relations = snapshot['relations'] as JsonObject | undefined;
  const positions: Record<string, unknown> = {};
  for (const player of Object.values((snapshot['players'] as Record<string, JsonObject> | undefined) ?? {})) {
    const zones = player['zones'] as Record<string, unknown[]> | undefined;
    for (const card of (zones?.['battlefield'] ?? [])) {
      if (card && typeof card === 'object') {
        const value = card as JsonObject;
        positions[String(value['instanceId'])] = value['position'];
      }
    }
  }
  return {
    version: snapshot['version'],
    positions,
    attachments: relations?.['attachments'] ?? snapshot['attachments'] ?? [],
    battlefieldStacks: relations?.['battlefieldStacks'] ?? snapshot['battlefieldStacks'] ?? [],
  };
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: bearer(token) });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { game: { snapshot: JsonObject } }).game.snapshot;
}

async function expectStablePresence(request: APIRequestContext, setup: Setup, pages: readonly Page[]): Promise<void> {
	await expect.poll(async () => {
		const live = await gameSnapshot(request, setup.gameId, setup.players[0]!.token);
		const presence = (live['presence'] ?? {}) as Record<string, JsonObject>;
		return setup.players.every((player) => presence[player.user.id]?.['connected'] !== false);
	}, { timeout: 30_000 }).toBe(true);
	await Promise.all(pages.map((page) => expect(page.locator('app-game-disconnect-vote-modal [role="dialog"]')).toHaveCount(0)));
}

function zoneIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  const player = ((snapshot['players'] as Record<string, JsonObject> | undefined) ?? {})[playerId];
  const cards = ((player?.['zones'] as Record<string, unknown[]> | undefined) ?? {})[zone] ?? [];
  return cards.flatMap((card) => card && typeof card === 'object' && typeof (card as JsonObject)['instanceId'] === 'string'
    ? [String((card as JsonObject)['instanceId'])]
    : []);
}

async function createGame(request: APIRequestContext, playerCount: number): Promise<Setup> {
  const runId = `s3c${playerCount}${Date.now().toString(36)}`;
  const players: Player[] = [];
  for (let index = 0; index < playerCount; index++) {
    const session = await createRealUserSession(request, `${runId}-${index}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `${runId}-d${index}`,
    });
    players.push({ ...session, deckId: deck.deckId });
  }
  const create = await request.post(`${API_BASE_URL}/rooms`, {
    headers: bearer(players[0]!.token),
    data: {
      deckId: players[0]!.deckId,
      visibility: 'private',
      name: `Responsive ${runId}`,
      format: 'commander',
      maxPlayers: playerCount,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  expect(create.ok(), await create.text()).toBe(true);
  const roomId = String(((await create.json()) as { room: { id: string } }).room.id);
  for (const player of players.slice(1)) {
    const join = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
      headers: bearer(player.token),
      data: { deckId: player.deckId },
    });
    expect(join.ok(), await join.text()).toBe(true);
  }
  await resolveTurnOrder(request, roomId, players);
  const start = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: bearer(players[0]!.token) });
  expect(start.ok(), await start.text()).toBe(true);
  const gameId = String(((await start.json()) as { game: { id: string } }).game.id);
  return { gameId, players };
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, players: Player[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const room = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: bearer(players[0]!.token) });
    const entries = ((await room.json()) as { room: { players: Array<{ turnRolls?: number[] }> } }).room.players;
    const rolls = entries.map((entry) => entry.turnRolls?.join('-') ?? '');
    if (rolls.length === players.length && rolls.every(Boolean) && new Set(rolls).size === players.length) return;
    for (const player of players) {
      const roll = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: bearer(player.token) });
      if (!roll.ok() && roll.status() !== 409) throw new Error(await roll.text());
    }
  }
  throw new Error('Could not resolve responsive gate turn order.');
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function parseJsonFrame(payload: string | Buffer): JsonObject | null {
  try {
    return JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as JsonObject;
  } catch {
    return null;
  }
}
