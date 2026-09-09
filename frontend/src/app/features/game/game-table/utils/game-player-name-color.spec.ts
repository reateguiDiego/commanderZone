import { gamePlayerNameColor } from './game-player-name-color';

describe('gamePlayerNameColor', () => {
  it('assigns the same color to the same player identity', () => {
    expect(gamePlayerNameColor('player-42')).toBe(gamePlayerNameColor('player-42'));
  });

  it('uses a color token provided by the active theme', () => {
    const color = gamePlayerNameColor('player-42');

    expect(color).toMatch(/^(var\(--cz-|color-mix\()/);
    expect(color).not.toContain('--cz-text');
    expect(color).not.toContain('--cz-info');
    expect(color).not.toBe('var(--cz-accent)');
  });

  it('uses the fallback color only when the player identity is unavailable', () => {
    expect(gamePlayerNameColor(null)).toBe('');
    expect(gamePlayerNameColor(undefined)).toBe('');
  });
});
