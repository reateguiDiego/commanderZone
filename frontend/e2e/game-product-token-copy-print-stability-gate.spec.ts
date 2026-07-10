import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { resolveGameToPlaying } from './support/commander-game';
import { sendRuntimeCommand, type RuntimeWebSocketCommandResult } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const API_READY_URL = process.env['E2E_API_READY_URL'] ?? `${API_BASE_URL}/readyz`;
const WEBSOCKET_READY_URL = process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type TokenCopyPlayer = {
  token: string;
  refreshToken: string;
  user: RealUserSession['user'];
  credentials: RealUserSession['credentials'];
  deck: BasicCommanderDeckFromDatabaseResult;
};
type TokenCopySetup = { gameId: string; roomId: string; players: TokenCopyPlayer[] };
type TokenCopyVisual = { src: string; name: string; text: string };

test.describe('token copy print stability gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: TokenCopySetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await Promise.all([
      assertServiceReady(request, API_READY_URL, 'api readyz'),
      assertServiceReady(request, WEBSOCKET_READY_URL, 'websocket readyz'),
      assertServiceReady(request, RUNTIME_READY_URL, 'game-runtime readyz'),
    ]);
    setup = await createThreePlayerGame(request, `tcprint${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
  });

  test('token copy keeps source print after time, unrelated patches, refresh and reconnect', async ({ browser, request, baseURL }) => {
    test.setTimeout(420_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const [playerA, playerB, playerC] = setup.players;
    if (!playerA || !playerB || !playerC) {
      throw new Error('Token copy print stability gate requires exactly 3 players.');
    }

    const { gameId } = setup;
    const initialSnapshotA = await gameSnapshot(request, gameId, playerA.token);
    const initialSnapshotB = await gameSnapshot(request, gameId, playerB.token);
    const handA = zoneInstanceIds(initialSnapshotA, playerA.user.id, 'hand');
    const handB = zoneInstanceIds(initialSnapshotB, playerB.user.id, 'hand');
    if (handA.length < 2 || handB.length < 2) {
      throw new Error('Token copy print stability gate requires at least two hand cards for players A and B.');
    }

    const sourcePermanentId = handA[0]!;
    const ownOtherCardId = handA[1]!;
    const otherPermanentId = handB[0]!;
    const otherCounterCardId = handB[1]!;
    let baseVersion = Math.max(1, Number(initialSnapshotA['version'] ?? 1));

    const contexts = await Promise.all([playerA, playerB, playerC].map((player) =>
      browser.newContext({ baseURL, storageState: authStorageState(baseURL, player.user, player.refreshToken) }),
    ));
    await Promise.all(contexts.map(enableFrontendGameplayV2));
    const commandFrames: JsonObject[] = [];
    const diagnostics: JsonObject[] = [];

    try {
      const [pageA, pageB, pageC] = await Promise.all(contexts.map((context) => context.newPage()));
      const framesA = collectWebSocketFrames(pageA);
      const framesB = collectWebSocketFrames(pageB);
      const framesC = collectWebSocketFrames(pageC);

      await Promise.all([
        pageA.goto(`/games/${gameId}`),
        pageB.goto(`/games/${gameId}`),
        pageC.goto(`/games/${gameId}`),
      ]);
      await Promise.all([
        expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageC.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        waitForGameplayConnection(framesA),
        waitForGameplayConnection(framesB),
        waitForGameplayConnection(framesC),
      ]);

      await test.step('create visible source and token copy with stable source image', async () => {
        const sourceMove = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.moved',
          payload: {
            playerId: playerA.user.id,
            fromZone: 'hand',
            toZone: 'battlefield',
            instanceId: sourcePermanentId,
            position: { x: 0.34, y: 0.48, unit: 'ratio' },
          },
        });
        baseVersion = sourceMove.version;
        await expect(battlefieldCard(pageA, playerA.user.id, sourcePermanentId)).toBeVisible({ timeout: 15_000 });
        const sourceVisual = await expectRenderableCard(pageA, playerA.user.id, sourcePermanentId, 'source-after-move');

        const copy = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.token_copy.created',
          payload: { playerId: playerA.user.id, instanceId: sourcePermanentId, targetPlayerId: playerA.user.id },
        });
        baseVersion = copy.version;
        const copyId = firstAddedCardId(copy.patch);
        const copyAdd = operation(copy.patch, 'zone.cards.add');
        expect(JSON.stringify(copyAdd)).not.toContain('imageUris');
        expect(JSON.stringify(copyAdd)).not.toContain('cardFaces');
        expect(JSON.stringify(copyAdd)).toContain('copiedFromCardKey');

        const expected = await expectTokenCopyStable(pageA, playerA.user.id, copyId, sourceVisual, 'copy-created');
        diagnostics.push(tokenCopyDiagnostic('copy-created', copy.patch, expected));
        await focusPlayerById(pageB, playerA.user.id);
        await expectTokenCopyStable(pageB, playerA.user.id, copyId, expected, 'copy-visible-to-b');

        const context = tokenCopyContext as TokenCopyRuntimeContext;
        context.copyId = copyId;
        context.expected = expected;
      });

      const context = tokenCopyContext as Required<TokenCopyRuntimeContext>;
      const copyId = context.copyId;
      const expected = context.expected;

      await test.step('stability temporal: token copy keeps print for at least 4 seconds', async () => {
        await assertStableAfterElapsed(pageA, playerA.user.id, copyId, expected, 'temporal-4s', diagnostics);
      });

      await test.step('patches from another player do not degrade token copy print', async () => {
        const moveB = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerB.token,
          baseVersion,
          type: 'card.moved',
          payload: {
            playerId: playerB.user.id,
            fromZone: 'hand',
            toZone: 'battlefield',
            instanceId: otherPermanentId,
            position: { x: 0.58, y: 0.48, unit: 'ratio' },
          },
        });
        baseVersion = moveB.version;
        diagnostics.push(tokenCopyDiagnostic('after-other-move', moveB.patch, await expectTokenCopyStable(pageA, playerA.user.id, copyId, expected, 'after-other-move')));

        const tapB = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerB.token,
          baseVersion,
          type: 'card.tapped',
          payload: { instanceId: otherPermanentId, tapped: true },
        });
        baseVersion = tapB.version;
        diagnostics.push(tokenCopyDiagnostic('after-other-tap', tapB.patch, await expectTokenCopyStable(pageA, playerA.user.id, copyId, expected, 'after-other-tap')));

        const lifeB = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerB.token,
          baseVersion,
          type: 'life.changed',
          payload: { playerId: playerB.user.id, delta: -1 },
        });
        baseVersion = lifeB.version;
        diagnostics.push(tokenCopyDiagnostic('after-other-life', lifeB.patch, await expectTokenCopyStable(pageA, playerA.user.id, copyId, expected, 'after-other-life')));

        const moveCounterCardB = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerB.token,
          baseVersion,
          type: 'card.moved',
          payload: {
            playerId: playerB.user.id,
            fromZone: 'hand',
            toZone: 'battlefield',
            instanceId: otherCounterCardId,
            position: { x: 0.64, y: 0.56, unit: 'ratio' },
          },
        });
        baseVersion = moveCounterCardB.version;
        diagnostics.push(tokenCopyDiagnostic('after-other-second-move', moveCounterCardB.patch, await expectTokenCopyStable(pageA, playerA.user.id, copyId, expected, 'after-other-second-move')));

        const counterB = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerB.token,
          baseVersion,
          type: 'card.counter.changed',
          payload: { instanceId: otherCounterCardId, counter: '+1/+1', value: 1 },
        });
        baseVersion = counterB.version;
        diagnostics.push(tokenCopyDiagnostic('after-other-counter', counterB.patch, await expectTokenCopyStable(pageA, playerA.user.id, copyId, expected, 'after-other-counter')));
      });

      await test.step('own unrelated actions do not degrade token copy print', async () => {
        const ownMove = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.moved',
          payload: {
            playerId: playerA.user.id,
            fromZone: 'hand',
            toZone: 'battlefield',
            instanceId: ownOtherCardId,
            position: { x: 0.42, y: 0.62, unit: 'ratio' },
          },
        });
        baseVersion = ownMove.version;
        diagnostics.push(tokenCopyDiagnostic('after-own-move', ownMove.patch, await expectTokenCopyStable(pageA, playerA.user.id, copyId, expected, 'after-own-move')));

        const dice = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'dice.rolled',
          payload: { playerId: playerA.user.id, kind: 'd20' },
        });
        baseVersion = dice.version;
        diagnostics.push(tokenCopyDiagnostic('after-own-dice', dice.patch, await expectTokenCopyStable(pageA, playerA.user.id, copyId, expected, 'after-own-dice')));

        const shuffle = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'library.shuffle',
          payload: { playerId: playerA.user.id },
        });
        baseVersion = shuffle.version;
        diagnostics.push(tokenCopyDiagnostic('after-own-shuffle', shuffle.patch, await expectTokenCopyStable(pageA, playerA.user.id, copyId, expected, 'after-own-shuffle')));
      });

      await test.step('refresh and reconnect keep token copy print', async () => {
        await pageA.reload();
        await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
        await focusPlayerById(pageA, playerA.user.id);
        diagnostics.push(tokenCopyDiagnostic('after-refresh', {}, await expectTokenCopyStable(pageA, playerA.user.id, copyId, expected, 'after-refresh')));

        await pageA.close();
        const reconnected = await contexts[0]!.newPage();
        const reconnectFrames = collectWebSocketFrames(reconnected);
        await reconnected.goto(`/games/${gameId}`);
        await expect(reconnected.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
        await waitForGameplayConnection(reconnectFrames);
        await focusPlayerById(reconnected, playerA.user.id);
        diagnostics.push(tokenCopyDiagnostic('after-reconnect', {}, await expectTokenCopyStable(reconnected, playerA.user.id, copyId, expected, 'after-reconnect')));
        assertNoRuntimeFallbackFrames(reconnectFrames);
      });

      await assertNoUnknownCard(pageB);
      await assertNoFalseActionToast(pageB);
      for (const frames of [framesA, framesB, framesC, commandFrames]) {
        assertNoRuntimeFallbackFrames(frames);
      }
      void diagnostics;
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nToken copy diagnostics: ${JSON.stringify(diagnostics.slice(-8), null, 2)}`);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

