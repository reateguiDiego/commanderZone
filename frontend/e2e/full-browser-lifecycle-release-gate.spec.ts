import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks } from './support/commander-game';
import { drawMine, focusPlayer, readTableZoneCounts } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
const POLL_TIMEOUT = 30_000;

type JsonObject = Record<string, unknown>;

interface FrameRecord {
  url: string;
  payload: JsonObject;
}

interface LeaveRoomResponse {
  status: number;
  body: JsonObject | null;
}

interface PageAudit {
  label: string;
  sent: FrameRecord[];
  received: FrameRecord[];
  consoleErrors: string[];
  pageErrors: string[];
  commandFallbackPosts: number;
  snapshotReloads: number;
  websocketTicketRoutes: string[];
  websocketErrors: string[];
  unexpectedWebSocketCloses: string[];
  serverErrors: string[];
  leaveResponses: LeaveRoomResponse[];
}

interface RuntimeActionEvidence {
  commandTypes: string[];
  patchKinds: string[];
  concedePayload: JsonObject;
  leaveResponses: LeaveRoomResponse[];
  ticketRoutes: string[];
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

test('P52 full browser lifecycle release gate: runtime actions, UI concede, sequential rooms leave', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  await assertGameRuntimeReady(request);
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const setup = await createCommanderGameWithBasicDecks(request, {
    runId: `r${suffix.slice(-4)}`,
    playerAPrefix: 'p52a',
    playerBPrefix: 'p52b',
    roomVisibility: 'public',
  });
  const { gameId, roomId, playerA, playerB } = setup;

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken),
  });
  await Promise.all([addRuntimeAuditInstrumentation(contextA), addRuntimeAuditInstrumentation(contextB)]);

  let cleanupStarted = false;
  let pageALeftGameRoute = false;
  let pageBLeftGameRoute = false;

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const debugPage = await contextA.newPage();
    const auditA = collectPageAudit(pageA, 'owner', gameId, roomId, () => cleanupStarted || pageALeftGameRoute);
    const auditB = collectPageAudit(pageB, 'non-owner', gameId, roomId, () => cleanupStarted || pageBLeftGameRoute);
    const debugAudit = collectPageAudit(debugPage, 'debug', gameId, roomId, () => cleanupStarted);

    await Promise.all([
      gotoAuthenticatedRoute(pageA, `/games/${gameId}`, playerA.credentials),
      gotoAuthenticatedRoute(pageB, `/games/${gameId}`, playerB.credentials),
    ]);
    await gotoAuthenticatedRoute(debugPage, `/games/${gameId}/debug`, playerA.credentials);
    await Promise.all([
      expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
      expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
      expect(debugPage.locator('main.debug-page')).toBeVisible({ timeout: 30_000 }),
    ]);
    await Promise.all([
      waitForGameplayConnection(auditA),
      waitForGameplayConnection(auditB),
      waitForDebugHealth(debugAudit),
    ]);
    await Promise.all([
      expect.poll(() => auditA.websocketTicketRoutes.includes('runtime_ws'), { timeout: 10_000 }).toBe(true),
      expect.poll(() => auditB.websocketTicketRoutes.includes('runtime_ws'), { timeout: 10_000 }).toBe(true),
    ]);

    await resolveMulliganToPlayingInBrowser(pageA, pageB, auditA, auditB);
    await expect.poll(() => gamePhase(request, gameId, playerA.token), { timeout: POLL_TIMEOUT }).toBe('PLAYING');

    const baseline = await baselineAuditState(pageA, pageB, auditA, auditB, debugAudit);
    expectCleanRuntimeBaseline(baseline);
    const actionStartA = auditA.received.length;
    const actionStartB = auditB.received.length;

    await focusPlayer(pageB, playerB.user.displayName);
    const beforeDraw = await readTableZoneCounts(pageB, playerB.user.displayName);
    const drawCommand = await runAndCaptureCommand(auditB, 'library.draw', async () => {
      await drawMine(pageB);
    });
    await waitForAckPatch(auditB, drawCommand);
    await expect.poll(() => readTableZoneCounts(pageB, playerB.user.displayName), { timeout: POLL_TIMEOUT }).toEqual({
      hand: beforeDraw.hand + 1,
      library: beforeDraw.library - 1,
    });

    await focusPlayer(pageB, playerB.user.displayName);
    const moveCommand = await runAndCaptureCommand(auditB, 'card.moved', async () => {
      await moveFirstHandCardToBattlefield(pageB, playerB.user.id);
    });
    const movedInstanceId = String((moveCommand['payload'] as JsonObject | undefined)?.['instanceId'] ?? '');
    expect(movedInstanceId).not.toBe('');
    await waitForAckPatch(auditB, moveCommand, (patch) => hasOp(patch, 'zone.cards.add'));

    const tapCommand = await runAndCaptureCommand(auditB, 'card.tapped', async () => {
      const movedCard = pageB.locator(`[data-testid="battlefield-zone"][data-player-id="${playerB.user.id}"] [data-card-instance-id="${movedInstanceId}"]`);
      await expect(movedCard).toBeVisible({ timeout: POLL_TIMEOUT });
      await movedCard.dblclick();
      await expect(movedCard).toHaveClass(/tapped/, { timeout: POLL_TIMEOUT });
    });
    expect((tapCommand['payload'] as JsonObject | undefined)?.['instanceId']).toBe(movedInstanceId);
    await waitForAckPatch(auditB, tapCommand, (patch) => hasOp(patch, 'card.field.set'));

    const passTarget = await activeTurnPage(pageA, pageB, auditA, auditB);
    const passCommand = await runAndCaptureCommand(passTarget.audit, 'turn.changed', async () => {
      await passTarget.page.getByTestId('pass-turn').click();
    });
    await waitForAckPatch(passTarget.audit, passCommand, (patch) => hasOp(patch, 'turn.set'));

    const concedeCommand = await runAndCaptureCommand(auditB, 'game.concede', async () => {
      await clickGameMenuItem(pageB, 'game-menu-concede');
      const concedeDialog = pageB.getByRole('dialog', { name: 'Concede game?' });
      await expect(concedeDialog).toBeVisible({ timeout: POLL_TIMEOUT });
      await concedeDialog.getByRole('button', { name: /^Concede$/ }).click();
    });
    const concedePayload = (concedeCommand['payload'] as JsonObject | undefined) ?? {};
    expect(concedePayload).toMatchObject({ playerId: playerB.user.id });
    const concedePatch = await waitForAckPatch(auditB, concedeCommand, (patch) => hasOp(patch, 'player.status.set'));
    expect(JSON.stringify(concedePatch)).toContain(playerB.user.id);
    await waitForPatchAfter(auditA, actionStartA, (patch) => hasOp(patch, 'player.status.set') && JSON.stringify(patch).includes(playerB.user.id));
    await expect.poll(() => playerStatus(request, gameId, playerA.token, playerB.user.id), { timeout: POLL_TIMEOUT }).toBe('conceded');

    await assertNoUnexpectedRuntimeFallbackOrResync(pageA, pageB, auditA, auditB, debugAudit, baseline, actionStartA, actionStartB);

    pageBLeftGameRoute = true;
    await pageB.goto('/rooms');
    await expect(pageB.getByTestId('current-room-leave')).toBeVisible({ timeout: 30_000 });
    const playerLeaveResponsePromise = waitForLeaveResponse(pageB, roomId);
    await pageB.getByTestId('current-room-leave').click();
    const playerLeaveResponse = await playerLeaveResponsePromise;
    expect(playerLeaveResponse.status).toBe(200);
    expect(playerLeaveResponse.body).toMatchObject({ left: true, roomDeleted: false });

    pageALeftGameRoute = true;
    await pageA.goto('/rooms');
    await expect(pageA.getByTestId('current-room-leave')).toBeVisible({ timeout: 30_000 });
    const ownerLeaveResponsePromise = waitForLeaveResponse(pageA, roomId);
    await pageA.getByTestId('current-room-leave').click();
    const ownerLeaveResponse = await ownerLeaveResponsePromise;
    expect(ownerLeaveResponse.status, JSON.stringify(ownerLeaveResponse.body)).toBe(200);
    expect(ownerLeaveResponse.body).toMatchObject({ left: true, roomDeleted: true });
    await expect.poll(() => roomExists(request, roomId, playerA.token), { timeout: POLL_TIMEOUT }).toBe(false);

    expect([...auditA.serverErrors, ...auditB.serverErrors, ...debugAudit.serverErrors]).toEqual([]);
    expect([...auditA.websocketErrors, ...auditB.websocketErrors, ...debugAudit.websocketErrors]).toEqual([]);
    expect(relevantConsoleErrors(auditA, auditB, debugAudit)).toEqual([]);
    expect([...auditA.pageErrors, ...auditB.pageErrors, ...debugAudit.pageErrors]).toEqual([]);

    const evidence: RuntimeActionEvidence = {
      commandTypes: commandTypesAfter([auditA, auditB], 0),
      patchKinds: patchKindsAfter([auditA, auditB], 0),
      concedePayload,
      leaveResponses: [playerLeaveResponse, ownerLeaveResponse],
      ticketRoutes: [...auditA.websocketTicketRoutes, ...auditB.websocketTicketRoutes],
    };
    console.log(`[P52 evidence] ${JSON.stringify(evidence)}`);
  } finally {
    cleanupStarted = true;
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
      __commanderZoneBroadcastMessages?: unknown[];
    };
    const state = window as AuditWindow;
    state.__commanderZoneRealtimeLogs = [];
    state.__commanderZoneBroadcastMessages = [];

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

    const NativeBroadcastChannel = window.BroadcastChannel;
    if (NativeBroadcastChannel) {
      class AuditBroadcastChannel extends NativeBroadcastChannel {
        postMessage(message: unknown): void {
          state.__commanderZoneBroadcastMessages?.push(serialize(message));
          super.postMessage(message);
        }
      }
      window.BroadcastChannel = AuditBroadcastChannel as typeof BroadcastChannel;
    }
  });
}

