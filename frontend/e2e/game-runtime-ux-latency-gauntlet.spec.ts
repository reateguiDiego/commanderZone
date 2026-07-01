import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks } from './support/commander-game';
import {
  drawMine,
  focusPlayer,
  readTableZoneCounts,
} from './support/game-table';

const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
const RUNTIME_METRICS_URL = process.env['E2E_GAME_RUNTIME_METRICS_URL'] ?? 'http://127.0.0.1:8091/metrics';
const POLL_TIMEOUT = 20_000;
const PHASES = ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'];

type JsonObject = Record<string, unknown>;
type CommandType =
  | 'card.moved'
  | 'card.tapped'
  | 'library.draw'
  | 'life.changed'
  | 'mulligan.keep'
  | 'turn.changed';

interface NetworkAudit {
  snapshotReloads: number;
  commandFallbacks: number;
  socketUrls: string[];
  ticketRoutes: string[];
  failedRequests: string[];
  failedResponses: string[];
}

interface ConsoleEntry {
  type: string;
  text: string;
  url: string;
  lineNumber: number;
}

interface WebSocketFrame {
  direction: 'sent' | 'received';
  at: number;
  url: string;
  payload: JsonObject;
}

interface WebSocketAudit {
  frames: WebSocketFrame[];
  closes: Array<{ at: number; url: string }>;
}

interface AuditSession {
  label: 'A' | 'B';
  page: Page;
  network: NetworkAudit;
  console: ConsoleEntry[];
  ws: WebSocketAudit;
}

interface ActionTiming {
  action: string;
  sender: 'A' | 'B';
  commandType: CommandType;
  clientActionId: string | null;
  patchVersion: number | null;
  clickToSendMs: number;
  sendToPatchMs: number;
  clickToUiMs: number;
}

interface RuntimeMetrics {
  actors?: JsonObject[];
  totals?: JsonObject;
  runtime?: JsonObject;
  gateway?: JsonObject;
}

test.setTimeout(300_000);

