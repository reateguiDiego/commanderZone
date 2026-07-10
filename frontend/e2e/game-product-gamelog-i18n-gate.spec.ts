import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { openChat } from './support/game-table';
import { sendRuntimeCommand, type RuntimeWebSocketCommandResult } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const API_HEALTH_URL = process.env['E2E_API_HEALTH_URL'] ?? `${API_BASE_URL}/healthz`;
const API_READY_URL = process.env['E2E_API_READY_URL'] ?? `${API_BASE_URL}/readyz`;
const WEBSOCKET_HEALTH_URL = process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz';
const WEBSOCKET_READY_URL = process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz';
const RUNTIME_HEALTH_URL = process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';

type JsonObject = Record<string, unknown>;
type GameLogI18nSetup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;
type GameLogI18nPlayer = GameLogI18nSetup['playerA'];

test.describe('product GameLog i18n runtime gate', () => {
  test.describe.configure({ mode: 'serial' });

  let setup: GameLogI18nSetup;

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

    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `gamelogi18n${Date.now().toString(36)}`,
      playerAPrefix: 'gli-es',
      playerBPrefix: 'gli-en',
      playerALanguage: 'es',
      playerBLanguage: 'en',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('same semantic GameLog entries render in Spanish and English by viewer and survive bootstrap/reconnect', async ({ browser, request, baseURL }) => {
    test.setTimeout(420_000);
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.');
    }

    const { gameId, playerA, playerB } = setup;
    let baseVersion = await gameVersion(request, gameId, playerA.token);
    const patchEntries: JsonObject[] = [];
    const commandFrames: JsonObject[] = [];

    const contextA = await browser.newContext({
      baseURL,
      storageState: localizedStorageState(baseURL, playerA, 'es'),
    });
    const contextB = await browser.newContext({
      baseURL,
      storageState: localizedStorageState(baseURL, playerB, 'en'),
    });
    await Promise.all([enableFrontendGameplayV2(contextA), enableFrontendGameplayV2(contextB)]);

    try {
      const [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()]);
      const framesA = collectWebSocketFrames(pageA);
      const framesB = collectWebSocketFrames(pageB);

      await Promise.all([pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
      await Promise.all([
        expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
      ]);
      await Promise.all([waitForGameplayConnection(framesA), waitForGameplayConnection(framesB)]);
      await Promise.all([openLog(pageA), openLog(pageB)]);

      const observedFrames = [framesA, framesB];

      const drawOne = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'library.draw',
        payload: { playerId: playerA.user.id },
      }, 'gameLog.library.draw');
      baseVersion = drawOne.version;
      expectNoCardRefs(drawOne.entry);

      const drawMany = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'library.draw_many',
        payload: { playerId: playerA.user.id, count: 2 },
      }, 'gameLog.library.drawMany');
      baseVersion = drawMany.version;
      expectNoCardRefs(drawMany.entry);

      let snapshot = await gameSnapshot(request, gameId, playerA.token);
      const handIds = zoneInstanceIds(snapshot, playerA.user.id, 'hand');
      const commanderIds = zoneInstanceIds(snapshot, playerA.user.id, 'command');
      const [privateCopySourceId, publicMoveId, faceDownMoveId] = handIds;
      const commanderId = commanderIds[0];
      if (!privateCopySourceId || !publicMoveId || !faceDownMoveId || !commanderId) {
        throw new Error(`GameLog i18n gate needs private, public, faceDown and commander fixtures. hand=${handIds.length} command=${commanderIds.length}`);
      }

      const privateCopy = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.token_copy.created',
        payload: { instanceId: privateCopySourceId, targetPlayerId: playerA.user.id },
      }, 'gameLog.tokenCopy.created');
      baseVersion = privateCopy.version;
      expectHiddenCardRef(privateCopy.entry, privateCopySourceId);

      const publicMove = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: publicMoveId,
          position: { x: 0.38, y: 0.62, unit: 'ratio' },
        },
      }, 'gameLog.card.moved');
      baseVersion = publicMove.version;
      expectPublicCardRef(publicMove.entry, publicMoveId);

      const faceDownMove = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: faceDownMoveId,
          faceDown: true,
          position: { x: 0.48, y: 0.62, unit: 'ratio' },
        },
      }, 'gameLog.card.moved');
      baseVersion = faceDownMove.version;
      expectHiddenCardRef(faceDownMove.entry, faceDownMoveId);

      const tap = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.tapped',
        payload: { instanceId: publicMoveId, tapped: true },
      }, 'gameLog.card.tapped');
      baseVersion = tap.version;

      const counter = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.counter.changed',
        payload: { instanceId: publicMoveId, counter: '+1/+1', value: 2 },
      }, 'gameLog.cardCounter.changed');
      baseVersion = counter.version;

      const lifeDown = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerB.token,
        baseVersion,
        type: 'life.changed',
        payload: { playerId: playerB.user.id, life: 37 },
      }, 'gameLog.life.changed');
      baseVersion = lifeDown.version;

      const lifeUp = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerB.token,
        baseVersion,
        type: 'life.changed',
        payload: { playerId: playerB.user.id, life: 40 },
      }, 'gameLog.life.changed');
      baseVersion = lifeUp.version;

      const dice = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'dice.rolled',
        payload: { playerId: playerA.user.id, kind: 'd20' },
      }, 'gameLog.dice.rolled');
      baseVersion = dice.version;

      const shuffle = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'library.shuffle',
        payload: { playerId: playerA.user.id },
      }, 'gameLog.library.shuffle');
      baseVersion = shuffle.version;
      expectNoCardRefs(shuffle.entry);
      expect(JSON.stringify(shuffle.entry)).not.toContain('instanceIds');

      const commanderCast = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.moved',
        payload: {
          playerId: playerA.user.id,
          fromZone: 'command',
          toZone: 'battlefield',
          instanceId: commanderId,
          position: { x: 0.58, y: 0.62, unit: 'ratio' },
        },
      }, 'gameLog.commander.cast');
      baseVersion = commanderCast.version;

      const tokenOne = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.token.created',
        payload: { playerId: playerA.user.id, quantity: 1, card: { name: 'Clue', typeLine: 'Token Artifact' } },
      }, 'gameLog.token.created');
      baseVersion = tokenOne.version;

      const tokenMany = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'card.token.created',
        payload: { playerId: playerA.user.id, quantity: 2, card: { name: 'Clue', typeLine: 'Token Artifact' } },
      }, 'gameLog.token.createdMany');
      baseVersion = tokenMany.version;

      const chatText = `gamelog-i18n-chat-${Date.now()}`;
      const chat = await sendRuntimeCommand(request, {
        gameId,
        token: playerA.token,
        baseVersion,
        type: 'chat.message',
        payload: { message: chatText },
      });
      commandFrames.push(...chat.frames);
      expect(operation(chat.patch, 'eventLog.append')).toBeNull();
      expect(findEventLogEntry([...chat.frames, ...framesA, ...framesB], chat.clientActionId, null)).toBeNull();
      await Promise.all([openChat(pageA), openChat(pageB)]);
      await expect(pageA.getByTestId('chat-message').filter({ hasText: chatText })).toBeVisible({ timeout: 15_000 });
      await openLog(pageA);
      await openLog(pageB);
      await expect(pageA.getByTestId('game-log')).not.toContainText(chatText);
      await expect(pageB.getByTestId('game-log')).not.toContainText(chatText);

      await expectSpanishLog(pageA);
      await expectEnglishLog(pageB);
      await assertNoRawSemanticArtifacts(pageA);
      await assertNoRawSemanticArtifacts(pageB);

      const bootstrapA = await gameBootstrap(request, gameId, playerA.token);
      const bootstrapEntries = (bootstrapA['eventLog'] as JsonObject[] | undefined) ?? [];
      const bootstrapIds = new Set(bootstrapEntries.map((entry) => String(entry['id'] ?? '')));
      for (const entry of patchEntries) {
        if (!bootstrapIds.has(String(entry['id']))) {
          throw new Error(`Bootstrap missing GameLog entry ${String(entry['id'])} ${String(entry['i18nKey'])}; bootstrapIds=${[...bootstrapIds].join(',')}`);
        }
        const bootEntry = bootstrapEntries.find((candidate) => candidate['id'] === entry['id']);
        expect(bootEntry?.['i18nKey']).toBe(entry['i18nKey']);
        expect(bootEntry?.['params']).toBeTruthy();
        expect(bootEntry?.['refs']).toBeTruthy();
        expect(bootEntry?.['visibility']).toBe('public');
        expect(bootEntry?.['message']).toBe(entry['message']);
      }
      expect(bootstrapA['logCursor']).toBe(patchEntries.at(-1)?.['id']);

      await Promise.all([pageA.reload(), pageB.reload()]);
      await Promise.all([
        expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
        expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
      ]);
      await Promise.all([openLog(pageA), openLog(pageB)]);
      await expectSpanishLog(pageA);
      await expectEnglishLog(pageB);

      const reconnectRefreshToken = await loginRefreshToken(request, playerB.credentials.email, playerB.credentials.password);
      const reconnectContext = await browser.newContext({
        baseURL,
        storageState: localizedStorageState(baseURL, { ...playerB, refreshToken: reconnectRefreshToken }, 'en'),
      });
      await enableFrontendGameplayV2(reconnectContext);
      try {
        const reconnectPage = await reconnectContext.newPage();
        const reconnectFrames = collectWebSocketFrames(reconnectPage);
        await reconnectPage.goto(`/games/${gameId}`);
        await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
        await waitForGameplayConnection(reconnectFrames);
        await openLog(reconnectPage);
        await expectEnglishLog(reconnectPage);
        assertNoRuntimeFallbackFrames(reconnectFrames);
      } finally {
        await reconnectContext.close().catch(() => undefined);
      }

      snapshot = await gameSnapshot(request, gameId, playerB.token);
      const snapshotLog = (snapshot['eventLog'] as JsonObject[] | undefined) ?? [];
      for (const entry of patchEntries) {
        expect(snapshotLog.some((candidate) => candidate['id'] === entry['id'] && candidate['i18nKey'] === entry['i18nKey'])).toBe(true);
      }

      const concede = await runLoggedCommand(request, commandFrames, patchEntries, observedFrames, {
        gameId,
        token: playerB.token,
        baseVersion,
        type: 'game.concede',
        payload: { playerId: playerB.user.id },
      }, 'gameLog.game.concede');
      baseVersion = concede.version;
      await expectLogEntry(pageA, /concedi\u00f3/i);
      await expectLogEntry(pageB, /conceded/i);

      const bootstrapAfterConcede = await gameBootstrap(request, gameId, playerA.token);
      const bootstrapConcedeEntries = (bootstrapAfterConcede['eventLog'] as JsonObject[] | undefined) ?? [];
      const bootstrapConcede = bootstrapConcedeEntries.find((entry) => entry['id'] === concede.entry['id']);
      expect(bootstrapConcede?.['i18nKey']).toBe('gameLog.game.concede');
      expect(bootstrapConcede?.['params']).toBeTruthy();
      expect(bootstrapConcede?.['refs']).toBeTruthy();
      expect(bootstrapConcede?.['visibility']).toBe('public');
      expect(bootstrapAfterConcede['logCursor']).toBe(concede.entry['id']);

      for (const frames of [framesA, framesB, commandFrames]) {
        assertNoRuntimeFallbackFrames(frames);
      }
    } finally {
      await Promise.all([contextA.close().catch(() => undefined), contextB.close().catch(() => undefined)]);
    }
  });
});