function collectPageAudit(page: Page, label: string, gameId: string, roomId: string, allowWebSocketClose: () => boolean): PageAudit {
  const audit: PageAudit = {
    label,
    sent: [],
    received: [],
    consoleErrors: [],
    pageErrors: [],
    commandFallbackPosts: 0,
    snapshotReloads: 0,
    websocketTicketRoutes: [],
    websocketErrors: [],
    unexpectedWebSocketCloses: [],
    serverErrors: [],
    leaveResponses: [],
  };

  page.on('console', (message) => {
    if (message.type() === 'error') {
      audit.consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    audit.pageErrors.push(error.message);
  });
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'POST' && url.includes(`/games/${gameId}/commands`)) {
      audit.commandFallbackPosts += 1;
    }
    if (request.method() === 'GET' && (url.includes(`/games/${gameId}/snapshot`) || url.includes(`/games/${gameId}/bootstrap`))) {
      audit.snapshotReloads += 1;
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    const url = response.url();
    if (request.method() === 'POST' && url.includes(`/games/${gameId}/websocket-ticket`)) {
      void response.json().then((payload: unknown) => {
        if (isRecord(payload) && typeof payload['route'] === 'string') {
          audit.websocketTicketRoutes.push(payload['route']);
        }
      }).catch(() => undefined);
    }
    if (request.method() === 'POST' && url.includes(`/rooms/${roomId}/leave`)) {
      void parseJsonResponse(response).then((body) => {
        const entry = { status: response.status(), body };
        audit.leaveResponses.push(entry);
      }).catch(() => undefined);
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
    const socketKind = runtimeAuditSocketKind(socket.url(), gameId);
    if (socketKind === null) {
      return;
    }

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
      if (socketKind === 'runtime' && !allowWebSocketClose()) {
        audit.unexpectedWebSocketCloses.push(socket.url());
      }
    });
  });

  return audit;
}

