import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { resolveGameToPlaying } from './support/commander-game';
import { sendRuntimeCommand } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const SERVICE_URLS = [
  `${API_BASE_URL}/healthz`,
  `${API_BASE_URL}/readyz`,
  process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz',
  process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz',
  process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz',
  process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz',
];
const RUNTIME_READY_URL = SERVICE_URLS[5]!;
const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;
type Player = {
  token: string;
  refreshToken: string;
  user: RealUserSession['user'];
  deck: BasicCommanderDeckFromDatabaseResult;
};
type Setup = { gameId: string; players: [Player, Player, Player] };
type Audit = { frames: JsonObject[]; recoveryRequests: number; errors: string[] };
type CanonicalView = {
  libraryIds: string[];
  handCount: number;
  battlefield: Array<{ instanceId: string; faceDown: boolean; name: string; cardKey: string }>;
  stackIds: string[];
  dungeonMarker: unknown;
};

test.describe('private replay parity closure gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: Setup;
  let expectedByViewer: CanonicalView[];
  let markerInstanceId: string;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(360_000);
    await Promise.all(SERVICE_URLS.map(async (url) => expect((await request.get(url)).ok()).toBe(true)));
    setup = await createThreePlayerGame(request, `replay${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
  });

  test('3P live state, PHP bootstrap, refresh and reconnect remain equivalent after stateful events', async ({ browser, request, baseURL }) => {
    test.setTimeout(480_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const [owner, target, third] = setup.players;
    const initial = await gameSnapshot(request, setup.gameId, owner.token);
    const handIds = zoneIds(initial, owner.user.id, 'hand');
    const libraryIds = zoneIds(initial, owner.user.id, 'library');
    if (handIds.length < 5 || libraryIds.length < 5) {
      throw new Error(`Private replay gate needs five hand/library cards; hand=${handIds.length} library=${libraryIds.length}.`);
    }
    markerInstanceId = handIds[0]!;

    const contexts = await Promise.all(setup.players.map((player) => browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, player.user, player.refreshToken),
    })));
    await Promise.all(contexts.map(enableFrontendGameplayV2));
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const audits = pages.map(createAudit);
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(audits.map((audit) => waitForConnection(audit.frames)));
      await Promise.all(pages.map((page) => focusPlayer(page, owner.user.id)));
      const liveRecoveryBaseline = audits.reduce((sum, audit) => sum + audit.recoveryRequests, 0);

      let version = Math.max(1, Number(initial['version'] ?? 1));
      const run = async (type: string, payload: JsonObject): Promise<void> => {
        const result = await sendRuntimeCommand(request, {
          gameId: setup.gameId,
          token: owner.token,
          baseVersion: version,
          type,
          payload,
        });
        version = result.version;
        await Promise.all(audits.map((audit) => expect.poll(
          () => audit.frames.some((frame) => frame['kind'] === 'patch.v2' && Number(frame['version']) === version),
          { timeout: 20_000 },
        ).toBe(true)));
      };

      await run('cards.moved', {
        playerId: owner.user.id,
        fromZone: 'hand',
        toZone: 'battlefield',
        instanceIds: handIds.slice(0, 2),
        faceDown: true,
      });
      await run('card.moved', {
        playerId: owner.user.id,
        fromZone: 'library',
        toZone: 'battlefield',
        instanceId: libraryIds[0],
        faceDown: true,
      });

      const afterPrivateMoves = await gameSnapshot(request, setup.gameId, owner.token);
      const topWindow = zoneIds(afterPrivateMoves, owner.user.id, 'library').slice(0, 3);
      await run('library.reorder_top', { playerId: owner.user.id, instanceIds: [...topWindow].reverse() });
      await run('library.move_top', { playerId: owner.user.id, count: 1, toZone: 'library', position: 'bottom' });
      await run('library.put_top', { playerId: owner.user.id, instanceId: handIds[2] });
      await run('library.put_bottom', { playerId: owner.user.id, instanceId: handIds[3] });
      await run('stack.card_added', { playerId: owner.user.id, instanceId: handIds[0], stackId: 'replay-stack-a' });
      await run('stack.card_added', { playerId: owner.user.id, instanceId: handIds[1], stackId: 'replay-stack-b' });
      await run('stack.item_removed', { playerId: owner.user.id, stackId: 'replay-stack-a' });
      await run('card.dungeon_marker.changed', {
        playerId: owner.user.id,
        instanceId: handIds[0],
        position: { x: 0.31, y: 0.67, unit: 'ratio' },
      });

      expect(audits.reduce((sum, audit) => sum + audit.recoveryRequests, 0)).toBe(liveRecoveryBaseline);
      assertNoRecoveryOrLegacyFrames(audits);

      const liveSnapshots = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      expectedByViewer = liveSnapshots.map((snapshot) => canonicalView(snapshot, owner.user.id, handIds[0]));
      expect(expectedByViewer[0]!.libraryIds[0]).toBe(handIds[2]);
      expect(expectedByViewer[0]!.libraryIds.at(-1)).toBe(handIds[3]);
      expect(expectedByViewer[0]!.stackIds).toEqual(['replay-stack-b']);
      expect(expectedByViewer[0]!.dungeonMarker).toEqual({ x: 0.31, y: 0.67 });
      const privateNames = new Set(expectedByViewer[0]!.battlefield.filter((card) => card.faceDown).map((card) => card.name));
      for (const view of expectedByViewer.slice(1)) {
        const hiddenCards = view.battlefield.filter((card) => card.faceDown);
        expect(hiddenCards.map((card) => card.cardKey), JSON.stringify(hiddenCards)).toEqual(hiddenCards.map(() => ''));
        expect(hiddenCards.every((card) => !/Unknown Card/i.test(card.name)), JSON.stringify(hiddenCards)).toBe(true);
        expect(hiddenCards.every((card) => !privateNames.has(card.name)), JSON.stringify(hiddenCards)).toBe(true);
      }
      for (const [index, page] of pages.entries()) {
        await expect.poll(async () => (await battlefieldIds(page, owner.user.id)).sort(), { timeout: 20_000 }).toEqual(
          expectedByViewer[index]!.battlefield.map((card) => card.instanceId).sort(),
        );
      }

      await Promise.all(pages.map((page) => page.reload()));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(pages.map((page) => focusPlayer(page, owner.user.id)));
      const refreshed = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
      refreshed.forEach((snapshot, index) => expect(canonicalView(snapshot, owner.user.id, handIds[0])).toEqual(expectedByViewer[index]));

      const reconnectContext = await browser.newContext({ baseURL, storageState: await contexts[2].storageState() });
      await enableFrontendGameplayV2(reconnectContext);
      const reconnectPage = await reconnectContext.newPage();
      const reconnectAudit = createAudit(reconnectPage);
      await reconnectPage.goto(`/games/${setup.gameId}`);
      await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForConnection(reconnectAudit.frames);
      await focusPlayer(reconnectPage, owner.user.id);
      expect(canonicalView(await gameSnapshot(request, setup.gameId, third.token), owner.user.id, handIds[0])).toEqual(expectedByViewer[2]);
      assertNoRecoveryOrLegacyFrames([...audits, reconnectAudit]);
      await reconnectContext.close();

      expect(JSON.stringify(expectedByViewer[1])).not.toContain('private:key');
      expect(JSON.stringify(expectedByViewer[2])).not.toContain('private:key');
      void target;
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });

  test('actor restart replays the same state for every viewer', async ({ request }) => {
    test.setTimeout(180_000);
    await restartRuntime();
    await expect.poll(async () => (await request.get(RUNTIME_READY_URL)).ok(), { timeout: 60_000 }).toBe(true);
    const [owner] = setup.players;
    const rebuilt = await Promise.all(setup.players.map((player) => gameSnapshot(request, setup.gameId, player.token)));
    rebuilt.forEach((snapshot, index) => expect(canonicalView(snapshot, owner.user.id, markerInstanceId)).toEqual(expectedByViewer[index]));
    expect(canonicalView(rebuilt[0]!, owner.user.id, markerInstanceId).stackIds).toEqual(['replay-stack-b']);
  });
});

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<Setup> {
  const players: Player[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `rp-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, { ownerToken: session.token, name: `RP${index + 1} ${runId.slice(-8)}` });
    players.push({ token: session.token, refreshToken: session.refreshToken, user: session.user, deck });
  }
  const create = await request.post(`${API_BASE_URL}/rooms`, {
    headers: auth(players[0]!.token),
    data: { deckId: players[0]!.deck.deckId, visibility: 'public', name: `Replay ${runId}`, format: 'commander', maxPlayers: 3, mulliganRule: 'LONDON', firstMulliganFree: true },
  });
  await expectOk(create, 'create replay room');
  const roomId = String(((await create.json()) as { room?: { id?: string } }).room?.id ?? '');
  for (const player of players.slice(1)) {
    await expectOk(await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, { headers: auth(player.token), data: { deckId: player.deck.deckId } }), 'join replay room');
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const room = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: auth(players[0]!.token) });
    const entries = ((await room.json()) as { room?: { players?: Array<{ turnRolls?: number[] }> } }).room?.players ?? [];
    if (entries.length === 3 && new Set(entries.map((entry) => entry.turnRolls?.join('-'))).size === 3 && entries.every((entry) => entry.turnRolls?.length)) break;
    for (const player of players) {
      const roll = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: auth(player.token) });
      if (!roll.ok() && roll.status() !== 409) await expectOk(roll, 'roll replay turn order');
    }
  }
  const start = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: auth(players[0]!.token) });
  await expectOk(start, 'start replay room');
  const gameId = String(((await start.json()) as { game?: { id?: string } }).game?.id ?? '');
  if (!gameId || players.length !== 3) throw new Error('Could not create three-player replay game.');
  return { gameId, players: players as [Player, Player, Player] };
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: auth(token) });
  await expectOk(response, 'load replay snapshot');
  return ((await response.json()) as { game?: { snapshot?: JsonObject } }).game?.snapshot ?? {};
}

