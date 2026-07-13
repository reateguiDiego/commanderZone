import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase } from './support/decks';
import { sendRuntimeCommand } from './support/runtime-websocket';

const API = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME = process.env['E2E_GAME_RUNTIME_BASE_URL'] ?? 'http://127.0.0.1:8091';
const SERVICE_URLS = [
  `${API}/healthz`, `${API}/readyz`,
  process.env['E2E_WEBSOCKET_HEALTH_URL'] ?? 'http://127.0.0.1:8081/healthz',
  process.env['E2E_WEBSOCKET_READY_URL'] ?? 'http://127.0.0.1:8081/readyz',
  `${RUNTIME}/healthz`, `${RUNTIME}/readyz`,
];
const DISCONNECTED = /Jugador desconectado|Player disconnected/i;
const EXPEL = /Expulsar|Expel/i;
const execFileAsync = promisify(execFile);

type Json = Record<string, unknown>;
type Player = Awaited<ReturnType<typeof createRealUserSession>> & { deckId: string };
type Setup = { gameId: string; players: Player[] };
type Audit = {
  frames: Json[];
  recoveries: number;
	recoveryUrls: string[];
  gamePatch: number;
  resync: number;
  fallback: number;
  targetNotFound: number;
  errors: string[];
};

test.describe('Sprint 2 integrated correctness and lifecycle release gate', () => {
  test.describe.configure({ mode: 'serial' });

  for (const count of [2, 3, 4, 5, 6]) {
    test(`${count}P composes correctness, lifecycle, control-plane and continuity contracts`, async ({ browser, request, baseURL }) => {
      test.setTimeout(540_000);
      if (!baseURL) throw new Error('Playwright baseURL is required.');
      await assertServices(request);

      const setup = await createGame(request, count);
      const contexts: BrowserContext[] = [];
      const pages: Page[] = [];
      const audits: Audit[] = [];
      try {
        for (const player of setup.players) {
          const context = await browser.newContext({
            baseURL,
            storageState: authStorageState(baseURL, player.user, player.refreshToken),
          });
          await context.addInitScript(() => localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1'));
          const page = await context.newPage();
          const audit = auditPage(page, setup.gameId);
          contexts.push(context);
          pages.push(page);
          audits.push(audit);
        }

        await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
        await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
		await Promise.all(audits.map((audit) => expect.poll(
			() => audit.frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'),
			{ timeout: 30_000 },
		).toBe(true)));
        await Promise.all(pages.map((page) => expect(page.locator('body')).not.toContainText('Unknown Card')));
        const recoveryBaseline = audits.map((audit) => audit.recoveries);

        let state = await snapshot(request, setup.gameId, setup.players[0]!.token);
        const turnOrder = state['turnOrder'] as string[];
        expect(turnOrder).toHaveLength(count);
        expect(new Set(turnOrder).size).toBe(count);
        await assertPrivateProjection(request, setup);

        if (count === 2) {
          state = await validateTwoPlayerLifeAndClose(request, setup, state);
        } else if (count === 3) {
          state = await validateCommanderDamageLifecycle(request, setup, state);
        } else if (count === 4) {
          state = await validateDynamicStatsAndConcede(request, setup, state);
        } else if (count === 5) {
          state = await validateDisconnectExpel(browser, request, baseURL, setup, contexts, pages, audits, state);
        } else {
          state = await validateIntegratedRestart(browser, request, baseURL, setup, contexts, pages, audits, state);
        }

        expect(state['turnOrder']).toEqual(turnOrder);
        const store = await eventStoreState(setup.gameId);
        expect(store.maxVersion).toBe(Number(state['version']));
        expect(store.count).toBeGreaterThan(0);
        const bootstrap = await bootstrapV2(request, setup.gameId, setup.players[0]!.token);
        const bootstrapGame = bootstrap['game'] as Json;
        expect(Number(bootstrapGame['version'])).toBe(Number(state['version']));
        expect(bootstrap['turnOrder']).toEqual(state['turnOrder']);
        expect(bootstrapGame['winnerPlayerId'] ?? null).toBe(state['winnerPlayerId'] ?? null);
        expect(bootstrapGame['resultState'] ?? null).toBe(state['resultState'] ?? null);
        expect(bootstrapGame['rematch']).toEqual(state['rematch']);
		expect(JSON.stringify(state)).not.toMatch(/"connectionEpoch"|"connectionId"|"socketId"|"connectionToken"/i);
		expect(JSON.stringify(bootstrap)).not.toMatch(/"connectionEpoch"|"connectionId"|"socketId"|"connectionToken"/i);

        for (let index = 0; index < audits.length; index++) {
          const expectedRecoveries = recoveryBaseline[index];
          if (expectedRecoveries === undefined) {
            expect(audits[index]!.recoveries, `late context ${index}: ${audits[index]!.recoveryUrls.join(', ')}`).toBe(1);
          } else {
            expect(audits[index]!.recoveries, `context ${index}: ${audits[index]!.recoveryUrls.join(', ')}`).toBe(expectedRecoveries);
          }
          assertCleanAudit(audits[index]!);
        }
        await assertRuntimeMetrics(request, setup.gameId);
        await assertServices(request);
      } finally {
        await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
      }
    });
  }
});

async function validateTwoPlayerLifeAndClose(request: APIRequestContext, setup: Setup, initial: Json): Promise<Json> {
  const targetId = String((initial['turn'] as Json)['activePlayerId']);
  const target = requiredPlayer(setup, targetId);
  const actionId = `s2-life-lethal-${Date.now()}`;
  const lethal = await command(request, {
    gameId: setup.gameId, token: target.token, baseVersion: Number(initial['version']),
    type: 'life.changed', clientActionId: actionId, payload: { playerId: targetId, life: 0 },
  });
  assertOps(lethal.patch, ['player.life.set', 'player.status.set', 'player.elimination.set', 'turn.set', 'turn.order.set', 'game.result.set', 'eventLog.append']);
  const duplicate = await command(request, {
    gameId: setup.gameId, token: target.token, baseVersion: lethal.version,
    type: 'life.changed', clientActionId: actionId, payload: { playerId: targetId, life: 0 },
  });
  expect(duplicate.version).toBe(lethal.version);

  let state = await snapshot(request, setup.gameId, setup.players[0]!.token);
  const targetState = player(state, targetId);
  expect(targetState['status']).toBe('defeated');
  expect(targetState['eliminationReason']).toBe('life');
  expect(state['resultState']).toBe('survivor');
  expect(state['gamePhase']).not.toBe('FINISHED');
  expect((state['eventLog'] as Json[]).some((entry) => entry['i18nKey'] === 'gameLifecycleLog.player.defeatedByLife')).toBe(true);

  const beforeRejected = Number(state['version']);
  await expect(sendRuntimeCommand(request, {
    gameId: setup.gameId, token: target.token, baseVersion: beforeRejected,
    type: 'life.changed', payload: { playerId: targetId, life: 5 },
  })).rejects.toThrow();
  state = await snapshot(request, setup.gameId, setup.players[0]!.token);
  expect(state['version']).toBe(beforeRejected);
  expect(player(state, targetId)['status']).toBe('defeated');

  const closed = await command(request, {
    gameId: setup.gameId, token: setup.players[0]!.token, baseVersion: beforeRejected,
    type: 'game.close', payload: {},
  });
  assertOps(closed.patch, ['game.status.set', 'eventLog.append']);
  state = await snapshot(request, setup.gameId, setup.players[0]!.token);
  expect(state['gamePhase']).toBe('FINISHED');
  expect(state['status']).toMatch(/finished|closed/);
  await expect(sendRuntimeCommand(request, {
    gameId: setup.gameId, token: setup.players[1]!.token, baseVersion: Number(state['version']),
    type: 'life.changed', payload: { playerId: setup.players[1]!.user.id, life: 39 },
  })).rejects.toThrow();
  return state;
}

async function validateCommanderDamageLifecycle(request: APIRequestContext, setup: Setup, initial: Json): Promise<Json> {
  const targetId = String((initial['turn'] as Json)['activePlayerId']);
  const target = requiredPlayer(setup, targetId);
  const source = setup.players.find((candidate) => candidate.user.id !== targetId)!;
  const sourceState = await snapshot(request, setup.gameId, source.token);
  const commanderId = String(zone(sourceState, source.user.id, 'command')[0]?.['instanceId'] ?? '');
  expect(commanderId).not.toBe('');
  let version = Number(initial['version']);
  let expectedLife = Number(player(initial, targetId)['life']);

  for (const damage of [3, 7, 4]) {
    const previousDamage = damage === 3 ? 0 : damage === 7 ? 3 : 7;
    const actionId = damage === 7 ? `s2-cd-retry-${Date.now()}` : undefined;
    const result = await command(request, {
      gameId: setup.gameId, token: target.token, baseVersion: version,
      type: 'commander.damage.changed', clientActionId: actionId,
      payload: { targetPlayerId: targetId, sourcePlayerId: source.user.id, commanderInstanceId: commanderId, damage },
    });
    version = result.version;
    expectedLife -= Math.max(0, damage - previousDamage);
    assertOps(result.patch, ['player.commanderDamage.set', 'player.life.set', 'eventLog.append']);
    if (actionId) {
      const duplicate = await command(request, {
        gameId: setup.gameId, token: target.token, baseVersion: version,
        type: 'commander.damage.changed', clientActionId: actionId,
        payload: { targetPlayerId: targetId, sourcePlayerId: source.user.id, commanderInstanceId: commanderId, damage },
      });
      expect(duplicate.version).toBe(version);
    }
  }

  let state = await snapshot(request, setup.gameId, target.token);
  expect(player(state, targetId)['life']).toBe(expectedLife);
  const beforeRejected = Number(state['version']);
  await expect(sendRuntimeCommand(request, {
    gameId: setup.gameId, token: target.token, baseVersion: beforeRejected,
    type: 'commander.damage.changed',
    payload: { targetPlayerId: targetId, sourcePlayerId: 'invalid-source', commanderInstanceId: commanderId, damage: 20 },
  })).rejects.toThrow();
  expect((await snapshot(request, setup.gameId, target.token))['version']).toBe(beforeRejected);

  const lethal = await command(request, {
    gameId: setup.gameId, token: target.token, baseVersion: beforeRejected,
    type: 'commander.damage.changed',
    payload: { targetPlayerId: targetId, sourcePlayerId: source.user.id, commanderInstanceId: commanderId, damage: 21 },
  });
  assertOps(lethal.patch, ['player.commanderDamage.set', 'player.life.set', 'player.status.set', 'player.elimination.set', 'turn.set', 'turn.order.set', 'game.result.set', 'eventLog.append']);
  state = await snapshot(request, setup.gameId, target.token);
  expect(player(state, targetId)['commanderDamage']).toMatchObject({ [commanderId]: 21 });
  expect(player(state, targetId)['status']).toBe('defeated');
  expect(player(state, targetId)['eliminationReason']).toBe('commander_damage');
  expect((state['turn'] as Json)['activePlayerId']).not.toBe(targetId);
  return state;
}

async function validateDynamicStatsAndConcede(request: APIRequestContext, setup: Setup, initial: Json): Promise<Json> {
  const owner = setup.players[0]!;
  let version = Number(initial['version']);
  const created = await command(request, {
    gameId: setup.gameId, token: owner.token, baseVersion: version, type: 'card.token.created',
    payload: { playerId: owner.user.id, quantity: 1, card: { name: 'Sprint 2 Formula Token', typeLine: 'Token Creature', power: '*', toughness: '1+*' } },
  });
  version = created.version;
  const cardId = String((operation(created.patch, 'zone.cards.add')?.['cards'] as Json[])[0]?.['instanceId'] ?? '');
  expect(cardId).not.toBe('');
  const override = await command(request, {
    gameId: setup.gameId, token: owner.token, baseVersion: version, type: 'card.stats.override.set',
    payload: { playerId: owner.user.id, instanceId: cardId, faceIndex: 0, power: 0, toughness: 2.5 },
  });
  version = override.version;
  expect(operation(override.patch, 'card.stats.override.set')?.['override']).toMatchObject({ power: 0, toughness: 2.5 });
  const counter = await command(request, {
    gameId: setup.gameId, token: owner.token, baseVersion: version, type: 'card.counter.changed',
    payload: { playerId: owner.user.id, instanceId: cardId, counter: '+1/+1', value: 1 },
  });
  version = counter.version;
  expect(operation(counter.patch, 'card.counters.patch')).not.toHaveProperty('power');
  expect(JSON.stringify(counter.patch)).not.toContain('NaN');

  let state = await snapshot(request, setup.gameId, owner.token);
  const card = battlefieldCard(state, owner.user.id, cardId);
  expect(((card['printedStats'] as Record<string, Json>)['0'])['power']).toBe('*');
  expect(((card['manualOverrides'] as Record<string, Json>)['0'])).toMatchObject({ power: 0, toughness: 2.5 });
  expect(card['counters']).toMatchObject({ '+1/+1': 1 });

  const currentId = String((state['turn'] as Json)['activePlayerId']);
  const current = requiredPlayer(setup, currentId);
  const conceded = await command(request, {
    gameId: setup.gameId, token: current.token, baseVersion: version, type: 'game.concede', payload: { playerId: currentId },
  });
  assertOps(conceded.patch, ['player.status.set', 'player.elimination.set', 'turn.set', 'turn.order.set', 'game.result.set', 'eventLog.append']);
  state = await snapshot(request, setup.gameId, owner.token);
  expect(player(state, currentId)['status']).toBe('conceded');
  expect(player(state, currentId)['eliminationReason']).toBe('concede');
  if (currentId === owner.user.id) {
    const persisted = battlefieldCard(state, owner.user.id, cardId);
    expect(persisted['counters']).toMatchObject({ '+1/+1': 1 });
    expect(((persisted['manualOverrides'] as Record<string, Json>)['0'])['power']).toBe(0);
  }
  return state;
}

async function validateDisconnectExpel(
  browser: Parameters<Parameters<typeof test>[1]>[0]['browser'],
  request: APIRequestContext,
  baseURL: string,
  setup: Setup,
  contexts: BrowserContext[],
  pages: Page[],
  audits: Audit[],
  initial: Json,
): Promise<Json> {
  const currentId = String((initial['turn'] as Json)['activePlayerId']);
  const targetIndex = setup.players.findIndex((candidate) => candidate.user.id !== currentId && candidate !== setup.players[0]);
  const target = setup.players[targetIndex]!;
  const secondary = await browser.newContext({
    baseURL,
    storageState: await contexts[targetIndex]!.storageState(),
  });
  contexts.push(secondary);
  const secondaryPage = await secondary.newPage();
  const secondaryAudit = auditPage(secondaryPage, setup.gameId);
  pages.push(secondaryPage);
  audits.push(secondaryAudit);
  await secondaryPage.goto(`/games/${setup.gameId}`);
  await expect(secondaryPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
	await expect.poll(() => secondaryAudit.frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), { timeout: 30_000 }).toBe(true);

  await contexts[targetIndex]!.close();
  await expect.poll(async () => ((await snapshot(request, setup.gameId, setup.players[0]!.token))['presence'] as Record<string, Json>)[target.user.id]?.['connected'], { timeout: 20_000 }).toBe(true);
  expect(voteFromFrames(audits[0]!.frames, target.user.id, 'open')).toBeNull();

  await secondary.close();
  const opened = await waitForVote(audits[0]!.frames, target.user.id, 'open');
  const eligible = opened['eligibleVoterIds'] as string[];
  const required = Math.floor(eligible.length / 2) + 1;
  expect(opened['requiredVotes']).toBe(required);
  expect(eligible).not.toContain(target.user.id);
  const voterIndexes = setup.players
    .map((player, index) => ({ player, index }))
    .filter(({ player, index }) => eligible.includes(player.user.id) && !pages[index]!.isClosed())
    .slice(0, required)
    .map(({ index }) => index);
  for (const index of voterIndexes) {
    await voteModal(pages[index]!).getByRole('button', { name: EXPEL }).click();
  }
  const executed = await waitForVote(audits[0]!.frames, target.user.id, 'executed');
  expect(executed['resolution']).toBe('expel');
  await expect(pages[0]!.getByRole('heading', { name: DISCONNECTED })).toBeHidden({ timeout: 30_000 });

  const state = await snapshot(request, setup.gameId, setup.players[0]!.token);
  expect(player(state, target.user.id)['status']).toBe('conceded');
  expect(player(state, target.user.id)['eliminationReason']).toBe('expelled');
  expect((state['disconnectVote'] as Json)['status']).toBe('executed');
  expect((state['turn'] as Json)['activePlayerId']).not.toBe(target.user.id);
  expect(state['gamePhase']).not.toBe('FINISHED');
  return state;
}

async function validateIntegratedRestart(
  browser: Parameters<Parameters<typeof test>[1]>[0]['browser'],
  request: APIRequestContext,
  baseURL: string,
  setup: Setup,
  contexts: BrowserContext[],
  pages: Page[],
  audits: Audit[],
  initial: Json,
): Promise<Json> {
  const owner = setup.players[0]!;
  let version = Number(initial['version']);
  const created = await command(request, {
    gameId: setup.gameId, token: owner.token, baseVersion: version, type: 'card.token.created',
    payload: { playerId: owner.user.id, quantity: 1, card: { name: 'Integrated Variable Token', typeLine: 'Token Creature', power: '?', toughness: '∞' } },
  });
  version = created.version;
  const cardId = String((operation(created.patch, 'zone.cards.add')?.['cards'] as Json[])[0]?.['instanceId'] ?? '');
  const override = await command(request, {
    gameId: setup.gameId, token: owner.token, baseVersion: version, type: 'card.stats.override.set',
    payload: { playerId: owner.user.id, instanceId: cardId, faceIndex: 0, power: 0 },
  });
  version = override.version;
  version = (await command(request, {
    gameId: setup.gameId, token: owner.token, baseVersion: version, type: 'card.counter.changed',
    payload: { playerId: owner.user.id, instanceId: cardId, counter: '+1/+1', value: 1 },
  })).version;

  let state = await snapshot(request, setup.gameId, owner.token);
  const currentId = String((state['turn'] as Json)['activePlayerId']);
  const target = requiredPlayer(setup, currentId);
  const source = setup.players.find((candidate) => candidate.user.id !== currentId)!;
  const sourceView = await snapshot(request, setup.gameId, source.token);
  const commanderId = String(zone(sourceView, source.user.id, 'command')[0]?.['instanceId'] ?? '');
  const damage = await command(request, {
    gameId: setup.gameId, token: target.token, baseVersion: version, type: 'commander.damage.changed',
    payload: { targetPlayerId: currentId, sourcePlayerId: source.user.id, commanderInstanceId: commanderId, damage: 3 },
  });
  version = damage.version;
  const lifeAfterDamage = Number(player(state, currentId)['life']) - 3;

  const offlineIndex = setup.players.findIndex((candidate) => candidate.user.id !== currentId && candidate.user.id !== owner.user.id);
  const offline = setup.players[offlineIndex]!;
  const reconnectState = await contexts[offlineIndex]!.storageState();
  await contexts[offlineIndex]!.close();
  await waitForVote(audits[0]!.frames, offline.user.id, 'open');
  const reconnected = await browser.newContext({ baseURL, storageState: reconnectState });
  contexts.push(reconnected);
  const reconnectPage = await reconnected.newPage();
  const reconnectAudit = auditPage(reconnectPage, setup.gameId);
  pages.push(reconnectPage);
  audits.push(reconnectAudit);
  await reconnectPage.goto(`/games/${setup.gameId}`);
  await expect(reconnectPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
	await expect.poll(() => reconnectAudit.frames.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), { timeout: 30_000 }).toBe(true);
  await waitForVote(audits[0]!.frames, offline.user.id, 'cancelled');

  state = await snapshot(request, setup.gameId, owner.token);
  version = Number(state['version']);
  expect(player(state, currentId)['life']).toBe(lifeAfterDamage);
  expect(player(state, currentId)['commanderDamage']).toMatchObject({ [commanderId]: 3 });
  expect((state['disconnectVote'] as Json)['resolution']).toBe('reconnected');
  expect(player(state, offline.user.id)['status'] ?? 'active').toBe('active');

  const eliminated = await command(request, {
    gameId: setup.gameId, token: target.token, baseVersion: version, type: 'life.changed',
    payload: { playerId: currentId, life: 0 },
  });
  version = eliminated.version;
  assertOps(eliminated.patch, ['player.status.set', 'player.elimination.set', 'turn.set', 'turn.order.set', 'eventLog.append']);
  state = await snapshot(request, setup.gameId, owner.token);
  const beforeRestart = canonicalContinuity(state, owner.user.id, cardId, currentId, offline.user.id, commanderId);

  await restartRuntime();
  await expect.poll(async () => (await request.get(`${RUNTIME}/readyz`)).ok(), { timeout: 60_000 }).toBe(true);
  const afterRestart = await snapshot(request, setup.gameId, owner.token);
  expect(canonicalContinuity(afterRestart, owner.user.id, cardId, currentId, offline.user.id, commanderId)).toEqual(beforeRestart);

  const actingId = String((afterRestart['turn'] as Json)['activePlayerId']);
  const acting = requiredPlayer(setup, actingId);
  const postRestart = await command(request, {
    gameId: setup.gameId, token: acting.token, baseVersion: Number(afterRestart['version']), type: 'life.changed',
    payload: { playerId: actingId, life: Number(player(afterRestart, actingId)['life']) + 1 },
  });
  expect(postRestart.version).toBe(Number(afterRestart['version']) + 1);
  return snapshot(request, setup.gameId, owner.token);
}

function canonicalContinuity(state: Json, ownerId: string, cardId: string, eliminatedId: string, reconnectedId: string, commanderId: string): Json {
  const card = battlefieldCard(state, ownerId, cardId);
  return {
    version: state['version'], status: state['status'], gamePhase: state['gamePhase'], turnOrder: state['turnOrder'], turn: state['turn'],
    winnerPlayerId: state['winnerPlayerId'] ?? null, resultState: state['resultState'] ?? null, rematch: state['rematch'],
    eliminated: pick(player(state, eliminatedId), ['life', 'status', 'eliminationReason', 'eliminatedAtVersion', 'commanderDamage']),
    reconnected: pick(player(state, reconnectedId), ['status', 'eliminationReason']),
    disconnectVote: state['disconnectVote'], cooldowns: state['disconnectCooldowns'],
    card: pick(card, ['power', 'toughness', 'printedStats', 'manualOverrides', 'counters', 'activeFaceIndex', 'controllerPlayerId']),
    commanderId,
    eventLog: state['eventLog'],
  };
}

async function createGame(request: APIRequestContext, count: number): Promise<Setup> {
  const run = `s2f${count}${Date.now().toString(36)}`;
  const players: Player[] = [];
  for (let index = 0; index < count; index++) {
    const session = await createRealUserSession(request, `${run}-${index}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, { ownerToken: session.token, name: `${run}-deck-${index}` });
    players.push({ ...session, deckId: deck.deckId });
  }
  const created = await request.post(`${API}/rooms`, { headers: auth(players[0]!.token), data: {
    deckId: players[0]!.deckId, visibility: 'private', name: run, format: 'commander', maxPlayers: count,
    mulliganRule: 'LONDON', firstMulliganFree: true,
  } });
  expect(created.ok(), await created.text()).toBe(true);
  const roomId = String(((await created.json()) as { room: Json }).room['id']);
  for (const player of players.slice(1)) {
    const joined = await request.post(`${API}/rooms/${roomId}/join`, { headers: auth(player.token), data: { deckId: player.deckId } });
    expect(joined.ok(), await joined.text()).toBe(true);
  }
  await resolveTurnOrder(request, roomId, players.map((player) => player.token));
  const started = await request.post(`${API}/rooms/${roomId}/start`, { headers: auth(players[0]!.token) });
  expect(started.ok(), await started.text()).toBe(true);
  const gameId = String(((await started.json()) as { game: Json }).game['id']);
  await resolveGameToPlaying(request, gameId, players);
  return { gameId, players };
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await request.get(`${API}/rooms/${roomId}`, { headers: auth(tokens[0]!) });
    const body = (await response.json()) as { room: { players: Array<{ turnRolls?: number[] }> } };
    const rolls = body.room.players.map((player) => player.turnRolls?.join('-') ?? '');
    if (rolls.every(Boolean) && new Set(rolls).size === tokens.length) return;
    for (const token of tokens) {
      const rolled = await request.post(`${API}/rooms/${roomId}/roll-turn`, { headers: auth(token) });
      if (!rolled.ok() && rolled.status() !== 409) throw new Error(await rolled.text());
    }
  }
  throw new Error('Could not resolve turn order.');
}

async function command(request: APIRequestContext, options: Parameters<typeof sendRuntimeCommand>[1]) {
  const result = await sendRuntimeCommand(request, options);
  expect(result.patch['kind']).toBe('patch.v2');
  expect(result.patch['ackClientActionId']).toBe(result.clientActionId);
  return result;
}

async function snapshot(request: APIRequestContext, gameId: string, token: string): Promise<Json> {
  const response = await request.get(`${API}/games/${gameId}/snapshot`, { headers: auth(token) });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { game: { snapshot: Json } }).game.snapshot;
}

async function bootstrapV2(request: APIRequestContext, gameId: string, token: string): Promise<Json> {
  const response = await request.get(`${API}/games/${gameId}/bootstrap?contract=v2`, { headers: auth(token) });
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as Json;
}

async function assertPrivateProjection(request: APIRequestContext, setup: Setup): Promise<void> {
  const owner = setup.players[0]!;
  const viewer = setup.players[1]!;
  const ownerState = await snapshot(request, setup.gameId, owner.token);
  const viewerState = await snapshot(request, setup.gameId, viewer.token);
  const privateCard = zone(ownerState, owner.user.id, 'hand')[0];
  expect(privateCard).toBeDefined();
  const viewerHand = JSON.stringify(zone(viewerState, owner.user.id, 'hand'));
  for (const key of ['instanceId', 'cardKey', 'cardRef', 'printId', 'name']) {
    const value = privateCard?.[key];
    if (typeof value === 'string' && value !== '' && value !== 'Unknown Card') expect(viewerHand).not.toContain(value);
  }
}

function auditPage(page: Page, gameId: string): Audit {
  const audit: Audit = { frames: [], recoveries: 0, recoveryUrls: [], gamePatch: 0, resync: 0, fallback: 0, targetNotFound: 0, errors: [] };
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    try {
      const frame = JSON.parse(String(payload)) as Json;
      audit.frames.push(frame);
      const serialized = JSON.stringify(frame);
      if (frame['kind'] === 'game_patch') audit.gamePatch++;
      if (frame['kind'] === 'resync_required' || frame['status'] === 'resync_required') audit.resync++;
      if (frame['kind'] === 'fallback' || frame['kind'] === 'recovery_required') audit.fallback++;
      if (/target_not_found/i.test(serialized)) audit.targetNotFound++;
    } catch { /* ping or non-JSON protocol frame */ }
  }));
  page.on('request', (httpRequest) => {
    if (httpRequest.method() === 'GET' && new RegExp(`/games/${gameId}/(bootstrap|snapshot)`).test(httpRequest.url())) {
		audit.recoveryUrls.push(httpRequest.url());
		if (!httpRequest.url().includes('knownStaticCards=')) audit.recoveries++;
	}
    if (httpRequest.method() === 'POST' && httpRequest.url().includes(`/games/${gameId}/disconnect-vote`)) audit.fallback++;
  });
  page.on('console', (message) => { if (message.type() === 'error') audit.errors.push(message.text()); });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  return audit;
}

function assertCleanAudit(audit: Audit): void {
  expect(audit.gamePatch).toBe(0);
  expect(audit.resync).toBe(0);
  expect(audit.fallback).toBe(0);
  expect(audit.targetNotFound).toBe(0);
  const serialized = JSON.stringify(audit.frames);
  expect(serialized).not.toMatch(/Unknown Card|"visibilityIndex"|"viewerMask"|"visibleToMask"|"socketId"|"connectionToken"|"connectionEpoch"/i);
  expect(audit.errors.filter((value) => /resync_required|target_not_found|patch contract|NaN/i.test(value))).toEqual([]);
}

async function eventStoreState(gameId: string): Promise<{ count: number; maxVersion: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(gameId)) throw new Error(`Unsafe game id: ${gameId}`);
  const query = `SELECT COUNT(*), COALESCE(MAX(version), 0) FROM game_event WHERE game_id = '${gameId}';`;
  const { stdout } = await execFileAsync('docker', [
    'compose', 'exec', '-T', 'database', 'psql', '-U', 'commanderzone', '-d', 'commanderzone', '-tA', '-F', '|', '-c', query,
  ], { cwd: resolve(process.cwd(), '..'), timeout: 30_000, windowsHide: true });
  const [count, maxVersion] = stdout.trim().split('|').map(Number);
  if (!Number.isFinite(count) || !Number.isFinite(maxVersion)) throw new Error(`Invalid event store result: ${stdout}`);
  return { count: count!, maxVersion: maxVersion! };
}

async function assertRuntimeMetrics(request: APIRequestContext, gameId: string): Promise<void> {
  const response = await request.get(`${RUNTIME}/metrics`);
  expect(response.ok(), await response.text()).toBe(true);
  const metrics = await response.json() as Json;
  const actors = (metrics['actors'] as Json[] | undefined) ?? [];
  const actor = actors.find((candidate) => candidate['gameId'] === gameId);
  expect(actor, `Missing runtime metrics for ${gameId}`).toBeDefined();
  expect(actor?.['command.runtime_coverage_percent']).toBe(100);
  expect(actor?.['command.legacy_fallback_count']).toBe(0);
  expect(actor?.['command.unsupported_count']).toBe(0);
  expect(actor?.['actor.queue_full_count']).toBe(0);
  expect(actor?.['actor.snapshot_post_append_failure_count']).toBe(0);
  const runtime = metrics['runtime'] as Json;
  expect(runtime['command.legacy_fallback_count'] ?? 0).toBe(0);
  expect(runtime['command.runtime_coverage_percent'] ?? 100).toBe(100);
}

async function restartRuntime(): Promise<void> {
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], {
    cwd: resolve(process.cwd(), '..'), timeout: 60_000, windowsHide: true,
  });
}

async function assertServices(request: APIRequestContext): Promise<void> {
  await Promise.all(SERVICE_URLS.map(async (url) => expect((await request.get(url)).ok(), url).toBe(true)));
}

function player(state: Json, playerId: string): Json { return (state['players'] as Record<string, Json>)[playerId]!; }
function zone(state: Json, playerId: string, name: string): Json[] { return ((player(state, playerId)['zones'] as Record<string, Json[]>)[name] ?? []); }
function requiredPlayer(setup: Setup, playerId: string): Player { const found = setup.players.find((candidate) => candidate.user.id === playerId); if (!found) throw new Error(`Missing player ${playerId}`); return found; }
function operation(patch: Json, op: string): Json | null { return ((patch['ops'] as Json[] | undefined) ?? []).find((candidate) => candidate['op'] === op) ?? null; }
function assertOps(patch: Json, required: string[]): void { const names = ((patch['ops'] as Json[] | undefined) ?? []).map((op) => String(op['op'])); for (const name of required) expect(names, `${name} in ${names.join(',')}`).toContain(name); }
function battlefieldCard(state: Json, playerId: string, instanceId: string): Json { const card = zone(state, playerId, 'battlefield').find((candidate) => candidate['instanceId'] === instanceId); if (!card) throw new Error(`Missing battlefield card ${instanceId}`); return card; }
function pick(value: Json, keys: string[]): Json { return Object.fromEntries(keys.map((key) => [key, value[key] ?? null])); }
function auth(token: string): Record<string, string> { return { Authorization: `Bearer ${token}` }; }
function voteModal(page: Page) { return page.locator('.modal-panel').filter({ has: page.getByRole('heading', { name: DISCONNECTED }) }); }
async function waitForVote(frames: Json[], targetPlayerId: string, status: string): Promise<Json> { await expect.poll(() => voteFromFrames(frames, targetPlayerId, status), { timeout: 30_000 }).not.toBeNull(); return voteFromFrames(frames, targetPlayerId, status)!; }
function voteFromFrames(frames: Json[], targetPlayerId: string, status: string): Json | null { for (const frame of frames) { if (frame['kind'] !== 'patch.v2') continue; for (const op of (frame['ops'] as Json[] | undefined) ?? []) { const vote = op['disconnectVote'] as Json | undefined; if (op['op'] === 'disconnect.vote.set' && vote?.['targetPlayerId'] === targetPlayerId && vote['status'] === status) return vote; } } return null; }
