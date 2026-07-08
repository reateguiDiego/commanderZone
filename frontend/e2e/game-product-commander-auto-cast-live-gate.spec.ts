import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const API_HEALTH_URL = process.env['E2E_API_HEALTH_URL'] ?? `${API_BASE_URL}/healthz`;
const API_READY_URL = process.env['E2E_API_READY_URL'] ?? `${API_BASE_URL}/readyz`;
const WEBSOCKET_HEALTH_URL = process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz';
const WEBSOCKET_READY_URL = process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz';
const RUNTIME_HEALTH_URL = process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type AuditFrame = { direction: 'sent' | 'received'; payload: JsonObject };
type Setup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;

test.describe('commander automatic cast live gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: Setup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await Promise.all([
      assertServiceReady(request, API_HEALTH_URL, 'api healthz'),
      assertServiceReady(request, API_READY_URL, 'api readyz'),
      assertServiceReady(request, WEBSOCKET_HEALTH_URL, 'websocket healthz'),
      assertServiceReady(request, WEBSOCKET_READY_URL, 'websocket readyz'),
      assertServiceReady(request, RUNTIME_HEALTH_URL, 'game-runtime healthz'),
      assertServiceReady(request, RUNTIME_READY_URL, 'game-runtime readyz'),
    ]);
    setup = await createCommanderGameWithBasicDecks(request, { runId: `cmdlive${Date.now().toString(36)}` });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('updates commander cast count live from 0 to 1 without reload or manual counter command', async ({ browser, request, baseURL }) => {
    test.setTimeout(300_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const { gameId, playerA } = setup;
    const initialSnapshot = await gameSnapshot(request, gameId, playerA.token);
    const commander = zoneCards(initialSnapshot, playerA.user.id, 'command').find((card) => card['isCommander'] === true)
      ?? zoneCards(initialSnapshot, playerA.user.id, 'command')[0];
    if (!commander) {
      throw new Error('Commander auto cast live gate requires a command-zone commander.');
    }
    const commanderId = String(commander['instanceId']);
    expect(commanderCastsFromSnapshot(initialSnapshot, commanderId)).toBe(0);

    const contextA = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken) });
    await enableFrontendGameplayV2(contextA);
    const reconnectContexts: BrowserContext[] = [];

    try {
      const pageA = await contextA.newPage();
      const auditA = collectWebSocketFrames(pageA);
      await pageA.goto(`/games/${gameId}`);
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(auditA);
      await focusPlayerById(pageA, playerA.user.id);

      await expect(commanderCastCount(pageA, playerA.user.id, commanderId)).toHaveText('0', { timeout: 15_000 });

      const commandZoneCard = pageA.locator(`[data-testid="command-zone-card"][data-player-id="${playerA.user.id}"][data-card-id="${commanderId}"]`).first();
      const battlefield = pageA.locator(`[data-testid="battlefield-zone"][data-player-id="${playerA.user.id}"]`).first();
      await expect(commandZoneCard).toBeVisible({ timeout: 15_000 });
      await expect(battlefield).toBeVisible({ timeout: 15_000 });

      const start = auditA.length;
      const moveCommand = await runAndCaptureCommand(auditA, 'card.moved', async () => {
        await dragWithPointer(pageA, commandZoneCard, battlefield);
      });
      const movePayload = moveCommand['payload'] as JsonObject;
      expect(movePayload['fromZone']).toBe('command');
      expect(movePayload['toZone']).toBe('battlefield');
      expect(movePayload['instanceId']).toBe(commanderId);

      const counterPatch = await waitForPatchAfter(auditA, start, (patch) => commanderCastsFromPatch(patch, commanderId) === 1);
      expect(commanderCastsFromPatch(counterPatch, commanderId)).toBe(1);
      await expect(battlefieldCard(pageA, commanderId)).toBeVisible({ timeout: 20_000 });
      await expect(commanderCastCount(pageA, playerA.user.id, commanderId)).toHaveText('1', { timeout: 20_000 });
      expect(auditA.slice(start).some((frame) =>
        frame.direction === 'sent' && frame.payload['kind'] === 'command.v2' && frame.payload['type'] === 'counter.changed',
      )).toBe(false);

      await expect.poll(async () => commanderCastsFromSnapshot(await gameSnapshot(request, gameId, playerA.token), commanderId), {
        timeout: 15_000,
      }).toBe(1);

      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayerById(pageA, playerA.user.id);
      await expect(commanderCastCount(pageA, playerA.user.id, commanderId)).toHaveText('1', { timeout: 20_000 });

      const reconnectContext = await browser.newContext({ baseURL, storageState: await contextA.storageState() });
      reconnectContexts.push(reconnectContext);
      await enableFrontendGameplayV2(reconnectContext);
      const reconnectPage = await reconnectContext.newPage();
      const reconnectAudit = collectWebSocketFrames(reconnectPage);
      await reconnectPage.goto(`/games/${gameId}`);
      await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(reconnectAudit);
      await focusPlayerById(reconnectPage, playerA.user.id);
      await expect(commanderCastCount(reconnectPage, playerA.user.id, commanderId)).toHaveText('1', { timeout: 20_000 });

      await assertNoUnknownCard(pageA);
      await assertNoFalseActionToast(pageA);
      assertNoRuntimeFallbackFrames([...auditA, ...reconnectAudit].map((frame) => frame.payload));
    } finally {
      await Promise.all([contextA, ...reconnectContexts].map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'load game snapshot');
  const payload = await response.json() as { game?: { snapshot?: JsonObject } };
  if (!payload.game?.snapshot) {
    throw new Error('Snapshot response did not include game.snapshot.');
  }
  return payload.game.snapshot;
}

