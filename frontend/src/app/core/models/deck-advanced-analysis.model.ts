import type { CardFace, CardImageUris } from './card.model';

export type AdvancedAnalysisMap = Record<string, unknown>;
export type AdvancedNumberMap = Record<string, number>;

export type AdvancedIssueSeverity = 'info' | 'warning' | 'critical';
export type AdvancedConfidence = 'low' | 'medium' | 'high';
export type AdvancedArchetypeConfidence = AdvancedConfidence | 'fragmented';
export type AdvancedHealthStatus = 'excellent' | 'good' | 'warning' | 'critical' | 'unknown';

export interface AdvancedAnalysisResponse {
  deckId: string;
  analyzerVersion?: string | null;
  analyzedAt?: string | null;
  snapshot?: SnapshotInfo | null;
  cardCatalog?: AdvancedCardCatalog | null;
  summary?: AdvancedSummary | null;
  health?: AdvancedHealth | null;
  metrics?: AdvancedMetrics | null;
  consistency?: AdvancedConsistency | null;
  combos?: AdvancedCombos | null;
  topComboCompleters?: AdvancedTopComboCompleter[];
  archetypes?: AdvancedArchetypes | null;
  typal?: AdvancedTypalAnalysis | null;
  power?: AdvancedPower | null;
  issues?: AdvancedIssue[];
  unmatchedCards?: UnmatchedCard[];
}

export interface SnapshotInfo {
  hit?: boolean;
  reason?: string | null;
  deckHash?: string | null;
  calculatedAt?: string | null;
  analyzerVersion?: string | null;
  semanticDataVersion?: string | null;
  manaDataVersion?: string | null;
  comboDataVersion?: string | null;
  rulesVersion?: string | null;
  monteCarloVersion?: string | null;
  monteCarloRuns?: number | null;
}

export interface AdvancedSummary {
  status?: 'completed' | string;
  primaryArchetype?: string | null;
  primaryTypalType?: string | null;
  secondaryArchetypes?: string[];
  archetypeConfidence?: AdvancedArchetypeConfidence | string | null;
  archetypeExplanations?: AdvancedArchetypeExplanation[];
  mainStrengths?: string[];
  criticalIssues?: string[];
}

export interface AdvancedArchetypeExplanation {
  archetype?: string | null;
  reasonKey?: string | null;
  cards?: AdvancedCardReference[];
}

export type AdvancedHealth = Record<string, AdvancedHealthSection | string | number | boolean | null | undefined>;

export interface AdvancedHealthSection {
  status?: AdvancedHealthStatus | string | null;
  message?: string | null;
  evidence?: AdvancedAnalysisMap | null;
  cards?: AdvancedMetricCardReference[];
  value?: number | null;
  minRecommended?: number | null;
  source?: string | null;
  [key: string]: unknown;
}

export interface AdvancedMetrics {
  cards?: AdvancedCardMetrics | null;
  roles?: AdvancedRoleMetrics | null;
  mana?: AdvancedManaMetrics | null;
  roleCards?: AdvancedRoleCardGroups | null;
  qualityCards?: AdvancedQualityCardGroups | null;
  quality?: AdvancedQualityMetricGroups | null;
}

export interface AdvancedCardMetrics {
  totalCards?: number;
  uniqueCards?: number;
  resolvedCards?: number;
  unmatchedCards?: number;
  lands?: number;
  nonlands?: number;
}

export interface AdvancedRoleMetrics {
  [role: string]: number | undefined;
  lands?: number;
  permanentRamp?: number;
  fastMana?: number;
  burstMana?: number;
  rituals?: number;
  manaFixing?: number;
  oneShotMana?: number;
  draw?: number;
  cardSelection?: number;
  trueTutors?: number;
  typedTutors?: number;
  landTutors?: number;
  rampSearch?: number;
  opponentTutors?: number;
  spotRemoval?: number;
  creatureRemoval?: number;
  artifactRemoval?: number;
  enchantmentRemoval?: number;
  counterspells?: number;
  protection?: number;
  graveyardHate?: number;
  boardWipes?: number;
  massBounce?: number;
  pseudoWipes?: number;
  conditionalWipes?: number;
  sacrificeOutlets?: number;
  oneShotSacrifice?: number;
  selfSacrifice?: number;
  sacrificePayoffs?: number;
  wincons?: number;
  combatFinishers?: number;
  combatSupport?: number;
  infectThreats?: number;
  extraCombatEngines?: number;
  stax?: number;
  tax?: number;
  symmetricalStaxRisk?: number;
  tokenMakers?: number;
  payoffs?: number;
  enablers?: number;
  comboPieces?: number;
  recursion?: number;
  reanimation?: number;
  costReducers?: number;
  discard?: number;
  lifegain?: number;
}

