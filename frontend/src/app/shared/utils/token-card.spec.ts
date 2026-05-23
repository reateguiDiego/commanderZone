import { Card } from '../../core/models/card.model';
import { isEmblemCard, isSchemeCard, isTokenCard } from './token-card';

describe('token-card utilities', () => {
  it('returns true for token layouts', () => {
    expect(isTokenCard(card('token', 'Creature - Goblin'))).toBe(true);
    expect(isTokenCard(card('double_faced_token', 'Token Creature - Zombie'))).toBe(true);
  });

  it('returns true when type line contains token', () => {
    expect(isTokenCard(card('normal', 'Token Creature - Human'))).toBe(true);
  });

  it('returns false for normal non-token cards', () => {
    expect(isTokenCard(card('normal', 'Legendary Creature - Human Cleric'))).toBe(false);
  });

  it('returns true for emblem layout and type line', () => {
    expect(isEmblemCard(card('emblem', 'Emblem - Teferi'))).toBe(true);
    expect(isEmblemCard(card('normal', 'Emblem - Chandra'))).toBe(true);
  });

  it('returns false for normal non-emblem cards', () => {
    expect(isEmblemCard(card('normal', 'Legendary Creature - Human Cleric'))).toBe(false);
  });

  it('returns true for scheme layout and type line', () => {
    expect(isSchemeCard(card('scheme', 'Scheme'))).toBe(true);
    expect(isSchemeCard(card('normal', 'Scheme'))).toBe(true);
  });

  it('returns false for normal non-scheme cards', () => {
    expect(isSchemeCard(card('normal', 'Legendary Creature - Human Cleric'))).toBe(false);
  });
});

function card(layout: string, typeLine: string | null): Pick<Card, 'layout' | 'typeLine'> {
  return { layout, typeLine };
}
