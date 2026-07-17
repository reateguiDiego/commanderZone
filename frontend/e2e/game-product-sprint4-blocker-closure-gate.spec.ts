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
type Audit = { frames: JsonObject[]; errors: string[] };

test.describe('Gameplay 1.0 Sprint 4A.1 blocker closure gate', () => {
	test.describe.configure({ mode: 'serial' });

	test('3P closes top-library order, invalidation and face-down GameLog privacy across continuity', async ({ browser, request, baseURL }) => {
		test.setTimeout(720_000);
		if (!baseURL) throw new Error('Playwright baseURL is required.');
		const setup = await createGame(request, 3, `s4block${Date.now().toString(36)}`);
		await resolveGameToPlaying(request, setup.gameId, setup.players);
		const contexts = await createContexts(browser, baseURL, setup, { width: 1280, height: 800 });
		let pages = await Promise.all(contexts.map((context) => context.newPage()));
		const audits = pages.map((page) => auditPage(page));
		try {
			await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
			await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
			await expectStablePresence(request, setup, pages, audits);
			let owner = await snapshot(request, setup, 0);
			let version = Number(owner['version'] ?? 1);
			const ownerId = setup.players[0]!.user.id;
			const targetId = setup.players[1]!.user.id;
			const initialLibrary = zoneIds(owner, ownerId, 'library');
			expect(initialLibrary.length).toBeGreaterThanOrEqual(4);
			const originalBottom = initialLibrary.at(-1)!;

			const revealOne = await command(request, setup, version, 'library.reveal_top', { playerId: ownerId, count: 1, to: [targetId] });
			version = revealOne.version;
			await expectViewerVersions(audits, version);
			let target = await waitSnapshotVersion(request, setup, 1, version);
			let third = await waitSnapshotVersion(request, setup, 2, version);
			expect(zoneIds(target, ownerId, 'library')[0]).toBe(initialLibrary[0]);
			expect(zoneIds(target, ownerId, 'library')).not.toContain(originalBottom);
			expect(zoneIds(third, ownerId, 'library').some((id) => initialLibrary.includes(id))).toBe(false);

			const revealTwo = await command(request, setup, version, 'library.reveal_top', { playerId: ownerId, count: 2, to: [targetId] });
			version = revealTwo.version;
			await expectViewerVersions(audits, version);
			target = await waitSnapshotVersion(request, setup, 1, version);
			third = await waitSnapshotVersion(request, setup, 2, version);
			expect(zoneIds(target, ownerId, 'library').slice(0, 2)).toEqual(initialLibrary.slice(0, 2));
			expect(zoneIds(target, ownerId, 'library')).not.toContain(originalBottom);
			expect(zoneIds(third, ownerId, 'library').some((id) => initialLibrary.includes(id))).toBe(false);

			await pages[1]!.reload();
			await expect(pages[1]!.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
			target = await snapshot(request, setup, 1);
			expect(zoneIds(target, ownerId, 'library').slice(0, 2)).toEqual(initialLibrary.slice(0, 2));
			await pages[1]!.close();
			pages[1] = await contexts[1]!.newPage();
			audits[1] = auditPage(pages[1]!);
			await pages[1]!.goto(`/games/${setup.gameId}`);
			await expect(pages[1]!.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
			target = await snapshot(request, setup, 1);
			expect(zoneIds(target, ownerId, 'library').slice(0, 2)).toEqual(initialLibrary.slice(0, 2));

			await restartRuntime(request);
			await Promise.all(pages.map((page) => page.reload()));
			await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
			target = await snapshot(request, setup, 1);
			expect(zoneIds(target, ownerId, 'library').slice(0, 2)).toEqual(initialLibrary.slice(0, 2));

			const invalidate = async (type: string, payload: JsonObject): Promise<void> => {
				owner = await snapshot(request, setup, 0);
				const currentTop = zoneIds(owner, ownerId, 'library').slice(0, 2);
				const nextReveal = await command(request, setup, version, 'library.reveal_top', { playerId: ownerId, count: 2, to: [targetId] });
				version = nextReveal.version;
				const mutation = await command(request, setup, version, type, payload);
				version = mutation.version;
				const after = await waitSnapshotVersion(request, setup, 1, version);
				expect(zoneIds(after, ownerId, 'library').some((id) => currentTop.includes(id))).toBe(false);
			};
			owner = await snapshot(request, setup, 0);
			await invalidate('library.reorder_top', { playerId: ownerId, instanceIds: zoneIds(owner, ownerId, 'library').slice(0, 2).reverse() });
			await invalidate('library.move_top', { playerId: ownerId, count: 1, toZone: 'hand' });
			owner = await snapshot(request, setup, 0);
			await invalidate('library.put_top', { playerId: ownerId, instanceId: zoneIds(owner, ownerId, 'hand')[0] });
			owner = await snapshot(request, setup, 0);
			await invalidate('library.put_bottom', { playerId: ownerId, instanceId: zoneIds(owner, ownerId, 'hand')[0] });
			await invalidate('library.shuffle', { playerId: ownerId });

			owner = await snapshot(request, setup, 0);
			const hand = zoneIds(owner, ownerId, 'hand');
			const library = zoneIds(owner, ownerId, 'library');
			expect(hand.length).toBeGreaterThanOrEqual(3);
			expect(library.length).toBeGreaterThanOrEqual(3);
			for (const move of [
				{ type: 'card.moved', payload: { playerId: ownerId, fromZone: 'hand', toZone: 'battlefield', instanceId: hand[0], faceDown: true }, ids: [hand[0]!] },
				{ type: 'cards.moved', payload: { playerId: ownerId, fromZone: 'hand', toZone: 'battlefield', instanceIds: hand.slice(1, 3), faceDown: true }, ids: hand.slice(1, 3) },
				{ type: 'card.moved', payload: { playerId: ownerId, fromZone: 'library', toZone: 'battlefield', instanceId: library[0], faceDown: true }, ids: [library[0]!] },
				{ type: 'cards.moved', payload: { playerId: ownerId, fromZone: 'library', toZone: 'battlefield', instanceIds: library.slice(1, 3), faceDown: true }, ids: library.slice(1, 3) },
			] as const) {
				const result = await command(request, setup, version, move.type, move.payload);
				version = result.version;
				await expectViewerVersions(audits, version);
				for (const audit of audits) {
					const serializedLogs = JSON.stringify(eventLogOperations(audit.frames.filter((frame) => Number(frame['version']) === version)));
					for (const id of move.ids) expect(serializedLogs).not.toContain(id);
					expect(serializedLogs).not.toMatch(/cardKey|cardRef|printId|imageUris|cardFaces|staticBundle/i);
				}
				for (const viewerIndex of [0, 1, 2]) {
					const view = await waitSnapshotVersion(request, setup, viewerIndex, version);
					const serializedLog = JSON.stringify(view['eventLog'] ?? []);
					for (const id of move.ids) expect(serializedLog).not.toContain(id);
				}
			}

			await pages[1]!.getByTestId('game-log-open').click();
			await expect(pages[1]!.getByTestId('game-log-panel')).toBeVisible();
			const logText = await pages[1]!.getByTestId('game-log').innerText();
			for (const id of [...hand.slice(0, 3), ...library.slice(0, 3)]) expect(logText).not.toContain(id);
			assertCleanAudits(audits);

			await assertResponsiveDrawerAndViewMenu(pages[0]!);
		} finally {
			await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
		}
	});

	test('5P minimal keeps stable presence, essential hit targets and View submenu in the viewport', async ({ browser, request, baseURL }) => {
		test.setTimeout(600_000);
		if (!baseURL) throw new Error('Playwright baseURL is required.');
		const setup = await createGame(request, 5, `s4min${Date.now().toString(36)}`);
		await resolveGameToPlaying(request, setup.gameId, setup.players);
		const contexts = await createContexts(browser, baseURL, setup, { width: 850, height: 600 });
		try {
			const pages = await Promise.all(contexts.map((context) => context.newPage()));
			const audits = pages.map((page) => auditPage(page));
			await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
			await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
			await expectStablePresence(request, setup, pages, audits);
			const owner = pages[0]!;
			await expect(owner.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', 'minimal');
			await expect(owner.locator('app-game-disconnect-vote-modal [role="dialog"]')).toHaveCount(0);
			const trigger = owner.getByTestId('opponents-drawer-toggle');
			const triggerBox = await trigger.boundingBox();
			expect(triggerBox).not.toBeNull();
			expect(triggerBox!.width).toBeGreaterThanOrEqual(40);
			expect(triggerBox!.height).toBeGreaterThanOrEqual(40);
			await assertResponsiveDrawerAndViewMenu(owner);
		} finally {
			await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
		}
	});
});

async function assertResponsiveDrawerAndViewMenu(page: Page): Promise<void> {
	const trigger = page.getByTestId('opponents-drawer-toggle');
	if (!await trigger.isVisible()) return;
	if (await trigger.getAttribute('aria-expanded') === 'true') await trigger.click();
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator('#game-table-opponents-list')).toHaveAttribute('aria-hidden', 'true');
	await expect(page.locator('#game-table-opponents-list')).toHaveAttribute('inert', '');
	await trigger.click();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	const boards = page.getByTestId('opponent-mini-board');
	for (let index = 0; index < await boards.count(); index += 1) {
		await expect(boards.nth(index)).toBeVisible();
		await expectWithinViewport(page, boards.nth(index));
	}
	await trigger.click();
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');

	const library = page.getByTestId('drop-zone').filter({ has: page.locator('[data-zone="library"]') });
	const libraryPile = page.locator('[data-testid="drop-zone"][data-zone="library"]').first();
	await expect(libraryPile.or(library).first()).toBeVisible();
	await libraryPile.or(library).first().click({ button: 'right' });
	const menu = page.locator('.context-menu');
	await expect(menu).toBeVisible();
	const view = menu.getByRole('button', { name: /view|ver/i }).last();
	await view.click();
	const submenu = menu.locator('.submenu-panel').last();
	await expect(submenu).toBeVisible();
	await expectWithinViewport(page, menu);
	await expectWithinViewport(page, submenu);
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
}

async function command(request: APIRequestContext, setup: Setup, baseVersion: number, type: string, payload: JsonObject) {
	return sendRuntimeCommand(request, { gameId: setup.gameId, token: setup.players[0]!.token, baseVersion, type, payload });
}

async function createContexts(browser: Browser, baseURL: string, setup: Setup, ownerViewport: { width: number; height: number }): Promise<BrowserContext[]> {
	return Promise.all(setup.players.map((player, index) => browser.newContext({
		baseURL,
		viewport: index === 0 ? ownerViewport : { width: 1600, height: 1000 },
		storageState: authStorageState(baseURL, player.user, player.refreshToken),
	})));
}

async function createGame(request: APIRequestContext, playerCount: number, runId: string): Promise<Setup> {
	const players: Player[] = [];
	for (let index = 0; index < playerCount; index += 1) {
		const session = await createRealUserSession(request, `${runId}-${index}`);
		const deck = await createBasicCommanderDeckFromDatabase(request, { ownerToken: session.token, name: `s4-${runId.slice(-8)}-${index}` });
		players.push({ ...session, deckId: deck.deckId });
	}
	const roomResponse = await request.post(`${API_BASE_URL}/rooms`, { headers: auth(players[0]!.token), data: {
		deckId: players[0]!.deckId, visibility: 'private', name: runId, format: 'commander', maxPlayers: playerCount, mulliganRule: 'LONDON', firstMulliganFree: true,
	} });
	await expectOk(roomResponse, 'create blocker room');
	const roomId = String(((await roomResponse.json()) as { room?: { id?: string } }).room?.id ?? '');
	for (const player of players.slice(1)) await expectOk(await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, { headers: auth(player.token), data: { deckId: player.deckId } }), 'join blocker room');
	for (let attempt = 0; attempt < 24; attempt += 1) {
		const room = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: auth(players[0]!.token) });
		await expectOk(room, 'load blocker room');
		const entries = ((await room.json()) as { room?: { players?: Array<{ turnRolls?: number[] }> } }).room?.players ?? [];
		if (entries.length === playerCount && entries.every((entry) => entry.turnRolls?.length) && new Set(entries.map((entry) => entry.turnRolls?.join('-'))).size === playerCount) break;
		for (const player of players) {
			const roll = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: auth(player.token) });
			if (!roll.ok() && roll.status() !== 409) await expectOk(roll, 'roll blocker turn order');
		}
	}
	const start = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: auth(players[0]!.token) });
	await expectOk(start, 'start blocker game');
	const gameId = String(((await start.json()) as { game?: { id?: string } }).game?.id ?? '');
	if (!gameId) throw new Error('Blocker gate game did not start.');
	return { gameId, players };
}

