import { GamePlayerState } from '../../../../core/models/game.model';
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
