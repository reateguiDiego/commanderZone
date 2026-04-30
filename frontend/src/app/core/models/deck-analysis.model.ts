export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export type CardPrimaryType = 'creature' | 'instant' | 'sorcery' | 'artifact' | 'enchantment' | 'planeswalker' | 'battle' | 'land' | 'other';
export type ColorBalanceStatus = 'underproduced' | 'balanced' | 'overproduced' | 'unused';
export type CurvePlayabilityMode = 'play' | 'draw';
export type ManaSourcesMode = 'landsOnly' | 'landsAndRamp';

export interface DeckAnalysisOptions {
  includeCommanderInAnalysis?: boolean;
  includeSideboard?: boolean;
  includeMaybeboard?: boolean;
  curvePlayabilityMode?: CurvePlayabilityMode;
  manaSourcesMode?: ManaSourcesMode;
}

export interface DeckAnalysisSummary {
  totalCards: number;
  mainboardCards: number;
  commanderCards: number;
  landCount: number;
  nonLandCount: number;
  creatureCount: number;
  instantCount: number;
  sorceryCount: number;
  artifactCount: number;
  enchantmentCount: number;
  planeswalkerCount: number;
  battleCount: number;
  averageManaValueWithLands: number;
  averageManaValueWithoutLands: number;
  medianManaValueWithLands: number;
  medianManaValueWithoutLands: number;
  totalManaValue: number;
  colorIdentity: ManaColor[];
}

export interface ManaCurveCard {
  id: string;
  name: string;
  quantity: number;
  manaValue: number;
  typeLine: string;
  primaryType: CardPrimaryType;
  isPermanent: boolean;
  isLand: boolean;
  imageUrl: string | null;
  priceEur: number | null;
}

export interface ManaCurveBucket {
  manaValue: number;
  totalCards: number;
  permanents: number;
  spells: number;
  lands: number;
  cards: ManaCurveCard[];
}

export interface ManaCurveAnalysis {
  buckets: ManaCurveBucket[];
}

export interface SectionCard {
  id: string;
  name: string;
  quantity: number;
  manaValue: number;
  manaCost: string | null;
  typeLine: string;
  imageUrl: string | null;
  priceEur: number | null;
}

export interface CardSectionAnalysis {
  key: CardPrimaryType;
  label: string;
  count: number;
  cards: SectionCard[];
}

export interface TypeBreakdownAnalysis {
  sections: CardSectionAnalysis[];
}

export interface ColorSymbolStat {
  color: ManaColor;
  symbolCount: number;
  percentageOfColoredSymbols: number;
  percentageOfAllSymbols: number;
  cardsRequiringColor: number;
}

export interface ColorRequirementAnalysis {
  totalColoredSymbols: number;
  totalAllSymbols: number;
  estimated: boolean;
  symbolsByColor: Record<ManaColor, ColorSymbolStat>;
}

export interface ManaProductionStat {
  color: ManaColor;
  sourceCount: number;
  symbolCount: number;
  percentageOfAllProduction: number;
  percentageFromLands: number;
  landSourceCount: number;
  nonLandSourceCount: number;
}

export interface ManaProductionAnalysis {
  totalManaSources: number;
  totalProducedSymbols: number;
  estimated: boolean;
  productionByColor: Record<ManaColor, ManaProductionStat>;
}

export interface ColorBalanceEntry {
  color: ManaColor;
  requiredPercentage: number;
  producedPercentage: number;
  delta: number;
  status: ColorBalanceStatus;
}

export interface ColorBalanceAnalysis {
  colors: ColorBalanceEntry[];
}

export interface CurvePlayabilityBucket {
  manaValue: number;
  cardCountAtManaValue: number;
  probabilityOfHavingSpellByTurn: number;
  probabilityOfHavingEnoughManaByTurn: number;
  probabilityOfPlayingOnCurve: number;
}

export interface CurvePlayabilityAnalysis {
  disclaimer: string;
  buckets: CurvePlayabilityBucket[];
}

export interface DeckAnalysis {
  summary: DeckAnalysisSummary;
  manaCurve: ManaCurveAnalysis;
  typeBreakdown: TypeBreakdownAnalysis;
  colorRequirement: ColorRequirementAnalysis;
  manaProduction: ManaProductionAnalysis;
  colorBalance: ColorBalanceAnalysis;
  curvePlayability: CurvePlayabilityAnalysis;
  sections: CardSectionAnalysis[];
  options: Required<DeckAnalysisOptions>;
}