function runtimeAuditSocketKind(url: string, gameId: string): 'runtime' | 'debug' | null {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/ws' || parsed.pathname.endsWith('/ws')) {
      return 'runtime';
    }
    if (parsed.pathname.includes(`/games/${gameId}/debug`)) {
      return 'debug';
    }
    return null;
  } catch {
    if (url.includes('/ws?')) {
      return 'runtime';
    }
    if (url.includes(`/games/${gameId}/debug`)) {
      return 'debug';
    }
    return null;
  }
}

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 10_000 });
  if (!response.ok()) {
    throw new Error(`game-runtime is not ready at ${RUNTIME_READY_URL}: ${response.status()} ${await response.text()}`);
  }
}

async function gotoAuthenticatedRoute(
  page: Page,
  route: string,
  credentials: { email: string; password: string },
): Promise<void> {
  const ready = route.includes('/debug')
    ? page.locator('main.debug-page')
    : page.getByTestId('game-screen');
  const authScreen = page.locator('main.auth-screen');

  await page.goto(route);
  const firstRouteState = await waitForRouteReadyOrAuth(ready, authScreen);
  if (firstRouteState === 'auth') {
    await loginThroughUi(page, credentials);
    await page.goto(route);
    await expect(ready).toBeVisible({ timeout: POLL_TIMEOUT });
  }
}

