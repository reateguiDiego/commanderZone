import { PLAYER_DEFEATED_DEATH_NAME_IMAGE, gameBackgroundImageUrl, gameSleevesImageUrl } from './game-table-visual-assets';

describe('game table visual assets', () => {
  it('resolves temporary playmat background names', () => {
    expect(gameBackgroundImageUrl('G_1')).toBe('/assets/images/play-mat/G_1.webp');
  });

  it('falls back when a temporary playmat name is outside the known registry', () => {
    expect(gameBackgroundImageUrl('G_99')).toBe('/assets/images/backgrounds/sunrise/bg-5.webp');
  });

  it('resolves persisted custom deck visuals', () => {
    expect(gameBackgroundImageUrl('free_g_2')).toBe('/assets/images/playmat/free_g_2.webp');
    expect(gameSleevesImageUrl('azorius_1')).toBe('/assets/images/sleeves/azorius_1.webp');
  });

  it('exposes the defeated player name spray asset for gameplay overlays', () => {
    expect(PLAYER_DEFEATED_DEATH_NAME_IMAGE).toBe('/assets/images/death_name.png');
  });
});
