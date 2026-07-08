import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession, type RealUserSession } from './support/auth';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { resolveGameToPlaying } from './support/commander-game';
import { sendRuntimeCommand, type RuntimeWebSocketCommandResult } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const API_HEALTH_URL = process.env['E2E_API_HEALTH_URL'] ?? `${API_BASE_URL}/healthz`;
const API_READY_URL = process.env['E2E_API_READY_URL'] ?? `${API_BASE_URL}/readyz`;
const WEBSOCKET_HEALTH_URL = process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz';
const WEBSOCKET_READY_URL = process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz';
const RUNTIME_HEALTH_URL = process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz';
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

test.describe('rc hotfix token commander untap gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: HotfixSetup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await Promise.all([
      assertServiceReady(request, API_HEALTH_URL, 'api healthz'),
      assertServiceReady(request, API_READY_URL, 'api readyz'),
      assertServiceReady(request, WEBSOCKET_HEALTH_URL, 'websocket healthz'),
      assertServiceReady(request, WEBSOCKET_READY_URL, 'websocket readyz'),
      assertServiceReady(request, RUNTIME_HEALTH_URL, 'game-runtime healthz'),
      assertServiceReady(request, RUNTIME_READY_URL, 'game-runtime readyz'),
    ]);
    setup = await createThreePlayerGame(request, `hotfix${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
  });

  test('commander casts, ephemeral tokens and controller-based untap all stay consistent', async ({ browser, request, baseURL }) => {
    test.setTimeout(420_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }
    const [playerA, playerB, playerC] = setup.players;
    if (!playerA || !playerB || !playerC) {
      throw new Error('Hotfix gate requires exactly 3 players.');
    }

    const { gameId } = setup;
    let baseVersion = await gameVersion(request, gameId, playerA.token);
    const initialSnapshot = await gameSnapshot(request, gameId, playerA.token);
    const initialSnapshotB = await gameSnapshot(request, gameId, playerB.token);
    const commander = zoneCards(initialSnapshot, playerA.user.id, 'command').find((card) => card['isCommander'] === true)
      ?? zoneCards(initialSnapshot, playerA.user.id, 'command')[0];
    if (!commander) {
      throw new Error('Hotfix gate requires a commander in command zone.');
    }
    const commanderId = String(commander['instanceId']);
    const handIdsB = zoneInstanceIds(initialSnapshotB, playerB.user.id, 'hand');
    if (handIdsB.length < 1) {
      throw new Error('Hotfix gate requires player B hand card for controlled permanent fixture.');
    }
    const borrowedId = handIdsB[0]!;

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
      await Promise.all([
        focusPlayerById(pageA, playerA.user.id),
        focusPlayerById(pageB, playerA.user.id),
        focusPlayerById(pageC, playerA.user.id),
      ]);

      await test.step('UI move commander from command zone increments cast count once', async () => {
        const source = pageA.locator(`[data-testid="command-zone-card"][data-player-id="${playerA.user.id}"][data-card-id="${commanderId}"]`).first();
        const target = pageA.locator(`[data-testid="battlefield-zone"][data-player-id="${playerA.user.id}"]`).first();
        await expect(source).toBeVisible({ timeout: 15_000 });
        await expect(target).toBeVisible({ timeout: 15_000 });
        const beforeFrames = framesA.length;
        await dragWithPointer(pageA, source, target);
        await expect(battlefieldCard(pageA, playerA.user.id, commanderId)).toBeVisible({ timeout: 20_000 });
        await expect(commanderCastCount(pageA, playerA.user.id, commanderId)).toHaveText('1', { timeout: 20_000 });
        await expect(commanderCastCount(pageB, playerA.user.id, commanderId)).toHaveText('1', { timeout: 20_000 });
        await expect.poll(async () => commanderCastsFromSnapshot(await gameSnapshot(request, gameId, playerA.token), commanderId), {
          timeout: 15_000,
        }).toBe(1);
        const patch = framesA.slice(beforeFrames).find((frame) => frame['kind'] === 'patch.v2' && commanderCastsFromPatch(frame, commanderId) === 1);
        expect(patch).toBeTruthy();
        baseVersion = await gameVersion(request, gameId, playerA.token);
      });

      await test.step('runtime token and token copy evaporate when moved out of battlefield', async () => {
        const tokenCreate = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.token.created',
          payload: {
            playerId: playerA.user.id,
            quantity: 1,
            card: { name: 'Hotfix Bear', typeLine: 'Token Creature - Bear', power: 2, toughness: 2 },
            position: { x: 0.33, y: 0.48, unit: 'ratio' },
          },
        });
        baseVersion = tokenCreate.version;
        const tokenId = firstAddedCardId(tokenCreate.patch);
        await expect(battlefieldCard(pageA, playerA.user.id, tokenId)).toBeVisible({ timeout: 15_000 });

        const tokenRemove = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.moved',
          payload: { playerId: playerA.user.id, fromZone: 'battlefield', toZone: 'graveyard', instanceId: tokenId },
        });
        baseVersion = tokenRemove.version;
        expect(hasOp(tokenRemove.patch, 'zone.cards.remove')).toBe(true);
        expect(hasOp(tokenRemove.patch, 'zone.cards.move')).toBe(false);
        await expect(battlefieldCard(pageA, playerA.user.id, tokenId)).toHaveCount(0, { timeout: 15_000 });
        let snapshot = await gameSnapshot(request, gameId, playerA.token);
        expect(zoneInstanceIds(snapshot, playerA.user.id, 'graveyard')).not.toContain(tokenId);

        const copyCreate = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.token_copy.created',
          payload: { playerId: playerA.user.id, instanceId: commanderId, targetPlayerId: playerA.user.id },
        });
        baseVersion = copyCreate.version;
        const copyId = firstAddedCardId(copyCreate.patch);
        await expect(battlefieldCard(pageA, playerA.user.id, copyId)).toBeVisible({ timeout: 15_000 });

        const copyRemove = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.moved',
          payload: { playerId: playerA.user.id, fromZone: 'battlefield', toZone: 'exile', instanceId: copyId },
        });
        baseVersion = copyRemove.version;
        expect(hasOp(copyRemove.patch, 'zone.cards.remove')).toBe(true);
        expect(hasOp(copyRemove.patch, 'zone.cards.move')).toBe(false);
        await expect(battlefieldCard(pageA, playerA.user.id, copyId)).toHaveCount(0, { timeout: 15_000 });
        snapshot = await gameSnapshot(request, gameId, playerA.token);
        expect(zoneInstanceIds(snapshot, playerA.user.id, 'exile')).not.toContain(copyId);

        for (const mechanic of [
          { name: 'Hotfix Emblem', typeLine: 'Emblem', zone: 'graveyard' },
          { name: 'Hotfix Dungeon', typeLine: 'Dungeon', zone: 'exile' },
          { name: 'The Ring', typeLine: 'Helper', zone: 'graveyard' },
        ]) {
          const mechanicCreate = await applyRuntime(request, commandFrames, {
            gameId,
            token: playerA.token,
            baseVersion,
            type: 'card.token.created',
            payload: {
              playerId: playerA.user.id,
              quantity: 1,
              card: {
                name: mechanic.name,
                typeLine: mechanic.typeLine,
                imageUris: { normal: `https://example.test/${mechanic.name.toLowerCase().replaceAll(' ', '-')}.jpg` },
              },
              position: { x: 0.5, y: 0.56, unit: 'ratio' },
            },
          });
          baseVersion = mechanicCreate.version;
          const mechanicId = firstAddedCardId(mechanicCreate.patch);
          await expect(battlefieldCard(pageA, playerA.user.id, mechanicId)).toBeVisible({ timeout: 15_000 });

          const mechanicRemove = await applyRuntime(request, commandFrames, {
            gameId,
            token: playerA.token,
            baseVersion,
            type: 'card.moved',
            payload: { playerId: playerA.user.id, fromZone: 'battlefield', toZone: mechanic.zone, instanceId: mechanicId },
          });
          baseVersion = mechanicRemove.version;
          expect(hasOp(mechanicRemove.patch, 'zone.cards.remove')).toBe(true);
          expect(hasOp(mechanicRemove.patch, 'zone.cards.move')).toBe(false);
          await expect(battlefieldCard(pageA, playerA.user.id, mechanicId)).toHaveCount(0, { timeout: 15_000 });
          snapshot = await gameSnapshot(request, gameId, playerA.token);
          expect(zoneInstanceIds(snapshot, playerA.user.id, mechanic.zone)).not.toContain(mechanicId);
        }
      });

      await test.step('U untaps all permanents controlled by A across battlefields', async () => {
        const normalCreate = await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.token.created',
          payload: {
            playerId: playerA.user.id,
            quantity: 1,
            card: { name: 'Hotfix Soldier', typeLine: 'Token Creature - Soldier', power: 1, toughness: 1 },
            position: { x: 0.42, y: 0.5, unit: 'ratio' },
          },
        });
        baseVersion = normalCreate.version;
        const controlledTokenId = firstAddedCardId(normalCreate.patch);
        baseVersion = (await applyRuntime(request, commandFrames, {
          gameId,
          token: playerB.token,
          baseVersion,
          type: 'card.moved',
          payload: {
            playerId: playerB.user.id,
            fromZone: 'hand',
            toZone: 'battlefield',
            targetPlayerId: playerB.user.id,
            instanceId: borrowedId,
            position: { x: 0.55, y: 0.5, unit: 'ratio' },
          },
        })).version;
        baseVersion = (await applyRuntime(request, commandFrames, {
          gameId,
          token: playerB.token,
          baseVersion,
          type: 'card.controller.changed',
          payload: { playerId: playerB.user.id, zone: 'battlefield', instanceId: borrowedId, targetPlayerId: playerA.user.id },
        })).version;
        baseVersion = (await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.tapped',
          payload: { instanceId: commanderId, tapped: true },
        })).version;
        baseVersion = (await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.tapped',
          payload: { instanceId: controlledTokenId, tapped: true },
        })).version;
        baseVersion = (await applyRuntime(request, commandFrames, {
          gameId,
          token: playerA.token,
          baseVersion,
          type: 'card.tapped',
          payload: { instanceId: borrowedId, tapped: true },
        })).version;

        await expectCardTapped(pageA, playerA.user.id, commanderId, true);
        await expectCardTapped(pageA, playerA.user.id, controlledTokenId, true);
        await focusPlayerById(pageA, playerB.user.id);
        await expectCardTapped(pageA, playerA.user.id, borrowedId, true);

        const beforeFrames = framesA.length;
        await pageA.keyboard.press('U');
        await expectCardTapped(pageA, playerA.user.id, borrowedId, false, 20_000);
        await focusPlayerById(pageA, playerA.user.id);
        await expectCardTapped(pageA, playerA.user.id, commanderId, false, 20_000);
        await expectCardTapped(pageA, playerA.user.id, controlledTokenId, false, 20_000);
        const untapPatch = framesA.slice(beforeFrames).find((frame) => frame['kind'] === 'patch.v2' && countOps(frame, 'card.field.set') >= 3);
        expect(untapPatch).toBeTruthy();

        const snapshot = await gameSnapshot(request, gameId, playerA.token);
        expect(cardInAnyBattlefield(snapshot, commanderId)?.['tapped']).toBe(false);
        expect(cardInAnyBattlefield(snapshot, controlledTokenId)?.['tapped']).toBe(false);
        expect(cardInAnyBattlefield(snapshot, borrowedId)?.['tapped']).toBe(false);
      });

      await pageA.reload();
      await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await focusPlayerById(pageA, playerA.user.id);
      await expect(commanderCastCount(pageA, playerA.user.id, commanderId)).toHaveText('1', { timeout: 15_000 });
      await expectCardTapped(pageA, playerA.user.id, commanderId, false);
      await assertNoUnknownCard(pageA);
      await assertNoUnknownCard(pageB);
      await assertNoFalseActionToast(pageA);
      await assertNoFalseActionToast(pageB);
      assertNoRuntimeFallbackFrames([...framesA, ...framesB, ...framesC, ...commandFrames]);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<HotfixSetup> {
  const players: HotfixPlayer[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `hfx-${index + 1}-${runId}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, {
      ownerToken: session.token,
      name: `HFX${index + 1} ${runId.slice(-10)}`,
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
      name: `Hotfix Token Commander Untap ${runId.slice(-10)}`,
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
  if (!payload.game?.snapshot) {
    throw new Error('Snapshot response did not include game.snapshot.');
  }
  return payload.game.snapshot;
}

async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  const snapshot = await gameSnapshot(request, gameId, token);
  return Math.max(1, Number(snapshot['version'] ?? 1));
}

async function dragWithPointer(page: Page, source: Locator, target: Locator): Promise<void> {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('Cannot drag command-zone card without source and target boxes.');
  }
  const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const end = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 8 });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function focusPlayerById(page: Page, playerId: string): Promise<void> {
  const panel = page.getByTestId('player-panel');
  if (await panel.getAttribute('data-player-id') === playerId) {
    return;
  }
  const thumb = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`).first();
  await expect(thumb).toBeVisible({ timeout: 10_000 });
  await thumb.click();
  await expect.poll(async () => panel.getAttribute('data-player-id'), { timeout: 5_000 }).toBe(playerId);
}

