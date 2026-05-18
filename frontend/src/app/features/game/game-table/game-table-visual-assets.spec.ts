import { gameBackgroundImageUrl } from './game-table-visual-assets';

describe('game table visual assets', () => {
  it('resolves temporary playmat background names', () => {
    expect(gameBackgroundImageUrl('G_1')).toBe('/assets/images/play-mat/G_1.png');
  });

  it('falls back when a temporary playmat name is outside the known registry', () => {
    expect(gameBackgroundImageUrl('G_99')).toBe('/assets/images/backgrounds/back_5.png');
  });
});
