import { gameplayCardKind, isBattlefieldMechanicOverlayCard, isDungeonCard, isGameplayCard, isGameplayCardTapLocked, isTheRingCard } from './gameplay-card-kind';

describe('gameplay-card-kind', () => {
  it('detects official dungeon cards by name when legacy snapshots miss layout metadata', () => {
    expect(isDungeonCard({ name: 'Dungeon of the Mad Mage', layout: null, typeLine: null })).toBe(true);
    expect(gameplayCardKind(card({ name: 'The Undercity' }))).toBe('dungeon');
  });

  it('does not classify unrelated cards with dungeon in the name as dungeon cards', () => {
    expect(isDungeonCard({ name: 'Dungeon Master', layout: null, typeLine: null })).toBe(false);
    expect(gameplayCardKind(card({ name: 'Dungeon Master' }))).toBeNull();
  });

  it('identifies monarch, initiative, emblems and dungeons as gameplay cards', () => {
    expect(gameplayCardKind(card({ name: 'Monarch', layout: 'monarch' }))).toBe('monarch');
    expect(gameplayCardKind(card({ name: 'The Monarch', layout: 'monarch' }))).toBe('monarch');
    expect(gameplayCardKind(card({ name: 'The Initiative', layout: 'initiative' }))).toBe('initiative');
    expect(isGameplayCard(card({ layout: 'emblem', typeLine: 'Emblem' }))).toBe(true);
    expect(isGameplayCard(card({ layout: 'dungeon', typeLine: 'Dungeon' }))).toBe(true);
    expect(isTheRingCard(card({ name: 'The Ring // The Ring Tempts You', layout: 'double_faced_token' }))).toBe(true);
    expect(isTheRingCard(card({ name: 'The Ring', layout: 'double_faced_token' }))).toBe(true);
    expect(isTheRingCard(card({ name: 'Unexpected Name', scryfallId: '7215460e-8c06-47d0-94e5-d1832d0218af', layout: 'double_faced_token' }))).toBe(true);
    expect(isGameplayCard(card({ name: 'The Ring // The Ring Tempts You', layout: 'double_faced_token', typeLine: 'Emblem // Card' }))).toBe(false);
    expect(isGameplayCard(card({ name: 'The Ring', layout: 'double_faced_token', typeLine: 'Emblem // Card' }))).toBe(false);
    expect(isGameplayCard(card({ name: 'Unexpected Name', scryfallId: '7215460e-8c06-47d0-94e5-d1832d0218af', layout: 'double_faced_token', typeLine: 'Emblem // Card' }))).toBe(false);
    expect(isGameplayCard(card({ name: 'Sol Ring', typeLine: 'Artifact' }))).toBe(false);
  });

  it('tap-locks monarch, initiative and The Ring like other gameplay helper cards', () => {
    expect(isGameplayCardTapLocked(card({ name: 'Monarch', layout: 'monarch' }))).toBe(true);
    expect(isGameplayCardTapLocked(card({ name: 'The Initiative', layout: 'initiative' }))).toBe(true);
    expect(isGameplayCardTapLocked(card({ name: 'The Ring // The Ring Tempts You', layout: 'double_faced_token' }))).toBe(true);
    expect(isGameplayCardTapLocked(card({ name: 'Sol Ring', typeLine: 'Artifact' }))).toBe(false);
  });

  it('identifies top overlay battlefield mechanic cards without including dungeons or The Ring', () => {
    expect(isBattlefieldMechanicOverlayCard(card({ name: 'Day // Night', layout: 'double_faced_token' }))).toBe(true);
    expect(isBattlefieldMechanicOverlayCard(card({ name: 'The Monarch', layout: 'monarch' }))).toBe(true);
    expect(isBattlefieldMechanicOverlayCard(card({ name: 'The Initiative', layout: 'initiative' }))).toBe(true);
    expect(isBattlefieldMechanicOverlayCard(card({ layout: 'emblem', typeLine: 'Emblem' }))).toBe(true);
    expect(isBattlefieldMechanicOverlayCard(card({ layout: 'dungeon', typeLine: 'Dungeon' }))).toBe(false);
    expect(isBattlefieldMechanicOverlayCard(card({ name: 'The Ring', layout: 'double_faced_token', typeLine: 'Emblem // Card' }))).toBe(false);
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
