import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { sendRuntimeCommand, type RuntimeWebSocketCommandResult } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const API_HEALTH_URL = process.env['E2E_API_HEALTH_URL'] ?? `${API_BASE_URL}/healthz`;
const API_READY_URL = process.env['E2E_API_READY_URL'] ?? `${API_BASE_URL}/readyz`;
const WEBSOCKET_HEALTH_URL = process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz';
const WEBSOCKET_READY_URL = process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz';
const RUNTIME_HEALTH_URL = process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;

interface MechanicCardRef {
  readonly scryfallId: string;
  readonly name: string;
  readonly imageUris?: Record<string, string>;
  readonly cardFaces?: JsonObject[];
  readonly typeLine?: string | null;
  readonly oracleText?: string | null;
  readonly layout?: string | null;
}

test.describe('helper and mechanic prints gate', () => {
  test('compact helpers hydrate prints and card-like mechanics keep images without legacy fallback', async ({ browser, request, baseURL }) => {
    test.setTimeout(360_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    await Promise.all([
      assertServiceReady(request, API_HEALTH_URL, 'api healthz'),
      assertServiceReady(request, API_READY_URL, 'api readyz'),
      assertServiceReady(request, WEBSOCKET_HEALTH_URL, 'websocket healthz'),
      assertServiceReady(request, WEBSOCKET_READY_URL, 'websocket readyz'),
      assertServiceReady(request, RUNTIME_HEALTH_URL, 'game-runtime healthz'),
      assertServiceReady(request, RUNTIME_READY_URL, 'game-runtime readyz'),
    ]);

    const runId = `helpers${Date.now().toString(36)}`;
    const setup = await createCommanderGameWithBasicDecks(request, {
      runId,
      playerALanguage: 'es',
      playerBLanguage: 'es',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);

    const monarch = await mechanicCard(request, 'The Monarch');
    const dayNight = await mechanicCard(request, 'Day // Night', 'double_faced_token');
    const citysBlessing = await mechanicCard(request, "City's Blessing");
    const ring = await mechanicCard(request, 'The Ring // The Ring Tempts You', 'double_faced_token');
    const dungeon = await mechanicCard(request, 'Undercity', 'double_faced_token', 'dungeon');
    const emblem = await mechanicCard(request, 'Emblem', 'emblem', 'emblem');

    const contextA = await browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, setup.playerA.user, setup.playerA.refreshToken),
    });
    const contextB = await browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, setup.playerB.user, setup.playerB.refreshToken),
    });
    await Promise.all([enableFrontendGameplayV2(contextA), enableFrontendGameplayV2(contextB)]);

    const commandFrames: JsonObject[] = [];

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      const framesA = collectWebSocketFrames(pageA);
      const framesB = collectWebSocketFrames(pageB);
      await Promise.all([
        pageA.goto(`/games/${setup.gameId}`),
        pageB.goto(`/games/${setup.gameId}`),
      ]);
      await Promise.all([
        expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
      ]);

      let baseVersion = await gameVersion(request, setup.gameId, setup.playerA.token);

      const monarchResult = await applyRuntime(request, commandFrames, {
        gameId: setup.gameId,
        token: setup.playerA.token,
        baseVersion,
        type: 'helper.created',
        payload: {
          entityId: `helper-monarch-${runId}`,
          template: 'monarch',
          ownerPlayerId: setup.playerA.user.id,
          card: compactRef(monarch),
        },
      });
      baseVersion = monarchResult.version;
      expect(JSON.stringify(monarchResult.patch)).not.toContain('imageUris');
      await expectMechanicImage(pageA, 'The Monarch');
      await expectMechanicImage(pageB, 'The Monarch');

      const dayNightResult = await applyRuntime(request, commandFrames, {
        gameId: setup.gameId,
        token: setup.playerA.token,
        baseVersion,
        type: 'helper.created',
        payload: {
          entityId: `helper-day-night-${runId}`,
          template: 'day_night',
          card: compactRef(dayNight),
          state: { mode: 'night', createdByPlayerId: setup.playerA.user.id },
        },
      });
      baseVersion = dayNightResult.version;
      expect(JSON.stringify(dayNightResult.patch)).not.toContain('imageUris');
      await expectMechanicImage(pageA, 'Day // Night');

      const cityResult = await applyRuntime(request, commandFrames, {
        gameId: setup.gameId,
        token: setup.playerA.token,
        baseVersion,
        type: 'helper.created',
        payload: {
          entityId: `helper-city-${runId}`,
          template: 'citys_blessing',
          ownerPlayerId: setup.playerA.user.id,
          card: compactRef(citysBlessing),
        },
      });
      baseVersion = cityResult.version;
      expect(JSON.stringify(cityResult.patch)).not.toContain('imageUris');
      const cityPill = citysBlessingPill(pageA).first();
      await expect(cityPill).toBeVisible({ timeout: 15_000 });
      await cityPill.hover();
      await expect(pageA.locator('.card-preview-overlay img').first()).toBeVisible({ timeout: 15_000 });

      for (const [name, card] of [
        ['The Ring', ring],
        ['Undercity', dungeon],
        ['Helper Emblem', emblem],
      ] as const) {
        const tokenResult = await applyRuntime(request, commandFrames, {
          gameId: setup.gameId,
          token: setup.playerA.token,
          baseVersion,
          type: 'card.token.created',
          payload: {
            playerId: setup.playerA.user.id,
            quantity: 1,
            card: name === 'Helper Emblem' ? { ...fullRef(card), name: 'Helper Emblem', typeLine: 'Emblem' } : fullRef(card),
            position: { x: 0.38, y: 0.48, unit: 'ratio' },
          },
        });
        baseVersion = tokenResult.version;
        await expectBattlefieldCardImage(pageA, name);
      }

      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await expectMechanicImage(pageA, 'The Monarch');
      await expectMechanicImage(pageA, 'Day // Night');
      await expect(citysBlessingPill(pageA).first()).toBeVisible({ timeout: 15_000 });

      const reconnectContext = await browser.newContext({
        baseURL,
        storageState: await contextB.storageState(),
      });
      try {
        await enableFrontendGameplayV2(reconnectContext);
        const reconnectPage = await reconnectContext.newPage();
        const reconnectFrames = collectWebSocketFrames(reconnectPage);
        await reconnectPage.goto(`/games/${setup.gameId}`);
        await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
        await expectMechanicImage(reconnectPage, 'The Monarch');
        assertNoRuntimeFallbackFrames(reconnectFrames);
      } finally {
        await reconnectContext.close();
      }

      const removeCity = await applyRuntime(request, commandFrames, {
        gameId: setup.gameId,
        token: setup.playerA.token,
        baseVersion,
        type: 'helper.removed',
        payload: { entityId: `helper-city-${runId}` },
      });
      baseVersion = removeCity.version;
      expect(baseVersion).toBeGreaterThan(0);
      await expect(citysBlessingPill(pageA)).toHaveCount(0, { timeout: 15_000 });

      await assertNoUnknownCard(pageA);
      await assertNoFalseActionToast(pageA);
      assertNoRuntimeFallbackFrames([...framesA, ...framesB, ...commandFrames]);
    } finally {
      await Promise.all([contextA.close(), contextB.close()]);
    }
  });
});

