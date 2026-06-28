import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { drawMine, focusPlayer, readTableLife } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];

type JsonObject = Record<string, unknown>;
type CardSearchItem = {
  scryfallId: string;
  name: string;
  typeLine?: string | null;
  colorIdentity?: string[];
  commanderLegal?: boolean;
};
type CommanderColorSetup = {
  gameId: string;
  roomId: string;
  playerA: RealUserSession & {
    deck: {
      deckId: string;
      commander: {
        name: string;
        colorIdentity: string[];
      };
    };
  };
  playerB: RealUserSession & {
    deck: BasicCommanderDeckFromDatabaseResult;
  };
};

test.describe('commander color identity runtime gate', () => {
  test('multicolor commander identity survives live patches and reload', async ({ browser, request, baseURL }) => {
    test.setTimeout(240_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }
    await assertGameRuntimeReady(request);

    const setup = await createMulticolorCommanderGame(request);
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);

    const expectedColors = canonicalColors(setup.playerA.deck.commander.colorIdentity);
    expect(expectedColors.length, `Commander fixture must be multicolor: ${setup.playerA.deck.commander.name}`).toBeGreaterThan(1);
    expect(expectedColors).not.toEqual(['W']);

    const initialSnapshotColors = canonicalColors(await playerColorIdentity(request, setup.gameId, setup.playerA.token, setup.playerA.user.id));
    expect(initialSnapshotColors).toEqual(expectedColors);

    const context = await browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, setup.playerA.user, setup.playerA.refreshToken),
    });
    await enableFrontendGameplayV2(context);

    try {
      const page = await context.newPage();
      const frames = collectWebSocketFrames(page);
      await page.goto(`/games/${setup.gameId}`);
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await waitForGameplayConnection(frames);
      await focusPlayer(page, setup.playerA.user.displayName);

      await expectManaSymbols(page, setup.playerA.user.displayName, expectedColors);

      const lifeBefore = await readTableLife(page, setup.playerA.user.displayName);
      await playerSummary(page, setup.playerA.user.displayName).getByTestId('life-decrease').click();
      await expect.poll(async () => readTableLife(page, setup.playerA.user.displayName), { timeout: 20_000 }).toBe(lifeBefore - 1);
      await expectManaSymbols(page, setup.playerA.user.displayName, expectedColors);

      await drawMine(page);
      await expectManaSymbols(page, setup.playerA.user.displayName, expectedColors);

      const liveSnapshotColors = canonicalColors(await playerColorIdentity(request, setup.gameId, setup.playerA.token, setup.playerA.user.id));
      expect(liveSnapshotColors).toEqual(expectedColors);

      await page.reload();
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayer(page, setup.playerA.user.displayName);
      await expectManaSymbols(page, setup.playerA.user.displayName, expectedColors);

      expect(frames.some((message) => message['kind'] === 'game_patch')).toBe(false);
      expect(frames.some((message) => message['kind'] === 'resync_required')).toBe(false);
    } finally {
      await context.close();
    }
  });
});

async function createMulticolorCommanderGame(request: APIRequestContext): Promise<CommanderColorSetup> {
  const runId = `colors${Date.now().toString(36)}`;
  const [playerA, playerB] = await Promise.all([
    createRealUserSession(request, `color-a-${runId}`),
    createRealUserSession(request, `color-b-${runId}`),
  ]);
  const commander = await findCatalogCard(request, 'Kenrith', (card) =>
    card.name === 'Kenrith, the Returned King'
    && card.commanderLegal === true
    && canonicalColors(card.colorIdentity ?? []).length > 1,
  );
  const plains = await findCatalogCard(request, 'Plains', (card) =>
    (card.typeLine ?? '').toLowerCase().includes('basic land')
    && canonicalColors(card.colorIdentity ?? []).includes('W'),
  );

  const [deckA, deckB] = await Promise.all([
    createQuickBuildDeck(request, playerA.token, `Kenrith ${runId.slice(-8)}`, commander, plains),
    createBasicCommanderDeckFromDatabase(request, {
      ownerToken: playerB.token,
      name: `Basic ${runId.slice(-8)}`,
    }),
  ]);
  const roomId = await createRoom(request, playerA.token, deckA.deckId, `Color RC ${runId}`);
  await joinRoom(request, playerB.token, roomId, deckB.deckId);
  await resolveTurnOrder(request, roomId, [playerA.token, playerB.token]);
  const gameId = await startRoom(request, playerA.token, roomId);

  return {
    gameId,
    roomId,
    playerA: { ...playerA, deck: deckA },
    playerB: { ...playerB, deck: deckB },
  };
}

async function findCatalogCard(
  request: APIRequestContext,
  query: string,
  predicate: (card: CardSearchItem) => boolean,
): Promise<CardSearchItem> {
  const response = await request.get(`${API_BASE_URL}/cards/search?q=${encodeURIComponent(query)}&limit=20&commanderLegal=true`);
  await expectApiOk(response, `search ${query}`);
  const payload = await response.json() as { data?: CardSearchItem[] };
  const card = (payload.data ?? []).find(predicate);
  if (!card) {
    throw new Error(`Could not find required E2E catalog card for query "${query}".`);
  }

  return card;
}

