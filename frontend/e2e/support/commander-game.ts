import { expect, type APIRequestContext } from '@playwright/test';
import { createRealUserSession, type RealUserSession } from './auth';
import {
  createRandomDeckFromDatabase,
  createValidCommanderDeckFromDatabase,
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

export interface CreateCommanderGameWithRandomDecksOptions {
  runId?: string;
  deckSize?: number;
  roomVisibility?: 'public' | 'private';
  playerAPrefix?: string;
  playerBPrefix?: string;
}

export interface CommanderGamePlayerSetup {
  token: string;
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
    user: RealUserSession['user'];
    credentials: RealUserSession['credentials'];
    deck: ValidCommanderDeckFromDatabaseResult;
  };
  playerB: {
    token: string;
    user: RealUserSession['user'];
    credentials: RealUserSession['credentials'];
    deck: ValidCommanderDeckFromDatabaseResult;
  };
  seeds: {
    playerA: string;
    playerB: string;
  };
}

export async function createCommanderGameWithRandomDecks(
  request: APIRequestContext,
  options: CreateCommanderGameWithRandomDecksOptions = {},
): Promise<CommanderGameWithRandomDecksResult> {
  const runId = normalizeRunId(options.runId);
  const deckSize = options.deckSize ?? 100;
  const visibility = options.roomVisibility ?? 'public';
  const playerAPrefix = options.playerAPrefix ?? 'cmd-a';
  const playerBPrefix = options.playerBPrefix ?? 'cmd-b';

  const playerA = await createRealUserSession(request, `${playerAPrefix}-${runId}`);
  const playerB = await createRealUserSession(request, `${playerBPrefix}-${runId}`);

  const seedA = `${runId}-deck-a`;
  const seedB = `${runId}-deck-b`;

  const deckA = await createRandomDeckFromDatabase(request, {
    ownerToken: playerA.token,
    name: `E2E Deck A ${runId}`,
    size: deckSize,
    seed: seedA,
  });
  const deckB = await createRandomDeckFromDatabase(request, {
    ownerToken: playerB.token,
    name: `E2E Deck B ${runId}`,
    size: deckSize,
    seed: seedB,
  });

  const roomId = await createRoom(request, playerA.token, deckA.deckId, visibility);
  await joinRoom(request, playerB.token, roomId, deckB.deckId);
  const gameId = await startRoom(request, playerA.token, roomId);

  return {
    gameId,
    roomId,
    runId,
    playerA: {
      token: playerA.token,
      user: playerA.user,
      credentials: playerA.credentials,
      deck: deckA,
    },
    playerB: {
      token: playerB.token,
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
  const playerAPrefix = options.playerAPrefix ?? 'cmdv-a';
  const playerBPrefix = options.playerBPrefix ?? 'cmdv-b';

  const playerA = await createRealUserSession(request, `${playerAPrefix}-${runId}`);
  const playerB = await createRealUserSession(request, `${playerBPrefix}-${runId}`);

  const seedA = `${runId}-valid-deck-a`;
  const seedB = `${runId}-valid-deck-b`;

  const deckA = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: playerA.token,
    name: `E2E Valid Deck A ${runId}`,
    seed: seedA,
  });
  const deckB = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: playerB.token,
    name: `E2E Valid Deck B ${runId}`,
    seed: seedB,
  });

  const roomId = await createRoom(request, playerA.token, deckA.deckId, visibility);
  await joinRoom(request, playerB.token, roomId, deckB.deckId);
  const gameId = await startRoom(request, playerA.token, roomId);

  return {
    gameId,
    roomId,
    runId,
    playerA: {
      token: playerA.token,
      user: playerA.user,
      credentials: playerA.credentials,
      deck: deckA,
    },
    playerB: {
      token: playerB.token,
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
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      deckId,
      visibility,
    },
  });
  expect(response.ok()).toBeTruthy();
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
  expect(response.ok()).toBeTruthy();
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
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as StartRoomPayload;

  return payload.game.id;
}

function normalizeRunId(runId?: string): string {
  if (typeof runId === 'string' && runId.trim() !== '') {
    return runId.trim();
  }

  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
