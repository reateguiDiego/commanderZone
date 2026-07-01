import { expect, test, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks } from './support/commander-game';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

interface DebugNetworkAudit {
  websocketUrls: string[];
  failedRequests: string[];
  consoleErrors: string[];
  pageErrors: string[];
  commandFallbackPosts: number;
  snapshotRefetches: number;
  websocketTicketRoutes: string[];
  websocketTicketUrls: string[];
}

test.setTimeout(120_000);

test('debug page uses explicit PHP debug websocket and keeps runtime_ws gameplay ticket intact', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithBasicDecks(request, {
    playerAPrefix: 'debug-final-a',
    playerBPrefix: 'debug-final-b',
    roomVisibility: 'public',
  });
  const { gameId, playerA } = setup;
  const gameplayTicket = await websocketTicket(request, gameId, playerA.token);
  expect(gameplayTicket.route).toBe('runtime_ws');
  expect(gameplayTicket.websocketUrl).toContain('/ws');

  const context = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
  });
  const page = await context.newPage();
  const audit = collectDebugNetworkAudit(page, gameId);

  try {
    await page.goto(`/games/${gameId}/debug`);

    await expect(page.locator('main.debug-page')).toBeVisible();
    await expect(page.getByTestId('debug-http-metrics-status')).toContainText('disponibles');
    await expect(page.getByTestId('debug-live-ws-status')).toBeVisible();
    await expect(page.getByTestId('debug-gameplay-runtime-status')).toContainText('Gameplay runtime_ws');

    await expect.poll(
      () => audit.websocketUrls.find((url) => url.includes(`/games/${gameId}/debug`)) ?? null,
      { timeout: 10_000 },
    ).not.toBeNull();

    const debugWebsocketUrl = audit.websocketUrls.find((url) => url.includes(`/games/${gameId}/debug`));
    expect(debugWebsocketUrl, `Observed websocket URLs: ${audit.websocketUrls.join(', ')}`).toBeTruthy();
    expect(debugWebsocketUrl).not.toContain(':8091/ws');
    expect(debugWebsocketUrl).not.toMatch(/\/ws(?:\?|$)/);
    expect(audit.websocketUrls.some((url) => url.includes(':8091') && url.includes(`/games/${gameId}/debug`))).toBe(false);

    await expect.poll(() => audit.websocketTicketRoutes.includes('runtime_ws'), { timeout: 10_000 }).toBe(true);
    expect(audit.websocketTicketUrls.every((url) => url.includes('/ws'))).toBe(true);
    expect(audit.commandFallbackPosts).toBe(0);
    expect(audit.snapshotRefetches).toBe(0);
    expect(audit.failedRequests).toEqual([]);
    expect(audit.pageErrors).toEqual([]);
    expect(audit.consoleErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

async function websocketTicket(
  request: import('@playwright/test').APIRequestContext,
  gameId: string,
  token: string,
): Promise<{ route?: string; websocketUrl?: string }> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok()) {
    throw new Error(`Failed to create gameplay websocket ticket. HTTP ${response.status()}: ${await response.text()}`);
  }

  return (await response.json()) as { route?: string; websocketUrl?: string };
}

function collectDebugNetworkAudit(page: Page, gameId: string): DebugNetworkAudit {
  const audit: DebugNetworkAudit = {
    websocketUrls: [],
    failedRequests: [],
    consoleErrors: [],
    pageErrors: [],
    commandFallbackPosts: 0,
    snapshotRefetches: 0,
    websocketTicketRoutes: [],
    websocketTicketUrls: [],
  };

  page.on('websocket', (socket) => {
    audit.websocketUrls.push(socket.url());
  });
  page.on('requestfailed', (request) => {
    audit.failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
  });
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'POST' && url.includes(`/games/${gameId}/commands`)) {
      audit.commandFallbackPosts += 1;
    }
    if (request.method() === 'GET' && (url.includes(`/games/${gameId}/snapshot`) || url.includes(`/games/${gameId}/bootstrap`))) {
      audit.snapshotRefetches += 1;
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    if (request.method() !== 'POST' || !response.url().includes(`/games/${gameId}/websocket-ticket`)) {
      return;
    }

    void response.json().then((payload: unknown) => {
      if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
        const route = (payload as Record<string, unknown>)['route'];
        const websocketUrl = (payload as Record<string, unknown>)['websocketUrl'];
        if (typeof route === 'string') {
          audit.websocketTicketRoutes.push(route);
        }
        if (typeof websocketUrl === 'string') {
          audit.websocketTicketUrls.push(websocketUrl);
        }
      }
    }).catch(() => undefined);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      audit.consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    audit.pageErrors.push(error.message);
  });

  return audit;
}
