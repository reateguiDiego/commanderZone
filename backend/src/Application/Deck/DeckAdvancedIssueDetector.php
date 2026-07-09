<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;

final class DeckAdvancedIssueDetector
{
    private const FALLBACK_MINIMUMS = [
        'ramp' => 8,
        'draw' => 8,
        'board_wipe' => 2,
        'sacrifice_outlet' => 3,
        'wincon' => 2,
    ];

    public function __construct(private readonly ?Connection $connection = null)
    {
    }

    /**
     * @param array{roles:array<string,int>} $metrics
     * @param array<string,mixed> $combos
     * @param array{primary:string,secondary:list<string>,confidence:string} $archetypes
     * @param array{band:string,signals:array<string,int>} $power
     * @param array<string,mixed> $consistency
     * @param list<array{quantity:int}> $unmatchedCards
     * @param array{detected?:bool,primaryType?:?string,confidence?:string,creatureCount?:int,supportCount?:int,commanderMatches?:bool,types?:list<array{type:string,creatureCount:int,supportCount:int}>} $typal
     * @return list<array{code:string,severity:string,title:string,message:string,evidence:array<string,mixed>,suggestedActionType:string}>
     */
    public function detect(array $metrics, array $combos, array $archetypes, array $power, array $consistency, array $unmatchedCards, array $typal = []): array
    {
        $roles = $metrics['roles'];
        $rules = $this->genericRules();
        $issues = [];

        $this->rampIssues($issues, $roles, $rules, $metrics);
        $this->drawIssues($issues, $roles, $rules);
        $this->tutorIssues($issues, $roles, $archetypes, $power);
        $this->manaIssues($issues, $metrics);
        $this->wipeIssues($issues, $roles, $rules, $metrics, $archetypes, $power);
        $this->sacrificeIssues($issues, $roles, $archetypes);
        $this->comboIssues($issues, $roles, $combos);
        $this->winconIssues($issues, $roles, $combos);
        $this->staxIssues($issues, $roles);
        $this->typalIssues($issues, $typal);
        $this->powerIssues($issues, $power);
        $this->consistencyIssues($issues, $consistency, $archetypes, $power);
        $this->unmatchedIssues($issues, $unmatchedCards);

        return $issues;
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array<string,int> $roles
     * @param array<string,int> $rules
     */
    private function rampIssues(array &$issues, array $roles, array $rules, array $metrics): void
    {
        $minimum = $rules['ramp'] ?? self::FALLBACK_MINIMUMS['ramp'];
        if (($roles['permanentRamp'] ?? 0) < $minimum) {
            $issues[] = $this->issue('low_permanent_ramp', 'warning', 'Low permanent ramp', sprintf('Permanent ramp is below the Commander baseline (%d detected, %d recommended).', $roles['permanentRamp'] ?? 0, $minimum), [
                'permanentRamp' => $roles['permanentRamp'] ?? 0,
                'minRecommended' => $minimum,
            ], 'add_role');
        }

        $oneShot = ($roles['oneShotMana'] ?? 0) + ($roles['burstMana'] ?? 0) + ($roles['rituals'] ?? 0);
        if ($oneShot >= 4 && $oneShot > max(1, ($roles['permanentRamp'] ?? 0) * 2)) {
            $issues[] = $this->issue('ramp_is_mostly_one_shot', 'warning', 'Ramp is mostly one-shot mana', 'The ramp package leans on burst or ritual effects more than repeatable permanent ramp.', [
                'permanentRamp' => $roles['permanentRamp'] ?? 0,
                'oneShotManaSignals' => $oneShot,
            ], 'review_role_mix');
        }
        if (($roles['rituals'] ?? 0) >= 4 && $oneShot > max(1, ($roles['permanentRamp'] ?? 0))) {
            $issues[] = $this->issue('rituals_not_stable_ramp', 'warning', 'Rituals are not stable ramp', 'Ritual and burst mana can enable explosive turns, but they do not replace repeatable mana development.', [
                'rituals' => $roles['rituals'] ?? 0,
                'burstMana' => $roles['burstMana'] ?? 0,
                'permanentRamp' => $roles['permanentRamp'] ?? 0,
            ], 'replace_rituals_with_permanent_ramp');
        }
        if (($roles['costReducers'] ?? 0) >= 4) {
            $issues[] = $this->issue('cost_reducers_not_mana_sources', 'info', 'Cost reducers are not mana sources', 'Cost reducers can improve spell efficiency, but they should not be counted as stable mana sources.', [
                'costReducers' => $roles['costReducers'] ?? 0,
                'permanentRamp' => $roles['permanentRamp'] ?? 0,
                'minRecommendedRamp' => $minimum,
            ], 'add_permanent_ramp');
        }

        $mana = $this->arrayValue($metrics['mana'] ?? []);
        $fixing = $this->arrayValue($mana['fixing'] ?? []);
        $landRamp = (int) ($roles['landRamp'] ?? 0);
        if (($roles['permanentRamp'] ?? 0) >= $minimum && $landRamp > 0 && (int) ($fixing['landRampFixing'] ?? 0) === 0) {
            $issues[] = $this->issue('ramp_does_not_fix_colors', 'info', 'Ramp does not fix colors', 'The ramp package develops mana, but current mana analysis does not see land-ramp color fixing.', [
                'permanentRamp' => $roles['permanentRamp'] ?? 0,
                'landRamp' => $landRamp,
                'landRampFixing' => $fixing['landRampFixing'] ?? 0,
            ], 'add_land_ramp_that_fixes');
        }
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array<string,int> $roles
     * @param array<string,int> $rules
     */
    private function drawIssues(array &$issues, array $roles, array $rules): void
    {
        $minimum = $rules['draw'] ?? self::FALLBACK_MINIMUMS['draw'];
        if (($roles['draw'] ?? 0) < $minimum) {
            $issues[] = $this->issue('low_draw', 'warning', 'Low card draw', sprintf('Card draw is below the Commander baseline (%d detected, %d recommended).', $roles['draw'] ?? 0, $minimum), [
                'draw' => $roles['draw'] ?? 0,
                'minRecommended' => $minimum,
            ], 'add_role');
        }
        if (($roles['cardSelection'] ?? 0) < 2) {
            $issues[] = $this->issue('low_card_selection', 'info', 'Low card selection', 'The deck has little card selection to smooth early and midgame draws.', [
                'cardSelection' => $roles['cardSelection'] ?? 0,
            ], 'add_role');
        }
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array<string,int> $roles
     * @param array{primary:string,secondary:list<string>} $archetypes
     * @param array{band:string} $power
     */
    private function tutorIssues(array &$issues, array $roles, array $archetypes, array $power): void
    {
        $comboOrHighPower = $archetypes['primary'] === 'combo' || in_array($power['band'], ['high_power', 'cedh_like'], true);
        $strategicTutors = ($roles['trueTutors'] ?? 0) + ($roles['typedTutors'] ?? 0);
        if ($comboOrHighPower && $strategicTutors < 3) {
            $issues[] = $this->issue('low_true_tutors_for_combo', 'warning', 'Low true tutor density', 'The plan has combo or high-power signals, but true tutors are low.', [
                'trueTutors' => $roles['trueTutors'] ?? 0,
                'typedTutors' => $roles['typedTutors'] ?? 0,
                'strategicTutors' => $strategicTutors,
                'primaryArchetype' => $archetypes['primary'],
            ], 'add_role');
        }
        if (($roles['rampSearch'] ?? 0) >= 4 && ($roles['trueTutors'] ?? 0) <= 1) {
            $issues[] = $this->issue('tutor_count_inflated_by_ramp_search', 'info', 'Tutor count is mostly ramp search', 'Several search effects find lands or ramp, but they should not be treated like true tutors.', [
                'rampSearch' => $roles['rampSearch'] ?? 0,
                'trueTutors' => $roles['trueTutors'] ?? 0,
            ], 'review_role_mix');
        }
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array<string,mixed> $metrics
     */
    private function manaIssues(array &$issues, array $metrics): void
    {
        $mana = $this->arrayValue($metrics['mana'] ?? []);
        if ($mana === []) {
            return;
        }

        $fetchlands = $this->arrayValue($mana['fetchlands'] ?? []);
        if ((int) ($fetchlands['deadFetchlands'] ?? 0) > 0) {
            $deadFetchlands = (int) ($fetchlands['deadFetchlands'] ?? 0);
            $fetchCount = max(1, (int) ($fetchlands['count'] ?? 0));
            $issues[] = $this->issue('fetchlands_without_targets', $deadFetchlands >= $fetchCount ? 'critical' : 'warning', 'Fetchlands without valid targets', 'Mana analysis found fetchlands that do not have valid fetch targets in the deck.', [
                'deadFetchlands' => (int) ($fetchlands['deadFetchlands'] ?? 0),
                'fetchlands' => (int) ($fetchlands['count'] ?? 0),
                'recommendedAction' => 'add_fetchable_targets',
            ], 'add_fetchable_targets');
        }

        $this->coloredSourceIssues($issues, $mana);
        $this->fetchTargetIssues($issues, $mana);

        $cycle = $this->arrayValue($mana['landCycleAnalysis'] ?? []);
        if (($cycle['tappedLandPressure'] ?? 'unknown') === 'critical') {
            $issues[] = $this->issue('too_many_tapped_lands', 'warning', 'Too many tapped lands', 'Mana analysis sees high tapped-land pressure, which can slow early development.', [
                'tappedLandPressure' => $cycle['tappedLandPressure'],
                'tappedLands' => $this->arrayValue($mana['lands'] ?? [])['tappedLands'] ?? null,
                'conditionallyTappedLands' => $this->arrayValue($mana['lands'] ?? [])['conditionallyTappedLands'] ?? null,
            ], 'reduce_tapped_lands');
        }

        if (in_array($cycle['colorlessUtilityPressure'] ?? 'unknown', ['warning', 'critical'], true)) {
            $issues[] = $this->issue('colorless_land_pressure', 'warning', 'Colorless utility land pressure', 'Mana analysis sees enough colorless utility lands to pressure colored source counts.', [
                'colorlessUtilityPressure' => $cycle['colorlessUtilityPressure'],
                'colorlessUtilityLands' => $this->arrayValue($mana['lands'] ?? [])['colorlessUtilityLands'] ?? null,
            ], 'reduce_colorless_utility_lands');
        }

        foreach ([
            'checklandSupport' => ['typed_land_density_low_for_checklands', 'Typed land density is low for checklands', 'Mana analysis sees checklands without enough typed/basic land support.', 'improve_checkland_support'],
            'filterlandInputPressure' => ['filterlands_need_input_sources', 'Filterlands need input sources', 'Mana analysis sees filterlands that may not provide independent colored access early.', 'reduce_unsupported_filterlands'],
            'pathwayColorChoicePressure' => ['pathways_create_color_choice_pressure', 'Pathways create color choice pressure', 'Mana analysis sees pathway density that can force mutually exclusive early color choices.', 'reduce_pathway_color_pressure'],
            'bounceLandTempoPressure' => ['bounce_lands_tempo_risk', 'Bounce lands create tempo risk', 'Mana analysis sees bounce lands that can slow early land development.', 'reduce_bounce_lands'],
        ] as $key => [$code, $title, $message, $action]) {
            if (in_array($cycle[$key] ?? 'unknown', ['warning', 'critical'], true)) {
                $issues[] = $this->issue($code, 'warning', $title, $message, [$key => $cycle[$key]], $action);
                if ($key === 'checklandSupport') {
                    $issues[] = $this->issue('checklands_not_supported', 'warning', 'Checklands are not supported', 'Checklands probably enter tapped too often because typed/basic land support is low.', [$key => $cycle[$key]], 'improve_checkland_support');
                }
            }
        }

        $landCycles = $this->arrayValue($mana['landCycles'] ?? []);
        $painlands = (int) ($landCycles['painland'] ?? 0);
        if ($painlands >= 6) {
            $issues[] = $this->issue('painland_life_pressure', 'info', 'Painland life pressure', 'Painlands are usually acceptable in Commander, but a high count can add up with other life costs.', [
                'painlands' => $painlands,
            ], 'review_painland_life_pressure');
        }
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array<string,mixed> $mana
     */
    private function coloredSourceIssues(array &$issues, array $mana): void
    {
        $sources = $this->arrayValue($mana['sources'] ?? []);
        $earlySources = $this->arrayValue($this->arrayValue($mana['earlySources'] ?? [])['turn2'] ?? []);
        $requirements = $this->arrayValue($mana['requirements'] ?? []);
        $pipDemand = $this->arrayValue($requirements['pipDemand'] ?? []);
        $earlyPipDemand = $this->arrayValue($requirements['earlyPipDemand'] ?? []);
        $commanderCastability = $this->arrayValue($requirements['commanderCastability'] ?? []);
        $primaryColor = null;
        $primaryDemand = 0;

        foreach ($pipDemand as $color => $demand) {
            if (!is_string($color) || !is_numeric($demand) || !array_key_exists($color, $sources)) {
                continue;
            }
            $demand = (int) $demand;
            if ($demand > $primaryDemand) {
                $primaryDemand = $demand;
                $primaryColor = $color;
            }
            $sourceCount = (int) ($sources[$color] ?? 0);
            $recommended = $this->recommendedSourcesForDemand($demand, (int) ($earlyPipDemand[$color] ?? 0));
            if ($demand > 0 && $sourceCount < $recommended) {
                $issues[] = $this->issue('low_colored_sources', $sourceCount < max(6, (int) floor($recommended * 0.65)) ? 'critical' : 'warning', 'Low colored sources', sprintf('The deck has low %s source density for its pip demand.', $color), [
                    'color' => $color,
                    'sourceCount' => $sourceCount,
                    'pipDemand' => $demand,
                    'earlyPipDemand' => (int) ($earlyPipDemand[$color] ?? 0),
                    'recommendedSources' => $recommended,
                    'recommendedAction' => 'add_'.$color.'_sources',
                ], 'add_colored_sources');
            }
            if ((int) ($earlyPipDemand[$color] ?? 0) > 0 && (int) ($earlySources[$color] ?? 0) < min(8, max(4, (int) ceil((int) ($earlyPipDemand[$color] ?? 0) / 2)))) {
                $issues[] = $this->issue('low_early_color_access', 'warning', 'Low early color access', sprintf('Early cards require %s, but turn-two source access looks low.', $color), [
                    'color' => $color,
                    'earlySourceCount' => (int) ($earlySources[$color] ?? 0),
                    'earlyPipDemand' => (int) ($earlyPipDemand[$color] ?? 0),
                ], 'add_untapped_sources');
            }
        }

        if ($primaryColor !== null && (int) ($sources[$primaryColor] ?? 0) < $this->recommendedSourcesForDemand($primaryDemand, (int) ($earlyPipDemand[$primaryColor] ?? 0))) {
            $issues[] = $this->issue('weak_primary_color_sources', 'warning', 'Weak primary color sources', 'The deck primary color has fewer sources than its pip demand suggests.', [
                'color' => $primaryColor,
                'sourceCount' => (int) ($sources[$primaryColor] ?? 0),
                'pipDemand' => $primaryDemand,
                'earlyPipDemand' => (int) ($earlyPipDemand[$primaryColor] ?? 0),
            ], 'add_colored_sources');
        }

        foreach ($commanderCastability as $color => $castability) {
            if (!is_array($castability)) {
                continue;
            }
            $status = (string) ($castability['status'] ?? 'unknown');
            if (!in_array($status, ['warning', 'critical'], true)) {
                continue;
            }
            $severity = $status === 'critical' ? 'critical' : 'warning';
            $issues[] = $this->issue('commander_color_bottleneck', $severity, 'Commander color bottleneck', sprintf('Commander castability is constrained by %s sources.', $color), [
                'color' => $color,
                'requiredPips' => (int) ($castability['requiredPips'] ?? 0),
                'sourceCount' => (int) ($castability['sourceCount'] ?? 0),
                'earlySourceCount' => (int) ($castability['earlySourceCount'] ?? 0),
                'status' => $status,
            ], 'add_commander_color_sources');
        }
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array<string,mixed> $mana
     */
    private function fetchTargetIssues(array &$issues, array $mana): void
    {
        $fetchlands = $this->arrayValue($mana['fetchlands'] ?? []);
        $fetchCount = (int) ($fetchlands['count'] ?? 0);
        if ($fetchCount <= 0) {
            return;
        }

        $effective = $this->arrayValue($fetchlands['effectiveColorSources'] ?? []);
        $untapped = $this->arrayValue($fetchlands['untappedEffectiveColorSources'] ?? []);
        $tappedOnly = $this->arrayValue($fetchlands['tappedOnlyEffectiveColorSources'] ?? []);
        foreach ($effective as $color => $count) {
            if (!is_numeric($count) || (int) $count <= 0) {
                continue;
            }
            $tapped = (int) ($tappedOnly[$color] ?? 0);
            $untappedCount = (int) ($untapped[$color] ?? 0);
            if ($tapped > 0 && $untappedCount === 0) {
                $issues[] = $this->issue('fetchlands_mostly_tapped_targets', 'warning', 'Fetchlands mostly find tapped targets', sprintf('Fetchlands find %s, but only through tapped targets.', $color), [
                    'color' => $color,
                    'fetchlands' => $fetchCount,
                    'effectiveColorSources' => (int) $count,
                    'untappedEffectiveColorSources' => $untappedCount,
                    'tappedOnlyEffectiveColorSources' => $tapped,
                ], 'improve_fetch_targets');
            }
        }

        $cycle = $this->arrayValue($mana['landCycleAnalysis'] ?? []);
        if (($cycle['fetchSynergyScore'] ?? 'unknown') === 'warning' && (float) ($cycle['typedLandDensity'] ?? 0.0) < 0.25) {
            $issues[] = $this->issue('typed_land_density_low_for_fetches', 'warning', 'Typed land density is low for fetches', 'Fetchlands are present, but typed fetchable target density looks low.', [
                'fetchlands' => $fetchCount,
                'typedLandDensity' => (float) ($cycle['typedLandDensity'] ?? 0.0),
                'fetchSynergyScore' => $cycle['fetchSynergyScore'] ?? 'unknown',
            ], 'add_fetchable_targets');
        }
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array<string,int> $roles
     * @param array<string,int> $rules
     * @param array{primary:string,secondary:list<string>} $archetypes
     * @param array{band:string} $power
     */
    private function wipeIssues(array &$issues, array $roles, array $rules, array $metrics, array $archetypes, array $power): void
    {
        $boardWipes = $this->arrayValue($metrics['boardWipes'] ?? []);
        $hardWipes = $boardWipes === [] ? ($roles['boardWipes'] ?? 0) : (int) ($boardWipes['hardTotal'] ?? 0);
        $hardCreatureWipes = $boardWipes === [] ? ($roles['boardWipes'] ?? 0) : (int) ($boardWipes['hardCreatureWipes'] ?? 0);
        $minimum = $rules['board_wipe'] ?? self::FALLBACK_MINIMUMS['board_wipe'];
        if ($hardWipes < $minimum) {
            $severity = $hardWipes === 0 && $this->wantsHardBoardWipes($archetypes, $power) ? 'critical' : 'warning';
            $issues[] = $this->issue('low_hard_board_wipes', $severity, 'Few hard board wipes', sprintf('Hard board wipes are below the baseline (%d detected, %d recommended).', $hardWipes, $minimum), [
                'boardWipes' => $hardWipes,
                'hardCreatureWipes' => $hardCreatureWipes,
                'minRecommended' => $minimum,
                'primaryArchetype' => $archetypes['primary'],
                'powerBand' => $power['band'],
            ], 'add_hard_creature_wipe');
        }

        $softWipes = $boardWipes === []
            ? ($roles['massBounce'] ?? 0) + ($roles['pseudoWipes'] ?? 0) + ($roles['conditionalWipes'] ?? 0)
            : (int) ($boardWipes['massBounce'] ?? 0) + (int) ($boardWipes['pseudoTotal'] ?? 0) + (int) ($boardWipes['conditionalWipes'] ?? 0);
        if ($softWipes >= 2 && $softWipes > $hardWipes) {
            $issues[] = $this->issue('wipes_are_mostly_bounce_or_conditional', 'warning', 'Wipes are mostly soft or conditional', 'Mass bounce, pseudo-wipes, and conditional wipes are separated from hard board wipes.', [
                'boardWipes' => $hardWipes,
                'softOrConditionalWipes' => $softWipes,
            ], 'review_role_mix');
        }

        if ($boardWipes === []) {
            return;
        }

        $total = (int) ($boardWipes['total'] ?? max($hardWipes, $softWipes));
        $pseudoWipes = (int) ($boardWipes['pseudoTotal'] ?? 0);
        $combatOnlyWipes = (int) ($boardWipes['combatOnlyWipes'] ?? 0);
        $massBounce = (int) ($boardWipes['massBounce'] ?? 0);
        $conditionalWipes = (int) ($boardWipes['conditionalWipes'] ?? 0);
        $answersIndestructible = (int) ($boardWipes['answersIndestructible'] ?? 0);
        $artifactEnchantmentCoverage = (int) ($boardWipes['artifactEnchantmentWipes'] ?? 0)
            + max((int) ($boardWipes['artifactWipes'] ?? 0), (int) ($boardWipes['enchantmentWipes'] ?? 0));
        $selfPlanRiskWipes = (int) ($boardWipes['selfPlanRiskWipes'] ?? 0);

        if ($total >= 2 && ($pseudoWipes + $combatOnlyWipes + $conditionalWipes) >= (int) ceil($total * 0.6) && $hardWipes < $total) {
            $issues[] = $this->issue('wipes_are_mostly_pseudo', 'warning', 'Wipes are mostly pseudo-wipes', 'The wipe count is mostly pseudo, combat-only, or conditional rather than reliable hard resets.', [
                'totalWipes' => $total,
                'hardWipes' => $hardWipes,
                'pseudoWipes' => $pseudoWipes,
                'combatOnlyWipes' => $combatOnlyWipes,
                'conditionalWipes' => $conditionalWipes,
            ], 'reduce_pseudo_wipes');
        }

        if ($total >= 2 && $massBounce >= max(2, (int) ceil($total * 0.5)) && $hardCreatureWipes <= 1) {
            $issues[] = $this->issue('wipes_are_mostly_bounce', 'warning', 'Wipes are mostly bounce', 'The wipe package leans on mass bounce and has little hard creature reset coverage.', [
                'totalWipes' => $total,
                'massBounce' => $massBounce,
                'hardCreatureWipes' => $hardCreatureWipes,
            ], 'add_hard_creature_wipe');
        }

        if ($hardWipes > 0 && $answersIndestructible === 0) {
            $issues[] = $this->issue('no_indestructible_answer', 'warning', 'No wipe answers indestructible', 'The deck has board wipes, but none are classified as exile, sacrifice, -X/-X, tuck, or shuffle answers.', [
                'hardWipes' => $hardWipes,
                'answersIndestructible' => $answersIndestructible,
            ], 'add_wipe_that_answers_indestructible');
        }

        if ($artifactEnchantmentCoverage === 0 && $this->wantsNonCreatureWipeCoverage($archetypes, $power)) {
            $issues[] = $this->issue('no_artifact_enchantment_wipe_coverage', 'warning', 'No mass artifact or enchantment wipe coverage', 'The deck has no mass artifact or enchantment wipe coverage for a plan that usually wants broad permanent answers.', [
                'artifactWipes' => (int) ($boardWipes['artifactWipes'] ?? 0),
                'enchantmentWipes' => (int) ($boardWipes['enchantmentWipes'] ?? 0),
                'artifactEnchantmentWipes' => (int) ($boardWipes['artifactEnchantmentWipes'] ?? 0),
                'primaryArchetype' => $archetypes['primary'],
                'powerBand' => $power['band'],
            ], 'add_artifact_enchantment_wipe');
        }

        if ((int) ($boardWipes['graveyardWipes'] ?? 0) === 0 && $this->wantsGraveyardWipeCoverage($roles, $archetypes, $power)) {
            $issues[] = $this->issue('no_graveyard_wipe_coverage', 'info', 'No mass graveyard wipe coverage', 'The current wipe package has no graveyard exile coverage for a plan or power band where that can matter.', [
                'graveyardWipes' => 0,
                'graveyardHate' => (int) ($roles['graveyardHate'] ?? 0),
                'primaryArchetype' => $archetypes['primary'],
                'powerBand' => $power['band'],
            ], 'add_graveyard_wipe');
        }

        if ($selfPlanRiskWipes >= 3 && $this->isCreatureBoardPlan($roles, $archetypes)) {
            $issues[] = $this->issue('too_many_symmetrical_wipes_for_creature_deck', 'warning', 'Too many symmetrical wipes for a creature plan', 'The deck has a creature-forward plan and several wipes that can reset its own board.', [
                'selfPlanRiskWipes' => $selfPlanRiskWipes,
                'hardCreatureWipes' => $hardCreatureWipes,
                'primaryArchetype' => $archetypes['primary'],
            ], 'replace_symmetrical_wipe_with_asymmetrical');
        }

        if ($selfPlanRiskWipes > 0) {
            $issues[] = $this->issue('own_plan_collision_wipes', 'warning', 'Wipes collide with the deck plan', 'Some wipes overlap with the deck own permanent, graveyard, artifact, enchantment, token, or creature plan.', [
                'selfPlanRiskWipes' => $selfPlanRiskWipes,
                'riskNotes' => $this->wipeRiskNotes($boardWipes),
            ], 'reduce_self_harming_wipes');
        }

        if ($selfPlanRiskWipes >= 2) {
            $issues[] = $this->issue('board_wipes_self_plan_risk', 'warning', 'Board wipes may pressure the deck plan', 'Some wipes overlap with the deck own permanent strategy.', [
                'selfPlanRiskWipes' => $selfPlanRiskWipes,
                'hardWipes' => $hardWipes,
            ], 'review_role_mix');
        }

        $expensiveWipes = $this->expensiveWipeCount($boardWipes);
        if ($total >= 2 && $expensiveWipes >= (int) ceil($total * 0.6) && (int) ($boardWipes['effectiveLowCostWipes'] ?? 0) === 0) {
            $issues[] = $this->issue('expensive_wipe_package', 'warning', 'Wipe package is expensive', 'Most wipes cost six or more mana and no low-cost emergency wipe is classified.', [
                'totalWipes' => $total,
                'expensiveWipes' => $expensiveWipes,
                'averageManaValue' => (float) ($boardWipes['averageManaValue'] ?? 0.0),
                'effectiveLowCostWipes' => (int) ($boardWipes['effectiveLowCostWipes'] ?? 0),
            ], 'add_cheaper_wipe');
        }

        if ($total > 0 && (int) ($boardWipes['effectiveLowCostWipes'] ?? 0) === 0 && $this->wantsCheapEmergencyWipe($archetypes, $power)) {
            $issues[] = $this->issue('no_cheap_emergency_wipe', 'warning', 'No cheap emergency wipe', 'The deck has wipes, but none are classified as efficient low-cost emergency resets.', [
                'totalWipes' => $total,
                'effectiveLowCostWipes' => 0,
                'primaryArchetype' => $archetypes['primary'],
                'powerBand' => $power['band'],
            ], 'add_cheaper_wipe');
        }

        if ((int) ($boardWipes['overloadedWipes'] ?? 0) > 0) {
            $issues[] = $this->issue('overload_wipe_available', 'info', 'Overload wipe available', 'The deck has at least one wipe with an alternative mass mode such as overload.', [
                'overloadedWipes' => (int) ($boardWipes['overloadedWipes'] ?? 0),
            ], 'none');
        }

        if ((int) ($boardWipes['asymmetricalWipes'] ?? 0) > 0 || (int) ($boardWipes['oneSidedWipes'] ?? 0) > 0) {
            $issues[] = $this->issue('asymmetrical_wipe_strength', 'info', 'Asymmetrical wipe strength', 'The deck has one-sided or asymmetrical board wipe coverage.', [
                'asymmetricalWipes' => (int) ($boardWipes['asymmetricalWipes'] ?? 0),
                'oneSidedWipes' => (int) ($boardWipes['oneSidedWipes'] ?? 0),
            ], 'none');
        }

        if ((int) ($boardWipes['modalWipes'] ?? 0) > 0) {
            $issues[] = $this->issue('modal_wipe_strength', 'info', 'Modal wipe strength', 'The deck has flexible modal board wipe coverage.', [
                'modalWipes' => (int) ($boardWipes['modalWipes'] ?? 0),
            ], 'none');
        }

        if ((int) ($boardWipes['opponentCompensationWipes'] ?? 0) > 0) {
            $issues[] = $this->issue('opponent_compensation_risk', 'info', 'Opponent compensation risk', 'Some wipes can compensate opponents, for example by ramping or replacing resources.', [
                'opponentCompensationWipes' => (int) ($boardWipes['opponentCompensationWipes'] ?? 0),
            ], 'review_opponent_compensation_wipes');
        }
    }

    /**
     * @param array{primary:string,secondary:list<string>} $archetypes
     * @param array{band:string} $power
     */
    private function wantsHardBoardWipes(array $archetypes, array $power): bool
    {
        return in_array($archetypes['primary'], ['control', 'midrange', 'stax', 'battlecruiser'], true)
            || array_intersect($archetypes['secondary'], ['control', 'midrange', 'stax']) !== []
            || in_array($power['band'], ['high_power', 'cedh_like'], true);
    }

    /**
     * @param array{primary:string,secondary:list<string>} $archetypes
     * @param array{band:string} $power
     */
    private function wantsNonCreatureWipeCoverage(array $archetypes, array $power): bool
    {
        return in_array($archetypes['primary'], ['control', 'midrange', 'stax', 'battlecruiser'], true)
            || array_intersect($archetypes['secondary'], ['control', 'midrange', 'stax']) !== []
            || in_array($power['band'], ['high_power', 'cedh_like'], true);
    }

    /**
     * @param array<string,int> $roles
     * @param array{primary:string,secondary:list<string>} $archetypes
     * @param array{band:string} $power
     */
    private function wantsGraveyardWipeCoverage(array $roles, array $archetypes, array $power): bool
    {
        if (($roles['graveyardHate'] ?? 0) > 0) {
            return false;
        }

        return in_array($archetypes['primary'], ['graveyard', 'reanimator', 'control'], true)
            || array_intersect($archetypes['secondary'], ['graveyard', 'reanimator']) !== []
            || in_array($power['band'], ['high_power', 'cedh_like'], true);
    }

    /**
     * @param array<string,int> $roles
     * @param array{primary:string,secondary:list<string>} $archetypes
     */
    private function isCreatureBoardPlan(array $roles, array $archetypes): bool
    {
        return in_array($archetypes['primary'], ['tokens', 'typal', 'voltron', 'aggro', 'creatures'], true)
            || array_intersect($archetypes['secondary'], ['tokens', 'typal', 'voltron', 'aggro', 'creatures']) !== []
            || ($roles['tokenMakers'] ?? 0) >= 5
            || ($roles['combatFinishers'] ?? 0) >= 3;
    }

    /**
     * @param array<string,mixed> $boardWipes
     * @return list<string>
     */
    private function wipeRiskNotes(array $boardWipes): array
    {
        $notes = [];
        foreach ($this->arrayValue($boardWipes['details'] ?? []) as $detail) {
            foreach ($this->arrayValue($detail['notes'] ?? []) as $note) {
                if (!is_scalar($note)) {
                    continue;
                }
                $normalized = trim((string) $note);
                if ($normalized !== '') {
                    $notes[$normalized] = true;
                }
            }
        }

        return array_keys($notes);
    }

    /**
     * @param array<string,mixed> $boardWipes
     */
    private function expensiveWipeCount(array $boardWipes): int
    {
        $count = 0;
        foreach ($this->arrayValue($boardWipes['details'] ?? []) as $detail) {
            $manaValue = is_numeric($detail['manaValue'] ?? null) ? (float) $detail['manaValue'] : null;
            $effectiveCost = is_numeric($detail['effectiveCostMin'] ?? null) ? (float) $detail['effectiveCostMin'] : $manaValue;
            if ($manaValue !== null && $manaValue >= 6.0 && ($effectiveCost ?? $manaValue) >= 6.0) {
                ++$count;
            }
        }

        if ($count === 0 && is_numeric($boardWipes['averageManaValue'] ?? null) && (float) $boardWipes['averageManaValue'] >= 6.0) {
            return (int) ($boardWipes['total'] ?? 0);
        }

        return $count;
    }

    /**
     * @param array{primary:string,secondary:list<string>} $archetypes
     * @param array{band:string} $power
     */
    private function wantsCheapEmergencyWipe(array $archetypes, array $power): bool
    {
        return in_array($archetypes['primary'], ['control', 'midrange'], true)
            || array_intersect($archetypes['secondary'], ['control', 'midrange']) !== []
            || in_array($power['band'], ['high_power', 'cedh_like'], true);
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array<string,int> $roles
     * @param array{primary:string,secondary:list<string>} $archetypes
     */
    private function sacrificeIssues(array &$issues, array $roles, array $archetypes): void
    {
        $sacrificeSignal = $this->hasSacrificePlan($roles, $archetypes);
        if ($sacrificeSignal && ($roles['sacrificeOutlets'] ?? 0) < 3) {
            $issues[] = $this->issue('low_real_sacrifice_outlets', 'warning', 'Low repeatable sacrifice outlets', 'The deck has sacrifice signals but not enough real repeatable sacrifice outlets.', [
                'sacrificeOutlets' => $roles['sacrificeOutlets'] ?? 0,
                'sacrificePayoffs' => $roles['sacrificePayoffs'] ?? 0,
            ], 'add_role');
        }
        $temporary = ($roles['oneShotSacrifice'] ?? 0) + ($roles['selfSacrifice'] ?? 0);
        if ($temporary >= 3 && ($roles['sacrificeOutlets'] ?? 0) <= 1) {
            $issues[] = $this->issue('sacrifice_is_mostly_one_shot', 'warning', 'Sacrifice is mostly one-shot', 'One-shot and self-sacrifice cards do not replace repeatable sacrifice outlets.', [
                'oneShotOrSelfSacrifice' => $temporary,
                'sacrificeOutlets' => $roles['sacrificeOutlets'] ?? 0,
            ], 'review_role_mix');
        }
    }

    /**
     * @param array<string,int> $roles
     * @param array{primary:string,secondary:list<string>} $archetypes
     */
    private function hasSacrificePlan(array $roles, array $archetypes): bool
    {
        if (in_array($archetypes['primary'], ['aristocrats', 'sacrifice'], true)) {
            return true;
        }
        if (array_intersect($archetypes['secondary'], ['aristocrats', 'sacrifice']) !== []) {
            return true;
        }

        $sacrificePayoffs = $roles['sacrificePayoffs'] ?? 0;
        $oneShot = $roles['oneShotSacrifice'] ?? 0;
        $selfSacrifice = $roles['selfSacrifice'] ?? 0;
        $tokenMakers = $roles['tokenMakers'] ?? 0;
        $outlets = $roles['sacrificeOutlets'] ?? 0;

        return $sacrificePayoffs >= 3
            || ($sacrificePayoffs >= 2 && ($oneShot + $selfSacrifice) >= 2)
            || ($sacrificePayoffs >= 2 && $tokenMakers >= 3 && $outlets < 3);
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array<string,int> $roles
     * @param array<string,mixed> $combos
     */
    private function comboIssues(array &$issues, array $roles, array $combos): void
    {
        if (($roles['comboPieces'] ?? 0) >= 6 && ($combos['completeCount'] ?? 0) === 0) {
            $issues[] = $this->issue('combo_pieces_without_complete_combos', 'warning', 'Combo pieces without complete combos', 'Your deck contains many cards that appear in known combos, but no complete combo lines were detected.', [
                'comboPieces' => $roles['comboPieces'] ?? 0,
                'completeCombos' => $combos['completeCount'] ?? 0,
            ], 'review_package');
        }
        if (($combos['partialOneMissingCount'] ?? 0) >= 5) {
            $issues[] = $this->issue('many_partial_combos', 'info', 'Many one-card-away combo lines', 'The deck has several known combo lines missing exactly one required piece.', [
                'partialOneMissingCount' => $combos['partialOneMissingCount'] ?? 0,
            ], 'review_package');
        }
        if (($combos['commanderRequiredCount'] ?? 0) >= 2) {
            $issues[] = $this->issue('commander_required_combo_dependency', 'info', 'Commander-dependent combo package', 'Several complete combo lines require the commander, increasing dependency on commander access.', [
                'commanderRequiredCount' => $combos['commanderRequiredCount'] ?? 0,
                'completeCount' => $combos['completeCount'] ?? 0,
            ], 'review_package');
        }
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array<string,int> $roles
     * @param array<string,mixed> $combos
     */
    private function winconIssues(array &$issues, array $roles, array $combos): void
    {
        $closure = ($roles['wincons'] ?? 0) + ($roles['combatFinishers'] ?? 0) + ($combos['completeCount'] ?? 0);
        if ($closure < 2) {
            $issues[] = $this->issue('low_wincons', 'warning', 'Low win condition density', 'The deck has few explicit win conditions, combat finishers, or complete combo lines.', [
                'wincons' => $roles['wincons'] ?? 0,
                'combatFinishers' => $roles['combatFinishers'] ?? 0,
                'completeCombos' => $combos['completeCount'] ?? 0,
            ], 'add_role');
        }
        if (($roles['draw'] ?? 0) + ($roles['payoffs'] ?? 0) >= 10 && $closure < 2) {
            $issues[] = $this->issue('value_without_closure', 'warning', 'Value without closure', 'The deck has value engines but few clear ways to close the game.', [
                'drawPlusPayoffs' => ($roles['draw'] ?? 0) + ($roles['payoffs'] ?? 0),
                'closureSignals' => $closure,
            ], 'add_role');
        }
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array<string,int> $roles
     */
    private function staxIssues(array &$issues, array $roles): void
    {
        if (($roles['symmetricalStaxRisk'] ?? 0) > 0) {
            $issues[] = $this->issue('symmetrical_stax_risk', 'warning', 'Symmetrical stax risk', 'Some stax effects may constrain your own plan as well as opponents.', [
                'symmetricalStaxRisk' => $roles['symmetricalStaxRisk'] ?? 0,
            ], 'review_package');
        }
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array{detected?:bool,primaryType?:?string,confidence?:string,creatureCount?:int,supportCount?:int,commanderMatches?:bool,types?:list<array{type:string,creatureCount:int,supportCount:int}>} $typal
     */
    private function typalIssues(array &$issues, array $typal): void
    {
        if (($typal['detected'] ?? false) === true) {
            $primaryType = is_string($typal['primaryType'] ?? null) ? $typal['primaryType'] : 'the primary creature type';
            $creatures = (int) ($typal['creatureCount'] ?? 0);
            $support = (int) ($typal['supportCount'] ?? 0);
            if ($creatures >= 10 && $support < 2) {
                $issues[] = $this->issue('typal_density_without_support', 'warning', 'Tribal density without enough support', sprintf('The deck has a clear %s creature base, but few cards that actively reward or support that tribe.', $primaryType), [
                    'primaryType' => $primaryType,
                    'creatureCount' => $creatures,
                    'supportCount' => $support,
                ], 'add_role');
            }

            if (($typal['commanderMatches'] ?? false) !== true && in_array($typal['confidence'] ?? 'low', ['medium', 'high'], true)) {
                $issues[] = $this->issue('typal_commander_mismatch', 'info', 'Commander does not match the main tribe', sprintf('The deck looks like %s tribal, but the commander does not share that creature type.', $primaryType), [
                    'primaryType' => $primaryType,
                    'commanderMatches' => false,
                ], 'review_package');
            }

            return;
        }

        foreach ($typal['types'] ?? [] as $type) {
            if (($type['supportCount'] ?? 0) >= 3 && ($type['creatureCount'] ?? 0) < 8) {
                $issues[] = $this->issue('typal_support_without_density', 'warning', 'Tribal support without enough creatures', sprintf('The deck has support for %s tribal, but not enough matching creature cards to make that package reliable.', $type['type']), [
                    'primaryType' => $type['type'],
                    'creatureCount' => $type['creatureCount'],
                    'supportCount' => $type['supportCount'],
                ], 'review_role_mix');
                return;
            }
        }
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array{band:string,signals:array<string,int>} $power
     */
    private function powerIssues(array &$issues, array $power): void
    {
        $signals = $power['signals'];
        $strongSignals = ($signals['fastMana'] ?? 0) + ($signals['efficientTutors'] ?? 0) + ($signals['freeInteraction'] ?? 0) + ($signals['completeWinLikeCombos'] ?? 0);
        if (in_array($power['band'], ['high_power', 'cedh_like'], true) || $strongSignals >= 8) {
            $issues[] = $this->issue('high_power_signals_detected', 'info', 'High-power signals detected', 'Fast mana, efficient tutors, free interaction, or complete combos push the deck toward higher-power bands.', [
                'strongPowerSignals' => $strongSignals,
            ], 'review_package');
        }
        if (($signals['lowOpportunityCost'] ?? 0) >= 5) {
            $issues[] = $this->issue('low_opportunity_cost_only_flexibility', 'info', 'Low opportunity cost is flexibility', 'Low opportunity cost cards improve flexibility, but they are not counted as raw power by themselves.', [
                'lowOpportunityCost' => $signals['lowOpportunityCost'],
            ], 'none');
        }
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array<string,mixed> $consistency
     * @param array{primary:string,secondary:list<string>} $archetypes
     * @param array{band:string} $power
     */
    private function consistencyIssues(array &$issues, array $consistency, array $archetypes, array $power): void
    {
        $opening = $this->arrayValue($consistency['openingHand'] ?? []);
        $mulligan = $this->arrayValue($consistency['mulligan'] ?? []);
        $turn3 = $this->arrayValue($this->arrayValue($consistency['byTurn'] ?? [])['turn3'] ?? []);
        $comboAccess = $this->arrayValue($consistency['comboAccess'] ?? []);
        $colorAccess = $this->arrayValue($consistency['colorAccess'] ?? []);
        $commanderCurve = $this->arrayValue($colorAccess['commanderCurve'] ?? []);

        $this->rateIssue($issues, ($opening['keepableHandRate'] ?? 1.0) < 0.60, 'low_keepable_hand_rate', 'Low keepable hand rate', 'Opening hand simulation estimates a low probability of seeing a keepable hand.', ['keepableHandRate' => $opening['keepableHandRate'] ?? null]);
        $this->rateIssue($issues, ($opening['keepableManaRate'] ?? 1.0) < 0.60, 'low_early_color_access', 'Low early color access', 'Opening hand simulation estimates low keepable mana, after color and tapped-land behavior.', ['keepableManaRate' => $opening['keepableManaRate'] ?? null], 'add_untapped_sources');
        $this->rateIssue($issues, ($opening['hasPrimaryColorRate'] ?? 1.0) < 0.70, 'weak_primary_color_sources', 'Weak primary color access', 'Opening hand simulation estimates low access to the deck primary early color.', ['hasPrimaryColorRate' => $opening['hasPrimaryColorRate'] ?? null], 'add_colored_sources');
        $this->rateIssue($issues, ($commanderCurve['canCastOnCurveRate'] ?? 1.0) < 0.55, 'low_commander_castability', 'Low commander castability', 'Mana simulation estimates low probability of casting the commander on curve.', ['canCastOnCurveRate' => $commanderCurve['canCastOnCurveRate'] ?? null], 'add_commander_color_sources');
        $this->rateIssue($issues, ($mulligan['keepableBy6Rate'] ?? 1.0) < 0.75, 'high_mulligan_pressure', 'High mulligan pressure', 'Opening hand simulation estimates a low probability of seeing a keepable hand by a mulligan to 6.', ['keepableBy6Rate' => $mulligan['keepableBy6Rate'] ?? null]);
        $this->rateIssue($issues, ($opening['zeroOrOneLandRate'] ?? 0.0) > 0.30, 'too_many_low_land_openers', 'Too many low-land openers', 'Opening hand simulation estimates a high probability of seeing zero-or-one-land hands.', ['zeroOrOneLandRate' => $opening['zeroOrOneLandRate'] ?? null]);
        $this->rateIssue($issues, ($opening['fivePlusLandsRate'] ?? 0.0) > 0.20, 'too_many_flooded_openers', 'Too many flooded openers', 'Opening hand simulation estimates a high probability of seeing five-plus-land hands.', ['fivePlusLandsRate' => $opening['fivePlusLandsRate'] ?? null]);
        $this->rateIssue($issues, ($opening['tappedLandHeavyRate'] ?? 0.0) > 0.25, 'too_many_tapped_lands', 'Too many tapped lands', 'Opening hand simulation estimates high tapped-land pressure.', ['tappedLandHeavyRate' => $opening['tappedLandHeavyRate'] ?? null], 'reduce_tapped_lands');
        $this->rateIssue($issues, ($opening['slowlandEarlyDelayRate'] ?? 0.0) > 0.25, 'too_many_slow_lands', 'Too many slow early lands', 'Opening hand simulation estimates slowlands frequently delay early access.', ['slowlandEarlyDelayRate' => $opening['slowlandEarlyDelayRate'] ?? null], 'reduce_slow_lands');
        $this->rateIssue($issues, ($opening['earlyPlayInOpeningRate'] ?? 1.0) < 0.55, 'low_early_development', 'Low early development', 'Opening hand simulation estimates a low probability of seeing an early play.', ['earlyPlayInOpeningRate' => $opening['earlyPlayInOpeningRate'] ?? null]);
        $wantsInteraction = in_array($archetypes['primary'], ['control', 'stax'], true) || in_array($power['band'], ['high_power', 'cedh_like'], true);
        $this->rateIssue($issues, $wantsInteraction && ($opening['earlyInteractionInOpeningRate'] ?? 1.0) < 0.30, 'low_early_interaction', 'Low early interaction access', 'Opening hand simulation estimates a low probability of seeing early interaction for this plan.', ['earlyInteractionInOpeningRate' => $opening['earlyInteractionInOpeningRate'] ?? null]);
        $this->rateIssue($issues, ($turn3['permanentRampSeenRate'] ?? 1.0) < 0.35, 'ramp_not_seen_early', 'Ramp not seen early often enough', 'Card access simulation estimates a low probability of seeing permanent ramp by turn 3.', ['permanentRampSeenRate' => $turn3['permanentRampSeenRate'] ?? null]);
        $comboLikely = $archetypes['primary'] === 'combo' || in_array('combo', $archetypes['secondary'], true);
        $this->rateIssue($issues, $comboLikely && ($comboAccess['completeTwoCardComboByTurn5Rate'] ?? 1.0) < 0.15, 'low_combo_access', 'Low direct combo access', 'Card access simulation estimates a low probability of seeing a complete two-card combo by turn 5.', ['completeTwoCardComboByTurn5Rate' => $comboAccess['completeTwoCardComboByTurn5Rate'] ?? null]);
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param array<string,mixed> $evidence
     */
    private function rateIssue(array &$issues, bool $condition, string $code, string $title, string $message, array $evidence, string $suggestedActionType = 'adjust_ratio'): void
    {
        if (!$condition) {
            return;
        }
        $issues[] = $this->issue($code, 'warning', $title, $message, $evidence, $suggestedActionType);
    }

    /**
     * @param list<array<string,mixed>> $issues
     * @param list<array{quantity:int}> $unmatchedCards
     */
    private function unmatchedIssues(array &$issues, array $unmatchedCards): void
    {
        $quantity = 0;
        foreach ($unmatchedCards as $card) {
            $quantity += max(1, $card['quantity']);
        }
        if ($quantity <= 0) {
            return;
        }
        $issues[] = $this->issue('unmatched_cards_skipped', 'warning', 'Some cards were skipped', 'Some deck cards were not included in advanced analysis because local analysis profiles could not be resolved.', [
            'unmatchedCards' => count($unmatchedCards),
            'unmatchedQuantity' => $quantity,
        ], 'review_data');
    }

    /**
     * @return array{code:string,severity:string,title:string,message:string,evidence:array<string,mixed>,suggestedActionType:string}
     */
    private function issue(string $code, string $severity, string $title, string $message, array $evidence, string $suggestedActionType): array
    {
        return [
            'code' => $code,
            'severity' => $severity,
            'title' => $title,
            'message' => $message,
            'evidence' => $evidence,
            'suggestedActionType' => $suggestedActionType,
        ];
    }

    /**
     * @return array<string,int>
     */
    private function genericRules(): array
    {
        if ($this->connection === null) {
            return [];
        }

        $rules = [];
        foreach ($this->connection->executeQuery(
            <<<'SQL'
SELECT metric, min_recommended
FROM analysis_rule
WHERE format = 'commander'
  AND archetype IS NULL
  AND active = true
SQL,
        )->iterateAssociative() as $row) {
            $metric = is_scalar($row['metric'] ?? null) ? trim((string) $row['metric']) : '';
            $minimum = $row['min_recommended'] ?? null;
            if ($metric !== '' && is_numeric($minimum)) {
                $rules[$metric] = (int) $minimum;
            }
        }

        return $rules;
    }

    private function recommendedSourcesForDemand(int $pipDemand, int $earlyPipDemand): int
    {
        if ($pipDemand <= 0) {
            return 0;
        }

        return max(8, min(20, (int) ceil($pipDemand / 2) + ($earlyPipDemand > 0 ? 3 : 0)));
    }

    /**
     * @return array<string,mixed>
     */
    private function arrayValue(mixed $value): array
    {
        return is_array($value) ? $value : [];
    }
}