function canonicalView(snapshot: JsonObject, ownerId: string, markerId: string): CanonicalView {
  const battlefield = zoneCards(snapshot, ownerId, 'battlefield').map((card) => ({
    instanceId: String(card['instanceId'] ?? ''),
    faceDown: card['faceDown'] === true,
    name: String(card['name'] ?? ''),
    cardKey: String(card['cardKey'] ?? ''),
  }));
  const stack = Array.isArray(snapshot['stack']) ? snapshot['stack'] as JsonObject[] : [];
  return {
    libraryIds: zoneIds(snapshot, ownerId, 'library'),
    handCount: Number(((snapshot['players'] as Record<string, JsonObject>)[ownerId]?.['handCount']) ?? zoneCards(snapshot, ownerId, 'hand').length),
    battlefield,
    stackIds: stack.map((item) => String(item['stackId'] ?? item['id'] ?? '')),
    dungeonMarker: battlefield.length === 0 ? null : zoneCards(snapshot, ownerId, 'battlefield').find((card) => card['instanceId'] === markerId)?.['dungeonMarker'] ?? null,
  };
}

function zoneCards(snapshot: JsonObject, playerId: string, zone: string): JsonObject[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  return ((players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined)?.[zone]) ?? [];
}
function zoneIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  return zoneCards(snapshot, playerId, zone).map((card) => String(card['instanceId'] ?? '')).filter(Boolean);
}
async function battlefieldIds(page: Page, ownerId: string): Promise<string[]> {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerId}"]`).evaluateAll((cards) => cards.map((card) => card.getAttribute('data-card-instance-id') ?? '').filter(Boolean));
}

