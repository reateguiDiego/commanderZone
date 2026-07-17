import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type APIResponse, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;
type Player = Awaited<ReturnType<typeof createRealUserSession>> & { deckId: string };
type Setup = { gameId: string; players: [Player, Player, Player] };
type MotionAudit = { kind: string; count: number; mode: string };
type PageAudit = { frames: JsonObject[]; recoveryRequests: string[]; errors: string[] };

test.describe('Gameplay 1.0 Sprint 4E reveal indicator and motion gate', () => {
  test.describe.configure({ mode: 'serial' });

  test('A/B/C indicator, read-only panel, motion, privacy and hydration stay coherent', async ({ browser, request, baseURL }) => {
    test.setTimeout(1_200_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');

    const setup = await createGame(request, `s4emotion${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const contexts = await createContexts(browser, baseURL, setup);
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const audits = pages.map(auditPage);
    pages.forEach((page) => page.setDefaultTimeout(25_000));

    try {
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      const ownerId = setup.players[0].user.id;
      const targetId = setup.players[1].user.id;
      const thirdId = setup.players[2].user.id;
      const ownerSnapshot = await snapshot(request, setup, 0);
      const hand = zoneIds(ownerSnapshot, ownerId, 'hand');
      if (hand.length < 5) throw new Error(`Sprint 4E gate requires five hand cards; got ${hand.length}.`);
      const [first, second, third, fourth, fifth] = hand as [string, string, string, string, string];

      expect(await revealIndicatorCount(pages[1], ownerId)).toBe(0);
      expect(await revealIndicatorCount(pages[2], ownerId)).toBe(0);
      expect(await unauthorizedDomContains(pages[1], [first, second, third])).toBe(false);
      expect(await unauthorizedDomContains(pages[2], [first, second, third])).toBe(false);

      await openOpponentsDrawer(pages[1]);
      await command(request, setup, 'hand.cards.reveal', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [first], to: targetId,
      }, 's4e-reveal-one');
      await expect.poll(() => revealIndicatorCount(pages[1], ownerId)).toBe(1);
      expect(await revealIndicatorCount(pages[2], ownerId)).toBe(0);
      await expect.poll(async () => (await motionAudit(pages[1])).some((entry) => entry.kind === 'indicator' && entry.mode === 'full')).toBe(true);
      expect((await motionAudit(pages[2])).filter((entry) => entry.kind === 'materialize')).toHaveLength(0);

      const indicator = await visibleIndicator(pages[1], ownerId);
      await indicator.click();
      const panel = pages[1].getByTestId('active-reveal-panel');
      await expect(panel).toBeVisible();
      await expect(panel.locator('[data-card-instance-id]')).toHaveCount(1);

      await command(request, setup, 'hand.cards.reveal', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [second, third], to: targetId,
      }, 's4e-reveal-batch');
      await expect.poll(() => revealIndicatorCount(pages[1], ownerId)).toBe(3);
      await expect.poll(async () => (await motionAudit(pages[1])).some((entry) => entry.kind === 'materialize' && entry.count === 2)).toBe(true);
      await expect(panel).toHaveAttribute('role', 'dialog');
      await expect(panel).toHaveAttribute('aria-modal', 'true');
      await expect(panel.locator('[data-card-instance-id]')).toHaveCount(3);
      await expect(panel.getByTestId('active-reveal-recipients')).toHaveCount(0);
      await pages[1].keyboard.press('ArrowRight');
      await expect.poll(() => pages[1].evaluate(() => document.activeElement?.getAttribute('data-card-instance-id') ?? '')).not.toBe('');
      await expectNoGlobalOverflow(pages[1]);
      await pages[1].keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(indicator).toBeFocused();

      const targetMotionBefore = (await motionAudit(pages[1])).filter((entry) => entry.kind === 'materialize').length;
      await command(request, setup, 'hand.cards.reveal', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [first, second, third], to: [targetId, thirdId],
      }, 's4e-expand-audience');
      await expect.poll(() => revealIndicatorCount(pages[2], ownerId)).toBe(3);
      expect((await motionAudit(pages[1])).filter((entry) => entry.kind === 'materialize')).toHaveLength(targetMotionBefore);

      await command(request, setup, 'hand.cards.revoke', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [first], to: targetId,
      }, 's4e-partial-revoke');
      await expect.poll(() => revealIndicatorCount(pages[1], ownerId)).toBe(2);
      await expect.poll(async () => (await motionAudit(pages[1])).some((entry) => entry.kind === 'conceal' && entry.count === 1)).toBe(true);
      await expect.poll(() => revealIndicatorCount(pages[2], ownerId)).toBe(3);

      await expect.poll(() => revealIndicatorCount(pages[0], ownerId)).toBe(3);
      await (await visibleIndicator(pages[0], ownerId)).click();
      await expect(pages[0].getByTestId('active-reveal-recipients')).toBeVisible();
      await expect(pages[0].getByTestId('active-reveal-panel').getByRole('button', { name: /manage|gestionar/i })).toBeVisible();
      await pages[0].keyboard.press('Escape');

      await pages[1].reload();
      await expect(pages[1].getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => revealIndicatorCount(pages[1], ownerId)).toBe(2);
      expect(await motionAudit(pages[1])).toEqual([]);

      await contexts[1].setOffline(true);
      await contexts[1].setOffline(false);
      await expect.poll(() => pages[1].locator('[data-testid="game-screen"]').count(), { timeout: 45_000 }).toBe(1);
      expect((await motionAudit(pages[1])).filter((entry) => entry.kind === 'materialize')).toHaveLength(0);

      await restartRuntime(request);
      await expect.poll(() => revealIndicatorCount(pages[1], ownerId), { timeout: 60_000 }).toBe(2);
      expect((await motionAudit(pages[1])).filter((entry) => entry.kind === 'materialize')).toHaveLength(0);

      await pages[2].emulateMedia({ reducedMotion: 'reduce' });
      await (await visibleIndicator(pages[2], ownerId)).click();
      await expect(pages[2].getByTestId('active-reveal-panel')).toBeVisible();
      await command(request, setup, 'hand.cards.reveal', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [fourth, fifth], to: thirdId,
      }, 's4e-reduced-batch');
      await expect.poll(() => revealIndicatorCount(pages[2], ownerId)).toBe(5);
      await expect.poll(async () => (await motionAudit(pages[2])).some((entry) => entry.kind === 'materialize' && entry.count === 2 && entry.mode === 'reduced')).toBe(true);
      await pages[2].keyboard.press('Escape');

      const secondTargetTab = await contexts[1].newPage();
      await secondTargetTab.goto(`/games/${setup.gameId}`);
      await expect(secondTargetTab.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => revealIndicatorCount(secondTargetTab, ownerId)).toBe(2);
      expect(await motionAudit(secondTargetTab)).toEqual([]);
      await focusPlayer(secondTargetTab, ownerId);
      await command(request, setup, 'hand.cards.revoke', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [second, third], to: targetId,
      }, 's4e-other-tab-revoke');
      await expect.poll(() => revealIndicatorCount(pages[1], ownerId)).toBe(0);
      await expect.poll(() => revealIndicatorCount(secondTargetTab, ownerId)).toBe(0);
      await expect(secondTargetTab.getByTestId('active-reveal-panel')).toHaveCount(0);
      await secondTargetTab.close();

      for (const scenario of [
        { width: 1600, height: 1000, state: 'normal' },
        { width: 1180, height: 820, state: 'compact' },
        { width: 900, height: 600, state: 'aggressive' },
        { width: 650, height: 480, state: 'minimal' },
      ] as const) {
        await pages[2].setViewportSize(scenario);
        await expect(pages[2].getByTestId('game-screen')).toHaveAttribute('data-responsive-state', scenario.state);
        await (await visibleIndicator(pages[2], ownerId)).click();
        await expectWithinViewport(pages[2], pages[2].getByTestId('active-reveal-panel'));
        await expectEssentialTarget(pages[2].getByTestId('active-reveal-close'));
        await expectNoGlobalOverflow(pages[2]);
        await pages[2].keyboard.press('Escape');
      }

      for (const audit of audits) assertCleanAudit(audit);
      expect(await unauthorizedDomContains(pages[1], [first, second, third, fourth, fifth])).toBe(false);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function command(request: APIRequestContext, setup: Setup, type: 'hand.cards.reveal' | 'hand.cards.revoke', payload: JsonObject, clientActionId: string): Promise<void> {
  const state = await snapshot(request, setup, 0);
  const frame = await sendRuntimeRaw(request, setup, {
    kind: 'command.v2', gameId: setup.gameId, messageId: clientActionId, clientActionId,
    baseVersion: Number(state['version'] ?? 0), type, payload,
  });
  expect(frame['kind']).toBe('patch.v2');
}

async function sendRuntimeRaw(request: APIRequestContext, setup: Setup, message: JsonObject): Promise<JsonObject> {
  const response = await request.post(`${API_BASE_URL}/games/${setup.gameId}/websocket-ticket`, { headers: auth(setup.players[0].token) });
  await expectOk(response, 'create runtime ticket');
  const ticket = await response.json() as { websocketUrl?: string; route?: string };
  if (ticket.route !== 'runtime_ws' || !ticket.websocketUrl) throw new Error('Runtime ticket did not select runtime_ws.');
  return new Promise<JsonObject>((resolvePromise, reject) => {
    const socket = new WebSocket(ticket.websocketUrl!);
    const timeout = setTimeout(() => { socket.close(); reject(new Error('Timed out waiting for runtime result.')); }, 20_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify(message)));
    socket.addEventListener('message', async (event) => {
      const frame = JSON.parse(typeof event.data === 'string' ? event.data : await new Response(event.data).text()) as JsonObject;
      if ((frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === message['clientActionId'])
        || (frame['kind'] === 'command_ack' && frame['clientActionId'] === message['clientActionId'])) {
        clearTimeout(timeout); socket.close(); resolvePromise(frame);
      }
    });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Runtime WebSocket failed.')); });
  });
}

async function createGame(request: APIRequestContext, runId: string): Promise<Setup> {
  const players: Player[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `${runId}-${index}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, { ownerToken: session.token, name: `${runId}-${index}` });
    players.push({ ...session, deckId: deck.deckId });
  }
  const room = await request.post(`${API_BASE_URL}/rooms`, { headers: auth(players[0]!.token), data: {
    deckId: players[0]!.deckId, visibility: 'private', name: runId, format: 'commander', maxPlayers: 3,
    mulliganRule: 'LONDON', firstMulliganFree: true,
  } });
  await expectOk(room, 'create Sprint 4E room');
  const roomId = String(((await room.json()) as { room?: { id?: string } }).room?.id ?? '');
  for (const player of players.slice(1)) {
    await expectOk(await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, { headers: auth(player.token), data: { deckId: player.deckId } }), 'join Sprint 4E room');
  }
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const current = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: auth(players[0]!.token) });
    const entries = ((await current.json()) as { room?: { players?: Array<{ turnRolls?: number[] }> } }).room?.players ?? [];
    if (entries.length === 3 && entries.every((entry) => entry.turnRolls?.length) && new Set(entries.map((entry) => entry.turnRolls?.join('-'))).size === 3) break;
    for (const player of players) {
      const roll = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: auth(player.token) });
      if (!roll.ok() && roll.status() !== 409) await expectOk(roll, 'roll turn order');
    }
  }
  const started = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: auth(players[0]!.token) });
  await expectOk(started, 'start Sprint 4E game');
  const gameId = String(((await started.json()) as { game?: { id?: string } }).game?.id ?? '');
  if (!gameId) throw new Error('Sprint 4E game did not start.');
  return { gameId, players: players as [Player, Player, Player] };
}

