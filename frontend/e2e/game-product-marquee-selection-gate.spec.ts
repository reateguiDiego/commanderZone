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
  `${API_BASE_URL}/healthz`,
  `${API_BASE_URL}/readyz`,
  process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz',
  process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz',
  process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz',
  process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz',
];
const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;
type Setup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;
type Audit = {
  received: JsonObject[];
  sent: JsonObject[];
  errors: string[];
  recoveryRequests: number;
};
type Point = { x: number; y: number };

test.describe('marquee selection product gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: Setup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertServicesReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `marquee${Date.now().toString(36)}`,
      playerAPrefix: 'mqa',
      playerBPrefix: 'mqb',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('keeps selection local, deterministic and command-free across marquee, pruning and recovery boundaries', async ({ browser, request, baseURL }) => {
    test.setTimeout(600_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const { gameId, playerA, playerB } = setup;
    const initial = await gameSnapshot(request, gameId, playerA.token);
    const hand = zoneCards(initial, playerA.user.id, 'hand');
    const command = zoneCards(initial, playerA.user.id, 'command');
    const sources = [
      ...hand.slice(0, 7).map((card) => ({ instanceId: String(card['instanceId']), fromZone: 'hand' })),
      ...command.slice(0, 1).map((card) => ({ instanceId: String(card['instanceId']), fromZone: 'command' })),
    ];
    expect(sources).toHaveLength(8);
    const ids = sources.map((source) => source.instanceId);
    const [targetId, attachmentOneId, attachmentTwoId, overlapOneId, overlapTwoId, stackRootId, stackMemberId, transferredId] = ids as [string, string, string, string, string, string, string, string];
    const positions = [
      [0.16, 0.22], [0.34, 0.22], [0.49, 0.22], [0.61, 0.25],
      [0.64, 0.28], [0.22, 0.68], [0.4, 0.68], [0.76, 0.68],
    ] as const;

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
      await Promise.all([
        focusPlayer(pageA, playerA.user.displayName),
        focusPlayer(pageB, playerA.user.displayName),
      ]);
      const liveRecoveryBaseline = auditA.recoveryRequests + auditB.recoveryRequests;
      let version = Math.max(1, Number(initial['version'] ?? 1));
      const accepted = async (token: string, type: string, payload: JsonObject): Promise<void> => {
        const outcome = await sendRuntimeCommand(request, { gameId, token, baseVersion: version, type, payload });
        version = outcome.version;
        await expect.poll(async () => Number((await gameSnapshot(request, gameId, playerA.token))['version']), { timeout: 20_000 }).toBe(version);
      };

      for (const [index, source] of sources.entries()) {
        await accepted(playerA.token, 'card.moved', {
          playerId: playerA.user.id,
          fromZone: source.fromZone,
          toZone: 'battlefield',
          instanceId: source.instanceId,
          position: { x: positions[index]![0], y: positions[index]![1], unit: 'ratio' },
          ...(source.instanceId === overlapTwoId ? { faceDown: true } : {}),
        });
      }
      await accepted(playerA.token, 'attachment.created', {
        equipmentInstanceId: attachmentOneId,
        attachedToInstanceId: targetId,
      });
      await accepted(playerA.token, 'attachment.created', {
        equipmentInstanceId: attachmentTwoId,
        attachedToInstanceId: targetId,
      });
      await accepted(playerA.token, 'battlefield.stack.created', {
        orderedInstanceIds: [stackRootId, stackMemberId],
        rootInstanceId: stackRootId,
        stackKind: 'land',
      });
      await expect.poll(() => battlefieldCards(pageA, playerA.user.id).count(), { timeout: 20_000 }).toBe(8);
      await expect(battlefieldCard(pageB, playerA.user.id, overlapTwoId)).toHaveCount(0);
      expect(JSON.stringify(auditB.received)).not.toContain(overlapTwoId);

      const graphBeforeSelection = relationGraph(await gameSnapshot(request, gameId, playerA.token));
      const versionBeforeSelection = version;
      const fullCandidates = [targetId, attachmentOneId, attachmentTwoId, overlapOneId, overlapTwoId, stackRootId];
      const directions = await emptyCornerDirections(pageA, playerA.user.id);
      for (const [start, end] of directions) {
        await dragMarquee(pageA, start, end);
        await expectSelectedIds(pageA, playerA.user.id, [...fullCandidates, transferredId]);
        await pageA.keyboard.press('Escape');
        await expectSelectedIds(pageA, playerA.user.id, []);
      }

      await battlefieldCard(pageA, playerA.user.id, stackRootId).click();
      await marqueeAround(pageA, playerA.user.id, [overlapOneId, overlapTwoId], 'Shift');
      await expectSelectedIds(pageA, playerA.user.id, [stackRootId, overlapOneId, overlapTwoId]);
      await marqueeAround(pageA, playerA.user.id, [overlapOneId, overlapTwoId], 'Control');
      await expectSelectedIds(pageA, playerA.user.id, [stackRootId]);

      const root = battlefieldRoot(pageA, playerA.user.id);
      await root.focus();
      await pageA.keyboard.press('Control+a');
      await expectSelectedIds(pageA, playerA.user.id, [...fullCandidates, transferredId]);
      await expect(pageA.getByTestId('selection-count')).toContainText('7');
      await pageA.getByTestId('clear-selection').click();
      await expectSelectedIds(pageA, playerA.user.id, []);

      const handRegion = pageA.locator(`[data-zone="hand"][data-player-id="${playerA.user.id}"]`).first();
      await handRegion.focus();
      await pageA.keyboard.press('Control+a');
      await expectSelectedIds(pageA, playerA.user.id, []);

      await battlefieldCard(pageA, playerA.user.id, stackRootId).click();
      const corners = await emptyCornerDirections(pageA, playerA.user.id);
      await pageA.mouse.move(corners[0]![0].x, corners[0]![0].y);
      await pageA.mouse.down();
      await pageA.mouse.move(corners[0]![1].x, corners[0]![1].y, { steps: 4 });
      await expect(pageA.getByTestId('marquee-selection-rect')).toBeVisible();
      await expect(pageA.locator(`[data-selection-interaction="marquee"]`)).toBeVisible();
      await pageA.keyboard.press('Escape');
      await expect(pageA.getByTestId('marquee-selection-rect')).toHaveCount(0);
      await pageA.mouse.up();
      await expectSelectedIds(pageA, playerA.user.id, [stackRootId]);
      await pageA.keyboard.press('Escape');
      await expectSelectedIds(pageA, playerA.user.id, []);

      await battlefieldCard(pageA, playerA.user.id, stackRootId).click();
      await pageA.mouse.move(corners[0]![0].x, corners[0]![0].y);
      await pageA.mouse.down();
      await pageA.mouse.move(corners[0]![1].x, corners[0]![1].y, { steps: 4 });
      await expect(pageA.getByTestId('marquee-selection-rect')).toBeVisible();
      await root.dispatchEvent('pointercancel');
      await expect(pageA.getByTestId('marquee-selection-rect')).toHaveCount(0);
      await pageA.mouse.up();
      await expectSelectedIds(pageA, playerA.user.id, [stackRootId]);
      await pageA.keyboard.press('Escape');

      await battlefieldCard(pageA, playerA.user.id, stackRootId).click();
      await pageA.mouse.move(corners[0]![0].x, corners[0]![0].y);
      await pageA.mouse.down();
      await pageA.mouse.move(corners[0]![1].x, corners[0]![1].y, { steps: 4 });
      await pageA.setViewportSize({ width: 1100, height: 760 });
      await expect(pageA.getByTestId('marquee-selection-rect')).toHaveCount(0);
      await pageA.mouse.up();
      await expectSelectedIds(pageA, playerA.user.id, [stackRootId]);
      await pageA.setViewportSize({ width: 1440, height: 900 });
      await pageA.keyboard.press('Escape');

      const commandCountBeforeGestures = commandFrames(auditA.sent).length;
      expect(commandFrames(auditA.sent)).toHaveLength(commandCountBeforeGestures);
      expect(Number((await gameSnapshot(request, gameId, playerA.token))['version'])).toBe(versionBeforeSelection);
      expect(relationGraph(await gameSnapshot(request, gameId, playerA.token))).toEqual(graphBeforeSelection);

      await battlefieldCard(pageA, playerA.user.id, stackRootId).click();
      await battlefieldCard(pageA, playerA.user.id, transferredId).click({ modifiers: ['Control'] });
      await accepted(playerA.token, 'card.controller.changed', {
        playerId: playerA.user.id,
        instanceId: transferredId,
        targetPlayerId: playerB.user.id,
      });
      await expectSelectedIds(pageA, playerA.user.id, [stackRootId]);
      await root.focus();
      await pageA.keyboard.press('Control+a');
      await expectSelectedIds(pageA, playerA.user.id, fullCandidates);

      await focusPlayer(pageB, playerA.user.displayName);
      const opponentRoot = battlefieldRoot(pageB, playerA.user.id);
      expect(await opponentRoot.getAttribute('tabindex')).toBeNull();
      const opponentDirections = await emptyCornerDirections(pageB, playerA.user.id);
      await dragMarquee(pageB, opponentDirections[0]![0], opponentDirections[0]![1]);
      await expect(pageB.getByTestId('marquee-selection-rect')).toHaveCount(0);
      await expectSelectedIds(pageB, playerA.user.id, []);

      await pageA.keyboard.press('Escape');
      await battlefieldCard(pageA, playerA.user.id, stackRootId).click();
      await battlefieldCard(pageA, playerA.user.id, overlapTwoId).click({ modifiers: ['Control'] });
      await accepted(playerA.token, 'card.moved', {
        playerId: playerA.user.id,
        fromZone: 'battlefield',
        toZone: 'hand',
        instanceId: overlapTwoId,
      });
      await expectSelectedIds(pageA, playerA.user.id, [stackRootId]);
      await handRegion.focus();
      await pageA.keyboard.press('Control+a');
      await expectSelectedIds(pageA, playerA.user.id, [overlapTwoId]);
      await accepted(playerA.token, 'card.moved', {
        playerId: playerA.user.id,
        fromZone: 'battlefield',
        toZone: 'hand',
        instanceId: overlapOneId,
      });
      await accepted(playerA.token, 'card.moved', {
        playerId: playerA.user.id,
        fromZone: 'battlefield',
        toZone: 'hand',
        instanceId: targetId,
      });
      await handRegion.focus();
      await pageA.keyboard.press('Control+a');
      await expectSelectedIds(pageA, playerA.user.id, [overlapOneId, overlapTwoId, targetId]);

      expect(version).toBeGreaterThan(versionBeforeSelection);
      expect(relationGraph(await gameSnapshot(request, gameId, playerA.token))).not.toEqual(graphBeforeSelection);
      expect(auditA.recoveryRequests + auditB.recoveryRequests).toBe(liveRecoveryBaseline);
      assertNoLegacyOrRecoveryFailure([auditA, auditB]);
      expect(await pageA.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      const denseSource = await gameSnapshot(request, gameId, playerA.token);
      const denseLibraryIds = zoneCards(denseSource, playerA.user.id, 'library').map((card) => String(card['instanceId']));
      const denseHandIds = zoneCards(denseSource, playerA.user.id, 'hand').map((card) => String(card['instanceId']));
      expect(denseLibraryIds).toHaveLength(92);
      expect(denseHandIds).toHaveLength(3);
      for (const instanceIds of [denseLibraryIds.slice(0, 46), denseLibraryIds.slice(46)]) {
        await accepted(playerA.token, 'cards.moved', {
          playerId: playerA.user.id,
          fromZone: 'library',
          toZone: 'battlefield',
          instanceIds,
        });
      }
      await accepted(playerA.token, 'cards.moved', {
        playerId: playerA.user.id,
        fromZone: 'hand',
        toZone: 'battlefield',
        instanceIds: denseHandIds,
      });
      await expect.poll(() => battlefieldCards(pageA, playerA.user.id).count(), { timeout: 30_000 }).toBe(100);

      const denseDirections = await emptyCornerDirections(pageA, playerA.user.id);
      const commandCountBeforeDenseGestures = commandFrames(auditA.sent).length;
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const [start, end] = denseDirections[iteration % denseDirections.length]!;
        await dragMarquee(pageA, start, end);
      }
      const denseMetrics = await root.evaluate((element) => ({
        boundsCaptures: Number((element as HTMLElement).dataset['marqueeBoundsCaptures'] ?? 0),
        layoutReads: Number((element as HTMLElement).dataset['marqueeLayoutReads'] ?? 0),
        pointerMoves: Number((element as HTMLElement).dataset['marqueePointerMoves'] ?? 0),
        rafUpdates: Number((element as HTMLElement).dataset['marqueeRafUpdates'] ?? 0),
        candidateCount: Number((element as HTMLElement).dataset['marqueeCandidateCount'] ?? 0),
        outcome: (element as HTMLElement).dataset['marqueeOutcome'],
      }));
      expect(denseMetrics).toMatchObject({ boundsCaptures: 1, layoutReads: 99, candidateCount: 98, outcome: 'commit' });
      expect(denseMetrics.rafUpdates).toBeLessThanOrEqual(denseMetrics.pointerMoves);
      expect(commandFrames(auditA.sent)).toHaveLength(commandCountBeforeDenseGestures);
      await pageA.keyboard.press('Escape');

      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayer(pageA, playerA.user.displayName);
      await expectSelectedIds(pageA, playerA.user.id, []);

      await pageA.close();
      pageA = await contextA.newPage();
      auditA = createAudit(pageA, gameId);
      await pageA.goto(`/games/${gameId}`);
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForConnection(auditA);
      await focusPlayer(pageA, playerA.user.displayName);
      await expectSelectedIds(pageA, playerA.user.id, []);

      await battlefieldCard(pageA, playerA.user.id, stackRootId).click();
      await restartRuntime();
      await assertServicesReady(request);
      await expect.poll(() => connectionCount(auditA), { timeout: 60_000 }).toBeGreaterThan(1);
      await expectSelectedIds(pageA, playerA.user.id, []);
      const final = await sendRuntimeCommand(request, {
        gameId,
        token: playerA.token,
        baseVersion: version,
        type: 'card.tapped',
        payload: { instanceId: stackRootId, tapped: true },
      });
      version = final.version;
      await expect(battlefieldCard(pageA, playerA.user.id, stackRootId)).toHaveClass(/tapped/, { timeout: 20_000 });
      assertNoLegacyOrRecoveryFailure([auditA, auditB]);
      expect(commandFrames(auditA.sent)).toEqual([]);
      void version;
    } finally {
      await Promise.allSettled([contextA.close(), contextB.close()]);
    }
  });

  test('keeps Space, Ctrl/Cmd+A, aria-selected and Escape scoped to the own battlefield', async ({ browser, request, baseURL }) => {
    test.setTimeout(120_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const { gameId, playerA } = setup;
    const refreshToken = await freshRefreshToken(request, playerA.credentials);
    const context = await playerContext(browser, baseURL, { ...playerA, refreshToken });
    try {
      const page = await context.newPage();
      await page.goto(`/games/${gameId}`);
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayer(page, playerA.user.displayName);

      const snapshot = await gameSnapshot(request, gameId, playerA.token);
      const actionableIds = zoneCards(snapshot, playerA.user.id, 'battlefield')
        .filter((card) => (card['controllerId'] ?? playerA.user.id) === playerA.user.id)
        .map((card) => String(card['instanceId']));
      let focusedCard: Locator | null = null;
      for (const instanceId of actionableIds) {
        const candidate = battlefieldCard(page, playerA.user.id, instanceId);
        if (await candidate.isVisible()) {
          focusedCard = candidate;
          break;
        }
      }
      expect(focusedCard).not.toBeNull();

      await focusedCard!.focus();
      await page.keyboard.press('Space');
      await expect(focusedCard!).toHaveAttribute('aria-selected', 'true');
      await expect(focusedCard!).toHaveAttribute('aria-pressed', 'true');

      await battlefieldRoot(page, playerA.user.id).focus();
      await page.keyboard.press('Control+a');
      const selected = await selectedIds(page);
      expect(selected.length).toBeGreaterThan(0);
      expect(selected.every((instanceId) => actionableIds.includes(instanceId))).toBe(true);
      await page.keyboard.press('Escape');
      await expectSelectedIds(page, playerA.user.id, []);
    } finally {
      await context.close();
    }
  });
});

