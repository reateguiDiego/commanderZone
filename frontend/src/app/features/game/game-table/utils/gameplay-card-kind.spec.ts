import { gameplayCardKind, isDungeonCard, isGameplayCard } from './gameplay-card-kind';

describe('gameplay-card-kind', () => {
  it('detects official dungeon cards by name when legacy snapshots miss layout metadata', () => {
    expect(isDungeonCard({ name: 'Dungeon of the Mad Mage', layout: null, typeLine: null })).toBe(true);
    expect(gameplayCardKind(card({ name: 'The Undercity' }))).toBe('dungeon');
  });

  it('does not classify unrelated cards with dungeon in the name as dungeon cards', () => {
    expect(isDungeonCard({ name: 'Dungeon Master', layout: null, typeLine: null })).toBe(false);
    expect(gameplayCardKind(card({ name: 'Dungeon Master' }))).toBeNull();
  });

  it('identifies emblems and dungeons as gameplay cards', () => {
    expect(isGameplayCard(card({ layout: 'emblem', typeLine: 'Emblem' }))).toBe(true);
    expect(isGameplayCard(card({ layout: 'dungeon', typeLine: 'Dungeon' }))).toBe(true);
    expect(isGameplayCard(card({ name: 'Sol Ring', typeLine: 'Artifact' }))).toBe(false);
  });
});

function card(overrides: Partial<Parameters<typeof gameplayCardKind>[0]>): NonNullable<Parameters<typeof gameplayCardKind>[0]> {
  return {
    instanceId: 'card-1',
    name: 'Card',
    tapped: false,
    ...overrides,
  };
}