function collectWebSocketFrames(page: Page): AuditFrame[] {
  const frames: AuditFrame[] = [];
  page.on('websocket', (socket) => {
    frames.push({ direction: 'received', payload: { kind: 'connection_open', url: socket.url() } });
    socket.on('framesent', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) {
        frames.push({ direction: 'sent', payload: parsed });
      }
    });
    socket.on('framereceived', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) {
        frames.push({ direction: 'received', payload: parsed });
      }
    });
  });
  return frames;
}

async function waitForGameplayConnection(audit: AuditFrame[]): Promise<void> {
  await expect.poll(() => audit.some((frame) =>
    frame.direction === 'received'
    && (frame.payload['kind'] === 'connection_open' || frame.payload['kind'] === 'connection_ready' || frame.payload['kind'] === 'patch.v2'),
  ), { timeout: 30_000 }).toBe(true);
}

async function runAndCaptureCommand(audit: AuditFrame[], type: string, action: () => Promise<void>): Promise<JsonObject> {
  const start = audit.length;
  await action();
  await expect.poll(() => audit.slice(start).find((frame) =>
    frame.direction === 'sent' && frame.payload['kind'] === 'command.v2' && frame.payload['type'] === type,
  )?.payload ?? null, { timeout: 20_000 }).not.toBeNull();
  const frame = audit.slice(start).find((candidate) =>
    candidate.direction === 'sent' && candidate.payload['kind'] === 'command.v2' && candidate.payload['type'] === type,
  );
  if (!frame) {
    throw new Error(`Missing sent command ${type}. Recent frames: ${JSON.stringify(audit.slice(-12), null, 2)}`);
  }
  return frame.payload;
}

async function waitForPatchAfter(audit: AuditFrame[], startIndex: number, predicate: (patch: JsonObject) => boolean): Promise<JsonObject> {
  await expect.poll(() => audit.slice(startIndex).find((frame) =>
    frame.direction === 'received' && frame.payload['kind'] === 'patch.v2' && predicate(frame.payload),
  )?.payload ?? null, { timeout: 30_000 }).not.toBeNull();
  const frame = audit.slice(startIndex).find((candidate) =>
    candidate.direction === 'received' && candidate.payload['kind'] === 'patch.v2' && predicate(candidate.payload),
  );
  if (!frame) {
    throw new Error(`Missing patch.v2. Recent frames: ${JSON.stringify(audit.slice(-12), null, 2)}`);
  }
  return frame.payload;
}

async function dragWithPointer(page: Page, source: Locator, target: Locator): Promise<void> {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('Cannot drag without source and target boxes.');
  }
  const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const end = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 8 });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function focusPlayerById(page: Page, playerId: string): Promise<void> {
  const panel = page.getByTestId('player-panel');
  if (await panel.getAttribute('data-player-id') === playerId) {
    return;
  }
  const thumb = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`).first();
  await expect(thumb).toBeVisible({ timeout: 10_000 });
  await thumb.click();
  await expect.poll(async () => panel.getAttribute('data-player-id'), { timeout: 5_000 }).toBe(playerId);
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.find((item) => item['op'] === op) ?? null;
}

function commanderCastsFromPatch(message: JsonObject, commanderId: string): number | null {
  const op = operation(message, 'game.counters.set');
  if (op?.['scope'] !== `commander:${commanderId}`) {
    return null;
  }
  const counters = op['counters'] as JsonObject | undefined;
  return Number(counters?.['casts'] ?? Number.NaN);
}

function commanderCastsFromSnapshot(snapshot: JsonObject, commanderId: string): number {
  const counters = snapshot['counters'] as JsonObject | undefined;
  const scoped = counters?.[`commander:${commanderId}`] as JsonObject | undefined;
  const legacy = counters?.['commanderCasts'] as JsonObject | undefined;
  return Number(scoped?.['casts'] ?? legacy?.[commanderId] ?? 0);
}

function zoneCards(snapshot: JsonObject, playerId: string, zone: string): JsonObject[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return zones?.[zone] ?? [];
}

function battlefieldCard(page: Page, instanceId: string): Locator {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-card-instance-id="${instanceId}"]`).first();
}

function commanderCastCount(page: Page, playerId: string, commanderId: string): Locator {
  return page.locator(`[data-testid="commander-cast-count"][data-player-id="${playerId}"][data-card-id="${commanderId}"]`).first();
}

async function assertNoUnknownCard(page: Page): Promise<void> {
  await expect(page.locator('body')).not.toContainText('Unknown Card', { timeout: 5_000 });
}

async function assertNoFalseActionToast(page: Page): Promise<void> {
  await expect(page.locator('.table-error', { hasText: /failed|could not|error/i })).toHaveCount(0);
}

function assertNoRuntimeFallbackFrames(frames: JsonObject[]): void {
  expect(frames.some((message) => message['kind'] === 'game_patch')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'command_failed')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'command_ack' && message['status'] === 'rejected')).toBe(false);
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  try {
    const text = typeof payload === 'string' ? payload : payload.toString('utf8');
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

async function assertServiceReady(request: APIRequestContext, url: string, label: string): Promise<void> {
  const response = await request.get(url, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`${label} is not reachable at ${url}. HTTP ${response.status()}: ${await response.text()}`);
  }
}

async function expectApiOk(response: { ok(): boolean; status(): number; text(): Promise<string> }, action: string): Promise<void> {
  if (response.ok()) {
    return;
  }
  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