test('P51 runtime UX latency gauntlet stays on websocket patches without fallback, resync, or queue stalls', async ({
  browser,
  request,
  baseURL,
}, testInfo) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  await assertGameRuntimeReady(request);
  const runtimeMetricsBefore = await fetchRuntimeMetrics(request);
  const setup = await createCommanderGameWithBasicDecks(request, {
    playerAPrefix: 'ux-latency-a',
    playerBPrefix: 'ux-latency-b',
    roomVisibility: 'public',
  });
  const { gameId, playerA, playerB } = setup;

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken),
  });
  await Promise.all([
    addRuntimeUxAuditInstrumentation(contextA),
    addRuntimeUxAuditInstrumentation(contextB),
  ]);

  const timings: ActionTiming[] = [];
  let report: JsonObject | null = null;

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const sessionA = createAuditSession('A', pageA, gameId);
    const sessionB = createAuditSession('B', pageB, gameId);
    const sessions = [sessionA, sessionB] as const;

    await test.step('connect both isolated browser contexts to runtime websocket', async () => {
      await Promise.all([pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
      await Promise.all([
        expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        waitForGameplayConnection(sessionA.ws.frames, 1),
        waitForGameplayConnection(sessionB.ws.frames, 1),
      ]);
      await Promise.all([
        expect.poll(() => sessionA.network.ticketRoutes.includes('runtime_ws'), { timeout: 10_000 }).toBe(true),
        expect.poll(() => sessionB.network.ticketRoutes.includes('runtime_ws'), { timeout: 10_000 }).toBe(true),
      ]);
      await Promise.all([
        observeDebugMetrics(pageA, gameId),
        observeDebugMetrics(pageB, gameId),
      ]);
    });

    await test.step('resolve mulligan in-browser and enter PLAYING', async () => {
      await resolveMulliganToPlayingInBrowser(sessionA, sessionB, timings);
      await Promise.all([
        focusPlayer(pageA, playerA.user.displayName),
        focusPlayer(pageB, playerB.user.displayName),
      ]);
      await expect.poll(() => hasBootstrapLog(pageA, 'initial_load'), { timeout: 10_000 }).toBe(true);
      await expect.poll(() => hasBootstrapLog(pageB, 'initial_load'), { timeout: 10_000 }).toBe(true);
    });

    const baseline = await captureBaselines(sessions);

    await test.step('player A draws a real visible print without refetch', async () => {
      await focusPlayer(pageA, playerA.user.displayName);
      const beforeIds = await handCardIds(pageA, playerA.user.id);
      const beforeCounts = await readTableZoneCounts(pageA, playerA.user.displayName);
      const timing = await measureRuntimeAction(
        sessionA,
        'A draw one card',
        'library.draw',
        async () => drawMine(pageA),
        async () => {
          await expect.poll(async () => readTableZoneCounts(pageA, playerA.user.displayName), {
            timeout: POLL_TIMEOUT,
          }).toEqual({
            hand: beforeCounts.hand + 1,
            library: beforeCounts.library - 1,
          });
        },
        { expectedOps: ['zone.cards.add'] },
      );
      timings.push(timing);

      const drawnCard = await findNewHandCard(pageA, playerA.user.id, beforeIds);
      const cardName = (await drawnCard.getAttribute('data-card-name'))?.trim() ?? '';
      const imageAlt = (await drawnCard.locator('img').first().getAttribute('alt').catch(() => null))?.trim() ?? '';
      expect(cardName).not.toBe('');
      expect(cardName).not.toMatch(/hidden|unknown|placeholder/i);
      expect(imageAlt || cardName).not.toMatch(/hidden|unknown|placeholder/i);
    });

    let battlefieldInstanceId = '';
    await test.step('player A moves a hand card to battlefield and toggles tap state', async () => {
      await focusPlayer(pageA, playerA.user.displayName);
      const beforeCounts = await readTableZoneCounts(pageA, playerA.user.displayName);
      await revealHand(pageA, playerA.user.id);
      const handCard = pageA
        .locator(`[data-testid="hand-zone"][data-player-id="${playerA.user.id}"] [data-testid="game-card"][data-zone="hand"]`)
        .nth(3);
      await expect(handCard).toBeVisible({ timeout: POLL_TIMEOUT });
      await expect(handCard).not.toHaveClass(/hand-motion-active/, { timeout: POLL_TIMEOUT });
      battlefieldInstanceId = await requiredAttribute(handCard, 'data-card-instance-id');
      await focusPlayer(pageB, playerA.user.displayName);

      timings.push(await measureRuntimeAction(
        sessionA,
        'A move hand card to battlefield',
        'card.moved',
        async () => moveHandCardToBattlefieldViaMenu(pageA, handCard),
        async () => {
          await expect(pageA.locator(battlefieldCardSelector(playerA.user.id, battlefieldInstanceId))).toBeVisible({
            timeout: POLL_TIMEOUT,
          });
          await expect(pageB.locator(battlefieldCardSelector(playerA.user.id, battlefieldInstanceId))).toBeVisible({
            timeout: POLL_TIMEOUT,
          });
          await expect.poll(async () => readTableZoneCounts(pageA, playerA.user.displayName), {
            timeout: POLL_TIMEOUT,
          }).toEqual({
            hand: beforeCounts.hand - 1,
            library: beforeCounts.library,
          });
          await expect.poll(async () => readTableZoneCounts(pageB, playerA.user.displayName), {
            timeout: POLL_TIMEOUT,
          }).toEqual({
            hand: beforeCounts.hand - 1,
            library: beforeCounts.library,
          });
        },
        { expectedOps: ['zone.cards.remove', 'zone.cards.add'] },
      ));

      const battlefieldCard = pageA.locator(battlefieldCardSelector(playerA.user.id, battlefieldInstanceId));
      timings.push(await measureRuntimeAction(
        sessionA,
        'A tap battlefield card',
        'card.tapped',
        async () => battlefieldCard.dblclick(),
        async () => expect(battlefieldCard).toHaveClass(/tapped/, { timeout: POLL_TIMEOUT }),
        { expectedOps: ['card.tapped.set'] },
      ));
      timings.push(await measureRuntimeAction(
        sessionA,
        'A untap battlefield card',
        'card.tapped',
        async () => battlefieldCard.dblclick(),
        async () => expect(battlefieldCard).not.toHaveClass(/tapped/, { timeout: POLL_TIMEOUT }),
        { expectedOps: ['card.tapped.set'] },
      ));
    });

    await test.step('both turn controllers advance phase and pass turn', async () => {
      const firstActive = await activeTurnSession(sessionA, sessionB);
      const firstNonActive = firstActive === sessionA ? sessionB : sessionA;
      timings.push(await advancePhaseOnce(firstActive, 'first active phase advance'));
      await expect.poll(async () => readPhase(sessionA.page), { timeout: POLL_TIMEOUT }).toBe(await readPhase(sessionB.page));
      timings.push(...await passTurn(firstActive, firstNonActive, 'first active pass turn'));

      const secondActive = await activeTurnSession(sessionA, sessionB);
      const secondNonActive = secondActive === sessionA ? sessionB : sessionA;
      timings.push(await advancePhaseOnce(secondActive, 'second active phase advance'));
      await expect.poll(async () => readPhase(sessionA.page), { timeout: POLL_TIMEOUT }).toBe(await readPhase(sessionB.page));
      timings.push(...await passTurn(secondActive, secondNonActive, 'second active pass turn'));
    });

    await test.step('life change propagates without fallback', async () => {
      await focusPlayer(pageA, playerA.user.displayName);
      await focusPlayer(pageB, playerA.user.displayName);
      const beforeLife = await readFocusedLife(pageA, playerA.user.id);
      timings.push(await measureRuntimeAction(
        sessionA,
        'A lose one life',
        'life.changed',
        async () => removeLife(pageA, playerA.user.displayName),
        async () => {
          await expect.poll(async () => readFocusedLife(pageA, playerA.user.id), {
            timeout: POLL_TIMEOUT,
          }).toBe(beforeLife - 1);
          await expect.poll(async () => readFocusedLife(pageB, playerA.user.id), {
            timeout: POLL_TIMEOUT,
          }).toBe(beforeLife - 1);
        },
        { expectedOps: ['player.life.set'] },
      ));
    });

    await assertNoUnexpectedBrowserFallbackOrResync(sessions, baseline);
    await assertNoUnexpectedWebSocketIssues(sessions);
    const runtimeMetricsAfter = await fetchRuntimeMetrics(request);
    const runtimeSummary = assertRuntimeMetricsHealthy(gameId, runtimeMetricsBefore, runtimeMetricsAfter);
    const debugSummary = await assertDebugMetricsHealthy(sessions);

    report = {
      project: testInfo.project.name,
      browser: testInfo.project.use.browserName ?? testInfo.project.name,
      gameId,
      flow: [
        '2 isolated BrowserContext sessions',
        'create public Commander room through existing rooms flow',
        'resolve both mulligan keeps in browser',
        'draw card, move to battlefield, tap, untap',
        'advance/pass turn for both active controllers',
        'life change',
      ],
      optionalConcedeOrLeave: 'omitted; optional in prompt and global context-menu hit target is not deterministic after battlefield content',
      timings,
      consoleIssues: sessions.flatMap((session) => relevantConsoleIssues(session.console).map((entry) => ({ session: session.label, ...entry }))),
      websocketCloses: sessions.flatMap((session) => session.ws.closes.map((entry) => ({ session: session.label, ...entry }))),
      websocketRuntimeEvents: {
        A: await runtimeSocketEvents(pageA),
        B: await runtimeSocketEvents(pageB),
      },
      httpFallbackCommands: sessions.reduce((total, session) => total + session.network.commandFallbacks, 0),
      snapshotReloadsAfterBaseline: sessions.reduce((total, session) => total + session.network.snapshotReloads, 0) - baseline.snapshotReloads,
      ticketRoutes: {
        A: sessionA.network.ticketRoutes,
        B: sessionB.network.ticketRoutes,
      },
      debugSummary,
      runtimeSummary,
    };

    console.log(`P51_RUNTIME_UX_REPORT ${JSON.stringify(report)}`);
  } finally {
    await contextA.close().catch(() => undefined);
    await contextB.close().catch(() => undefined);
  }

  expect(report).not.toBeNull();
});

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`Game runtime is not reachable at ${RUNTIME_READY_URL}; this audit must not fall back to legacy.`);
  }
}

