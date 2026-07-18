import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { focusPlayer } from './support/game-table';
import { sendRuntimeCommand } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const SERVICE_URLS = [
  `${API_BASE_URL}/healthz`, `${API_BASE_URL}/readyz`,
  process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz',
  process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz',
  process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz',
  process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz',
];
const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;
type Point = { x: number; y: number };
type Setup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;
type Audit = { received: JsonObject[]; sent: JsonObject[]; errors: string[]; recoveryRequests: number };

test.describe('selection relations and advanced input product gate', () => {
  test.describe.configure({ mode: 'serial' });
  let setup: Setup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertServicesReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `selection-relations-${Date.now().toString(36)}`,
      playerAPrefix: 'sra',
      playerBPrefix: 'srb',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('keeps touch, spatial focus, ranges and relation-group drag local and deterministic', async ({ browser, request, baseURL }) => {
    test.setTimeout(600_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const { gameId, playerA, playerB } = setup;
    const initial = await gameSnapshot(request, gameId, playerA.token);
    const libraryIds = zoneCards(initial, playerA.user.id, 'library').slice(0, 19).map((card) => String(card['instanceId']));
    expect(libraryIds).toHaveLength(19);
    const [navLeftId, navRightId, targetId, equipmentOneId, equipmentTwoId, overlapOneId, faceDownOverlapId,
      ...relationIds] = libraryIds;
    const stackFourIds = relationIds.slice(0, 4);
    const stackEightIds = relationIds.slice(4, 12);
    expect(stackFourIds).toHaveLength(4);
    expect(stackEightIds).toHaveLength(8);
    let stackFourId = '';
    let stackEightId = '';
    const visibleIds = [navLeftId, navRightId, targetId, equipmentOneId, equipmentTwoId, overlapOneId, faceDownOverlapId, stackFourIds[0]!, stackEightIds[0]!];
    const hiddenStackMemberIds = [...stackFourIds.slice(1), ...stackEightIds.slice(1)];
    let version = Number(initial['version'] ?? 1);
    const accepted = async (type: string, payload: JsonObject): Promise<void> => {
      const outcome = await sendRuntimeCommand(request, { gameId, token: playerA.token, baseVersion: version, type, payload });
      version = outcome.version;
    };

    await accepted('cards.moved', {
      playerId: playerA.user.id, fromZone: 'library', toZone: 'battlefield', instanceIds: libraryIds,
    });
    const fixedPositions = [
      [0.08, 0.14], [0.27, 0.14], [0.45, 0.18], [0.5, 0.12], [0.54, 0.1],
      [0.76, 0.2], [0.78, 0.22], [0.18, 0.68], [0.2, 0.66], [0.22, 0.64], [0.24, 0.62],
      [0.62, 0.7], [0.64, 0.68], [0.66, 0.66], [0.68, 0.64], [0.7, 0.62], [0.72, 0.6], [0.74, 0.58], [0.76, 0.56],
    ];
    await accepted('cards.position.changed', {
      playerId: playerA.user.id,
      zone: 'battlefield',
      positions: libraryIds.map((instanceId, index) => ({
        instanceId, position: { x: fixedPositions[index]![0], y: fixedPositions[index]![1], unit: 'ratio' },
      })),
    });
    await accepted('card.face_down.changed', { playerId: playerA.user.id, instanceId: faceDownOverlapId, faceDown: true });
    await accepted('attachment.created', { equipmentInstanceId: equipmentOneId, attachedToInstanceId: targetId });
    await accepted('attachment.created', { equipmentInstanceId: equipmentTwoId, attachedToInstanceId: targetId });
    await accepted('battlefield.stack.created', {
      orderedInstanceIds: stackFourIds, rootInstanceId: stackFourIds[0], stackKind: 'land',
    });
    await accepted('battlefield.stack.created', {
      orderedInstanceIds: stackEightIds, rootInstanceId: stackEightIds[0], stackKind: 'land',
    });
    const relationSnapshot = await gameSnapshot(request, gameId, playerA.token);
    const stacks = relationSnapshot['battlefieldStacks'] as JsonObject[] | undefined ?? [];
    stackFourId = String(stacks.find((stack) => stack['rootInstanceId'] === stackFourIds[0])?.['id'] ?? '');
    stackEightId = String(stacks.find((stack) => stack['rootInstanceId'] === stackEightIds[0])?.['id'] ?? '');
    expect(stackFourId).not.toBe('');
    expect(stackEightId).not.toBe('');

    const contextA = await playerContext(browser, baseURL, playerA);
    const contextB = await playerContext(browser, baseURL, playerB);
    try {
      let pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      let auditA = createAudit(pageA, gameId);
      const auditB = createAudit(pageB, gameId);
      await Promise.all([pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
      await Promise.all([pageA, pageB].map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all([waitForConnection(auditA), waitForConnection(auditB)]);
      await Promise.all([focusPlayer(pageA, playerA.user.displayName), focusPlayer(pageB, playerA.user.displayName)]);
      const liveRecoveryBaseline = auditA.recoveryRequests + auditB.recoveryRequests;

      await expect(battlefieldCards(pageA, playerA.user.id)).toHaveCount(19);
      for (const hiddenId of hiddenStackMemberIds) {
        await expect(battlefieldCard(pageA, playerA.user.id, hiddenId)).toHaveAttribute('data-selection-hidden', 'true');
      }
      await expect(battlefieldCard(pageB, playerA.user.id, faceDownOverlapId)).toHaveCount(0);
      expect(JSON.stringify(auditB.received)).not.toContain(faceDownOverlapId);

      const stackEightRoot = battlefieldCard(pageA, playerA.user.id, stackEightIds[0]!);
      await stackEightRoot.click();
      await expectSelectedIds(pageA, [stackEightIds[0]!]);
      await expect(pageA.getByTestId('selection-group-count')).toContainText('1');
      await expect(stackEightRoot).toHaveAttribute('data-selection-group-size', '8');
      await expect(stackEightRoot).toHaveClass(/group-selected/);
      await stackEightRoot.click({ button: 'right' });
      await pageA.getByTestId('select-stack-root-only').click();
      await expectSelectedIds(pageA, [stackEightIds[0]!]);
      await expect(pageA.getByTestId('selection-group-count')).toHaveCount(0);
      await stackEightRoot.click({ button: 'right' });
      await pageA.getByTestId('select-stack-group').click();
      await expect(pageA.getByTestId('selection-group-count')).toContainText('1');
      await pageA.keyboard.press('Escape');

      const root = battlefieldRoot(pageA, playerA.user.id);
      const directions = await emptyCornerDirections(pageA, playerA.user.id);
      const commandBaseline = commandFrames(auditA.sent).length;
      await pageA.getByTestId('touch-select-area-mode').click();
      await expect(pageA.getByTestId('touch-select-area-mode')).toHaveAttribute('aria-pressed', 'true');
      await touchDrag(pageA, directions[0]![0], directions[0]![1]);
      await expect(pageA.getByTestId('touch-select-area-mode')).toHaveAttribute('aria-pressed', 'false');
      await expectSelectedIds(pageA, visibleIds);
      await expect(pageA.getByTestId('selection-group-count')).toContainText('2');
      expect((await selectedIds(pageA)).some((id) => hiddenStackMemberIds.includes(id))).toBe(false);
      expect(commandFrames(auditA.sent)).toHaveLength(commandBaseline);

      await pageA.keyboard.press('Escape');
      const left = battlefieldCard(pageA, playerA.user.id, navLeftId);
      await left.focus();
      await pageA.keyboard.press('ArrowRight');
      await expect.poll(() => activeCardId(pageA)).toBe(navRightId);
      for (let index = 0; index < 49; index += 1) {
        const moveLeft = await activeCardId(pageA) === navRightId;
        await pageA.keyboard.press(moveLeft ? 'ArrowLeft' : 'ArrowRight');
        await expect.poll(() => activeCardId(pageA)).toBe(moveLeft ? navLeftId : navRightId);
      }
      await expect.poll(async () => Number(await pageA.getByTestId('game-screen').getAttribute('data-spatial-navigation-steps'))).toBe(50);
      expect(Number(await pageA.getByTestId('game-screen').getAttribute('data-spatial-navigation-last-ms'))).toBeGreaterThanOrEqual(0);
      expect(await activeCardId(pageA)).toBeTruthy();

      const handArea = pageA.locator(`[data-testid="hand-area"][data-player-id="${playerA.user.id}"]`);
      await pageA.mouse.move(0, 0);
      if (!(await handArea.evaluate((element) => element.classList.contains('hand-revealed')))) {
        try {
          await handArea.locator('.hand-hover-strip').hover();
        } catch (error) {
          if (!(await handArea.evaluate((element) => element.classList.contains('hand-revealed')))) throw error;
        }
      }
      await expect(handArea).toHaveClass(/hand-revealed/);
      const hand = handCards(pageA, playerA.user.id);
      expect(await hand.count()).toBeGreaterThanOrEqual(4);
      const handRangeIds = await hand.evaluateAll((elements) => elements.slice(0, 4).map((element) => (element as HTMLElement).dataset['cardInstanceId']!));
      await hand.nth(0).click();
      await hand.nth(3).click({ modifiers: ['Shift'] });
      await expectSelectedIds(pageA, handRangeIds);
      await pageA.keyboard.press('Escape');

      await stackEightRoot.click();
      await battlefieldCard(pageA, playerA.user.id, navLeftId).click({ modifiers: ['Control'] });
      const commandsBeforeMixedDrag = commandFrames(auditA.sent).length;
      await dragCardBy(pageA, stackEightRoot, 52, -18);
      await expect.poll(() => commandFrames(auditA.sent).length, { timeout: 20_000 }).toBe(commandsBeforeMixedDrag + 1);
      const mixedFrame = commandFrames(auditA.sent).at(-1)!;
      const mixedJson = JSON.stringify(mixedFrame);
      expect(mixedJson).toContain(stackEightIds[0]!);
      expect(mixedJson).toContain(navLeftId);
      for (const hiddenId of stackEightIds.slice(1)) expect(mixedJson).not.toContain(hiddenId);
      await expect.poll(async () => Number((await gameSnapshot(request, gameId, playerA.token))['version']), { timeout: 20_000 }).toBeGreaterThan(version);
      version = Number((await gameSnapshot(request, gameId, playerA.token))['version']);
      await expectSelectedIds(pageA, [stackEightIds[0]!, navLeftId]);

      await pageA.keyboard.press('Escape');
      await battlefieldCard(pageA, playerA.user.id, equipmentOneId).focus();
      await pageA.keyboard.press('Space');
      await expectSelectedIds(pageA, [equipmentOneId]);
      await accepted('attachment.removed', {
        equipmentInstanceId: equipmentOneId, position: { x: 0.55, y: 0.32, unit: 'ratio' },
      });
      await expectSelectedIds(pageA, [equipmentOneId]);
      await pageA.keyboard.press('Escape');

      await battlefieldCard(pageA, playerA.user.id, stackFourIds[0]!).click();
      await expect(pageA.getByTestId('selection-group-count')).toContainText('1');
      await accepted('battlefield.stack.dissolved', {
        stackId: stackFourId,
        positions: stackFourIds.map((instanceId, index) => ({ instanceId, position: { x: 0.12 + index * 0.08, y: 0.7, unit: 'ratio' } })),
      });
      await expectSelectedIds(pageA, []);
      await expect(pageA.getByTestId('selection-group-count')).toHaveCount(0);

      await battlefieldCard(pageA, playerA.user.id, navRightId).click();
      await accepted('card.controller.changed', {
        playerId: playerA.user.id, instanceId: navRightId, targetPlayerId: playerB.user.id,
      });
      await expectSelectedIds(pageA, []);

      await focusPlayer(pageB, playerA.user.displayName);
      await expect(pageB.getByTestId('touch-select-area-mode')).toBeDisabled();
      await expect(battlefieldRoot(pageB, playerA.user.id)).not.toHaveAttribute('tabindex', '0');
      await expectSelectedIds(pageB, []);

      for (const [width, height, state] of [[1440, 900, 'normal'], [1100, 720, 'compact'], [820, 580, 'aggressive'], [600, 400, 'minimal']] as const) {
        await pageA.setViewportSize({ width, height });
        await expect(pageA.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', state);
        await expect(pageA.getByTestId('touch-select-area-mode')).toBeVisible();
      }
      await pageA.setViewportSize({ width: 1440, height: 900 });
      await pageA.getByTestId('touch-select-area-mode').click();
      await pageA.setViewportSize({ width: 1100, height: 720 });
      await expect(pageA.getByTestId('touch-select-area-mode')).toHaveAttribute('aria-pressed', 'false');
      await expect(root).toHaveAttribute('data-selection-interaction', 'idle');
      await pageA.setViewportSize({ width: 1440, height: 900 });

      expect(auditA.recoveryRequests + auditB.recoveryRequests).toBe(liveRecoveryBaseline);
      const opponentRecoveryBaseline = auditB.recoveryRequests;
      await battlefieldCard(pageA, playerA.user.id, stackEightIds[0]!).click();
      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayer(pageA, playerA.user.displayName);
      await expectSelectedIds(pageA, []);

      await pageA.close();
      pageA = await contextA.newPage();
      auditA = createAudit(pageA, gameId);
      await pageA.goto(`/games/${gameId}`);
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForConnection(auditA);
      await focusPlayer(pageA, playerA.user.displayName);
      await expectSelectedIds(pageA, []);

      await battlefieldCard(pageA, playerA.user.id, stackEightIds[0]!).click();
      const reconnectRecoveryBaseline = auditA.recoveryRequests;
      await restartRuntime();
      await assertServicesReady(request);
      await expect.poll(() => connectionCount(auditA), { timeout: 60_000 }).toBeGreaterThan(1);
      await expectSelectedIds(pageA, []);
      expect(auditA.recoveryRequests).toBe(reconnectRecoveryBaseline);

      await battlefieldCard(pageA, playerA.user.id, stackEightIds[0]!).click();
      await pageA.keyboard.press('t');
      await expect(battlefieldCard(pageA, playerA.user.id, stackEightIds[0]!)).toHaveClass(/tapped/, { timeout: 20_000 });

      expect(auditB.recoveryRequests).toBe(opponentRecoveryBaseline);
      assertNoRecoveryFailure([auditA, auditB]);
      expect(await pageA.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    } finally {
      await Promise.allSettled([contextA.close(), contextB.close()]);
    }
  });

  test('manual native browser zoom keeps advanced selection usable at 80/100/125/150 percent', async () => {
    test.skip(process.env['E2E_MANUAL_SELECTION_ZOOM'] !== '1', 'Run headed with E2E_MANUAL_SELECTION_ZOOM=1 for native browser zoom QA.');
  });
});

async function playerContext(browser: Browser, baseURL: string, player: Setup['playerA']): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, player.user, player.refreshToken),
    viewport: { width: 1440, height: 900 },
  });
  context.setDefaultTimeout(10_000);
  await context.addInitScript(() => window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1'));
  return context;
}

function createAudit(page: Page, gameId: string): Audit {
  const audit: Audit = { received: [], sent: [], errors: [], recoveryRequests: 0 };
  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => { const frame = parseFrame(event.payload); if (frame) audit.received.push(frame); });
    socket.on('framesent', (event) => { const frame = parseFrame(event.payload); if (frame) audit.sent.push(frame); });
  });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') audit.errors.push(message.text()); });
  page.on('request', (event) => {
    if (event.method() === 'GET' && /\/(snapshot|bootstrap)(?:\?|$)/.test(event.url()) && event.url().includes(`/games/${gameId}`)) audit.recoveryRequests += 1;
  });
  return audit;
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { game?: { snapshot?: JsonObject } }).game?.snapshot ?? {};
}