async function mechanicCard(
  request: APIRequestContext,
  name: string,
  preferredLayout?: string,
  gameplayKind: 'token' | 'emblem' | 'dungeon' = 'token',
): Promise<MechanicCardRef> {
  const url = new URL(`${API_BASE_URL}/cards/search`);
  url.searchParams.set('q', name);
  url.searchParams.set('page', '1');
  url.searchParams.set('limit', '8');
  url.searchParams.set('lang', 'en');
  url.searchParams.set('gameplayKind', gameplayKind);
  const response = await request.get(url.toString());
  await expectApiOk(response, `search mechanic card ${name}`);
  const payload = await response.json() as { data?: MechanicCardRef[] };
  const normalized = name.toLowerCase();
  const card = (payload.data ?? []).find((candidate) =>
    candidate.name.toLowerCase() === normalized
    && (!preferredLayout || candidate.layout === preferredLayout),
  )
    ?? (payload.data ?? []).find((candidate) => candidate.name.toLowerCase() === normalized)
    ?? payload.data?.[0]
    ?? null;
  if (!card?.scryfallId || !card.name) {
    throw new Error(`Could not resolve mechanic card ${name}.`);
  }
  if (!card.imageUris || Object.keys(card.imageUris).length === 0) {
    throw new Error(`Mechanic card ${card.name} has no imageUris in catalog.`);
  }
  return card;
}

function compactRef(card: MechanicCardRef): JsonObject {
  return {
    scryfallId: card.scryfallId,
    name: card.name,
    layout: card.layout ?? null,
  };
}

function fullRef(card: MechanicCardRef): JsonObject {
  return {
    scryfallId: card.scryfallId,
    name: card.name,
    imageUris: card.imageUris,
    cardFaces: card.cardFaces ?? [],
    typeLine: card.typeLine ?? null,
    oracleText: card.oracleText ?? null,
    layout: card.layout ?? null,
  };
}

async function applyRuntime(
  request: APIRequestContext,
  frames: JsonObject[],
  options: Parameters<typeof sendRuntimeCommand>[1],
): Promise<RuntimeWebSocketCommandResult> {
  const result = await sendRuntimeCommand(request, options);
  frames.push(...result.frames);
  expect(result.patch['kind']).toBe('patch.v2');
  return result;
}

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

async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  const snapshot = await gameSnapshot(request, gameId, token);
  return Math.max(1, Number(snapshot['version'] ?? 1));
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
    socket.on('framesent', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) {
        frames.push(parsed);
      }
    });
  });
  return frames;
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

async function expectMechanicImage(page: Page, name: string): Promise<void> {
  const card = page.locator(`[data-testid="battlefield-mechanics-overlay"] [data-card-name="${cssString(name)}"]`).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  const image = card.locator('img').first();
  await expect(image).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => await image.getAttribute('src'), { timeout: 10_000 }).not.toBe('');
}

async function expectBattlefieldCardImage(page: Page, nameContains: string): Promise<void> {
  const card = page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-card-name*="${cssString(nameContains)}"]`).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  const image = card.locator('img').first();
  await expect(image).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => await image.getAttribute('src'), { timeout: 10_000 }).not.toBe('');
}

function citysBlessingPill(page: Page) {
  return page.locator('.special-entity-pill-card-backed').filter({ hasText: "City's Blessing" });
}

function cssString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
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