async function waitForRouteReadyOrAuth(ready: Locator, authScreen: Locator): Promise<'ready' | 'auth' | 'timeout'> {
  return Promise.race([
    ready.waitFor({ state: 'visible', timeout: POLL_TIMEOUT }).then(() => 'ready' as const).catch(() => 'timeout' as const),
    authScreen.waitFor({ state: 'visible', timeout: POLL_TIMEOUT }).then(() => 'auth' as const).catch(() => 'timeout' as const),
  ]);
}

async function loginThroughUi(page: Page, credentials: { email: string; password: string }): Promise<void> {
  const identifier = page.locator('input[formcontrolname="identifier"]');
  const password = page.locator('input[formcontrolname="password"]');
  await expect(identifier).toBeVisible({ timeout: POLL_TIMEOUT });
  await identifier.click();
  await identifier.fill(credentials.email);
  await password.click();
  await password.fill(credentials.password);
  await page.getByRole('button', { name: /^Login$/ }).click();
  await expect(page.locator('main.auth-screen')).toBeHidden({ timeout: POLL_TIMEOUT });
}

async function resolveMulliganToPlayingInBrowser(pageA: Page, pageB: Page, auditA: PageAudit, auditB: PageAudit): Promise<void> {
  await Promise.all([
    expect(pageA.getByTestId('mulligan-overlay')).toBeVisible({ timeout: 30_000 }),
    expect(pageB.getByTestId('mulligan-overlay')).toBeVisible({ timeout: 30_000 }),
    expect(pageA.getByTestId('mulligan-keep')).toBeEnabled({ timeout: 30_000 }),
    expect(pageB.getByTestId('mulligan-keep')).toBeEnabled({ timeout: 30_000 }),
  ]);

  const keepA = await runAndCaptureMulliganKeep(auditA, async () => {
    await pageA.getByTestId('mulligan-keep').click();
  });
  await waitForAckPatch(auditA, keepA, (patch) => hasOp(patch, 'mulligan.status.set'));
  await expect(pageA.getByTestId('mulligan-ready-panel')).toBeVisible({ timeout: 30_000 });

  const keepB = await runAndCaptureMulliganKeep(auditB, async () => {
    await pageB.getByTestId('mulligan-keep').click();
  });
  await waitForAckPatch(auditB, keepB, (patch) => hasOp(patch, 'mulligan.status.set'));
  await waitForPatchAfter(auditB, 0, (patch) => hasOp(patch, 'mulligan.completed') || hasOp(patch, 'game.phase.set'));
  await Promise.all([
    expect(pageA.getByTestId('mulligan-overlay')).toBeHidden({ timeout: 30_000 }),
    expect(pageB.getByTestId('mulligan-overlay')).toBeHidden({ timeout: 30_000 }),
  ]);
}

