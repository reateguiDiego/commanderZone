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
