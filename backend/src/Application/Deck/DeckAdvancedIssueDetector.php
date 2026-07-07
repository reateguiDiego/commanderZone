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
     * @return list<array{code:string,severity:string,title:string,message:string,evidence:array<string,mixed>,suggestedActionType:string}>
     */
    public function detect(array $metrics, array $combos, array $archetypes, array $power, array $consistency, array $unmatchedCards): array
    {
        $roles = $metrics['roles'];
        $rules = $this->genericRules();
        $issues = [];

        $this->rampIssues($issues, $roles, $rules);
        $this->drawIssues($issues, $roles, $rules);
        $this->tutorIssues($issues, $roles, $archetypes, $power);
        $this->wipeIssues($issues, $roles, $rules);
        $this->sacrificeIssues($issues, $roles, $archetypes);
        $this->comboIssues($issues, $roles, $combos);
        $this->winconIssues($issues, $roles, $combos);
        $this->staxIssues($issues, $roles);
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
    private function rampIssues(array &$issues, array $roles, array $rules): void
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
        if ($comboOrHighPower && ($roles['trueTutors'] ?? 0) < 3) {
            $issues[] = $this->issue('low_true_tutors_for_combo', 'warning', 'Low true tutor density', 'The plan has combo or high-power signals, but true tutors are low.', [
                'trueTutors' => $roles['trueTutors'] ?? 0,
                'primaryArchetype' => $archetypes['primary'],
                'powerBand' => $power['band'],
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
     * @param array<string,int> $roles
     * @param array<string,int> $rules
     */
    private function wipeIssues(array &$issues, array $roles, array $rules): void
    {
        $minimum = $rules['board_wipe'] ?? self::FALLBACK_MINIMUMS['board_wipe'];
        if (($roles['boardWipes'] ?? 0) < $minimum) {
            $issues[] = $this->issue('low_hard_board_wipes', 'warning', 'Few hard board wipes', sprintf('Hard board wipes are below the baseline (%d detected, %d recommended).', $roles['boardWipes'] ?? 0, $minimum), [
                'boardWipes' => $roles['boardWipes'] ?? 0,
                'minRecommended' => $minimum,
            ], 'add_role');
        }
        $softWipes = ($roles['massBounce'] ?? 0) + ($roles['pseudoWipes'] ?? 0) + ($roles['conditionalWipes'] ?? 0);
        if ($softWipes >= 2 && $softWipes > ($roles['boardWipes'] ?? 0)) {
            $issues[] = $this->issue('wipes_are_mostly_bounce_or_conditional', 'warning', 'Wipes are mostly soft or conditional', 'Mass bounce, pseudo-wipes, and conditional wipes are separated from hard board wipes.', [
                'boardWipes' => $roles['boardWipes'] ?? 0,
                'softOrConditionalWipes' => $softWipes,
            ], 'review_role_mix');
        }
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
     * @param array{band:string,signals:array<string,int>} $power
     */
    private function powerIssues(array &$issues, array $power): void
    {
        $signals = $power['signals'];
        $strongSignals = ($signals['fastMana'] ?? 0) + ($signals['efficientTutors'] ?? 0) + ($signals['freeInteraction'] ?? 0) + ($signals['completeWinLikeCombos'] ?? 0);
        if (in_array($power['band'], ['high_power', 'cedh_like'], true) || $strongSignals >= 8) {
            $issues[] = $this->issue('high_power_signals_detected', 'info', 'High-power signals detected', 'Fast mana, efficient tutors, free interaction, or complete combos push the deck toward higher-power bands.', [
                'powerBand' => $power['band'],
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

        $this->rateIssue($issues, ($opening['keepableHandRate'] ?? 1.0) < 0.60, 'low_keepable_hand_rate', 'Low keepable hand rate', 'Opening hand simulation estimates a low probability of seeing a keepable hand.', ['keepableHandRate' => $opening['keepableHandRate'] ?? null]);
        $this->rateIssue($issues, ($mulligan['keepableBy6Rate'] ?? 1.0) < 0.75, 'high_mulligan_pressure', 'High mulligan pressure', 'Opening hand simulation estimates a low probability of seeing a keepable hand by a mulligan to 6.', ['keepableBy6Rate' => $mulligan['keepableBy6Rate'] ?? null]);
        $this->rateIssue($issues, ($opening['zeroOrOneLandRate'] ?? 0.0) > 0.30, 'too_many_low_land_openers', 'Too many low-land openers', 'Opening hand simulation estimates a high probability of seeing zero-or-one-land hands.', ['zeroOrOneLandRate' => $opening['zeroOrOneLandRate'] ?? null]);
        $this->rateIssue($issues, ($opening['fivePlusLandsRate'] ?? 0.0) > 0.20, 'too_many_flooded_openers', 'Too many flooded openers', 'Opening hand simulation estimates a high probability of seeing five-plus-land hands.', ['fivePlusLandsRate' => $opening['fivePlusLandsRate'] ?? null]);
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
    private function rateIssue(array &$issues, bool $condition, string $code, string $title, string $message, array $evidence): void
    {
        if (!$condition) {
            return;
        }
        $issues[] = $this->issue($code, 'warning', $title, $message, $evidence, 'adjust_ratio');
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

    /**
     * @return array<string,mixed>
     */
    private function arrayValue(mixed $value): array
    {
        return is_array($value) ? $value : [];
    }
}
