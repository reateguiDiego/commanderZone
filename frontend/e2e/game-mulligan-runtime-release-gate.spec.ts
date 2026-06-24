import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks } from './support/commander-game';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type MulliganRuntimeSetup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;

test.describe('mulligan runtime release gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: MulliganRuntimeSetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await assertGameRuntimeReady(request);
    setup = await createCommanderGameWithBasicDecks(request, {
      playerAPrefix: 'mulligan-runtime-a',
      playerBPrefix: 'mulligan-runtime-b',
    });
  });

  test('browser session applies mulligan runtime patch.v2 without snapshot refetch', async ({ browser, request, baseURL }) => {
    test.setTimeout(120_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const { gameId, playerA } = setup;
    const context = await browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
    });
    await enableFrontendGameplayV2(context);

    try {
      const debug = await openDebugObserver(context, request, gameId, playerA.token);
      const page = await context.newPage();
      const diagnostics = collectPageDiagnostics(page, gameId);
      const frames = collectWebSocketFrames(page);
      let snapshotRefetches = 0;
      page.on('request', (httpRequest) => {
        const url = httpRequest.url();
        if (httpRequest.method() === 'GET' && (url.includes(`/games/${gameId}/snapshot`) || url.includes(`/games/${gameId}/bootstrap`))) {
          snapshotRefetches += 1;
        }
      });

      await page.goto(`/games/${gameId}`);
      try {
        await expect(page.locator('.game-screen')).toBeVisible({ timeout: 30_000 });
      } catch (error) {
        throw new Error(`${String(error)}\n\nDiagnostics:\n${diagnostics.join('\n')}\nURL: ${page.url()}\nBody:\n${(await page.locator('body').innerText()).slice(0, 2000)}`);
      }
      try {
        await expect(page.getByTestId('mulligan-overlay')).toBeVisible({ timeout: 30_000 });
      } catch (error) {
        throw new Error(`${String(error)}\n\nDiagnostics:\n${diagnostics.join('\n')}\nURL: ${page.url()}\nBody:\n${(await page.locator('body').innerText()).slice(0, 2000)}`);
      }
      await expect(page.getByTestId('mulligan-take')).toBeEnabled();
      await waitForGameplayConnection(frames);

      const snapshotBaseline = snapshotRefetches;
      const takePatch = waitForPatchV2(frames, (patch) => hasOp(patch, 'mulligan.hand.replace_private'));
      await page.getByTestId('mulligan-take').click();
      const take = await takePatch;

      expect(take.kind).toBe('patch.v2');
      expect(hasOp(take, 'mulligan.hand.replace_private')).toBe(true);
      await expect(page.locator('.mulligan-card')).toHaveCount(7);
      if (await page.getByTestId('mulligan-bottom-selection').isVisible().catch(() => false)) {
        await page.locator('.bottom-card-action').first().click();
      }
      try {
        await expect(page.getByTestId('mulligan-keep')).toBeEnabled();
      } catch (error) {
        const patchFrames = frames.filter((frame) => frame['kind'] === 'patch.v2');
        throw new Error(`${String(error)}\nPatch frames:\n${JSON.stringify(patchFrames, null, 2)}\nOverlay:\n${await page.getByTestId('mulligan-overlay').innerText()}`);
      }
      expect(snapshotRefetches).toBe(snapshotBaseline);

      const keepPatch = waitForPatchV2(frames, (patch) => hasOp(patch, 'mulligan.status.set'));
      await page.getByTestId('mulligan-keep').click();
      await keepPatch;
      await expect(page.getByTestId('mulligan-ready-panel')).toBeVisible();
      expect(snapshotRefetches).toBe(snapshotBaseline);

      const health = await waitForActionHealth(debug.frames, 'mulligan.take');
      const phases = latestActionPhases(health, 'mulligan.take');
      expect(phases).not.toBeNull();
      if (!phases) {
        throw new Error('Missing mulligan.take phases in debug health.');
      }
      expect(phases['mulligan.runtime_route']).toBe(1);
      expect(phases['mulligan.runtime_fallback_count']).toBe(0);
      expect(phases['mulligan.runtime_error_count']).toBe(0);
      expect(debugHealthHasPatchV2(health)).toBe(true);

      await debug.page.close();
    } finally {
      await context.close();
    }
  });

  test('runtime mulligan error returns controlled fallback response over real websocket', async ({ browser, request, baseURL }) => {
    test.setTimeout(60_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const { gameId, playerB } = setup;
    const context = await browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken),
    });
    await enableFrontendGameplayV2(context);

    try {
      const debug = await openDebugObserver(context, request, gameId, playerB.token);
      const ticket = await websocketTicket(request, gameId, playerB.token);
      const response = await sendRawWebSocketMessage(context, ticket.websocketUrl, {
        kind: 'mulligan.scry.confirm',
        gameId,
        messageId: `e2e-invalid-scry-${Date.now()}`,
        destination: 'TOP',
      }, 'mulligan.error');

      expect(response.kind).toBe('mulligan.error');
      expect(['SCRY_NOT_ALLOWED', 'INVALID_MULLIGAN_STATE']).toContain((response.error as JsonObject | undefined)?.['code']);

      const health = await waitForActionHealth(debug.frames, 'mulligan.scry.confirm');
      const phases = latestActionPhases(health, 'mulligan.scry.confirm');
      expect(phases).not.toBeNull();
      if (!phases) {
        throw new Error('Missing mulligan.scry.confirm phases in debug health.');
      }
      expect(phases['mulligan.runtime_route']).toBe(0);
      expect(phases['mulligan.runtime_fallback_count']).toBe(1);
      expect(phases['mulligan.runtime_error_count']).toBe(1);

      await debug.page.close();
    } finally {
      await context.close();
    }
  });
});

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

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

