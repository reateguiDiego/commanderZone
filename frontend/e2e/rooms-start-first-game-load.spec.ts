import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { createBasicCommanderDeckFromDatabase } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;

interface RouteResponseRecord {
  url: string;
  method: string;
  status: number;
  body: JsonObject | null;
}

interface FrameRecord {
  url: string;
  payload: JsonObject;
}

interface PageAudit {
  label: string;
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  serverErrors: string[];
  bootstrapResponses: RouteResponseRecord[];
  snapshotResponses: RouteResponseRecord[];
  websocketTicketResponses: RouteResponseRecord[];
  commandFallbackPosts: string[];
  sent: FrameRecord[];
  received: FrameRecord[];
  websocketErrors: string[];
  websocketCloses: string[];
}

interface StartEvidence {
  startResponse: RouteResponseRecord | null;
  gameId: string | null;
  roomPhase: string | null;
}

test('P57 start game renders first table load from rooms without manual refresh', async ({ browser, request, baseURL }, testInfo) => {
  test.setTimeout(240_000);

  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  await assertGameRuntimeReady(request);

  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const playerA = await createRealUserSession(request, `p57-owner-${suffix}`);
  const playerB = await createRealUserSession(request, `p57-guest-${suffix}`);
  const deckAName = `P57 A ${suffix.slice(-8)}`;
  const deckBName = `P57 B ${suffix.slice(-8)}`;
  const [deckA, deckB] = await Promise.all([
    createBasicCommanderDeckFromDatabase(request, {
      ownerToken: playerA.token,
      name: deckAName,
    }),
    createBasicCommanderDeckFromDatabase(request, {
      ownerToken: playerB.token,
      name: deckBName,
    }),
  ]);

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken),
  });
  await Promise.all([addRuntimeAuditInstrumentation(contextA), addRuntimeAuditInstrumentation(contextB)]);

  const roomName = `P57 Load ${suffix.slice(-8)}`;
  const evidence: StartEvidence = {
    startResponse: null,
    gameId: null,
    roomPhase: null,
  };
  let auditA: PageAudit | null = null;
  let auditB: PageAudit | null = null;

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    auditA = collectPageAudit(pageA, 'owner');
    auditB = collectPageAudit(pageB, 'guest');

    await pageA.goto('/rooms');
    await pageA.getByRole('button', { name: 'Create room' }).click();
    const createDialog = pageA.getByRole('dialog', { name: 'Create room' });
    await expect(createDialog).toBeVisible();
    await createDialog.locator('input[formcontrolname="roomName"]').fill(roomName);
    await createDialog.getByRole('button', { name: 'Set table size to 2 players' }).click();
    await createDialog.getByRole('button', { name: 'Create' }).click();

    await expect(pageA).toHaveURL(/\/rooms\/.+\/waiting$/);
    const roomId = await getRoomIdByName(request, playerA.token, roomName);

    await selectDeck(pageA, deckAName);
    await rollD20(pageA);

    await pageB.goto('/rooms');
    await pageB.getByPlaceholder('Search room').fill(roomName);
    await expect(pageB.locator('.list-row strong', { hasText: roomName }).first()).toBeVisible();
    await pageB.locator('.list-row', { has: pageB.locator('strong', { hasText: roomName }) }).first()
      .getByRole('button', { name: 'Join' })
      .click();

    await expect(pageB).toHaveURL(/\/rooms\/.+\/waiting$/);
    await selectDeck(pageB, deckBName);
    await rollD20(pageB);

    await expect.poll(async () => {
      const room = await getRoom(request, playerA.token, roomId);
      return room.players.length === 2 && room.players.every((player) => player.deckId !== null && player.turnRoll !== null);
    }, { timeout: 30_000 }).toBe(true);

    const [startResponse] = await Promise.all([
      waitForRouteResponse(pageA, (response) =>
        response.request().method() === 'POST' && response.url().includes(`/rooms/${roomId}/start`),
      ),
      pageA.getByRole('button', { name: 'Start' }).click(),
    ]);
    evidence.startResponse = startResponse;
    evidence.gameId = gameIdFromStartResponse(evidence.startResponse);
    if (!evidence.gameId) {
      throw new Error(`Start response did not include game id: ${JSON.stringify(evidence.startResponse)}`);
    }
    await expect(pageA).toHaveURL(new RegExp(`/games/${evidence.gameId}$`), { timeout: 30_000 });

    const roomAfterStart = await getRoom(request, playerA.token, roomId);
    evidence.roomPhase = roomAfterStart.gameId === evidence.gameId ? 'started_with_game_id' : 'started_without_game_id';
    expect(roomAfterStart.gameId).toBe(evidence.gameId);

    await expect(pageB).toHaveURL(new RegExp(`/games/${evidence.gameId}$`), { timeout: 30_000 });

    await Promise.all([
      expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
      expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
      expect(pageA.getByTestId('mulligan-overlay')).toBeVisible({ timeout: 30_000 }),
      expect(pageB.getByTestId('mulligan-overlay')).toBeVisible({ timeout: 30_000 }),
      expect(pageA.getByTestId('mulligan-keep')).toBeEnabled({ timeout: 30_000 }),
      expect(pageB.getByTestId('mulligan-keep')).toBeEnabled({ timeout: 30_000 }),
    ]);

    await Promise.all([
      waitForBootstrap(auditA, evidence.gameId, 'owner'),
      waitForBootstrap(auditB, evidence.gameId, 'guest'),
      waitForRuntimeTicket(auditA, evidence.gameId, 'owner'),
      waitForRuntimeTicket(auditB, evidence.gameId, 'guest'),
      waitForGameplayConnection(auditA, 'owner'),
      waitForGameplayConnection(auditB, 'guest'),
    ]);

    const keepStart = auditA.sent.length;
    const keepPatchStart = auditA.received.length;
    await pageA.getByTestId('mulligan-keep').click();
    const keepFrame = await waitForSentFrame(auditA, keepStart, (frame) => frame['kind'] === 'mulligan.keep');
    await waitForPatchAfter(auditA, keepPatchStart, (patch) =>
      patch['ackClientActionId'] === keepFrame['messageId'] && hasOp(patch, 'mulligan.status.set'),
    );
    await expect(pageA.getByTestId('mulligan-ready-panel')).toBeVisible({ timeout: 30_000 });

    await expectCleanFirstLoadAudit(pageA, auditA, evidence.gameId, 'owner');
    await expectCleanFirstLoadAudit(pageB, auditB, evidence.gameId, 'guest');
  } finally {
    await attachEvidence(testInfo, {
      evidence,
      owner: auditA,
      guest: auditB,
    });
    await Promise.all([
      contextA.close().catch(() => undefined),
      contextB.close().catch(() => undefined),
    ]);
  }
});