async function fetchRuntimeMetrics(request: APIRequestContext): Promise<RuntimeMetrics> {
  const response = await request.get(RUNTIME_METRICS_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`Game runtime metrics are not reachable at ${RUNTIME_METRICS_URL}.`);
  }

  return await response.json() as RuntimeMetrics;
}

async function addRuntimeUxAuditInstrumentation(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');

    const state = window as unknown as {
      __commanderZoneRealtimeLogs?: Array<{ level: string; args: unknown[] }>;
      __commanderZoneRuntimeSockets?: WebSocket[];
      __commanderZoneRuntimeSocketEvents?: Array<Record<string, unknown>>;
      __commanderZoneDebugMessages?: unknown[];
      __commanderZoneDebugChannel?: BroadcastChannel;
      __commanderZoneDebugObserveInterval?: number;
    };
    state.__commanderZoneRealtimeLogs = [];
    state.__commanderZoneRuntimeSockets = [];
    state.__commanderZoneRuntimeSocketEvents = [];
    state.__commanderZoneDebugMessages = [];

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

    try {
      const channel = new BroadcastChannel('commanderzone.game-debug.snapshot-metrics');
      state.__commanderZoneDebugChannel = channel;
      channel.onmessage = (event) => {
        state.__commanderZoneDebugMessages?.push(serialize(event.data));
      };
    } catch {
      state.__commanderZoneDebugChannel = undefined;
    }

    const timestamp = () => performance.timeOrigin + performance.now();
    const NativeWebSocket = window.WebSocket;
    class AuditWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (protocols === undefined) {
          super(url);
        } else {
          super(url, protocols);
        }
        if (String(url).includes('/ws')) {
          state.__commanderZoneRuntimeSockets?.push(this as WebSocket);
          state.__commanderZoneRuntimeSocketEvents?.push({ type: 'constructed', url: String(url), at: timestamp() });
          this.addEventListener('open', () => {
            state.__commanderZoneRuntimeSocketEvents?.push({ type: 'open', url: String(url), at: timestamp() });
          });
          this.addEventListener('close', (event) => {
            state.__commanderZoneRuntimeSocketEvents?.push({
              type: 'close',
              url: String(url),
              at: timestamp(),
              code: event.code,
              reason: event.reason,
              wasClean: event.wasClean,
            });
          });
          this.addEventListener('error', () => {
            state.__commanderZoneRuntimeSocketEvents?.push({ type: 'error', url: String(url), at: timestamp() });
          });
        }
      }
    }

    window.WebSocket = AuditWebSocket as typeof WebSocket;
  });
}

function createAuditSession(label: 'A' | 'B', page: Page, gameId: string): AuditSession {
  return {
    label,
    page,
    network: collectNetworkAudit(page, gameId),
    console: collectConsoleAudit(page),
    ws: collectWebSocketAudit(page),
  };
}

function collectNetworkAudit(page: Page, gameId: string): NetworkAudit {
  const audit: NetworkAudit = {
    snapshotReloads: 0,
    commandFallbacks: 0,
    socketUrls: [],
    ticketRoutes: [],
    failedRequests: [],
    failedResponses: [],
  };

  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'GET' && (url.includes(`/games/${gameId}/snapshot`) || url.includes(`/games/${gameId}/bootstrap`))) {
      audit.snapshotReloads += 1;
    }
    if (request.method() === 'POST' && url.includes(`/games/${gameId}/commands`)) {
      audit.commandFallbacks += 1;
    }
  });
  page.on('requestfailed', (request) => {
    audit.failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
  });
  page.on('response', (response) => {
    const request = response.request();
    if (request.method() === 'POST' && response.url().includes(`/games/${gameId}/websocket-ticket`)) {
      void response.json().then((payload: unknown) => {
        if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
          const route = (payload as JsonObject)['route'];
          if (typeof route === 'string') {
            audit.ticketRoutes.push(route);
          }
        }
      }).catch(() => undefined);
    }
    if (response.status() >= 500) {
      audit.failedResponses.push(`${response.status()} ${request.method()} ${response.url()}`);
    }
  });
  page.on('websocket', (socket) => {
    audit.socketUrls.push(socket.url());
  });

  return audit;
}

function collectConsoleAudit(page: Page): ConsoleEntry[] {
  const entries: ConsoleEntry[] = [];
  page.on('console', (message) => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning' && type !== 'warn') {
      return;
    }
    const location = message.location();
    entries.push({
      type,
      text: message.text(),
      url: location.url,
      lineNumber: location.lineNumber,
    });
  });
  page.on('pageerror', (error) => {
    entries.push({
      type: 'pageerror',
      text: error.message,
      url: '',
      lineNumber: 0,
    });
  });

  return entries;
}

function collectWebSocketAudit(page: Page): WebSocketAudit {
  const audit: WebSocketAudit = { frames: [], closes: [] };
  page.on('websocket', (socket) => {
    const url = socket.url();
    socket.on('framesent', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) {
        audit.frames.push({ direction: 'sent', at: Date.now(), url, payload: parsed });
      }
    });
    socket.on('framereceived', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) {
        audit.frames.push({ direction: 'received', at: Date.now(), url, payload: parsed });
      }
    });
    socket.on('close', () => {
      audit.closes.push({ at: Date.now(), url });
    });
  });

  return audit;
}

