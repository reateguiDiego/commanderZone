import { GameCardInstance, GameSnapshot } from '../../../../../core/models/game.model';
import { GameTableSnapshotSelectors } from './game-table-snapshot-selectors';

describe('GameTableSnapshotSelectors gameplay contract', () => {
  let selectors: GameTableSnapshotSelectors;

  beforeEach(() => {
    selectors = new GameTableSnapshotSelectors();
  });

  it('uses GameSnapshot players and focused player state as the UI source of truth', () => {
    const snapshot = gameplaySnapshot();
    const players = selectors.players(snapshot);
    const focused = selectors.focusedPlayer(snapshot, players, 'focused-player');

    expect(players.map((player) => player.id)).toEqual(['owner-player', 'controller-player', 'focused-player', 'library-player']);
    expect(selectors.focusedPlayer(snapshot, players, null)?.id).toBe('controller-player');
    expect(focused?.id).toBe('focused-player');
    expect(selectors.gameBackgroundImage(focused)).toBe('/assets/images/play-mat/G_3.webp');
  });

  it('uses the owner sleeves for face-down cards even when another player controls them', () => {
    const snapshot = gameplaySnapshot();
    const controlledFaceDownCard: GameCardInstance = {
      instanceId: 'controlled-face-down',
      ownerId: 'owner-player',
      controllerId: 'controller-player',
      name: 'Face-down card',
      tapped: true,
      faceDown: true,
      zone: 'battlefield',
    };

    expect(selectors.cardImage(controlledFaceDownCard, snapshot)).toBe('/assets/images/facedown_card.jpg');
  });

  it('uses the pile owner sleeves for hidden library preview and stack layers', () => {
    const libraryPlayer = selectors.players(gameplaySnapshot()).find((player) => player.id === 'library-player');

    expect(libraryPlayer).not.toBeUndefined();
    expect(selectors.zonePreviewImage(libraryPlayer!, 'library')).toBe('/assets/images/facedown_card.jpg');
    expect(selectors.zoneStackLayerImage(libraryPlayer!, 'library')).toBe('/assets/images/facedown_card.jpg');
  });

  it('derives visible hand count from zoneCounts instead of stale hand array length', () => {
    const focused = selectors.players(gameplaySnapshot()).find((player) => player.id === 'focused-player');

    expect(focused).not.toBeUndefined();
    expect(selectors.zoneCount(focused!, 'hand')).toBe(6);
  });
});

function gameplaySnapshot(): GameSnapshot {
  return {
    version: 12,
    ownerId: 'owner-player',
    players: {
      'owner-player': player('owner-player', {
        sleevesName: 'facedown_card',
        backgroundName: 'U_2',
      }),
      'controller-player': player('controller-player', {
        sleevesName: undefined,
        backgroundName: 'B_4',
      }),
      'focused-player': player('focused-player', {
        sleevesName: 'facedown_card',
        backgroundName: 'G_3',
        zones: {
          library: [],
          hand: [
            { instanceId: 'stale-hand-card', ownerId: 'focused-player', controllerId: 'focused-player', name: 'Hand Card', tapped: false, zone: 'hand' },
          ],
          battlefield: [],
          graveyard: [],
          exile: [],
          command: [],
        },
        zoneCounts: {
          library: 0,
          hand: 6,
          battlefield: 0,
          graveyard: 0,
          exile: 0,
          command: 0,
        },
      }),
      'library-player': player('library-player', {
        sleevesName: 'facedown_card',
        backgroundName: 'R_1',
        zones: {
          library: [
            { instanceId: 'library-top', ownerId: 'library-player', controllerId: 'library-player', name: 'Hidden Top', tapped: false, hidden: true, faceDown: true, zone: 'library' },
            { instanceId: 'library-second', ownerId: 'library-player', controllerId: 'library-player', name: 'Hidden Second', tapped: false, hidden: true, faceDown: true, zone: 'library' },
          ],
          hand: [],
          battlefield: [],
          graveyard: [],
          exile: [],
          command: [],
        },
        zoneCounts: {
          library: 2,
          hand: 0,
          battlefield: 0,
          graveyard: 0,
          exile: 0,
          command: 0,
        },
      }),
    },
    turn: { activePlayerId: 'controller-player', phase: 'main', number: 4 },
    stack: [],
    arrows: [],
    attachments: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-01-01T00:00:00+00:00',
    updatedAt: '2026-01-01T00:01:00+00:00',
  };
}

function player(id: string, overrides: Partial<GameSnapshot['players'][string]> = {}): GameSnapshot['players'][string] {
  return {
    user: { id, email: `${id}@example.test`, displayName: id, roles: [] },
    deckName: `${id} deck`,
    life: 40,
    zones: {
      library: [],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      command: [],
    },
    zoneCounts: {
      library: 0,
      hand: 0,
      battlefield: 0,
      graveyard: 0,
      exile: 0,
      command: 0,
    },
    commanderDamage: {},
    counters: {},
    ...overrides,
  };
}