async function addRuntimeAuditInstrumentation(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');

    type AuditWindow = Window & {
      __commanderZoneRealtimeLogs?: Array<{ level: string; args: unknown[] }>;
    };
    const state = window as AuditWindow;
    state.__commanderZoneRealtimeLogs = [];

    const serialize = (value: unknown): unknown => {
      try {
        return JSON.parse(JSON.stringify(value)) as unknown;
      } catch {
        return String(value);
      }
    };

    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      const original = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        if (typeof args[0] === 'string' && args[0].startsWith('[CommanderZone gameplay')) {
          state.__commanderZoneRealtimeLogs?.push({ level, args: args.map(serialize) });
        }
        original(...args);
      };
    }
  });
}

function collectPageAudit(page: Page, label: string): PageAudit {
  const audit: PageAudit = {
    label,
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    serverErrors: [],
    bootstrapResponses: [],
    snapshotResponses: [],
    websocketTicketResponses: [],
    commandFallbackPosts: [],
    sent: [],
    received: [],
    websocketErrors: [],
    websocketCloses: [],
  };

  page.on('console', (message) => {
    if (message.type() === 'error') {
      audit.consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    audit.pageErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    audit.requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
  });
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'POST' && /\/games\/[^/]+\/commands$/.test(new URL(url).pathname)) {
      audit.commandFallbackPosts.push(url);
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    const url = response.url();
    const path = safePathname(url);
    if (request.method() === 'GET' && /\/games\/[^/]+\/bootstrap$/.test(path)) {
      void parseRouteResponse(response).then((record) => audit.bootstrapResponses.push(record)).catch(() => undefined);
    }
    if (request.method() === 'GET' && /\/games\/[^/]+\/snapshot$/.test(path)) {
      void parseRouteResponse(response).then((record) => audit.snapshotResponses.push(record)).catch(() => undefined);
    }
    if (request.method() === 'POST' && /\/games\/[^/]+\/websocket-ticket$/.test(path)) {
      void parseRouteResponse(response).then((record) => audit.websocketTicketResponses.push(record)).catch(() => undefined);
    }
    if (response.status() >= 500) {
      void response.text().then((body) => {
        audit.serverErrors.push(`${response.status()} ${url} ${body.slice(0, 500)}`);
      }).catch(() => {
        audit.serverErrors.push(`${response.status()} ${url}`);
      });
    }
  });
  page.on('websocket', (socket) => {
    socket.on('framesent', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) {
        audit.sent.push({ url: socket.url(), payload: parsed });
      }
    });
    socket.on('framereceived', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) {
        audit.received.push({ url: socket.url(), payload: parsed });
      }
    });
    socket.on('socketerror', (error) => {
      audit.websocketErrors.push(`${socket.url()} ${String(error)}`);
    });
    socket.on('close', () => {
      audit.websocketCloses.push(socket.url());
    });
  });

  return audit;
}

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 10_000 });
  if (!response.ok()) {
    throw new Error(`game-runtime is not ready at ${RUNTIME_READY_URL}: ${response.status()} ${await response.text()}`);
  }
}