async function observeDebugMetrics(page: Page, gameId: string): Promise<void> {
  await page.evaluate((currentGameId) => {
    const state = window as unknown as {
      __commanderZoneDebugChannel?: BroadcastChannel;
      __commanderZoneDebugObserveInterval?: number;
    };
    const publish = () => {
      state.__commanderZoneDebugChannel?.postMessage({
        kind: 'debug_observe',
        gameId: currentGameId,
        observedAt: new Date().toISOString(),
      });
    };
    publish();
    if (state.__commanderZoneDebugObserveInterval) {
      window.clearInterval(state.__commanderZoneDebugObserveInterval);
    }
    state.__commanderZoneDebugObserveInterval = window.setInterval(publish, 1000);
  }, gameId);
}

async function resolveMulliganToPlayingInBrowser(
  sessionA: AuditSession,
  sessionB: AuditSession,
  timings: ActionTiming[],
): Promise<void> {
  await Promise.all([
    expect(sessionA.page.getByTestId('mulligan-overlay')).toBeVisible({ timeout: 30_000 }),
    expect(sessionB.page.getByTestId('mulligan-overlay')).toBeVisible({ timeout: 30_000 }),
    expect(sessionA.page.getByTestId('mulligan-keep')).toBeEnabled({ timeout: 30_000 }),
    expect(sessionB.page.getByTestId('mulligan-keep')).toBeEnabled({ timeout: 30_000 }),
  ]);

  timings.push(await measureRuntimeAction(
    sessionA,
    'A mulligan keep',
    'mulligan.keep',
    async () => sessionA.page.getByTestId('mulligan-keep').click(),
    async () => expect(sessionA.page.getByTestId('mulligan-ready-panel')).toBeVisible({ timeout: 30_000 }),
    { expectedOps: ['mulligan.status.set'] },
  ));

  await expect(sessionB.page.getByTestId('mulligan-keep')).toBeEnabled({ timeout: 30_000 });
  timings.push(await measureRuntimeAction(
    sessionB,
    'B mulligan keep enters PLAYING',
    'mulligan.keep',
    async () => sessionB.page.getByTestId('mulligan-keep').click(),
    async () => {
      await Promise.all([
        expect(sessionA.page.getByTestId('mulligan-overlay')).toBeHidden({ timeout: 30_000 }),
        expect(sessionB.page.getByTestId('mulligan-overlay')).toBeHidden({ timeout: 30_000 }),
      ]);
    },
    { expectedOps: ['mulligan.completed'] },
  ));
}

async function measureRuntimeAction(
  session: AuditSession,
  action: string,
  commandType: CommandType,
  trigger: () => Promise<void>,
  waitForUi: () => Promise<void>,
  options: { expectedOps?: string[] } = {},
): Promise<ActionTiming> {
  const startIndex = session.ws.frames.length;
  const startedAt = Date.now();
  await trigger();
  const sent = await waitForSentCommand(session.ws.frames, startIndex, commandType);
  const commandId = commandCorrelationId(sent.payload);
  const patch = await waitForReceivedPatch(
    session.ws.frames,
    startIndex,
    (candidate) => {
      if (commandId && patchCorrelationId(candidate) === commandId) {
        return true;
      }

      return (options.expectedOps ?? []).every((op) => hasOp(candidate, op));
    },
  );
  await waitForUi();
  const finishedAt = Date.now();

  return {
    action,
    sender: session.label,
    commandType,
    clientActionId: commandId,
    patchVersion: numericField(patch, 'version'),
    clickToSendMs: sent.at - startedAt,
    sendToPatchMs: Math.max(0, patchFrameTime(session.ws.frames, patch) - sent.at),
    clickToUiMs: finishedAt - startedAt,
  };
}

async function waitForSentCommand(frames: WebSocketFrame[], startIndex: number, commandType: CommandType): Promise<WebSocketFrame> {
  await expect.poll(() => frames.slice(startIndex).find((frame) =>
    frame.direction === 'sent' && frameCommandType(frame.payload) === commandType,
  ) ?? null, { timeout: POLL_TIMEOUT }).not.toBeNull();

  const frame = frames.slice(startIndex).find((candidate) =>
    candidate.direction === 'sent' && frameCommandType(candidate.payload) === commandType,
  );
  if (!frame) {
    throw new Error(`No sent ${commandType} command was captured. Recent frames: ${JSON.stringify(frames.slice(startIndex).slice(-8), null, 2)}`);
  }

  return frame;
}

async function waitForReceivedPatch(
  frames: WebSocketFrame[],
  startIndex: number,
  predicate: (message: JsonObject) => boolean,
): Promise<JsonObject> {
  await expect.poll(() => frames.slice(startIndex).find((frame) =>
    frame.direction === 'received' && frame.payload['kind'] === 'patch.v2' && predicate(frame.payload),
  )?.payload ?? null, { timeout: POLL_TIMEOUT }).not.toBeNull();

  const frame = frames.slice(startIndex).find((candidate) =>
    candidate.direction === 'received' && candidate.payload['kind'] === 'patch.v2' && predicate(candidate.payload),
  );
  if (!frame) {
    throw new Error(`No patch.v2 frame was captured. Recent frames: ${JSON.stringify(frames.slice(startIndex).slice(-8), null, 2)}`);
  }

  return frame.payload;
}

async function waitForGameplayConnection(frames: WebSocketFrame[], count: number): Promise<void> {
  await expect.poll(() => frames.filter((frame) =>
    frame.direction === 'received'
    && frame.payload['kind'] === 'connection_state'
    && frame.payload['status'] === 'connected',
  ).length, { timeout: POLL_TIMEOUT }).toBeGreaterThanOrEqual(count);
}