async function runLoggedCommand(
  request: APIRequestContext,
  frames: JsonObject[],
  patchEntries: JsonObject[],
  observedFrames: readonly JsonObject[][],
  options: Parameters<typeof sendRuntimeCommand>[1],
  i18nKey: string,
): Promise<RuntimeWebSocketCommandResult & { entry: JsonObject }> {
  const result = await sendRuntimeCommand(request, options);
  frames.push(...result.frames);
  expect(result.patch['kind']).toBe('patch.v2');
  const entry = await eventLogEntryForCommand(result, observedFrames, i18nKey);
  expect(entry['type']).toBe(options.type);
  expect(entry['id'], JSON.stringify(entry, null, 2)).toEqual(expect.any(String));
  expect(entry['i18nKey']).toBe(i18nKey);
  expect(entry['message']).toEqual(expect.any(String));
  expect(String(entry['message'] ?? '')).not.toBe('');
  expect(entry['params']).toEqual(expect.any(Object));
  expect(entry['refs']).toEqual(expect.any(Object));
  expect(entry['visibility']).toBe('public');
  patchEntries.push(entry);
  return { ...result, entry };
}

async function eventLogEntryForCommand(
  result: RuntimeWebSocketCommandResult,
  observedFrames: readonly JsonObject[][],
  i18nKey: string,
): Promise<JsonObject> {
  const immediate = findEventLogEntry([result.patch, ...result.frames], result.clientActionId, i18nKey);
  if (immediate) {
    return immediate;
  }

  await expect.poll(() => {
    const entry = findEventLogEntry(observedFrames.flat(), result.clientActionId, i18nKey);
    return entry ? JSON.stringify(entry) : '';
  }, {
    timeout: 15_000,
    message: `eventLog.append ${i18nKey} for ${result.clientActionId}`,
  }).not.toBe('');

  const entry = findEventLogEntry(observedFrames.flat(), result.clientActionId, i18nKey);
  if (!entry) {
    throw new Error(`Missing eventLog.append ${i18nKey} for ${result.clientActionId}`);
  }
  return entry;
}

