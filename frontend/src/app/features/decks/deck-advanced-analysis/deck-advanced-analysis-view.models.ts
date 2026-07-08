import type { AdvancedHealthStatus } from '../../../core/models/deck-advanced-analysis.model';
import type { CardFaceImageSource } from '../../../shared/utils/card-faces';

export interface AdvancedAnalysisStat {
  readonly key?: string;
  readonly label: string;
  readonly value: string;
  readonly description?: string;
  readonly manaSymbols?: readonly string[];
  readonly symbolItems?: readonly ManaSymbolStatItem[];
  readonly tooltipItems?: readonly AdvancedAnalysisTooltipItem[];
}

export interface ManaSymbolStatItem {
  readonly key: string;
  readonly symbols: readonly string[];
  readonly value: string;
  readonly label: string;
}

export interface AdvancedAnalysisTooltipItem {
  readonly value: string;
  readonly description: string;
}

export interface AdvancedHealthCard {
  readonly key: string;
  readonly title: string;
  readonly status: AdvancedHealthStatus;
  readonly statusLabel: string;
  readonly message: string;
  readonly metricLabel: string;
  readonly metricValue: string;
  readonly metricSymbolItems: readonly ManaSymbolStatItem[];
  readonly cards: ComboCardPreviewItem[];
  readonly hiddenCardCount: number;
}

export interface AdvancedIssueItem {
  readonly code: string;
  readonly title: string;
  readonly message: string;
  readonly severity: string;
}

export interface ConsistencyMetricRow {
  readonly key: string;
  readonly label: string;
  readonly manaSymbols: readonly string[];
  readonly value: string;
  readonly barWidth: string;
  readonly available: boolean;
}

export interface ConsistencyTurnGroup {
  readonly title: string;
  readonly rows: ConsistencyMetricRow[];
}

export interface ManaColorSourceRow {
  readonly key: string;
  readonly symbols: readonly string[];
  readonly label: string;
  readonly sources: string;
  readonly untappedSources: string;
  readonly earlySources: string;
  readonly status: string;
}

export interface ManaSectionGroup {
  readonly key: string;
  readonly title: string;
  readonly titleManaSymbols: readonly string[];
  readonly rows: AdvancedAnalysisStat[];
}

export interface ManaFetchlandDetailItem {
  readonly key: string;
  readonly name: string;
  readonly quantity: string;
  readonly cards: readonly AdvancedAnalysisCardGridItem[];
  readonly targetCards: readonly AdvancedAnalysisCardGridItem[];
  readonly validTargets: string;
  readonly effectiveColorSymbols: readonly string[];
  readonly untappedEffectiveColorSymbols: readonly string[];
  readonly tappedOnlyColorSymbols: readonly string[];
  readonly dead: boolean;
}

export interface RoleBreakdownCard {
  readonly key: string;
  readonly title: string;
  readonly rows: AdvancedAnalysisStat[];
  readonly message: string | null;
  readonly qualityRows: AdvancedAnalysisStat[];
}

export interface PowerSignalCardGroup {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly cards: ComboCardPreviewItem[];
}

export interface TypalIdentityView {
  readonly primaryType: string;
  readonly confidence: string;
  readonly creatureCount: string;
  readonly supportCount: string;
  readonly commanderMatches: string;
  readonly creatureCards: ComboCardPreviewItem[];
  readonly supportCards: ComboCardPreviewItem[];
}

export interface ArchetypeIdentityView {
  readonly key: string;
  readonly title: string;
  readonly reason: string;
  readonly cards: ComboCardPreviewItem[];
}

export interface ComboDisplayItem {
  readonly id: string;
  readonly title: string;
  readonly cards: ComboCardPreviewItem[];
  readonly features: string[];
  readonly badges: string[];
}

export interface AdvancedAnalysisCardGridItem {
  readonly id: string;
  readonly scryfallId?: string | null;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly imageSource: CardFaceImageSource;
  readonly quantity?: number | null;
  readonly detail?: string | null;
}

export interface ComboCardPreviewItem extends AdvancedAnalysisCardGridItem {
  readonly state?: 'present' | 'missing';
  readonly stateLabel?: string;
}

export interface ComboCompleterItem extends AdvancedAnalysisCardGridItem {
  readonly completesCombos: string;
}

export interface EvidenceItem {
  readonly label: string;
  readonly value: string;
}

export interface ActionIssueItem {
  readonly code: string;
  readonly severity: string;
  readonly title: string;
  readonly message: string;
  readonly suggestedActionType: string;
  readonly evidence: EvidenceItem[];
}

export interface RecommendationItem {
  readonly code: string;
  readonly priority: string;
  readonly title: string;
  readonly message: string;
  readonly targetRoles: string;
  readonly hasTargetRoles: boolean;
  readonly reasonIssueCodes: string;
  readonly hasReasonIssueCodes: boolean;
}

export interface UnmatchedCardItem {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
}
