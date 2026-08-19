export const DEFAULT_GAME_BACKGROUND_NAME = 'back_5';
export const DEFAULT_GAME_SLEEVES_NAME = 'facedown_card';
export const PLAYER_DEFEATED_SKULL_IMAGE = '/assets/icons/gameplay/skull.png';
export const PLAYER_DEFEATED_DEATH_NAME_IMAGE = '/assets/images/death_name.png';

const GAME_BACKGROUNDS: Record<string, string> = {
  back_5: '/assets/images/backgrounds/sunrise/bg-5.webp',
};

const PLAY_MAT_COUNTS_BY_COLOR: Record<string, number> = {
  W: 12,
  U: 15,
  B: 13,
  R: 10,
  G: 9,
  C: 7,
};

const GAME_SLEEVES: Record<string, string> = {
  facedown_card: '/assets/images/facedown_card.jpg',
};

export function gameBackgroundImageUrl(backgroundName: string | null | undefined): string {
  const playMatUrl = playMatImageUrl(backgroundName);
  if (playMatUrl) {
    return playMatUrl;
  }

  const normalizedName = normalizeAssetName(backgroundName);
  if (GAME_BACKGROUNDS[normalizedName]) {
    return GAME_BACKGROUNDS[normalizedName];
  }

  return customVisualImageUrl('/assets/images/playmat/', normalizedName) ?? GAME_BACKGROUNDS[DEFAULT_GAME_BACKGROUND_NAME];
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

function playMatImageUrl(backgroundName: string | null | undefined): string | null {
  const normalizedName = normalizeAssetName(backgroundName);
  const match = /^(W|U|B|R|G|C)_(\d+)$/.exec(normalizedName);
  if (!match) {
    return null;
  }

  const color = match[1];
  const index = Number(match[2]);
  const maxIndex = PLAY_MAT_COUNTS_BY_COLOR[color] ?? 0;
  if (!Number.isInteger(index) || index < 1 || index > maxIndex) {
    return null;
  }

  return `/assets/images/play-mat/${color}_${index}.webp`;
}