function findEventLogEntry(
  messages: readonly JsonObject[],
  clientActionId: string,
  i18nKey: string | null,
): JsonObject | null {
  for (const message of messages) {
    if (message['kind'] !== 'patch.v2' || message['ackClientActionId'] !== clientActionId) {
      continue;
    }
    const entries = operation(message, 'eventLog.append')?.['entries'];
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const candidate = entry as JsonObject;
      if (i18nKey === null || candidate['i18nKey'] === i18nKey) {
        return candidate;
      }
    }
  }
  return null;
}

function expectNoCardRefs(entry: JsonObject): void {
  const refs = entry['refs'] as JsonObject | undefined;
  expect(refs?.['cards']).toBeUndefined();
  const encoded = JSON.stringify(entry);
  expect(encoded).not.toContain('cardKey');
  expect(encoded).not.toContain('cardRef');
}

function expectPublicCardRef(entry: JsonObject, instanceId: string): void {
  const ref = cardRef(entry, instanceId);
  expect(ref['visibility']).toBe('public');
  expect(ref['cardKey']).toEqual(expect.any(String));
  expect(ref['cardRef']).toEqual(expect.any(String));
}

function expectHiddenCardRef(entry: JsonObject, instanceId: string): void {
  const ref = cardRef(entry, instanceId);
  expect(ref['visibility']).toBe('hidden');
  expect(ref['cardKey']).toBeUndefined();
  expect(ref['cardRef']).toBeUndefined();
  expect(ref['name']).toBeUndefined();
}

