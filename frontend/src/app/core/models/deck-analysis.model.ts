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

export interface DeckAnalysisSnapshotMetadata {
  hit: boolean;
  reason:
    | 'fresh'
    | 'missing'
    | 'deck_hash_changed'
    | 'options_changed'
    | 'analyzer_version_changed'
    | 'semantic_data_changed'
    | 'mana_data_changed'
    | 'combo_data_changed'
    | 'rules_changed';
  deckHash: string;
  optionsHash: string;
  calculatedAt: string | null;
  analyzerVersion: string;
  semanticDataVersion: string;
  manaDataVersion: string;
  comboDataVersion: string;
  rulesVersion: string;
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

export interface DeckBracketSignalCard {
  deckCardId: string | null;
  cardId: string | null;
  scryfallId: string | null;
  oracleId: string | null;
  name: string;
  imageUrl: string | null;
  quantity: number;
  section: string;
}

export interface DeckBracketSignalComboCard {
  oracleId?: string | null;
  name?: string | null;
  [key: string]: unknown;
}

export interface DeckBracketCardSignal {
  count: number;
  cards: DeckBracketSignalCard[];
}

export interface DeckBracketMassLandDenialSignal extends DeckBracketCardSignal {
  detected: boolean;
}

export interface DeckBracketExtraTurnSignal extends DeckBracketCardSignal {
  chainsOrLoops: boolean;
  repeatableExtraTurns: boolean;
}

export interface DeckBracketTwoCardComboSignal {
  count: number;
  beforeTurnSix: number;
  lateGameOnly: number;
  combos: {
    comboVariantId: string | null;
    externalId: string | null;
    name: string | null;
    beforeTurnSix: boolean;
    lateGameOnly: boolean;
    requiresCommander: boolean;
    requiresTemplate: boolean;
    comboPowerScore: number | null;
    comboComplexityScore: number | null;
    bracketTag: string | null;
    cards: DeckBracketSignalComboCard[];
  }[];
}

export interface DeckBracketNonLandTutorSignal extends DeckBracketCardSignal {
  efficientCount: number;
}

export interface DeckBracketFastManaSignal extends DeckBracketCardSignal {
  premiumCount: number;
  permanentCount: number;
  oneShotCount: number;
  colorlessCount: number;
  coloredCount: number;
}

export interface DeckBracketFreeInteractionSignal extends DeckBracketCardSignal {
  premiumCount: number;
}

export interface DeckBracketCompactWinconSignal {
  count: number;
  cardsOrCombos: ({
    kind: 'card';
    card: DeckBracketSignalCard;
  } | {
    kind: 'combo';
    comboVariantId: string | null;
    externalId: string | null;
    name: string | null;
    cards: DeckBracketSignalComboCard[];
  })[];
}

export interface DeckBracketManaEfficiencySignal {
  score: number;
  fastManaPremiumCount: number;
  earlyColorAccessScore: number;
  untappedSourceScore: number;
  tappedLandPressure: number;
  slowLandPressure: number;
  colorlessUtilityPressure: number;
  fetchTargetQuality: number;
  commanderCastability: number;
  rampFixingQuality: number;
  curveCompatibility: number;
  reasons: string[];
}

export interface DeckBracketScoreSignal {
  score: number;
  [key: string]: string | number | boolean | DeckBracketSignalCard[] | null;
}

export interface DeckBracketSignals {
  gameChangerSignal: DeckBracketCardSignal;
  massLandDenialSignal: DeckBracketMassLandDenialSignal;
  extraTurnSignal: DeckBracketExtraTurnSignal;
  twoCardComboSignal: DeckBracketTwoCardComboSignal;
  nonLandTutorSignal: DeckBracketNonLandTutorSignal;
  fastManaSignal: DeckBracketFastManaSignal;
  freeInteractionSignal: DeckBracketFreeInteractionSignal;
  compactWinconSignal: DeckBracketCompactWinconSignal;
  manaEfficiencySignal: DeckBracketManaEfficiencySignal;
  themeSignal: DeckBracketScoreSignal;
  staplesSignal: DeckBracketScoreSignal;
  speedSignal: DeckBracketScoreSignal;
  metagameSignal: DeckBracketScoreSignal;
}

export type DeckBracketNumber = 1 | 2 | 3 | 4 | 5;
export type DeckBracketConfidence = 'low' | 'medium' | 'high';

export interface DeckBracketReasonCode {
  code: string;
  params: Record<string, string | number | boolean | null>;
  message: string;
}

export interface DeckBracketOfficialCriterion {
  bracket: DeckBracketNumber;
  label: 'Exhibition' | 'Core' | 'Upgraded' | 'Optimized' | 'cEDH';
  summary: string;
}

export interface DeckBracketExplanation {
  short: string;
  long: string;
  officialCriteria: DeckBracketOfficialCriterion[];
  detectedSignalsExplanation: DeckBracketReasonCode[];
  ruleBreakersExplanation: DeckBracketReasonCode[];
  differenceModel: {
    theme: string;
    staples: string;
    speed: string;
    metagame: string;
    manaEfficiency: string;
  };
  reasonCodes: DeckBracketReasonCode[];
}

export interface DeckBracketEstimate {
  bracket: DeckBracketNumber;
  label: 'Exhibition' | 'Core' | 'Upgraded' | 'Optimized' | 'cEDH';
  confidence: DeckBracketConfidence;
  method: 'commander_brackets_beta_v1';
  floor: DeckBracketNumber;
  ceiling: DeckBracketNumber;
  ruleBreakers: string[];
  differences: {
    themeScore: number;
    staplesScore: number;
    speedScore: number;
    metagameScore: number;
    manaEfficiencyScore: number;
  };
  officialSignals: {
    gameChangers: DeckBracketCardSignal & { status: string };
    massLandDenial: DeckBracketMassLandDenialSignal;
    extraTurns: DeckBracketCardSignal & { chainsOrLoops: boolean };
    twoCardCombos: {
      count: number;
      beforeTurnSix: boolean;
      lateGameOnly: boolean;
    };
    nonLandTutors: DeckBracketNonLandTutorSignal;
  };
  reasonCodes: DeckBracketReasonCode[];
  reasons: string[];
  warnings: string[];
  explanation: DeckBracketExplanation;
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
  bracketSignals?: DeckBracketSignals;
  bracket: DeckBracketEstimate;
  snapshot: DeckAnalysisSnapshotMetadata;
}

export interface DeckBracketAnalysisResponse {
  bracket: DeckBracketEstimate;
  snapshot: DeckAnalysisSnapshotMetadata;
}
