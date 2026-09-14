import type { BrowserContext, WebSocketRoute } from '@playwright/test';
import type {
  BootstrapV2,
  GameplayPatchV2Operation,
} from '../../src/app/core/models/game-v2.model';
import type { GameCardPosition, GameZoneName } from '../../src/app/core/models/game.model';
import type {
  GameplayClientMessage,
  GameplayPatchV2Message,
} from '../../src/app/core/models/game-realtime.model';
export async function installGridTable(context: BrowserContext, count: number, viewerId: string) {
  const bootstrap = gridBootstrap(count, viewerId);
  await context.addInitScript((user) => {
    if (location.origin !== 'http://127.0.0.1:4200') return;
    localStorage.setItem('commanderzone.user', JSON.stringify(user));
    localStorage.setItem(
      'commanderzone.cookieConsent',
      JSON.stringify({
        version: 6,
        decision: 'rejected',
        preferences: false,
        updatedAt: new Date().toISOString(),
      }),
    );
  }, bootstrap.players[viewerId].user);
  const sockets: WebSocketRoute[] = [];
  const commands: GameplayClientMessage[] = [];
  let version = bootstrap.game.version;
  let response: GameplayPatchV2Operation[] = [];
  let responseType: string | undefined;
  const publish = (ops: GameplayPatchV2Operation[]): void => {
    const patch: GameplayPatchV2Message = {
      kind: 'patch.v2',
      gameId: 'grid-fixture',
      version: ++version,
      visibility: 'public',
      ops,
    };
    for (const socket of sockets) socket.send(JSON.stringify(patch));
  };
  await context.routeWebSocket('ws://127.0.0.1:8081/**', (socket) => {
    sockets.push(socket);
    socket.send(
      JSON.stringify({ kind: 'connection_state', gameId: 'grid-fixture', status: 'connected' }),
    );
    socket.onMessage((data) => {
      const message = JSON.parse(String(data)) as GameplayClientMessage;
      if (message.kind === 'ping') {
        socket.send(
          JSON.stringify({
            kind: 'pong',
            gameId: 'grid-fixture',
            messageId: message.messageId,
            serverTime: new Date().toISOString(),
          }),
        );
      }
      if (message.kind !== 'ping') commands.push(message);
      if (message.kind === 'command.v2') {
        const matchesResponse = !responseType || responseType === message.type;
        const payload = message.payload as {
          playerId: string;
          instanceId: string;
          position: GameCardPosition;
        };
        const patch: GameplayPatchV2Message = {
          kind: 'patch.v2',
          gameId: 'grid-fixture',
          version: (version = Math.max(version, message.baseVersion) + 1),
          visibility: 'public',
          ackClientActionId: message.clientActionId,
          ops:
            message.type === 'card.position.changed'
              ? [{ op: 'card.position.set', zone: 'battlefield', ...payload }]
              : matchesResponse
                ? response
                : [],
        };
        if (matchesResponse) {
          response = [];
          responseType = undefined;
        }
        socket.send(JSON.stringify(patch));
      }
    });
  });
  await context.route('http://127.0.0.1:8000/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path === '/auth/refresh') json = { token: 'grid-fixture-session' };
    else if (path === '/me') json = { user: bootstrap.players[viewerId].user };
    else if (path === '/rooms/current')
      json = {
        room: { id: 'grid-room', gameId: 'grid-fixture' },
        viewerRole: 'player',
        player: { deckId: null },
      };
    else if (path.endsWith('/bootstrap')) json = bootstrap;
    else if (path.endsWith('/websocket-ticket'))
      json = {
        ticket: 'fixture',
        route: 'runtime_ws',
        websocketUrl: 'ws://127.0.0.1:8081/grid-fixture',
      };
    else if (path.includes('/history')) json = { items: [], hasMore: false, nextCursor: null };
    await route.fulfill({ json });
  });
  return {
    sockets,
    commands,
    bootstrap,
    publish,
    respondWith: (ops: GameplayPatchV2Operation[], type?: string): void => {
      response = ops;
      responseType = type;
    },
  };
}

function gridBootstrap(count: number, viewerId: string): BootstrapV2 {
  const fixture: BootstrapV2 = {
    game: {
      id: 'grid-fixture',
      status: 'active',
      version: 1,
      viewerId,
      ownerId: 'p1',
      gamePhase: 'PLAYING',
    },
    players: {},
    zones: {},
    instances: {},
    zoneCounts: {},
    staticCards: {},
    relations: {
      stack: [],
      arrows: [],
      attachments: [],
      battlefieldStacks: [],
      specialEntities: [],
    },
    turn: { activePlayerId: 'p1', phase: 'main-1', number: 1 },
    chat: [],
    eventLog: [],
  };
  if (count === 1)
    fixture.game.rematch = {
      votes: {
        [viewerId]: {
          playerId: viewerId,
          displayName: 'Player 1',
          vote: 'play_again',
          votedAt: new Date().toISOString(),
        },
      },
    };
  const zones: GameZoneName[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
  for (let i = 1; i <= count; i++) {
    const id = `p${i}`;
    const user = { id, email: `${id}@example.test`, displayName: `Player ${i}`, roles: [] };
    fixture.players[id] = {
      playerId: id,
      user,
      displayName: user.displayName,
      life: 40,
      status: 'active',
      isOnline: true,
      handCount: 2,
      zoneIds: zones.map((zone) => `${id}:${zone}`),
      zoneCounts: { hand: 2, battlefield: 3, library: 90, command: 1 },
      commanderDamage: {},
      counters: {},
    };
    for (const zone of zones) {
      const zoneId = `${id}:${zone}`;
      const cards = zone === 'battlefield' ? 3 : zone === 'hand' ? 2 : zone === 'command' ? 1 : 0;
      fixture.zones[zoneId] = { zoneId, playerId: id, name: zone, instanceIds: [] };
      fixture.zoneCounts[zoneId] = zone === 'library' ? 90 : cards;
      for (let card = 0; card < cards; card++) {
        const instanceId = `${zoneId}:${card}`;
        const hidden = zone === 'hand' && id !== viewerId;
        const identity = {
          cardRef: instanceId,
          cardKey: instanceId,
          printId: instanceId,
          cardVersion: 'fixture-v1',
          language: 'en',
          viewerVisibility: zone === 'hand' ? 'private' : 'public',
        };
        fixture.zones[zoneId].instanceIds.push(instanceId);
        fixture.instances[instanceId] = {
          instanceId,
          ...identity,
          zoneId,
          ownerId: id,
          controllerId: id,
          hidden,
          isCommander: zone === 'command',
          position: zone === 'battlefield' ? { x: card / 2, y: card / 2, unit: 'ratio' } : null,
          counters: card === 1 ? { '+1/+1': 2 } : {},
        };
        if (!hidden)
          fixture.staticCards[instanceId] = {
            ...identity,
            name: zone === 'hand' ? `Private ${id}` : `Public ${id} ${card}`,
            typeLine: 'Creature',
            defaultPower: '2',
            defaultToughness: '2',
            imageUris: null,
          };
      }
    }
  }
  return fixture;
}
