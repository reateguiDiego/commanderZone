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
type HotfixPlayer = {
  token: string;
  refreshToken: string;
  user: RealUserSession['user'];
  credentials: RealUserSession['credentials'];
  deck: BasicCommanderDeckFromDatabaseResult;
};
type HotfixSetup = { gameId: string; roomId: string; players: HotfixPlayer[] };

test.describe('rc hotfix dice, life log, counter persistence and token copy print gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: HotfixSetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await Promise.all([
      assertServiceReady(request, API_READY_URL, 'api readyz'),
      assertServiceReady(request, WEBSOCKET_READY_URL, 'websocket readyz'),
      assertServiceReady(request, RUNTIME_READY_URL, 'game-runtime readyz'),
    ]);
    setup = await createThreePlayerGame(request, `dcltc${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
  });

  test('dice, life gamelog, counter zero persistence and token copy print stay live', async ({ browser, request, baseURL }) => {
    test.setTimeout(360_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }
    const [playerA, playerB, playerC] = setup.players;
    if (!playerA || !playerB || !playerC) {
      throw new Error('Hotfix gate requires exactly 3 players.');
    }

    const { gameId } = setup;
    const initialSnapshotA = await gameSnapshot(request, gameId, playerA.token);
    const initialSnapshotB = await gameSnapshot(request, gameId, playerB.token);
    const handA = zoneInstanceIds(initialSnapshotA, playerA.user.id, 'hand');
    const handB = zoneInstanceIds(initialSnapshotB, playerB.user.id, 'hand');
    if (handA.length < 1 || handB.length < 1) {
      throw new Error('Hotfix gate requires at least one hand card for players A and B.');
    }
    const sourcePermanentId = handA[0]!;
    const otherPermanentId = handB[0]!;
    let baseVersion = Math.max(1, Number(initialSnapshotA['version'] ?? 1));

    const contexts = await Promise.all([playerA, playerB, playerC].map((player) =>
      browser.newContext({ baseURL, storageState: authStorageState(baseURL, player.user, player.refreshToken) }),
    ));
    await Promise.all(contexts.map(enableFrontendGameplayV2));
    const commandFrames: JsonObject[] = [];

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
      await openLog(pageA);

      await test.step('dice rolls from UI emit patch.v2 and game log', async () => {
        const before = framesA.length;
        await pageA.getByTestId('game-screen').click({ button: 'right' });
        const menu = pageA.getByTestId('context-menu');
        await expect(menu).toBeVisible({ timeout: 10_000 });
        await menu.getByRole('button', { name: /roll|dice|dado/i }).click();
        const modal = pageA.getByRole('dialog', { name: /roll|dice|dado/i });
        await expect(modal).toBeVisible({ timeout: 10_000 });
        await modal.locator('button.primary-action').click();
        const dicePatch = await waitForPatchV2Since(framesA, before, (patch) => hasOp(patch, 'dice.result'));
        const dice = operation(dicePatch, 'dice.result');
        expect(dice?.['kind']).toBeTruthy();
        expect(dice?.['result'] ?? dice?.['value']).toBeTruthy();
        await expectLogEntry(pageA, /rolled|tirado/i);
        baseVersion = Number(dicePatch['version'] ?? baseVersion);
      });

      await test.step('life.changed appends GameLog entry', async () => {
        const outcome = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'life.changed',
          payload: { playerId: playerA.user.id, delta: -2 },
        });
        baseVersion = outcome.version;
        expect(hasOp(outcome.patch, 'player.life.set')).toBe(true);
        expect(hasOp(outcome.patch, 'eventLog.append')).toBe(true);
        await expectLogEntry(pageA, /life/i);
      });

      await test.step('new counters start at one and zero counters persist until explicit removal', async () => {
        const move = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.moved',
          payload: {
            playerId: playerA.user.id,
            fromZone: 'hand',
            toZone: 'battlefield',
            instanceId: sourcePermanentId,
            position: { x: 0.36, y: 0.58, unit: 'ratio' },
          },
        });
        baseVersion = move.version;
        await expect(battlefieldCard(pageA, sourcePermanentId)).toBeVisible({ timeout: 15_000 });

        await pageA.locator(`[data-testid="game-card"][data-card-instance-id="${sourcePermanentId}"]`).click({ button: 'right' });
        const menu = pageA.getByTestId('context-menu');
        await expect(menu).toBeVisible({ timeout: 10_000 });
        const counterKey = 'black';
        await menu.getByRole('button', { name: /counter|contador/i }).click();
        const blackCounterButton = pageA.locator('.submenu-panel button').filter({ hasText: /^Black$/i }).first();
        await expect(blackCounterButton).toBeVisible({ timeout: 10_000 });
        await blackCounterButton.click();
        await expect.poll(async () => counterValueFromSnapshot(await gameSnapshot(request, gameId, playerA.token), playerA.user.id, sourcePermanentId, counterKey), {
          timeout: 20_000,
        }).toBe(1);
        baseVersion = await gameVersion(request, gameId, playerA.token);

        const zero = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.counter.changed',
          payload: { instanceId: sourcePermanentId, counter: counterKey, value: 0 },
        });
        baseVersion = zero.version;
        expect(operation(zero.patch, 'card.counters.patch')?.['counters']).toEqual({ [counterKey]: 0 });
        const unrelated = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'life.changed',
          payload: { playerId: playerA.user.id, delta: 1 },
        });
        baseVersion = unrelated.version;
        expect(counterValueFromSnapshot(await gameSnapshot(request, gameId, playerA.token), playerA.user.id, sourcePermanentId, counterKey)).toBe(0);

        const removed = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.counter.changed',
          payload: { instanceId: sourcePermanentId, counter: counterKey, remove: true },
        });
        baseVersion = removed.version;
        expect(counterValueFromSnapshot(await gameSnapshot(request, gameId, playerA.token), playerA.user.id, sourcePermanentId, counterKey)).toBeNull();
      });

      await test.step('token copy keeps print after another player plays a card', async () => {
        const copy = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.token_copy.created',
          payload: { playerId: playerA.user.id, instanceId: sourcePermanentId, targetPlayerId: playerA.user.id },
        });
        baseVersion = copy.version;
        const copyId = firstAddedCardId(copy.patch);
        await expect(battlefieldCard(pageA, copyId)).toBeVisible({ timeout: 15_000 });
        const beforeSrc = await cardImageSrc(pageA, copyId);
        expect(beforeSrc).not.toBe('');
        expect(beforeSrc).not.toContain('card-back');
        await focusPlayerById(pageB, playerA.user.id);
        await expect(battlefieldCard(pageB, copyId)).toBeVisible({ timeout: 15_000 });
        const beforeSrcB = await cardImageSrc(pageB, copyId);
        expect(beforeSrcB).not.toBe('');
        expect(beforeSrcB).not.toContain('card-back');

        const otherMove = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerB.token,
          baseVersion,
          type: 'card.moved',
          payload: {
            playerId: playerB.user.id,
            fromZone: 'hand',
            toZone: 'battlefield',
            instanceId: otherPermanentId,
            position: { x: 0.62, y: 0.58, unit: 'ratio' },
          },
        });
        baseVersion = otherMove.version;
        await focusPlayerById(pageB, playerA.user.id);
        await expect(battlefieldCard(pageB, copyId)).toBeVisible({ timeout: 15_000 });
        await expect.poll(async () => cardImageSrc(pageA, copyId), { timeout: 15_000 }).toBe(beforeSrc);
        await expect.poll(async () => cardImageSrc(pageB, copyId), { timeout: 15_000 }).toBe(beforeSrcB);

        await pageA.reload();
        await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
        await expect.poll(async () => cardImageSrc(pageA, copyId), { timeout: 20_000 }).toBe(beforeSrc);
      });

      await assertNoUnknownCard(pageA);
      await assertNoFalseActionToast(pageA);
      for (const frames of [framesA, framesB, framesC, commandFrames]) {
        assertNoRuntimeFallbackFrames(frames);
      }
      void baseVersion;
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<HotfixSetup> {
  const players: HotfixPlayer[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `dcltc-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `DCLTC${index + 1} ${runId.slice(-10)}`,
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
      name: `DCLTC ${runId.slice(-10)}`,
      format: 'commander',
      maxPlayers: 3,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create hotfix room');
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
  await expectApiOk(response, 'join hotfix room');
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokens[0]}` },
    });
    await expectApiOk(roomResponse, 'load hotfix room turn order');
    const payload = await roomResponse.json() as { room?: { players?: Array<{ turnRolls?: number[] }> } };
    if (turnOrderResolved(payload.room?.players ?? [])) {
      return;
    }
    for (const token of tokens) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok() && response.status() !== 409) {
        await expectApiOk(response, 'roll hotfix turn order');
      }
    }
  }
  throw new Error('Unable to resolve hotfix room turn order.');
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'start hotfix room');
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

async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  return Math.max(1, Number((await gameSnapshot(request, gameId, token))['version'] ?? 1));
}

async function openLog(page: Page): Promise<void> {
  const logTab = page.getByTestId('game-log-open');
  await expect(logTab).toBeVisible();
  await logTab.click();
  await expect(page.getByTestId('game-log-panel')).toBeVisible();
  await expect(page.getByTestId('game-log')).toBeVisible();
}

async function expectLogEntry(page: Page, text: RegExp): Promise<void> {
  await expect(page.getByTestId('game-log-panel')).toContainText(text, { timeout: 20_000 });
}

async function cardImageSrc(page: Page, instanceId: string): Promise<string> {
  const image = battlefieldCard(page, instanceId).locator('img').first();
  await expect(image).toBeVisible({ timeout: 15_000 });
  return (await image.getAttribute('src')) ?? '';
}

function battlefieldCard(page: Page, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-card-instance-id="${instanceId}"]`).first();
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

function zoneInstanceIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return (zones?.[zone] ?? []).map((card) => String(card['instanceId'] ?? '')).filter((id) => id !== '');
}

function counterValueFromSnapshot(snapshot: JsonObject, playerId: string, instanceId: string, counter: string): number | null {
  const card = snapshotCard(snapshot, playerId, 'battlefield', instanceId);
  const counters = card?.['counters'] as Record<string, number> | undefined;
  return counters && Object.prototype.hasOwnProperty.call(counters, counter) ? Number(counters[counter]) : null;
}

function snapshotCard(snapshot: JsonObject, playerId: string, zone: string, instanceId: string): JsonObject | null {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return (zones?.[zone] ?? []).find((card) => card['instanceId'] === instanceId) ?? null;
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

function hasOp(message: JsonObject, op: string): boolean {
  return operation(message, op) !== null;
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

function waitForPatchV2(frames: JsonObject[], predicate: (message: JsonObject) => boolean): Promise<JsonObject> {
  return expect.poll(() => {
    const patch = frames.find((message) => message['kind'] === 'patch.v2' && predicate(message));
    if (patch) {
      return 'patch';
    }
    if (frames.some((message) => message['kind'] === 'game_patch')) {
      return 'legacy';
    }
    if (frames.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')) {
      return 'resync';
    }
    return null;
  }, {
    timeout: 20_000,
  }).toBe('patch').then(() => {
    const patch = frames.find((message) => message['kind'] === 'patch.v2' && predicate(message));
    if (!patch) {
      throw new Error(`patch.v2 frame was not captured. Recent frames: ${JSON.stringify(frames.slice(-8), null, 2)}`);
    }
    return patch;
  });
}

function waitForPatchV2Since(frames: JsonObject[], startIndex: number, predicate: (message: JsonObject) => boolean): Promise<JsonObject> {
  return waitForPatchV2View(() => frames.slice(startIndex), predicate);
}

function waitForPatchV2View(framesView: () => JsonObject[], predicate: (message: JsonObject) => boolean): Promise<JsonObject> {
  return expect.poll(() => {
    const frames = framesView();
    const patch = frames.find((message) => message['kind'] === 'patch.v2' && predicate(message));
    if (patch) {
      return 'patch';
    }
    if (frames.some((message) => message['kind'] === 'game_patch')) {
      return 'legacy';
    }
    if (frames.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')) {
      return 'resync';
    }
    return null;
  }, {
    timeout: 20_000,
  }).toBe('patch').then(() => {
    const frames = framesView();
    const patch = frames.find((message) => message['kind'] === 'patch.v2' && predicate(message));
    if (!patch) {
      throw new Error(`patch.v2 frame was not captured. Recent frames: ${JSON.stringify(frames.slice(-8), null, 2)}`);
    }
    return patch;
  });
}

function assertNoRuntimeFallbackFrames(frames: JsonObject[]): void {
  expect(frames.some((message) => message['kind'] === 'game_patch')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'command_ack' && message['status'] === 'rejected')).toBe(false);
}

async function assertNoUnknownCard(page: Page): Promise<void> {
  await expect(page.getByText('Unknown Card')).toHaveCount(0);
}

async function assertNoFalseActionToast(page: Page): Promise<void> {
  await expect(page.locator('.toast, [role="alert"]').filter({ hasText: /failed|fall/i })).toHaveCount(0);
}

async function assertServiceReady(request: APIRequestContext, url: string, service: string): Promise<void> {
  const response = await request.get(url, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`${service} is not ready at ${url}: HTTP ${response.status()}`);
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