async function captureBaselines(sessions: readonly AuditSession[]): Promise<{
  snapshotReloads: number;
  commandFallbacks: number;
  refetchStarted: number;
  snapshotReloadLogs: number;
  fallbackLogs: number;
}> {
  return {
    snapshotReloads: sessions.reduce((total, session) => total + session.network.snapshotReloads, 0),
    commandFallbacks: sessions.reduce((total, session) => total + session.network.commandFallbacks, 0),
    refetchStarted: await realtimeLogCountAll(sessions, { result: 'refetch_started' }),
    snapshotReloadLogs: await realtimeLogCountAll(sessions, { source: 'snapshot_reload' }),
    fallbackLogs: await realtimeLogCountAll(sessions, { source: 'fallback HTTP' }),
  };
}

async function assertNoUnexpectedBrowserFallbackOrResync(
  sessions: readonly AuditSession[],
  baseline: Awaited<ReturnType<typeof captureBaselines>>,
): Promise<void> {
  const snapshotReloads = sessions.reduce((total, session) => total + session.network.snapshotReloads, 0);
  const commandFallbacks = sessions.reduce((total, session) => total + session.network.commandFallbacks, 0);
  const refetchStarted = await realtimeLogCountAll(sessions, { result: 'refetch_started' });
  const snapshotReloadLogs = await realtimeLogCountAll(sessions, { source: 'snapshot_reload' });
  const fallbackLogs = await realtimeLogCountAll(sessions, { source: 'fallback HTTP' });
  const diagnostics = await browserFallbackDiagnostics(sessions, baseline, {
    snapshotReloads,
    commandFallbacks,
    refetchStarted,
    snapshotReloadLogs,
    fallbackLogs,
  });
  const diagnosticMessage = `Unexpected browser fallback/resync diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`;
  expect(commandFallbacks, diagnosticMessage).toBe(baseline.commandFallbacks);
  expect(snapshotReloads, diagnosticMessage).toBe(baseline.snapshotReloads);
  expect(refetchStarted, diagnosticMessage).toBe(baseline.refetchStarted);
  expect(snapshotReloadLogs, diagnosticMessage).toBe(baseline.snapshotReloadLogs);
  expect(fallbackLogs, diagnosticMessage).toBe(baseline.fallbackLogs);

  const recentFrames = sessions.flatMap((session) => session.ws.frames);
  expect(recentFrames.some((frame) => frame.payload['kind'] === 'game_patch'), diagnosticMessage).toBe(false);
  expect(recentFrames.some((frame) => frame.payload['kind'] === 'resync_required'), diagnosticMessage).toBe(false);
  expect(recentFrames.some((frame) =>
    frame.payload['kind'] === 'command_ack'
    && (frame.payload['status'] === 'rejected' || frame.payload['status'] === 'resync_required'),
  ), diagnosticMessage).toBe(false);
}

async function browserFallbackDiagnostics(
  sessions: readonly AuditSession[],
  baseline: Awaited<ReturnType<typeof captureBaselines>>,
  observed: {
    snapshotReloads: number;
    commandFallbacks: number;
    refetchStarted: number;
    snapshotReloadLogs: number;
    fallbackLogs: number;
  },
): Promise<JsonObject> {
  const sessionDiagnostics = await Promise.all(sessions.map(async (session) => {
    const realtimeLogs = await realtimeLogPayloads(session.page);
    return {
      label: session.label,
      network: {
        snapshotReloads: session.network.snapshotReloads,
        commandFallbacks: session.network.commandFallbacks,
        ticketRoutes: session.network.ticketRoutes,
        failedRequests: session.network.failedRequests,
        failedResponses: session.network.failedResponses,
      },
      realtimeProblems: realtimeLogs
        .filter((payload) =>
          payload['reason'] === 'invalid_operation'
          || payload['reason'] === 'version_gap'
          || payload['result'] === 'refetch_started'
          || payload['source'] === 'snapshot_reload'
          || payload['source'] === 'fallback HTTP'
          || payload['reason'] === 'websocket.request_resync',
        )
        .slice(-12),
      zoneCardPatchFrames: session.ws.frames
        .filter((frame) =>
          frame.direction === 'received'
          && frame.payload['kind'] === 'patch.v2'
          && (hasOp(frame.payload, 'zone.cards.add') || hasOp(frame.payload, 'zone.cards.remove')),
        )
        .slice(-8)
        .map((frame) => summarizePatchFrame(frame)),
      commandAcks: session.ws.frames
        .filter((frame) => frame.direction === 'received' && frame.payload['kind'] === 'command_ack')
        .slice(-12)
        .map((frame) => ({
          at: frame.at,
          status: frame.payload['status'],
          type: frame.payload['type'],
          clientActionId: patchCorrelationId(frame.payload),
          reason: frame.payload['reason'],
        })),
    };
  }));

  return {
    baseline,
    observed,
    deltas: {
      snapshotReloads: observed.snapshotReloads - baseline.snapshotReloads,
      commandFallbacks: observed.commandFallbacks - baseline.commandFallbacks,
      refetchStarted: observed.refetchStarted - baseline.refetchStarted,
      snapshotReloadLogs: observed.snapshotReloadLogs - baseline.snapshotReloadLogs,
      fallbackLogs: observed.fallbackLogs - baseline.fallbackLogs,
    },
    sessions: sessionDiagnostics,
  };
}

function summarizePatchFrame(frame: WebSocketFrame): JsonObject {
  return {
    at: frame.at,
    version: frame.payload['version'],
    ackClientActionId: frame.payload['ackClientActionId'],
    ops: patchOps(frame.payload).map((operation) => summarizePatchOperation(operation)),
  };
}

