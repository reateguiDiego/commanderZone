import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks } from './support/commander-game';
import { focusPlayer } from './support/game-table';

const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;

interface NetworkAudit {
  snapshotReloads: number;
  commandFallbacks: number;
  socketUrls: string[];
  ticketRoutes: string[];
}

test.setTimeout(180_000);

test('runtime websocket patches do not refetch on normal commands and resync only after a real version gap', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  await assertGameRuntimeReady(request);
  const setup = await createCommanderGameWithBasicDecks(request, {
    playerAPrefix: 'audit-a',
    playerBPrefix: 'audit-b',
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
    addRealtimeAuditInstrumentation(contextA),
    addRealtimeAuditInstrumentation(contextB),
  ]);
  const patchDrop = await routeRuntimePatchDrop(contextB);

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const networkA = collectNetworkAudit(pageA, gameId);
    const networkB = collectNetworkAudit(pageB, gameId);
    const framesA = collectWebSocketFrames(pageA);
    const framesB = collectWebSocketFrames(pageB);

    await test.step('connect both browser sessions to runtime websocket', async () => {
      await Promise.all([pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
      await Promise.all([
        expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        waitForGameplayConnection(framesA, 1),
        waitForGameplayConnection(framesB, 1),
      ]);
      await Promise.all([
        expect.poll(() => networkA.ticketRoutes.includes('runtime_ws'), { timeout: 10_000 }).toBe(true),
        expect.poll(() => networkB.ticketRoutes.includes('runtime_ws'), { timeout: 10_000 }).toBe(true),
      ]);
      await resolveMulliganToPlayingInBrowser(pageA, pageB, framesA, framesB);
      await Promise.all([
        focusPlayer(pageA, playerA.user.displayName),
        focusPlayer(pageB, playerA.user.displayName),
      ]);
      await expect.poll(() => hasBootstrapLog(pageB, 'initial_load'), { timeout: 10_000 }).toBe(true);
    });

    const baselineReloads = networkA.snapshotReloads + networkB.snapshotReloads;
    const baselineFallbackCommands = networkA.commandFallbacks + networkB.commandFallbacks;
    const baselineRefetchStartedB = await realtimeLogCount(pageB, { result: 'refetch_started' });
    const baselineSnapshotReloadB = await realtimeLogCount(pageB, { source: 'snapshot_reload' });
    const baselineFallbackLogB = await realtimeLogCount(pageB, { source: 'fallback HTTP' });
    const firstPatchStartA = framesA.length;
    const firstPatchStartB = framesB.length;

    const firstPatchA = await test.step('apply a normal command by patch without refetch', async () => {
      await removeLife(pageA, playerA.user.displayName);
      const patch = await waitForPatchV2After(framesA, firstPatchStartA, (candidate) => hasOp(candidate, 'player.life.set'));
      await waitForPatchV2After(framesB, firstPatchStartB, (candidate) => Number(candidate['version']) === Number(patch['version']));
      return patch;
    });

    await expect.poll(() => hasRealtimeLog(pageB, {
      source: 'handlePatchV2',
      result: 'applied',
      incomingPatchVersion: Number(firstPatchA['version']),
    }), { timeout: 10_000 }).toBe(true);
    expect(networkA.snapshotReloads + networkB.snapshotReloads).toBe(baselineReloads);
    expect(networkA.commandFallbacks + networkB.commandFallbacks).toBe(baselineFallbackCommands);
    expectRuntimeOnly(framesA, firstPatchStartA);
    expectRuntimeOnly(framesB, firstPatchStartB);
    expect(await realtimeLogCount(pageB, { result: 'refetch_started' })).toBe(baselineRefetchStartedB);
    expect(await realtimeLogCount(pageB, { source: 'snapshot_reload' })).toBe(baselineSnapshotReloadB);
    expect(await realtimeLogCount(pageB, { source: 'fallback HTTP' })).toBe(baselineFallbackLogB);

    const reconnectBaselineReloads = networkA.snapshotReloads + networkB.snapshotReloads;
    const reconnectBaselineRefetchStartedB = await realtimeLogCount(pageB, { result: 'refetch_started' });
    const reconnectBaselineSnapshotReloadB = await realtimeLogCount(pageB, { source: 'snapshot_reload' });
    const reconnectBaselineFallbackCommands = networkA.commandFallbacks + networkB.commandFallbacks;
    await test.step('reconnect with current lastAppliedVersion and no refetch', async () => {
      const reconnectFrameStartB = framesB.length;
      await closeLatestRuntimeSocket(pageB);
      await waitForGameplayConnection(framesB, 2);
      await expect.poll(() => latestSocketLastAppliedVersion(networkB), { timeout: 10_000 })
        .toBe(Number(firstPatchA['version']));
      expect(networkA.snapshotReloads + networkB.snapshotReloads).toBe(reconnectBaselineReloads);
      expect(networkA.commandFallbacks + networkB.commandFallbacks).toBe(reconnectBaselineFallbackCommands);
      expect(framesB.slice(reconnectFrameStartB).some((message) => message['kind'] === 'resync_required')).toBe(false);
      await expect.poll(() => hasRealtimeLog(pageB, { source: 'reconnect', result: 'reconnected' }), { timeout: 10_000 }).toBe(true);
      await expect.poll(() => hasRealtimeLog(pageB, {
        source: 'reconnect',
        reason: 'socket_reconnect',
        result: 'ticket_received',
        route: 'runtime_ws',
        lastAppliedVersion: Number(firstPatchA['version']),
      }), { timeout: 10_000 }).toBe(true);
      expect(await realtimeLogCount(pageB, { result: 'refetch_started' })).toBe(reconnectBaselineRefetchStartedB);
      expect(await realtimeLogCount(pageB, { source: 'snapshot_reload' })).toBe(reconnectBaselineSnapshotReloadB);
    });

    const historyReplayPatchA = await test.step('replay missed patch from runtime history on reconnect without resync', async () => {
      dropNextRuntimePatch(patchDrop);
      const droppedPatchStartA = framesA.length;
      const reconnectFrameStartB = framesB.length;
      const missedVersionBeforeReconnect = latestSocketLastAppliedVersion(networkB);
      const replayBaselineReloads = networkA.snapshotReloads + networkB.snapshotReloads;
      const replayBaselineFallbackCommands = networkA.commandFallbacks + networkB.commandFallbacks;
      const replayBaselineRefetchStartedB = await realtimeLogCount(pageB, { result: 'refetch_started' });
      const replayBaselineSnapshotReloadB = await realtimeLogCount(pageB, { source: 'snapshot_reload' });
      await removeLife(pageA, playerA.user.displayName);
      const patch = await waitForPatchV2After(framesA, droppedPatchStartA, (candidate) => hasOp(candidate, 'player.life.set'));
      await expect.poll(() => patchDrop.dropped, { timeout: 10_000 }).toBe(1);
      expect(Number(patch['version'])).toBeGreaterThan(Number(missedVersionBeforeReconnect));

      await closeLatestRuntimeSocket(pageB);
      await waitForGameplayConnection(framesB, 3);
      await expect.poll(() => latestSocketLastAppliedVersion(networkB), { timeout: 10_000 })
        .toBe(Number(missedVersionBeforeReconnect));
      const replayedPatch = await waitForPatchV2After(
        framesB,
        reconnectFrameStartB,
        (candidate) => Number(candidate['version']) === Number(patch['version']) && hasOp(candidate, 'player.life.set'),
      );
      expect(Number(replayedPatch['version'])).toBe(Number(patch['version']));
      await expect.poll(() => hasRealtimeLog(pageB, {
        source: 'handlePatchV2',
        result: 'applied',
        incomingPatchVersion: Number(patch['version']),
      }), { timeout: 10_000 }).toBe(true);
      expect(framesB.slice(reconnectFrameStartB).some((message) => message['kind'] === 'resync_required')).toBe(false);
      expect(networkA.snapshotReloads + networkB.snapshotReloads).toBe(replayBaselineReloads);
      expect(networkA.commandFallbacks + networkB.commandFallbacks).toBe(replayBaselineFallbackCommands);
      expect(await realtimeLogCount(pageB, { result: 'refetch_started' })).toBe(replayBaselineRefetchStartedB);
      expect(await realtimeLogCount(pageB, { source: 'snapshot_reload' })).toBe(replayBaselineSnapshotReloadB);
      return patch;
    });

    const missingGapPatchA = await test.step('drop one runtime patch without reconnect to create a real version gap', async () => {
      dropNextRuntimePatch(patchDrop);
      const missingPatchStartA = framesA.length;
      await removeLife(pageA, playerA.user.displayName);
      const patch = await waitForPatchV2After(framesA, missingPatchStartA, (candidate) => hasOp(candidate, 'player.life.set'));
      await expect.poll(() => patchDrop.dropped, { timeout: 10_000 }).toBe(1);
      return patch;
    });

    const resyncBaselineReloads = networkA.snapshotReloads + networkB.snapshotReloads;
    const gapPatchA = await test.step('require resync after a real version gap', async () => {
      const gapPatchStartA = framesA.length;
      const gapPatchStartB = framesB.length;
      await removeLife(pageA, playerA.user.displayName);
      const patch = await waitForPatchV2After(framesA, gapPatchStartA, (candidate) => hasOp(candidate, 'player.life.set'));
      await waitForPatchV2After(framesB, gapPatchStartB, (candidate) => Number(candidate['version']) === Number(patch['version']));

      await expect.poll(() => networkA.snapshotReloads + networkB.snapshotReloads, { timeout: 15_000 })
        .toBeGreaterThan(resyncBaselineReloads);
      await expect.poll(() => hasRealtimeLog(pageB, {
        source: 'handlePatchV2',
        reason: 'version_gap',
        result: 'refetch_started',
      }), { timeout: 10_000 }).toBe(true);
      await expect.poll(() => hasBootstrapLog(pageB, 'websocket.request_resync'), { timeout: 10_000 }).toBe(true);
      return patch;
    });

    expect(Number(missingGapPatchA['version'])).toBeGreaterThan(Number(historyReplayPatchA['version']));
    expect(Number(gapPatchA['version'])).toBeGreaterThan(Number(missingGapPatchA['version']));
    expect(Number(gapPatchA['version'])).toBeGreaterThan(Number(historyReplayPatchA['version']));
    expect(networkA.commandFallbacks + networkB.commandFallbacks).toBe(baselineFallbackCommands);
  } finally {
    await contextA.close().catch(() => undefined);
    await contextB.close().catch(() => undefined);
  }
});

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`Game runtime is not reachable at ${RUNTIME_READY_URL}; realtime audit must not fall back to legacy.`);
  }
}

