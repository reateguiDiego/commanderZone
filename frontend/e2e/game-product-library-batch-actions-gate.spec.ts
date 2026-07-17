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
type Setup = { gameId: string; players: Player[] };
type BrowserAudit = { frames: JsonObject[]; errors: string[]; recoveryRequests: string[] };
type WindowContract = { windowId: string; expectedEpoch: number; instanceIds: string[] };

test.describe('Gameplay 1.0 Sprint 4C private library batch actions gate', () => {
  test.describe.configure({ mode: 'serial' });

  test('3P enforces authoritative windows, atomic actions, face-down privacy and continuity', async ({ browser, request, baseURL }) => {
    test.setTimeout(1_200_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');

    const setup = await createGame(request, 3, `s4batch${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const contexts = await createContexts(browser, baseURL, setup);
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    pages.forEach((page) => page.setDefaultTimeout(25_000));
    const audits = pages.map(auditPage);

    try {
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await expectStablePresence(request, setup, pages, audits);

      const owner = pages[0]!;
      const ownerId = setup.players[0]!.user.id;

      await openTopView(owner, 5);
      const firstWindow = latestWindowContract(audits[0]!);
      expect(firstWindow.instanceIds).toHaveLength(5);
      expect(await modalCardIds(owner)).toEqual(firstWindow.instanceIds);

      const beforeRejected = await snapshot(request, setup, 0);
      const rejectedVersion = Number(beforeRejected['version'] ?? 0);
      const duplicate = await sendRuntimeRaw(request, setup, 0, {
        kind: 'command.v2', gameId: setup.gameId, messageId: 's4c-duplicate', clientActionId: 's4c-duplicate',
        baseVersion: rejectedVersion, type: 'library.selection.move',
        payload: {
          playerId: ownerId, windowId: firstWindow.windowId, expectedEpoch: firstWindow.expectedEpoch,
          orderedInstanceIds: [firstWindow.instanceIds[0], firstWindow.instanceIds[0]], toZone: 'hand',
        },
      });
      expect(duplicate['kind']).toBe('command_ack');
      expect(duplicate['status']).toBe('rejected');
      expect((duplicate['error'] as JsonObject | undefined)?.['code']).toBe('DUPLICATE_INSTANCE');
      expect(JSON.stringify(duplicate)).not.toContain(firstWindow.instanceIds[0]!);

      const invalid = await sendRuntimeRaw(request, setup, 0, {
        kind: 'command.v2', gameId: setup.gameId, messageId: 's4c-invalid', clientActionId: 's4c-invalid',
        baseVersion: rejectedVersion, type: 'library.selection.move',
        payload: {
          playerId: ownerId, windowId: firstWindow.windowId, expectedEpoch: firstWindow.expectedEpoch,
          orderedInstanceIds: ['not-in-window'], toZone: 'hand',
        },
      });
      expect(invalid['status']).toBe('rejected');
      expect(['INSTANCE_NOT_FOUND', 'INSTANCE_NOT_IN_WINDOW']).toContain((invalid['error'] as JsonObject | undefined)?.['code']);

      const unauthorized = await sendRuntimeRaw(request, setup, 1, {
        kind: 'command.v2', gameId: setup.gameId, messageId: 's4c-unauthorized', clientActionId: 's4c-unauthorized',
        baseVersion: rejectedVersion, type: 'library.selection.move',
        payload: {
          playerId: ownerId, windowId: firstWindow.windowId, expectedEpoch: firstWindow.expectedEpoch,
          orderedInstanceIds: [firstWindow.instanceIds[0]], toZone: 'hand',
        },
      });
      expect((unauthorized['error'] as JsonObject | undefined)?.['code']).toBe('PERMISSION_DENIED');
      expect(Number((await snapshot(request, setup, 0))['version'] ?? 0)).toBe(rejectedVersion);

      const handIds = [firstWindow.instanceIds[0]!, firstWindow.instanceIds[2]!];
      await selectModalIds(owner, handIds);
      const beforeHand = await snapshot(request, setup, 0);
      await confirmAction(owner, 'hand', 2);
      const afterHand = await snapshot(request, setup, 0);
      expect(Number(afterHand['version'] ?? 0)).toBe(Number(beforeHand['version'] ?? 0) + 1);
      expect(zoneIds(afterHand, ownerId, 'hand')).toEqual(expect.arrayContaining(handIds));
      await assertNoPrivateIdentity(pages.slice(1), audits.slice(1), handIds);

      await exerciseSelectedDestination(owner, request, setup, audits[0]!, ownerId, 'graveyard', 'graveyard', false);
      await exerciseSelectedDestination(owner, request, setup, audits[0]!, ownerId, 'exile', 'exile', false);

      const faceUp = await exerciseSelectedDestination(owner, request, setup, audits[0]!, ownerId, 'battlefield-face-up', 'battlefield', false);
      await expect.poll(async () => {
        const projected = await snapshot(request, setup, 1);
        return faceUp.every((instanceId) => JSON.stringify(projected).includes(instanceId));
      }).toBe(true);

      const faceDown = await exerciseSelectedDestination(owner, request, setup, audits[0]!, ownerId, 'battlefield-face-down', 'battlefield', true);
      const ownerAfterFaceDown = await snapshot(request, setup, 0);
      const faceDownCards = zoneCards(ownerAfterFaceDown, ownerId, 'battlefield').filter((card) => faceDown.includes(String(card['instanceId'] ?? '')));
      expect(faceDownCards).toHaveLength(2);
      for (const card of faceDownCards) {
        expect(card['faceDown']).toBe(true);
        expectRatioPosition(card['position']);
      }
      expect(new Set(faceDownCards.map((card) => JSON.stringify(card['position']))).size).toBe(2);
      await assertNoPrivateIdentity(pages.slice(1), audits.slice(1), faceDown);
      for (let viewerIndex = 1; viewerIndex < 3; viewerIndex += 1) {
        const projected = await snapshot(request, setup, viewerIndex);
        const serialized = JSON.stringify(projected);
        for (const instanceId of faceDown) expect(serialized).not.toContain(instanceId);
        expect(zoneIds(projected, ownerId, 'battlefield').some((id) => id.startsWith(`${ownerId}-hidden-battlefield-`))).toBe(true);
      }

      await openTopView(owner, 3);
      const topWindow = latestWindowContract(audits[0]!);
      const beforeTop = await snapshot(request, setup, 0);
      await confirmTopFaceDown(owner, 3);
      const afterTop = await snapshot(request, setup, 0);
      expect(Number(afterTop['version'] ?? 0)).toBe(Number(beforeTop['version'] ?? 0) + 1);
      const playedTop = topWindow.instanceIds.slice(0, 3);
      expect(zoneIds(afterTop, ownerId, 'battlefield')).toEqual(expect.arrayContaining(playedTop));
      await assertNoPrivateIdentity(pages.slice(1), audits.slice(1), playedTop);
      const publicLog = JSON.stringify((await snapshot(request, setup, 1))['eventLog'] ?? []);
      for (const instanceId of [...faceDown, ...playedTop]) expect(publicLog).not.toContain(instanceId);
      expect(publicLog).not.toMatch(/Unknown Card/i);

      await exerciseLibraryOrder(owner, request, setup, audits[0]!, ownerId, 'library-top');
      await exerciseLibraryOrder(owner, request, setup, audits[0]!, ownerId, 'library-bottom');

      const secondTab = await contexts[0]!.newPage();
      secondTab.setDefaultTimeout(25_000);
      const secondAudit = auditPage(secondTab);
      await secondTab.goto(`/games/${setup.gameId}`);
      await expect(secondTab.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await openTopView(owner, 5);
      const staleWindow = latestWindowContract(audits[0]!);
      await openTopView(secondTab, 5);
      const activeWindow = latestWindowContract(secondAudit);
      expect(activeWindow.windowId).not.toBe(staleWindow.windowId);
      await expect(owner.getByTestId('zone-modal-status')).toBeVisible({ timeout: 30_000 });
      await expect(owner.locator('[data-testid="zone-modal"] [data-card-instance-id]')).toHaveCount(0);
      await secondTab.locator('[data-testid="zone-modal"] [data-card-instance-id]').first().click();
      await confirmAction(secondTab, 'hand', 1);
      await expect(secondTab.getByTestId('zone-modal')).toHaveCount(0);
      await closeStaleModal(owner);
      assertCleanAudit(secondAudit);
      await secondTab.close();

      const beforeRestartOwner = await snapshot(request, setup, 0);
      const beforeRestartViewer = await snapshot(request, setup, 1);
      await owner.reload();
      await expect(owner.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await expect(owner.getByTestId('zone-modal')).toHaveCount(0);
      await restartRuntime(request);
      await expect.poll(() => audits[0]!.frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), { timeout: 60_000 }).toBe(true);
      await expect.poll(async () => canonicalZones(await snapshot(request, setup, 0), ownerId), { timeout: 60_000 })
        .toEqual(canonicalZones(beforeRestartOwner, ownerId));
      expect(canonicalZones(await snapshot(request, setup, 1), ownerId)).toEqual(canonicalZones(beforeRestartViewer, ownerId));

      const responsiveCases = [
        { viewport: { width: 1600, height: 1000 }, state: 'normal' },
        { viewport: { width: 1180, height: 820 }, state: 'compact' },
        { viewport: { width: 900, height: 600 }, state: 'aggressive' },
        { viewport: { width: 650, height: 480 }, state: 'minimal' },
      ] as const;
      for (const scenario of responsiveCases) {
        await owner.setViewportSize(scenario.viewport);
        await expect(owner.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', scenario.state);
        await openTopView(owner, 5);
        await owner.locator('[data-testid="zone-modal"] [data-card-instance-id]').first().click();
        await expectWithinViewport(owner, owner.getByTestId('zone-modal-batch-toolbar'));
        const actionTestIds = [
          'zone-modal-action-hand',
          'zone-modal-action-battlefield-face-up',
          'zone-modal-action-battlefield-face-down',
          'zone-modal-action-graveyard',
          'zone-modal-action-exile',
          'zone-modal-action-library-top',
          'zone-modal-action-library-bottom',
          'zone-modal-action-top-face-down',
        ] as const;
        const keyboardActionTestIds = [...actionTestIds].reverse();
        await owner.keyboard.press('Shift+Tab');
        for (const [actionIndex, actionTestId] of keyboardActionTestIds.entries()) {
          await test.step(`${scenario.state}: ${actionTestId} is keyboard reachable`, async () => {
            const action = owner.getByTestId(actionTestId);
            await expect(action).toBeFocused();
            await expectWithinViewport(owner, action);
            await expectEssentialTarget(action);
            if (actionIndex < keyboardActionTestIds.length - 1) await owner.keyboard.press('Shift+Tab');
          });
        }
        await owner.getByTestId('zone-modal-action-battlefield-face-down').click();
        await expect(owner.getByTestId('zone-modal-batch-confirmation')).toHaveAttribute('role', 'alertdialog');
        await expectWithinViewport(owner, owner.getByTestId('zone-modal-batch-confirmation'));
        await expectEssentialTarget(owner.getByTestId('zone-modal-batch-confirm'));
        await owner.keyboard.press('Escape');
        await expect(owner.getByTestId('zone-modal-batch-confirmation')).toHaveCount(0);
        await owner.getByTestId('zone-modal-close').click();
        await expect(owner.getByTestId('zone-modal')).toHaveCount(0);
        await expectNoGlobalOverflow(owner);
      }

      audits.forEach(assertCleanAudit);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });

  test('manual native Chrome zoom keeps the action and confirmation surfaces usable', async ({ browser, request, baseURL }) => {
    test.skip(process.env['E2E_MANUAL_LIBRARY_BATCH_ZOOM'] !== '1', 'Run headed and change native Chrome zoom to 80/100/125/150 when prompted.');
    test.setTimeout(20 * 60_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');

    const setup = await createGame(request, 3, `s4batchzoom${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
    const contexts = await createContexts(browser, baseURL, setup);
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    try {
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      const owner = pages[0]!;
      await expect(owner.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      const baselineDpr = await owner.evaluate(() => devicePixelRatio);
      for (const zoom of [80, 100, 125, 150]) {
        console.log(`NATIVE_LIBRARY_BATCH_ZOOM_ACTION zoom=${zoom}: set Chrome page zoom to ${zoom}%.`);
        await expect.poll(() => owner.evaluate((base) => devicePixelRatio / base, baselineDpr), { timeout: 180_000 }).toBeCloseTo(zoom / 100, 2);
        await openTopView(owner, 5);
        await owner.locator('[data-testid="zone-modal"] [data-card-instance-id]').first().click();
        await owner.getByTestId('zone-modal-action-battlefield-face-down').click();
        await expectWithinNativeViewport(owner, owner.getByTestId('zone-modal-batch-confirmation'));
        await owner.keyboard.press('Escape');
        await owner.getByTestId('zone-modal-close').click();
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function exerciseSelectedDestination(
  page: Page,
  request: APIRequestContext,
  setup: Setup,
  audit: BrowserAudit,
  ownerId: string,
  action: 'graveyard' | 'exile' | 'battlefield-face-up' | 'battlefield-face-down',
  destination: string,
  faceDown: boolean,
): Promise<string[]> {
  await openTopView(page, 5);
  const window = latestWindowContract(audit);
  const selected = window.instanceIds.slice(0, 2);
  await selectModalIds(page, selected);
  const before = await snapshot(request, setup, 0);
  await confirmAction(page, action, selected.length);
  const after = await snapshot(request, setup, 0);
  expect(Number(after['version'] ?? 0)).toBe(Number(before['version'] ?? 0) + 1);
  const cards = zoneCards(after, ownerId, destination).filter((card) => selected.includes(String(card['instanceId'] ?? '')));
  expect(cards).toHaveLength(selected.length);
  for (const card of cards) {
    expect(card['faceDown'] === true).toBe(faceDown);
    if (destination === 'battlefield') expectRatioPosition(card['position']);
  }
  return selected;
}

async function exerciseLibraryOrder(
  page: Page,
  request: APIRequestContext,
  setup: Setup,
  audit: BrowserAudit,
  ownerId: string,
  action: 'library-top' | 'library-bottom',
): Promise<void> {
  await openTopView(page, 5);
  const window = latestWindowContract(audit);
  const selected = [window.instanceIds[1]!, window.instanceIds[3]!];
  await selectModalIds(page, selected);
  await confirmAction(page, action, 2);
  const after = await snapshot(request, setup, 0);
  const topFirst = zoneIds(after, ownerId, 'library');
  if (action === 'library-top') expect(topFirst.slice(0, 2)).toEqual(selected);
  else expect(topFirst.slice(-2).reverse()).toEqual(selected);
}

async function confirmAction(page: Page, action: string, count: number): Promise<void> {
  await page.getByTestId(`zone-modal-action-${action}`).click();
  const confirmation = page.getByTestId('zone-modal-batch-confirmation');
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(String(count));
  await page.getByTestId('zone-modal-batch-confirm').click();
  await expect(page.getByTestId('zone-modal')).toHaveCount(0, { timeout: 30_000 });
}

async function confirmTopFaceDown(page: Page, count: number): Promise<void> {
  await page.getByTestId('zone-modal-action-top-face-down').click();
  await expect(page.getByTestId('zone-modal-batch-confirmation')).toContainText(String(count));
  await page.getByTestId('zone-modal-batch-confirm').click();
  await expect(page.getByTestId('zone-modal')).toHaveCount(0, { timeout: 30_000 });
}

async function selectModalIds(page: Page, ids: readonly string[]): Promise<void> {
  for (const instanceId of ids) {
    await page.locator(`[data-testid="zone-modal"] [data-card-instance-id="${instanceId}"]`).click();
  }
  await expect(page.locator('[data-testid="zone-modal"] [data-view-x-selected="true"]')).toHaveCount(ids.length);
}

async function openTopView(page: Page, count: number): Promise<void> {
  const library = ownerLibrary(page);
  await expect(library).toBeVisible();
  await library.focus();
  await library.click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: /^view$/i }).click();
  await expect(menu.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: /look at top x cards/i }).click();
  const number = page.getByTestId('number-action-input');
  await expect(number).toBeVisible();
  await number.fill(String(count));
  await page.getByTestId('number-action-confirm').click();
  await expect(page.getByTestId('zone-modal')).toHaveAttribute('data-lifecycle', 'ready', { timeout: 30_000 });
  await expect(page.locator('[data-testid="zone-modal"] [data-card-instance-id]')).toHaveCount(count);
}

function latestWindowContract(audit: BrowserAudit): WindowContract {
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

async function closeStaleModal(page: Page): Promise<void> {
  if (await page.getByTestId('zone-modal').count()) {
    await page.getByTestId('zone-modal-close').click();
    await expect(page.getByTestId('zone-modal')).toHaveCount(0);
  }
}

function ownerLibrary(page: Page): Locator {
  return page.locator('[data-testid="drop-zone"][data-zone="library"]').first();
}

async function modalCardIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid="zone-modal"] [data-card-instance-id]').evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset['cardInstanceId'] ?? ''),
  );
}

async function assertNoPrivateIdentity(pages: readonly Page[], audits: readonly BrowserAudit[], ids: readonly string[]): Promise<void> {
  for (let index = 0; index < pages.length; index += 1) {
    const serializedFrames = JSON.stringify(audits[index]!.frames);
    const body = await pages[index]!.locator('body').innerHTML();
    for (const instanceId of ids) {
      expect(serializedFrames).not.toContain(instanceId);
      expect(body).not.toContain(instanceId);
    }
  }
}

async function sendRuntimeRaw(request: APIRequestContext, setup: Setup, playerIndex: number, message: JsonObject): Promise<JsonObject> {
  const response = await request.post(`${API_BASE_URL}/games/${setup.gameId}/websocket-ticket`, { headers: auth(setup.players[playerIndex]!.token) });
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
      ownerToken: session.token, name: `s4c-${runId.slice(-8)}-${index}`, includeWhiteDfc: index === 0,
    });
    players.push({ ...session, deckId: deck.deckId });
  }
  const room = await request.post(`${API_BASE_URL}/rooms`, { headers: auth(players[0]!.token), data: {
    deckId: players[0]!.deckId, visibility: 'private', name: runId, format: 'commander',
    maxPlayers: playerCount, mulliganRule: 'LONDON', firstMulliganFree: true,
  } });
  await expectOk(room, 'create Sprint 4C room');
  const roomId = String(((await room.json()) as { room?: { id?: string } }).room?.id ?? '');
  for (const player of players.slice(1)) {
    await expectOk(await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, { headers: auth(player.token), data: { deckId: player.deckId } }), 'join Sprint 4C room');
  }
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const current = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: auth(players[0]!.token) });
    await expectOk(current, 'load Sprint 4C room');
    const entries = ((await current.json()) as { room?: { players?: Array<{ turnRolls?: number[] }> } }).room?.players ?? [];
    if (entries.length === playerCount && entries.every((entry) => entry.turnRolls?.length) && new Set(entries.map((entry) => entry.turnRolls?.join('-'))).size === playerCount) break;
    for (const player of players) {
      const roll = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: auth(player.token) });
      if (!roll.ok() && roll.status() !== 409) await expectOk(roll, 'roll Sprint 4C turn order');
    }
  }
  const started = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: auth(players[0]!.token) });
  await expectOk(started, 'start Sprint 4C game');
  const gameId = String(((await started.json()) as { game?: { id?: string } }).game?.id ?? '');
  if (!gameId) throw new Error('Sprint 4C game did not start.');
  return { gameId, players };
}