async function runAndCaptureMulliganKeep(audit: PageAudit, action: () => Promise<void>): Promise<JsonObject> {
  const sentStart = audit.sent.length;
  await action();
  return waitForSentFrame(audit, sentStart, (message) => message['kind'] === 'mulligan.keep');
}

async function runAndCaptureCommand(audit: PageAudit, type: string, action: () => Promise<void>): Promise<JsonObject> {
  const sentStart = audit.sent.length;
  await action();
  return waitForSentFrame(audit, sentStart, (message) => message['kind'] === 'command.v2' && message['type'] === type);
}

async function waitForSentFrame(audit: PageAudit, startIndex: number, predicate: (message: JsonObject) => boolean): Promise<JsonObject> {
  await expect.poll(() => audit.sent.slice(startIndex).find((frame) => predicate(frame.payload))?.payload ?? null, {
    timeout: POLL_TIMEOUT,
  }).not.toBeNull();
  const frame = audit.sent.slice(startIndex).find((candidate) => predicate(candidate.payload))?.payload;
  if (!frame) {
    throw new Error(`Missing expected sent runtime frame for ${audit.label}. Recent sent frames: ${JSON.stringify(audit.sent.slice(-12), null, 2)}`);
  }
  return frame;
}

async function waitForAckPatch(audit: PageAudit, command: JsonObject, predicate: (patch: JsonObject) => boolean = () => true): Promise<JsonObject> {
  const clientActionId = String(command['clientActionId'] ?? command['messageId'] ?? '');
  if (!clientActionId) {
    throw new Error(`Runtime command did not include clientActionId/messageId: ${JSON.stringify(command)}`);
  }
  return waitForPatchAfter(audit, 0, (patch) => patch['ackClientActionId'] === clientActionId && predicate(patch));
}

async function waitForPatchAfter(audit: PageAudit, startIndex: number, predicate: (patch: JsonObject) => boolean): Promise<JsonObject> {
  await expect.poll(() => audit.received.slice(startIndex).find((frame) => frame.payload['kind'] === 'patch.v2' && predicate(frame.payload))?.payload ?? null, {
    timeout: POLL_TIMEOUT,
  }).not.toBeNull();
  const patch = audit.received.slice(startIndex).find((frame) => frame.payload['kind'] === 'patch.v2' && predicate(frame.payload))?.payload;
  if (!patch) {
    throw new Error(`Missing patch.v2 for ${audit.label}. Recent received frames: ${JSON.stringify(audit.received.slice(-12), null, 2)}`);
  }
  return patch;
}

async function waitForGameplayConnection(audit: PageAudit): Promise<void> {
  await expect.poll(() => audit.received.some((frame) =>
    frame.payload['kind'] === 'connection_state' && frame.payload['status'] === 'connected',
  ), { timeout: 30_000 }).toBe(true);
}

async function waitForDebugHealth(audit: PageAudit): Promise<void> {
  await expect.poll(() => audit.received.some((frame) => frame.payload['kind'] === 'debug_health'), {
    timeout: 30_000,
  }).toBe(true);
}

async function baselineAuditState(pageA: Page, pageB: Page, auditA: PageAudit, auditB: PageAudit, debugAudit: PageAudit): Promise<{
  snapshotReloads: number;
  commandFallbackPosts: number;
  refetchStartedA: number;
  refetchStartedB: number;
  snapshotReloadLogsA: number;
  snapshotReloadLogsB: number;
  debugPipeline: JsonObject;
  debugErrors: number;
  deadLettersA: number;
  deadLettersB: number;
}> {
  const health = latestDebugHealth(debugAudit);
  return {
    snapshotReloads: auditA.snapshotReloads + auditB.snapshotReloads,
    commandFallbackPosts: auditA.commandFallbackPosts + auditB.commandFallbackPosts,
    refetchStartedA: await realtimeLogCount(pageA, { result: 'refetch_started' }),
    refetchStartedB: await realtimeLogCount(pageB, { result: 'refetch_started' }),
    snapshotReloadLogsA: await realtimeLogCount(pageA, { source: 'snapshot_reload' }),
    snapshotReloadLogsB: await realtimeLogCount(pageB, { source: 'snapshot_reload' }),
    debugPipeline: debugPipeline(health),
    debugErrors: debugErrorTotal(health),
    deadLettersA: await deadLetterCount(pageA),
    deadLettersB: await deadLetterCount(pageB),
  };
}