export type AdvancedRoleCardGroups = Record<string, string[]>;
export type AdvancedQualityCardGroups = Record<string, Record<string, string[]>>;

export interface AdvancedManaMetrics {
  lands?: AdvancedManaLandMetrics | null;
  landCycles?: AdvancedNumberMap | null;
  sources?: AdvancedNumberMap | null;
  untappedSources?: AdvancedNumberMap | null;
  earlySources?: AdvancedManaEarlySources | null;
  ramp?: AdvancedNumberMap | null;
  fixing?: AdvancedNumberMap | null;
  fetchlands?: AdvancedFetchlandMetrics | null;
  landCycleAnalysis?: AdvancedAnalysisMap | null;
  requirements?: AdvancedManaRequirements | null;
}

export interface AdvancedManaLandMetrics extends AdvancedAnalysisMap {
  total?: number;
  basic?: number;
  nonBasic?: number;
  fetchlands?: number;
  typedLands?: number;
  utilityLands?: number;
  colorlessUtilityLands?: number;
  tappedLands?: number;
  conditionallyTappedLands?: number;
  untappedLands?: number;
  mdfcLands?: number;
}

export interface AdvancedManaEarlySources {
  turn1?: AdvancedNumberMap;
  turn2?: AdvancedNumberMap;
  turn3?: AdvancedNumberMap;
  [turn: string]: AdvancedNumberMap | undefined;
}

export interface AdvancedFetchlandMetrics extends AdvancedAnalysisMap {
  count?: number;
  deadFetchlands?: number;
  effectiveColorSources?: AdvancedNumberMap;
  untappedEffectiveColorSources?: AdvancedNumberMap;
  tappedOnlyEffectiveColorSources?: AdvancedNumberMap;
  details?: AdvancedFetchlandDetail[];
}

export interface AdvancedFetchlandDetail {
  deckCardId?: string | null;
  oracleId?: string;
  scryfallId?: string | null;
  name?: string | null;
  imageUrl?: string | null;
  imageUris?: CardImageUris | null;
  cardFaces?: CardFace[];
  quantity?: number | null;
  fetchableLandTypes?: string[];
  effectiveColors?: string[];
  untappedEffectiveColors?: string[];
  tappedOnlyEffectiveColors?: string[];
  dead?: boolean;
}

export interface AdvancedManaRequirements extends AdvancedAnalysisMap {
  pipDemand?: AdvancedNumberMap;
  earlyPipDemand?: AdvancedNumberMap;
  colorIntensity?: AdvancedNumberMap;
  commanderCost?: Record<string, AdvancedNumberMap>;
  commanderCastability?: Record<string, AdvancedCommanderCastability>;
}

export interface AdvancedCommanderCastability {
  requiredPips?: number;
  sourceCount?: number;
  untappedSourceCount?: number;
  earlySourceCount?: number;
  status?: AdvancedHealthStatus | string | null;
}

export interface AdvancedQualityMetricGroups {
  ramp?: AdvancedQualityMetrics | null;
  tutor?: AdvancedQualityMetrics | null;
  wipe?: AdvancedQualityMetrics | null;
  protection?: AdvancedQualityMetrics | null;
  wincon?: AdvancedQualityMetrics | null;
  [group: string]: AdvancedQualityMetrics | null | undefined;
}

export interface AdvancedQualityMetrics {
  premium?: number;
  good?: number;
  medium?: number;
  slow?: number;
  oneShot?: number;
}

export interface AdvancedConsistency {
  simulationRuns?: number;
  monteCarloVersion?: string | null;
  method?: 'monte_carlo' | string;
  scope?: 'opening_hand_and_card_access' | string;
  disclaimer?: string | null;
  assumptions?: string[];
  keepableHandRate?: number | null;
  openingHand?: AdvancedNumberMap;
  keepRule?: AdvancedAnalysisMap;
  mulligan?: AdvancedNumberMap;
  byTurn?: AdvancedConsistencyByTurn;
  comboAccess?: AdvancedNumberMap;
  colorAccess?: AdvancedColorAccess | null;
}