function summarizePatchOperation(operation: JsonObject): JsonObject {
  if (operation['op'] === 'zone.cards.add') {
    return {
      op: operation['op'],
      playerId: operation['playerId'],
      zone: operation['zone'],
      index: operation['index'],
      cards: arrayField(operation, 'cards').slice(0, 4).map(summarizePatchCard),
      staticCards: summarizeStaticCards(operation['staticCards']),
    };
  }

  if (operation['op'] === 'zone.cards.remove') {
    return {
      op: operation['op'],
      playerId: operation['playerId'],
      zone: operation['zone'],
      instanceIds: operation['instanceIds'],
    };
  }

  if (operation['op'] === 'zone.count.set') {
    return {
      op: operation['op'],
      playerId: operation['playerId'],
      zone: operation['zone'],
      count: operation['count'],
    };
  }

  return {
    op: operation['op'],
  };
}

function summarizePatchCard(value: unknown): JsonObject {
  if (!isObject(value)) {
    return { value };
  }

  return {
    instanceId: value['instanceId'],
    cardRef: value['cardRef'],
    cardKey: value['cardKey'],
    printId: value['printId'],
    cardVersion: value['cardVersion'],
    language: value['language'],
    viewerVisibility: value['viewerVisibility'],
    hidden: value['hidden'],
    zoneId: value['zoneId'],
    ownerId: value['ownerId'],
    controllerId: value['controllerId'],
  };
}

function summarizeStaticCards(value: unknown): JsonObject {
  if (!isObject(value)) {
    return {
      count: 0,
      keys: [],
      sample: [],
    };
  }

  const entries = Object.entries(value);
  return {
    count: entries.length,
    keys: entries.map(([key]) => key).slice(0, 6),
    sample: entries.slice(0, 3).map(([key, staticCard]) => {
      if (!isObject(staticCard)) {
        return { key, value: staticCard };
      }

      const imageUris = isObject(staticCard['imageUris'])
        ? Object.keys(staticCard['imageUris'])
        : [];
      return {
        key,
        cardRef: staticCard['cardRef'],
        cardKey: staticCard['cardKey'],
        printId: staticCard['printId'],
        cardVersion: staticCard['cardVersion'],
        language: staticCard['language'],
        viewerVisibility: staticCard['viewerVisibility'],
        name: staticCard['name'],
        imageUriKeys: imageUris,
      };
    }),
  };
}

async function assertNoUnexpectedWebSocketIssues(sessions: readonly AuditSession[]): Promise<void> {
  for (const session of sessions) {
    expect(session.ws.closes, `${session.label} runtime websocket closed before cleanup`).toEqual([]);
    const socketEvents = await runtimeSocketEvents(session.page);
    const problemEvents = socketEvents.filter((event) => event['type'] === 'close' || event['type'] === 'error');
    expect(problemEvents, `${session.label} runtime websocket browser close/error before cleanup`).toEqual([]);
    expect(relevantConsoleIssues(session.console), `${session.label} relevant console issues`).toEqual([]);
    expect(session.network.failedResponses, `${session.label} 5xx responses`).toEqual([]);
    expect(session.network.failedRequests.filter((value) => value.includes('/ws')), `${session.label} websocket request failures`).toEqual([]);
  }
}

function assertRuntimeMetricsHealthy(
  gameId: string,
  before: RuntimeMetrics,
  after: RuntimeMetrics,
): JsonObject {
  const actor = (after.actors ?? []).find((candidate) => candidate['gameId'] === gameId);
  if (!actor) {
    throw new Error(`Runtime metrics did not include actor entry for game ${gameId}.`);
  }

  expect(numberField(actor, 'actor.queue_depth')).toBe(0);
  expect(numberField(actor, 'actor.queue_full_count')).toBe(0);
  expect(numberField(actor, 'actor.command_rejected_count')).toBe(0);
  expect(numberField(actor, 'command.legacy_fallback_count')).toBe(0);
  expect(numberField(actor, 'actor.version_conflict_count')).toBe(0);
  expect(numberField(actor, 'actor.snapshot_post_append_failure_count')).toBe(0);
  expect(numberField(actor, 'actor.command_applied_count')).toBeGreaterThanOrEqual(12);

  for (const key of [
    'runtime.ownership_reject_count',
    'runtime.ownership_lost_count',
    'runtime.ownership_stolen_count',
    'runtime.ownership_expired_count',
  ]) {
    expect(numberField(after.runtime, key) - numberField(before.runtime, key), key).toBe(0);
  }

  expect(numberField(after.runtime, 'command.legacy_fallback_count') - numberField(before.runtime, 'command.legacy_fallback_count')).toBe(0);
  expect(numberField(after.gateway, 'PatchReplayResyncCount') - numberField(before.gateway, 'PatchReplayResyncCount')).toBe(0);
  expect(nestedNumber(after.gateway, ['gameplay.ws.route', 'runtime_ws'])).toBeGreaterThanOrEqual(
    nestedNumber(before.gateway, ['gameplay.ws.route', 'runtime_ws']) + 2,
  );

  return {
    actor: pickMetrics(actor, [
      'actor.queue_depth',
      'actor.queue_full_count',
      'actor.command_enqueued_count',
      'actor.command_rejected_count',
      'actor.command_applied_count',
      'actor.command_latency_ms',
      'actor.queue_wait_ms',
      'command.runtime_coverage_percent',
      'command.legacy_fallback_count',
    ]),
    runtime: pickMetrics(after.runtime ?? {}, [
      'runtime.ownership_mode',
      'runtime.ownership_reject_count',
      'runtime.ownership_lost_count',
      'runtime.ownership_stolen_count',
      'runtime.ownership_expired_count',
      'command.legacy_fallback_count',
    ]),
    gateway: {
      PatchReplayResyncCount: numberField(after.gateway, 'PatchReplayResyncCount'),
      ReconnectsRequiringSync: numberField(after.gateway, 'ReconnectsRequiringSync'),
      runtimeWsRouteCount: nestedNumber(after.gateway, ['gameplay.ws.route', 'runtime_ws']),
    },
  };
}

