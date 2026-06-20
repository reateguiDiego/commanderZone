import { PLAYER_DEFEATED_DEATH_NAME_IMAGE, gameBackgroundImageUrl } from './game-table-visual-assets';

describe('game table visual assets', () => {
  it('resolves temporary playmat background names', () => {
    expect(gameBackgroundImageUrl('G_1')).toBe('/assets/images/play-mat/G_1.png');
  });

  it('falls back when a temporary playmat name is outside the known registry', () => {
    expect(gameBackgroundImageUrl('G_99')).toBe('/assets/images/backgrounds/sunrise/bg-5.webp');
  });

  it('exposes the defeated player name spray asset for gameplay overlays', () => {
    expect(PLAYER_DEFEATED_DEATH_NAME_IMAGE).toBe('/assets/images/death_name.png');
  });
});
