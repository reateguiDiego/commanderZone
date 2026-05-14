export const DEFAULT_GAME_BACKGROUND_NAME = 'back_5';
export const DEFAULT_GAME_SLEEVES_NAME = 'facedown_card';

const GAME_BACKGROUNDS: Record<string, string> = {
  back_5: '/assets/images/backgrounds/back_5.png',
};

const GAME_SLEEVES: Record<string, string> = {
  facedown_card: '/assets/images/facedown_card.jpg',
};

export function gameBackgroundImageUrl(backgroundName: string | null | undefined): string {
  return assetUrl(GAME_BACKGROUNDS, backgroundName, DEFAULT_GAME_BACKGROUND_NAME);
}

export function gameSleevesImageUrl(sleevesName: string | null | undefined): string {
  return assetUrl(GAME_SLEEVES, sleevesName, DEFAULT_GAME_SLEEVES_NAME);
}

function assetUrl(registry: Record<string, string>, assetName: string | null | undefined, fallbackName: string): string {
  const normalizedName = normalizeAssetName(assetName);

  return registry[normalizedName] ?? registry[fallbackName] ?? '';
}

function normalizeAssetName(assetName: string | null | undefined): string {
  return (assetName ?? '').trim().replace(/\.(png|jpg|jpeg|webp)$/i, '');
}
