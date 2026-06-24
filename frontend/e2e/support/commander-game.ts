import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { createRealUserSession, type RealUserSession } from './auth';
import {
  createBasicCommanderDeckFromDatabase,
  createRandomDeckFromDatabase,
  createValidCommanderDeckFromDatabase,
  type BasicCommanderDeckFromDatabaseResult,
  type RandomDeckFromDatabaseResult,
  type ValidCommanderDeckFromDatabaseResult,
} from './decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

interface RoomPayload {
  room: {
    id: string;
  };
}

interface StartRoomPayload {
  game: {
    id: string;
  };
}

interface RoomStatePayload {
  room: {
    players?: Array<{
      turnRolls?: number[];
    }>;
  };
}

export interface CreateCommanderGameWithRandomDecksOptions {
  runId?: string;
  deckSize?: number;
  roomVisibility?: 'public' | 'private';
  playerAPrefix?: string;
  playerBPrefix?: string;
}

export interface CommanderGamePlayerSetup {
  token: string;
  refreshToken: string;
  user: RealUserSession['user'];
  credentials: RealUserSession['credentials'];
  deck: RandomDeckFromDatabaseResult;
}

export interface CommanderGameWithRandomDecksResult {
  gameId: string;
  roomId: string;
  runId: string;
  playerA: CommanderGamePlayerSetup;
  playerB: CommanderGamePlayerSetup;
  seeds: {
    playerA: string;
    playerB: string;
  };
}

export interface CreateCommanderGameWithValidDecksOptions {
  runId?: string;
  roomVisibility?: 'public' | 'private';
  playerAPrefix?: string;
  playerBPrefix?: string;
}

export interface CommanderGameWithValidDecksResult {
  gameId: string;
  roomId: string;
  runId: string;
  playerA: {
    token: string;
    refreshToken: string;
    user: RealUserSession['user'];
    credentials: RealUserSession['credentials'];
    deck: ValidCommanderDeckFromDatabaseResult;
  };
  playerB: {
    token: string;
    refreshToken: string;
    user: RealUserSession['user'];
    credentials: RealUserSession['credentials'];
    deck: ValidCommanderDeckFromDatabaseResult;
  };
  seeds: {
    playerA: string;
    playerB: string;
  };
}

export interface CommanderGameWithBasicDecksResult {
  gameId: string;
  roomId: string;
  runId: string;
  playerA: {
    token: string;
    refreshToken: string;
    user: RealUserSession['user'];
    credentials: RealUserSession['credentials'];
    deck: BasicCommanderDeckFromDatabaseResult;
  };
  playerB: {
    token: string;
    refreshToken: string;
    user: RealUserSession['user'];
    credentials: RealUserSession['credentials'];
    deck: BasicCommanderDeckFromDatabaseResult;
  };
}

interface CommanderGamePlayerToken {
  token: string;
}

export async function createCommanderGameWithRandomDecks(
  request: APIRequestContext,
  options: CreateCommanderGameWithRandomDecksOptions = {},
): Promise<CommanderGameWithRandomDecksResult> {
  const runId = normalizeRunId(options.runId);
  const deckSize = options.deckSize ?? 100;
  const visibility = options.roomVisibility ?? 'public';
  const playerAPrefix = options.playerAPrefix ?? 'player-a';
  const playerBPrefix = options.playerBPrefix ?? 'player-b';

  const playerA = await createRealUserSession(request, `${playerAPrefix}-${runId}`);
  const playerB = await createRealUserSession(request, `${playerBPrefix}-${runId}`);

  const seedA = `${runId}-deck-a`;
  const seedB = `${runId}-deck-b`;

  const deckA = await createRandomDeckFromDatabase(request, {
    ownerToken: playerA.token,
    name: e2eDeckName('A', runId),
    size: deckSize,
    seed: seedA,
  });
  const deckB = await createRandomDeckFromDatabase(request, {
    ownerToken: playerB.token,
    name: e2eDeckName('B', runId),
    size: deckSize,
    seed: seedB,
  });

  const roomId = await createRoom(request, playerA.token, deckA.deckId, visibility, funRoomName(runId));
  await joinRoom(request, playerB.token, roomId, deckB.deckId);
  await resolveTurnOrder(request, roomId, [playerA.token, playerB.token]);
  const gameId = await startRoom(request, playerA.token, roomId);

  return {
    gameId,
    roomId,
    runId,
    playerA: {
      token: playerA.token,
      refreshToken: playerA.refreshToken,
      user: playerA.user,
      credentials: playerA.credentials,
      deck: deckA,
    },
    playerB: {
      token: playerB.token,
      refreshToken: playerB.refreshToken,
      user: playerB.user,
      credentials: playerB.credentials,
      deck: deckB,
    },
    seeds: {
      playerA: seedA,
      playerB: seedB,
    },
  };
}

