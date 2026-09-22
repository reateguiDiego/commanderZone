import { gamePlayerNameColor } from './game-player-name-color';

describe('gamePlayerNameColor', () => {
  it('assigns the same color to the same player identity', () => {
    expect(gamePlayerNameColor('player-42')).toBe(gamePlayerNameColor('player-42'));
  });

  it('uses a visible player color', () => {
    const color = gamePlayerNameColor('player-42');

    expect(color).toMatch(/^(var\(--cz-|hsl\()/);
    expect(color).not.toContain('--cz-text');
    expect(color).not.toBe('var(--cz-accent)');
  });

  it('assigns a distinct color to each of the six game seats', () => {
    const players = Array.from({ length: 6 }, (_, index) => ({ id: `player-${index + 1}` }));
    const colors = players.map((player) => gamePlayerNameColor(player.id, players));

    expect(colors).toEqual([
      'var(--cz-primary)',
      'var(--cz-secondary)',
      'var(--cz-success)',
      'var(--cz-danger)',
      'var(--cz-info)',
      'hsl(24 95% 65%)',
    ]);
    expect(new Set(colors).size).toBe(players.length);
  });

  it('uses the fallback color only when the player identity is unavailable', () => {
    expect(gamePlayerNameColor(null)).toBe('');
    expect(gamePlayerNameColor(undefined)).toBe('');
  });
});
