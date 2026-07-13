import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { createRealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase } from './support/decks';
import { sendRuntimeCommand } from './support/runtime-websocket';

const API = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
type Json = Record<string, unknown>;
type Player = Awaited<ReturnType<typeof createRealUserSession>> & { deckId: string };
const execFileAsync = promisify(execFile);

test.describe('authoritative lifecycle and turn order gate', () => {
  test.describe.configure({ mode: 'serial' });

  for (const count of [2, 3, 4, 5, 6]) {
    test(`${count} players preserve seat order, skip eliminated players and produce an explicit survivor result`, async ({ request }) => {
      test.setTimeout(360_000);
      const setup = await createGame(request, count);
      let state = await snapshot(request, setup.gameId, setup.players[0]!.token);
		const order = (state['turnOrder'] as string[] | undefined) ?? Object.keys(state['players'] as Record<string, Json>);
      expect(order).toHaveLength(count);
      expect(new Set(order).size).toBe(count);
      let version = Number(state['version']);

      while (activeIds(state).length > 1) {
        const targetId = String((state['turn'] as Json)['activePlayerId']);
        const target = setup.players.find((player) => player.user.id === targetId)!;
        const result = await sendRuntimeCommand(request, {
          gameId: setup.gameId,
          token: target.token,
          baseVersion: version,
          type: activeIds(state).length === count ? 'game.concede' : 'life.changed',
          payload: activeIds(state).length === count ? { playerId: targetId } : { playerId: targetId, life: 0 },
        });
        expect(result.version).toBe(version + 1);
        const ops = (result.patch['ops'] ?? []) as Json[];
        for (const required of ['player.status.set', 'player.elimination.set', 'turn.set', 'turn.order.set', 'game.result.set', 'eventLog.append']) {
          expect(ops.some((op) => op['op'] === required), `${count}p ${required}`).toBe(true);
        }
        version = result.version;
        state = await snapshot(request, setup.gameId, setup.players[0]!.token);
        expect(state['turnOrder']).toEqual(order);
        expect((state['players'] as Record<string, Json>)[targetId]?.['status']).not.toBe('active');
        expect((state['turn'] as Json)['activePlayerId']).not.toBe(targetId);
      }

      const survivor = activeIds(state)[0]!;
      expect(state['winnerPlayerId']).toBe(survivor);
      expect(state['resultState']).toBe('survivor');
      expect(state['finishedReason']).toBe('last_active');
      expect((state['turn'] as Json)['activePlayerId']).toBe(survivor);
      expect(state['gamePhase']).not.toBe('FINISHED');
		if (count === 6) {
			await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], { cwd: resolve(process.cwd(), '..'), timeout: 60_000, windowsHide: true });
			await expect.poll(async () => (await request.get('http://127.0.0.1:8091/readyz')).ok(), { timeout: 60_000 }).toBe(true);
			state = await snapshot(request, setup.gameId, setup.players[0]!.token);
			expect(state['turnOrder']).toEqual(order);
			expect(state['winnerPlayerId']).toBe(survivor);
			expect((state['turn'] as Json)['activePlayerId']).toBe(survivor);
		}

      const owner = setup.players[0]!;
      const closed = await sendRuntimeCommand(request, { gameId: setup.gameId, token: owner.token, baseVersion: version, type: 'game.close', payload: {} });
      expect(((closed.patch['ops'] ?? []) as Json[]).some((op) => op['op'] === 'game.status.set')).toBe(true);
      state = await snapshot(request, setup.gameId, owner.token);
      expect(state['gamePhase']).toBe('FINISHED');
    });
  }
});

async function createGame(request: APIRequestContext, count: number): Promise<{ gameId: string; players: Player[] }> {
  const run = `lc${count}${Date.now().toString(36)}`;
  const players: Player[] = [];
  for (let index = 0; index < count; index++) {
    const session = await createRealUserSession(request, `${run}-${index}`);
    const deck = await createBasicCommanderDeckFromDatabase(request, { ownerToken: session.token, name: `${run}-deck-${index}` });
    players.push({ ...session, deckId: deck.deckId });
  }
  const roomResponse = await request.post(`${API}/rooms`, { headers: auth(players[0]!.token), data: {
    deckId: players[0]!.deckId, visibility: 'private', name: run, format: 'commander', maxPlayers: count,
    mulliganRule: 'LONDON', firstMulliganFree: true,
  } });
  expect(roomResponse.ok(), await roomResponse.text()).toBe(true);
  const roomId = String(((await roomResponse.json()) as { room: Json }).room['id']);
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
    const room = await request.get(`${API}/rooms/${roomId}`, { headers: auth(tokens[0]!) });
    const body = (await room.json()) as { room: { players: Array<{ turnRolls?: number[] }> } };
    const rolls = body.room.players.map((player) => player.turnRolls?.join('-') ?? '');
    if (rolls.every(Boolean) && new Set(rolls).size === tokens.length) return;
    for (const token of tokens) {
      const response = await request.post(`${API}/rooms/${roomId}/roll-turn`, { headers: auth(token) });
      if (!response.ok() && response.status() !== 409) throw new Error(await response.text());
    }
  }
  throw new Error('Could not resolve turn order');
}

async function snapshot(request: APIRequestContext, gameId: string, token: string): Promise<Json> {
  const response = await request.get(`${API}/games/${gameId}/snapshot`, { headers: auth(token) });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { game: { snapshot: Json } }).game.snapshot;
}
function activeIds(state: Json): string[] { return ((state['turnOrder'] as string[] | undefined) ?? Object.keys(state['players'] as Record<string, Json>)).filter((id) => ((state['players'] as Record<string, Json>)[id]?.['status'] ?? 'active') === 'active'); }
function auth(token: string): Record<string, string> { return { Authorization: `Bearer ${token}` }; }
