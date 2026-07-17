import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase } from './support/decks';
import { sendRuntimeCommand } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;
type Player = Awaited<ReturnType<typeof createRealUserSession>> & { deckId: string };
type Setup = { gameId: string; players: Player[] };
type BrowserAudit = { frames: JsonObject[]; errors: string[]; recoveryRequests: string[] };

test.describe('Gameplay 1.0 Sprint 4B View X modal and local multi-selection gate', () => {
  test.describe.configure({ mode: 'serial' });

  test('3P keeps View X local, accessible, private and fail-closed across continuity and four responsive states', async ({ browser, request, baseURL }) => {
    test.setTimeout(900_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');

    const setup = await createGame(request, 3, `s4view${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const contexts = await createContexts(browser, baseURL, setup);
    let pages = await Promise.all(contexts.map((context) => context.newPage()));
    pages.forEach((page) => page.setDefaultTimeout(20_000));
    const audits = pages.map(auditPage);

    try {
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await expectStablePresence(request, setup, pages, audits);

      const ownerId = setup.players[0]!.user.id;
      const ownerSnapshot = await snapshot(request, setup, 0);
      const topFirstIds = zoneIds(ownerSnapshot, ownerId, 'library');
      expect(topFirstIds.length).toBeGreaterThanOrEqual(10);
      const owner = pages[0]!;

      for (const count of [1, 3, 5, 10]) {
        const recoveryBaseline = audits[0]!.recoveryRequests.length;
        await openTopView(owner, count);
        await assertReadyDialog(owner, count);
        expect(await modalCardIds(owner)).toEqual(topFirstIds.slice(0, count));
        expect(audits[0]!.recoveryRequests.length).toBe(recoveryBaseline);
        await assertNoViewerLeak(pages.slice(1), audits.slice(1), topFirstIds.slice(0, count));
        await closeWithButton(owner);
      }

      await openEntireView(owner);
      await assertReadyDialog(owner, topFirstIds.length);
      expect(await modalCardIds(owner)).toEqual(topFirstIds);
      await closeWithButton(owner);

      const beforeDfc = await snapshot(request, setup, 0);
      const commanderId = zoneIds(beforeDfc, ownerId, 'command')[0] ?? '';
      expect(commanderId).not.toBe('');
      await command(request, setup, Number(beforeDfc['version'] ?? 0), 'card.moved', {
        playerId: ownerId,
        fromZone: 'command',
        toZone: 'library',
        instanceId: commanderId,
      });
      await openTopView(owner, 1);
      const dfcCard = owner.locator('[data-testid="zone-modal"] [data-card-instance-id]').first();
      const dfcToggle = owner.getByRole('button', { name: /look at other face/i });
      await expect(dfcToggle).toBeVisible();
      const dfcFrontImage = await dfcCard.locator('img').getAttribute('src');
      await dfcToggle.focus();
      await owner.keyboard.press('Enter');
      await expect(dfcCard.locator('img')).not.toHaveAttribute('src', dfcFrontImage ?? '');
      await expect(owner.locator('[data-testid="zone-modal"] [data-view-x-selected="true"]')).toHaveCount(0);
      await closeWithButton(owner);

      await openTopView(owner, 5);
      const cards = owner.locator('[data-testid="zone-modal"] [data-card-instance-id]');
      await cards.nth(0).click();
      await cards.nth(2).click({ modifiers: ['Shift'] });
      await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'true');
      await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expect(cards.nth(2)).toHaveAttribute('aria-pressed', 'true');
      await owner.getByTestId('zone-modal-select-all').click();
      await expect(owner.locator('[data-testid="zone-modal"] [data-view-x-selected="true"]')).toHaveCount(5);
      await owner.getByTestId('zone-modal-clear-all').click();
      await expect(owner.locator('[data-testid="zone-modal"] [data-view-x-selected="true"]')).toHaveCount(0);

      await cards.nth(0).focus();
      await owner.keyboard.press('ArrowRight');
      await expect(cards.nth(1)).toBeFocused();
      await owner.keyboard.press('Space');
      await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
      await owner.keyboard.press('End');
      await expect(cards.nth(4)).toBeFocused();
      await owner.keyboard.press('Home');
      await expect(cards.nth(0)).toBeFocused();
      await assertFocusInsideDialog(owner);
      await owner.keyboard.press('Escape');
      await expect(owner.getByTestId('zone-modal')).toHaveCount(0);
      await expect(ownerLibrary(owner)).toBeFocused();
      await expectBodyUnlocked(owner);

      await openTopView(owner, 3);
      await owner.reload();
      await expect(owner.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await expect(owner.getByTestId('zone-modal')).toHaveCount(0);

      await pages[0]!.close();
      pages[0] = await contexts[0]!.newPage();
      pages[0]!.setDefaultTimeout(20_000);
      audits[0] = auditPage(pages[0]!);
      await pages[0]!.goto(`/games/${setup.gameId}`);
      await expect(pages[0]!.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await expect(pages[0]!.getByTestId('zone-modal')).toHaveCount(0);

      await openTopView(pages[0]!, 3);
      await restartRuntime(request);
      await expect(pages[0]!.getByTestId('zone-modal-status')).toBeVisible({ timeout: 60_000 });
      await expect(pages[0]!.locator('[data-testid="zone-modal"] [data-card-instance-id]')).toHaveCount(0);
      await closeWithButton(pages[0]!);

      await expect.poll(() => audits[0]!.frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), { timeout: 60_000 }).toBe(true);
      const secondTab = await contexts[0]!.newPage();
      secondTab.setDefaultTimeout(20_000);
      const secondTabAudit = auditPage(secondTab);
      await secondTab.goto(`/games/${setup.gameId}`);
      await expect(secondTab.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await openTopView(pages[0]!, 5);
      await openTopView(secondTab, 5);
      await expect(pages[0]!.getByTestId('zone-modal-status')).toBeVisible({ timeout: 30_000 });
      await expect(pages[0]!.locator('[data-testid="zone-modal"] [data-card-instance-id]')).toHaveCount(0);
      await expect(secondTab.locator('[data-testid="zone-modal"] [data-view-x-selected="true"]')).toHaveCount(0);

      const beforeShuffle = await snapshot(request, setup, 0);
      await command(request, setup, Number(beforeShuffle['version'] ?? 0), 'library.shuffle', { playerId: ownerId });
      await Promise.all([pages[0]!, secondTab].map(async (page) => {
        await expect(page.getByTestId('zone-modal-status')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('[data-testid="zone-modal"] [data-card-instance-id]')).toHaveCount(0);
      }));
      await closeWithButton(pages[0]!);
      await closeWithButton(secondTab);
      await secondTab.close();
      assertCleanAudit(secondTabAudit);

      const responsiveCases = [
        { viewport: { width: 1600, height: 1000 }, state: 'normal' },
        { viewport: { width: 1180, height: 820 }, state: 'compact' },
        { viewport: { width: 900, height: 600 }, state: 'aggressive' },
        { viewport: { width: 650, height: 480 }, state: 'minimal' },
      ] as const;
      for (const scenario of responsiveCases) {
        await pages[0]!.setViewportSize(scenario.viewport);
        await expect(pages[0]!.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', scenario.state);
        await openTopView(pages[0]!, 10);
        await expectWithinViewport(pages[0]!, pages[0]!.getByTestId('zone-modal'));
        await expectWithinViewport(pages[0]!, pages[0]!.getByTestId('zone-modal-close'));
        await expectEssentialTarget(pages[0]!.getByTestId('zone-modal-close'));
        await expectEssentialTarget(pages[0]!.getByTestId('zone-modal-select-all'));
        await expectNoGlobalOverflow(pages[0]!);
        await closeWithButton(pages[0]!, scenario.viewport.width <= 1180);
      }

      await assertNoViewerLeak(pages.slice(1), audits.slice(1), topFirstIds.slice(0, 10));
      audits.forEach(assertCleanAudit);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });

  test('manual native Chrome zoom keeps View X usable and private at 80/100/125/150', async ({ browser, request, baseURL }) => {
    test.skip(process.env['E2E_MANUAL_VIEW_X_ZOOM'] !== '1', 'Run headed with native Chrome controls; viewport/CSS zoom is not accepted.');
    test.setTimeout(20 * 60_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');

    const setup = await createGame(request, 3, `s4zoom${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const contexts = await createContexts(browser, baseURL, setup);
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    pages.forEach((page) => page.setDefaultTimeout(20_000));
    const audits = pages.map(auditPage);

    try {
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await expectStablePresence(request, setup, pages, audits);

      const owner = pages[0]!;
      await owner.setViewportSize({ width: 1280, height: 720 });
      const baselineDpr = await owner.evaluate(() => devicePixelRatio);
      const ownerId = setup.players[0]!.user.id;
      const initial = await snapshot(request, setup, 0);
      const privateTopIds = zoneIds(initial, ownerId, 'library').slice(0, 10);
      const matrix = [
        { zoom: 80, state: 'normal' },
        { zoom: 100, state: 'compact' },
        { zoom: 125, state: 'aggressive' },
        { zoom: 150, state: 'minimal' },
      ] as const;

      for (const entry of matrix) {
        await owner.bringToFront();
        await owner.evaluate((zoom) => { document.title = `CZ View X QA zoom-${zoom}`; }, entry.zoom);
        console.log(`NATIVE_VIEW_X_ZOOM_ACTION zoom=${entry.zoom}: set Chrome page zoom to ${entry.zoom}% using browser chrome.`);
        await expect.poll(
          () => owner.evaluate((base) => devicePixelRatio / base, baselineDpr),
          { timeout: 180_000 },
        ).toBeCloseTo(entry.zoom / 100, 2);
        await expect(owner.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', entry.state);

        await openTopView(owner, 10);
        await assertReadyDialog(owner, 10);
        await expectWithinNativeViewport(owner, owner.getByTestId('zone-modal'));
        await expectWithinNativeViewport(owner, owner.getByTestId('zone-modal-close'));
        await expectWithinNativeViewport(owner, owner.getByTestId('zone-modal-select-all'));
        await assertNoViewerLeak(pages.slice(1), audits.slice(1), privateTopIds);
        await owner.getByTestId('zone-modal-close').click();
        await expect(owner.getByTestId('zone-modal')).toHaveCount(0);
      }

      await owner.bringToFront();
      await owner.evaluate(() => { document.title = 'CZ View X QA zoom-100-final'; });
      console.log('NATIVE_VIEW_X_ZOOM_ACTION zoom=100: return Chrome page zoom to 100%.');
      await expect.poll(
        () => owner.evaluate((base) => devicePixelRatio / base, baselineDpr),
        { timeout: 180_000 },
      ).toBeCloseTo(1, 2);
      await expect(owner.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', 'compact');
      audits.forEach(assertCleanAudit);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function openTopView(page: Page, count: number): Promise<void> {
  await openLibraryViewSubmenu(page);
  await page.getByRole('menuitem', { name: /look at top x cards/i }).click();
  const number = page.getByTestId('number-action-input');
  await expect(number).toBeVisible();
  await number.fill(String(count));
  await page.getByTestId('number-action-confirm').click();
  await expect(page.getByTestId('zone-modal')).toBeVisible({ timeout: 20_000 });
}

async function openEntireView(page: Page): Promise<void> {
  await openLibraryViewSubmenu(page);
  await page.getByRole('menuitem', { name: /^view library$/i }).click();
  await expect(page.getByTestId('zone-modal')).toBeVisible({ timeout: 20_000 });
}

async function openLibraryViewSubmenu(page: Page): Promise<void> {
  const library = ownerLibrary(page);
  await expect(library).toBeVisible();
  const viewport = page.viewportSize();
  if (viewport) {
    await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
  }
  await library.focus();
  await expect
    .poll(() => page.getByTestId('game-log-panel').evaluate((panel) => !panel.matches(':hover, :focus-within')))
    .toBe(true);
  await library.click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: /^view$/i }).click();
  await expect(menu.getByRole('menu')).toBeVisible();
}

function ownerLibrary(page: Page): Locator {
  return page.locator('[data-testid="drop-zone"][data-zone="library"]').first();
}

async function assertReadyDialog(page: Page, count: number): Promise<void> {
  const dialog = page.getByTestId('zone-modal');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAttribute('data-lifecycle', 'ready');
  await expect(dialog.locator('[data-card-instance-id]')).toHaveCount(count);
  await expect(dialog.locator('[data-card-instance-id]').first()).toBeFocused();
  await expectBodyLocked(page);
}

async function assertFocusInsideDialog(page: Page): Promise<void> {
  const dialog = page.getByTestId('zone-modal');
  await page.keyboard.press('Tab');
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
}

async function closeWithButton(page: Page, gameplayKeepsBodyLocked = false): Promise<void> {
  await page.getByTestId('zone-modal-close').click();
  await expect(page.getByTestId('zone-modal')).toHaveCount(0);
  if (gameplayKeepsBodyLocked) {
    await expectBodyLocked(page);
  } else {
    await expectBodyUnlocked(page);
  }
}

async function modalCardIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid="zone-modal"] [data-card-instance-id]').evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset['cardInstanceId'] ?? ''),
  );
}

async function assertNoViewerLeak(pages: readonly Page[], audits: readonly BrowserAudit[], privateIds: readonly string[]): Promise<void> {
  for (let index = 0; index < pages.length; index += 1) {
    await expect(pages[index]!.getByTestId('zone-modal')).toHaveCount(0);
    const html = await pages[index]!.locator('body').innerHTML();
    const frames = JSON.stringify(audits[index]!.frames);
    for (const instanceId of privateIds) {
      expect(html).not.toContain(instanceId);
      expect(frames).not.toContain(instanceId);
    }
  }
}

async function expectBodyLocked(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({ body: document.body.style.overflow, html: document.documentElement.style.overflow })))
    .toEqual({ body: 'hidden', html: 'hidden' });
}

async function expectBodyUnlocked(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({ body: document.body.style.overflow, html: document.documentElement.style.overflow })))
    .toEqual({ body: '', html: '' });
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

async function expectEssentialTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(40);
  expect(box!.height).toBeGreaterThanOrEqual(40);
}

async function expectNoGlobalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({
    width: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }))).toEqual({ width: 0, height: 0 });
}

