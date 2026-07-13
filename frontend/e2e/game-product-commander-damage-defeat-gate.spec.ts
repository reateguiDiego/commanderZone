import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { sendRuntimeCommand } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const SERVICE_URLS = [
  `${API_BASE_URL}/healthz`, `${API_BASE_URL}/readyz`,
  process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz',
  process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz',
  process.env['E2E_GAME_RUNTIME_HEALTH_URL'] ?? 'http://127.0.0.1:8091/healthz',
  process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz',
];
const execFileAsync = promisify(execFile);
type JsonObject = Record<string, unknown>;
type Setup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;
type Player = Setup['playerA'];
type Audit = { frames: JsonObject[]; recoveries: number; errors: string[] };
type CommanderActors = { target: Player; source: Player; targetId: string; sourceId: string; commanderId: string; nonCommanderId: string };

test.describe('commander damage life and defeat atomic gate', () => {
  test.describe.configure({ mode: 'serial' });
  let exactSetup: Setup;
  let overSetup: Setup;
  let restartExpected: { gameId: string; token: string; version: number; targetId: string; commanderId: string; life: number };

  test.beforeAll(async ({ request }) => {
    test.setTimeout(420_000);
    await assertServices(request);
    exactSetup = await createCommanderGameWithBasicDecks(request, { runId: `cd21${Date.now().toString(36)}`, playerAPrefix: 'cd21a', playerBPrefix: 'cd21b' });
    overSetup = await createCommanderGameWithBasicDecks(request, { runId: `cd22${Date.now().toString(36)}`, playerAPrefix: 'cd22a', playerBPrefix: 'cd22b' });
    await resolveGameToPlaying(request, exactSetup.gameId, [exactSetup.playerA, exactSetup.playerB]);
    await resolveGameToPlaying(request, overSetup.gameId, [overSetup.playerA, overSetup.playerB]);
  });

  test('0→3, 3→7, 7→4 and 20→21 are atomic, validated, idempotent and frontend-safe', async ({ browser, request, baseURL }) => {
    test.setTimeout(360_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const initial = await snapshot(request, exactSetup.gameId, exactSetup.playerA.token);
    const actors = await commanderActors(request, exactSetup, initial);
    const contexts = await Promise.all([actors.target, actors.source].map((player) => browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, player.user, player.refreshToken),
    })));
    await Promise.all(contexts.map(enableGameplayV2));
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const audits = pages.map((page) => auditPage(page, exactSetup.gameId));
      await Promise.all(pages.map((page) => page.goto(`/games/${exactSetup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(audits.map(waitConnected));
      const recoveryBaseline = audits.reduce((sum, audit) => sum + audit.recoveries, 0);
      let version = Number(initial['version'] ?? 1);
      let life = player(initial, actors.targetId)['life'] as number;

      const change = async (damage: number, actionId?: string): Promise<JsonObject> => {
        const result = await sendRuntimeCommand(request, {
          gameId: exactSetup.gameId, token: actors.target.token, baseVersion: version,
          type: 'commander.damage.changed', clientActionId: actionId,
          payload: { targetPlayerId: actors.targetId, sourcePlayerId: actors.sourceId, commanderInstanceId: actors.commanderId, damage },
        });
        version = result.version;
        assertAtomicPatch(result.patch, damage);
        return result.patch;
      };

      await change(3); life -= 3; await expectSnapshot(request, exactSetup.gameId, actors.target.token, actors, 3, life, 'active', version);
      await change(7); life -= 4; await expectSnapshot(request, exactSetup.gameId, actors.target.token, actors, 7, life, 'active', version);
      await change(4); await expectSnapshot(request, exactSetup.gameId, actors.target.token, actors, 4, life, 'active', version);

      const rejectedSource = await rejectedCommand(pages[0]!, request, exactSetup.gameId, actors.target.token, version, {
        targetPlayerId: actors.targetId, sourcePlayerId: 'missing-source', commanderInstanceId: actors.commanderId, damage: 5,
      });
      expect((rejectedSource['error'] as JsonObject)['code']).toBe('INVALID_SOURCE');
      const rejectedMissing = await rejectedCommand(pages[0]!, request, exactSetup.gameId, actors.target.token, version, {
        targetPlayerId: actors.targetId, sourcePlayerId: actors.sourceId, commanderInstanceId: 'missing-commander', damage: 5,
      });
      expect((rejectedMissing['error'] as JsonObject)['code']).toBe('COMMANDER_NOT_FOUND');
      const rejectedNonCommander = await rejectedCommand(pages[0]!, request, exactSetup.gameId, actors.target.token, version, {
        targetPlayerId: actors.targetId, sourcePlayerId: actors.sourceId, commanderInstanceId: actors.nonCommanderId, damage: 5,
      });
      expect((rejectedNonCommander['error'] as JsonObject)['code']).toBe('INVALID_COMMANDER');
      await expectSnapshot(request, exactSetup.gameId, actors.target.token, actors, 4, life, 'active', version);

      await change(20); life -= 16;
      const retryId = `commander-damage-retry-${Date.now()}`;
      const beforeRetryVersion = version;
      await change(20, retryId);
      const firstRetryVersion = version;
      await change(20, retryId);
      expect(version).toBe(firstRetryVersion);
      expect(firstRetryVersion).toBe(beforeRetryVersion + 1);
      await expectSnapshot(request, exactSetup.gameId, actors.target.token, actors, 20, life, 'active', version);

      const lethalPatch = await change(21); life -= 1;
      expect((lethalPatch['ops'] as JsonObject[]).map((op) => op['op'])).toEqual([
		'player.commanderDamage.set', 'player.life.set', 'player.status.set', 'player.elimination.set',
		'turn.set', 'turn.order.set', 'game.result.set', 'eventLog.append',
      ]);
      const logEntries = ((lethalPatch['ops'] as JsonObject[]).find((op) => op['op'] === 'eventLog.append')?.['entries'] ?? []) as JsonObject[];
		expect(logEntries.slice(0, 2).map((entry) => entry['i18nKey'])).toEqual([
        'gameLog.commanderDamage.changed', 'gameLog.player.defeatedByCommanderDamage',
      ]);
      const defeated = await expectSnapshot(request, exactSetup.gameId, actors.target.token, actors, 21, life, 'defeated', version);
      expect((defeated['turn'] as JsonObject)['activePlayerId']).toBe(actors.sourceId);

      const defeatedAction = await rejectedTypedCommand(pages[0]!, request, exactSetup.gameId, actors.target.token, version, 'life.changed', { playerId: actors.targetId, delta: -1 });
      expect((defeatedAction['error'] as JsonObject)['code']).toBe('PLAYER_DEFEATED');
      await expectSnapshot(request, exactSetup.gameId, actors.target.token, actors, 21, life, 'defeated', version);

      await Promise.all(audits.map((audit) => expect.poll(() => audit.frames.some((frame) => frame['kind'] === 'patch.v2' && Number(frame['version']) === version), { timeout: 20_000 }).toBe(true)));
      expect(audits.reduce((sum, audit) => sum + audit.recoveries, 0)).toBe(recoveryBaseline);
      await Promise.all(pages.map((page) => page.reload()));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await Promise.all(pages.map((page) => expect(page.locator('body')).not.toContainText('Unknown Card')));
      for (const audit of audits) assertCleanAudit(audit);
      await expectSnapshot(request, exactSetup.gameId, actors.target.token, actors, 21, life, 'defeated', version);
      restartExpected = { gameId: exactSetup.gameId, token: actors.target.token, version, targetId: actors.targetId, commanderId: actors.commanderId, life };
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });

  test('20→22 defeats atomically without clamping or duplicate lifecycle versions', async ({ request }) => {
    const initial = await snapshot(request, overSetup.gameId, overSetup.playerA.token);
    const actors = await commanderActors(request, overSetup, initial);
    let version = Number(initial['version'] ?? 1);
    const first = await sendRuntimeCommand(request, { gameId: overSetup.gameId, token: actors.target.token, baseVersion: version, type: 'commander.damage.changed', payload: { targetPlayerId: actors.targetId, sourcePlayerId: actors.sourceId, commanderInstanceId: actors.commanderId, damage: 20 } });
    version = first.version;
    const lethal = await sendRuntimeCommand(request, { gameId: overSetup.gameId, token: actors.target.token, baseVersion: version, type: 'commander.damage.changed', payload: { targetPlayerId: actors.targetId, sourcePlayerId: actors.sourceId, commanderInstanceId: actors.commanderId, damage: 22 } });
    expect(lethal.version).toBe(version + 1);
    assertAtomicPatch(lethal.patch, 22);
    const state = await snapshot(request, overSetup.gameId, actors.target.token);
    expect(player(state, actors.targetId)['commanderDamage']).toMatchObject({ [actors.commanderId]: 22 });
    expect(player(state, actors.targetId)['life']).toBe(18);
    expect(player(state, actors.targetId)['status']).toBe('defeated');
  });

  test('actor restart preserves persisted damage, life, defeat, turn and GameLog', async ({ request }) => {
    test.setTimeout(180_000);
    await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], { cwd: resolve(process.cwd(), '..'), timeout: 60_000, windowsHide: true });
    await expect.poll(async () => (await request.get(SERVICE_URLS[5]!)).ok(), { timeout: 60_000 }).toBe(true);
    const state = await snapshot(request, restartExpected.gameId, restartExpected.token);
    expect(state['version']).toBe(restartExpected.version);
    expect(player(state, restartExpected.targetId)['commanderDamage']).toMatchObject({ [restartExpected.commanderId]: 21 });
    expect(player(state, restartExpected.targetId)['life']).toBe(restartExpected.life);
    expect(player(state, restartExpected.targetId)['status']).toBe('defeated');
    expect((state['eventLog'] as JsonObject[]).some((entry) => entry['i18nKey'] === 'gameLog.player.defeatedByCommanderDamage')).toBe(true);
    await assertServices(request);
  });
});

async function commanderActors(request: APIRequestContext, setup: Setup, state: JsonObject): Promise<CommanderActors> {
  const active = String((state['turn'] as JsonObject)['activePlayerId'] ?? '');
  const target = setup.playerA.user.id === active ? setup.playerA : setup.playerB;
  const source = target === setup.playerA ? setup.playerB : setup.playerA;
  const sourceState = await snapshot(request, setup.gameId, source.token);
  const command = zone(sourceState, source.user.id, 'command');
  const nonCommander = zone(sourceState, source.user.id, 'hand');
  if (!command[0]?.['instanceId'] || !nonCommander[0]?.['instanceId']) throw new Error('Commander damage gate requires source command and hand cards.');
  return { target, source, targetId: target.user.id, sourceId: source.user.id, commanderId: String(command[0]['instanceId']), nonCommanderId: String(nonCommander[0]['instanceId']) };
}

async function expectSnapshot(request: APIRequestContext, gameId: string, token: string, actors: CommanderActors, damage: number, life: number, status: string, version: number): Promise<JsonObject> {
  const state = await snapshot(request, gameId, token);
  expect(state['version']).toBe(version);
  expect(player(state, actors.targetId)['commanderDamage']).toMatchObject({ [actors.commanderId]: damage });
  expect(player(state, actors.targetId)['life']).toBe(life);
  expect(player(state, actors.targetId)['status'] ?? 'active').toBe(status);
  return state;
}

function assertAtomicPatch(patch: JsonObject, damage: number): void {
  expect(patch['kind']).toBe('patch.v2');
  const ops = patch['ops'] as JsonObject[];
  expect(ops.some((op) => op['op'] === 'player.commanderDamage.set' && Object.values(op['commanderDamage'] as JsonObject).includes(damage))).toBe(true);
  expect(ops.some((op) => op['op'] === 'player.life.set')).toBe(true);
}

async function rejectedCommand(page: Page, request: APIRequestContext, gameId: string, token: string, version: number, payload: JsonObject): Promise<JsonObject> {
  return rejectedTypedCommand(page, request, gameId, token, version, 'commander.damage.changed', payload);
}
async function rejectedTypedCommand(page: Page, request: APIRequestContext, gameId: string, token: string, version: number, type: string, payload: JsonObject): Promise<JsonObject> {
  const ticket = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, { headers: auth(token) });
  if (!ticket.ok()) throw new Error(`Ticket failed: ${await ticket.text()}`);
  const url = String(((await ticket.json()) as JsonObject)['websocketUrl'] ?? '');
  const actionId = `rejected-${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const frames = await page.evaluate(({ url, command, actionId }) => new Promise<JsonObject[]>((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(url); const frames: JsonObject[] = [];
    const timeout = window.setTimeout(() => rejectPromise(new Error(JSON.stringify(frames))), 20_000);
    socket.onopen = () => socket.send(JSON.stringify(command));
    socket.onerror = () => rejectPromise(new Error('runtime websocket failed'));
    socket.onmessage = (event) => { const frame = JSON.parse(String(event.data)) as JsonObject; frames.push(frame); if (frame['kind'] === 'command_ack' && frame['clientActionId'] === actionId) { window.clearTimeout(timeout); socket.close(); resolvePromise(frames); } };
  }), { url, actionId, command: { kind: 'command.v2', gameId, baseVersion: version, clientActionId: actionId, messageId: actionId, type, payload } });
  expect(frames.some((frame) => frame['kind'] === 'patch.v2' || frame['kind'] === 'game_patch' || frame['kind'] === 'resync_required')).toBe(false);
  const ack = frames.find((frame) => frame['kind'] === 'command_ack' && frame['clientActionId'] === actionId);
  if (!ack) throw new Error(`Missing rejection ack: ${JSON.stringify(frames)}`);
  expect(ack['status']).toBe('rejected'); expect(ack['version']).toBe(version);
  return ack;
}

function auditPage(page: Page, gameId: string): Audit {
  const audit: Audit = { frames: [], recoveries: 0, errors: [] };
  page.on('websocket', (socket) => socket.on('framereceived', (event) => { try { audit.frames.push(JSON.parse(typeof event.payload === 'string' ? event.payload : event.payload.toString()) as JsonObject); } catch { /* ignore */ } }));
  page.on('request', (request) => { if (request.method() === 'GET' && new RegExp(`/games/${gameId}/(bootstrap|snapshot)`).test(request.url())) audit.recoveries += 1; });
  page.on('console', (message) => { if (message.type() === 'error') audit.errors.push(message.text()); });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  return audit;
}
async function waitConnected(audit: Audit): Promise<void> { await expect.poll(() => audit.frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), { timeout: 30_000 }).toBe(true); }
function assertCleanAudit(audit: Audit): void {
  expect(audit.frames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
  expect(audit.frames.some((frame) => frame['kind'] === 'resync_required' || frame['status'] === 'resync_required')).toBe(false);
  expect(JSON.stringify(audit.frames)).not.toMatch(/privacy leak|Unknown Card/i);
  expect(audit.errors.filter((error) => /target_not_found|resync_required|failed to apply action/i.test(error))).toEqual([]);
}
async function enableGameplayV2(context: BrowserContext): Promise<void> { await context.addInitScript(() => window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1')); }
async function snapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> { const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: auth(token) }); if (!response.ok()) throw new Error(await response.text()); return ((await response.json()) as { game?: { snapshot?: JsonObject } }).game?.snapshot ?? {}; }
function player(state: JsonObject, playerId: string): JsonObject { return (state['players'] as Record<string, JsonObject>)[playerId]!; }
function zone(state: JsonObject, playerId: string, name: string): JsonObject[] { return ((player(state, playerId)['zones'] as Record<string, JsonObject[]>)[name] ?? []); }
function auth(token: string): Record<string, string> { return { Authorization: `Bearer ${token}` }; }
async function assertServices(request: APIRequestContext): Promise<void> { await Promise.all(SERVICE_URLS.map(async (url) => expect((await request.get(url)).ok(), url).toBe(true))); }