async function playerContext(browser: Browser, baseURL: string, player: Setup['playerA']): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, player.user, player.refreshToken), viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(10_000);
  await context.addInitScript(() => window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1'));
  return context;
}

async function freshRefreshToken(request: APIRequestContext, credentials: Setup['playerA']['credentials']): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { email: credentials.email, password: credentials.password },
  });
  expect(response.ok()).toBe(true);
  const match = (response.headers()['set-cookie'] ?? '').match(/commanderzone\.refresh=([^;]+)/);
  if (!match?.[1]) throw new Error('Login did not issue a refresh token for the keyboard selection gate.');
  return match[1];
}

function createAudit(page: Page, gameId: string): Audit {
  const audit: Audit = { received: [], sent: [], errors: [], recoveryRequests: 0 };
  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => { const frame = parseFrame(event.payload); if (frame) audit.received.push(frame); });
    socket.on('framesent', (event) => { const frame = parseFrame(event.payload); if (frame) audit.sent.push(frame); });
  });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') audit.errors.push(message.text()); });
  page.on('request', (request) => {
    if (request.method() === 'GET' && /\/(snapshot|bootstrap)(?:\?|$)/.test(request.url()) && request.url().includes(`/games/${gameId}`)) {
      audit.recoveryRequests += 1;
    }
  });
  return audit;
}

