import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { createRealUserSession, type RealUserSession } from './support/auth';
import { createBasicCommanderDeckFromDatabase, type BasicCommanderDeckFromDatabaseResult } from './support/decks';
import { resolveGameToPlaying } from './support/commander-game';
import { sendRuntimeCommand, type RuntimeWebSocketCommandResult } from './support/runtime-websocket';

const execFileAsync = promisify(execFile);
const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
type JsonObject = Record<string, unknown>;
type Player = RealUserSession & { deck: BasicCommanderDeckFromDatabaseResult };
type Setup = { gameId: string; players: Player[] };

test.describe('TokenGroup authoritative state operations gate', () => {
  test.describe.configure({ mode: 'serial' });
  let setup: Setup;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    const ready = await request.get(RUNTIME_READY_URL, { timeout: 5_000 });
    expect(ready.ok()).toBe(true);
    setup = await createThreePlayerGame(request, `tg-state-${Date.now().toString(36)}`);
    await resolveGameToPlaying(request, setup.gameId, setup.players);
  });

  test('runtime-off fixture certifies the same final-effect algorithms', async () => {
    test.setTimeout(60_000);
    const result = await execFileAsync('php', [
      'bin/phpunit', 'tests/Application/TokenGroupCrossRuntimeContractTest.php',
      '--filter', 'RuntimeOffSplitMergeRemoveDissolve|RuntimeOffUniformState',
    ], { cwd: resolve(process.cwd(), '..', 'backend'), timeout: 50_000, windowsHide: true });
    expect(result.stdout).toContain('OK (');
  });

  test('split merge remove dissolve and uniform state survive refresh reconnect and restart', async ({ request }) => {
    test.setTimeout(540_000);
    const [owner, viewerB, viewerC] = setup.players;
    if (!owner || !viewerB || !viewerC) throw new Error('Three players are required.');

    const apply = async (type: string, payload: JsonObject, clientActionId?: string): Promise<RuntimeWebSocketCommandResult> => {
      const baseVersion = await gameVersion(request, setup.gameId, owner.token);
      return sendRuntimeCommand(request, { gameId: setup.gameId, token: owner.token, baseVersion, type, payload, clientActionId });
    };
    const create20 = await apply('card.token.created', {
      playerId: owner.user.id, quantity: 20, card: { cardKey: 'token:treasure', name: 'Treasure', typeLine: 'Token Artifact - Treasure' },
      position: ratio(.4, .45),
    }, 'tg-state-create-20');
    let group = onlySetGroup(create20.patch);
    expectGroup(group, 20, 1);
    const originalMembers = strings(group['memberRefs']);

    const splitTen = await apply('token.group.split', {
      groupId: group['groupId'], expectedRevision: 1, extractQuantity: 10, destinationPosition: ratio(.68, .42),
    }, 'tg-state-split-ten');
    let groups = setGroups(splitTen.patch);
    expect(groups.map(quantity).sort((a, b) => a - b)).toEqual([10, 10]);
    let original = groups.find((candidate) => candidate['groupId'] === group['groupId'])!;
    let extracted = groups.find((candidate) => candidate['groupId'] !== group['groupId'])!;
    expectGroup(original, 10, 2);
    expectGroup(extracted, 10, 1);

    const splitOne = await apply('token.group.split', {
      groupId: original['groupId'], expectedRevision: 2, extractQuantity: 1, destinationPosition: ratio(.78, .3),
    }, 'tg-state-separate-one');
    original = onlySetGroup(splitOne.patch);
    expectGroup(original, 9, 3);
    const singleId = originalMembers[9]!;
    expect(strings(original['memberRefs'])).not.toContain(singleId);

    const mergeGroups = await apply('token.group.merge', {
      sourceGroupIds: [original['groupId'], extracted['groupId']], sourceInstanceIds: [], targetGroupId: original['groupId'],
      expectedRevisions: { [String(original['groupId'])]: 3, [String(extracted['groupId'])]: 1 }, destinationPosition: ratio(.52, .52),
    }, 'tg-state-merge-groups');
    group = onlySetGroup(mergeGroups.patch);
    expectGroup(group, 19, 4);

    const mergeSingle = await apply('token.group.merge', {
      sourceGroupIds: [group['groupId']], sourceInstanceIds: [singleId], targetGroupId: group['groupId'],
      expectedRevisions: { [String(group['groupId'])]: 4 }, destinationPosition: ratio(.5, .5),
    }, 'tg-state-merge-single');
    group = onlySetGroup(mergeSingle.patch);
    expectGroup(group, 20, 5);

    const removeOne = await apply('token.group.remove_members', {
      groupId: group['groupId'], expectedRevision: 5, quantity: 1, removalReason: 'manual',
    }, 'tg-state-remove-one');
    group = onlySetGroup(removeOne.patch);
    expectGroup(group, 19, 6);
    const retainedRoot = String(group['rootRef']);
    const removeToOne = await apply('token.group.remove_members', {
      groupId: group['groupId'], expectedRevision: 6, quantity: 18, removalReason: 'manual',
    }, 'tg-state-remove-to-one');
    expect(setGroups(removeToOne.patch)).toEqual([]);
    expect(removeOps(removeToOne.patch)).toHaveLength(1);

    const pairCreated = await apply('card.token.created', {
      playerId: owner.user.id, quantity: 2, card: { cardKey: 'token:clue', name: 'Clue', typeLine: 'Token Artifact - Clue' }, position: ratio(.35, .6),
    }, 'tg-state-pair');
    const pair = onlySetGroup(pairCreated.patch);
    const dissolved = await apply('token.group.dissolve', { groupId: pair['groupId'], expectedRevision: 1 }, 'tg-state-dissolve');
    expect(removeOps(dissolved.patch).map((op) => op['groupId'])).toContain(pair['groupId']);
    expect(setGroups(dissolved.patch)).toEqual([]);

    const stateCreated = await apply('card.token.created', {
      playerId: owner.user.id, quantity: 3, card: { cardKey: 'token:soldier', name: 'Soldier', typeLine: 'Token Creature - Soldier' }, position: ratio(.45, .7),
    }, 'tg-state-uniform');
    group = onlySetGroup(stateCreated.patch);
    const stateMembers = strings(group['memberRefs']);
    group = onlySetGroup((await apply('token.group.state.set', { groupId: group['groupId'], expectedRevision: 1, tapped: true }, 'tg-state-tap')).patch);
    expect(group).toMatchObject({ quantity: 3, revision: 2, tapped: true, rotation: 90 });
    group = onlySetGroup((await apply('token.group.state.set', { groupId: group['groupId'], expectedRevision: 2, tapped: false }, 'tg-state-untap')).patch);
    expect(group).toMatchObject({ revision: 3, tapped: false, rotation: 0 });
    group = onlySetGroup((await apply('token.group.state.set', { groupId: group['groupId'], expectedRevision: 3, faceDown: true }, 'tg-state-hide')).patch);
    expect(group).toMatchObject({ revision: 4, faceDown: true });

    const hiddenB = groupByQuantity(await bootstrap(request, setup.gameId, viewerB.token), 3);
    const hiddenC = groupByQuantity(await bootstrap(request, setup.gameId, viewerC.token), 3);
    assertOpaque(hiddenB, group, stateMembers);
    assertOpaque(hiddenC, group, stateMembers);
    expect(hiddenB['groupId']).not.toBe(hiddenC['groupId']);
    expect(groupByQuantity(await bootstrap(request, setup.gameId, viewerB.token), 3)).toEqual(hiddenB);
    await reconnectRuntime(request, setup.gameId, viewerC.token);
    expect(groupByQuantity(await bootstrap(request, setup.gameId, viewerC.token), 3)).toEqual(hiddenC);

    group = onlySetGroup((await apply('token.group.state.set', { groupId: group['groupId'], expectedRevision: 4, faceDown: false }, 'tg-state-show')).patch);
    expect(group).toMatchObject({ revision: 5, faceDown: false });
	group = onlySetGroup((await apply('token.group.counter.changed', { groupId: group['groupId'], expectedRevision: 5, counter: '+1/+1', delta: 2 }, 'tg-state-counter')).patch);
	expect(group).toMatchObject({ revision: 6, counters: { '+1/+1': 2 } });
	group = onlySetGroup((await apply('token.group.power_toughness.set', { groupId: group['groupId'], expectedRevision: 6, power: 4, toughness: 5 }, 'tg-state-pt')).patch);
	expect(group).toMatchObject({ revision: 7, mutableStats: { power: 4, toughness: 5 } });
    const positionPayload = { groupId: group['groupId'], expectedRevision: 7, position: ratio(.82, .18) };
    const positionBaseVersion = await gameVersion(request, setup.gameId, owner.token);
    const positionAction = 'tg-state-position';
    const positioned = await sendRuntimeCommand(request, { gameId: setup.gameId, token: owner.token, baseVersion: positionBaseVersion, clientActionId: positionAction, type: 'token.group.position.set', payload: positionPayload });
    group = onlySetGroup(positioned.patch);
		expect(group).toMatchObject({ revision: 8, position: ratio(.82, .18) });
    const logsBeforeRetry = gameLog(await snapshot(request, setup.gameId, owner.token)).length;
    const retried = await sendRuntimeCommand(request, { gameId: setup.gameId, token: owner.token, baseVersion: positionBaseVersion, clientActionId: positionAction, type: 'token.group.position.set', payload: positionPayload });
    expect(retried.version).toBe(positioned.version);
    expect(retried.patch).toEqual(positioned.patch);
    expect(gameLog(await snapshot(request, setup.gameId, owner.token))).toHaveLength(logsBeforeRetry);

    await expect(apply('card.tapped', { instanceId: stateMembers[1], tapped: true }, 'tg-state-reject-member'))
      .rejects.toThrow('TOKEN_GROUP_MEMBER_REQUIRES_SPLIT');
    await expect(apply('arrow.created', { fromInstanceId: stateMembers[0], toInstanceId: retainedRoot }, 'tg-state-reject-arrow'))
      .rejects.toThrow('TOKEN_GROUP_RELATION_CONFLICT');
    await expect(apply('token.group.position.set', { groupId: group['groupId'], expectedRevision: 7, position: ratio(.2, .2) }, 'tg-state-stale'))
      .rejects.toThrow('TOKEN_GROUP_STALE');

    const beforeRestart = await Promise.all(setup.players.map((player) => bootstrap(request, setup.gameId, player.token)));
    await restartRuntime(request);
    const afterRestart = await Promise.all(setup.players.map((player) => bootstrap(request, setup.gameId, player.token)));
    expect(afterRestart.map(tokenGroups)).toEqual(beforeRestart.map(tokenGroups));

		group = onlySetGroup((await apply('token.group.controller.changed', { groupId: group['groupId'], expectedRevision: 8, targetPlayerId: viewerB.user.id }, 'tg-state-controller')).patch);
		expect(group).toMatchObject({ revision: 9, controllerId: viewerB.user.id });

    const valid = await apply('card.token.created', {
      playerId: owner.user.id, quantity: 1, card: { cardKey: 'token:post-restart', name: 'Post Restart Token' }, position: ratio(.5, .5),
    }, 'tg-state-valid-after-restart');
    expect(operation(valid.patch, 'zone.cards.add')).not.toBeNull();
  });
});