function cardRef(entry: JsonObject, instanceId: string): JsonObject {
  const refs = entry['refs'] as JsonObject | undefined;
  const cards = refs?.['cards'] as Record<string, JsonObject> | undefined;
  const ref = cards?.[instanceId];
  if (!ref) {
    throw new Error(`Missing card ref ${instanceId} in ${JSON.stringify(entry, null, 2)}`);
  }
  return ref;
}

async function expectSpanishLog(page: Page): Promise<void> {
  await expectLogEntry(page, /rob\u00f3 una carta/i);
  await expectLogEntry(page, /rob\u00f3 2 cartas/i);
  await expectLogEntry(page, /cre\u00f3 una copia de ficha/i);
  await expectLogEntry(page, /movi\u00f3 una carta de mano a campo de batalla/i);
  await expectLogEntry(page, /gir\u00f3 un permanente/i);
  await expectLogEntry(page, /puso los contadores \+1\/\+1 en 2/i);
  await expectLogEntry(page, /cambi\u00f3 la vida .* de 40 a 37/i);
  await expectLogEntry(page, /cambi\u00f3 la vida .* de 37 a 40/i);
  await expectLogEntry(page, /tir\u00f3 d20 y sac\u00f3/i);
  await expectLogEntry(page, /baraj\u00f3 su biblioteca/i);
  await expectLogEntry(page, /lanz\u00f3 su comandante.*1/i);
  await expectLogEntry(page, /cre\u00f3 .*Clue/i);
  await expectLogEntry(page, /cre\u00f3 2 .*Clue/i);
}

