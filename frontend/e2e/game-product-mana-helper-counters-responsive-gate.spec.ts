import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase } from './support/decks';
import { sendRuntimeCommand } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const BATTLEFIELD_ZOOM_STORAGE_KEY = 'commanderZone.gameTable.battlefieldZoomPercent';
const execFileAsync = promisify(execFile);
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

type JsonObject = Record<string, unknown>;
type ResponsiveState = 'normal' | 'compact' | 'aggressive' | 'minimal';
type IdentityFixture = 'white-dfc' | 'ur' | 'wubrg' | 'colorless' | 'partners';
type Player = Awaited<ReturnType<typeof createRealUserSession>> & {
  deckId: string;
  expectedIdentity: string[];
};
type Setup = { gameId: string; players: Player[] };
type CounterFixture = {
  counterCardId: string;
  attachmentId: string;
  stackRootId: string;
  stackMemberId: string;
  faceDownId: string;
};
type BrowserAudit = {
  commands: JsonObject[];
  gamePatch: number;
  resyncRequired: number;
  fallback: number;
  targetNotFound: number;
};

const SCENARIOS: ReadonlyArray<{
  players: 2 | 3 | 4 | 5 | 6;
  viewport: { width: number; height: number };
  state: ResponsiveState;
  battlefieldZoom: 70 | 100 | 140;
  identity: IdentityFixture;
}> = [
  { players: 2, viewport: { width: 1600, height: 1000 }, state: 'normal', battlefieldZoom: 70, identity: 'white-dfc' },
  { players: 3, viewport: { width: 1280, height: 800 }, state: 'compact', battlefieldZoom: 100, identity: 'ur' },
  { players: 4, viewport: { width: 1050, height: 680 }, state: 'aggressive', battlefieldZoom: 140, identity: 'wubrg' },
  { players: 5, viewport: { width: 850, height: 600 }, state: 'minimal', battlefieldZoom: 70, identity: 'colorless' },
  { players: 6, viewport: { width: 1600, height: 1000 }, state: 'normal', battlefieldZoom: 140, identity: 'partners' },
];