async function createThreePlayerGame(request: APIRequestContext, runId: string): Promise<Setup> {
  const players: Player[] = [];
  for (let index = 0; index < 3; index += 1) {
    const session = await createRealUserSession(request, `${runId}-${index}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, { ownerToken: session.token, name: `TG State ${index} ${runId.slice(-8)}` });
    players.push({ ...session, deck });
  }
  const room = await request.post(`${API_BASE_URL}/rooms`, { headers: bearer(players[0]!.token), data: {
    deckId: players[0]!.deck.deckId, visibility: 'public', name: `TG State ${runId.slice(-8)}`, format: 'commander', maxPlayers: 3,
    mulliganRule: 'LONDON', firstMulliganFree: true,
  } });
  await apiOk(room, 'create room');
  const roomId = String(((await room.json()) as { room?: { id?: string } }).room?.id ?? '');
  for (const player of players.slice(1)) {
    const joined = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, { headers: bearer(player.token), data: { deckId: player.deck.deckId } });
    await apiOk(joined, 'join room');
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const loaded = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: bearer(players[0]!.token) });
    await apiOk(loaded, 'load room');
    const roomPlayers = ((await loaded.json()) as { room?: { players?: Array<{ turnRolls?: number[] }> } }).room?.players ?? [];
    if (roomPlayers.length === 3 && new Set(roomPlayers.map((player) => player.turnRolls?.join('-'))).size === 3 && roomPlayers.every((player) => (player.turnRolls?.length ?? 0) > 0)) break;
    for (const player of players) await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: bearer(player.token) });
  }
  const started = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: bearer(players[0]!.token) });
  await apiOk(started, 'start room');
  return { gameId: String(((await started.json()) as { game?: { id?: string } }).game?.id ?? ''), players };
}

function setGroups(message: JsonObject): JsonObject[] { return operations(message, 'token.group.set').map((op) => op['group']).filter(isRecord); }
function onlySetGroup(message: JsonObject): JsonObject { const groups = setGroups(message); expect(groups).toHaveLength(1); return groups[0]!; }
function removeOps(message: JsonObject): JsonObject[] { return operations(message, 'token.group.remove'); }
function operations(message: JsonObject, op: string): JsonObject[] { return (Array.isArray(message['ops']) ? message['ops'] : []).filter(isRecord).filter((entry) => entry['op'] === op); }
function operation(message: JsonObject, op: string): JsonObject | null { return operations(message, op)[0] ?? null; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : []; }
function quantity(group: JsonObject): number { return Number(group['quantity']); }
function ratio(x: number, y: number): JsonObject { return { x, y, unit: 'ratio' }; }
function expectGroup(group: JsonObject, expectedQuantity: number, revision: number): void { expect(group['quantity']).toBe(expectedQuantity); expect(group['revision']).toBe(revision); expect(strings(group['memberRefs'])).toHaveLength(expectedQuantity); expect(group['rootRef']).toBe(strings(group['memberRefs'])[0]); }
function assertOpaque(projected: JsonObject, canonical: JsonObject, members: string[]): void { expect(projected).toMatchObject({ quantity: canonical['quantity'], revision: canonical['revision'] }); expect(projected).not.toHaveProperty('memberRefs'); const encoded = JSON.stringify(projected); expect(encoded).not.toContain(String(canonical['groupId'])); for (const member of members) expect(encoded).not.toContain(member); }
function tokenGroups(value: JsonObject): JsonObject[] { const relations = isRecord(value['relations']) ? value['relations'] : {}; return (Array.isArray(relations['tokenGroups']) ? relations['tokenGroups'] : []).filter(isRecord).sort((a, b) => String(a['groupId']).localeCompare(String(b['groupId']))); }
function groupByQuantity(value: JsonObject, expected: number): JsonObject { const group = tokenGroups(value).find((candidate) => quantity(candidate) === expected); if (!group) throw new Error(`Missing group quantity ${expected}`); return group; }
function gameLog(value: JsonObject): JsonObject[] { return (Array.isArray(value['eventLog']) ? value['eventLog'] : []).filter(isRecord); }
function isRecord(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function bearer(token: string): { Authorization: string } { return { Authorization: `Bearer ${token}` }; }

async function snapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> { const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: bearer(token) }); await apiOk(response, 'load snapshot'); return ((await response.json()) as { game: { snapshot: JsonObject } }).game.snapshot; }
async function bootstrap(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> { const response = await request.get(`${API_BASE_URL}/games/${gameId}/bootstrap?contract=v2`, { headers: bearer(token) }); await apiOk(response, 'load bootstrap'); const value = await response.json() as JsonObject; return { ...value, ...(isRecord(value['game']) ? value['game'] : {}) }; }
async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> { return Number((await snapshot(request, gameId, token))['version'] ?? 1); }
async function reconnectRuntime(request: APIRequestContext, gameId: string, token: string): Promise<void> { const response = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, { headers: bearer(token) }); await apiOk(response, 'create reconnect ticket'); const url = String(((await response.json()) as { websocketUrl?: string }).websocketUrl ?? ''); await new Promise<void>((resolvePromise, reject) => { const socket = new WebSocket(url); const timer = setTimeout(() => { socket.close(); reject(new Error('Runtime reconnect timed out.')); }, 20_000); socket.addEventListener('open', () => { clearTimeout(timer); socket.close(); resolvePromise(); }); socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Runtime reconnect failed.')); }); }); }
async function restartRuntime(request: APIRequestContext): Promise<void> { await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], { cwd: resolve(process.cwd(), '..'), timeout: 60_000, windowsHide: true }); await expect.poll(async () => { try { return (await request.get(RUNTIME_READY_URL, { timeout: 3_000 })).ok(); } catch { return false; } }, { timeout: 60_000 }).toBe(true); }
async function apiOk(response: { ok(): boolean; status(): number; text(): Promise<string> }, label: string): Promise<void> { if (!response.ok()) throw new Error(`${label}: HTTP ${response.status()} ${await response.text()}`); }
