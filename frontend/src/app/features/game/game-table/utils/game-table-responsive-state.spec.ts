import { describe, expect, it } from 'vitest';
import {
  GAME_TABLE_RESPONSIVE_STATES,
  MIN_SUPPORTED_GAME_TABLE_HEIGHT,
  MIN_SUPPORTED_GAME_TABLE_WIDTH,
  isGameTableResponsiveState,
  resolveGameTableResponsiveState,
  type GameTableResponsiveInput,
} from './game-table-responsive-state';

describe('game table four-state responsive contract', () => {
  it.each([
    [1920, 1080, 2, 'normal'],
    [1440, 900, 6, 'compact'],
    [1024, 768, 5, 'aggressive'],
    [800, 600, 6, 'minimal'],
  ] as const)('resolves %ix%i with %i players as %s', (width, height, playerCount, expected) => {
    expect(resolve({ containerWidth: width, containerHeight: height, playerCount }).state).toBe(expected);
  });

  it.each([2, 3, 4, 5, 6])('always returns one of the four states for %i players', (playerCount) => {
    const state = resolve({ containerWidth: 1111, containerHeight: 711, playerCount }).state;
    expect(GAME_TABLE_RESPONSIVE_STATES).toContain(state);
    expect(isGameTableResponsiveState(state)).toBe(true);
  });

  it('accounts for open panels without reading the DOM', () => {
    const closed = resolve({ containerWidth: 1010, containerHeight: 680, playerCount: 2 });
    const open = resolve({
      containerWidth: 1010,
      containerHeight: 680,
      playerCount: 2,
      visiblePanels: { opponents: true, activity: true },
    });

    expect(closed.state).toBe('compact');
    expect(open.state).toBe('aggressive');
  });

  it('uses height and orientation instead of relying only on width', () => {
    expect(resolve({ containerWidth: 1500, containerHeight: 600, playerCount: 2 }).state).toBe('aggressive');
    expect(resolve({ containerWidth: 1040, containerHeight: 760, playerCount: 2, orientation: 'portrait' }).state).toBe('compact');
  });

  it('applies hysteresis only when returning to a denser state', () => {
    expect(resolve({
      containerWidth: 1300,
      containerHeight: 840,
      playerCount: 2,
      previousState: 'compact',
    }).state).toBe('compact');
    expect(resolve({
      containerWidth: 1360,
      containerHeight: 880,
      playerCount: 2,
      previousState: 'compact',
    }).state).toBe('normal');
    expect(resolve({
      containerWidth: 900,
      containerHeight: 620,
      playerCount: 2,
      previousState: 'compact',
    }).state).toBe('aggressive');
  });

  it('does not keep a stale state when available space jumps across two boundaries', () => {
    expect(resolve({
      containerWidth: 1280,
      containerHeight: 720,
      playerCount: 6,
      previousState: 'minimal',
    }).state).toBe('compact');
  });

  it('defines a supported minimum without inventing a fifth state', () => {
    const below = resolve({
      containerWidth: MIN_SUPPORTED_GAME_TABLE_WIDTH - 1,
      containerHeight: MIN_SUPPORTED_GAME_TABLE_HEIGHT - 1,
      playerCount: 6,
    });

    expect(below.state).toBe('minimal');
    expect(below.supported).toBe(false);
    expect(GAME_TABLE_RESPONSIVE_STATES).toHaveLength(4);
  });

  it('has no battlefield zoom input or output', () => {
    const resolution = resolve({ containerWidth: 1280, containerHeight: 800, playerCount: 4 });
    expect(JSON.stringify(resolution)).not.toContain('zoom');
  });
});

function resolve(overrides: Partial<GameTableResponsiveInput>) {
  return resolveGameTableResponsiveState({
    containerWidth: 1280,
    containerHeight: 800,
    playerCount: 4,
    visiblePanels: { opponents: false, activity: false },
    orientation: 'landscape',
    ...overrides,
  });
}
