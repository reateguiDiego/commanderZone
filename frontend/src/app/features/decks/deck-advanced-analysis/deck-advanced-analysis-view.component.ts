import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslationService } from '../../../core/localization/translation.service';
import { runtimeTranslationFallback, RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import {
  AdvancedAnalysisResponse,
  AdvancedCardReference,
  AdvancedComboItem,
  AdvancedHealthSection,
  AdvancedHealthStatus,
  AdvancedIssue,
  AdvancedRecommendation,
  AdvancedTopComboCompleter,
  UnmatchedCard,
} from '../../../core/models/deck-advanced-analysis.model';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';

const ADVANCED_ANALYSIS_I18N_PREFIX = 'deckBuilder.advancedAnalysis';

const HEALTH_STATUS_LABEL_KEYS: Record<AdvancedHealthStatus, string> = {
  excellent: `${ADVANCED_ANALYSIS_I18N_PREFIX}.status.excellent`,
  good: `${ADVANCED_ANALYSIS_I18N_PREFIX}.status.good`,
  warning: `${ADVANCED_ANALYSIS_I18N_PREFIX}.status.warning`,
  critical: `${ADVANCED_ANALYSIS_I18N_PREFIX}.status.critical`,
  unknown: `${ADVANCED_ANALYSIS_I18N_PREFIX}.status.unknown`,
};
const ISSUE_SEVERITY_LABEL_KEYS: Record<string, string> = {
  critical: `${ADVANCED_ANALYSIS_I18N_PREFIX}.status.critical`,
  warning: `${ADVANCED_ANALYSIS_I18N_PREFIX}.status.warning`,
  info: `${ADVANCED_ANALYSIS_I18N_PREFIX}.status.info`,
};
const COMPLETE_COMBO_INITIAL_LIMIT = 10;
const PARTIAL_COMBO_INITIAL_LIMIT = 6;
const COMBO_COMPLETER_INITIAL_LIMIT = 8;
const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECOMMENDATION_PRIORITY_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

interface AdvancedAnalysisStat {
  readonly key?: string;
  readonly label: string;
  readonly value: string;
}

interface SnapshotIndicator {
  readonly label: string;
  readonly detail: string;
  readonly state: 'cached' | 'fresh' | 'missing';
}

interface HealthCardConfig {
  readonly key: string;
  readonly title: string;
  readonly metricLabel: string;
  readonly metricKey?: string;
  readonly valueSource?: 'combos' | 'keepableHandRate';
}

interface AdvancedHealthCard {
  readonly key: string;
  readonly title: string;
  readonly status: AdvancedHealthStatus;
  readonly statusLabel: string;
  readonly message: string;
  readonly metricLabel: string;
  readonly metricValue: string;
  readonly cards: ComboCardPreviewItem[];
  readonly hiddenCardCount: number;
}

interface AdvancedIssueItem {
  readonly code: string;
  readonly title: string;
  readonly message: string;
  readonly severity: string;
}

interface ConsistencyMetricRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly barWidth: string;
  readonly available: boolean;
}

interface ConsistencyTurnGroup {
  readonly title: string;
  readonly rows: ConsistencyMetricRow[];
}

interface RoleBreakdownConfig {
  readonly key: string;
  readonly title: string;
  readonly metrics: ReadonlyArray<readonly [string, string]>;
  readonly message?: string;
  readonly messageMetricKeys?: readonly string[];
  readonly qualityKey?: string;
}

interface RoleBreakdownCard {
  readonly key: string;
  readonly title: string;
  readonly rows: AdvancedAnalysisStat[];
  readonly message: string | null;
  readonly qualityRows: AdvancedAnalysisStat[];
}

interface PowerSignalCardGroup {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly cards: ComboCardPreviewItem[];
}

interface ComboDisplayItem {
  readonly id: string;
  readonly title: string;
  readonly cards: ComboCardPreviewItem[];
  readonly missingCards: ComboCardPreviewItem[];
  readonly missingCardNames: string;
  readonly features: string[];
  readonly badges: string[];
}

interface ComboCardPreviewItem {
  readonly id: string;
  readonly name: string;
  readonly imageUrl: string | null;
}

interface ComboCompleterItem {
  readonly id: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly completesCombos: string;
}

interface EvidenceItem {
  readonly label: string;
  readonly value: string;
}

interface ActionIssueItem {
  readonly code: string;
  readonly severity: string;
  readonly title: string;
  readonly message: string;
  readonly suggestedActionType: string;
  readonly evidence: EvidenceItem[];
}

interface RecommendationItem {
  readonly code: string;
  readonly priority: string;
  readonly title: string;
  readonly message: string;
  readonly targetRoles: string;
  readonly hasTargetRoles: boolean;
  readonly reasonIssueCodes: string;
  readonly hasReasonIssueCodes: boolean;
}

interface UnmatchedCardItem {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
}