async function command(request: APIRequestContext, setup: Setup, baseVersion: number, type: string, payload: JsonObject) {
  return sendRuntimeCommand(request, { gameId: setup.gameId, token: setup.players[0]!.token, baseVersion, type, payload });
}

async function createContexts(browser: Browser, baseURL: string, setup: Setup): Promise<BrowserContext[]> {
  return Promise.all(setup.players.map((player, index) => browser.newContext({
    baseURL,
    viewport: index === 0 ? { width: 1600, height: 1000 } : { width: 1280, height: 800 },
    storageState: authStorageState(baseURL, player.user, player.refreshToken),
  })));
}

async function createGame(request: APIRequestContext, playerCount: number, runId: string): Promise<Setup> {
  const players: Player[] = [];
  for (let index = 0; index < playerCount; index += 1) {
    const session = await createRealUserSession(request, `${runId}-${index}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `s4b-${runId.slice(-8)}-${index}`,
      includeWhiteDfc: index === 0,
    });
    players.push({ ...session, deckId: deck.deckId });
  }
  const roomResponse = await request.post(`${API_BASE_URL}/rooms`, { headers: auth(players[0]!.token), data: {
    deckId: players[0]!.deckId,
    visibility: 'private',
    name: runId,
    format: 'commander',
    maxPlayers: playerCount,
    mulliganRule: 'LONDON',
    firstMulliganFree: true,
  } });
  await expectOk(roomResponse, 'create View X room');
  const roomId = String(((await roomResponse.json()) as { room?: { id?: string } }).room?.id ?? '');
  for (const player of players.slice(1)) {
    await expectOk(await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, { headers: auth(player.token), data: { deckId: player.deckId } }), 'join View X room');
  }
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const room = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: auth(players[0]!.token) });
    await expectOk(room, 'load View X room');
    const entries = ((await room.json()) as { room?: { players?: Array<{ turnRolls?: number[] }> } }).room?.players ?? [];
    if (entries.length === playerCount && entries.every((entry) => entry.turnRolls?.length) && new Set(entries.map((entry) => entry.turnRolls?.join('-'))).size === playerCount) break;
    for (const player of players) {
      const roll = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: auth(player.token) });
      if (!roll.ok() && roll.status() !== 409) await expectOk(roll, 'roll View X turn order');
    }
  }
  const start = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: auth(players[0]!.token) });
  await expectOk(start, 'start View X game');
  const gameId = String(((await start.json()) as { game?: { id?: string } }).game?.id ?? '');
  if (!gameId) throw new Error('View X gate game did not start.');
  return { gameId, players };
}

async function snapshot(request: APIRequestContext, setup: Setup, viewerIndex: number): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${setup.gameId}/snapshot`, { headers: auth(setup.players[viewerIndex]!.token) });
  await expectOk(response, 'load View X snapshot');
  return ((await response.json()) as { game: { snapshot: JsonObject } }).game.snapshot;
}

async function expectStablePresence(request: APIRequestContext, setup: Setup, pages: readonly Page[], audits: readonly BrowserAudit[]): Promise<void> {
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
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], { cwd: resolve(process.cwd(), '..'), timeout: 60_000, windowsHide: true });
  await expect.poll(async () => {
    try { return (await request.get(RUNTIME_READY_URL)).ok(); } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
}

function auditPage(page: Page): BrowserAudit {
  const audit: BrowserAudit = { frames: [], errors: [], recoveryRequests: [] };
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    try { audit.frames.push(JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as JsonObject); } catch { /* protocol ping */ }
  }));
  page.on('request', (request) => {
    if (/\/snapshot(?:\?|$)|\/bootstrap(?:\?|$)/.test(request.url())) audit.recoveryRequests.push(request.url());
  });
  page.on('console', (message) => { if (message.type() === 'error') audit.errors.push(message.text()); });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  return audit;
}

function assertCleanAudit(audit: BrowserAudit): void {
  const serialized = JSON.stringify(audit.frames);
  expect(serialized).not.toMatch(/target_not_found|resync_required|recovery_required/i);
  expect(audit.frames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
  expect(audit.errors.filter((error) => /target_not_found|resync_required|Unknown Card/i.test(error))).toEqual([]);
}

function zoneIds(state: JsonObject, playerId: string, zone: string): string[] {
  const player = ((state['players'] as Record<string, JsonObject> | undefined) ?? {})[playerId];
  const cards = ((player?.['zones'] as Record<string, JsonObject[]> | undefined) ?? {})[zone] ?? [];
  return cards.map((card) => String(card['instanceId'] ?? '')).filter(Boolean);
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function expectOk(response: { ok(): boolean; status(): number; text(): Promise<string> }, action: string): Promise<void> {
  if (!response.ok()) throw new Error(`${action} failed (${response.status()}): ${await response.text()}`);
}