async function assertDebugMetricsHealthy(sessions: readonly AuditSession[]): Promise<JsonObject> {
  const messagesBySession = await Promise.all(sessions.map(async (session) => ({
    label: session.label,
    messages: await debugMessages(session.page),
  })));
  const deadLetters = messagesBySession.flatMap(({ label, messages }) =>
    messages
      .filter((message) => message['kind'] === 'dead_letter_event')
      .map((message) => ({ session: label, ...message })),
  );
  const queueMetrics = messagesBySession.flatMap(({ label, messages }) =>
    messages
      .filter((message) => message['kind'] === 'queue_metrics')
      .map((message) => ({ session: label, ...message })),
  );
  const latestQueueBySession = sessions.map((session) =>
    [...queueMetrics].reverse().find((message) => message['session'] === session.label),
  );

  expect(deadLetters).toEqual([]);
  expect(queueMetrics.length).toBeGreaterThan(0);
  for (const latest of latestQueueBySession) {
    expect(numberField(latest, 'queueDepth')).toBe(0);
    expect(numberField(latest, 'dropTotal')).toBe(0);
    expect(numberField(latest, 'retryTotal')).toBe(0);
    expect(numberField(latest, 'resyncTotal')).toBe(0);
    expect(numberField(latest, 'rejectedTotal')).toBe(0);
    expect(numberField(latest, 'queueFullTotal')).toBe(0);
    expect(numberField(latest, 'gameplay.patch_v2.apply.resync_required')).toBe(0);
    expect(numberField(latest, 'gameplay.patch_v2.apply.version_gap')).toBe(0);
  }

  return {
    deadLetters,
    latestQueueBySession: latestQueueBySession.map((message) => pickMetrics(message ?? {}, [
      'session',
      'queueDepth',
      'enqueueTotal',
      'drainTotal',
      'dropTotal',
      'retryTotal',
      'resyncTotal',
      'rejectedTotal',
      'queueFullTotal',
      'gameplay.refetch.count',
      'gameplay.patch_v2.apply.ok',
      'gameplay.patch_v2.apply.resync_required',
      'gameplay.patch_v2.apply.version_gap',
    ])),
  };
}

async function activeTurnSession(sessionA: AuditSession, sessionB: AuditSession): Promise<AuditSession> {
  await expect.poll(async () =>
    await sessionA.page.getByTestId('pass-turn').isVisible().catch(() => false)
    || await sessionB.page.getByTestId('pass-turn').isVisible().catch(() => false),
  { timeout: POLL_TIMEOUT }).toBe(true);

  return await sessionA.page.getByTestId('pass-turn').isVisible().catch(() => false) ? sessionA : sessionB;
}

async function advancePhaseOnce(session: AuditSession, label: string): Promise<ActionTiming> {
  const currentPhase = await readPhase(session.page);
  const currentIndex = PHASES.indexOf(currentPhase);
  const expectedPhase = PHASES[currentIndex + 1] ?? PHASES[0];
  return measureRuntimeAction(
    session,
    `${label}: ${currentPhase} to ${expectedPhase}`,
    'turn.changed',
    async () => session.page.getByTestId('advance-phase').click(),
    async () => expect.poll(async () => readPhase(session.page), { timeout: POLL_TIMEOUT }).toBe(expectedPhase),
  );
}

async function passTurn(active: AuditSession, next: AuditSession, label: string): Promise<ActionTiming[]> {
  const timings: ActionTiming[] = [];
  for (let index = 0; index < PHASES.length; index += 1) {
    const wasActive = await active.page.getByTestId('pass-turn').isVisible().catch(() => false);
    if (!wasActive) {
      break;
    }
    timings.push(await advancePhaseOnce(active, `${label} step ${index + 1}`));
    const switched = await next.page.getByTestId('pass-turn').isVisible().catch(() => false);
    if (switched) {
      break;
    }
  }

  await expect.poll(async () => active.page.getByTestId('pass-turn').isVisible().catch(() => false), {
    timeout: POLL_TIMEOUT,
  }).toBe(false);
  await expect.poll(async () => next.page.getByTestId('pass-turn').isVisible().catch(() => false), {
    timeout: POLL_TIMEOUT,
  }).toBe(true);

  return timings;
}

async function removeLife(page: Page, displayName: string): Promise<void> {
  const escapedName = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const button = page.getByRole('button', { name: new RegExp(`^Remove 1 life from ${escapedName}`) });
  await expect(button).toBeVisible({ timeout: POLL_TIMEOUT });
  await button.click();
}

async function revealHand(page: Page, playerId: string): Promise<void> {
  const handArea = page.locator(`[data-testid="hand-area"][data-player-id="${playerId}"]`);
  await handArea.locator('.hand-hover-strip').hover();
  await expect(handArea).toHaveClass(/hand-revealed/, { timeout: POLL_TIMEOUT });
}

async function readPhase(page: Page): Promise<string> {
  return (await page.locator('[data-testid="phase-step"][aria-current="step"]').getAttribute('data-phase')) ?? '';
}

