export interface DeckMetric {
  label: string;
  count: number;
  cards: string[];
}

export interface ManaCurveBucket {
  manaValue: number;
  count: number;
}

export interface LandTypeCount {
  label: string;
  symbol: 'W' | 'U' | 'B' | 'R' | 'G';
  count: number;
}

export interface DeckAnalysis {
  totalCards: number;
  landCount: number;
  nonlandCount: number;
  colorPips: Record<string, number>;
  landTypes: LandTypeCount[];
  manaCurve: ManaCurveBucket[];
  creatures: DeckMetric;
  artifacts: DeckMetric;
  enchantments: DeckMetric;
  instants: DeckMetric;
  sorceries: DeckMetric;
  planeswalkers: DeckMetric;
  ramp: DeckMetric;
  draw: DeckMetric;
  removal: DeckMetric;
  wipes: DeckMetric;
}