async function assertNoUnexpectedRuntimeFallbackOrResync(
  pageA: Page,
  pageB: Page,
  auditA: PageAudit,
  auditB: PageAudit,
  debugAudit: PageAudit,
  baseline: Awaited<ReturnType<typeof baselineAuditState>>,
  actionStartA: number,
  actionStartB: number,
): Promise<void> {
  const recentA = auditA.received.slice(actionStartA).map((frame) => frame.payload);
  const recentB = auditB.received.slice(actionStartB).map((frame) => frame.payload);
  expect(recentA.some((message) => message['kind'] === 'game_patch')).toBe(false);
  expect(recentB.some((message) => message['kind'] === 'game_patch')).toBe(false);
  expect(recentA.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')).toBe(false);
  expect(recentB.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')).toBe(false);
  expect(recentA.some((message) => message['status'] === 'rejected')).toBe(false);
  expect(recentB.some((message) => message['status'] === 'rejected')).toBe(false);
  expect(JSON.stringify([...recentA, ...recentB])).not.toMatch(/ownership_not_held|OWNERSHIP_NOT_HELD|ownership_lost|ownership_reject/i);

  expect(auditA.snapshotReloads + auditB.snapshotReloads).toBe(baseline.snapshotReloads);
  expect(auditA.commandFallbackPosts + auditB.commandFallbackPosts).toBe(baseline.commandFallbackPosts);
  expect(await realtimeLogCount(pageA, { result: 'refetch_started' })).toBe(baseline.refetchStartedA);
  expect(await realtimeLogCount(pageB, { result: 'refetch_started' })).toBe(baseline.refetchStartedB);
  expect(await realtimeLogCount(pageA, { source: 'snapshot_reload' })).toBe(baseline.snapshotReloadLogsA);
  expect(await realtimeLogCount(pageB, { source: 'snapshot_reload' })).toBe(baseline.snapshotReloadLogsB);
  expect(await deadLetterCount(pageA)).toBe(baseline.deadLettersA);
  expect(await deadLetterCount(pageB)).toBe(baseline.deadLettersB);

  const latestHealth = latestDebugHealth(debugAudit);
  const currentPipeline = debugPipeline(latestHealth);
  expect(Number(currentPipeline['resyncRequired'] ?? 0)).toBe(Number(baseline.debugPipeline['resyncRequired'] ?? 0));
  expect(Number(currentPipeline['error'] ?? 0)).toBe(Number(baseline.debugPipeline['error'] ?? 0));
  expect(Number((currentPipeline['commandAck'] as JsonObject | undefined)?.['rejected'] ?? 0)).toBe(Number((baseline.debugPipeline['commandAck'] as JsonObject | undefined)?.['rejected'] ?? 0));
  expect(Number((currentPipeline['commandAck'] as JsonObject | undefined)?.['resync_required'] ?? 0)).toBe(Number((baseline.debugPipeline['commandAck'] as JsonObject | undefined)?.['resync_required'] ?? 0));
  expect(debugErrorTotal(latestHealth)).toBe(baseline.debugErrors);
  expect(JSON.stringify(latestHealth)).not.toMatch(/ownership_not_held|OWNERSHIP_NOT_HELD/i);
}

async function activeTurnPage(pageA: Page, pageB: Page, auditA: PageAudit, auditB: PageAudit): Promise<{ page: Page; audit: PageAudit }> {
  await expect.poll(async () => {
    if (await pageA.getByTestId('pass-turn').isVisible().catch(() => false)) {
      return 'A';
    }
    if (await pageB.getByTestId('pass-turn').isVisible().catch(() => false)) {
      return 'B';
    }
    return '';
  }, { timeout: POLL_TIMEOUT }).not.toBe('');

  if (await pageA.getByTestId('pass-turn').isVisible().catch(() => false)) {
    await expect(pageA.getByTestId('pass-turn')).toBeEnabled({ timeout: POLL_TIMEOUT });
    return { page: pageA, audit: auditA };
  }
  await expect(pageB.getByTestId('pass-turn')).toBeEnabled({ timeout: POLL_TIMEOUT });
  return { page: pageB, audit: auditB };
}

async function clickGameMenuItem(page: Page, testId: string): Promise<void> {
  await page.getByTestId('game-screen').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: rect.left + 24,
      clientY: rect.top + 24,
    }));
  });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible({ timeout: POLL_TIMEOUT });
  const item = menu.getByTestId(testId);
  await expect(item).toBeVisible({ timeout: POLL_TIMEOUT });
  await item.click();
}