async function waitForConnection(audit: Audit): Promise<void> {
  await expect.poll(() => connectionCount(audit), { timeout: 20_000 }).toBeGreaterThan(0);
}

function connectionCount(audit: Audit): number {
  return audit.received.filter((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected').length;
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { game?: { snapshot?: JsonObject } }).game?.snapshot ?? {};
}

function zoneCards(snapshot: JsonObject, playerId: string, zone: string): JsonObject[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return zones?.[zone] ?? [];
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

async function selectedIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid="game-card"][aria-selected="true"]').evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset['cardInstanceId'] ?? '').filter(Boolean),
  );
}

async function expectSelectedIds(page: Page, _playerId: string, expected: readonly string[]): Promise<void> {
  await expect.poll(async () => (await selectedIds(page)).toSorted(), { timeout: 10_000 }).toEqual([...expected].toSorted());
  const actual = await selectedIds(page);
  expect(new Set(actual).size).toBe(actual.length);
  expect(new Set(expected).size).toBe(expected.length);
}

async function emptyCornerDirections(page: Page, playerId: string): Promise<Array<[Point, Point]>> {
  const root = battlefieldRoot(page, playerId);
  const corners = await root.evaluate((element) => {
    const rootElement = element as HTMLElement;
    const rect = rootElement.getBoundingClientRect();
    const points: Array<{ x: number; y: number }> = [];
    for (let row = 1; row < 20; row += 1) {
      for (let column = 1; column < 20; column += 1) {
        const x = rect.left + rect.width * column / 20;
        const y = rect.top + rect.height * row / 20;
        if (document.elementFromPoint(x, y) === rootElement) points.push({ x, y });
      }
    }
    const pick = (score: (point: { x: number; y: number }) => number) => points.toSorted((left, right) => score(left) - score(right))[0];
    const result = {
      topLeft: pick((point) => point.x + point.y),
      topRight: pick((point) => -point.x + point.y),
      bottomLeft: pick((point) => point.x - point.y),
      bottomRight: pick((point) => -point.x - point.y),
    };
    if (Object.values(result).some((point) => !point)) throw new Error('Could not resolve empty battlefield corners.');
    return result as Record<'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight', { x: number; y: number }>;
  });
  return [
    [corners.topLeft, corners.bottomRight],
    [corners.topRight, corners.bottomLeft],
    [corners.bottomLeft, corners.topRight],
    [corners.bottomRight, corners.topLeft],
  ];
}