interface TokenCopyRuntimeContext {
  copyId?: string;
  expected?: TokenCopyVisual;
}

const tokenCopyContext: TokenCopyRuntimeContext = {};

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<TokenCopySetup> {
  const players: TokenCopyPlayer[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `tcprint-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `TCPRINT${index + 1} ${runId.slice(-10)}`,
    });
    players.push({
      token: session.token,
      refreshToken: session.refreshToken,
      user: session.user,
      credentials: session.credentials,
      deck,
    });
  }
  const roomId = await createRoom(request, players[0]!.token, players[0]!.deck.deckId, runId);
  for (const player of players.slice(1)) {
    await joinRoom(request, player.token, roomId, player.deck.deckId);
  }
  await resolveTurnOrder(request, roomId, players.map((player) => player.token));
  const gameId = await startRoom(request, players[0]!.token, roomId);

  return { gameId, roomId, players };
}

async function createRoom(request: APIRequestContext, token: string, deckId: string, runId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      deckId,
      visibility: 'public',
      name: `TCPRINT ${runId.slice(-10)}`,
      format: 'commander',
      maxPlayers: 3,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create token copy room');
  const payload = await response.json() as { room?: { id?: string } };
  if (!payload.room?.id) {
    throw new Error('Room creation did not return room.id.');
  }
  return payload.room.id;
}

async function joinRoom(request: APIRequestContext, token: string, roomId: string, deckId: string): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { deckId },
  });
  await expectApiOk(response, 'join token copy room');
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokens[0]}` },
    });
    await expectApiOk(roomResponse, 'load token copy room turn order');
    const payload = await roomResponse.json() as { room?: { players?: Array<{ turnRolls?: number[] }> } };
    if (turnOrderResolved(payload.room?.players ?? [])) {
      return;
    }
    for (const token of tokens) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok() && response.status() !== 409) {
        await expectApiOk(response, 'roll token copy room turn order');
      }
    }
  }
  throw new Error('Unable to resolve token copy room turn order.');
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'start token copy room');
  const payload = await response.json() as { game?: { id?: string } };
  if (!payload.game?.id) {
    throw new Error('Room start did not return game.id.');
  }
  return payload.game.id;
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
  return payload.game?.snapshot ?? {};
}

function zoneInstanceIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return (zones?.[zone] ?? []).map((card) => String(card['instanceId'] ?? '')).filter((id) => id !== '');
}

function firstAddedCardId(patch: JsonObject): string {
  const add = operation(patch, 'zone.cards.add');
  const cards = Array.isArray(add?.['cards']) ? add?.['cards'] as JsonObject[] : [];
  const instanceId = String(cards[0]?.['instanceId'] ?? '');
  if (!instanceId) {
    throw new Error(`Patch did not include an added card id: ${JSON.stringify(patch, null, 2)}`);
  }
  return instanceId;
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.find((item) => item['op'] === op) ?? null;
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

function waitForGameplayConnection(frames: JsonObject[]): Promise<void> {
  return expect.poll(() => frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), {
    timeout: 30_000,
  }).toBe(true);
}

async function expectRenderableCard(page: Page, ownerPlayerId: string, instanceId: string, stage: string): Promise<TokenCopyVisual> {
  const card = battlefieldCard(page, ownerPlayerId, instanceId);
  await expect(card, `${stage}: card visible`).toBeVisible({ timeout: 15_000 });
  const image = card.locator('.card-visual > img').first();
  await expect(image, `${stage}: image visible`).toBeVisible({ timeout: 15_000 });
  const src = (await image.getAttribute('src')) ?? '';
  const name = (await card.getAttribute('data-card-name')) ?? '';
  const text = (await card.textContent())?.trim() ?? '';
  expect.soft(src, `${stage}: image src`).not.toBe('');
  expect.soft(src, `${stage}: not card back`).not.toContain('card-back');
  expect.soft(src, `${stage}: not facedown`).not.toContain('facedown_card');
  expect.soft(name, `${stage}: card name`).not.toBe('');
  expect.soft(name, `${stage}: no unknown`).not.toBe('Unknown Card');
  return { src, name, text };
}