async function moveFirstHandCardToBattlefield(page: Page, playerId: string): Promise<void> {
  await revealHandForInteraction(page, playerId);
  const handCard = page
    .locator(`[data-testid="hand-zone"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="hand"]`)
    .nth(3);
  await expect(handCard).toBeVisible({ timeout: POLL_TIMEOUT });
  const instanceId = await handCard.getAttribute('data-card-instance-id');
  if (!instanceId) {
    throw new Error(`Missing hand card instance id for ${playerId}.`);
  }
  await moveHandCardToBattlefieldViaMenu(page, handCard);
  await expect(page.locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"] [data-card-instance-id="${instanceId}"]`)).toBeVisible({ timeout: POLL_TIMEOUT });
}

async function moveHandCardToBattlefieldViaMenu(page: Page, handCard: Locator): Promise<void> {
  await handCard.click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible({ timeout: POLL_TIMEOUT });
  await menu.getByRole('button', { name: /move to|mover/i }).click();
  await menu.getByRole('menuitem', { name: /battlefield|campo/i }).click();
}

async function revealHandForInteraction(page: Page, playerId: string): Promise<void> {
  const handArea = page.locator(`[data-testid="hand-area"][data-player-id="${playerId}"]`);
  await expect(handArea).toBeVisible({ timeout: POLL_TIMEOUT });
  await expect(handArea).not.toHaveClass(/hand-motion-active/, { timeout: POLL_TIMEOUT });
  await handArea.locator('.hand-hover-strip').hover();
  await expect(handArea).toHaveClass(/hand-revealed/, { timeout: POLL_TIMEOUT });
  await expect(handArea).not.toHaveClass(/hand-motion-active/, { timeout: POLL_TIMEOUT });
}

async function waitForLeaveResponse(page: Page, roomId: string): Promise<LeaveRoomResponse> {
  const response = await page.waitForResponse((candidate) =>
    candidate.request().method() === 'POST' && candidate.url().includes(`/rooms/${roomId}/leave`),
  { timeout: 30_000 });
  return {
    status: response.status(),
    body: await parseJsonResponse(response),
  };
}

async function parseJsonResponse(response: { json: () => Promise<unknown> }): Promise<JsonObject | null> {
  const payload = await response.json().catch(() => null);
  return isRecord(payload) ? payload : null;
}

async function gamePhase(request: APIRequestContext, gameId: string, token: string): Promise<string | null> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok()) {
    return null;
  }
  const body = await response.json() as { game?: { snapshot?: { gamePhase?: unknown } } };
  return typeof body.game?.snapshot?.gamePhase === 'string' ? body.game.snapshot.gamePhase : null;
}

async function playerStatus(request: APIRequestContext, gameId: string, token: string, playerId: string): Promise<string | null> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok()) {
    return null;
  }
  const body = await response.json() as { game?: { snapshot?: { players?: Record<string, { status?: string }> } } };
  return body.game?.snapshot?.players?.[playerId]?.status ?? null;
}