test.describe('Gameplay 1.0 Sprint 3D mana helper and card counters responsive gate', () => {
  test.describe.configure({ mode: 'serial' });

  for (const scenario of SCENARIOS) {
    test(`${scenario.players}P ${scenario.identity} keeps vertical mana and five counters in ${scenario.state}`, async ({ browser, request, baseURL }) => {
      test.setTimeout(480_000);
      if (!baseURL) throw new Error('Playwright baseURL is required.');

      const setup = await createGame(request, scenario.players, scenario.identity);
      await resolveGameToPlaying(request, setup.gameId, setup.players);
      const fixture = await seedCounterRelations(request, setup);
      const contexts = await createContexts(browser, baseURL, setup, scenario.viewport, scenario.battlefieldZoom);
      try {
        const pages = await Promise.all(contexts.map((context) => context.newPage()));
        const audits = pages.map(auditPage);
        await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
        await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
				await expectStablePresence(request, setup, pages);
        await Promise.all(pages.map((page) => focusPlayerById(page, setup.players[0]!.user.id)));

        await expect(pages[0]!.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', scenario.state);
        await assertManaHelper(pages[0]!, canonicalIdentity(setup.players[0]!.expectedIdentity));
        await assertFiveCounters(pages[0]!, fixture.counterCardId, true);
        await assertFiveCounters(pages[1]!, fixture.counterCardId, false);
        await assertFiveCounters(pages.at(-1)!, fixture.counterCardId, false);
        expect(await counterValues(pages[0]!, fixture.counterCardId)).toEqual(expect.arrayContaining([1, 9, 10, 99, 100]));
        await assertNoCriticalOverlap(pages[0]!);

        const mutationBaseline = layoutMutationCommands(audits[0]!.commands).length;
        await incrementLocalManaAndKeepAcrossLayout(pages[0]!, scenario.battlefieldZoom);
        expect(layoutMutationCommands(audits[0]!.commands)).toHaveLength(mutationBaseline);

        await changeCountersFromKeyboardAndPointer(pages, fixture.counterCardId);
        await assertReadonlyCounterDoesNotMutate(request, setup, pages[1]!, fixture.counterCardId);

        if (scenario.players === 6) {
          await assertAllStatesKeepControls(pages[0]!, fixture.counterCardId);
          await assertRefreshReconnectRestart(request, setup, pages, fixture.counterCardId);
        } else {
          await pages[1]!.reload();
          await expect(pages[1]!.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
          await focusPlayerById(pages[1]!, setup.players[0]!.user.id);
          await assertFiveCounters(pages[1]!, fixture.counterCardId, false);
        }

        for (const audit of audits) assertCleanAudit(audit);
        for (const page of pages) {
          await expect(page.locator('body')).not.toContainText('Unknown Card');
          await expectNoGlobalOverflow(page);
        }
      } finally {
        await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
      }
    });
  }

  test('manual native Chrome zoom certifies 80/100/125/150 with BF 70/100/140', async ({ browser, request, baseURL }) => {
    test.skip(process.env['E2E_MANUAL_MANA_COUNTER_ZOOM'] !== '1', 'Run headed with native Chrome zoom for Sprint 3D manual QA.');
    test.setTimeout(20 * 60_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');

    const setup = await createGame(request, 6, 'partners');
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const fixture = await seedCounterRelations(request, setup);
    const contexts = await createContexts(browser, baseURL, setup, { width: 1280, height: 720 }, 100);
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const audit = auditPage(pages[0]!);
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(pages.map((page) => focusPlayerById(page, setup.players[0]!.user.id)));
      const baselineDpr = await pages[0]!.evaluate(() => devicePixelRatio);
      const identity = canonicalIdentity(setup.players[0]!.expectedIdentity);

      for (const browserZoom of [80, 100, 125, 150] as const) {
        await pages[0]!.bringToFront();
        await pages[0]!.evaluate((zoom) => { document.title = `CZ Sprint 3D zoom-${zoom}`; }, browserZoom);
        console.log(`NATIVE_MANA_COUNTER_ZOOM_ACTION zoom=${browserZoom}: set Chrome page zoom using native browser controls.`);
        await expect.poll(
          () => pages[0]!.evaluate((base) => devicePixelRatio / base, baselineDpr),
          { timeout: 180_000 },
        ).toBeCloseTo(browserZoom / 100, 2);

        for (const battlefieldZoom of [70, 100, 140] as const) {
          const layoutBaseline = layoutMutationCommands(audit.commands).length;
          await setBattlefieldZoom(pages[0]!, battlefieldZoom);
          await assertManaHelper(pages[0]!, identity);
          await assertFiveCounters(pages[0]!, fixture.counterCardId, true);
          await assertFiveCounters(pages[1]!, fixture.counterCardId, false);
          await assertFiveCounters(pages.at(-1)!, fixture.counterCardId, false);
          expect(layoutMutationCommands(audit.commands)).toHaveLength(layoutBaseline);
          await expectNoGlobalOverflow(pages[0]!);
        }
      }

      await pages[0]!.bringToFront();
      await pages[0]!.evaluate(() => { document.title = 'CZ Sprint 3D zoom-100-final'; });
      console.log('NATIVE_MANA_COUNTER_ZOOM_ACTION zoom=100: return Chrome page zoom to 100%.');
      await expect.poll(
        () => pages[0]!.evaluate((base) => devicePixelRatio / base, baselineDpr),
        { timeout: 180_000 },
      ).toBeCloseTo(1, 2);
      await assertManaHelper(pages[0]!, identity);
      await assertFiveCounters(pages[0]!, fixture.counterCardId, true);
      assertCleanAudit(audit);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function assertManaHelper(page: Page, expectedColors: readonly string[]): Promise<void> {
  const helper = page.getByTestId('mana-helper');
  const battlefield = page.getByTestId('battlefield-zone');
  await expect(helper).toBeVisible();
  await expect(helper).toHaveAttribute('data-mana-helper-orientation', 'vertical');
  const colors = await helper.locator('[data-mana-pool-color]').evaluateAll((buttons) =>
    buttons.map((button) => (button as HTMLElement).dataset['manaPoolColor'] ?? ''),
  );
  expect(colors).toEqual(expectedColors);
  expect(colors.at(-1)).toBe('C');
  expect(colors.filter((color) => !expectedColors.includes(color))).toHaveLength(0);

  const [helperBox, battlefieldBox] = await Promise.all([helper.boundingBox(), battlefield.boundingBox()]);
  expect(helperBox).not.toBeNull();
  expect(battlefieldBox).not.toBeNull();
  expect(Math.abs(helperBox!.x - battlefieldBox!.x)).toBeLessThanOrEqual(18);
  expect(Math.abs((helperBox!.y + helperBox!.height / 2) - (battlefieldBox!.y + battlefieldBox!.height / 2))).toBeLessThanOrEqual(4);

  const rowBoxes = await helper.locator('[data-mana-pool-color]').evaluateAll((buttons) => buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  }));
  expect(rowBoxes.every((box, index) => index === 0 || box.y > rowBoxes[index - 1]!.y)).toBe(true);
  expect(rowBoxes.every((box) => Math.abs(box.x - rowBoxes[0]!.x) <= 1)).toBe(true);

  const hitTargets = await helper.locator('[data-mana-pool-color]').evaluateAll((buttons) => buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === button || (hit !== null && button.contains(hit));
  }));
  expect(hitTargets.every(Boolean)).toBe(true);
}

async function assertFiveCounters(page: Page, instanceId: string, interactive: boolean): Promise<void> {
  const card = page.locator(`[data-testid="game-card"][data-card-instance-id="${instanceId}"]`);
  const rail = card.getByTestId('card-counter-rail');
  const markers = rail.locator('[data-counter-key]');
  await expect(card).toBeVisible();
  await expect(rail).toBeVisible();
  await expect(markers).toHaveCount(5);
  expect(['vertical', 'grid']).toContain(await rail.getAttribute('data-counter-orientation'));
  await expect(markers.nth(4)).toBeVisible();
  const values = await markers.evaluateAll((items) => items.map((item) => Number((item as HTMLElement).dataset['counterValue'])));
  expect(values.every(Number.isFinite)).toBe(true);
  expect(values).toContain(100);
  for (let index = 0; index < 5; index++) {
    const marker = markers.nth(index);
    const box = await marker.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(20);
    expect(box!.height).toBeGreaterThanOrEqual(20);
    expect(await marker.getAttribute('aria-label')).toContain('counter');
    expect(await marker.getAttribute('role')).toBe(interactive ? 'button' : null);
  }
}

async function incrementLocalManaAndKeepAcrossLayout(page: Page, initialZoom: 70 | 100 | 140): Promise<void> {
  const helper = page.getByTestId('mana-helper');
  const valueButton = helper.locator('[data-mana-pool-color]').last();
  await valueButton.focus();
  const add = helper.getByRole('button', { name: 'Add Colorless mana' });
  await expect(add).toBeVisible();
  await add.click();
  await expect(valueButton).toHaveAttribute('aria-label', 'Colorless mana: 1');
  await setBattlefieldZoom(page, initialZoom === 140 ? 70 : 140);
  await expect(valueButton).toHaveAttribute('aria-label', 'Colorless mana: 1');
  const current = page.viewportSize()!;
  await page.setViewportSize({ width: Math.max(720, current.width - 90), height: Math.max(520, current.height - 40) });
  await expect(page.getByTestId('mana-helper').locator('[data-mana-pool-color]').last()).toHaveAttribute('aria-label', 'Colorless mana: 1');
  await page.setViewportSize(current);
  await expect(page.getByTestId('mana-helper').locator('[data-mana-pool-color]').last()).toHaveAttribute('aria-label', 'Colorless mana: 1');
  await setBattlefieldZoom(page, initialZoom);
}

async function changeCountersFromKeyboardAndPointer(pages: Page[], instanceId: string): Promise<void> {
  const ownerCard = pages[0]!.locator(`[data-testid="game-card"][data-card-instance-id="${instanceId}"]`);
  await ownerCard.locator('[data-counter-key="+1/+1"]').click();
  await expect.poll(() => counterValues(pages[0]!, instanceId)).toEqual(expect.arrayContaining([2, 9, 10, 99, 100]));
  await expect.poll(() => counterValues(pages[1]!, instanceId)).toEqual(expect.arrayContaining([2, 9, 10, 99, 100]));
  const shield = ownerCard.locator('[data-counter-key="shield"]');
  await shield.focus();
  await shield.press('ArrowDown');
  await expect.poll(() => counterValues(pages[0]!, instanceId)).toEqual(expect.arrayContaining([2, 8, 10, 99, 100]));
  await expect.poll(() => counterValues(pages.at(-1)!, instanceId)).toEqual(expect.arrayContaining([2, 8, 10, 99, 100]));
}

async function assertReadonlyCounterDoesNotMutate(
  request: APIRequestContext,
  setup: Setup,
  page: Page,
  instanceId: string,
): Promise<void> {
  const before = await gameSnapshot(request, setup.gameId, setup.players[0]!.token);
  const marker = page.locator(`[data-testid="game-card"][data-card-instance-id="${instanceId}"] [data-counter-key]`).first();
  await marker.dispatchEvent('pointerup', { button: 0 });
  const after = await gameSnapshot(request, setup.gameId, setup.players[0]!.token);
  expect(after['version']).toBe(before['version']);
}

async function assertAllStatesKeepControls(page: Page, instanceId: string): Promise<void> {
  const transitions = [
    { viewport: { width: 1600, height: 1000 }, state: 'normal' },
    { viewport: { width: 1400, height: 850 }, state: 'compact' },
    { viewport: { width: 1150, height: 700 }, state: 'aggressive' },
    { viewport: { width: 900, height: 600 }, state: 'minimal' },
  ] as const;
  for (const transition of transitions) {
    await page.setViewportSize(transition.viewport);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', transition.state);
    await expect(page.getByTestId('mana-helper')).toBeVisible();
    await assertFiveCounters(page, instanceId, true);
    await expectNoGlobalOverflow(page);
  }
}

async function assertRefreshReconnectRestart(
  request: APIRequestContext,
  setup: Setup,
  pages: Page[],
  instanceId: string,
): Promise<void> {
  const sharedBefore = await canonicalCounterState(request, setup, instanceId);
  await pages[0]!.reload();
  await expect(pages[0]!.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
  await focusPlayerById(pages[0]!, setup.players[0]!.user.id);
  await assertFiveCounters(pages[0]!, instanceId, true);
  await expect(pages[0]!.getByTestId('mana-helper').locator('[data-mana-pool-color]').last()).toHaveAttribute('aria-label', 'Colorless mana: 0');

  await pages[1]!.reload();
  await expect(pages[1]!.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
  await focusPlayerById(pages[1]!, setup.players[0]!.user.id);
  await assertFiveCounters(pages[1]!, instanceId, false);

  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], {
    cwd: resolve(process.cwd(), '..'),
    timeout: 60_000,
    windowsHide: true,
  });
  await expect.poll(async () => {
    try {
      return (await request.get('http://127.0.0.1:8091/readyz')).ok();
    } catch {
      return false;
    }
  }, { timeout: 60_000 }).toBe(true);
  await Promise.all(pages.map((page) => page.reload()));
  await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
  await Promise.all(pages.map((page) => focusPlayerById(page, setup.players[0]!.user.id)));
  const sharedAfter = await canonicalCounterState(request, setup, instanceId);
  expect(Number(sharedAfter['version'])).toBeGreaterThanOrEqual(Number(sharedBefore['version']));
  const { version: _beforeVersion, ...gameplayBefore } = sharedBefore;
  const { version: _afterVersion, ...gameplayAfter } = sharedAfter;
  expect(gameplayAfter).toEqual(gameplayBefore);
  await assertFiveCounters(pages.at(-1)!, instanceId, false);
}

async function assertNoCriticalOverlap(page: Page): Promise<void> {
  const helper = page.getByTestId('mana-helper');
  const zoom = page.getByTestId('battlefield-zoom-controls');
  const [helperBox, zoomBox] = await Promise.all([helper.boundingBox(), zoom.boundingBox()]);
  expect(intersects(helperBox!, zoomBox!)).toBe(false);
}

function intersects(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

async function counterValues(page: Page, instanceId: string): Promise<number[]> {
  return page.locator(`[data-testid="game-card"][data-card-instance-id="${instanceId}"] [data-counter-key]`).evaluateAll(
    (markers) => markers.map((marker) => Number((marker as HTMLElement).dataset['counterValue'])),
  );
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
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), BATTLEFIELD_ZOOM_STORAGE_KEY)).toBe(String(zoom));
}

async function createContexts(
  browser: Browser,
  baseURL: string,
  setup: Setup,
  ownerViewport: { width: number; height: number },
  ownerZoom: 70 | 100 | 140,
): Promise<BrowserContext[]> {
  const profiles = setup.players.map((player, index) => ({
		player,
		viewport: index === 0 ? ownerViewport : (index === 1 ? { width: 900, height: 620 } : { width: 1600, height: 1000 }),
		zoom: index === 0 ? ownerZoom : (index === 1 ? 70 as const : 140 as const),
	}));
  return Promise.all(profiles.map(async ({ player, viewport, zoom }) => {
    const context = await browser.newContext({
      baseURL,
      viewport,
      storageState: authStorageState(baseURL, player.user, player.refreshToken),
    });
    await context.addInitScript(({ key, value }) => {
      localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
      localStorage.setItem(key, String(value));
    }, { key: BATTLEFIELD_ZOOM_STORAGE_KEY, value: zoom });
    return context;
  }));
}

async function expectStablePresence(request: APIRequestContext, setup: Setup, pages: readonly Page[]): Promise<void> {
	await expect.poll(async () => {
		const snapshot = await gameSnapshot(request, setup.gameId, setup.players[0]!.token);
		const presence = (snapshot['presence'] ?? {}) as Record<string, JsonObject>;
		return setup.players.every((player) => presence[player.user.id]?.['connected'] !== false);
	}, { timeout: 30_000 }).toBe(true);
	await Promise.all(pages.map((page) => expect(page.locator('app-game-disconnect-vote-modal [role="dialog"]')).toHaveCount(0)));
}

async function focusPlayerById(page: Page, playerId: string): Promise<void> {
  const panel = page.getByTestId('player-panel');
  if (await panel.getAttribute('data-player-id') === playerId) return;
  const drawer = page.getByTestId('opponents-drawer-toggle');
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
		if (box !== null && viewport !== null && box.x >= 0 && box.y >= 0
			&& box.x + box.width <= viewport.width && box.y + box.height <= viewport.height) return 'inside';
		return JSON.stringify({ box, viewport });
	}).toBe('inside');
}