async function createContexts(browser: Browser, baseURL: string, setup: Setup): Promise<[BrowserContext, BrowserContext, BrowserContext]> {
  const contexts = await Promise.all(setup.players.map((player) => browser.newContext({
    baseURL, viewport: { width: 1280, height: 800 }, storageState: authStorageState(baseURL, player.user, player.refreshToken),
  }))) as [BrowserContext, BrowserContext, BrowserContext];
  await Promise.all(contexts.map((context) => context.addInitScript(() => localStorage.setItem('commanderzone.e2eRevealMotionAudit', '1'))));
  return contexts;
}

async function snapshot(request: APIRequestContext, setup: Setup, viewerIndex: number): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${setup.gameId}/snapshot`, { headers: auth(setup.players[viewerIndex].token) });
  await expectOk(response, 'load snapshot');
  return ((await response.json()) as { game: { snapshot: JsonObject } }).game.snapshot;
}

function zoneIds(state: JsonObject, playerId: string, zone: string): string[] {
  const players = state['players'] as Record<string, JsonObject>;
  const zones = players[playerId]?.['zones'] as Record<string, JsonObject[]>;
  return (zones[zone] ?? []).map((card) => String(card['instanceId'] ?? '')).filter(Boolean);
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

async function focusPlayer(page: Page, playerId: string): Promise<void> {
  const toggle = page.getByTestId('opponents-drawer-toggle');
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  const board = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`);
  await expect(board).toBeVisible();
  await board.click();
  await expect(page.getByTestId('player-panel')).toHaveAttribute('data-player-id', playerId);
  if (await toggle.isVisible()) await expect(toggle).toHaveAttribute('aria-expanded', 'false');
}

