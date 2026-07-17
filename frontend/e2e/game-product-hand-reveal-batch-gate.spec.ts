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
type BrowserAudit = { frames: JsonObject[]; errors: string[]; recoveryRequests: string[] };
type EventStoreState = { count: number; maxVersion: number };

test.describe('Gameplay 1.0 Sprint 4D hand reveal batch gate', () => {
  test.describe.configure({ mode: 'serial' });

  test('3P keeps reveal/revoke atomic, cumulative, private and continuous', async ({ browser, request, baseURL }) => {
    test.setTimeout(1_200_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');

    const setup = await createGame(request, `s4hand${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const contexts = await createContexts(browser, baseURL, setup);
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    pages.forEach((page) => page.setDefaultTimeout(25_000));
    const audits = pages.map(auditPage);

    try {
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await expectStablePresence(request, setup, pages, audits);
      const recoveryBaseline = audits.map((audit) => audit.recoveryRequests.length);

      const ownerId = setup.players[0].user.id;
      const targetId = setup.players[1].user.id;
      const thirdId = setup.players[2].user.id;
      const initialOwner = await snapshot(request, setup, 0);
      const initialTarget = await snapshot(request, setup, 1);
      const initialThird = await snapshot(request, setup, 2);
      const hand = zoneIds(initialOwner, ownerId, 'hand');
      if (hand.length < 6) throw new Error(`Sprint 4D gate requires six owner hand cards; got ${hand.length}.`);
      const [first, second, publicCard, retryCard, uiCard, spare] = hand as [string, string, string, string, string, string];
      assertOpaqueHand(initialTarget, ownerId, [first, second, publicCard, retryCard, uiCard, spare]);
      assertOpaqueHand(initialThird, ownerId, [first, second, publicCard, retryCard, uiCard, spare]);

      const accepted = async (playerIndex: number, type: 'hand.cards.reveal' | 'hand.cards.revoke' | 'card.moved', payload: JsonObject, actionId: string) => {
        const before = await snapshot(request, setup, 0);
        const beforeStore = await eventStoreState(setup.gameId);
        const baseVersion = Number(before['version'] ?? 0);
        const frame = await sendRuntimeRaw(request, setup, playerIndex, {
          kind: 'command.v2', gameId: setup.gameId, messageId: actionId, clientActionId: actionId, baseVersion, type, payload,
        });
        expect(frame['kind']).toBe('patch.v2');
        const after = await snapshot(request, setup, 0);
        expect(Number(after['version'] ?? 0)).toBe(baseVersion + 1);
        expect(await eventStoreState(setup.gameId)).toEqual({ count: beforeStore.count + 1, maxVersion: beforeStore.maxVersion + 1 });
        return { beforeVersion: baseVersion, after, frame };
      };

      await accepted(0, 'hand.cards.reveal', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [first, second], to: targetId,
      }, 's4d-reveal-b');
      let views = await allSnapshots(request, setup);
      assertRealHandCards(views[1], ownerId, [first, second]);
      assertOpaqueHand(views[2], ownerId, [first, second]);
      expect(zoneIds(views[1], ownerId, 'hand')).toHaveLength(hand.length);

      await accepted(0, 'hand.cards.reveal', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [first, second], to: [targetId, thirdId],
      }, 's4d-reveal-bc');
      views = await allSnapshots(request, setup);
      assertRealHandCards(views[1], ownerId, [first, second]);
      assertRealHandCards(views[2], ownerId, [first, second]);
      expect(zoneIds(views[1], ownerId, 'hand').filter((id) => id === first)).toHaveLength(1);
      expect(zoneIds(views[2], ownerId, 'hand').filter((id) => id === first)).toHaveLength(1);

      await accepted(0, 'hand.cards.reveal', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [publicCard], to: 'all',
      }, 's4d-reveal-all');
      views = await allSnapshots(request, setup);
      assertRealHandCards(views[1], ownerId, [publicCard]);
      assertRealHandCards(views[2], ownerId, [publicCard]);

      await accepted(0, 'hand.cards.revoke', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [first, second], to: targetId,
      }, 's4d-revoke-b');
      views = await allSnapshots(request, setup);
      assertOpaqueHand(views[1], ownerId, [first, second]);
      assertRealHandCards(views[2], ownerId, [first, second]);

      await accepted(0, 'hand.cards.revoke', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [first, second], to: 'all',
      }, 's4d-revoke-all');
      views = await allSnapshots(request, setup);
      assertOpaqueHand(views[1], ownerId, [first, second]);
      assertOpaqueHand(views[2], ownerId, [first, second]);

      const retryAction = 's4d-idempotent-retry';
      const retryBefore = await snapshot(request, setup, 0);
      const retryStoreBefore = await eventStoreState(setup.gameId);
      const retryMessage = {
        kind: 'command.v2', gameId: setup.gameId, messageId: retryAction, clientActionId: retryAction,
        baseVersion: Number(retryBefore['version'] ?? 0), type: 'hand.cards.reveal',
        payload: { playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [retryCard], to: thirdId },
      };
      await sendRuntimeRaw(request, setup, 0, retryMessage);
      await sendRuntimeRaw(request, setup, 0, retryMessage);
      expect(Number((await snapshot(request, setup, 0))['version'] ?? 0)).toBe(Number(retryBefore['version'] ?? 0) + 1);
      expect(await eventStoreState(setup.gameId)).toEqual({ count: retryStoreBefore.count + 1, maxVersion: retryStoreBefore.maxVersion + 1 });

      await accepted(0, 'card.moved', {
        playerId: ownerId, fromZone: 'hand', toZone: 'battlefield', instanceId: retryCard,
      }, 's4d-move-revealed');
      const rejectedVersion = Number((await snapshot(request, setup, 0))['version'] ?? 0);
      const stale = await sendRuntimeRaw(request, setup, 0, {
        kind: 'command.v2', gameId: setup.gameId, messageId: 's4d-stale', clientActionId: 's4d-stale', baseVersion: rejectedVersion,
        type: 'hand.cards.reveal', payload: { playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [retryCard, spare], to: targetId },
      });
      assertRejected(stale, 'HAND_INSTANCE_NOT_AVAILABLE', rejectedVersion);
      expect(Number((await snapshot(request, setup, 0))['version'] ?? 0)).toBe(rejectedVersion);

      const duplicate = await sendRuntimeRaw(request, setup, 0, {
        kind: 'command.v2', gameId: setup.gameId, messageId: 's4d-duplicate', clientActionId: 's4d-duplicate', baseVersion: rejectedVersion,
        type: 'hand.cards.reveal', payload: { playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [spare, spare], to: targetId },
      });
      assertRejected(duplicate, 'DUPLICATE_INSTANCE', rejectedVersion);
      const unauthorized = await sendRuntimeRaw(request, setup, 1, {
        kind: 'command.v2', gameId: setup.gameId, messageId: 's4d-unauthorized', clientActionId: 's4d-unauthorized', baseVersion: rejectedVersion,
        type: 'hand.cards.reveal', payload: { playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [spare], to: targetId },
      });
      assertRejected(unauthorized, 'PERMISSION_DENIED', rejectedVersion);

      await accepted(0, 'card.moved', {
        playerId: ownerId, fromZone: 'battlefield', toZone: 'hand', instanceId: retryCard,
      }, 's4d-return-private');
      views = await allSnapshots(request, setup);
      assertOpaqueHand(views[1], ownerId, [retryCard]);
      assertOpaqueHand(views[2], ownerId, [retryCard]);

      await accepted(0, 'hand.cards.reveal', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [first, second], to: thirdId,
      }, 's4d-continuity');
      const beforeContinuity = await snapshot(request, setup, 2);
      await pages[2].reload();
      await expect(pages[2].getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      assertRealHandCards(await snapshot(request, setup, 2), ownerId, [first, second]);
      await restartRuntime(request);
      await expect.poll(async () => JSON.stringify(zoneCards(await snapshot(request, setup, 2), ownerId, 'hand')), { timeout: 60_000 })
        .toBe(JSON.stringify(zoneCards(beforeContinuity, ownerId, 'hand')));

      const secondOwnerTab = await contexts[0].newPage();
      const secondOwnerAudit = auditPage(secondOwnerTab);
      await secondOwnerTab.goto(`/games/${setup.gameId}`);
      await expect(secondOwnerTab.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      const tabVersion = Number((await snapshot(request, setup, 0))['version'] ?? 0);
      await accepted(0, 'hand.cards.revoke', {
        playerId: ownerId, expectedZone: 'hand', orderedInstanceIds: [first, second], to: thirdId,
      }, 's4d-other-tab-revoke');
      await expect.poll(() => secondOwnerAudit.frames.some((frame) => frame['kind'] === 'patch.v2' && Number(frame['version'] ?? 0) === tabVersion + 1)).toBe(true);
      expect(await secondOwnerTab.getByTestId('hand-reveal-dialog').count()).toBe(0);
      assertCleanAudit(secondOwnerAudit);
      await secondOwnerTab.close();

      await exerciseAudienceDialog(pages[0], ownerId, uiCard, targetId, thirdId);

      const publicLogs = await Promise.all([1, 2].map(async (index) => JSON.stringify((await snapshot(request, setup, index))['eventLog'] ?? [])));
      // Cards intentionally moved face-up (publicCard/retryCard) are allowed
      // to have public references. The privacy assertion targets cards that
      // remained private for the entire scenario.
      const privateOnly = [first, second, spare, uiCard];
      for (const log of publicLogs) {
        for (const instanceId of privateOnly) expect(log).not.toContain(instanceId);
        const entries = JSON.parse(log) as JsonObject[];
        for (const entry of entries.filter((item) => String(item['type'] ?? '').startsWith('hand.cards.'))) {
          expect(JSON.stringify(entry)).not.toMatch(/cardKey|cardRef|printId|imageUris|cardFaces|Unknown Card/i);
        }
      }
      expect(JSON.stringify((await snapshot(request, setup, 1))['eventLog'] ?? [])).toMatch(/gameLog\.hand\.(revealed|revoked)/);

      audits.forEach(assertCleanAudit);
      for (let index = 0; index < audits.length; index += 1) {
        if (index === 2) {
          // The explicit page reload always hydrates once. Depending on whether
          // the WebSocket reconnect completes before or after actor recovery,
          // the restart may reuse the resumed stream or perform one additional
          // expected hydration; neither path is normal-flow recovery.
          expect(audits[index].recoveryRequests.length).toBeGreaterThanOrEqual(recoveryBaseline[index]! + 1);
          expect(audits[index].recoveryRequests.length).toBeLessThanOrEqual(recoveryBaseline[index]! + 2);
        } else {
          expect(audits[index].recoveryRequests.length).toBe(recoveryBaseline[index]!);
        }
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });

  test('manual native Chrome zoom keeps the audience dialog in the viewport', async ({ browser, request, baseURL }) => {
    test.skip(process.env['E2E_MANUAL_HAND_REVEAL_ZOOM'] !== '1', 'Run headed and set native Chrome zoom to 80/100/125/150 when prompted.');
    test.setTimeout(20 * 60_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const setup = await createGame(request, `s4handzoom${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const contexts = await createContexts(browser, baseURL, setup);
    try {
      const owner = await contexts[0].newPage();
      await owner.goto(`/games/${setup.gameId}`);
      await expect(owner.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      const ownerId = setup.players[0].user.id;
      const cardId = zoneIds(await snapshot(request, setup, 0), ownerId, 'hand')[0]!;
      const baselineDpr = await owner.evaluate(() => devicePixelRatio);
      for (const zoom of [80, 100, 125, 150]) {
        console.log(`NATIVE_HAND_REVEAL_ZOOM_ACTION zoom=${zoom}: set Chrome page zoom to ${zoom}%.`);
        await expect.poll(() => owner.evaluate((base) => devicePixelRatio / base, baselineDpr), { timeout: 180_000 }).toBeCloseTo(zoom / 100, 2);
        await openRevealDialog(owner, ownerId, cardId, setup.players[1].user.displayName);
        await expectWithinNativeViewport(owner, owner.getByRole('dialog'));
        await owner.keyboard.press('Escape');
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function exerciseAudienceDialog(page: Page, ownerId: string, cardId: string, targetId: string, thirdId: string): Promise<void> {
  const scenarios = [
    { viewport: { width: 1600, height: 1000 }, state: 'normal' },
    { viewport: { width: 1180, height: 820 }, state: 'compact' },
    { viewport: { width: 900, height: 600 }, state: 'aggressive' },
    { viewport: { width: 650, height: 480 }, state: 'minimal' },
  ] as const;
  for (const scenario of scenarios) {
    await page.setViewportSize(scenario.viewport);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', scenario.state);
    await openRevealDialog(page, ownerId, cardId);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expectWithinViewport(page, dialog);
    await expectEssentialTarget(page.getByTestId('hand-reveal-confirm'));
    await page.getByTestId('hand-reveal-audience-all').uncheck();
    await page.getByTestId(`hand-reveal-audience-${targetId}`).check();
    await page.getByTestId(`hand-reveal-audience-${thirdId}`).check();
    await expect(page.getByTestId('hand-reveal-confirm')).toBeEnabled();
    await expectNoGlobalOverflow(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hand-reveal-dialog')).toHaveCount(0);
  }
}

async function openRevealDialog(page: Page, ownerId: string, cardId: string, targetName?: string): Promise<void> {
  await focusPlayer(page, ownerId);
  const handArea = page.locator(`[data-testid="hand-area"][data-player-id="${ownerId}"]`);
  // A viewport transition can leave the pointer over an already-expanded
  // hand. Move it to a neutral point and wait for the product hover state to
  // settle before entering through the strip; never force the interaction.
  await page.mouse.move(0, 0);
  if (!(await handArea.evaluate((element) => element.classList.contains('hand-revealed')))) {
    try {
      await handArea.locator('.hand-hover-strip').hover();
    } catch (error) {
      // The pointerenter handler may expand the hand between the check and
      // the hover hit-test. In that race the product state is already ready;
      // preserve the original error for any other interception.
      if (!(await handArea.evaluate((element) => element.classList.contains('hand-revealed')))) throw error;
    }
  }
  await expect(handArea).toHaveClass(/hand-revealed/);
  const card = page.locator(cardSelector('hand', ownerId, cardId));
  await card.click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: /reveal|revelar/i }).click();
  const target = targetName
    ? menu.getByRole('menuitem', { name: new RegExp(escapeRegExp(targetName), 'i') })
    : menu.getByRole('menuitem').first();
  await target.click();
  await expect(page.getByTestId('hand-reveal-dialog')).toBeVisible();
}

function assertRejected(frame: JsonObject, code: string, version: number): void {
  expect(frame['kind']).toBe('command_ack');
  expect(frame['status']).toBe('rejected');
  expect(frame['version']).toBe(version);
  const error = frame['error'] as JsonObject;
  expect(error['code']).toBe(code);
  expect(JSON.stringify(error)).not.toMatch(/cardKey|cardRef|printId|name|imageUris|cardFaces/i);
}

function assertRealHandCards(state: JsonObject, ownerId: string, instanceIds: readonly string[]): void {
  const hand = zoneCards(state, ownerId, 'hand');
  for (const instanceId of instanceIds) expect(hand.some((card) => card['instanceId'] === instanceId && card['hidden'] !== true)).toBe(true);
}

function assertOpaqueHand(state: JsonObject, ownerId: string, privateIds: readonly string[]): void {
  const serialized = JSON.stringify(zoneCards(state, ownerId, 'hand'));
  for (const instanceId of privateIds) expect(serialized).not.toContain(instanceId);
}

async function allSnapshots(request: APIRequestContext, setup: Setup): Promise<[JsonObject, JsonObject, JsonObject]> {
  return Promise.all([0, 1, 2].map((index) => snapshot(request, setup, index))) as Promise<[JsonObject, JsonObject, JsonObject]>;
}

async function sendRuntimeRaw(request: APIRequestContext, setup: Setup, playerIndex: number, message: JsonObject): Promise<JsonObject> {
  const response = await request.post(`${API_BASE_URL}/games/${setup.gameId}/websocket-ticket`, { headers: auth(setup.players[playerIndex].token) });
  await expectOk(response, 'create runtime ticket');
  const ticket = await response.json() as { websocketUrl?: string; route?: string };
  if (ticket.route !== 'runtime_ws' || !ticket.websocketUrl) throw new Error('Runtime ticket did not select runtime_ws.');
  return new Promise<JsonObject>((resolvePromise, reject) => {
    const socket = new WebSocket(ticket.websocketUrl!);
    const timeout = setTimeout(() => { socket.close(); reject(new Error('Timed out waiting for runtime command result.')); }, 20_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify(message)));
    socket.addEventListener('message', async (event) => {
      const text = typeof event.data === 'string' ? event.data : await new Response(event.data).text();
      const frame = JSON.parse(text) as JsonObject;
      const actionId = String(message['clientActionId'] ?? '');
      if ((frame['kind'] === 'command_ack' && frame['clientActionId'] === actionId) ||
        (frame['kind'] === 'patch.v2' && frame['ackClientActionId'] === actionId)) {
        clearTimeout(timeout);
        socket.close();
        resolvePromise(frame);
      }
    });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Runtime WebSocket failed.')); });
  });
}

async function createContexts(browser: Browser, baseURL: string, setup: Setup): Promise<[BrowserContext, BrowserContext, BrowserContext]> {
  return Promise.all(setup.players.map((player, index) => browser.newContext({
    baseURL,
    viewport: index === 0 ? { width: 1600, height: 1000 } : { width: 1280, height: 800 },
    storageState: authStorageState(baseURL, player.user, player.refreshToken),
  }))) as Promise<[BrowserContext, BrowserContext, BrowserContext]>;
}

async function createGame(request: APIRequestContext, runId: string): Promise<Setup> {
  const players: Player[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `${runId}-${index}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, { ownerToken: session.token, name: `s4d-${runId.slice(-8)}-${index}` });
    players.push({ ...session, deckId: deck.deckId });
  }
  const room = await request.post(`${API_BASE_URL}/rooms`, { headers: auth(players[0]!.token), data: {
    deckId: players[0]!.deckId, visibility: 'private', name: runId, format: 'commander', maxPlayers: 3,
    mulliganRule: 'LONDON', firstMulliganFree: true,
  } });
  await expectOk(room, 'create Sprint 4D room');
  const roomId = String(((await room.json()) as { room?: { id?: string } }).room?.id ?? '');
  for (const player of players.slice(1)) {
    await expectOk(await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, { headers: auth(player.token), data: { deckId: player.deckId } }), 'join Sprint 4D room');
  }
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const current = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: auth(players[0]!.token) });
    await expectOk(current, 'load Sprint 4D room');
    const entries = ((await current.json()) as { room?: { players?: Array<{ turnRolls?: number[] }> } }).room?.players ?? [];
    if (entries.length === 3 && entries.every((entry) => entry.turnRolls?.length) && new Set(entries.map((entry) => entry.turnRolls?.join('-'))).size === 3) break;
    for (const player of players) {
      const roll = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: auth(player.token) });
      if (!roll.ok() && roll.status() !== 409) await expectOk(roll, 'roll Sprint 4D turn order');
    }
  }
  const started = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: auth(players[0]!.token) });
  await expectOk(started, 'start Sprint 4D game');
  const gameId = String(((await started.json()) as { game?: { id?: string } }).game?.id ?? '');
  if (!gameId) throw new Error('Sprint 4D game did not start.');
  return { gameId, players: players as [Player, Player, Player] };
}

async function snapshot(request: APIRequestContext, setup: Setup, viewerIndex: number): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${setup.gameId}/snapshot`, { headers: auth(setup.players[viewerIndex].token) });
  await expectOk(response, 'load Sprint 4D snapshot');
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

function auditPage(page: Page): BrowserAudit {
  const audit: BrowserAudit = { frames: [], errors: [], recoveryRequests: [] };
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    try { audit.frames.push(JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as JsonObject); } catch { /* ping */ }
  }));
  page.on('request', (outgoing) => { if (/\/snapshot(?:\?|$)|\/bootstrap(?:\?|$)/.test(outgoing.url())) audit.recoveryRequests.push(outgoing.url()); });
  page.on('console', (message) => { if (message.type() === 'error') audit.errors.push(message.text()); });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  return audit;
}

function assertCleanAudit(audit: BrowserAudit): void {
  const serialized = JSON.stringify(audit.frames);
  expect(serialized).not.toMatch(/target_not_found|resync_required|recovery_required|Unknown Card|fallback/i);
  expect(audit.frames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
  expect(audit.errors.filter((error) => /target_not_found|resync_required|Unknown Card|fallback/i.test(error))).toEqual([]);
}

function zoneCards(state: JsonObject, playerId: string, zone: string): JsonObject[] {
  const player = ((state['players'] as Record<string, JsonObject> | undefined) ?? {})[playerId];
  return ((player?.['zones'] as Record<string, JsonObject[]> | undefined) ?? {})[zone] ?? [];
}

function zoneIds(state: JsonObject, playerId: string, zone: string): string[] {
  return zoneCards(state, playerId, zone).map((card) => String(card['instanceId'] ?? '')).filter(Boolean);
}

function cardSelector(zone: string, ownerId: string, instanceId: string): string {
  return `[data-testid="game-card"][data-zone="${zone}"][data-owner-player-id="${ownerId}"][data-card-instance-id="${instanceId}"]`;
}

async function focusPlayer(page: Page, playerId: string): Promise<void> {
  await expect(page.getByTestId('player-panel')).toBeVisible();
  if (await page.getByTestId('player-panel').getAttribute('data-player-id') === playerId) return;
  const drawerToggle = page.getByTestId('opponents-drawer-toggle');
  if (await drawerToggle.isVisible() && await drawerToggle.getAttribute('aria-expanded') === 'false') await drawerToggle.click();
  const miniBoard = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`);
  await miniBoard.click();
  await expect(page.getByTestId('player-panel')).toHaveAttribute('data-player-id', playerId);
}

async function expectWithinViewport(page: Page, locator: Locator): Promise<void> {
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    return box !== null && viewport !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
  }).toBe(true);
}

async function expectWithinNativeViewport(page: Page, locator: Locator): Promise<void> {
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    return box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function expectOk(response: Pick<APIResponse, 'ok' | 'status' | 'text'>, action: string): Promise<void> {
  if (!response.ok()) throw new Error(`${action} failed (${response.status()}): ${await response.text()}`);
}
