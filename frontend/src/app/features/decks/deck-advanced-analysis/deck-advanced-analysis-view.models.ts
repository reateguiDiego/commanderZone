import type { AdvancedHealthStatus } from '../../../core/models/deck-advanced-analysis.model';
import type { Card } from '../../../core/models/card.model';
import type { CardFaceImageSource } from '../../../shared/utils/card-faces';

export interface AdvancedAnalysisStat {
  readonly key?: string;
  readonly label: string;
  readonly value: string;
  readonly tone?: 'danger' | 'warning' | 'success';
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
  readonly reasonDescription: string | null;
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

export interface BoardWipeOverview {
  readonly stats: readonly AdvancedAnalysisStat[];
  readonly mainIssue: AdvancedIssueItem | null;
}

export interface BoardWipeStatGroup {
  readonly key: string;
  readonly title: string;
  readonly rows: readonly AdvancedAnalysisStat[];
}

export interface BoardWipeDetailItem extends AdvancedAnalysisCardGridItem {
  readonly badges: readonly string[];
  readonly manaValue: string;
  readonly notes: readonly string[];
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
}

export interface ManaColorDemandRow {
  readonly key: string;
  readonly symbols: readonly string[];
  readonly label: string;
  readonly earlyPipDemand: string;
  readonly pipDemand: string;
  readonly colorIntensity: string;
  readonly sourcesOfColor: string;
  readonly colorSourceShare: string;
}

export interface ManaCardGroup {
  readonly key: string;
  readonly title: string;
  readonly titleManaSymbols?: readonly string[];
  readonly cards: readonly AdvancedAnalysisCardGridItem[];
}

export interface ManaFunctionalCardGroup {
  readonly key: string;
  readonly title: string;
  readonly subgroups: readonly ManaCardGroup[];
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
  readonly layout?: Card['layout'] | null;
  readonly quantity?: number | null;
  readonly detail?: string | null;
  readonly analysisBadges?: readonly string[];
  readonly showSingleAnalysisBadge?: boolean;
}

export interface ComboCardPreviewItem extends AdvancedAnalysisCardGridItem {
  readonly state?: 'present' | 'missing';
  readonly stateLabel?: string;
}

export interface ComboCompleterItem extends AdvancedAnalysisCardGridItem {
  readonly completesCombos: string;
}

export interface UnmatchedCardItem {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
}