async function snapshot(request: APIRequestContext, setup: Setup, viewerIndex: number): Promise<JsonObject> {
	const response = await request.get(`${API_BASE_URL}/games/${setup.gameId}/snapshot`, { headers: auth(setup.players[viewerIndex]!.token) });
	await expectOk(response, 'load blocker snapshot');
	return ((await response.json()) as { game: { snapshot: JsonObject } }).game.snapshot;
}

async function waitSnapshotVersion(request: APIRequestContext, setup: Setup, viewerIndex: number, version: number): Promise<JsonObject> {
	let current: JsonObject = {};
	await expect.poll(async () => {
		current = await snapshot(request, setup, viewerIndex);
		return Number(current['version'] ?? 0);
	}, { timeout: 30_000 }).toBe(version);
	return current;
}

async function expectStablePresence(request: APIRequestContext, setup: Setup, pages: readonly Page[], audits: readonly Audit[]): Promise<void> {
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

function auditPage(page: Page): Audit {
	const audit: Audit = { frames: [], errors: [] };
	page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
		try { audit.frames.push(JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as JsonObject); } catch { /* protocol ping */ }
	}));
	page.on('console', (message) => { if (message.type() === 'error') audit.errors.push(message.text()); });
	page.on('pageerror', (error) => audit.errors.push(error.message));
	return audit;
}