async function createQuickBuildDeck(
  request: APIRequestContext,
  token: string,
  name: string,
  commander: CardSearchItem,
  basicLand: CardSearchItem,
): Promise<CommanderColorSetup['playerA']['deck']> {
  const response = await request.post(`${API_BASE_URL}/decks/quick-build`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name,
      cards: [
        { scryfallId: commander.scryfallId, quantity: 1, section: 'commander' },
        { scryfallId: basicLand.scryfallId, quantity: 99, section: 'main' },
      ],
    },
  });
  await expectApiOk(response, 'quick-build multicolor deck');
  const payload = await response.json() as { deck?: { id?: string } };
  const deckId = String(payload.deck?.id ?? '');
  if (deckId === '') {
    throw new Error('Quick-build response did not include deck id.');
  }

  return {
    deckId,
    commander: {
      name: commander.name,
      colorIdentity: commander.colorIdentity ?? [],
    },
  };
}

async function createRoom(request: APIRequestContext, token: string, deckId: string, name: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      deckId,
      visibility: 'public',
      name,
      format: 'commander',
      maxPlayers: 2,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create room');
  const payload = await response.json() as { room?: { id?: string } };
  const roomId = String(payload.room?.id ?? '');
  if (roomId === '') {
    throw new Error('Create room response did not include room id.');
  }

  return roomId;
}

async function joinRoom(request: APIRequestContext, token: string, roomId: string, deckId: string): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { deckId },
  });
  await expectApiOk(response, 'join room');
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokens[0] ?? ''}` },
    });
    await expectApiOk(roomResponse, 'load room turn order');
    const payload = await roomResponse.json() as { room?: { players?: Array<{ turnRolls?: number[] }> } };
    if ((payload.room?.players ?? []).every((player) => Array.isArray(player.turnRolls) && player.turnRolls.length > 0)) {
      return;
    }

    for (const token of tokens) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok() || response.status() === 409) {
        continue;
      }
      throw new Error(`Failed to roll turn order. HTTP ${response.status()}: ${await response.text()}`);
    }
  }

  throw new Error('Unable to resolve turn order for commander color gate.');
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'start room');
  const payload = await response.json() as { game?: { id?: string } };
  const gameId = String(payload.game?.id ?? '');
  if (gameId === '') {
    throw new Error('Start room response did not include game id.');
  }

  return gameId;
}

async function expectApiOk(response: { ok(): boolean; status(): number; text(): Promise<string> }, label: string): Promise<void> {
  if (response.ok()) {
    return;
  }

  throw new Error(`${label} failed with HTTP ${response.status()}: ${await response.text()}`);
}

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`Game runtime is not reachable at ${RUNTIME_READY_URL}; runtime gates must not fall back to legacy.`);
  }
}

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

async function playerColorIdentity(
  request: APIRequestContext,
  gameId: string,
  token: string,
  playerId: string,
): Promise<string[]> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { game?: { snapshot?: JsonObject } };
  const players = payload.game?.snapshot?.['players'] as Record<string, JsonObject> | undefined;
  const colorIdentity = players?.[playerId]?.['colorIdentity'];

  return Array.isArray(colorIdentity) ? colorIdentity.map(String) : [];
}

async function expectManaSymbols(page: Page, displayName: string, expectedColors: string[]): Promise<void> {
  await expect.poll(async () => manaSymbolCodes(page, displayName), { timeout: 20_000 }).toEqual(canonicalColors(expectedColors));
}

async function manaSymbolCodes(page: Page, displayName: string): Promise<string[]> {
  return canonicalColors(await playerManaPanel(page, displayName).locator('i').evaluateAll((elements) => elements
    .flatMap((element) => Array.from(element.classList))
    .map((className) => className.match(/^ms-([wubrg])$/)?.[1]?.toUpperCase() ?? '')
    .filter((color) => color !== '')));
}

function playerManaPanel(page: Page, displayName: string) {
  return playerSummary(page, displayName).locator('app-mana-symbols.mana-row .mana-symbols');
}

function playerSummary(page: Page, displayName: string) {
  return page.getByTestId('player-summary-panel').filter({
    has: page.getByTestId('focused-player-name').filter({ hasText: displayName }),
  }).first();
}

function canonicalColors(colors: readonly string[]): string[] {
  const unique = new Set(colors.map((color) => color.toUpperCase()).filter((color) => COLOR_ORDER.includes(color)));
  return COLOR_ORDER.filter((color) => unique.has(color));
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

async function waitForGameplayConnection(frames: JsonObject[]): Promise<void> {
  await expect.poll(() => frames.some((message) =>
    message['kind'] === 'connection_state' && message['status'] === 'connected',
  ), { timeout: 20_000 }).toBe(true);
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  try {
    const parsed = JSON.parse(typeof payload === 'string' ? payload : payload.toString());
    return typeof parsed === 'object' && parsed !== null ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}
