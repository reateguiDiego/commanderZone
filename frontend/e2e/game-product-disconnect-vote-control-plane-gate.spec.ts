import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase } from './support/decks';

const API = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const DISCONNECTED = /Jugador desconectado|Player disconnected/i;
const EXPEL = /Expulsar|Expel/i;
type Json = Record<string, unknown>;
type Player = Awaited<ReturnType<typeof createRealUserSession>> & { deckId: string };

test.describe('durable disconnect vote control plane 2-6', () => {
  test.describe.configure({ mode: 'serial' });

  for (const count of [2, 3, 4, 5, 6]) {
    test(`${count} players freeze quorum and atomically expel the disconnected target`, async ({ browser, request, baseURL }) => {
      test.setTimeout(420_000);
      if (!baseURL) throw new Error('Playwright baseURL is required.');
      const setup = await createGame(request, count);
      const contexts: BrowserContext[] = [];
      const pages: Page[] = [];
      const frames: Json[][] = [];
      const audit = { gamePatch: 0, resync: 0, rejected: 0, fallback: 0, refetch: 0 };
      try {
        for (const player of setup.players) {
          const context = await browser.newContext({
            baseURL,
            storageState: authStorageState(baseURL, player.user, player.refreshToken),
          });
          await context.addInitScript(() => localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1'));
          const page = await context.newPage();
          const received = collectFrames(page, audit);
          auditRequests(page, setup.gameId, audit);
          contexts.push(context);
          pages.push(page);
          frames.push(received);
        }

        await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
        await Promise.all(pages.map((page, index) => Promise.all([
          expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 }),
          expect.poll(() => frames[index]!.some((frame) => frame['kind'] === 'connection_state' && frame['status'] === 'connected'), { timeout: 30_000 }).toBe(true),
        ])));
		await expect.poll(async () => {
			const live = await snapshot(request, setup.gameId, setup.players[0]!.token);
			const presence = live['presence'] as Record<string, Json>;
			return setup.players.every((player) => presence[player.user.id]?.['connected'] !== false);
		}, { timeout: 30_000 }).toBe(true);
        const refetchBaseline = audit.refetch;
        const targetIndex = count - 1;
        const target = setup.players[targetIndex]!;
        await contexts[targetIndex]!.close();

        const opened = await waitForVote(frames[0]!, target.user.id, 'open');
		expect(audit.resync).toBe(0);
		await expect(pages[0]!.getByRole('heading', { name: DISCONNECTED })).toBeVisible({ timeout: 30_000 });
        const voteId = String(opened['voteId']);
        const eligible = opened['eligibleVoterIds'] as string[];
        const required = Math.floor(eligible.length / 2) + 1;
        expect(eligible).toHaveLength(count - 1);
        expect(opened['requiredVotes']).toBe(required);
        expect(new Set(eligible).size).toBe(eligible.length);
        expect(eligible).not.toContain(target.user.id);

        const voters = setup.players
          .map((player, index) => ({ player, index }))
          .filter(({ player }) => eligible.includes(player.user.id))
          .slice(0, required);
        if (count === 6) {
          await Promise.all(voters.map(({ index }) => voteModal(pages[index]!).getByRole('button', { name: EXPEL }).click()));
        } else {
          for (const { index } of voters) {
            await voteModal(pages[index]!).getByRole('button', { name: EXPEL }).click();
          }
        }

        const executed = await waitForVote(frames[0]!, target.user.id, 'executed');
        expect(executed['voteId']).toBe(voteId);
        expect(executed['resolution']).toBe('expel');
        await expect(pages[0]!.getByRole('heading', { name: DISCONNECTED })).toBeHidden({ timeout: 30_000 });

        const live = await snapshot(request, setup.gameId, setup.players[0]!.token);
        const targetState = (live['players'] as Record<string, Json>)[target.user.id]!;
        expect(targetState['status']).toBe('conceded');
        expect(targetState['eliminationReason']).toBe('expelled');
        expect((live['turnOrder'] as string[])).toContain(target.user.id);
        expect((live['turn'] as Json)['activePlayerId']).not.toBe(target.user.id);
        expect(live['gamePhase']).not.toBe('FINISHED');
        expect((live['disconnectVote'] as Json)['status']).toBe('executed');
        expect((((live['rematch'] as Json)['votes'] as Record<string, Json>)[target.user.id])['vote']).toBe('leave');

        const bootstrap = await bootstrapV2(request, setup.gameId, setup.players[0]!.token);
        const bootstrapGame = bootstrap['game'] as Json;
        expect((bootstrapGame['disconnectVote'] as Json)['voteId']).toBe(voteId);
        expect((bootstrapGame['disconnectVote'] as Json)['status']).toBe('executed');
        expect((bootstrapGame['rematch'] as Json)['votes']).toEqual((live['rematch'] as Json)['votes']);

        await pages[0]!.reload();
        await expect(pages[0]!.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
        await expect(pages[0]!.getByRole('heading', { name: DISCONNECTED })).toBeHidden();
        expect(audit.refetch).toBe(refetchBaseline + 1);
        expect(audit.gamePatch).toBe(0);
        expect(audit.resync).toBe(0);
        expect(audit.rejected).toBe(0);
        expect(audit.fallback).toBe(0);
        expect(JSON.stringify(frames)).not.toContain('Unknown Card');
      } finally {
        await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
      }
    });
  }

  test('target reconnect durably cancels an open vote without lifecycle elimination', async ({ browser, request, baseURL }) => {
    test.setTimeout(180_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const setup = await createGame(request, 3);
    const contexts: BrowserContext[] = [];
    const frames: Json[] = [];
    try {
      for (let index = 0; index < setup.players.length; index++) {
        const player = setup.players[index]!;
        const context = await browser.newContext({
          baseURL,
          storageState: authStorageState(baseURL, player.user, player.refreshToken),
        });
        await context.addInitScript(() => localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1'));
        const page = await context.newPage();
        if (index === 0) collectFrames(page, { gamePatch: 0, resync: 0, rejected: 0, fallback: 0 });
        page.on('websocket', (socket) => socket.on('framereceived', (event) => {
          if (index !== 0) return;
          try { frames.push(JSON.parse(typeof event.payload === 'string' ? event.payload : event.payload.toString('utf8')) as Json); } catch { /* protocol frame */ }
        }));
        contexts.push(context);
        await page.goto(`/games/${setup.gameId}`);
        await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      }

      const targetIndex = 2;
      const target = setup.players[targetIndex]!;
	  const reconnectStorageState = await contexts[targetIndex]!.storageState();
      await contexts[targetIndex]!.close();
      await waitForVote(frames, target.user.id, 'open');

      const reconnected = await browser.newContext({
        baseURL,
        storageState: reconnectStorageState,
      });
      contexts.push(reconnected);
      const targetPage = await reconnected.newPage();
      await targetPage.goto(`/games/${setup.gameId}`);
      await expect(targetPage.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });

      const cancelled = await waitForVote(frames, target.user.id, 'cancelled');
      expect(cancelled['resolution']).toBe('reconnected');
      const live = await snapshot(request, setup.gameId, setup.players[0]!.token);
      expect(((live['players'] as Record<string, Json>)[target.user.id])['status']).toBe('active');
      expect((live['turnOrder'] as string[])).toContain(target.user.id);
      expect(((live['disconnectCooldowns'] as Record<string, Json>)[target.user.id])['reason']).toBe('reconnected');
      expect(((live['presence'] as Record<string, Json>)[target.user.id])['connected']).toBe(true);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });

  test('server-side timeout expires to wait and persists target cooldown', async ({ browser, request, baseURL }) => {
    test.setTimeout(180_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const setup = await createGame(request, 2);
    const contexts: BrowserContext[] = [];
    const frames: Json[] = [];
    try {
      for (let index = 0; index < setup.players.length; index++) {
        const player = setup.players[index]!;
        const context = await browser.newContext({ baseURL, storageState: authStorageState(baseURL, player.user, player.refreshToken) });
        const page = await context.newPage();
        if (index === 0) {
          page.on('websocket', (socket) => socket.on('framereceived', (event) => {
            try { frames.push(JSON.parse(typeof event.payload === 'string' ? event.payload : event.payload.toString('utf8')) as Json); } catch { /* protocol frame */ }
          }));
        }
        contexts.push(context);
        await page.goto(`/games/${setup.gameId}`);
        await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      }

      const target = setup.players[1]!;
      await contexts[1]!.close();
      const opened = await waitForVote(frames, target.user.id, 'open');
      const openedAt = String(opened['openedAt']);

      await expect.poll(async () => {
        const live = await snapshot(request, setup.gameId, setup.players[0]!.token);
        return (live['disconnectVote'] as Json | null)?.['status'] ?? null;
      }, { timeout: 90_000, intervals: [1_000] }).toBe('expired');

      const expired = await snapshot(request, setup.gameId, setup.players[0]!.token);
      const vote = expired['disconnectVote'] as Json;
      expect(vote['resolution']).toBe('wait');
      expect(vote['openedAt']).toBe(openedAt);
      expect(vote['cooldownUntil']).toMatch(/T/);
      expect(((expired['players'] as Record<string, Json>)[target.user.id])['status']).toBe('active');
      expect(((expired['disconnectCooldowns'] as Record<string, Json>)[target.user.id])['reason']).toBe('wait');
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});

async function createGame(request: APIRequestContext, count: number): Promise<{ gameId: string; players: Player[] }> {
  const run = `dcp${count}${Date.now().toString(36)}`;
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

function voteModal(page: Page) {
  return page.locator('.modal-panel').filter({ has: page.getByRole('heading', { name: DISCONNECTED }) });
}

async function waitForVote(frames: Json[], targetPlayerId: string, status: string): Promise<Json> {
  await expect.poll(() => voteFromFrames(frames, targetPlayerId, status), { timeout: 30_000 }).not.toBeNull();
  return voteFromFrames(frames, targetPlayerId, status)!;
}

function voteFromFrames(frames: Json[], targetPlayerId: string, status: string): Json | null {
  for (const frame of frames) {
    if (frame['kind'] !== 'patch.v2') continue;
    for (const op of (frame['ops'] as Json[] | undefined) ?? []) {
      const vote = op['disconnectVote'] as Json | undefined;
      if (op['op'] === 'disconnect.vote.set' && vote?.['targetPlayerId'] === targetPlayerId && vote['status'] === status) return vote;
    }
  }
  return null;
}

function collectFrames(page: Page, audit: { gamePatch: number; resync: number; rejected: number; fallback: number }): Json[] {
  const frames: Json[] = [];
  page.on('websocket', (socket) => socket.on('framereceived', (event) => {
    try {
      const frame = JSON.parse(typeof event.payload === 'string' ? event.payload : event.payload.toString('utf8')) as Json;
      frames.push(frame);
      if (frame['kind'] === 'game_patch') audit.gamePatch++;
      if (frame['kind'] === 'resync_required' || frame['status'] === 'resync_required') audit.resync++;
      if (frame['status'] === 'rejected') audit.rejected++;
      if (frame['kind'] === 'fallback' || frame['kind'] === 'recovery_required') audit.fallback++;
    } catch { /* Non-JSON protocol frame. */ }
  }));
  return frames;
}

function auditRequests(page: Page, gameId: string, audit: { fallback: number; refetch: number }): void {
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'POST' && url.includes(`/games/${gameId}/disconnect-vote`)) audit.fallback++;
    if (request.method() !== 'GET') return;
    const parsed = new URL(url);
    const isSnapshot = parsed.pathname.includes(`/games/${gameId}/snapshot`);
    const isBootstrap = parsed.pathname.includes(`/games/${gameId}/bootstrap`);
    // Compact static-card hydration is an intentional follow-up to the initial
    // bootstrap, not snapshot recovery. In dense 6P games it can finish after
    // presence becomes stable, so counting it made the recovery baseline race.
    const isStaticHydration = isBootstrap && parsed.searchParams.has('knownStaticCards');
    if (isSnapshot || (isBootstrap && !isStaticHydration)) audit.refetch++;
  });
}

function auth(token: string): Record<string, string> { return { Authorization: `Bearer ${token}` }; }