async function removeLife(page: Page, displayName: string): Promise<void> {
  const escapedName = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const button = page.getByRole('button', { name: new RegExp(`^Remove 1 life from ${escapedName}`) });
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();
}

async function resolveMulliganToPlayingInBrowser(
  pageA: Page,
  pageB: Page,
  framesA: JsonObject[],
  framesB: JsonObject[],
): Promise<void> {
  await Promise.all([
    expect(pageA.getByTestId('mulligan-overlay')).toBeVisible({ timeout: 30_000 }),
    expect(pageB.getByTestId('mulligan-overlay')).toBeVisible({ timeout: 30_000 }),
    expect(pageA.getByTestId('mulligan-keep')).toBeEnabled({ timeout: 30_000 }),
    expect(pageB.getByTestId('mulligan-keep')).toBeEnabled({ timeout: 30_000 }),
  ]);

  const startA = framesA.length;
  const startB = framesB.length;
  await pageA.getByTestId('mulligan-keep').click();
  await Promise.all([
    waitForPatchV2After(framesA, startA, (candidate) => hasOp(candidate, 'mulligan.status.set')),
    expect(pageA.getByTestId('mulligan-ready-panel')).toBeVisible({ timeout: 30_000 }),
  ]);

  await expect(pageB.getByTestId('mulligan-keep')).toBeEnabled({ timeout: 30_000 });
  await pageB.getByTestId('mulligan-keep').click();
  await Promise.all([
    waitForPatchV2After(framesB, startB, (candidate) => hasOp(candidate, 'mulligan.status.set')),
    expect(pageA.getByTestId('mulligan-overlay')).toBeHidden({ timeout: 30_000 }),
    expect(pageB.getByTestId('mulligan-overlay')).toBeHidden({ timeout: 30_000 }),
  ]);
}

