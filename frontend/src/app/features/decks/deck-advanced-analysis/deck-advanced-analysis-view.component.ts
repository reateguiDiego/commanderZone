import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslationService } from '../../../core/localization/translation.service';
import { runtimeTranslationFallback, RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { CardFaceImageSource } from '../../../shared/utils/card-faces';
import { bestCardImage } from '../../../shared/utils/card-image';
import { TabListComponent, type TabListItem } from '../../../shared/ui/tab-list/tab-list.component';
import { AdvancedAnalysisBoardWipesSectionComponent } from './sections/advanced-analysis-board-wipes-section.component';
import { AdvancedAnalysisCombosSectionComponent } from './sections/advanced-analysis-combos-section.component';
import { AdvancedAnalysisConsistencySectionComponent } from './sections/advanced-analysis-consistency-section.component';
import { AdvancedAnalysisHealthSectionComponent } from './sections/advanced-analysis-health-section.component';
import { AdvancedAnalysisManaSectionComponent } from './sections/advanced-analysis-mana-section.component';
import { AdvancedAnalysisMetricsSectionComponent } from './sections/advanced-analysis-metrics-section.component';
import { AdvancedAnalysisRolesSectionComponent } from './sections/advanced-analysis-roles-section.component';
import { AdvancedAnalysisStateComponent } from './sections/advanced-analysis-state.component';
import { AdvancedAnalysisSummarySectionComponent } from './sections/advanced-analysis-summary-section.component';
import type {
  AdvancedAnalysisCardGridItem,
  AdvancedAnalysisStat,
  ArchetypeIdentityView,
  AdvancedHealthCard,
  AdvancedIssueItem,
  BoardWipeDetailItem,
  BoardWipeOverview,
  BoardWipeStatGroup,
  ComboCardPreviewItem,
  ComboCompleterItem,
  ComboDisplayItem,
  ConsistencyMetricRow,
  ConsistencyTurnGroup,
  ManaCardGroup,
  ManaColorDemandRow,
  ManaColorSourceRow,
  ManaSymbolStatItem,
  PowerSignalCardGroup,
  RoleBreakdownCard,
  TypalIdentityView,
  UnmatchedCardItem,
} from './deck-advanced-analysis-view.models';
import {
  AdvancedCardCatalogEntry,
  AdvancedArchetypeExplanation,
  AdvancedAnalysisResponse,
  AdvancedBoardWipeDetail,
  AdvancedBoardWipeMetrics,
  AdvancedCardReference,
  AdvancedComboItem,
  AdvancedHealthSection,
  AdvancedHealthStatus,
  AdvancedIssue,
  AdvancedManaMetrics,
  AdvancedTopComboCompleter,
  UnmatchedCard,
} from '../../../core/models/deck-advanced-analysis.model';
import { Deck, DeckCard } from '../../../core/models/deck.model';
import type { Card, CardFace, CardImageUris } from '../../../core/models/card.model';

const ADVANCED_ANALYSIS_I18N_PREFIX = 'deckBuilder.advancedAnalysis';

interface ManaCardImageReference {
  readonly deckCardId?: string | null;
  readonly oracleId?: string | null;
  readonly scryfallId?: string | null;
  readonly name?: string | null;
  readonly imageUrl?: string | null;
  readonly imageUris?: CardImageUris | null;
  readonly cardFaces?: CardFace[];
  readonly quantity?: number | null;
}

interface NormalizedCardReference extends ManaCardImageReference {
  readonly id?: string | null;
}

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
type AdvancedAnalysisTabId = 'summary' | 'health' | 'mana' | 'boardWipes' | 'metrics' | 'combos' | 'consistency' | 'roles';

const ADVANCED_ANALYSIS_TABS: readonly TabListItem[] = [
  { id: 'summary', label: `${ADVANCED_ANALYSIS_I18N_PREFIX}.summary.title` },
  { id: 'mana', label: `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.title` },
  { id: 'boardWipes', label: `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.title` },
  { id: 'health', label: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.eyebrow` },
  { id: 'metrics', label: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.eyebrow` },
  { id: 'combos', label: `${ADVANCED_ANALYSIS_I18N_PREFIX}.combos.title` },
  { id: 'consistency', label: `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.eyebrow` },
  { id: 'roles', label: `${ADVANCED_ANALYSIS_I18N_PREFIX}.roles.eyebrow` },
];

interface HealthCardConfig {
  readonly key: string;
  readonly title: string;
  readonly metricLabel: string;
  readonly metricKey?: string;
  readonly valueSource?: 'combos' | 'keepableHandRate';
  readonly optional?: boolean;
}

interface RoleBreakdownConfig {
  readonly key: string;
  readonly title: string;
  readonly metrics: ReadonlyArray<readonly [string, string]>;
  readonly message?: string;
  readonly messageMetricKeys?: readonly string[];
  readonly qualityKey?: string;
}

interface OrderedArchetypeIdentity {
  readonly view: ArchetypeIdentityView;
  readonly sortRank: number;
  readonly originalIndex: number;
}

const HEALTH_CARD_CONFIGS: readonly HealthCardConfig[] = [
  { key: 'ramp', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.ramp`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.permanentRamp`, metricKey: 'permanentRamp' },
  { key: 'draw', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.draw`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.drawEffects`, metricKey: 'draw' },
  { key: 'interaction', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.interaction`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.spotInteraction`, metricKey: 'spotRemoval' },
  { key: 'wipes', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.wipes`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.boardWipes`, metricKey: 'boardWipes' },
  { key: 'tutors', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.tutors`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.trueTutors`, metricKey: 'trueTutors' },
  { key: 'mana', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.mana`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.coloredSources`, optional: true },
  { key: 'sacrifice', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.sacrifice`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.outlets`, metricKey: 'sacrificeOutlets' },
  { key: 'wincons', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.wincons`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.wincons`, metricKey: 'wincons' },
  { key: 'typal', title: `${ADVANCED_ANALYSIS_I18N_PREFIX}.health.cards.typal`, metricLabel: `${ADVANCED_ANALYSIS_I18N_PREFIX}.metrics.typalCreatures`, metricKey: 'creatureCount', optional: true },
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

const MANA_COLOR_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ['white', 'W', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.colors.white`],
  ['blue', 'U', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.colors.blue`],
  ['black', 'B', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.colors.black`],
  ['red', 'R', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.colors.red`],
  ['green', 'G', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.colors.green`],
  ['colorless', 'C', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.colors.colorless`],
];

const MANA_LAND_CYCLES: ReadonlyArray<readonly [string, string]> = [
  ['fetchland', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.fetchland`],
  ['shockland', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.shockland`],
  ['triome', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.triome`],
  ['surveil_land', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.surveilLand`],
  ['fastland', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.fastland`],
  ['slowland', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.slowland`],
  ['painland', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.painland`],
  ['checkland', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.checkland`],
  ['filterland', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.filterland`],
  ['pathway', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.pathway`],
  ['battle_land', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.battleLand`],
  ['bond_land', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.bondLand`],
  ['bounce_land', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.bounceLand`],
  ['temple', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.temple`],
  ['gain_land', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.gainLand`],
  ['utility_land', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.utilityLand`],
  ['colorless_utility_land', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.cycles.colorlessUtilityLand`],
];

const MANA_RAMP_METRICS: ReadonlyArray<readonly [string, string]> = [
  ['permanentRamp', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.permanentRamp`],
  ['landRamp', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.landRamp`],
  ['manaRocks', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.manaRocks`],
  ['manaDorks', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.manaDorks`],
  ['fastMana', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.fastMana`],
  ['temporaryMana', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.temporaryMana`],
  ['treasureSources', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.treasureSources`],
  ['costReducers', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.costReducers`],
];

const MANA_FIXING_METRICS: ReadonlyArray<readonly [string, string]> = [
  ['fetchlands', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.fetchlands`],
  ['rainbowSources', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.rainbowSources`],
  ['conditionalFixing', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.conditionalFixing`],
  ['landRampFixing', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.landRampFixing`],
  ['artifactFixing', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.artifactFixing`],
  ['creatureFixing', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.creatureFixing`],
];

const COLOR_ACCESS_TURN_METRICS: ReadonlyArray<readonly [string, string]> = [
  ['white', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.colors.white`],
  ['blue', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.colors.blue`],
  ['black', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.colors.black`],
  ['red', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.colors.red`],
  ['green', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.colors.green`],
  ['allCommanderColors', `${ADVANCED_ANALYSIS_I18N_PREFIX}.mana.allCommanderColors`],
];

const COMMANDER_CURVE_METRICS: ReadonlyArray<readonly [string, string]> = [
  ['canCastOnCurveRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.canCastOnCurve`],
  ['missingColorRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.missingColor`],
  ['missingManaValueRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.missingManaValue`],
  ['tappedOutDelayRate', `${ADVANCED_ANALYSIS_I18N_PREFIX}.consistency.metrics.tappedOutDelay`],
];

const MANA_ISSUE_CODES = new Set([
  'low_colored_sources',
  'too_many_tapped_lands',
  'too_many_slow_lands',
  'fetchlands_without_targets',
  'ramp_does_not_fix_colors',
  'commander_color_bottleneck',
  'checklands_not_supported',
  'filterlands_need_input_sources',
  'pathways_create_color_choice_pressure',
  'bounce_lands_tempo_risk',
  'colorless_land_pressure',
  'fetchlands_mostly_tapped_targets',
  'typed_land_density_low_for_fetches',
  'low_commander_castability',
]);

const BOARD_WIPE_DETAIL_INITIAL_LIMIT = 8;
const BOARD_WIPE_ISSUE_CODES = new Set([
  'low_hard_board_wipes',
  'wipes_are_mostly_bounce_or_conditional',
  'wipes_are_mostly_pseudo',
  'wipes_are_mostly_bounce',
  'no_indestructible_answer',
  'no_artifact_enchantment_wipe_coverage',
  'no_graveyard_wipe_coverage',
  'too_many_symmetrical_wipes_for_creature_deck',
  'own_plan_collision_wipes',
  'board_wipes_self_plan_risk',
  'expensive_wipe_package',
  'no_cheap_emergency_wipe',
  'overload_wipe_available',
  'asymmetrical_wipe_strength',
  'modal_wipe_strength',
  'opponent_compensation_risk',
]);
const BOARD_WIPE_MAIN_ISSUE_CODES = new Set([
  'low_hard_board_wipes',
  'wipes_are_mostly_pseudo',
  'wipes_are_mostly_bounce',
  'no_indestructible_answer',
  'too_many_symmetrical_wipes_for_creature_deck',
  'own_plan_collision_wipes',
  'expensive_wipe_package',
  'opponent_compensation_risk',
]);
const BOARD_WIPE_PACKAGE_METRICS: ReadonlyArray<readonly [keyof AdvancedBoardWipeMetrics, string]> = [
  ['total', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.total`],
  ['hardTotal', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.hardTotal`],
  ['pseudoTotal', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.pseudoTotal`],
  ['hardCreatureWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.hardCreatureWipes`],
  ['averageManaValue', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.averageManaValue`],
  ['effectiveLowCostWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.effectiveLowCostWipes`],
];
const BOARD_WIPE_METHOD_METRICS: ReadonlyArray<readonly [keyof AdvancedBoardWipeMetrics, string]> = [
  ['destroyWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.destroyWipes`],
  ['exileWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.exileWipes`],
  ['sacrificeWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.sacrificeWipes`],
  ['massBounce', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.massBounce`],
  ['damageWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.damageWipes`],
  ['minusXMinusXWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.minusXMinusXWipes`],
];
const BOARD_WIPE_COVERAGE_METRICS: ReadonlyArray<readonly [keyof AdvancedBoardWipeMetrics, string]> = [
  ['creatureWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.creatureWipes`],
  ['artifactWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.artifactWipes`],
  ['enchantmentWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.enchantmentWipes`],
  ['artifactEnchantmentWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.artifactEnchantmentWipes`],
  ['graveyardWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.graveyardWipes`],
  ['nonlandPermanentWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.nonlandPermanentWipes`],
  ['allPermanentWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.allPermanentWipes`],
];
const BOARD_WIPE_QUALITY_METRICS: ReadonlyArray<readonly [keyof AdvancedBoardWipeMetrics, string]> = [
  ['modalWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.modalWipes`],
  ['asymmetricalWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.asymmetricalWipes`],
  ['oneSidedWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.oneSidedWipes`],
  ['overloadedWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.overloadedWipes`],
  ['scalableWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.scalableWipes`],
  ['instantSpeedWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.instantSpeedWipes`],
  ['answersIndestructible', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.answersIndestructible`],
  ['getsAroundHexproof', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.getsAroundHexproof`],
  ['permanentBasedWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.permanentBasedWipes`],
  ['repeatableWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.repeatableWipes`],
];
const BOARD_WIPE_WARNING_METRICS: ReadonlyArray<readonly [keyof AdvancedBoardWipeMetrics, string]> = [
  ['combatOnlyWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.combatOnlyWipes`],
  ['conditionalWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.conditionalWipes`],
  ['opponentCompensationWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.opponentCompensationWipes`],
  ['selfPlanRiskWipes', `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.stats.selfPlanRiskWipes`],
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
  imports: [
    AdvancedAnalysisBoardWipesSectionComponent,
    AdvancedAnalysisCombosSectionComponent,
    AdvancedAnalysisConsistencySectionComponent,
    AdvancedAnalysisHealthSectionComponent,
    AdvancedAnalysisManaSectionComponent,
    AdvancedAnalysisMetricsSectionComponent,
    AdvancedAnalysisRolesSectionComponent,
    AdvancedAnalysisStateComponent,
    AdvancedAnalysisSummarySectionComponent,
    RuntimeTranslatePipe,
    TabListComponent,
  ],
  templateUrl: './deck-advanced-analysis-view.component.html',
  styleUrl: './deck-advanced-analysis-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckAdvancedAnalysisViewComponent {
  private readonly translations = inject(TranslationService);

  readonly analysis = input<AdvancedAnalysisResponse | null>(null);
  readonly deck = input<Deck | null>(null);
  readonly errorMessage = input<string | null>(null);
  readonly retry = output<void>();

  readonly showAllCompleteCombos = signal(false);
  readonly showAllPartialCombos = signal(false);
  readonly showAllComboCompleters = signal(false);
  readonly showAllBoardWipeDetails = signal(false);
  readonly activeAnalysisTab = signal<AdvancedAnalysisTabId>('summary');
  readonly analysisTabs = ADVANCED_ANALYSIS_TABS;
  private readonly deckCardsByDeckCardId = computed(() => this.deckCardLookup('deckCardId'));
  private readonly deckCardsByOracleId = computed(() => this.deckCardLookup('oracleId'));
  readonly hasAdvancedContent = computed(() => {
    const analysis = this.analysis();

    return Boolean(analysis?.summary || analysis?.snapshot || analysis?.metrics || analysis?.consistency || analysis?.combos);
  });
  readonly summaryStats = computed<AdvancedAnalysisStat[]>(() => {
    const summary = this.analysis()?.summary;
    const secondaryArchetypes = summary?.secondaryArchetypes ?? [];
    const stats: AdvancedAnalysisStat[] = [
      {
        label: this.t('summary.primaryArchetype'),
        value: this.formatTitleText(summary?.primaryArchetype),
        tooltipItems: this.archetypeTooltipItems(summary?.primaryArchetype ? [summary.primaryArchetype] : [], summary?.archetypeExplanations),
      },
    ];

    stats.push(
      {
        label: this.t('summary.secondaryArchetypes'),
        value: this.formatTitleList(secondaryArchetypes),
        tooltipItems: this.archetypeTooltipItems(secondaryArchetypes, summary?.archetypeExplanations),
      },
      {
        label: this.t('summary.archetypeConfidence'),
        value: this.formatTitleText(summary?.archetypeConfidence),
        description: this.t('summary.archetypeConfidenceDescription'),
      },
    );

    if (summary?.primaryTypalType) {
      stats.push({ label: this.t('summary.primaryTypalType'), value: this.formatText(summary.primaryTypalType) });
    }

    stats.push(
      { label: this.t('summary.criticalIssues'), value: this.formatNumber(summary?.criticalIssues?.length ?? this.issueCount('critical')) },
    );

    return stats;
  });
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
  readonly typalIdentity = computed<TypalIdentityView | null>(() => {
    const typal = this.analysis()?.typal;
    if (typal?.detected !== true || !typal.primaryType) {
      return null;
    }

    const primary = (typal.types ?? []).find((type) => type.type === typal.primaryType) ?? typal.types?.[0] ?? null;

    return {
      primaryType: typal.primaryType,
      confidence: this.formatText(typal.confidence),
      creatureCount: this.formatNumber(typal.creatureCount ?? primary?.creatureCount),
      supportCount: this.formatNumber(typal.supportCount ?? primary?.supportCount),
      commanderMatches: typal.commanderMatches ? this.t('common.yes') : this.t('common.no'),
      creatureCards: this.cardReferenceItems(primary?.creatureCards).slice(0, 10),
      supportCards: this.cardReferenceItems(primary?.supportCards).slice(0, 8),
    };
  });
  readonly archetypeIdentities = computed<ArchetypeIdentityView[]>(() => {
    const analysis = this.analysis();
    const preferredOrder = new Map<string, number>();
    const explanationsByArchetype = this.archetypeExplanationsByArchetype(analysis?.summary?.archetypeExplanations);
    const primaryArchetype = analysis?.summary?.primaryArchetype?.trim();
    if (primaryArchetype) {
      preferredOrder.set(primaryArchetype, 0);
    }
    for (const [index, archetype] of (analysis?.summary?.secondaryArchetypes ?? []).entries()) {
      const key = archetype.trim();
      if (key !== '' && !preferredOrder.has(key)) {
        preferredOrder.set(key, index + 1);
      }
    }

    const items = (analysis?.archetypes?.scores ?? [])
      .map((score, index) => {
        const archetype = score.archetype?.trim();
        const cards = this.cardReferenceItems(score.cards);
        if (!archetype || cards.length === 0) {
          return null;
        }

        const explanation = explanationsByArchetype.get(archetype);
        const reasonKey = score.reasonKey?.trim() || explanation?.reasonKey?.trim() || this.archetypeReasonKey(archetype);
        const title = this.formatTitleText(archetype);

        return {
          view: {
            key: archetype,
            title,
            reason: this.archetypeReasonText(reasonKey, title),
            cards,
          },
          sortRank: preferredOrder.get(archetype) ?? Number.MAX_SAFE_INTEGER,
          originalIndex: index,
        };
      })
      .filter((item): item is OrderedArchetypeIdentity => item !== null)
      .sort((left, right) => {
        if (left.sortRank !== right.sortRank) {
          return left.sortRank - right.sortRank;
        }
        if (left.sortRank !== Number.MAX_SAFE_INTEGER) {
          return left.originalIndex - right.originalIndex;
        }

        return left.originalIndex - right.originalIndex;
      });

    return items.map((item) => item.view);
  });
  readonly healthCards = computed<AdvancedHealthCard[]>(() => HEALTH_CARD_CONFIGS.flatMap((config) => {
    const entry = this.healthEntry(config.key);
    if (config.optional && entry === null) {
      return [];
    }
    const status = this.normalizeHealthStatus(entry?.status);
    const cards = this.cardReferenceItems(entry?.cards).slice(0, 8);
    const cardCount = Array.isArray(entry?.cards) ? entry.cards.length : 0;

    return [{
      key: config.key,
      title: this.translateKey(config.title),
      status,
      statusLabel: this.translateKey(HEALTH_STATUS_LABEL_KEYS[status]),
      message: this.formatText(entry?.message ?? this.defaultHealthMessage()),
      metricLabel: this.translateKey(config.metricLabel),
      metricValue: this.healthMetricValue(config, entry),
      metricSymbolItems: this.healthMetricSymbolItems(config, entry),
      cards,
      hiddenCardCount: Math.max(0, cardCount - cards.length),
    }];
  }));
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
  readonly colorAccessGroups = computed<ConsistencyTurnGroup[]>(() => {
    const colorAccess = this.analysis()?.consistency?.colorAccess;
    if (!colorAccess) {
      return [];
    }

    return [
      { title: this.t('consistency.turn1'), rows: this.metricRows(colorAccess.turn1, COLOR_ACCESS_TURN_METRICS) },
      { title: this.t('consistency.turn2'), rows: this.metricRows(colorAccess.turn2, COLOR_ACCESS_TURN_METRICS) },
      { title: this.t('consistency.turn3'), rows: this.metricRows(colorAccess.turn3, COLOR_ACCESS_TURN_METRICS) },
    ];
  });
  readonly commanderCurveRows = computed(() => this.metricRows(this.analysis()?.consistency?.colorAccess?.commanderCurve, COMMANDER_CURVE_METRICS));
  readonly manaMetrics = computed(() => this.analysis()?.metrics?.mana ?? null);
  readonly hasManaAnalysis = computed(() => this.manaMetrics() !== null);
  readonly manaOverviewRows = computed<AdvancedAnalysisStat[]>(() => {
    const mana = this.manaMetrics();
    const health = this.healthEntry('mana');
    if (!mana && !health) {
      return [];
    }

    return [
      { label: this.t('mana.totalLands'), value: this.formatNumber(mana?.lands?.total) },
      { label: this.t('mana.averageManaValue'), value: this.formatCompactNumber(this.averageMainDeckManaValue()) },
      { label: this.t('mana.coloredSourceHealth'), value: this.formatColoredSourceHealth(mana) },
    ];
  });
  readonly manaSourceRows = computed<ManaColorSourceRow[]>(() => {
    const mana = this.manaMetrics();
    const commanderIdentityColors = this.commanderIdentityColorKeys();

    return MANA_COLOR_ROWS
      .filter(([key]) => (
        this.hasManaSourceColor(mana, key)
        && this.manaSourceColorIsInIdentity(key, commanderIdentityColors)
      ))
      .map(([key, symbol, label]) => {
        const status = this.commanderColorStatus(key);

        return {
          key,
          symbols: [symbol],
          label: this.translateKey(label),
          sources: this.formatNumber(mana?.sources?.[key]),
          untappedSources: this.formatNumber(mana?.untappedSources?.[key]),
          earlySources: this.formatNumber(mana?.earlySources?.turn3?.[key]),
          status,
        };
      });
  });
  readonly manaSourceCardGroups = computed<ManaCardGroup[]>(() => {
    const commanderIdentityColors = this.commanderIdentityColorKeys();
    const colorGroups = MANA_COLOR_ROWS
      .filter(([key]) => key !== 'colorless' && commanderIdentityColors.has(key))
      .map(([key, symbol, label]) => this.manaDeckCardGroup(
        `source-${key}`,
        this.translateKey(label),
        (deckCard) => this.cardProducesMana(deckCard.card, symbol, key),
      ))
      .filter((group): group is ManaCardGroup => group !== null);
    const fixedManaGroup = this.manaDeckCardGroup(
      'source-fixed-mana',
      this.t('mana.fixedMana'),
      (deckCard) => this.cardFixesCommanderMana(deckCard.card, commanderIdentityColors),
    );

    return fixedManaGroup ? [...colorGroups, fixedManaGroup] : colorGroups;
  });
  readonly manaLandBaseCardGroups = computed<ManaCardGroup[]>(() => [
    this.manaDeckCardGroup('land-base-total', this.t('mana.totalLands'), (deckCard) => this.cardIsLand(deckCard.card)),
    this.manaDeckCardGroup('land-base-basic', this.t('mana.basics'), (deckCard) => this.cardIsBasicLand(deckCard.card)),
    this.manaDeckCardGroup('land-base-nonbasic', this.t('mana.nonbasics'), (deckCard) => this.cardIsLand(deckCard.card) && !this.cardIsBasicLand(deckCard.card)),
    this.manaDeckCardGroup('land-base-typed', this.t('mana.typedLands'), (deckCard) => this.cardHasBasicLandType(deckCard.card)),
    this.manaDeckCardGroup('land-base-colorless-utility', this.t('mana.colorlessUtilityLands'), (deckCard) => this.cardIsColorlessUtilityLand(deckCard.card)),
  ].filter((group): group is ManaCardGroup => group !== null));
  readonly manaLandCycleRows = computed<AdvancedAnalysisStat[]>(() => {
    const landCycles = this.manaMetrics()?.landCycles;

    return MANA_LAND_CYCLES
      .map(([key, label]) => ({
        label: this.translateKey(label),
        value: this.formatNumber(this.numberFromRecord(landCycles, key)),
      }))
      .filter((row) => row.value !== this.t('common.unavailable') && row.value !== '0');
  });
  readonly manaRampCardGroups = computed<ManaCardGroup[]>(() => MANA_RAMP_METRICS
    .map(([key, label]) => this.manaMetricCardGroup(
      `ramp-${key}`,
      this.translateKey(label),
      key === 'temporaryMana' ? [] : [key],
      (deckCard) => this.cardMatchesRampMetric(deckCard.card, key),
    ))
    .filter((group): group is ManaCardGroup => group !== null));
  readonly manaFixingCardGroups = computed<ManaCardGroup[]>(() => MANA_FIXING_METRICS
    .map(([key, label]) => this.manaMetricCardGroup(
      `fixing-${key}`,
      this.translateKey(label),
      this.fixingRoleKeys(key),
      (deckCard) => this.cardMatchesFixingMetric(deckCard.card, key),
    ))
    .filter((group): group is ManaCardGroup => group !== null));
  readonly manaDemandRows = computed<ManaColorDemandRow[]>(() => {
    const requirements = this.manaMetrics()?.requirements;

    return MANA_COLOR_ROWS
      .map(([key, symbol, label]) => ({
        key,
        symbols: [symbol],
        label: this.translateKey(label),
        pipDemand: this.formatNumber(this.numberFromRecord(requirements?.pipDemand, key)),
        earlyPipDemand: this.formatNumber(this.numberFromRecord(requirements?.earlyPipDemand, key)),
        colorIntensity: this.formatRate(this.numberFromRecord(requirements?.colorIntensity, key)),
      }))
      .filter((row) => (
        row.pipDemand !== this.t('common.unavailable')
        || row.earlyPipDemand !== this.t('common.unavailable')
        || row.colorIntensity !== this.t('common.unavailable')
      ));
  });
  readonly manaIssueItems = computed<AdvancedIssueItem[]>(() => (this.analysis()?.issues ?? [])
    .filter((issue) => MANA_ISSUE_CODES.has(issue.code ?? ''))
    .slice()
    .sort((left, right) => this.issueSeverityRank(left) - this.issueSeverityRank(right))
    .map((issue) => ({
      code: issue.code ?? issue.title ?? 'mana_issue',
      title: this.formatText(issue.title ?? issue.code),
      message: this.formatText(issue.message),
      severity: this.formatIssueSeverity(issue.severity),
    })));
  readonly boardWipeMetrics = computed(() => this.analysis()?.metrics?.boardWipes ?? null);
  readonly hasBoardWipeAnalysis = computed(() => this.boardWipeMetrics() !== null);
  readonly boardWipeOverview = computed<BoardWipeOverview | null>(() => {
    const metrics = this.boardWipeMetrics();
    if (!metrics) {
      return null;
    }

    return {
      stats: [
        { label: this.t('boardWipes.stats.hardTotal'), value: this.formatNumber(metrics.hardTotal) },
        { label: this.t('boardWipes.stats.pseudoTotal'), value: this.formatNumber(metrics.pseudoTotal) },
        { label: this.t('boardWipes.stats.modalWipes'), value: this.formatNumber(metrics.modalWipes) },
        { label: this.t('boardWipes.stats.asymmetricalWipes'), value: this.formatNumber(metrics.asymmetricalWipes) },
        { label: this.t('boardWipes.stats.answersIndestructible'), value: this.formatNumber(metrics.answersIndestructible) },
        { label: this.t('boardWipes.stats.effectiveLowCostWipes'), value: this.formatNumber(metrics.effectiveLowCostWipes) },
      ],
      mainIssue: this.boardWipeMainIssue(),
    };
  });
  readonly boardWipeStatGroups = computed<BoardWipeStatGroup[]>(() => {
    const metrics = this.boardWipeMetrics();
    if (!metrics) {
      return [];
    }

    return [
      this.boardWipeStatGroup('package', this.t('boardWipes.package'), metrics, BOARD_WIPE_PACKAGE_METRICS, false),
      this.boardWipeStatGroup('methods', this.t('boardWipes.methods'), metrics, BOARD_WIPE_METHOD_METRICS, true),
      this.boardWipeStatGroup('coverage', this.t('boardWipes.coverage'), metrics, BOARD_WIPE_COVERAGE_METRICS, true),
      this.boardWipeStatGroup('quality', this.t('boardWipes.qualitySignals'), metrics, BOARD_WIPE_QUALITY_METRICS, true),
      this.boardWipeStatGroup('warnings', this.t('boardWipes.pseudoConditionalWarnings'), metrics, BOARD_WIPE_WARNING_METRICS, true),
    ].filter((group) => group.rows.length > 0);
  });
  readonly boardWipeIssueItems = computed<AdvancedIssueItem[]>(() => (this.analysis()?.issues ?? [])
    .filter((issue) => BOARD_WIPE_ISSUE_CODES.has(issue.code ?? ''))
    .slice()
    .sort((left, right) => this.issueSeverityRank(left) - this.issueSeverityRank(right))
    .map((issue) => this.boardWipeIssueItem(issue)));
  readonly boardWipeMainIssue = computed<AdvancedIssueItem | null>(() => this.boardWipeIssueItems()
    .find((issue) => BOARD_WIPE_MAIN_ISSUE_CODES.has(issue.code)) ?? null);
  readonly boardWipeDetailItems = computed<BoardWipeDetailItem[]>(() => (this.boardWipeMetrics()?.details ?? [])
    .map((detail, index) => this.boardWipeDetailItem(detail, index))
    .filter((item): item is BoardWipeDetailItem => item !== null));
  readonly visibleBoardWipeDetailItems = computed(() => this.showAllBoardWipeDetails()
    ? this.boardWipeDetailItems()
    : this.boardWipeDetailItems().slice(0, BOARD_WIPE_DETAIL_INITIAL_LIMIT));
  readonly hiddenBoardWipeDetailCount = computed(() => Math.max(0, this.boardWipeDetailItems().length - this.visibleBoardWipeDetailItems().length));
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

  selectAnalysisTab(tabId: string): void {
    if (this.isAdvancedAnalysisTabId(tabId)) {
      this.activeAnalysisTab.set(tabId);
    }
  }

  private isAdvancedAnalysisTabId(tabId: string): tabId is AdvancedAnalysisTabId {
    return ADVANCED_ANALYSIS_TABS.some((tab) => tab.id === tabId);
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translateKey(`${ADVANCED_ANALYSIS_I18N_PREFIX}.${key}`, params);
  }

  private archetypeTooltipItems(
    archetypes: readonly string[],
    explanations: readonly AdvancedArchetypeExplanation[] | undefined,
  ): { value: string; description: string }[] {
    const explanationsByArchetype = this.archetypeExplanationsByArchetype(explanations);

    return archetypes
      .map((archetype) => archetype.trim())
      .filter((archetype) => archetype !== '')
      .map((archetype) => {
        const explanation = explanationsByArchetype.get(archetype);
        const reasonKey = explanation?.reasonKey?.trim() || this.archetypeReasonKey(archetype);
        const title = this.formatTitleText(archetype);

        return {
          value: title,
          description: this.archetypeReasonText(reasonKey, title),
        };
      });
  }

  private archetypeExplanationsByArchetype(
    explanations: readonly AdvancedArchetypeExplanation[] | undefined,
  ): Map<string, AdvancedArchetypeExplanation> {
    return new Map(
      (explanations ?? [])
        .filter((explanation) => typeof explanation.archetype === 'string' && explanation.archetype.trim() !== '')
        .map((explanation) => [explanation.archetype as string, explanation]),
    );
  }

  private archetypeReasonKey(archetype: string): string {
    return /^[a-z0-9_]+$/.test(archetype) ? archetype : 'generic';
  }

  private archetypeReasonText(reasonKey: string, archetype: string): string {
    return this.t(`summary.archetypeReasons.${reasonKey || 'generic'}`, { archetype });
  }

  private translateKey(key: string, params?: Record<string, unknown>): string {
    const translated = this.translations.instant(key, params);
    return typeof translated === 'string' && translated !== key
      ? translated
      : runtimeTranslationFallback(key, params);
  }

  private formatText(value: string | null | undefined): string {
    return value?.trim() || this.t('common.unavailable');
  }

  private formatTitleText(value: string | null | undefined): string {
    const text = value?.trim();
    return text ? this.toTitleCase(this.formatFeatureLabel(text)) : this.t('common.unavailable');
  }

  private formatTitleList(value: string[] | null | undefined): string {
    if (!value || value.length === 0) {
      return this.t('common.unavailable');
    }

    const items = value
      .map((item) => item.trim())
      .filter((item) => item !== '')
      .map((item) => this.toTitleCase(this.formatFeatureLabel(item)));

    return items.length > 0 ? items.join(', ') : this.t('common.unavailable');
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
    if (typeof entry?.value === 'number') {
      return this.formatNumber(entry.value);
    }

    return this.formatRoleMetric(config.metricKey);
  }

  private healthMetricSymbolItems(config: HealthCardConfig, entry: AdvancedHealthSection | null): ManaSymbolStatItem[] {
    return config.key === 'mana'
      ? this.colorCountSymbolItems(this.recordFromRecord(entry?.evidence, 'coloredSources'))
      : [];
  }

  private manaDeckCardGroup(
    key: string,
    title: string,
    predicate: (deckCard: DeckCard) => boolean,
  ): ManaCardGroup | null {
    const cards = this.manaDeckCards()
      .filter(predicate)
      .map((deckCard) => this.gridItemFromDeckCard(deckCard));

    return this.manaCardGroup(key, title, cards);
  }

  private manaMetricCardGroup(
    key: string,
    title: string,
    roleKeys: readonly string[],
    fallbackPredicate: (deckCard: DeckCard) => boolean,
  ): ManaCardGroup | null {
    const roleCards = this.roleCardItems(roleKeys);
    const cards = roleCards.length > 0
      ? roleCards
      : this.manaDeckCards()
        .filter(fallbackPredicate)
        .map((deckCard) => this.gridItemFromDeckCard(deckCard));

    return this.manaCardGroup(key, title, cards);
  }

  private manaCardGroup(
    key: string,
    title: string,
    cards: readonly AdvancedAnalysisCardGridItem[],
  ): ManaCardGroup | null {
    const deduplicated = this.deduplicateCardItems(cards);

    return deduplicated.length > 0
      ? { key, title, cards: deduplicated }
      : null;
  }

  private roleCardItems(keys: readonly string[]): AdvancedAnalysisCardGridItem[] {
    const roleCards = this.analysis()?.metrics?.roleCards;
    const references = keys.flatMap((key) => roleCards?.[key] ?? []);

    return this.cardReferenceItems(references);
  }

  private deduplicateCardItems(cards: readonly AdvancedAnalysisCardGridItem[]): AdvancedAnalysisCardGridItem[] {
    const byKey = new Map<string, AdvancedAnalysisCardGridItem>();
    for (const card of cards) {
      byKey.set(this.cardPreviewKey(card.id || card.name), card);
    }

    return [...byKey.values()];
  }

  private manaDeckCards(): DeckCard[] {
    return (this.deck()?.cards ?? [])
      .filter((deckCard) => deckCard.section === 'main' || deckCard.section === 'commander');
  }

  private fixingRoleKeys(key: string): readonly string[] {
    if (key === 'landRampFixing') {
      return ['rampSearch', 'landTutors'];
    }
    if (key === 'rainbowSources' || key === 'conditionalFixing') {
      return ['manaFixing'];
    }

    return [];
  }

  private cardMatchesRampMetric(card: Card, key: string): boolean {
    if (key === 'landRamp') {
      return this.cardOracleText(card).includes('search your library') && this.cardOracleText(card).includes('land');
    }
    if (key === 'manaRocks') {
      return this.cardHasType(card, 'artifact') && this.cardCanProduceMana(card);
    }
    if (key === 'manaDorks') {
      return this.cardHasType(card, 'creature') && this.cardCanProduceMana(card);
    }
    if (key === 'fastMana') {
      return this.cardCanProduceMana(card) && this.cardManaValue(card) <= 1;
    }
    if (key === 'temporaryMana') {
      return this.cardProducesTemporaryMana(card);
    }
    if (key === 'treasureSources') {
      return this.cardOracleText(card).includes('treasure');
    }
    if (key === 'costReducers') {
      const text = this.cardOracleText(card);
      return text.includes('cost') && (text.includes('less') || text.includes('reduce'));
    }

    return !this.cardIsLand(card) && this.cardCanProduceMana(card);
  }

  private cardMatchesFixingMetric(card: Card, key: string): boolean {
    if (key === 'fetchlands') {
      return this.cardMatchesLandCycle(card, 'fetchland');
    }
    if (key === 'landRampFixing') {
      return this.cardMatchesRampMetric(card, 'landRamp');
    }
    if (key === 'artifactFixing') {
      return this.cardHasType(card, 'artifact') && this.cardProducesMultipleColors(card);
    }
    if (key === 'creatureFixing') {
      return this.cardHasType(card, 'creature') && this.cardProducesMultipleColors(card);
    }
    if (key === 'conditionalFixing') {
      return this.cardOracleText(card).includes('mana of any color');
    }

    return this.cardProducesMultipleColors(card);
  }

  private cardMatchesLandCycle(card: Card, key: string): boolean {
    if (!this.cardIsLand(card)) {
      return false;
    }

    const name = card.name.toLowerCase();
    const text = this.cardOracleText(card);
    const basicLandTypeCount = this.basicLandTypeCount(card);

    if (key === 'fetchland') {
      return text.includes('search your library') && text.includes('sacrifice');
    }
    if (key === 'shockland') {
      return basicLandTypeCount >= 2 && text.includes('pay 2 life');
    }
    if (key === 'triome') {
      return basicLandTypeCount >= 3;
    }
    if (key === 'surveil_land') {
      return text.includes('surveil');
    }
    if (key === 'fastland') {
      return text.includes('two or fewer other lands');
    }
    if (key === 'slowland') {
      return text.includes('two or more other lands');
    }
    if (key === 'painland') {
      return text.includes('deals 1 damage to you');
    }
    if (key === 'checkland') {
      return text.includes('unless you control') && basicLandTypeCount < 3;
    }
    if (key === 'filterland') {
      return text.includes('one mana of any combination');
    }
    if (key === 'pathway') {
      return name.includes('pathway') || card.layout === 'modal_dfc';
    }
    if (key === 'battle_land') {
      return text.includes('unless you control two or more basic lands');
    }
    if (key === 'bond_land') {
      return text.includes('two or more opponents');
    }
    if (key === 'bounce_land') {
      return text.includes('return a land you control');
    }
    if (key === 'temple') {
      return name.startsWith('temple of ') || text.includes('scry 1');
    }
    if (key === 'gain_land') {
      return text.includes('gain 1 life');
    }
    if (key === 'colorless_utility_land') {
      return this.cardIsColorlessUtilityLand(card);
    }
    if (key === 'utility_land') {
      return this.cardIsLand(card) && !this.cardIsBasicLand(card);
    }

    return false;
  }

  private cardProducesMana(card: Card, symbol: string, colorKey: string): boolean {
    if (this.normalizedProducedMana(card).includes(symbol)) {
      return true;
    }

    if (colorKey === 'colorless' && this.normalizedProducedMana(card).includes('C')) {
      return true;
    }

    const text = this.cardOracleText(card);
    if (text.includes('mana of any color')) {
      return colorKey !== 'colorless';
    }

    return this.basicLandTypeForSymbol(symbol).some((landType) => this.cardTypeLine(card).includes(landType));
  }

  private cardFixesCommanderMana(card: Card, commanderIdentityColors: ReadonlySet<string>): boolean {
    if (commanderIdentityColors.size < 2 || !this.cardCanProduceMana(card)) {
      return false;
    }

    const producedIdentityColors = new Set(this.normalizedProducedMana(card)
      .map((symbol) => this.normalizeManaColorKey(symbol))
      .filter((key): key is string => key !== null && commanderIdentityColors.has(key)));

    return producedIdentityColors.size >= 2 || this.cardOracleText(card).includes('mana of any color');
  }

  private cardProducesMultipleColors(card: Card): boolean {
    const colors = this.normalizedProducedMana(card).filter((symbol) => symbol !== 'C');
    return new Set(colors).size >= 2 || this.cardOracleText(card).includes('mana of any color');
  }

  private cardProducesTemporaryMana(card: Card): boolean {
    const faces = card.cardFaces ?? [];
    if (faces.length > 0) {
      return faces.some((face) => this.cardFaceProducesTemporaryMana(face));
    }

    return !this.cardIsLand(card)
      && this.cardTypeIsInstantOrSorcery(card.typeLine)
      && this.oracleTextAddsMana(card.oracleText);
  }

  private cardFaceProducesTemporaryMana(face: CardFace): boolean {
    return this.cardTypeIsInstantOrSorcery(face.typeLine)
      && !this.cardTypeIncludesLand(face.typeLine)
      && this.oracleTextAddsMana(face.oracleText);
  }

  private cardTypeIsInstantOrSorcery(typeLine: string | null | undefined): boolean {
    const normalized = (typeLine ?? '').toLowerCase();

    return normalized.includes('instant') || normalized.includes('sorcery');
  }

  private cardTypeIncludesLand(typeLine: string | null | undefined): boolean {
    return (typeLine ?? '').toLowerCase().includes('land');
  }

  private oracleTextAddsMana(oracleText: string | null | undefined): boolean {
    return /\badd\b[\s\S]*(\{[wubrgc]\}|mana)/i.test(oracleText ?? '');
  }

  private cardCanProduceMana(card: Card): boolean {
    return this.normalizedProducedMana(card).length > 0 || this.cardOracleText(card).includes('add');
  }

  private cardIsLand(card: Card): boolean {
    return this.cardHasType(card, 'land');
  }

  private cardIsBasicLand(card: Card): boolean {
    return this.cardTypeLine(card).includes('basic land');
  }

  private cardHasBasicLandType(card: Card): boolean {
    return this.basicLandTypeCount(card) > 0;
  }

  private cardIsColorlessUtilityLand(card: Card): boolean {
    return this.cardIsLand(card)
      && !this.cardIsBasicLand(card)
      && this.normalizedProducedMana(card).includes('C')
      && this.normalizedProducedMana(card).every((symbol) => symbol === 'C');
  }

  private basicLandTypeCount(card: Card): number {
    const typeLine = this.cardTypeLine(card);
    return ['plains', 'island', 'swamp', 'mountain', 'forest']
      .filter((landType) => typeLine.includes(landType))
      .length;
  }

  private basicLandTypeForSymbol(symbol: string): readonly string[] {
    if (symbol === 'W') {
      return ['plains'];
    }
    if (symbol === 'U') {
      return ['island'];
    }
    if (symbol === 'B') {
      return ['swamp'];
    }
    if (symbol === 'R') {
      return ['mountain'];
    }
    if (symbol === 'G') {
      return ['forest'];
    }

    return [];
  }

  private cardHasType(card: Card, type: string): boolean {
    return this.cardTypeLine(card).includes(type);
  }

  private cardTypeLine(card: Card): string {
    return [
      card.typeLine,
      ...(card.cardFaces ?? []).map((face) => face.typeLine),
    ]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase();
  }

  private cardOracleText(card: Card): string {
    return [
      card.oracleText,
      ...(card.cardFaces ?? []).map((face) => face.oracleText),
    ]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase();
  }

  private cardManaValue(card: Card): number {
    return typeof card.manaValue === 'number' && Number.isFinite(card.manaValue)
      ? card.manaValue
      : Number.POSITIVE_INFINITY;
  }

  private averageMainDeckManaValue(): number | null {
    let totalManaValue = 0;
    let totalQuantity = 0;

    for (const deckCard of this.deck()?.cards ?? []) {
      const manaValue = deckCard.card.manaValue;
      if (deckCard.section !== 'main' || this.cardIsLand(deckCard.card) || typeof manaValue !== 'number' || !Number.isFinite(manaValue)) {
        continue;
      }

      const quantity = Math.max(1, deckCard.quantity);
      totalManaValue += manaValue * quantity;
      totalQuantity += quantity;
    }

    return totalQuantity > 0 ? totalManaValue / totalQuantity : null;
  }

  private normalizedProducedMana(card: Card): string[] {
    const normalized = (card.producedMana ?? [])
      .map((symbol) => symbol.trim().toUpperCase())
      .map((symbol) => {
        if (symbol === 'WHITE') {
          return 'W';
        }
        if (symbol === 'BLUE') {
          return 'U';
        }
        if (symbol === 'BLACK') {
          return 'B';
        }
        if (symbol === 'RED') {
          return 'R';
        }
        if (symbol === 'GREEN') {
          return 'G';
        }
        if (symbol === 'COLORLESS') {
          return 'C';
        }

        return symbol;
      })
      .filter((symbol) => ['W', 'U', 'B', 'R', 'G', 'C'].includes(symbol));

    return [...new Set(normalized)];
  }

  private commanderIdentityColorKeys(): ReadonlySet<string> {
    const analyzedCommanderColors = Object.keys(this.manaMetrics()?.requirements?.commanderCastability ?? {})
      .map((key) => this.normalizeManaColorKey(key))
      .filter((key): key is string => key !== null && key !== 'colorless');

    if (analyzedCommanderColors.length > 0) {
      return new Set(analyzedCommanderColors);
    }

    const deck = this.deck();
    const commanderColors = [
      ...(deck?.commanders ?? []).flatMap((card) => card.colorIdentity),
      ...(deck?.cards ?? [])
        .filter((deckCard) => deckCard.section === 'commander')
        .flatMap((deckCard) => deckCard.card.colorIdentity),
    ]
      .map((key) => this.normalizeManaColorKey(key))
      .filter((key): key is string => key !== null && key !== 'colorless');

    return new Set(commanderColors);
  }

  private manaSourceColorIsInIdentity(colorKey: string, commanderIdentityColors: ReadonlySet<string>): boolean {
    if (colorKey === 'colorless') {
      return true;
    }

    return commanderIdentityColors.has(colorKey);
  }

  private normalizeManaColorKey(value: string): string | null {
    const normalized = value.trim().toLowerCase();
    const row = MANA_COLOR_ROWS.find(([key, symbol]) => key === normalized || symbol.toLowerCase() === normalized);

    return row?.[0] ?? null;
  }

  private formatRoleMetric(key: string): string {
    return this.formatNumber(this.analysis()?.metrics?.roles?.[key]);
  }

  private numberFromRecord(record: Record<string, unknown> | null | undefined, key: string): number | null {
    const value = record?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private recordFromRecord(record: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
    const value = record?.[key];
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
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
        manaSymbols: this.manaSymbolsForColor(key),
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

  private colorCountSymbolItems(record: Record<string, unknown> | null | undefined): ManaSymbolStatItem[] {
    if (!record) {
      return [];
    }

    return MANA_COLOR_ROWS
      .flatMap(([key, symbol]) => {
        const value = this.numberFromRecord(record, key);
        return value !== null && value > 0
          ? [{ key, symbols: [symbol], value: this.formatNumber(value), label: this.colorLabel(key) }]
          : [];
      });
  }

  private colorLabel(color: string): string {
    const normalized = color.trim().toLowerCase();
    const row = MANA_COLOR_ROWS.find(([key, symbol]) => key === normalized || symbol.toLowerCase() === normalized);

    return row ? this.translateKey(row[2]) : this.formatTitleText(color);
  }

  private manaSymbolsForColor(color: string): readonly string[] {
    const normalized = color.trim().toLowerCase();
    const row = MANA_COLOR_ROWS.find(([key, symbol]) => key === normalized || symbol.toLowerCase() === normalized);

    return row ? [row[1]] : [];
  }

  private commanderColorStatus(color: string): string {
    const status = this.manaMetrics()?.requirements?.commanderCastability?.[color]?.status;

    return status ? this.formatStatus(status) : this.t('common.notAvailable');
  }

  private formatCommanderCastabilitySummary(mana: AdvancedManaMetrics | null): string {
    const entries = Object.values(mana?.requirements?.commanderCastability ?? {});
    if (entries.length === 0) {
      const healthValue = this.healthEntry('mana')?.evidence?.['commanderCastability'];
      return typeof healthValue === 'string' ? this.formatStatus(healthValue) : this.t('common.notAvailable');
    }

    const worst = entries
      .map((entry) => this.normalizeHealthStatus(entry.status))
      .sort((left, right) => this.healthStatusRank(right) - this.healthStatusRank(left))[0];

    return this.formatStatus(worst);
  }

  private formatColoredSourceHealth(mana: AdvancedManaMetrics | null): string {
    const entries = Object.values(mana?.requirements?.commanderCastability ?? {});
    if (entries.length === 0) {
      return this.t('common.notAvailable');
    }

    const worst = entries
      .map((entry) => this.normalizeHealthStatus(entry.status))
      .sort((left, right) => this.healthStatusRank(right) - this.healthStatusRank(left))[0];

    return this.formatStatus(worst);
  }

  private hasManaSourceColor(mana: AdvancedManaMetrics | null, color: string): boolean {
    if (!mana) {
      return true;
    }

    return Object.prototype.hasOwnProperty.call(mana.sources ?? {}, color)
      || Object.prototype.hasOwnProperty.call(mana.untappedSources ?? {}, color)
      || Object.prototype.hasOwnProperty.call(mana.earlySources?.turn3 ?? {}, color);
  }

  private healthStatusRank(status: AdvancedHealthStatus): number {
    if (status === 'critical') {
      return 4;
    }
    if (status === 'warning') {
      return 3;
    }
    if (status === 'unknown') {
      return 2;
    }
    if (status === 'good') {
      return 1;
    }

    return 0;
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
      const presentCards = this.comboCards(item).map((card) => this.comboCardWithState(card, 'present'));
      const missingCards = this.comboMissingCards(item).map((card) => this.comboCardWithState(card, 'missing'));

      return {
        id: item.comboVariantId ?? item.externalId ?? String(index),
        title: this.comboTitle(item, index),
        cards: this.mergeComboCards(presentCards, missingCards),
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

  private comboCardWithState(card: ComboCardPreviewItem, state: 'present' | 'missing'): ComboCardPreviewItem {
    return {
      ...card,
      state,
      stateLabel: this.t(state === 'present' ? 'combos.cardState.inDeck' : 'combos.cardState.missing'),
    };
  }

  private mergeComboCards(presentCards: ComboCardPreviewItem[], missingCards: ComboCardPreviewItem[]): ComboCardPreviewItem[] {
    const byCard = new Map<string, ComboCardPreviewItem>();

    for (const card of [...missingCards, ...presentCards]) {
      byCard.set(this.comboCardDeduplicationKey(card), card);
    }

    return [...presentCards, ...missingCards]
      .map((card) => byCard.get(this.comboCardDeduplicationKey(card)))
      .filter((card, index, cards): card is ComboCardPreviewItem => card !== undefined && cards.indexOf(card) === index);
  }

  private comboCardDeduplicationKey(card: ComboCardPreviewItem): string {
    return this.cardPreviewKey(card.name || card.id);
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
        imageSource: this.cardImageSource(name, null),
      }));
  }

  private comboCardItem(reference: AdvancedCardReference): ComboCardPreviewItem | null {
    const normalized = this.normalizeCardReference(reference);
    const resolved = this.resolveCardReference(normalized);
    const name = resolved?.name ?? this.displayCardName(normalized.name);
    const id = normalized.id?.trim()
      || normalized.deckCardId?.trim()
      || normalized.oracleId?.trim()
      || resolved?.id
      || this.cardPreviewKey(name);

    if (name === this.t('common.unavailable') && !normalized.imageUrl && !resolved?.imageUrl) {
      return null;
    }

    return {
      id,
      scryfallId: resolved?.scryfallId ?? normalized.scryfallId ?? null,
      name,
      imageUrl: resolved?.imageUrl ?? normalized.imageUrl?.trim() ?? null,
      imageSource: resolved?.imageSource ?? this.cardImageSource(name, normalized),
      layout: resolved?.layout ?? null,
      quantity: normalized.quantity ?? resolved?.quantity ?? null,
    };
  }

  private cardReferenceItems(references: readonly AdvancedCardReference[] | undefined): ComboCardPreviewItem[] {
    return (references ?? [])
      .map((reference) => this.comboCardItem(reference))
      .filter((item): item is ComboCardPreviewItem => item !== null);
  }

  private boardWipeStatGroup(
    key: string,
    title: string,
    metrics: AdvancedBoardWipeMetrics,
    rows: ReadonlyArray<readonly [keyof AdvancedBoardWipeMetrics, string]>,
    hideZero: boolean,
  ): BoardWipeStatGroup {
    return {
      key,
      title,
      rows: rows
        .map(([metricKey, label]) => {
          const value = metrics[metricKey];
          const numericValue = typeof value === 'number' ? value : null;

          return {
            label: this.translateKey(label),
            value: metricKey === 'averageManaValue'
              ? this.formatCompactNumber(numericValue)
              : this.formatNumber(numericValue),
          };
        })
        .filter((row) => !hideZero || (row.value !== this.t('common.unavailable') && row.value !== '0')),
    };
  }

  private boardWipeIssueItem(issue: AdvancedIssue): AdvancedIssueItem {
    const code = issue.code ?? 'board_wipe_issue';

    return {
      code,
      title: this.boardWipeIssueText(code, 'title', issue.title),
      message: this.boardWipeIssueText(code, 'message', issue.message),
      severity: this.formatIssueSeverity(issue.severity),
    };
  }

  private boardWipeIssueText(code: string, field: 'title' | 'message', fallback: string | undefined): string {
    const key = `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.issues.${code}.${field}`;
    const translated = this.translations.instant(key);
    if (typeof translated === 'string' && translated !== key) {
      return translated;
    }

    return this.formatText(fallback ?? code);
  }

  private boardWipeDetailItem(detail: AdvancedBoardWipeDetail, index: number): BoardWipeDetailItem | null {
    const card = this.comboCardItem(detail);
    if (!card) {
      return null;
    }

    return {
      ...card,
      id: card.id || detail.cardId || detail.oracleId || String(index),
      badges: this.boardWipeBadges(detail),
      manaValue: this.formatCompactNumber(detail.manaValue),
      notes: (detail.notes ?? []).map((note) => this.boardWipeNoteLabel(note)).filter((note) => note !== ''),
    };
  }

  private boardWipeBadges(detail: AdvancedBoardWipeDetail): string[] {
    const badges: string[] = [];
    const methods = new Set((detail.methods ?? []).map((method) => method.trim().toLowerCase()));
    if (detail.isHardWipe) {
      badges.push(this.t('boardWipes.badges.hard'));
    }
    if (detail.isPseudoWipe) {
      badges.push(this.t('boardWipes.badges.pseudo'));
    }
    if (detail.isModal) {
      badges.push(this.t('boardWipes.badges.modal'));
    }
    if (detail.isOverloaded) {
      badges.push(this.t('boardWipes.badges.overload'));
    }
    if (['asymmetrical', 'one_sided', 'opponent_only', 'each_opponent'].includes((detail.symmetry ?? '').trim().toLowerCase())) {
      badges.push(this.t('boardWipes.badges.asymmetric'));
    }
    if (methods.has('exile')) {
      badges.push(this.t('boardWipes.badges.exile'));
    }
    if (methods.has('bounce')) {
      badges.push(this.t('boardWipes.badges.bounce'));
    }
    if (methods.has('damage')) {
      badges.push(this.t('boardWipes.badges.damage'));
    }
    if (methods.has('tuck') || methods.has('shuffle')) {
      badges.push(this.t('boardWipes.badges.tuckShuffle'));
    }
    if (detail.answersIndestructible) {
      badges.push(this.t('boardWipes.badges.answersIndestructible'));
    }
    if ((detail.scope ?? []).includes('artifacts')) {
      badges.push(this.t('boardWipes.badges.artifactWipe'));
    }
    if ((detail.scope ?? []).includes('enchantments')) {
      badges.push(this.t('boardWipes.badges.enchantmentWipe'));
    }

    return [...new Set(badges)];
  }

  private boardWipeNoteLabel(note: string): string {
    const normalized = note.trim();
    if (normalized === '') {
      return '';
    }

    const key = `${ADVANCED_ANALYSIS_I18N_PREFIX}.boardWipes.notes.${normalized}`;
    const translated = this.translations.instant(key);
    if (typeof translated === 'string' && translated !== key) {
      return translated;
    }

    return this.formatFeatureLabel(normalized);
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

  private toTitleCase(value: string): string {
    return value
      .split(' ')
      .map((word) => word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word)
      .join(' ');
  }

  private comboCompleterItem(item: AdvancedTopComboCompleter): ComboCompleterItem {
    const resolved = this.resolveCardReference(item);
    const name = resolved?.name ?? this.displayCardName(item.name);

    return {
      id: resolved?.id ?? item.oracleId ?? item.name ?? 'combo-completer',
      scryfallId: resolved?.scryfallId ?? item.scryfallId ?? null,
      name,
      imageUrl: resolved?.imageUrl ?? item.imageUrl?.trim() ?? null,
      imageSource: resolved?.imageSource ?? this.cardImageSource(name, item),
      completesCombos: this.formatNumber(item.completesCombos),
    };
  }

  private resolveCardReference(reference: AdvancedCardReference | ManaCardImageReference | null | undefined): AdvancedAnalysisCardGridItem | null {
    if (!reference) {
      return null;
    }

    const normalized = this.normalizeCardReference(reference);
    const deckCard = this.deckCardForReference(normalized);
    if (deckCard) {
      return this.gridItemFromDeckCard(deckCard);
    }

    const catalogKey = normalized.oracleId ?? normalized.id ?? null;
    const catalogEntry = catalogKey ? this.analysis()?.cardCatalog?.[catalogKey] : null;
    if (catalogEntry) {
      return this.gridItemFromCatalogEntry(catalogEntry, normalized);
    }

    if (normalized.name || normalized.imageUrl || normalized.imageUris || normalized.cardFaces) {
      const name = this.displayCardName(normalized.name);

      return {
        id: normalized.id ?? normalized.oracleId ?? normalized.scryfallId ?? this.cardPreviewKey(name),
        scryfallId: normalized.scryfallId ?? null,
        name,
        imageUrl: normalized.imageUrl?.trim() || null,
        imageSource: this.cardImageSource(name, normalized),
        layout: null,
        quantity: normalized.quantity ?? null,
      };
    }

    return null;
  }

  private deckCardForReference(reference: NormalizedCardReference): DeckCard | null {
    const id = reference.id?.trim();
    if (id) {
      const deckCard = this.deckCardsByDeckCardId().get(id) ?? this.deckCardsByOracleId().get(id);
      if (deckCard) {
        return deckCard;
      }
    }

    const deckCardId = reference.deckCardId?.trim();
    if (deckCardId) {
      const deckCard = this.deckCardsByDeckCardId().get(deckCardId);
      if (deckCard) {
        return deckCard;
      }
    }

    const oracleId = reference.oracleId?.trim();
    return oracleId ? this.deckCardsByOracleId().get(oracleId) ?? null : null;
  }

  private deckCardLookup(kind: 'deckCardId' | 'oracleId'): Map<string, DeckCard> {
    const lookup = new Map<string, DeckCard>();
    for (const deckCard of this.deck()?.cards ?? []) {
      const key = kind === 'deckCardId' ? deckCard.id : deckCard.card.oracleId;
      if (typeof key === 'string' && key.trim()) {
        lookup.set(key, deckCard);
      }
    }

    return lookup;
  }

  private gridItemFromDeckCard(deckCard: DeckCard): AdvancedAnalysisCardGridItem {
    const card = deckCard.card;

    return {
      id: deckCard.id,
      scryfallId: card.scryfallId,
      name: card.name,
      imageUrl: bestCardImage(card),
      imageSource: this.cardImageSource(card.name, card),
      layout: card.layout,
      quantity: deckCard.quantity,
    };
  }

  private gridItemFromCatalogEntry(entry: AdvancedCardCatalogEntry, reference: ManaCardImageReference): AdvancedAnalysisCardGridItem {
    return {
      id: reference.oracleId ?? entry.oracleId,
      scryfallId: reference.scryfallId ?? null,
      name: entry.name,
      imageUrl: entry.imageUrl?.trim() || null,
      imageSource: this.cardImageSource(entry.name, entry),
      layout: null,
      quantity: reference.quantity ?? null,
    };
  }

  private normalizeCardReference(reference: AdvancedCardReference | ManaCardImageReference): NormalizedCardReference {
    if (typeof reference === 'string') {
      const id = reference.trim();

      return { id: id || null, oracleId: id || undefined };
    }

    return reference;
  }

  private cardImageSource(name: string, reference: ManaCardImageReference | null): CardFaceImageSource {
    const imageUrl = reference?.imageUrl?.trim() || null;
    const imageUris = reference?.imageUris && Object.keys(reference.imageUris).length > 0
      ? reference.imageUris
      : (imageUrl ? { normal: imageUrl } : null);
    const cardFaces = reference?.cardFaces && reference.cardFaces.length > 0 ? reference.cardFaces : null;

    return {
      name,
      imageUris,
      cardFaces,
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
      id: card.deckCardId ?? card.name ?? String(index),
      name: `${quantity}${this.formatText(card.name)}`,
      detail: `${section}${reason}`.replace(/^ · /, '') || this.t('cardResolution.cardCouldNotBeMatched'),
    };
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