async function expectTokenCopyStable(
  page: Page,
  ownerPlayerId: string,
  instanceId: string,
  expected: TokenCopyVisual,
  stage: string,
): Promise<TokenCopyVisual> {
  const current = await expectRenderableCard(page, ownerPlayerId, instanceId, stage);
  expect(current.src, `${stage}: token copy image src changed`).toBe(expected.src);
  expect(current.name, `${stage}: token copy name changed`).toBe(expected.name);
  expect(current.name, `${stage}: token copy degraded to placeholder`).not.toBe('Token Copy');
  expect(current.text, `${stage}: token copy text degraded to placeholder`).not.toMatch(/^Token Copy$/i);
  return current;
}

async function assertStableAfterElapsed(
  page: Page,
  ownerPlayerId: string,
  instanceId: string,
  expected: TokenCopyVisual,
  stage: string,
  diagnostics: JsonObject[],
): Promise<void> {
  const readyAt = Date.now() + 4_000;
  await expect.poll(async () => {
    if (Date.now() < readyAt) {
      return 'waiting';
    }
    const current = await expectRenderableCard(page, ownerPlayerId, instanceId, stage);
    diagnostics.push(tokenCopyDiagnostic(stage, {}, current));
    return current.src === expected.src && current.name === expected.name && current.name !== 'Token Copy'
      ? 'stable'
      : JSON.stringify(current);
  }, {
    timeout: 7_000,
    intervals: [500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500],
  }).toBe('stable');
}

function battlefieldCard(page: Page, ownerPlayerId: string, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerPlayerId}"][data-card-instance-id="${instanceId}"]`).first();
}

async function focusPlayerById(page: Page, playerId: string): Promise<void> {
  await expect(page.getByTestId('player-panel')).toBeVisible({ timeout: 15_000 });
  if (await focusedPlayerId(page) === playerId) {
    return;
  }

  const board = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`).first();
  await expect(board).toBeVisible({ timeout: 15_000 });
  await board.click();
  await expect.poll(() => focusedPlayerId(page), { timeout: 10_000 }).toBe(playerId);
}

async function focusedPlayerId(page: Page): Promise<string | null> {
  return page.getByTestId('player-panel').getAttribute('data-player-id');
}

function tokenCopyDiagnostic(stage: string, patch: JsonObject, visual: TokenCopyVisual): JsonObject {
  return {
    stage,
    visual,
    patchVersion: patch['version'] ?? null,
    patchOps: Array.isArray(patch['ops']) ? (patch['ops'] as JsonObject[]).map((op) => op['op']) : [],
    patchStaticCards: JSON.stringify(patch).includes('staticCards'),
    patchContainsTokenCopy: JSON.stringify(patch).includes('Token Copy'),
  };
}

function assertNoRuntimeFallbackFrames(frames: JsonObject[]): void {
  expect(frames.some((message) => message['kind'] === 'game_patch')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'command_ack' && message['status'] === 'rejected')).toBe(false);
}

async function assertNoUnknownCard(page: Page): Promise<void> {
  await expect(page.locator('body')).not.toContainText('Unknown Card', { timeout: 5_000 });
}

async function assertNoFalseActionToast(page: Page): Promise<void> {
  await expect(page.locator('.table-error', { hasText: /failed|could not|error/i })).toHaveCount(0);
}

async function assertServiceReady(request: APIRequestContext, url: string, service: string): Promise<void> {
  const response = await request.get(url, { timeout: 10_000 });
  if (!response.ok()) {
    throw new Error(`${service} is not ready at ${url}: HTTP ${response.status()} ${await response.text()}`);
  }
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

function turnOrderResolved(players: Array<{ turnRolls?: number[] }>): boolean {
  if (players.length === 0) {
    return false;
  }
  const rolls = new Set<string>();
  for (const player of players) {
    if (!Array.isArray(player.turnRolls) || player.turnRolls.length === 0) {
      return false;
    }
    const key = player.turnRolls.join('-');
    if (rolls.has(key)) {
      return false;
    }
    rolls.add(key);
  }
  return true;
}

async function expectApiOk(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) {
    return;
  }
  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