async function expectEnglishLog(page: Page): Promise<void> {
  await expectLogEntry(page, /drew a card/i);
  await expectLogEntry(page, /drew 2 cards/i);
  await expectLogEntry(page, /created a token copy/i);
  await expectLogEntry(page, /moved a card from hand to battlefield/i);
  await expectLogEntry(page, /tapped a permanent/i);
  await expectLogEntry(page, /set \+1\/\+1 counters to 2/i);
  await expectLogEntry(page, /changed .* life from 40 to 37/i);
  await expectLogEntry(page, /changed .* life from 37 to 40/i);
  await expectLogEntry(page, /rolled d20 and got/i);
  await expectLogEntry(page, /shuffled their library/i);
  await expectLogEntry(page, /cast their commander.*1/i);
  await expectLogEntry(page, /created .*Clue/i);
  await expectLogEntry(page, /created 2 .*Clue/i);
}

async function expectLogEntry(page: Page, text: RegExp): Promise<void> {
  await expect(page.getByTestId('game-log-entry').filter({ hasText: text }).first()).toBeVisible({ timeout: 20_000 });
}

async function assertNoRawSemanticArtifacts(page: Page): Promise<void> {
  await expect(page.getByTestId('game-log')).not.toContainText('gameLog.');
  await expect(page.getByTestId('game-log')).not.toContainText('[object Object]');
}

async function openLog(page: Page): Promise<void> {
  const logTab = page.getByTestId('game-log-open');
  await expect(logTab).toBeVisible();
  await logTab.click();
  await expect(page.getByTestId('game-log-panel')).toBeVisible();
  await expect(page.getByTestId('game-log')).toBeVisible();
}

function localizedStorageState(baseURL: string, player: GameLogI18nPlayer, appLanguage: 'en' | 'es'): ReturnType<typeof authStorageState> {
  const storage = authStorageState(baseURL, player.user, player.refreshToken);
  const origin = storage.origins[0];
  if (!origin) {
    return storage;
  }
  const userEntry = origin.localStorage.find((entry) => entry.name === 'commanderzone.user');
  if (userEntry) {
    userEntry.value = JSON.stringify({
      ...player.user,
      preferences: {
        ...(player.user as { preferences?: JsonObject }).preferences,
        cardLanguage: appLanguage,
        appLanguage,
      },
    });
  }
  return storage;
}

async function loginRefreshToken(request: APIRequestContext, email: string, password: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { email, password },
  });
  await expectApiOk(response, 'refresh reconnect auth session');
  const token = refreshTokenFromResponse(response);
  if (!token) {
    throw new Error('Reconnect login did not return a refresh token.');
  }
  return token;
}

function refreshTokenFromResponse(response: APIResponse): string | null {
  const setCookie = response.headers()['set-cookie'] ?? '';
  const match = setCookie.match(/commanderzone\.refresh=([^;]+)/);
  return match?.[1] ?? null;
}

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  const snapshot = await gameSnapshot(request, gameId, token);
  return Math.max(1, Number(snapshot['version'] ?? 1));
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'load game snapshot');
  const payload = await response.json() as { game?: { snapshot?: JsonObject } };
  return payload.game?.snapshot ?? {};
}

async function gameBootstrap(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/bootstrap?contract=v2`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectApiOk(response, 'load game bootstrap');
  return await response.json() as JsonObject;
}

function zoneInstanceIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  const zones = players?.[playerId]?.['zones'] as Record<string, JsonObject[]> | undefined;
  return (zones?.[zone] ?? []).map((card) => String(card['instanceId'] ?? '')).filter((id) => id !== '');
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

function assertNoRuntimeFallbackFrames(frames: JsonObject[]): void {
  expect(frames.some((message) => message['kind'] === 'game_patch')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'resync_required' || message['status'] === 'resync_required')).toBe(false);
  expect(frames.some((message) => message['kind'] === 'command_ack' && message['status'] === 'rejected')).toBe(false);
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

async function assertServiceReady(request: APIRequestContext, url: string, service: string): Promise<void> {
  const response = await request.get(url, { timeout: 5_000 });
  if (!response.ok()) {
    throw new Error(`${service} is not ready at ${url}: HTTP ${response.status()}`);
  }
}

async function expectApiOk(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) {
    return;
  }
  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