async function addRealtimeAuditInstrumentation(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');

    const state = window as unknown as {
      __commanderZoneRealtimeLogs?: Array<{ level: string; args: unknown[] }>;
      __commanderZoneRuntimeSockets?: WebSocket[];
    };
    state.__commanderZoneRealtimeLogs = [];
    state.__commanderZoneRuntimeSockets = [];

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
        }
      }
    }

    window.WebSocket = AuditWebSocket as typeof WebSocket;
  });
}

interface RuntimePatchDropControl {
  remaining: number;
  dropped: number;
}

async function routeRuntimePatchDrop(context: BrowserContext): Promise<RuntimePatchDropControl> {
  const control: RuntimePatchDropControl = { remaining: 0, dropped: 0 };
  await context.routeWebSocket((url) => url.pathname.endsWith('/ws'), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      server.send(message);
    });
    server.onMessage((message) => {
      if (control.remaining > 0 && isPatchV2Message(message)) {
        control.remaining -= 1;
        control.dropped += 1;
        return;
      }

      ws.send(message);
    });
  });

  return control;
}

function collectNetworkAudit(page: Page, gameId: string): NetworkAudit {
  const audit: NetworkAudit = { snapshotReloads: 0, commandFallbacks: 0, socketUrls: [], ticketRoutes: [] };
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'GET' && (url.includes(`/games/${gameId}/snapshot`) || url.includes(`/games/${gameId}/bootstrap`))) {
      audit.snapshotReloads += 1;
    }
    if (request.method() === 'POST' && url.includes(`/games/${gameId}/commands`)) {
      audit.commandFallbacks += 1;
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    if (request.method() !== 'POST' || !response.url().includes(`/games/${gameId}/websocket-ticket`)) {
      return;
    }

    void response.json().then((payload: unknown) => {
      if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
        const route = (payload as JsonObject)['route'];
        if (typeof route === 'string') {
          audit.ticketRoutes.push(route);
        }
      }
    }).catch(() => undefined);
  });
  page.on('websocket', (socket) => {
    audit.socketUrls.push(socket.url());
  });

  return audit;
}