export async function createCommanderGameWithValidDecks(
  request: APIRequestContext,
  options: CreateCommanderGameWithValidDecksOptions = {},
): Promise<CommanderGameWithValidDecksResult> {
  const runId = normalizeRunId(options.runId);
  const visibility = options.roomVisibility ?? 'public';
  const playerAPrefix = options.playerAPrefix ?? 'player-alpha';
  const playerBPrefix = options.playerBPrefix ?? 'player-beta';

  const playerA = await createRealUserSession(request, `${playerAPrefix}-${runId}`);
  const playerB = await createRealUserSession(request, `${playerBPrefix}-${runId}`);

  const seedA = `${runId}-valid-deck-a`;
  const seedB = `${runId}-valid-deck-b`;

  const deckA = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: playerA.token,
    name: e2eDeckName('A', runId),
    seed: seedA,
  });
  const deckB = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: playerB.token,
    name: e2eDeckName('B', runId),
    seed: seedB,
  });

  const roomId = await createRoom(request, playerA.token, deckA.deckId, visibility, funRoomName(runId));
  await joinRoom(request, playerB.token, roomId, deckB.deckId);
  await resolveTurnOrder(request, roomId, [playerA.token, playerB.token]);
  const gameId = await startRoom(request, playerA.token, roomId);

  return {
    gameId,
    roomId,
    runId,
    playerA: {
      token: playerA.token,
      refreshToken: playerA.refreshToken,
      user: playerA.user,
      credentials: playerA.credentials,
      deck: deckA,
    },
    playerB: {
      token: playerB.token,
      refreshToken: playerB.refreshToken,
      user: playerB.user,
      credentials: playerB.credentials,
      deck: deckB,
    },
    seeds: {
      playerA: seedA,
      playerB: seedB,
    },
  };
}

async function createRoom(
  request: APIRequestContext,
  token: string,
  deckId: string,
  visibility: 'public' | 'private',
  roomName: string,
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      deckId,
      visibility,
      name: roomName,
      format: 'commander',
      maxPlayers: 2,
      mulliganRule: 'LONDON',
      firstMulliganFree: true,
    },
  });
  await expectApiOk(response, 'create room');
  const payload = (await response.json()) as RoomPayload;

  return payload.room.id;
}

async function joinRoom(
  request: APIRequestContext,
  token: string,
  roomId: string,
  deckId: string,
): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      deckId,
    },
  });
  await expectApiOk(response, 'join room');
}

async function startRoom(
  request: APIRequestContext,
  token: string,
  roomId: string,
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  await expectApiOk(response, 'start room');
  const payload = (await response.json()) as StartRoomPayload;

  return payload.game.id;
}

async function rollTurnOrder(
  request: APIRequestContext,
  token: string,
  roomId: string,
): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  await expectApiOk(response, 'roll turn order');
}

export async function createCommanderGameWithBasicDecks(
  request: APIRequestContext,
  options: CreateCommanderGameWithValidDecksOptions = {},
): Promise<CommanderGameWithBasicDecksResult> {
  const runId = normalizeRunId(options.runId);
  const visibility = options.roomVisibility ?? 'public';
  const playerAPrefix = options.playerAPrefix ?? 'player-alpha';
  const playerBPrefix = options.playerBPrefix ?? 'player-beta';

  const playerA = await createRealUserSession(request, `${playerAPrefix}-${runId}`);
  const playerB = await createRealUserSession(request, `${playerBPrefix}-${runId}`);

  const deckA = await createBasicCommanderDeckFromDatabase(request, {
    ownerToken: playerA.token,
    name: e2eDeckName('A', runId),
  });
  const deckB = await createBasicCommanderDeckFromDatabase(request, {
    ownerToken: playerB.token,
    name: e2eDeckName('B', runId),
  });

  const roomId = await createRoom(request, playerA.token, deckA.deckId, visibility, funRoomName(runId));
  await joinRoom(request, playerB.token, roomId, deckB.deckId);
  await resolveTurnOrder(request, roomId, [playerA.token, playerB.token]);
  const gameId = await startRoom(request, playerA.token, roomId);

  return {
    gameId,
    roomId,
    runId,
    playerA: {
      token: playerA.token,
      refreshToken: playerA.refreshToken,
      user: playerA.user,
      credentials: playerA.credentials,
      deck: deckA,
    },
    playerB: {
      token: playerB.token,
      refreshToken: playerB.refreshToken,
      user: playerB.user,
      credentials: playerB.credentials,
      deck: deckB,
    },
  };
}