async function snapshot(request: APIRequestContext, setup: Setup, viewerIndex: number): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${setup.gameId}/snapshot`, { headers: auth(setup.players[viewerIndex]!.token) });
  await expectOk(response, 'load Sprint 4C snapshot');
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
    try { audit.frames.push(JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as JsonObject); } catch { /* ping */ }
  }));
  page.on('request', (request) => { if (/\/snapshot(?:\?|$)|\/bootstrap(?:\?|$)/.test(request.url())) audit.recoveryRequests.push(request.url()); });
  page.on('console', (message) => { if (message.type() === 'error') audit.errors.push(message.text()); });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  return audit;
}

function assertCleanAudit(audit: BrowserAudit): void {
  const serialized = JSON.stringify(audit.frames);
  expect(serialized).not.toMatch(/target_not_found|resync_required|recovery_required|Unknown Card/i);
  expect(audit.frames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
  expect(audit.errors.filter((error) => /target_not_found|resync_required|Unknown Card/i.test(error))).toEqual([]);
}

function zoneCards(state: JsonObject, playerId: string, zone: string): JsonObject[] {
  const player = ((state['players'] as Record<string, JsonObject> | undefined) ?? {})[playerId];
  return ((player?.['zones'] as Record<string, JsonObject[]> | undefined) ?? {})[zone] ?? [];
}

function zoneIds(state: JsonObject, playerId: string, zone: string): string[] {
  return zoneCards(state, playerId, zone).map((card) => String(card['instanceId'] ?? '')).filter(Boolean);
}

function canonicalZones(state: JsonObject, playerId: string): JsonObject {
  return Object.fromEntries(['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'].map((zone) => [
    zone,
    zoneCards(state, playerId, zone).map((card) => ({
      instanceId: card['instanceId'], faceDown: card['faceDown'] ?? false, position: card['position'] ?? null,
    })),
  ]));
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

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function expectOk(response: Pick<APIResponse, 'ok' | 'status' | 'text'>, action: string): Promise<void> {
  if (!response.ok()) throw new Error(`${action} failed (${response.status()}): ${await response.text()}`);
}