function collectWebSocketFrames(page: Page): JsonObject[] {
  const frames: JsonObject[] = [];
  page.on('websocket', (socket) => {
    frames.push({ kind: 'connection_open', url: socket.url() });
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

async function waitForGameplayConnection(frames: JsonObject[]): Promise<void> {
  await expect.poll(() => frames.some((frame) => frame['kind'] === 'connection_open' || frame['kind'] === 'connection_ready' || frame['kind'] === 'patch.v2'), {
    timeout: 30_000,
  }).toBe(true);
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

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.find((item) => item['op'] === op) ?? null;
}

function hasOp(message: JsonObject, op: string): boolean {
  return operation(message, op) !== null;
}

function countOps(message: JsonObject, op: string): number {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.filter((item) => item['op'] === op).length;
}

function firstAddedCardId(message: JsonObject): string {
  const cards = operation(message, 'zone.cards.add')?.['cards'];
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error(`Expected zone.cards.add in patch: ${JSON.stringify(message)}`);
  }
  return String((cards[0] as JsonObject)['instanceId'] ?? '');
}

function commanderCastsFromPatch(message: JsonObject, commanderId: string): number | null {
  const op = operation(message, 'game.counters.set');
  if (op?.['scope'] !== `commander:${commanderId}`) {
    return null;
  }
  const counters = op['counters'] as JsonObject | undefined;
  return Number(counters?.['casts'] ?? Number.NaN);
}

function commanderCastsFromSnapshot(snapshot: JsonObject, commanderId: string): number {
  const counters = snapshot['counters'] as JsonObject | undefined;
  const scoped = counters?.[`commander:${commanderId}`] as JsonObject | undefined;
  const legacy = counters?.['commanderCasts'] as JsonObject | undefined;
  return Number(scoped?.['casts'] ?? legacy?.[commanderId] ?? 0);
}

function zoneCards(snapshot: JsonObject, playerId: string, zone: string): JsonObject[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return zones?.[zone] ?? [];
}

function zoneInstanceIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  return zoneCards(snapshot, playerId, zone).map((card) => String(card['instanceId'] ?? '')).filter((id) => id !== '');
}

function cardInAnyBattlefield(snapshot: JsonObject, instanceId: string): JsonObject | null {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  for (const player of Object.values(players ?? {})) {
    const zones = player['zones'] as Record<string, JsonObject[]> | undefined;
    const card = zones?.['battlefield']?.find((candidate) => candidate['instanceId'] === instanceId);
    if (card) {
      return card;
    }
  }
  return null;
}

function battlefieldCard(page: Page, _ownerPlayerId: string, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-card-instance-id="${instanceId}"]`);
}

async function expectCardTapped(page: Page, ownerPlayerId: string, instanceId: string, tapped: boolean, timeout = 15_000): Promise<void> {
  const card = battlefieldCard(page, ownerPlayerId, instanceId);
  await expect(card).toBeVisible({ timeout });
  await expect.poll(async () => {
    const className = await card.getAttribute('class');
    return (` ${className ?? ''} `).includes(' tapped ');
  }, { timeout }).toBe(tapped);
}

function commanderCastCount(page: Page, playerId: string, commanderId: string) {
  return page.locator(`[data-testid="commander-cast-count"][data-player-id="${playerId}"][data-card-id="${commanderId}"]`);
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