async function seedCounterRelations(request: APIRequestContext, setup: Setup): Promise<CounterFixture> {
  const snapshot = await gameSnapshot(request, setup.gameId, setup.players[0]!.token);
  let version = Number(snapshot['version'] ?? 1);
  const playerId = setup.players[0]!.user.id;
  const ids = zoneIds(snapshot, playerId, 'hand').slice(0, 5);
  expect(ids).toHaveLength(5);
  for (const [index, instanceId] of ids.entries()) {
    version = (await sendRuntimeCommand(request, {
      gameId: setup.gameId,
      token: setup.players[0]!.token,
      baseVersion: version,
      type: 'card.moved',
      payload: {
        playerId,
        fromZone: 'hand',
        toZone: 'battlefield',
        instanceId,
        position: { x: 0.18 + index * 0.16, y: index < 2 ? 0.22 : 0.68, unit: 'ratio' },
      },
    })).version;
  }
  const counters = [
    { counter: '+1/+1', value: 1 },
    { counter: 'shield', value: 9 },
    { counter: 'charge', value: 10 },
    { counter: 'quest progress', value: 99 },
    { counter: 'red', value: 100 },
  ];
  for (const counter of counters) {
    version = (await sendRuntimeCommand(request, {
      gameId: setup.gameId,
      token: setup.players[0]!.token,
      baseVersion: version,
      type: 'card.counter.changed',
      payload: { playerId, instanceId: ids[0], ...counter },
    })).version;
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
    payload: { playerId, instanceId: ids[4], faceDown: true },
  });
  return {
    counterCardId: ids[0]!,
    attachmentId: ids[1]!,
    stackRootId: ids[2]!,
    stackMemberId: ids[3]!,
    faceDownId: ids[4]!,
  };
}