function zoneCards(snapshot: JsonObject, playerId: string, zone: string): JsonObject[] {
  return ((snapshot['players'] as Record<string, JsonObject> | undefined)?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined)?.[zone] ?? [];
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

function handCards(page: Page, playerId: string): Locator {
  return page.locator(`[data-testid="hand-area"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="hand"]`);
}

async function selectedIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid="game-card"][aria-selected="true"]').evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset['cardInstanceId'] ?? '').filter(Boolean));
}

async function expectSelectedIds(page: Page, expected: readonly string[]): Promise<void> {
  await expect.poll(async () => (await selectedIds(page)).toSorted(), { timeout: 10_000 }).toEqual([...expected].toSorted());
  expect(new Set(await selectedIds(page)).size).toBe(expected.length);
}

async function activeCardId(page: Page): Promise<string | null> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset['cardInstanceId'] ?? null);
}

async function emptyCornerDirections(page: Page, playerId: string): Promise<Array<[Point, Point]>> {
  const points = await battlefieldRoot(page, playerId).evaluate((element) => {
    const root = element as HTMLElement;
    const rect = root.getBoundingClientRect();
    const empty: Point[] = [];
    for (let row = 1; row < 20; row += 1) for (let column = 1; column < 20; column += 1) {
      const point = { x: rect.left + rect.width * column / 20, y: rect.top + rect.height * row / 20 };
      if (document.elementFromPoint(point.x, point.y) === root) empty.push(point);
    }
    const pick = (score: (point: Point) => number) => empty.toSorted((left, right) => score(left) - score(right))[0]!;
    return { topLeft: pick((point) => point.x + point.y), bottomRight: pick((point) => -point.x - point.y) };
  });
  return [[points.topLeft, points.bottomRight], [points.bottomRight, points.topLeft]];
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

function commandFrames(frames: readonly JsonObject[]): JsonObject[] {
  return frames.filter((frame) => frame['kind'] === 'command.v2' || frame['kind'] === 'command');
}

function connectionCount(audit: Audit): number {
  return audit.received.filter((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected').length;
}

async function waitForConnection(audit: Audit): Promise<void> {
  await expect.poll(() => connectionCount(audit), { timeout: 20_000 }).toBeGreaterThan(0);
}

function assertNoRecoveryFailure(audits: readonly Audit[]): void {
  for (const audit of audits) {
    expect(audit.received.some((frame) => frame['kind'] === 'game_patch' || frame['kind'] === 'resync_required')).toBe(false);
    expect(JSON.stringify(audit.received)).not.toMatch(/target_not_found|unknown card/i);
    expect(audit.errors.filter((error) => /target_not_found|resync_required|fallback|unknown card/i.test(error))).toEqual([]);
  }
}

async function assertServicesReady(request: APIRequestContext): Promise<void> {
  await Promise.all(SERVICE_URLS.map(async (url) => expect.poll(async () => {
    try { return (await request.get(url, { timeout: 10_000 })).ok(); } catch { return false; }
  }, { timeout: 60_000, message: `${url} did not become ready` }).toBe(true)));
}

async function restartRuntime(): Promise<void> {
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], {
    cwd: resolve(process.cwd(), '..'), timeout: 60_000, windowsHide: true,
  });
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  try {
    const value = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
  } catch {
    return null;
  }
}
