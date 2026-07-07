export type AdvancedAnalysisMap = Record<string, unknown>;
export type AdvancedNumberMap = Record<string, number>;
export type AdvancedIssueSeverity = 'info' | 'warning' | 'critical';
export type AdvancedRecommendationPriority = 'high' | 'medium' | 'low';
export type AdvancedPowerBand = 'precon_like' | 'casual' | 'upgraded' | 'high_casual' | 'high_power' | 'cedh_like';
export type AdvancedConfidence = 'low' | 'medium' | 'high';
export type AdvancedArchetypeConfidence = AdvancedConfidence | 'fragmented';
export type AdvancedHealthStatus = 'excellent' | 'good' | 'warning' | 'critical' | 'unknown';

export interface AdvancedAnalysisResponse {
  deckId: string;
  analyzerVersion?: string | null;
  analyzedAt?: string | null;
  snapshot?: SnapshotInfo | null;
  summary?: AdvancedSummary | null;
  health?: AdvancedHealth | null;
  metrics?: AdvancedMetrics | null;
  consistency?: AdvancedConsistency | null;
  combos?: AdvancedCombos | null;
  topComboCompleters?: AdvancedTopComboCompleter[];
  archetypes?: AdvancedArchetypes | null;
  power?: AdvancedPower | null;
  issues?: AdvancedIssue[];
  recommendations?: AdvancedRecommendation[];
  unmatchedCards?: UnmatchedCard[];
}

export interface SnapshotInfo {
  hit?: boolean;
  reason?: string | null;
  deckHash?: string | null;
  calculatedAt?: string | null;
  analyzerVersion?: string | null;
  semanticDataVersion?: string | null;
  comboDataVersion?: string | null;
  rulesVersion?: string | null;
  monteCarloVersion?: string | null;
  monteCarloRuns?: number | null;
}

export interface AdvancedSummary {
  status?: 'completed' | string;
  primaryArchetype?: string | null;
  secondaryArchetypes?: string[];
  archetypeConfidence?: AdvancedArchetypeConfidence | string | null;
  powerBand?: AdvancedPowerBand | string | null;
  powerConfidence?: AdvancedConfidence | string | null;
  mainStrengths?: string[];
  mainWarnings?: string[];
  criticalIssues?: string[];
}

export type AdvancedHealth = Record<string, AdvancedHealthSection | string | number | boolean | null | undefined>;

export interface AdvancedHealthSection {
  status?: AdvancedHealthStatus | string | null;
  message?: string | null;
  evidence?: AdvancedAnalysisMap | null;
  cards?: AdvancedCardReference[];
  value?: number | null;
  minRecommended?: number | null;
  source?: string | null;
  [key: string]: unknown;
}

export interface AdvancedMetrics {
  cards?: AdvancedCardMetrics | null;
  roles?: AdvancedRoleMetrics | null;
  roleCards?: AdvancedRoleCardGroups | null;
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

export type AdvancedRoleCardGroups = Record<string, AdvancedCardReference[]>;

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
}

export interface AdvancedConsistencyByTurn {
  turn3?: AdvancedNumberMap;
  turn5?: AdvancedNumberMap;
  [turn: string]: AdvancedNumberMap | undefined;
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

export interface AdvancedCardReference {
  deckCardId?: string | null;
  cardId?: string | null;
  oracleId?: string;
  name?: string | null;
  imageUrl?: string | null;
  quantity?: number | null;
  section?: string | null;
  matchedMetrics?: string[];
}

export interface AdvancedTopComboCompleter {
  oracleId?: string;
  name?: string | null;
  imageUrl?: string | null;
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
  score?: number;
  evidence?: string[];
}

export interface AdvancedPower {
  band?: AdvancedPowerBand | string | null;
  confidence?: AdvancedConfidence | string | null;
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

export interface AdvancedRecommendation {
  code?: string;
  priority?: AdvancedRecommendationPriority | string;
  title?: string;
  message?: string;
  targetRoles?: string[];
  reasonIssueCodes?: string[];
}

export interface UnmatchedCard {
  deckCardId?: string;
  cardId?: string | null;
  name?: string | null;
  imageUrl?: string | null;
  quantity?: number;
  section?: string | null;
  reason?: string | null;
}