async function createGame(request: APIRequestContext, playerCount: number, identity: IdentityFixture): Promise<Setup> {
  const runId = `s3d${playerCount}${Date.now().toString(36)}`;
  const players: Player[] = [];
  for (let index = 0; index < playerCount; index++) {
    const session = await createRealUserSession(request, `${runId}-${index}`);
    const deck = index === 0
      ? await createIdentityDeck(request, session.token, `I-${runId.slice(-12)}`, identity)
      : await createBasicCommanderDeckFromDatabase(request, { ownerToken: session.token, name: `D${index}-${runId.slice(-12)}` })
        .then((basic) => ({ deckId: basic.deckId, colorIdentity: basic.commander.colorIdentity }));
    players.push({ ...session, deckId: deck.deckId, expectedIdentity: deck.colorIdentity });
  }
  const create = await request.post(`${API_BASE_URL}/rooms`, {
    headers: bearer(players[0]!.token),
    data: {
      deckId: players[0]!.deckId,
      visibility: 'private',
      name: `Mana counters ${runId}`,
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
  return { gameId: String(((await start.json()) as { game: { id: string } }).game.id), players };
}

async function createIdentityDeck(
  request: APIRequestContext,
  token: string,
  name: string,
  identity: IdentityFixture,
): Promise<{ deckId: string; colorIdentity: string[] }> {
  if (identity === 'white-dfc') {
    const deck = await createBasicCommanderDeckFromDatabase(request, { ownerToken: token, name, includeWhiteDfc: true });
    return { deckId: deck.deckId, colorIdentity: deck.commander.colorIdentity };
  }
  const fixture: {
    commanders: Array<readonly [string, string, readonly string[]]>;
    land: readonly [string, string, readonly string[]];
  } = identity === 'ur'
    ? { commanders: [['Niv-Mizzet', 'Niv-Mizzet, the Firemind', ['U', 'R']]], land: ['Island', 'Island', ['U']] }
    : identity === 'wubrg'
      ? { commanders: [['Kenrith', 'Kenrith, the Returned King', ['W', 'U', 'B', 'R', 'G']]], land: ['Plains', 'Plains', ['W']] }
      : identity === 'colorless'
        ? { commanders: [['Ulamog', 'Ulamog, the Ceaseless Hunger', []]], land: ['Wastes', 'Wastes', []] }
        : {
          commanders: [
            ['Tymna', 'Tymna the Weaver', ['W', 'B']],
            ['Kraum', "Kraum, Ludevic's Opus", ['U', 'R']],
          ],
          land: ['Plains', 'Plains', ['W']],
        };
  const commanders = await Promise.all(fixture.commanders.map(([query, exact, colors]) => findCard(request, query!, exact!, colors!, true)));
  const land = await findCard(request, fixture.land[0]!, fixture.land[1]!, fixture.land[2]!, false);
  const response = await request.post(`${API_BASE_URL}/decks/quick-build`, {
    headers: bearer(token),
    data: {
      name,
      cards: [
        ...commanders.map((commander) => ({ scryfallId: commander.scryfallId, quantity: 1, section: 'commander' })),
        { scryfallId: land.scryfallId, quantity: 100 - commanders.length, section: 'main' },
      ],
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const payload = await response.json() as { deck?: { id?: string } };
  return {
    deckId: String(payload.deck?.id ?? ''),
    colorIdentity: canonicalIdentity(commanders.flatMap((commander) => commander.colorIdentity ?? [])).filter((color) => color !== 'C'),
  };
}

async function findCard(
  request: APIRequestContext,
  query: string,
  exactName: string,
  expectedIdentity: readonly string[],
  legendary: boolean,
): Promise<{ scryfallId: string; colorIdentity?: string[] }> {
  const response = await request.get(`${API_BASE_URL}/cards/search?q=${encodeURIComponent(query)}&limit=30&commanderLegal=true`);
  expect(response.ok(), await response.text()).toBe(true);
  const payload = await response.json() as { data?: Array<{ scryfallId: string; name: string; typeLine?: string; colorIdentity?: string[] }> };
  const expected = [...expectedIdentity].sort().join('');
  const candidates = payload.data ?? [];
  const card = candidates.find((candidate) => candidate.name === exactName)
    ?? candidates.find((candidate) => {
      const identity = [...(candidate.colorIdentity ?? [])].sort().join('');
      const typeMatches = legendary
        ? (candidate.typeLine ?? '').toLowerCase().includes('legendary')
        : (candidate.typeLine ?? '').toLowerCase().includes('basic land');
      return identity === expected && typeMatches;
    });
  if (!card) throw new Error(`Missing Sprint 3D fixture card: ${exactName}`);
  return card;
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, players: Player[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const room = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: bearer(players[0]!.token) });
    const entries = ((await room.json()) as { room: { players: Array<{ turnRolls?: number[] }> } }).room.players;
    const rolls = entries.map((entry) => entry.turnRolls?.join('-') ?? '');
    if (rolls.length === players.length && rolls.every(Boolean) && new Set(rolls).size === players.length) return;
    for (const player of players) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: bearer(player.token) });
      if (!response.ok() && response.status() !== 409) throw new Error(await response.text());
    }
  }
  throw new Error('Could not resolve Sprint 3D turn order.');
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: bearer(token) });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { game: { snapshot: JsonObject } }).game.snapshot;
}