async function restartRuntime(request: APIRequestContext): Promise<void> {
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], { cwd: resolve(process.cwd(), '..'), timeout: 60_000, windowsHide: true });
  await expect.poll(async () => {
    try { return (await request.get(RUNTIME_READY_URL)).ok(); } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
}

function auditPage(page: Page): PageAudit {
  const audit: PageAudit = { frames: [], recoveryRequests: [], errors: [] };
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    try { audit.frames.push(JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as JsonObject); } catch { /* ping */ }
  }));
  page.on('request', (outgoing) => { if (/\/snapshot(?:\?|$)|\/bootstrap(?:\?|$)/.test(outgoing.url())) audit.recoveryRequests.push(outgoing.url()); });
  page.on('console', (message) => { if (message.type() === 'error') audit.errors.push(message.text()); });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  return audit;
}

function assertCleanAudit(audit: PageAudit): void {
  const serialized = JSON.stringify(audit.frames);
  expect(serialized).not.toMatch(/target_not_found|resync_required|recovery_required|Unknown Card|fallback/i);
  expect(audit.frames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
  expect(audit.errors.filter((error) => /target_not_found|resync_required|Unknown Card|fallback/i.test(error))).toEqual([]);
}

async function expectWithinViewport(page: Page, locator: Locator): Promise<void> {
  await expect.poll(async () => {
    const box = await locator.boundingBox(); const viewport = page.viewportSize();
    return box !== null && viewport !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
  }).toBe(true);
}

async function expectEssentialTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull(); expect(box!.width).toBeGreaterThanOrEqual(40); expect(box!.height).toBeGreaterThanOrEqual(40);
}

async function expectNoGlobalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({
    width: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }))).toEqual({ width: 0, height: 0 });
}

function auth(token: string): Record<string, string> { return { Authorization: `Bearer ${token}` }; }

async function expectOk(response: Pick<APIResponse, 'ok' | 'status' | 'text'>, action: string): Promise<void> {
  if (!response.ok()) throw new Error(`${action} failed (${response.status()}): ${await response.text()}`);
}