export async function resolveGameToPlaying(
  request: APIRequestContext,
  gameId: string,
  players: readonly CommanderGamePlayerToken[],
): Promise<void> {
  if (players.length === 0) {
    throw new Error('At least one player token is required to resolve the game phase.');
  }

  const controllerToken = players[0]?.token ?? '';
  if (controllerToken.trim() === '') {
    throw new Error('A valid controller token is required to resolve the game phase.');
  }

  const initialPhase = await gamePhase(request, gameId, controllerToken);
  if (initialPhase !== 'MULLIGAN') {
    return;
  }

  for (const player of players) {
    const response = await request.post(`${API_BASE_URL}/games/${gameId}/commands`, {
      headers: {
        Authorization: `Bearer ${player.token}`,
      },
      data: {
        type: 'mulligan.keep',
        payload: {},
      },
    });
    await expectApiOk(response, 'resolve mulligan keep');
  }

  const finalPhase = await gamePhase(request, gameId, controllerToken);
  if (finalPhase !== 'PLAYING') {
    throw new Error(`Expected game ${gameId} to reach PLAYING after resolving mulligan, got ${finalPhase ?? 'null'}.`);
  }
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, tokens: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
      headers: {
        Authorization: `Bearer ${tokens[0]}`,
      },
    });
    await expectApiOk(roomResponse, 'load room turn order');
    const payload = (await roomResponse.json()) as RoomStatePayload;
    if (turnOrderResolved(payload.room.players ?? [])) {
      return;
    }

    let progressed = false;
    for (const token of tokens) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.ok()) {
        progressed = true;
        continue;
      }
      if (response.status() === 409) {
        const body = await response.json().catch(() => ({})) as { error?: unknown };
        if (body.error === 'Turn order has already been rolled.') {
          continue;
        }
      }

      const body = await response.text();
      throw new Error(`Failed to resolve turn order. HTTP ${response.status()}: ${body}`);
    }

    if (!progressed) {
      break;
    }
  }

  throw new Error('Unable to resolve turn order after repeated rerolls.');
}

async function gamePhase(request: APIRequestContext, gameId: string, token: string): Promise<string | null> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  await expectApiOk(response, 'load game snapshot');
  const payload = await response.json() as { game?: { snapshot?: { gamePhase?: unknown } } };
  const gamePhase = payload.game?.snapshot?.gamePhase;

  return typeof gamePhase === 'string' && gamePhase.trim() !== '' ? gamePhase : null;
}

function turnOrderResolved(players: Array<{ turnRolls?: number[] }>): boolean {
  if (players.length === 0) {
    return false;
  }

  const sequences = new Set<string>();
  for (const player of players) {
    if (!Array.isArray(player.turnRolls) || player.turnRolls.length === 0) {
      return false;
    }
    const sequence = player.turnRolls.join('-');
    if (sequences.has(sequence)) {
      return false;
    }
    sequences.add(sequence);
  }

  return true;
}

function normalizeRunId(runId?: string): string {
  if (typeof runId === 'string' && runId.trim() !== '') {
    return runId.trim();
  }

  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function e2eDeckName(playerLabel: 'A' | 'B', runId: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').slice(-8) || 'run';

  return `E2E ${playerLabel} ${suffix}`;
}

async function expectApiOk(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) {
    return;
  }

  const body = await response.text();
  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${body}`);
}

function funRoomName(seed: string): string {
  const names = ['Taberna del Mana', 'Trono del Comandante', 'Bahia de las Reliquias', 'Arena del Dragon', 'Santuario del Bosque'];
  const index = Math.abs(seed.split('').reduce((total, char) => total + char.charCodeAt(0), 0)) % names.length;
  const name = names[index] ?? 'Mesa Commander';
  const shortSeed = seed.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase();

  return `${name} ${shortSeed}`.trim();
}