async function canonicalCounterState(request: APIRequestContext, setup: Setup, instanceId: string): Promise<JsonObject> {
  const snapshot = await gameSnapshot(request, setup.gameId, setup.players[0]!.token);
  const card = battlefieldCard(snapshot, setup.players[0]!.user.id, instanceId);
  return {
    version: snapshot['version'],
    counters: card['counters'],
    position: card['position'],
    attachments: (snapshot['relations'] as JsonObject | undefined)?.['attachments'] ?? snapshot['attachments'],
    stacks: (snapshot['relations'] as JsonObject | undefined)?.['battlefieldStacks'] ?? snapshot['battlefieldStacks'],
  };
}

function battlefieldCard(snapshot: JsonObject, playerId: string, instanceId: string): JsonObject {
  const player = ((snapshot['players'] as Record<string, JsonObject> | undefined) ?? {})[playerId];
  const cards = ((player?.['zones'] as Record<string, unknown[]> | undefined) ?? {})['battlefield'] ?? [];
  const card = cards.find((candidate) => candidate && typeof candidate === 'object' && (candidate as JsonObject)['instanceId'] === instanceId);
  if (!card || typeof card !== 'object') throw new Error(`Battlefield card ${instanceId} not found.`);
  return card as JsonObject;
}

function zoneIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  const player = ((snapshot['players'] as Record<string, JsonObject> | undefined) ?? {})[playerId];
  const cards = ((player?.['zones'] as Record<string, unknown[]> | undefined) ?? {})[zone] ?? [];
  return cards.flatMap((card) => card && typeof card === 'object' && typeof (card as JsonObject)['instanceId'] === 'string'
    ? [String((card as JsonObject)['instanceId'])]
    : []);
}