async function roomExists(request: APIRequestContext, roomId: string, token: string): Promise<boolean> {
  const response = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status() === 404) {
    return false;
  }
  expect(response.ok()).toBe(true);
  return true;
}

async function realtimeLogCount(page: Page, expected: Partial<Record<string, unknown>>): Promise<number> {
  const payloads = await page.evaluate(() => {
    const state = window as Window & { __commanderZoneRealtimeLogs?: Array<{ args: unknown[] }> };
    return (state.__commanderZoneRealtimeLogs ?? [])
      .map((entry) => entry.args[1])
      .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value));
  });
  return payloads.filter((payload) => Object.entries(expected).every(([key, value]) => payload[key] === value)).length;
}

async function deadLetterCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const state = window as Window & { __commanderZoneBroadcastMessages?: unknown[] };
    return (state.__commanderZoneBroadcastMessages ?? [])
      .filter((value) => typeof value === 'object' && value !== null && !Array.isArray(value))
      .filter((value) => (value as Record<string, unknown>)['kind'] === 'dead_letter_event')
      .length;
  });
}

function latestDebugHealth(audit: PageAudit): JsonObject {
  const health = [...audit.received].reverse().find((frame) => frame.payload['kind'] === 'debug_health')?.payload;
  if (!health) {
    throw new Error(`No debug_health frame captured. Recent debug frames: ${JSON.stringify(audit.received.slice(-8), null, 2)}`);
  }
  return health;
}

function debugPipeline(debugHealth: JsonObject): JsonObject {
  const health = debugHealth['health'];
  if (!isRecord(health) || !isRecord(health['pipeline'])) {
    return {};
  }
  return health['pipeline'];
}

function debugErrorTotal(debugHealth: JsonObject): number {
  const health = debugHealth['health'];
  if (!isRecord(health) || !isRecord(health['errors'])) {
    return 0;
  }
  return Number(health['errors']['total'] ?? 0);
}

function relevantConsoleErrors(...audits: PageAudit[]): string[] {
  return audits.flatMap((audit) => audit.consoleErrors.map((message) => `${audit.label}: ${message}`));
}

function expectCleanRuntimeBaseline(baseline: Awaited<ReturnType<typeof baselineAuditState>>): void {
  expect(baseline.commandFallbackPosts).toBe(0);
  expect(baseline.refetchStartedA).toBe(0);
  expect(baseline.refetchStartedB).toBe(0);
  expect(baseline.snapshotReloadLogsA).toBe(0);
  expect(baseline.snapshotReloadLogsB).toBe(0);
  expect(baseline.deadLettersA).toBe(0);
  expect(baseline.deadLettersB).toBe(0);
  expect(baseline.debugErrors).toBe(0);
  expect(Number(baseline.debugPipeline['resyncRequired'] ?? 0)).toBe(0);
  expect(Number(baseline.debugPipeline['error'] ?? 0)).toBe(0);
  expect(Number((baseline.debugPipeline['commandAck'] as JsonObject | undefined)?.['rejected'] ?? 0)).toBe(0);
  expect(Number((baseline.debugPipeline['commandAck'] as JsonObject | undefined)?.['resync_required'] ?? 0)).toBe(0);
}

function commandTypesAfter(audits: PageAudit[], startIndex: number): string[] {
  return audits
    .flatMap((audit) => audit.sent.slice(startIndex).map((frame) => frame.payload))
    .filter((payload) => payload['kind'] === 'command.v2')
    .map((payload) => String(payload['type'] ?? ''));
}

function patchKindsAfter(audits: PageAudit[], startIndex: number): string[] {
  return audits
    .flatMap((audit) => audit.received.slice(startIndex).map((frame) => frame.payload))
    .filter((payload) => payload['kind'] === 'patch.v2')
    .map((payload) => String(payload['kind']));
}

function hasOp(message: JsonObject, op: string): boolean {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.some((item) => item['op'] === op);
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

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