async function dragMarquee(page: Page, start: Point, end: Point, modifier?: 'Shift' | 'Control'): Promise<void> {
  if (modifier) await page.keyboard.down(modifier);
  try {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
  } finally {
    if (modifier) await page.keyboard.up(modifier);
  }
}

async function marqueeAround(page: Page, playerId: string, ids: readonly string[], modifier: 'Shift' | 'Control'): Promise<void> {
  const root = battlefieldRoot(page, playerId);
  const geometry = await root.evaluate((element, targetIds) => {
    const rootElement = element as HTMLElement;
    const rects = targetIds.map((id) => rootElement.querySelector<HTMLElement>(`[data-card-instance-id="${CSS.escape(id)}"]`)?.getBoundingClientRect()).filter(Boolean) as DOMRect[];
    const rootRect = rootElement.getBoundingClientRect();
    const bounds = {
      left: Math.max(rootRect.left + 2, Math.min(...rects.map((rect) => rect.left)) - 8),
      top: Math.max(rootRect.top + 2, Math.min(...rects.map((rect) => rect.top)) - 8),
      right: Math.min(rootRect.right - 2, Math.max(...rects.map((rect) => rect.right)) + 8),
      bottom: Math.min(rootRect.bottom - 2, Math.max(...rects.map((rect) => rect.bottom)) + 8),
    };
    const candidates = [
      { x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top },
      { x: bounds.left, y: bounds.bottom }, { x: bounds.right, y: bounds.bottom },
    ];
    const start = candidates.find((point) => document.elementFromPoint(point.x, point.y) === rootElement);
    if (!start) throw new Error('No empty point surrounds the requested marquee candidates.');
    const end = start.x === bounds.left
      ? { x: bounds.right, y: start.y === bounds.top ? bounds.bottom : bounds.top }
      : { x: bounds.left, y: start.y === bounds.top ? bounds.bottom : bounds.top };
    return { start, end };
  }, [...ids]);
  await dragMarquee(page, geometry.start, geometry.end, modifier);
}

