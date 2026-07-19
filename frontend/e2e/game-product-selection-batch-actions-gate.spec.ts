import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
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

type JsonObject = Record<string, unknown>;
type Setup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;
type Audit = { received: JsonObject[]; sent: JsonObject[]; errors: string[]; recoveryRequests: number; recoveryUrls: string[] };

test.describe('selection batch action product gate', () => {
  test.describe.configure({ mode: 'serial' });
  let setup: Setup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertServicesReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `selection-batch-${Date.now().toString(36)}`,
      playerAPrefix: 'sba',
      playerBPrefix: 'sbb',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('executes each supported batch as one atomic command and keeps selection cleanup deterministic', async ({ browser, request, baseURL }) => {
    test.setTimeout(600_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const { gameId, playerA, playerB } = setup;
    const initial = await gameSnapshot(request, gameId, playerA.token);
    const ids = zoneCards(initial, playerA.user.id, 'library').slice(0, 8).map((card) => String(card['instanceId']));
    expect(ids).toHaveLength(8);
    const [first, second, third, target, equipment, moveOne, moveTwo, retained] = ids as [string, string, string, string, string, string, string, string];
    let version = Number(initial['version'] ?? 1);
    const accepted = async (type: string, payload: JsonObject): Promise<void> => {
      const outcome = await sendRuntimeCommand(request, { gameId, token: playerA.token, baseVersion: version, type, payload });
      version = outcome.version;
    };
    await accepted('cards.moved', { playerId: playerA.user.id, fromZone: 'library', toZone: 'battlefield', instanceIds: ids });
    await accepted('cards.position.changed', {
      playerId: playerA.user.id,
      zone: 'battlefield',
      positions: ids.map((instanceId, index) => ({
        instanceId,
        position: { x: 0.08 + (index % 4) * 0.23, y: index < 4 ? 0.18 : 0.68, unit: 'ratio' },
      })),
    });
    await accepted('attachment.created', { equipmentInstanceId: equipment, attachedToInstanceId: target });

    const contextA = await playerContext(browser, baseURL, setup.playerA);
    const contextB = await playerContext(browser, baseURL, setup.playerB);
    try {
      let pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      let auditA = createAudit(pageA, gameId);
      const auditB = createAudit(pageB, gameId);
      await Promise.all([pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
      await Promise.all([pageA, pageB].map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all([waitForConnection(auditA), waitForConnection(auditB)]);
      await Promise.all([focusPlayer(pageA, playerA.user.displayName), focusPlayer(pageB, playerA.user.displayName)]);
      const recoveryBaseline = auditA.recoveryRequests + auditB.recoveryRequests;

      await selectCards(pageA, playerA.user.id, [first, second, third]);
      await expect(pageA.getByTestId('selection-action-toolbar')).toBeVisible();
      await expect(pageA.getByTestId('selection-count')).toContainText('3');

      let commandBaseline = commandFrames(auditA.sent).length;
      let before = Number((await gameSnapshot(request, gameId, playerA.token))['version']);
      await pageA.getByTestId('selection-action-tap').click();
      await expect.poll(() => commandFrames(auditA.sent).length).toBe(commandBaseline + 1);
      expect(commandFrames(auditA.sent).at(-1)?.['type']).toBe('cards.tapped.set');
      await expect.poll(async () => Number((await gameSnapshot(request, gameId, playerA.token))['version'])).toBe(before + 1);
      await expect.poll(async () => selectedCardsState(await gameSnapshot(request, gameId, playerA.token), playerA.user.id, [first, second, third], 'tapped')).toEqual([true, true, true]);
      await expectSelectedIds(pageA, [first, second, third]);
      expect(auditA.recoveryRequests + auditB.recoveryRequests, 'tap recovery').toBe(recoveryBaseline);

      commandBaseline = commandFrames(auditA.sent).length;
      before += 1;
      await pageA.getByTestId('selection-action-untap').click();
      await expect.poll(() => commandFrames(auditA.sent).length).toBe(commandBaseline + 1);
      expect(commandFrames(auditA.sent).at(-1)?.['type']).toBe('cards.tapped.set');
      await expect.poll(async () => Number((await gameSnapshot(request, gameId, playerA.token))['version'])).toBe(before + 1);
      expect(auditA.recoveryRequests + auditB.recoveryRequests, 'untap recovery').toBe(recoveryBaseline);

      const unauthorizedFrameBaseline = auditB.received.length;
      commandBaseline = commandFrames(auditA.sent).length;
      await pageA.getByTestId('selection-action-faceDown').click();
      await confirmDialog(pageA);
      await expect.poll(() => commandFrames(auditA.sent).length).toBe(commandBaseline + 1);
      expect(commandFrames(auditA.sent).at(-1)?.['type']).toBe('cards.face_down.set');
      await expectSelectedIds(pageA, [first, second, third]);
      await expect.poll(() => auditB.received.length).toBeGreaterThan(unauthorizedFrameBaseline);
      const unauthorizedFaceDownFrames = JSON.stringify(auditB.received.slice(unauthorizedFrameBaseline));
      for (const realId of [first, second, third]) expect(unauthorizedFaceDownFrames).not.toContain(realId);
      expect(unauthorizedFaceDownFrames).not.toMatch(/cardKey|cardRef|printId|imageUris|oracleText/);
      expect(auditA.recoveryRequests + auditB.recoveryRequests, 'face-down recovery').toBe(recoveryBaseline);

      await pageA.getByTestId('selection-action-faceUp').click();
      await confirmDialog(pageA);
      await expectSelectedIds(pageA, [first, second, third]);
      expect(
        auditA.recoveryRequests + auditB.recoveryRequests,
        `face-up recovery: ${JSON.stringify({ a: auditA.recoveryUrls, b: auditB.recoveryUrls, errorsA: auditA.errors, errorsB: auditB.errors, recentA: auditA.received.slice(-4) })}`,
      ).toBe(recoveryBaseline);

      commandBaseline = commandFrames(auditA.sent).length;
      await pageA.getByTestId('selection-action-createStack').click();
      await confirmDialog(pageA);
      await expect.poll(() => commandFrames(auditA.sent).length).toBe(commandBaseline + 1);
      expect(commandFrames(auditA.sent).at(-1)?.['type']).toBe('battlefield.stack.created');
      await expect(pageA.getByTestId('selection-group-count')).toContainText('1');
      await expectSelectedIds(pageA, [first]);
      await expect.poll(async () => ((await gameSnapshot(request, gameId, playerA.token))['battlefieldStacks'] as JsonObject[] | undefined)?.length ?? 0).toBe(1);
      expect(auditA.recoveryRequests + auditB.recoveryRequests, 'stack-create recovery').toBe(recoveryBaseline);

      commandBaseline = commandFrames(auditA.sent).length;
      await pageA.getByTestId('selection-action-dissolveStack').click();
      await confirmDialog(pageA);
      await expect.poll(() => commandFrames(auditA.sent).length).toBe(commandBaseline + 1);
      expect(commandFrames(auditA.sent).at(-1)?.['type']).toBe('battlefield.stack.dissolved');
      await expectSelectedIds(pageA, [first]);
      await expect(pageA.getByTestId('selection-group-count')).toHaveCount(0);
      expect(auditA.recoveryRequests + auditB.recoveryRequests, 'stack-dissolve recovery').toBe(recoveryBaseline);

      await pageA.keyboard.press('Escape');
      await battlefieldCard(pageA, playerA.user.id, equipment).focus();
      await pageA.keyboard.press('Space');
      await expectSelectedIds(pageA, [equipment]);
      commandBaseline = commandFrames(auditA.sent).length;
      await pageA.getByTestId('selection-action-detach').click();
      await expect.poll(() => commandFrames(auditA.sent).length).toBe(commandBaseline + 1);
      expect(commandFrames(auditA.sent).at(-1)?.['type']).toBe('attachment.removed');
      await expectSelectedIds(pageA, [equipment]);
      await expect.poll(async () => ((await gameSnapshot(request, gameId, playerA.token))['attachments'] as JsonObject[] | undefined)?.length ?? 0).toBe(0);
      expect(auditA.recoveryRequests + auditB.recoveryRequests, 'detach recovery').toBe(recoveryBaseline);

      await pageA.keyboard.press('Escape');
      await selectCards(pageA, playerA.user.id, [moveOne, moveTwo]);
      commandBaseline = commandFrames(auditA.sent).length;
      await pageA.getByTestId('selection-action-move:graveyard').click();
      await confirmDialog(pageA);
      await expect.poll(() => commandFrames(auditA.sent).length).toBe(commandBaseline + 1);
      const moveFrame = commandFrames(auditA.sent).at(-1)!;
      expect(moveFrame['type']).toBe('cards.moved');
      expect(new Set(((moveFrame['payload'] as JsonObject)['instanceIds'] as string[]))).toEqual(new Set([moveOne, moveTwo]));
      await expectSelectedIds(pageA, []);
      await expect.poll(async () => zoneCards(await gameSnapshot(request, gameId, playerA.token), playerA.user.id, 'graveyard').map((card) => card['instanceId']).sort()).toEqual([moveOne, moveTwo].sort());
      expect(auditA.recoveryRequests + auditB.recoveryRequests, 'move recovery').toBe(recoveryBaseline);

      await focusPlayer(pageB, playerA.user.displayName);
      await expect(pageB.getByTestId('selection-action-toolbar')).toHaveCount(0);
      await expectSelectedIds(pageB, []);

      for (const [width, height, state] of [[1440, 900, 'normal'], [1100, 720, 'compact'], [820, 580, 'aggressive'], [600, 400, 'minimal']] as const) {
        await pageA.setViewportSize({ width, height });
        await expect(pageA.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', state);
        await battlefieldCard(pageA, playerA.user.id, retained).focus();
        await pageA.keyboard.press('Space');
        await expectSelectedIds(pageA, [retained]);
        await expect(pageA.getByTestId('selection-action-toolbar')).toBeInViewport();
        await pageA.keyboard.press('Escape');
      }

      await pageA.setViewportSize({ width: 1440, height: 900 });
      expect(auditA.recoveryRequests + auditB.recoveryRequests).toBe(recoveryBaseline);
      await selectCards(pageA, playerA.user.id, [retained]);
      const refreshRequestBaseline = auditA.recoveryRequests + auditB.recoveryRequests;
      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayer(pageA, playerA.user.displayName);
      await expectSelectedIds(pageA, []);
      expect(auditA.recoveryRequests + auditB.recoveryRequests).toBe(refreshRequestBaseline + 1);

      await pageA.close();
      pageA = await contextA.newPage();
      auditA = createAudit(pageA, gameId);
      await pageA.goto(`/games/${gameId}`);
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayer(pageA, playerA.user.displayName);
      await expectSelectedIds(pageA, []);
      const reconnectRequestBaseline = auditA.recoveryRequests;
      await selectCards(pageA, playerA.user.id, [retained]);
      await pageA.getByTestId('selection-action-tap').click();
      await expect.poll(async () => selectedCardsState(await gameSnapshot(request, gameId, playerA.token), playerA.user.id, [retained], 'tapped')).toEqual([true]);
      expect(auditA.recoveryRequests).toBe(reconnectRequestBaseline);

      assertNoRecoveryFailure([auditA, auditB]);
      expect(await pageA.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    } finally {
      await Promise.allSettled([contextA.close(), contextB.close()]);
    }
  });
});

async function playerContext(browser: Browser, baseURL: string, player: Setup['playerA']): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, player.user, player.refreshToken), viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(10_000);
  await context.addInitScript(() => window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1'));
  return context;
}

async function selectCards(page: Page, playerId: string, ids: readonly string[]): Promise<void> {
  for (let index = 0; index < ids.length; index += 1) {
    await battlefieldCard(page, playerId, ids[index]!).click(index === 0 ? {} : { modifiers: ['Control'] });
  }
  await expectSelectedIds(page, ids);
}

async function confirmDialog(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('button.primary-button').click();
  await expect(dialog).toHaveCount(0);
}

function createAudit(page: Page, gameId: string): Audit {
  const audit: Audit = { received: [], sent: [], errors: [], recoveryRequests: 0, recoveryUrls: [] };
  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => { const frame = parseFrame(event.payload); if (frame) audit.received.push(frame); });
    socket.on('framesent', (event) => { const frame = parseFrame(event.payload); if (frame) audit.sent.push(frame); });
  });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') audit.errors.push(message.text()); });
  page.on('request', (event) => {
    if (event.method() === 'GET' && /\/(snapshot|bootstrap)(?:\?|$)/.test(event.url()) && event.url().includes(`/games/${gameId}`)) {
      audit.recoveryRequests += 1;
      audit.recoveryUrls.push(event.url());
    }
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

function battlefieldCard(page: Page, playerId: string, instanceId: string) {
  return page.locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"]`).first()
    .locator(`[data-testid="game-card"][data-card-instance-id="${instanceId}"]`);
}

async function selectedIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid="game-card"][aria-selected="true"]').evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset['cardInstanceId'] ?? '').filter(Boolean));
}

async function expectSelectedIds(page: Page, expected: readonly string[]): Promise<void> {
  await expect.poll(async () => (await selectedIds(page)).toSorted(), { timeout: 10_000 }).toEqual([...expected].toSorted());
  expect(new Set(await selectedIds(page)).size).toBe(expected.length);
}

function selectedCardsState(snapshot: JsonObject, playerId: string, ids: readonly string[], field: string): unknown[] {
  const byId = new Map(zoneCards(snapshot, playerId, 'battlefield').map((card) => [String(card['instanceId']), card]));
  return ids.map((id) => byId.get(id)?.[field]);
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

function parseFrame(payload: string | Buffer): JsonObject | null {
  try {
    const value = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
  } catch {
    return null;
  }
}