function collectWebSocketFrames(page: Page): JsonObject[] {
  const frames: JsonObject[] = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) {
        frames.push(parsed);
      }
    });
  });
  return frames;
}

async function waitForGameplayConnection(frames: JsonObject[], count: number): Promise<void> {
  await expect.poll(() => frames.filter((message) =>
    message['kind'] === 'connection_state' && message['status'] === 'connected',
  ).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(count);
}

function waitForPatchV2After(frames: JsonObject[], startIndex: number, predicate: (message: JsonObject) => boolean): Promise<JsonObject> {
  return expect.poll(() => frames.slice(startIndex).find((message) => message['kind'] === 'patch.v2' && predicate(message)) ?? null, {
    timeout: 20_000,
  }).not.toBeNull().then(() => {
    const patch = frames.slice(startIndex).find((message) => message['kind'] === 'patch.v2' && predicate(message));
    if (!patch) {
      throw new Error(`patch.v2 frame was not captured. Recent frames: ${JSON.stringify(frames.slice(startIndex).slice(-8), null, 2)}`);
    }
    return patch;
  });
}

async function closeLatestRuntimeSocket(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as unknown as { __commanderZoneRuntimeSockets?: WebSocket[] };
    const socket = [...(state.__commanderZoneRuntimeSockets ?? [])].reverse().find((candidate) => candidate.readyState === WebSocket.OPEN);
    if (!socket) {
      throw new Error('No open runtime WebSocket was available to close.');
    }
    socket.close();
  });
}

function dropNextRuntimePatch(control: RuntimePatchDropControl): void {
  control.remaining = 1;
  control.dropped = 0;
}

function latestSocketLastAppliedVersion(audit: NetworkAudit): number | null {
  for (const url of [...audit.socketUrls].reverse()) {
    try {
      const value = Number(new URL(url).searchParams.get('lastAppliedVersion'));
      if (Number.isFinite(value) && value >= 1) {
        return value;
      }
    } catch {
      continue;
    }
  }

  return null;
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

function expectRuntimeOnly(frames: JsonObject[], startIndex: number): void {
  const recent = frames.slice(startIndex);
  expect(recent.some((message) => message['kind'] === 'game_patch')).toBe(false);
  expect(recent.some((message) => message['kind'] === 'resync_required')).toBe(false);
}

function hasOp(message: JsonObject, op: string): boolean {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.some((item) => item['op'] === op);
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

function isPatchV2Message(message: string | Buffer): boolean {
  const parsed = parseFrame(message);
  return parsed?.['kind'] === 'patch.v2';
}