const HEALTH_CARD_CONFIGS: readonly HealthCardConfig[] = [
  { key: 'ramp', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.ramp`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.permanentRamp`, metricKey: 'permanentRamp' },
  { key: 'draw', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.draw`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.drawEffects`, metricKey: 'draw' },
  { key: 'interaction', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.interaction`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.spotInteraction`, metricKey: 'spotRemoval' },
  { key: 'wipes', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.wipes`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.boardWipes`, metricKey: 'boardWipes' },
  { key: 'tutors', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.tutors`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.trueTutors`, metricKey: 'trueTutors' },
  { key: 'sacrifice', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.sacrifice`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.outlets`, metricKey: 'sacrificeOutlets' },
  { key: 'wincons', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.wincons`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.wincons`, metricKey: 'wincons' },
  { key: 'combos', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.combos`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.completeCombos`, valueSource: 'combos' },
  { key: 'consistency', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.consistency`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.keepableHands`, valueSource: 'keepableHandRate' },
  { key: 'stax', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.stax`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.staxPieces`, metricKey: 'stax' },
];

const OPENING_HAND_METRICS: ReadonlyArray<readonly [string, string]> = [
  ['keepableHandRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.keepableHands`],
  ['twoToFourLandsRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.twoToFourLands`],
  ['zeroOrOneLandRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.zeroOrOneLand`],
  ['fivePlusLandsRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.fivePlusLands`],
  ['permanentRampInOpeningRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.permanentRamp`],
  ['earlyInteractionInOpeningRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.earlyInteraction`],
  ['drawOrSelectionInOpeningRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.drawOrSelection`],
  ['trueTutorInOpeningRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.trueTutor`],
  ['earlyPlayInOpeningRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.earlyPlay`],
];

const KEEP_RULE_METRICS: ReadonlyArray<readonly [string, string]> = [
  ['failedByTooFewLandsRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.tooFewLands`],
  ['failedByTooManyLandsRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.tooManyLands`],
  ['failedByNoEarlyPlayRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.noEarlyPlay`],
  ['failedByTooTopHeavyRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.tooTopHeavy`],
];

const MULLIGAN_METRICS: ReadonlyArray<readonly [string, string]> = [
  ['keepableAt7Rate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.keepableAt7`],
  ['keepableBy6Rate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.keepableBy6`],
  ['keepableBy5Rate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.keepableBy5`],
  ['averageMulligansNeeded', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.averageMulligansNeeded`],
];

const TURN_3_METRICS: ReadonlyArray<readonly [string, string]> = [
  ['permanentRampSeenRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.permanentRampSeen`],
  ['earlyInteractionSeenRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.earlyInteractionSeen`],
  ['drawOrSelectionSeenRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.drawOrSelectionSeen`],
  ['trueTutorSeenRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.trueTutorSeen`],
  ['winconSeenRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.winconSeen`],
  ['comboPieceSeenRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.comboPieceSeen`],
];

const TURN_5_METRICS: ReadonlyArray<readonly [string, string]> = [
  ['permanentRampSeenRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.permanentRampSeen`],
  ['interactionSeenRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.interactionSeen`],
  ['trueTutorSeenRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.trueTutorSeen`],
  ['winconSeenRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.winconSeen`],
  ['comboPieceSeenRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.comboPieceSeen`],
  ['completeTwoCardComboSeenRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.completeTwoCardComboSeen`],
  ['comboPlusProtectionSeenRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.comboPlusProtectionSeen`],
];

const ROLE_BREAKDOWN_CONFIGS: readonly RoleBreakdownConfig[] = [
  {
    key: 'ramp',
    title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.roles.cards.ramp`,
    metrics: [
      ['permanentRamp', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.permanentRamp`],
      ['fastMana', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.fastMana`],
      ['burstMana', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.burstMana`],
      ['rituals', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.rituals`],
      ['manaFixing', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.manaFixing`],
      ['oneShotMana', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.oneShotMana`],
    ],
    message: `${ADVANCED_ANALYSIS_I18N_PREFIX}.roles.messages.rampOneShot`,
    messageMetricKeys: ['burstMana', 'rituals', 'oneShotMana'],
    qualityKey: 'ramp',
  },
  {
    key: 'tutors',
    title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.roles.cards.tutors`,
    metrics: [
      ['trueTutors', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.trueTutors`],
      ['typedTutors', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.typedTutors`],
      ['landTutors', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.landTutors`],
      ['rampSearch', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.rampSearch`],
      ['opponentTutors', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.opponentTutors`],
    ],
    message: `${ADVANCED_ANALYSIS_I18N_PREFIX}.roles.messages.tutorsSeparated`,
    qualityKey: 'tutor',
  },
  {
    key: 'wipes',
    title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.roles.cards.wipes`,
    metrics: [
      ['boardWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.boardWipes`],
      ['massBounce', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.massBounce`],
      ['pseudoWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.pseudoWipes`],
      ['conditionalWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.conditionalWipes`],
    ],
    message: `${ADVANCED_ANALYSIS_I18N_PREFIX}.roles.messages.wipesSeparated`,
    qualityKey: 'wipe',
  },
  {
    key: 'sacrifice',
    title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.roles.cards.sacrifice`,
    metrics: [
      ['sacrificeOutlets', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.sacrificeOutlets`],
      ['oneShotSacrifice', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.oneShotSacrifice`],
      ['selfSacrifice', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.selfSacrifice`],
      ['sacrificePayoffs', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.sacrificePayoffs`],
    ],
    message: `${ADVANCED_ANALYSIS_I18N_PREFIX}.roles.messages.sacrificeOneShot`,
    messageMetricKeys: ['oneShotSacrifice'],
  },
  {
    key: 'wincons',
    title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.roles.cards.winconsCombat`,
    metrics: [
      ['wincons', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.wincons`],
      ['combatFinishers', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.combatFinishers`],
      ['infectThreats', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.infectThreats`],
      ['extraCombatEngines', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.extraCombatEngines`],
    ],
    qualityKey: 'wincon',
  },
  {
    key: 'stax',
    title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.roles.cards.stax`,
    metrics: [
      ['stax', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.stax`],
      ['tax', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.tax`],
      ['symmetricalStaxRisk', `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.symmetricalStaxRisk`],
    ],
  },
];

const QUALITY_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['premium', `${ADVANCED_ANALYSIS_I18N_PREFIX}.quality.premium`],
  ['good', `${ADVANCED_ANALYSIS_I18N_PREFIX}.quality.good`],
  ['medium', `${ADVANCED_ANALYSIS_I18N_PREFIX}.quality.medium`],
  ['slow', `${ADVANCED_ANALYSIS_I18N_PREFIX}.quality.slow`],
  ['oneShot', `${ADVANCED_ANALYSIS_I18N_PREFIX}.quality.oneShot`],
];

@Component({
  selector: 'app-deck-advanced-analysis-view',
  imports: [CzButtonDirective, RuntimeTranslatePipe],
  templateUrl: './deck-advanced-analysis-view.component.html',
  styleUrl: './deck-advanced-analysis-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckAdvancedAnalysisViewComponent {
  private readonly translations = inject(TranslationService);

  readonly analysis = input<AdvancedAnalysisResponse | null>(null);
  readonly loading = input(false);
  readonly errorMessage = input<string | null>(null);
  readonly deckName = input<string | null>(null);
  readonly deckIdentifier = input('');
  readonly retry = output<void>();

  readonly showAllCompleteCombos = signal(false);
  readonly showAllPartialCombos = signal(false);
  readonly showAllComboCompleters = signal(false);
  readonly hasAdvancedContent = computed(() => {
    const analysis = this.analysis();

    return Boolean(analysis?.summary || analysis?.snapshot || analysis?.metrics || analysis?.consistency || analysis?.combos);
  });
  readonly summaryStats = computed<AdvancedAnalysisStat[]>(() => {
    const summary = this.analysis()?.summary;

    return [
      { label: this.t('summary.primaryArchetype'), value: this.formatText(summary?.primaryArchetype) },
      { label: this.t('summary.secondaryArchetypes'), value: this.formatList(summary?.secondaryArchetypes) },
      { label: this.t('summary.archetypeConfidence'), value: this.formatText(summary?.archetypeConfidence) },
      { label: this.t('summary.powerBand'), value: this.formatText(summary?.powerBand) },
      { label: this.t('summary.powerConfidence'), value: this.formatText(summary?.powerConfidence) },
      { label: this.t('summary.criticalIssues'), value: this.formatNumber(summary?.criticalIssues?.length ?? this.issueCount('critical')) },
      { label: this.t('summary.mainWarnings'), value: this.formatNumber(summary?.mainWarnings?.length ?? this.issueCount('warning')) },
    ];
  });
  readonly headerStats = computed<AdvancedAnalysisStat[]>(() => [
    { key: 'deck-id', label: this.t('header.deckId'), value: this.analysis()?.deckId || this.deckIdentifier() },
    { key: 'analyzed-at', label: this.t('header.analyzedAt'), value: this.formatDateTime(this.analysis()?.analyzedAt) },
    { key: 'snapshot', label: this.t('header.snapshot'), value: this.snapshotStatus() },
  ]);
  readonly keyMetrics = computed<AdvancedAnalysisStat[]>(() => [
    { label: this.t('metrics.permanentRamp'), value: this.formatRoleMetric('permanentRamp') },
    { label: this.t('metrics.fastMana'), value: this.formatRoleMetric('fastMana') },
    { label: this.t('metrics.trueTutors'), value: this.formatRoleMetric('trueTutors') },
    { label: this.t('metrics.boardWipes'), value: this.formatRoleMetric('boardWipes') },
    { label: this.t('metrics.massBounce'), value: this.formatRoleMetric('massBounce') },
    { label: this.t('metrics.sacOutlets'), value: this.formatRoleMetric('sacrificeOutlets') },
    { label: this.t('metrics.wincons'), value: this.formatRoleMetric('wincons') },
    { label: this.t('metrics.completeCombos'), value: this.formatNumber(this.completeComboCount()) },
    { label: this.t('metrics.keepableHands'), value: this.formatRate(this.keepableHandRate()) },
  ]);
  readonly cardResolutionStats = computed<AdvancedAnalysisStat[]>(() => {
    const cards = this.analysis()?.metrics?.cards;

    return [
      { label: this.t('cardResolution.cards'), value: this.formatNumber(cards?.totalCards ?? cards?.uniqueCards) },
      { label: this.t('cardResolution.resolved'), value: this.formatNumber(cards?.resolvedCards) },
      { label: this.t('cardResolution.unmatched'), value: this.formatNumber(this.unmatchedCardCount()) },
    ];
  });
  readonly metricsUnavailable = computed(() => {
    const metrics = this.analysis()?.metrics;

    return !metrics?.cards && !metrics?.roles && !metrics?.quality;
  });
  readonly healthCards = computed<AdvancedHealthCard[]>(() => HEALTH_CARD_CONFIGS.map((config) => {
    const entry = this.healthEntry(config.key);
    const status = this.normalizeHealthStatus(entry?.status);
    const cards = this.cardReferenceItems(entry?.cards).slice(0, 8);
    const cardCount = Array.isArray(entry?.cards) ? entry.cards.length : 0;

    return {
      key: config.key,
      title: this.translateKey(config.title),
      status,
      statusLabel: this.translateKey(HEALTH_STATUS_LABEL_KEYS[status]),
      message: this.formatText(entry?.message ?? this.defaultHealthMessage()),
      metricLabel: this.translateKey(config.metricLabel),
      metricValue: this.healthMetricValue(config, entry),
      cards,
      hiddenCardCount: Math.max(0, cardCount - cards.length),
    };
  }));
  readonly topIssues = computed<AdvancedIssueItem[]>(() => (this.analysis()?.issues ?? [])
    .slice()
    .sort((left, right) => this.issueSeverityRank(left) - this.issueSeverityRank(right))
    .slice(0, 5)
    .map((issue) => ({
      code: issue.code ?? issue.title ?? 'issue',
      title: this.formatText(issue.title ?? issue.code),
      message: this.formatText(issue.message),
      severity: this.formatIssueSeverity(issue.severity),
    })));
  readonly snapshotIndicator = computed<SnapshotIndicator>(() => {
    const snapshot = this.analysis()?.snapshot;
    const calculatedAt = this.formatDateTime(snapshot?.calculatedAt);
    const hasCalculatedAt = calculatedAt !== this.t('common.unavailable');

    if (!snapshot) {
      return {
        label: this.t('snapshot.fresh'),
        detail: this.t('snapshot.metadataUnavailable'),
        state: 'missing',
      };
    }

    if (snapshot.hit === true) {
      return {
        label: this.t('snapshot.cached'),
        detail: hasCalculatedAt
          ? this.t('snapshot.calculatedAt', { date: calculatedAt })
          : this.t('snapshot.calculatedEarlier'),
        state: 'cached',
      };
    }

    const reason = this.formatSnapshotReason(snapshot.reason);

    return {
      label: this.t('snapshot.fresh'),
      detail: hasCalculatedAt ? this.t('snapshot.reasonCalculatedAt', { reason, date: calculatedAt }) : reason,
      state: 'fresh',
    };
  });
  readonly snapshotDetail = computed(() => this.snapshotIndicator().detail);
  readonly snapshotStatus = computed(() => this.snapshotIndicator().label);
  readonly hasConsistency = computed(() => this.analysis()?.consistency !== null && this.analysis()?.consistency !== undefined);
  readonly simulationRuns = computed(() => this.formatNumber(this.analysis()?.consistency?.simulationRuns));
  readonly openingHandRows = computed(() => this.metricRows(this.analysis()?.consistency?.openingHand, OPENING_HAND_METRICS));
  readonly keepRuleDescription = computed(() => {
    const description = this.analysis()?.consistency?.keepRule?.['description'];

    return typeof description === 'string' && description.trim()
      ? description
      : this.t('consistency.keepRuleFallback');
  });
  readonly keepRuleRows = computed(() => this.metricRows(this.analysis()?.consistency?.keepRule, KEEP_RULE_METRICS));
  readonly mulliganRows = computed(() => this.metricRows(this.analysis()?.consistency?.mulligan, MULLIGAN_METRICS));
  readonly byTurnGroups = computed<ConsistencyTurnGroup[]>(() => {
    const byTurn = this.analysis()?.consistency?.byTurn;

    return [
      { title: this.t('consistency.turn3'), rows: this.metricRows(byTurn?.turn3, TURN_3_METRICS) },
      { title: this.t('consistency.turn5'), rows: this.metricRows(byTurn?.turn5, TURN_5_METRICS) },
    ];
  });
  readonly roleBreakdownCards = computed<RoleBreakdownCard[]>(() => ROLE_BREAKDOWN_CONFIGS
    .map((config) => this.roleBreakdownCard(config))
    .filter((card) => card.rows.length > 0 || card.qualityRows.length > 0));
  readonly powerSignalCardGroups = computed<PowerSignalCardGroup[]>(() => {
    const signalCards = this.analysis()?.power?.signalCards;
    const signals = this.analysis()?.power?.signals;
    if (!signalCards) {
      return [];
    }

    return Object.entries(signalCards)
      .map(([key, cards]) => ({
        key,
        label: this.powerSignalLabel(key),
        value: this.formatNumber(signals?.[key]),
        cards: this.cardReferenceItems(cards).slice(0, 6),
      }))
      .filter((group) => group.cards.length > 0);
  });
  readonly comboSummaryStats = computed<AdvancedAnalysisStat[]>(() => {
    const combos = this.analysis()?.combos;

    return [
      { label: this.t('combos.summary.complete'), value: this.formatNumber(combos?.completeCount ?? combos?.complete?.length ?? 0) },
      { label: this.t('combos.summary.partialOneMissing'), value: this.formatNumber(combos?.partialOneMissingCount ?? combos?.partialOneMissing?.length ?? 0) },
      { label: this.t('combos.summary.partialTwoMissing'), value: this.formatNumber(combos?.partialTwoMissingCount ?? combos?.partialTwoMissing?.length ?? 0) },
      { label: this.t('combos.summary.winLike'), value: this.formatNumber(combos?.winLikeCount) },
      { label: this.t('combos.summary.infiniteMana'), value: this.formatNumber(combos?.infiniteManaCount) },
      { label: this.t('combos.summary.lethalLoops'), value: this.formatNumber(combos?.lethalLoopCount) },
    ];
  });
  readonly hasComboPayload = computed(() => this.analysis()?.combos !== null && this.analysis()?.combos !== undefined);
  readonly hasComboSignals = computed(() => {
    const combos = this.analysis()?.combos;

    return Boolean(
      (combos?.completeCount ?? combos?.complete?.length ?? 0) > 0
      || (combos?.partialOneMissingCount ?? combos?.partialOneMissing?.length ?? 0) > 0
      || (combos?.partialTwoMissingCount ?? combos?.partialTwoMissing?.length ?? 0) > 0
      || (combos?.winLikeCount ?? 0) > 0
      || (combos?.infiniteManaCount ?? 0) > 0
      || (combos?.lethalLoopCount ?? 0) > 0
      || this.topComboCompleters().length > 0
    );
  });
  readonly comboEmptyMessage = computed(() => {
    if (!this.hasComboPayload()) {
      return this.t('combos.empty.unavailable');
    }

    return this.hasComboSignals() ? null : this.t('combos.empty.noCompleteOrPartial');
  });
  readonly completeComboItems = computed(() => this.comboItems(this.analysis()?.combos?.complete ?? []));
  readonly visibleCompleteComboItems = computed(() => this.showAllCompleteCombos()
    ? this.completeComboItems()
    : this.completeComboItems().slice(0, COMPLETE_COMBO_INITIAL_LIMIT));
  readonly hiddenCompleteComboCount = computed(() => Math.max(0, this.completeComboItems().length - this.visibleCompleteComboItems().length));
  readonly partialOneMissingComboItems = computed(() => this.comboItems(this.analysis()?.combos?.partialOneMissing ?? []));
  readonly visiblePartialOneMissingComboItems = computed(() => this.showAllPartialCombos()
    ? this.partialOneMissingComboItems()
    : this.partialOneMissingComboItems().slice(0, PARTIAL_COMBO_INITIAL_LIMIT));
  readonly hiddenPartialComboCount = computed(() => Math.max(0, this.partialOneMissingComboItems().length - this.visiblePartialOneMissingComboItems().length));
  readonly topComboCompleters = computed<ComboCompleterItem[]>(() => (this.analysis()?.topComboCompleters ?? []).map((item) => this.comboCompleterItem(item)));
  readonly visibleTopComboCompleters = computed(() => this.showAllComboCompleters()
    ? this.topComboCompleters()
    : this.topComboCompleters().slice(0, COMBO_COMPLETER_INITIAL_LIMIT));
  readonly hiddenComboCompleterCount = computed(() => Math.max(0, this.topComboCompleters().length - this.visibleTopComboCompleters().length));
  readonly comboPiecesWarning = computed(() => (this.analysis()?.issues ?? [])
    .find((issue) => issue.code === 'combo_pieces_without_complete_combos')?.message
    ?? null);
  readonly criticalIssueItems = computed(() => this.actionIssueItems('critical'));
  readonly warningIssueItems = computed(() => this.actionIssueItems('warning'));
  readonly infoIssueItems = computed(() => this.actionIssueItems('info'));
  readonly hasActionIssues = computed(() => (
    this.criticalIssueItems().length > 0
    || this.warningIssueItems().length > 0
    || this.infoIssueItems().length > 0
  ));
  readonly recommendationItems = computed<RecommendationItem[]>(() => (this.analysis()?.recommendations ?? [])
    .slice()
    .sort((left, right) => this.recommendationPriorityRank(left) - this.recommendationPriorityRank(right))
    .map((recommendation) => this.recommendationItem(recommendation)));
  readonly unmatchedCardItems = computed<UnmatchedCardItem[]>(() => (this.analysis()?.unmatchedCards ?? [])
    .slice(0, 5)
    .map((card, index) => this.unmatchedCardItem(card, index)));
  readonly unmatchedCardCount = computed(() => {
    const listed = this.analysis()?.unmatchedCards?.length ?? 0;
    const metric = this.analysis()?.metrics?.cards?.unmatchedCards;

    return typeof metric === 'number' && Number.isFinite(metric) ? Math.max(metric, listed) : listed;
  });
  readonly hasUnmatchedCards = computed(() => this.unmatchedCardCount() > 0);

  private readonly completeComboCount = computed(() => {
    const combos = this.analysis()?.combos;

    return combos?.completeCount ?? combos?.complete?.length ?? 0;
  });
  private readonly keepableHandRate = computed(() => {
    const consistency = this.analysis()?.consistency;
    const openingHand = consistency?.openingHand;

    return consistency?.keepableHandRate
      ?? openingHand?.['keepableHandRate']
      ?? openingHand?.['keepableRate']
      ?? openingHand?.['keepable']
      ?? null;
  });

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translateKey(`${ADVANCED_ANALYSIS_I18N_PREFIX}.${key}`, params);
  }

  private translateKey(key: string, params?: Record<string, unknown>): string {
    const translated = this.translations.instant(key, params);
    return typeof translated === 'string' && translated !== key
      ? translated
      : runtimeTranslationFallback(key, params);
  }

  private formatSnapshotReason(value: string | null | undefined): string {
    const reason = value?.trim();

    if (!reason) {
      return this.t('snapshot.recalculated');
    }

    return `${this.formatFeatureLabel(reason)}.`;
  }

  private formatText(value: string | null | undefined): string {
    return value?.trim() || this.t('common.unavailable');
  }

  private formatList(value: string[] | null | undefined): string {
    return value && value.length > 0 ? value.join(', ') : this.t('common.unavailable');
  }

  private formatNumber(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : this.t('common.unavailable');
  }

  private formatCompactNumber(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value)
      ? String(Math.round(value * 100) / 100)
      : this.t('common.notAvailable');
  }

  private formatRate(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return this.t('common.unavailable');
    }

    const percentage = value <= 1 ? value * 100 : value;
    return `${Math.round(percentage * 10) / 10}%`;
  }

  private formatMetricValue(key: string, value: number | null): string {
    if (value === null) {
      return this.t('common.notAvailable');
    }

    return key === 'averageMulligansNeeded'
      ? this.formatCompactNumber(value)
      : this.formatRate(value);
  }

  private formatDateTime(value: string | null | undefined): string {
    if (!value) {
      return this.t('common.unavailable');
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return this.t('common.unavailable');
    }

    return new Intl.DateTimeFormat(this.translations.currentLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  private formatStatus(value: string | null | undefined): string {
    const status = this.normalizeHealthStatus(value);
    return this.translateKey(HEALTH_STATUS_LABEL_KEYS[status]);
  }

  private formatIssueSeverity(value: string | null | undefined): string {
    return value ? this.translateKey(ISSUE_SEVERITY_LABEL_KEYS[value] ?? `${ADVANCED_ANALYSIS_I18N_PREFIX}.status.unknown`) : this.t('status.unknown');
  }

  private formatRecommendationPriority(value: string | null | undefined): string {
    if (value === 'high' || value === 'medium' || value === 'low') {
      return this.t(`priority.${value}`);
    }

    return this.formatText(value);
  }

  private healthEntry(key: string): AdvancedHealthSection | null {
    const value = this.analysis()?.health?.[key];
    return this.isRecord(value) ? value : null;
  }

  private normalizeHealthStatus(value: string | null | undefined): AdvancedHealthStatus {
    return value === 'excellent'
      || value === 'good'
      || value === 'warning'
      || value === 'critical'
      || value === 'unknown'
      ? value
      : 'unknown';
  }

  private healthMetricValue(config: HealthCardConfig, entry: AdvancedHealthSection | null): string {
    if (config.valueSource === 'combos') {
      return this.formatNumber(this.completeComboCount());
    }

    if (config.valueSource === 'keepableHandRate') {
      return this.formatRate(this.keepableHandRate());
    }

    if (!config.metricKey) {
      return this.t('common.unavailable');
    }

    const evidenceValue = this.numberFromRecord(entry?.evidence, config.metricKey);
    if (evidenceValue !== null) {
      return this.formatNumber(evidenceValue);
    }

    return this.formatRoleMetric(config.metricKey);
  }

  private formatRoleMetric(key: string): string {
    return this.formatNumber(this.analysis()?.metrics?.roles?.[key]);
  }

  private numberFromRecord(record: Record<string, unknown> | null | undefined, key: string): number | null {
    const value = record?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private metricRows(
    source: Record<string, unknown> | null | undefined,
    metrics: ReadonlyArray<readonly [string, string]>,
  ): ConsistencyMetricRow[] {
    return metrics.map(([key, label]) => {
      const value = this.numberFromRecord(source, key);

      return {
        key,
        label: this.translateKey(label),
        value: this.formatMetricValue(key, value),
        barWidth: this.metricBarWidth(key, value),
        available: value !== null,
      };
    });
  }

  private metricBarWidth(key: string, value: number | null): string {
    if (value === null) {
      return '0%';
    }

    if (key === 'averageMulligansNeeded') {
      return `${Math.max(0, Math.min(value / 3, 1)) * 100}%`;
    }

    const percentage = value <= 1 ? value * 100 : value;
    return `${Math.max(0, Math.min(percentage, 100))}%`;
  }

  private roleBreakdownCard(config: RoleBreakdownConfig): RoleBreakdownCard {
    const unavailable = this.t('common.unavailable');
    const rows = config.metrics
      .map(([key, label]) => ({ label: this.translateKey(label), value: this.formatRoleMetric(key) }))
      .filter((row) => row.value !== unavailable && row.value !== '0');

    return {
      key: config.key,
      title: this.translateKey(config.title),
      rows,
      message: this.roleBreakdownMessage(config),
      qualityRows: this.qualityRows(config.qualityKey),
    };
  }

  private roleBreakdownMessage(config: RoleBreakdownConfig): string | null {
    if (!config.message) {
      return null;
    }

    if (!config.messageMetricKeys) {
      return this.hasAnyRoleMetric(config.metrics.map(([key]) => key)) ? this.translateKey(config.message) : null;
    }

    return this.hasAnyRoleMetric(config.messageMetricKeys) ? this.translateKey(config.message) : null;
  }

  private hasAnyRoleMetric(keys: readonly string[]): boolean {
    return keys.some((key) => {
      const value = this.analysis()?.metrics?.roles?.[key];
      return typeof value === 'number' && value > 0;
    });
  }

  private qualityRows(qualityKey: string | undefined): AdvancedAnalysisStat[] {
    if (!qualityKey) {
      return [];
    }

    const quality = this.analysis()?.metrics?.quality?.[qualityKey];
    if (!quality) {
      return [];
    }

    const unavailable = this.t('common.unavailable');

    return QUALITY_LABELS
      .map(([key, label]) => ({ label: this.translateKey(label), value: this.formatNumber(this.numberFromRecord(quality as Record<string, unknown>, key)) }))
      .filter((row) => row.value !== unavailable && row.value !== '0');
  }

  private comboItems(items: AdvancedComboItem[]): ComboDisplayItem[] {
    return items.map((item, index) => {
      const missingCards = this.comboMissingCards(item);

      return {
        id: item.comboVariantId ?? item.externalId ?? String(index),
        title: this.comboTitle(item, index),
        cards: this.comboCards(item),
        missingCards,
        missingCardNames: missingCards.map((card) => card.name).join(', '),
        features: this.comboFeatures(item),
        badges: this.comboBadges(item),
      };
    });
  }

  private comboTitle(item: AdvancedComboItem, index: number): string {
    return item.name?.trim()
      || item.externalId?.trim()
      || item.comboVariantId?.trim()
      || this.t('combos.comboLine', { index: index + 1 });
  }

  private comboCards(item: AdvancedComboItem): ComboCardPreviewItem[] {
    return this.comboCardItems(item.cards, item.cardNames ?? item.requiredCardNames ?? []);
  }

  private comboMissingCards(item: AdvancedComboItem): ComboCardPreviewItem[] {
    return this.comboCardItems(item.missingCards, item.missingCardNames ?? []);
  }

  private comboCardItems(references: readonly AdvancedCardReference[] | undefined, fallbackNames: readonly string[]): ComboCardPreviewItem[] {
    const items = (references ?? [])
      .map((reference) => this.comboCardItem(reference))
      .filter((item): item is ComboCardPreviewItem => item !== null);

    if (items.length > 0) {
      return items;
    }

    return fallbackNames
      .map((name) => name.trim())
      .filter((name) => name !== '')
      .map((name) => ({
        id: this.cardPreviewKey(name),
        name,
        imageUrl: null,
      }));
  }

  private comboCardItem(reference: AdvancedCardReference): ComboCardPreviewItem | null {
    const name = this.displayCardName(reference.name);
    const id = reference.deckCardId?.trim()
      || reference.cardId?.trim()
      || reference.oracleId?.trim()
      || this.cardPreviewKey(name);

    if (name === this.t('common.unavailable') && !reference.imageUrl) {
      return null;
    }

    return {
      id,
      name,
      imageUrl: reference.imageUrl?.trim() || null,
    };
  }

  private cardReferenceItems(references: readonly AdvancedCardReference[] | undefined): ComboCardPreviewItem[] {
    return (references ?? [])
      .map((reference) => this.comboCardItem(reference))
      .filter((item): item is ComboCardPreviewItem => item !== null);
  }

  private powerSignalLabel(key: string): string {
    const metricKey = `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.${key}`;
    const translatedMetric = this.translations.instant(metricKey);
    if (typeof translatedMetric === 'string' && translatedMetric !== metricKey) {
      return translatedMetric;
    }

    return this.formatFeatureLabel(key);
  }

  private comboFeatures(item: AdvancedComboItem): string[] {
    return (item.features ?? []).map((feature) => this.formatFeatureLabel(feature)).filter((feature) => feature !== '');
  }

  private comboBadges(item: AdvancedComboItem): string[] {
    const badges: string[] = [];
    if (item.producesWinLike) {
      badges.push(this.t('combos.badges.winLike'));
    }
    if (item.producesInfiniteMana) {
      badges.push(this.t('combos.badges.infiniteMana'));
    }
    if (item.producesInfiniteDamage) {
      badges.push(this.t('combos.badges.infiniteDamage'));
    }
    if (item.requiresCommander) {
      badges.push(this.t('combos.badges.requiresCommander'));
    }
    if (item.requiresTemplate) {
      badges.push(this.t('combos.badges.requiresTemplate'));
    }

    return badges;
  }

  private formatFeatureLabel(value: string): string {
    const normalized = value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    return normalized.replace(/^\w/, (letter) => letter.toUpperCase());
  }

  private comboCompleterItem(item: AdvancedTopComboCompleter): ComboCompleterItem {
    const name = this.displayCardName(item.name);

    return {
      id: item.oracleId ?? item.name ?? 'combo-completer',
      name,
      imageUrl: item.imageUrl?.trim() || null,
      completesCombos: this.formatNumber(item.completesCombos),
    };
  }

  private cardPreviewKey(value: string): string {
    return value.trim().toLocaleLowerCase();
  }

  private displayCardName(value: string | null | undefined): string {
    const name = value?.trim();

    return name && !UUID_LIKE_PATTERN.test(name) ? name : this.t('common.unavailable');
  }

  private unmatchedCardItem(card: UnmatchedCard, index: number): UnmatchedCardItem {
    const quantity = typeof card.quantity === 'number' && Number.isFinite(card.quantity) && card.quantity > 1
      ? `${card.quantity}x `
      : '';
    const section = card.section ? ` · ${this.formatFeatureLabel(card.section)}` : '';
    const reason = card.reason ? ` · ${this.formatFeatureLabel(card.reason)}` : '';

    return {
      id: card.deckCardId ?? card.cardId ?? card.name ?? String(index),
      name: `${quantity}${this.formatText(card.name)}`,
      detail: `${section}${reason}`.replace(/^ · /, '') || this.t('cardResolution.cardCouldNotBeMatched'),
    };
  }

  private actionIssueItems(severity: string): ActionIssueItem[] {
    return (this.analysis()?.issues ?? [])
      .filter((issue) => issue.severity === severity)
      .map((issue) => ({
        code: issue.code ?? issue.title ?? severity,
        severity: this.formatIssueSeverity(issue.severity),
        title: this.formatText(issue.title ?? issue.code),
        message: this.formatText(issue.message),
        suggestedActionType: this.formatActionType(issue.suggestedActionType),
        evidence: this.evidenceItems(issue.evidence),
      }));
  }

  private recommendationPriorityRank(recommendation: AdvancedRecommendation): number {
    return RECOMMENDATION_PRIORITY_RANK[recommendation.priority ?? ''] ?? 3;
  }

  private recommendationItem(recommendation: AdvancedRecommendation): RecommendationItem {
    const targetRoles = this.formatList(recommendation.targetRoles);
    const reasonIssueCodes = this.formatList(recommendation.reasonIssueCodes);
    const unavailable = this.t('common.unavailable');

    return {
      code: recommendation.code ?? recommendation.title ?? 'recommendation',
      priority: this.formatRecommendationPriority(recommendation.priority),
      title: this.formatText(recommendation.title ?? recommendation.code),
      message: this.formatText(recommendation.message),
      targetRoles,
      hasTargetRoles: targetRoles !== unavailable,
      reasonIssueCodes,
      hasReasonIssueCodes: reasonIssueCodes !== unavailable,
    };
  }

  private evidenceItems(evidence: Record<string, unknown> | null | undefined): EvidenceItem[] {
    if (!evidence) {
      return [];
    }

    return Object.entries(evidence)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => ({
        label: this.formatFeatureLabel(key),
        value: this.formatEvidenceValue(value),
      }));
  }

  private formatEvidenceValue(value: unknown): string {
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).join(', ');
    }

    if (typeof value === 'boolean') {
      return value ? this.t('common.yes') : this.t('common.no');
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : this.t('common.unavailable');
    }

    if (typeof value === 'string') {
      return value.trim() || this.t('common.unavailable');
    }

    return this.t('common.available');
  }

  private formatActionType(value: string | null | undefined): string {
    return value ? this.formatFeatureLabel(value) : this.t('actions.review');
  }

  private isRecord(value: unknown): value is AdvancedHealthSection {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private defaultHealthMessage(): string {
    return this.t('health.defaultMessage');
  }

  private issueCount(severity: string): number {
    return (this.analysis()?.issues ?? []).filter((issue) => issue.severity === severity).length;
  }

  private issueSeverityRank(issue: AdvancedIssue): number {
    if (issue.severity === 'critical') {
      return 0;
    }

    if (issue.severity === 'warning') {
      return 1;
    }

    return 2;
  }
}