export interface AdvancedConsistencyByTurn {
  turn3?: AdvancedNumberMap;
  turn5?: AdvancedNumberMap;
  [turn: string]: AdvancedNumberMap | undefined;
}

export interface AdvancedColorAccess {
  turn1?: AdvancedNumberMap;
  turn2?: AdvancedNumberMap;
  turn3?: AdvancedNumberMap;
  commanderCurve?: AdvancedNumberMap;
}

export interface AdvancedCombos {
  completeCount?: number;
  partialOneMissingCount?: number;
  partialTwoMissingCount?: number;
  winLikeCount?: number;
  infiniteManaCount?: number;
  infiniteDamageCount?: number;
  infiniteTokensCount?: number;
  lethalLoopCount?: number;
  commanderRequiredCount?: number;
  templateRequiredCount?: number;
  complete?: AdvancedComboItem[];
  partialOneMissing?: AdvancedComboItem[];
  partialTwoMissing?: AdvancedComboItem[];
}

export interface AdvancedComboItem {
  comboVariantId?: string;
  externalId?: string;
  name?: string | null;
  cards?: AdvancedCardReference[];
  missingCards?: AdvancedCardReference[];
  cardNames?: string[];
  requiredCardNames?: string[];
  missingCardNames?: string[];
  requiredOracleIds?: string[];
  missingOracleIds?: string[];
  features?: string[];
  producesWin?: boolean;
  producesWinLike?: boolean;
  lethalLoop?: boolean;
  producesInfiniteMana?: boolean;
  producesInfiniteDamage?: boolean;
  producesInfiniteTokens?: boolean;
  producesMill?: boolean;
  producesLock?: boolean;
  requiresCommander?: boolean;
  requiresTemplate?: boolean;
  comboPowerScore?: number | null;
  comboComplexityScore?: number | null;
  comboSize?: number;
  bracketTag?: string | null;
}

export type AdvancedCardReference = string | AdvancedCardReferenceObject;

export interface AdvancedMetricCardReference extends AdvancedCardReferenceObject {
  matchedMetrics?: string[];
}

export interface AdvancedCardReferenceObject {
  deckCardId?: string | null;
  scryfallId?: string | null;
  oracleId?: string;
  name?: string | null;
  imageUrl?: string | null;
  imageUris?: CardImageUris | null;
  cardFaces?: CardFace[];
  quantity?: number | null;
  section?: string | null;
}

export type AdvancedCardCatalog = Record<string, AdvancedCardCatalogEntry>;

export interface AdvancedCardCatalogEntry {
  oracleId: string;
  name: string;
  imageUrl?: string | null;
}

export interface AdvancedTopComboCompleter {
  scryfallId?: string | null;
  oracleId?: string;
  name?: string | null;
  imageUrl?: string | null;
  imageUris?: CardImageUris | null;
  cardFaces?: CardFace[];
  completesCombos?: number;
}

export interface AdvancedArchetypes {
  primary?: string | null;
  secondary?: string[];
  confidence?: AdvancedArchetypeConfidence | string | null;
  scores?: AdvancedArchetypeScore[];
}

export interface AdvancedArchetypeScore {
  archetype?: string;
  reasonKey?: string | null;
  cards?: AdvancedCardReference[];
}

export interface AdvancedTypalAnalysis {
  detected?: boolean;
  primaryType?: string | null;
  confidence?: AdvancedConfidence | string | null;
  creatureCount?: number;
  supportCount?: number;
  commanderMatches?: boolean;
  types?: AdvancedTypalTypeBreakdown[];
}

export interface AdvancedTypalTypeBreakdown {
  type?: string;
  creatureCount?: number;
  supportCount?: number;
  commanderMatches?: boolean;
  creatureCards?: AdvancedCardReference[];
  supportCards?: AdvancedCardReference[];
}

export interface AdvancedPower {
  signals?: AdvancedNumberMap;
  signalCards?: AdvancedRoleCardGroups | null;
  evidence?: string[];
  notes?: string[];
}

export interface AdvancedIssue {
  code?: string;
  severity?: AdvancedIssueSeverity | string;
  title?: string;
  message?: string;
  evidence?: AdvancedAnalysisMap;
  suggestedActionType?: string | null;
}

export interface UnmatchedCard {
  deckCardId?: string;
  name?: string | null;
  imageUrl?: string | null;
  quantity?: number;
  section?: string | null;
  reason?: string | null;
}