async function readFocusedLife(page: Page, playerId: string): Promise<number> {
  const raw = ((await page
    .locator(`[data-testid="focused-player-life"] [data-testid="life-value"][data-player-id="${playerId}"]`)
    .first()
    .textContent({ timeout: 750 })) ?? '').trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Could not parse focused life value "${raw}" for ${playerId}.`);
  }

  return parsed;
}

async function handCardIds(page: Page, playerId: string): Promise<string[]> {
  return page
    .locator(`[data-testid="hand-zone"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="hand"]`)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-card-instance-id') ?? '').filter(Boolean));
}

async function findNewHandCard(page: Page, playerId: string, beforeIds: readonly string[]) {
  const selector = `[data-testid="hand-zone"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="hand"]`;
  await expect.poll(async () => {
    const ids = await handCardIds(page, playerId);
    return ids.find((id) => !beforeIds.includes(id)) ?? '';
  }, { timeout: POLL_TIMEOUT }).not.toBe('');
  const afterIds = await handCardIds(page, playerId);
  const newId = afterIds.find((id) => !beforeIds.includes(id));
  if (!newId) {
    throw new Error('Expected a newly drawn hand card id.');
  }

  return page.locator(`${selector}[data-card-instance-id="${newId}"]`);
}

async function moveHandCardToBattlefieldViaMenu(page: Page, handCard: Locator): Promise<void> {
  await handCard.click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible({ timeout: POLL_TIMEOUT });
  await menu.getByRole('button', { name: /move to|mover/i }).click();
  await menu.getByRole('menuitem', { name: /battlefield|campo/i }).click();
}

async function requiredAttribute(locator: Locator, name: string): Promise<string> {
  const value = await locator.getAttribute(name);
  if (!value) {
    throw new Error(`Missing required attribute ${name}.`);
  }

  return value;
}

function battlefieldCardSelector(playerId: string, instanceId: string): string {
  return `[data-testid="battlefield-zone"][data-player-id="${playerId}"] [data-card-instance-id="${instanceId}"]`;
}

async function hasBootstrapLog(page: Page, reason: string): Promise<boolean> {
  return hasRealtimeLog(page, {
    source: 'bootstrap',
    reason,
    result: 'applied',
  });
}

async function hasRealtimeLog(page: Page, expected: Partial<Record<string, unknown>>): Promise<boolean> {
  const payloads = await realtimeLogPayloads(page);
  return payloads.some((payload) => Object.entries(expected).every(([key, value]) => payload[key] === value));
}

async function realtimeLogCountAll(
  sessions: readonly AuditSession[],
  expected: Partial<Record<string, unknown>>,
): Promise<number> {
  const counts = await Promise.all(sessions.map((session) => realtimeLogCount(session.page, expected)));
  return counts.reduce((total, count) => total + count, 0);
}

async function realtimeLogCount(page: Page, expected: Partial<Record<string, unknown>>): Promise<number> {
  const payloads = await realtimeLogPayloads(page);
  return payloads.filter((payload) => Object.entries(expected).every(([key, value]) => payload[key] === value)).length;
}

async function realtimeLogPayloads(page: Page): Promise<JsonObject[]> {
  return page.evaluate(() => {
    const state = window as unknown as { __commanderZoneRealtimeLogs?: Array<{ args: unknown[] }> };
    return (state.__commanderZoneRealtimeLogs ?? [])
      .map((entry) => entry.args[1])
      .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value));
  });
}

async function debugMessages(page: Page): Promise<JsonObject[]> {
  return page.evaluate(() => {
    const state = window as unknown as { __commanderZoneDebugMessages?: unknown[] };
    return (state.__commanderZoneDebugMessages ?? [])
      .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value));
  });
}

async function runtimeSocketEvents(page: Page): Promise<JsonObject[]> {
  return page.evaluate(() => {
    const state = window as unknown as { __commanderZoneRuntimeSocketEvents?: unknown[] };
    return (state.__commanderZoneRuntimeSocketEvents ?? [])
      .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value));
  });
}

function relevantConsoleIssues(entries: readonly ConsoleEntry[]): ConsoleEntry[] {
  return entries.filter((entry) =>
    entry.type === 'pageerror'
    || /commanderzone gameplay|websocket|\/ws|runtime|resync|refetch|fallback/i.test(entry.text),
  );
}

function frameCommandType(message: JsonObject): CommandType | null {
  if (message['kind'] === 'command.v2' && typeof message['type'] === 'string') {
    return message['type'] as CommandType;
  }
  if (message['kind'] === 'mulligan.keep') {
    return 'mulligan.keep';
  }
  if (message['kind'] === 'command' && isObject(message['command']) && typeof message['command']['type'] === 'string') {
    return message['command']['type'] as CommandType;
  }

  return null;
}

function commandCorrelationId(message: JsonObject): string | null {
  if (message['kind'] === 'command.v2') {
    return stringField(message, 'clientActionId') ?? stringField(message, 'messageId');
  }
  if (message['kind'] === 'mulligan.keep') {
    return stringField(message, 'messageId');
  }
  if (message['kind'] === 'command' && isObject(message['command'])) {
    return stringField(message['command'], 'clientActionId') ?? stringField(message, 'messageId');
  }

  return null;
}

function patchCorrelationId(message: JsonObject): string | null {
  return stringField(message, 'ackClientActionId') ?? stringField(message, 'clientActionId') ?? stringField(message, 'messageId');
}

function patchFrameTime(frames: readonly WebSocketFrame[], patch: JsonObject): number {
  const frame = frames.find((candidate) => candidate.payload === patch);
  return frame?.at ?? Date.now();
}

function hasOp(message: JsonObject, op: string): boolean {
  return patchOps(message).some((item) => item['op'] === op);
}

function patchOps(message: JsonObject): JsonObject[] {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.filter(isObject);
}

function arrayField(value: JsonObject, field: string): unknown[] {
  const raw = value[field];
  return Array.isArray(raw) ? raw : [];
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

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: JsonObject, field: string): string | null {
  const raw = value[field];
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

function numericField(value: JsonObject, field: string): number | null {
  const raw = value[field];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberField(value: JsonObject | undefined, field: string): number {
  if (!value) {
    return 0;
  }
  const parsed = Number(value[field] ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nestedNumber(value: JsonObject | undefined, path: string[]): number {
  let current: unknown = value;
  for (const key of path) {
    if (!isObject(current)) {
      return 0;
    }
    current = current[key];
  }
  const parsed = Number(current ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickMetrics(source: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(keys.map((key) => [key, source[key] ?? null]));
}