function createAudit(page: Page): Audit {
  const audit: Audit = { frames: [], recoveryRequests: 0, errors: [] };
  page.on('websocket', (socket) => socket.on('framereceived', (event) => {
    try { audit.frames.push(JSON.parse(typeof event.payload === 'string' ? event.payload : event.payload.toString('utf8')) as JsonObject); } catch { /* non-json */ }
  }));
  page.on('request', (request) => {
    if (request.method() === 'GET' && /\/games\/[^/]+\/(bootstrap|snapshot)/.test(request.url())) audit.recoveryRequests += 1;
  });
  page.on('console', (message) => { if (message.type() === 'error' || /target_not_found|resync_required/i.test(message.text())) audit.errors.push(message.text()); });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  return audit;
}

function assertNoRecoveryOrLegacyFrames(audits: Audit[]): void {
  for (const audit of audits) {
    expect(audit.frames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
    expect(audit.frames.some((frame) => frame['kind'] === 'resync_required' || frame['status'] === 'resync_required')).toBe(false);
    expect(JSON.stringify(audit.frames)).not.toContain('target_not_found');
    expect(audit.errors.filter((error) => /target_not_found|resync_required|Unknown Card/i.test(error))).toEqual([]);
  }
}

async function waitForConnection(frames: JsonObject[]): Promise<void> {
  await expect.poll(() => frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), { timeout: 30_000 }).toBe(true);
}
async function focusPlayer(page: Page, playerId: string): Promise<void> {
  await expect(page.getByTestId('player-panel')).toBeVisible({ timeout: 20_000 });
  if (await page.getByTestId('player-panel').getAttribute('data-player-id') === playerId) return;
	const drawer = page.getByTestId('opponents-drawer-toggle');
	if (await drawer.isVisible() && await drawer.getAttribute('aria-expanded') !== 'true') {
		await drawer.click();
		await expect(drawer).toHaveAttribute('aria-expanded', 'true');
	}
	const board = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`);
	await expect(board).toBeVisible();
	await board.click();
  await expect(page.getByTestId('player-panel')).toHaveAttribute('data-player-id', playerId);
}
async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1'));
}
async function restartRuntime(): Promise<void> {
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], { cwd: resolve(process.cwd(), '..'), timeout: 60_000, windowsHide: true });
}
function auth(token: string): Record<string, string> { return { Authorization: `Bearer ${token}` }; }
async function expectOk(response: APIResponse, action: string): Promise<void> {
  if (!response.ok()) throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
