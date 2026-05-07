export interface CardImageUris {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
  art_crop?: string;
  border_crop?: string;
}

export interface CardFace {
  name: string | null;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  colors: string[];
  imageUris: CardImageUris;
}

export interface Card {
  id: string;
  scryfallId: string;
  name: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
  power?: string | null;
  toughness?: string | null;
  colors: string[];
  colorIdentity: string[];
  legalities: Record<string, string>;
  imageUris: CardImageUris;
  cardFaces?: CardFace[];
  allParts?: Record<string, unknown>[];
  manaValue?: number | null;
  producedMana?: string[];
  prices?: Record<string, string | null>;
  layout: string;
  commanderLegal: boolean;
  set: string | null;
  collectorNumber: string | null;
  lang?: string | null;
  printedName?: string | null;
  flavorName?: string | null;
}