function collectPageDiagnostics(page: Page, gameId: string): string[] {
  const diagnostics: string[] = [];
  const track = (line: string): void => {
    diagnostics.push(line);
    if (diagnostics.length > 80) {
      diagnostics.shift();
    }
  };

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      track(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => track(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => track(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));
  page.on('response', async (response) => {
    const url = response.url();
    const isRelevant = url.includes('/auth/refresh')
      || url.includes('/me')
      || url.includes(`/games/${gameId}/snapshot`)
      || url.includes(`/games/${gameId}/bootstrap`)
      || url.includes(`/games/${gameId}/websocket-ticket`);
    if (isRelevant || response.status() >= 400) {
      track(`response: ${response.status()} ${url}`);
    }
  });

  return diagnostics;
}

async function openDebugObserver(
  context: BrowserContext,
  request: APIRequestContext,
  gameId: string,
  token: string,
): Promise<{ page: Page; frames: JsonObject[] }> {
  const ticket = await websocketTicket(request, gameId, token);
  const debugUrl = debugWebsocketUrl(ticket.websocketUrl, gameId);
  const debugPage = await context.newPage();
  const frames = collectWebSocketFrames(debugPage);
  await debugPage.goto('about:blank');
  await debugPage.evaluate((url) => {
    const socket = new WebSocket(url);
    (window as unknown as { __commanderZoneDebugSocket?: WebSocket }).__commanderZoneDebugSocket = socket;
  }, debugUrl);
  await expect.poll(() => frames.some((message) => message['kind'] === 'debug_health'), { timeout: 15_000 }).toBe(true);

  return { page: debugPage, frames };
}

function debugWebsocketUrl(websocketUrl: string, gameId: string): string {
  const url = new URL(websocketUrl);
  const basePath = url.pathname.replace(/\/games\/[^/]+\/?$/, '');
  const nextPath = `${basePath}/games/${encodeURIComponent(gameId)}/debug`;
  url.pathname = nextPath.replace(/\/{2,}/g, '/');
  url.searchParams.delete('lastSeenVersion');

  return url.toString();
}

async function waitForActionHealth(frames: JsonObject[], action: string): Promise<JsonObject> {
  await expect.poll(() => {
    const last = latestDebugHealth(frames);
    return last ? latestActionPhases(last, action) !== null : false;
  }, { timeout: 15_000 }).toBe(true);

  const last = latestDebugHealth(frames);
  if (!last) {
    throw new Error('No debug_health frame was captured.');
  }

  return last;
}

function latestDebugHealth(frames: JsonObject[]): JsonObject | null {
  return frames.filter((message) => message['kind'] === 'debug_health').at(-1) ?? null;
}

function latestActionPhases(health: JsonObject, action: string): JsonObject | null {
  const recent = (((health.health as JsonObject | undefined)?.['actions'] as JsonObject | undefined)?.['recent'] ?? []) as JsonObject[];
  const match = recent.filter((item) => item['action'] === action).at(-1);
  return (match?.['phases'] as JsonObject | undefined) ?? null;
}

function debugHealthHasPatchV2(health: JsonObject): boolean {
  const recent = (((health.health as JsonObject | undefined)?.['actions'] as JsonObject | undefined)?.['recent'] ?? []) as JsonObject[];
  return recent.some((item) => {
    const outgoing = item['outgoing'] as JsonObject | undefined;
    const byKind = outgoing?.['byKind'] as JsonObject | undefined;
    return byKind?.['patch.v2'] === 1 || Number(byKind?.['patch.v2'] ?? 0) > 0;
  });
}

function waitForPatchV2(frames: JsonObject[], predicate: (message: JsonObject) => boolean): Promise<JsonObject> {
  return expect.poll(() => frames.find((message) => message['kind'] === 'patch.v2' && predicate(message)) ?? null, {
    timeout: 15_000,
  }).not.toBeNull().then(() => {
    const patch = frames.find((message) => message['kind'] === 'patch.v2' && predicate(message));
    if (!patch) {
      throw new Error('patch.v2 frame was not captured.');
    }

    return patch;
  }, (error) => {
    const kinds = frames.map((message) => String(message['kind'] ?? 'unknown')).join(', ');
    throw new Error(`${String(error)}\nReceived frames: ${kinds}`);
  });
}

async function waitForGameplayConnection(frames: JsonObject[]): Promise<void> {
  await expect.poll(() => frames.some((message) =>
    message['kind'] === 'connection_state' && message['status'] === 'connected',
  ), { timeout: 20_000 }).toBe(true);
}

function hasOp(message: JsonObject, op: string): boolean {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.some((operation) => operation['op'] === op);
}

async function websocketTicket(request: APIRequestContext, gameId: string, token: string): Promise<{ websocketUrl: string }> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { websocketUrl?: string };
  if (!payload.websocketUrl) {
    throw new Error('WebSocket ticket response did not include websocketUrl.');
  }

  return { websocketUrl: payload.websocketUrl };
}

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`Game runtime is not reachable at ${RUNTIME_READY_URL}; runtime release gates must not fall back to legacy.`);
  }
}

async function sendRawWebSocketMessage(
  context: BrowserContext,
  websocketUrl: string,
  message: JsonObject,
  expectedKind: string,
): Promise<JsonObject> {
  const page = await context.newPage();
  try {
    return await page.evaluate(
      ({ url, payload, kind }) => new Promise<JsonObject>((resolve, reject) => {
        const socket = new WebSocket(url);
        const timeout = window.setTimeout(() => {
          socket.close();
          reject(new Error(`Timed out waiting for ${kind}`));
        }, 15_000);
        socket.onopen = () => socket.send(JSON.stringify(payload));
        socket.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error('Raw WebSocket connection failed.'));
        };
        socket.onmessage = (event) => {
          try {
            const parsed = JSON.parse(String(event.data)) as JsonObject;
            if (parsed['kind'] === kind) {
              window.clearTimeout(timeout);
              socket.close();
              resolve(parsed);
            }
          } catch (error) {
            window.clearTimeout(timeout);
            socket.close();
            reject(error);
          }
        };
      }),
      { url: websocketUrl, payload: message, kind: expectedKind },
    );
  } finally {
    await page.close();
  }
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}
