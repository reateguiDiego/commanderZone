import { GamePlayerState } from '../../../../../core/models/game.model';
import { GameTableSnapshotSelectors, PlayerView } from './game-table-snapshot-selectors';

describe('GameTableSnapshotSelectors', () => {
  let selectors: GameTableSnapshotSelectors;

  beforeEach(() => {
    selectors = new GameTableSnapshotSelectors();
  });

  it('uses the player deck name as the deck label', () => {
    const player = playerView({
      deckName: 'Food and Fellowship',
      zones: {
        command: [{ instanceId: 'commander-1', name: 'Frodo, Adventurous Hobbit', tapped: false }],
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
      },
    });

    expect(selectors.deckLabel(player)).toBe('Food and Fellowship');
  });

  it('does not invent a deck label when no deck name is available', () => {
    expect(selectors.deckLabel(playerView({ deckName: null }))).toBe('');
  });

  it('renders ratio battlefield positions against the current battlefield size', () => {
    const card = { instanceId: 'card-1', name: 'Bear', tapped: false, position: { x: 0.5, y: 0.5, unit: 'ratio' as const } };

    expect(selectors.cardPosition(card, { width: 900, height: 520 })).toEqual({ x: 392, y: 179 });
    expect(selectors.cardPosition(card, { width: 320, height: 260 })).toEqual({ x: 102, y: 49 });
  });

  it('keeps legacy pixel battlefield positions unchanged', () => {
    const card = { instanceId: 'card-1', name: 'Bear', tapped: false, position: { x: 120, y: 240 } };

    expect(selectors.cardPosition(card, { width: 320, height: 260 })).toEqual({ x: 120, y: 240 });
  });

  it('does not render power toughness when manual stats have been cleared', () => {
    const card = {
      instanceId: 'card-1',
      name: 'Construct',
      typeLine: 'Artifact Creature',
      tapped: false,
      power: null,
      toughness: null,
      defaultPower: null,
      defaultToughness: null,
    };

    expect(selectors.shouldShowPowerToughness(card)).toBe(false);
    expect(selectors.cardPowerValue(card)).toBeNull();
    expect(selectors.cardToughnessValue(card)).toBeNull();
  });

  it('uses the active double-faced card image', () => {
    const card = {
      instanceId: 'card-1',
      name: 'Front // Back',
      tapped: false,
      imageUris: { normal: '/front-root.jpg' },
      activeFaceIndex: 1,
      cardFaces: [
        { name: 'Front', manaCost: null, typeLine: null, oracleText: null, power: null, toughness: null, loyalty: null, colors: [], imageUris: { normal: '/front.jpg' } },
        { name: 'Back', manaCost: null, typeLine: null, oracleText: null, power: null, toughness: null, loyalty: null, colors: [], imageUris: { normal: '/back.jpg' } },
      ],
    };

    expect(selectors.publicCardImage(card)).toBe('/back.jpg');
  });

  it('uses the revealed top library card as the library preview image', () => {
    const topCard = {
      instanceId: 'top-card',
      name: 'Public Top',
      tapped: false,
      zone: 'library' as const,
      imageUris: { normal: '/top.jpg' },
    };
    const player = playerView({
      playTopLibraryRevealed: true,
      zones: {
        library: [topCard],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: [],
      },
    });

    expect(selectors.zonePreviewCard(player, 'library')).toBe(topCard);
    expect(selectors.zonePreviewImage(player, 'library')).toBe('/top.jpg');
  });

  it('uses the card back for library stack layers when only the top card is revealed', () => {
    const player = playerView({
      playTopLibraryRevealed: true,
      zones: {
        library: [
          { instanceId: 'top-card', name: 'Public Top', tapped: false, imageUris: { normal: '/top.jpg' } },
          { instanceId: 'second-card', name: 'Public Second', tapped: false, imageUris: { normal: '/second.jpg' } },
        ],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: [],
      },
    });

    expect(selectors.zonePreviewImage(player, 'library')).toBe('/top.jpg');
    expect(selectors.zoneStackLayerImage(player, 'library')).toBe('/assets/images/facedown_card.jpg');
  });

  it('uses the second library card image for stack layers when that card is explicitly revealed', () => {
    const player = playerView({
      zones: {
        library: [
          { instanceId: 'top-card', name: 'Hidden Top', tapped: false, imageUris: { normal: '/top.jpg' } },
          { instanceId: 'second-card', name: 'Public Second', tapped: false, imageUris: { normal: '/second.jpg' }, revealedTo: ['player-1'] },
        ],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: [],
      },
    });

    expect(selectors.zoneStackLayerImage(player, 'library')).toBe('/second.jpg');
  });

  it('uses the card back for hidden library stack layers', () => {
    const player = playerView({
      sleevesName: 'facedown_card',
      zones: {
        library: [
          { instanceId: 'top-card', name: 'Hidden Top', tapped: false, imageUris: { normal: '/top.jpg' } },
          { instanceId: 'second-card', name: 'Hidden Second', tapped: false, imageUris: { normal: '/second.jpg' } },
        ],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: [],
      },
    });

    expect(selectors.zonePreviewImage(player, 'library')).toBe('/assets/images/facedown_card.jpg');
    expect(selectors.zoneStackLayerImage(player, 'library')).toBe('/assets/images/facedown_card.jpg');
  });

  it('uses the second-from-top public card image for graveyard and exile stack layers', () => {
    const player = playerView({
      zones: {
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [
          { instanceId: 'graveyard-bottom', name: 'Bottom Graveyard', tapped: false, imageUris: { normal: '/graveyard-bottom.jpg' } },
          { instanceId: 'graveyard-second', name: 'Second Graveyard', tapped: false, imageUris: { normal: '/graveyard-second.jpg' } },
          { instanceId: 'graveyard-top', name: 'Top Graveyard', tapped: false, imageUris: { normal: '/graveyard-top.jpg' } },
        ],
        exile: [
          { instanceId: 'exile-second', name: 'Second Exile', tapped: false, imageUris: { normal: '/exile-second.jpg' } },
          { instanceId: 'exile-top', name: 'Top Exile', tapped: false, imageUris: { normal: '/exile-top.jpg' } },
        ],
        command: [],
      },
    });

    expect(selectors.zonePreviewImage(player, 'graveyard')).toBe('/graveyard-top.jpg');
    expect(selectors.zoneStackLayerImage(player, 'graveyard')).toBe('/graveyard-second.jpg');
    expect(selectors.zonePreviewImage(player, 'exile')).toBe('/exile-top.jpg');
    expect(selectors.zoneStackLayerImage(player, 'exile')).toBe('/exile-second.jpg');
  });

  it('uses a first-position graveyard or exile commander as the visible draggable pile card', () => {
    const graveyardCommander = {
      instanceId: 'graveyard-commander',
      name: 'Graveyard Commander',
      tapped: false,
      isCommander: true,
      imageUris: { normal: '/graveyard-commander.jpg' },
    };
    const exileCommander = {
      instanceId: 'exile-commander',
      name: 'Exile Commander',
      tapped: false,
      isCommander: true,
      imageUris: { normal: '/exile-commander.jpg' },
    };
    const player = playerView({
      zones: {
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [
          graveyardCommander,
          { instanceId: 'graveyard-later', name: 'Later Graveyard', tapped: false, imageUris: { normal: '/graveyard-later.jpg' } },
        ],
        exile: [
          exileCommander,
          { instanceId: 'exile-later', name: 'Later Exile', tapped: false, imageUris: { normal: '/exile-later.jpg' } },
        ],
        command: [],
      },
    });

    expect(selectors.zonePreviewCard(player, 'graveyard')).toBe(graveyardCommander);
    expect(selectors.zonePreviewImage(player, 'graveyard')).toBe('/graveyard-commander.jpg');
    expect(selectors.zoneStackLayerImage(player, 'graveyard')).toBe('/graveyard-later.jpg');
    expect(selectors.topDraggableCard(player, 'graveyard', true)).toBe(graveyardCommander);
    expect(selectors.zonePreviewCard(player, 'exile')).toBe(exileCommander);
    expect(selectors.zonePreviewImage(player, 'exile')).toBe('/exile-commander.jpg');
    expect(selectors.zoneStackLayerImage(player, 'exile')).toBe('/exile-later.jpg');
    expect(selectors.topDraggableCard(player, 'exile', true)).toBe(exileCommander);
  });

  it('keeps a public pile commander draggable when only player counters still identify it', () => {
    const commander = {
      instanceId: 'graveyard-commander',
      name: 'Graveyard Commander',
      tapped: false,
      imageUris: { normal: '/graveyard-commander.jpg' },
    };
    const player = playerView({
      zones: {
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [
          commander,
          { instanceId: 'graveyard-later', name: 'Later Graveyard', tapped: false, imageUris: { normal: '/graveyard-later.jpg' } },
        ],
        exile: [],
        command: [],
      },
      counters: {
        'commander:graveyard-commander': 1,
      },
    });

    expect(selectors.zonePreviewCard(player, 'graveyard')).toBe(commander);
    expect(selectors.topDraggableCard(player, 'graveyard', true)).toBe(commander);
  });

  it('does not provide a stack layer image for a single-card pile', () => {
    const player = playerView({
      zones: {
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [
          { instanceId: 'graveyard-top', name: 'Top Graveyard', tapped: false, imageUris: { normal: '/graveyard-top.jpg' } },
        ],
        exile: [],
        command: [],
      },
    });

    expect(selectors.zoneStackLayerImage(player, 'graveyard')).toBeNull();
  });

  it('resolves commander cards and cast counts by commander instance', () => {
    const firstCommander = { instanceId: 'commander-1', name: 'First Commander', tapped: false, isCommander: true };
    const secondCommander = { instanceId: 'commander-2', name: 'Second Commander', tapped: false, isCommander: true };
    const player = playerView({
      zones: {
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: [firstCommander, secondCommander],
      },
    });
    const snapshot = {
      version: 1,
      players: { 'player-1': player.state },
      turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
      counters: {
        'commander:commander-1': { casts: 1 },
        'commander:commander-2': { casts: 3 },
      },
      stack: [],
      arrows: [],
      chat: [],
      eventLog: [],
      createdAt: '',
      updatedAt: '',
    };

    expect(selectors.commandZoneCards(player)).toEqual([firstCommander, secondCommander]);
    expect(selectors.commanderCastCount(snapshot, player, firstCommander)).toBe(1);
    expect(selectors.commanderCastCount(snapshot, player, secondCommander)).toBe(3);
  });
});

function playerView(overrides: Partial<GamePlayerState> = {}): PlayerView {
  return {
    id: 'player-1',
    state: {
      user: { id: 'user-1', email: 'player@test', displayName: 'Player', roles: [] },
      deckName: null,
      life: 40,
      zones: {
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: [],
      },
      commanderDamage: {},
      counters: {},
      ...overrides,
    },
  };
}
