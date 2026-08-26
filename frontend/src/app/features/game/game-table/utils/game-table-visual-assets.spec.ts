import { PLAYER_DEFEATED_DEATH_NAME_IMAGE, gameBackgroundImageUrl, gameSleevesImageUrl } from './game-table-visual-assets';

describe('game table visual assets', () => {
  it('uses the default playmat when the snapshot has no valid playmat name', () => {
    expect(gameBackgroundImageUrl('invalid-playmat')).toBe('/assets/images/playmat/free_0.webp');
  });

  it('resolves persisted custom deck visuals', () => {
    expect(gameBackgroundImageUrl('free_g_2')).toBe('/assets/images/playmat/free_g_2.webp');
    expect(gameSleevesImageUrl('azorius_1')).toBe('/assets/images/sleeves/azorius_1.webp');
  });

  it('exposes the defeated player name spray asset for gameplay overlays', () => {
    expect(PLAYER_DEFEATED_DEATH_NAME_IMAGE).toBe('/assets/images/death_name.png');
  });
});