function canonicalIdentity(identity: readonly string[]): string[] {
  const colors = new Set(identity.map((color) => color.toUpperCase()));
  return COLOR_ORDER.filter((color) => color === 'C' || colors.has(color));
}

function auditPage(page: Page): BrowserAudit {
  const audit: BrowserAudit = { commands: [], gamePatch: 0, resyncRequired: 0, fallback: 0, targetNotFound: 0 };
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      const frame = parseFrame(payload);
      if (frame?.['kind'] === 'command.v2') audit.commands.push(frame);
    });
    socket.on('framereceived', ({ payload }) => {
      const frame = parseFrame(payload);
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

function layoutMutationCommands(commands: JsonObject[]): JsonObject[] {
  return commands.filter((command) => {
    const type = String(command['type'] ?? '');
    return type === 'card.position.changed'
      || type === 'cards.position.changed'
      || type.startsWith('attachment.')
      || type.startsWith('battlefield.stack.');
  });
}

function assertCleanAudit(audit: BrowserAudit): void {
  expect(audit.gamePatch).toBe(0);
  expect(audit.resyncRequired).toBe(0);
  expect(audit.fallback).toBe(0);
  expect(audit.targetNotFound).toBe(0);
}

async function expectNoGlobalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= document.documentElement.clientWidth + 1)).toBe(true);
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  try {
    return JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as JsonObject;
  } catch {
    return null;
  }
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