async function getRoom(
  request: APIRequestContext,
  token: string,
  roomId: string,
): Promise<{ id: string; name: string; players: Array<{ id: string; deckId: string | null; turnRoll: number | null }>; gameId: string | null }> {
  const response = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  await expectApiOk(response, 'load room');
  const payload = (await response.json()) as { room: { id: string; name: string; players: Array<{ id: string; deckId: string | null; turnRoll: number | null }>; gameId: string | null } };

  return payload.room;
}

async function getRoomIdByName(
  request: APIRequestContext,
  token: string,
  roomName: string,
): Promise<string> {
  const response = await request.get(`${API_BASE_URL}/rooms?status=all`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  await expectApiOk(response, 'list rooms');
  const payload = (await response.json()) as { data: Array<{ id: string; name: string }> };
  const match = payload.data.find((room) => room.name === roomName);
  if (!match) {
    throw new Error(`Room not found for name "${roomName}".`);
  }

  return match.id;
}

async function rollD20(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Roll dice' })).toBeEnabled();
  await page.getByRole('button', { name: 'Roll dice' }).click();
  const modal = page.locator('app-modal').filter({ hasText: 'This roll sets your turn order' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Roll' }).click();
  await expect(page.locator('.roll-badge').first()).toContainText(/D20.*\d+/);
}

async function selectDeck(page: Page, deckName: string): Promise<void> {
  await page.getByRole('button', { name: 'Select a deck' }).click();
  await page.getByRole('option', { name: deckName }).click();
  await expect(page.getByText(deckName).first()).toBeVisible({ timeout: 30_000 });
}

async function waitForRouteResponse(page: Page, predicate: (response: APIResponse) => boolean): Promise<RouteResponseRecord> {
  const response = await page.waitForResponse(predicate, { timeout: 30_000 });
  return parseRouteResponse(response);
}

async function parseRouteResponse(response: APIResponse): Promise<RouteResponseRecord> {
  return {
    url: response.url(),
    method: response.request().method(),
    status: response.status(),
    body: await parseJsonResponse(response),
  };
}

async function parseJsonResponse(response: { json: () => Promise<unknown> }): Promise<JsonObject | null> {
  const payload = await response.json().catch(() => null);
  return isRecord(payload) ? payload : null;
}

function gameIdFromStartResponse(record: RouteResponseRecord | null): string | null {
  const game = record?.body?.['game'];
  if (!isRecord(game)) {
    return null;
  }
  const id = game['id'];

  return typeof id === 'string' && id.trim() !== '' ? id : null;
}

async function waitForBootstrap(audit: PageAudit, gameId: string, label: string): Promise<void> {
  await expect.poll(() => audit.bootstrapResponses.find((record) => record.url.includes(`/games/${gameId}/bootstrap`)) ?? null, {
    message: `missing bootstrap response for ${label}`,
    timeout: 30_000,
  }).not.toBeNull();
  const bootstrap = audit.bootstrapResponses.find((record) => record.url.includes(`/games/${gameId}/bootstrap`));
  expect(bootstrap?.status, JSON.stringify(bootstrap)).toBe(200);
  expect((bootstrap?.body?.['game'] as JsonObject | undefined)?.['version'], JSON.stringify(bootstrap?.body)).toBeGreaterThanOrEqual(1);
}

async function waitForRuntimeTicket(audit: PageAudit, gameId: string, label: string): Promise<void> {
  await expect.poll(() => audit.websocketTicketResponses.find((record) => record.url.includes(`/games/${gameId}/websocket-ticket`)) ?? null, {
    message: `missing websocket-ticket response for ${label}`,
    timeout: 30_000,
  }).not.toBeNull();
  const ticket = audit.websocketTicketResponses.find((record) => record.url.includes(`/games/${gameId}/websocket-ticket`));
  expect(ticket?.status, JSON.stringify(ticket)).toBe(200);
  expect(ticket?.body?.['route']).toBe('runtime_ws');
}

async function waitForGameplayConnection(audit: PageAudit, label: string): Promise<void> {
  await expect.poll(() => audit.received.some((frame) =>
    frame.payload['kind'] === 'connection_state' && frame.payload['status'] === 'connected',
  ), {
    message: `missing runtime connection_state for ${label}`,
    timeout: 30_000,
  }).toBe(true);
}

async function waitForSentFrame(
  audit: PageAudit,
  startIndex: number,
  predicate: (message: JsonObject) => boolean,
): Promise<JsonObject> {
  await expect.poll(() => audit.sent.slice(startIndex).find((frame) => predicate(frame.payload))?.payload ?? null, {
    timeout: 30_000,
  }).not.toBeNull();
  const frame = audit.sent.slice(startIndex).find((candidate) => predicate(candidate.payload))?.payload;
  if (!frame) {
    throw new Error(`Missing sent frame for ${audit.label}. Recent sent frames: ${JSON.stringify(audit.sent.slice(-8), null, 2)}`);
  }

  return frame;
}

async function waitForPatchAfter(
  audit: PageAudit,
  startIndex: number,
  predicate: (patch: JsonObject) => boolean,
): Promise<JsonObject> {
  await expect.poll(() => audit.received.slice(startIndex).find((frame) => frame.payload['kind'] === 'patch.v2' && predicate(frame.payload))?.payload ?? null, {
    timeout: 30_000,
  }).not.toBeNull();
  const patch = audit.received.slice(startIndex).find((frame) => frame.payload['kind'] === 'patch.v2' && predicate(frame.payload))?.payload;
  if (!patch) {
    throw new Error(`Missing patch.v2 for ${audit.label}. Recent received frames: ${JSON.stringify(audit.received.slice(-8), null, 2)}`);
  }

  return patch;
}

async function expectCleanFirstLoadAudit(page: Page, audit: PageAudit, gameId: string, label: string): Promise<void> {
  expect(audit.pageErrors, `${label} page errors`).toEqual([]);
  expect(audit.consoleErrors, `${label} console errors`).toEqual([]);
  expect(unexpectedRequestFailures(audit), `${label} request failures`).toEqual([]);
  expect(audit.serverErrors, `${label} server errors`).toEqual([]);
  expect(audit.websocketErrors, `${label} websocket errors`).toEqual([]);
  expect(audit.commandFallbackPosts.filter((url) => url.includes(`/games/${gameId}/commands`)), `${label} HTTP command fallback`).toEqual([]);

  const runtimeTickets = audit.websocketTicketResponses
    .filter((record) => record.url.includes(`/games/${gameId}/websocket-ticket`))
    .map((record) => record.body?.['route']);
  expect(runtimeTickets, `${label} websocket ticket routes`).not.toEqual([]);
  expect(runtimeTickets.every((route) => route === 'runtime_ws'), `${label} websocket ticket routes`).toBe(true);

  const bootstrapReloads = audit.bootstrapResponses.filter((record) => record.url.includes(`/games/${gameId}/bootstrap`));
  expect(bootstrapReloads.length, `${label} bootstrap count`).toBe(1);
  expect(audit.snapshotResponses.filter((record) => record.url.includes(`/games/${gameId}/snapshot`)), `${label} snapshot responses`).toEqual([]);

  const received = audit.received.map((frame) => frame.payload);
  expect(received.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required'), `${label} resync frames`).toBe(false);
  expect(JSON.stringify(received), `${label} invalid_operation/missing_state frames`).not.toMatch(/missing_state|invalid_operation|snapshot_reload|refetch_started/);

  const realtimeLogs = await realtimeLogPayloads(page);
  expect(JSON.stringify(realtimeLogs), `${label} realtime logs`).not.toMatch(/missing_state|invalid_operation|resync_required|snapshot_reload|refetch_started/);
}

function unexpectedRequestFailures(audit: PageAudit): string[] {
  return audit.requestFailures.filter((failure) => !isExpectedMercureNavigationAbort(failure));
}

function isExpectedMercureNavigationAbort(failure: string): boolean {
  return failure.includes('/.well-known/mercure?') && failure.includes('net::ERR_ABORTED');
}

async function realtimeLogPayloads(page: Page): Promise<JsonObject[]> {
  return page.evaluate(() => {
    const state = window as Window & { __commanderZoneRealtimeLogs?: Array<{ args: unknown[] }> };
    return (state.__commanderZoneRealtimeLogs ?? [])
      .map((entry) => entry.args[1])
      .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value));
  });
}

function hasOp(message: JsonObject, op: string): boolean {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];

  return ops.some((item) => item['op'] === op);
}

async function attachEvidence(testInfo: TestInfo, evidence: unknown): Promise<void> {
  await testInfo.attach('p57-first-load-evidence.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
}

async function expectApiOk(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) {
    return;
  }

  const body = await response.text();
  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${body}`);
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  try {
    const text = typeof payload === 'string' ? payload : payload.toString('utf8');
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
