import { DEFAULT_PLAYMAT_NAME, isSupportedPlaymatName, playmatImageUrl } from '../../../../core/assets/playmat-assets';

export const DEFAULT_GAME_SLEEVES_NAME = 'facedown_card';
export const PLAYER_DEFEATED_SKULL_IMAGE = '/assets/icons/gameplay/skull.png';
export const PLAYER_DEFEATED_DEATH_NAME_IMAGE = '/assets/images/death_name.png';

const GAME_SLEEVES: Record<string, string> = {
  facedown_card: '/assets/images/facedown_card.jpg',
};

export function gameBackgroundImageUrl(backgroundName: string | null | undefined): string {
  const normalizedName = normalizeAssetName(backgroundName);
  if (isSupportedPlaymatName(normalizedName)) {
    return playmatImageUrl(normalizedName);
  }

  return playmatImageUrl(DEFAULT_PLAYMAT_NAME);
}

export function gameSleevesImageUrl(sleevesName: string | null | undefined): string {
  const normalizedName = normalizeAssetName(sleevesName);
  if (GAME_SLEEVES[normalizedName]) {
    return GAME_SLEEVES[normalizedName];
  }

  return customVisualImageUrl('/assets/images/sleeves/', normalizedName) ?? GAME_SLEEVES[DEFAULT_GAME_SLEEVES_NAME];
}

function normalizeAssetName(assetName: string | null | undefined): string {
  return (assetName ?? '').trim().replace(/\.(png|jpg|jpeg|webp)$/i, '');
}

function customVisualImageUrl(basePath: string, assetName: string): string | null {
  return /^[a-z]+(?:_[a-z]+)?_\d+$/.test(assetName) ? `${basePath}${assetName}.webp` : null;
}