async function expectViewerVersions(audits: readonly Audit[], version: number): Promise<void> {
	await Promise.all(audits.map((audit) => expect.poll(
		() => audit.frames.some((frame) => frame['kind'] === 'patch.v2' && Number(frame['version']) === version),
		{ timeout: 20_000 },
	).toBe(true)));
}

function eventLogOperations(frames: readonly JsonObject[]): JsonObject[] {
	return frames.flatMap((frame) => (Array.isArray(frame['ops']) ? frame['ops'] as JsonObject[] : []))
		.filter((operation) => operation['op'] === 'eventLog.append');
}

function assertCleanAudits(audits: readonly Audit[]): void {
	for (const audit of audits) {
		const serialized = JSON.stringify(audit.frames);
		expect(serialized).not.toMatch(/target_not_found|resync_required|recovery_required/i);
		expect(audit.frames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
		expect(audit.errors.filter((error) => /target_not_found|resync_required|Unknown Card/i.test(error))).toEqual([]);
	}
}

async function expectWithinViewport(page: Page, locator: Locator): Promise<void> {
	await expect.poll(async () => {
		const box = await locator.boundingBox();
		const viewport = page.viewportSize();
		return box !== null && viewport !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
	}).toBe(true);
}

function zoneIds(state: JsonObject, playerId: string, zone: string): string[] {
	const player = ((state['players'] as Record<string, JsonObject> | undefined) ?? {})[playerId];
	const cards = ((player?.['zones'] as Record<string, JsonObject[]> | undefined) ?? {})[zone] ?? [];
	return cards.map((card) => String(card['instanceId'] ?? '')).filter(Boolean);
}

function auth(token: string): Record<string, string> { return { Authorization: `Bearer ${token}` }; }
async function expectOk(response: { ok(): boolean; status(): number; text(): Promise<string> }, action: string): Promise<void> {
	if (!response.ok()) throw new Error(`${action} failed (${response.status()}): ${await response.text()}`);
}