function commandFrames(frames: readonly JsonObject[]): JsonObject[] {
  return frames.filter((frame) => frame['kind'] === 'command.v2' || frame['kind'] === 'command');
}

function relationGraph(snapshot: JsonObject): JsonObject {
  return {
    attachments: snapshot['attachments'] ?? [],
    battlefieldStacks: snapshot['battlefieldStacks'] ?? [],
  };
}

function assertNoLegacyOrRecoveryFailure(audits: readonly Audit[]): void {
  for (const audit of audits) {
    expect(audit.received.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
    expect(audit.received.some((frame) => frame['kind'] === 'resync_required')).toBe(false);
    expect(JSON.stringify(audit.received)).not.toMatch(/target_not_found|unknown card/i);
    expect(nonZeroNamedValues(audit.received, /fallback/i)).toEqual([]);
    expect(audit.errors.filter((error) => /target_not_found|resync_required|fallback|unknown card/i.test(error))).toEqual([]);
  }
}

function nonZeroNamedValues(value: unknown, keyPattern: RegExp, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => nonZeroNamedValues(entry, keyPattern, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value as JsonObject).flatMap(([key, entry]) => {
    const entryPath = path ? `${path}.${key}` : key;
    const ownFailure = keyPattern.test(key) && entry !== 0 && entry !== false && entry !== null && entry !== ''
      ? [`${entryPath}=${String(entry)}`]
      : [];
    return [...ownFailure, ...nonZeroNamedValues(entry, keyPattern, entryPath)];
  });
}

async function assertServicesReady(request: APIRequestContext): Promise<void> {
  await Promise.all(SERVICE_URLS.map(async (url) => expect.poll(async () => {
    try { return (await request.get(url, { timeout: 10_000 })).ok(); } catch { return false; }
  }, { timeout: 60_000, message: `${url} did not become ready` }).toBe(true)));
}

async function restartRuntime(): Promise<void> {
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], {
    cwd: resolve(process.cwd(), '..'),
    timeout: 60_000,
    windowsHide: true,
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
