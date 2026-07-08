<?php

namespace App\Application\Deck;

final class DeckConsistencySimulator
{
    private const DEFAULT_RUNS = DeckAdvancedAnalyzerVersion::DEFAULT_MONTE_CARLO_RUNS;

    /**
     * @param list<array{quantity:int,oracleId:string,section?:string,analysisProfile:array<string,mixed>}> $resolvedCards
     * @param array<string,mixed> $combos
     * @param array{runs?:int,seed?:string,monteCarloVersion?:string,wantsEarlyInteraction?:bool,comboDeckLikely?:bool} $options
     * @return array{consistency:array<string,mixed>,issues:list<array{code:string,severity:string,message:string}>}
     */
    public function simulate(array $resolvedCards, array $combos, array $options = []): array
    {
        $runs = max(1, (int) ($options['runs'] ?? self::DEFAULT_RUNS));
        $seed = $this->seed($options['seed'] ?? 'commanderzone-consistency');
        $library = $this->library($resolvedCards);
        $comboPlans = $this->comboPlans($combos);
        $monteCarloVersion = is_string($options['monteCarloVersion'] ?? null) ? $options['monteCarloVersion'] : DeckAdvancedAnalyzerVersion::MONTE_CARLO;

        if ($library === []) {
            $consistency = $this->emptyConsistency($runs, $monteCarloVersion);

            return ['consistency' => $consistency, 'issues' => []];
        }

        $opening = $this->emptyCounters([
            'keepableHand',
            'zeroOrOneLand',
            'twoToFourLands',
            'fivePlusLands',
            'permanentRampInOpening',
            'fastManaInOpening',
            'burstManaInOpening',
            'earlyInteractionInOpening',
            'drawOrSelectionInOpening',
            'trueTutorInOpening',
            'earlyPlayInOpening',
            'failedByTooFewLands',
            'failedByTooManyLands',
            'failedByNoEarlyPlay',
            'failedByTooTopHeavy',
            'anyComboPieceInOpening',
            'completeTwoCardComboInOpening',
        ]);
        $mulligan = $this->emptyCounters(['keepAt7', 'keepAt6', 'keepAt5']);
        $turn3 = $this->emptyCounters(['permanentRampSeen', 'earlyInteractionSeen', 'drawOrSelectionSeen', 'trueTutorSeen', 'protectionSeen', 'winconSeen', 'comboPieceSeen']);
        $turn5 = $this->emptyCounters(['permanentRampSeen', 'interactionSeen', 'trueTutorSeen', 'winconSeen', 'comboPieceSeen', 'completeTwoCardComboSeen', 'comboPlusProtectionSeen', 'compactWinconSeen']);

        $mulligansNeeded = 0;
        for ($run = 0; $run < $runs; ++$run) {
            $openingHand = $this->sample($library, 7, $seed);
            $openingStats = $this->handStats($openingHand, $comboPlans);
            $keep = $this->keepEvaluation($openingStats);
            $this->countOpening($opening, $openingStats, $keep);
            $this->countMulligan($mulligan, $mulligansNeeded, $keep, $library, $comboPlans, $seed);

            $turn3Stats = $this->handStats($this->sample($library, min(9, count($library)), $seed), $comboPlans);
            $turn5Stats = $this->handStats($this->sample($library, min(11, count($library)), $seed), $comboPlans);
            $this->countTurn3($turn3, $turn3Stats);
            $this->countTurn5($turn5, $turn5Stats);
        }

        $consistency = [
            'simulationRuns' => $runs,
            'monteCarloVersion' => $monteCarloVersion,
            'method' => 'monte_carlo',
            'scope' => 'opening_hand_and_card_access',
            'disclaimer' => 'This simulates hands and card access, not match win rate.',
            'assumptions' => [
                'Opening hand is seven cards.',
                'By-turn access assumes no draw on turn 1; turn 3 sees opening hand plus 2 draws, and turn 5 sees opening hand plus 4 draws.',
                'Combo access checks direct pieces only for complete 2-card and 3-card combos already detected locally.',
                'Mulligans resample seven-card hands and do not model perfect bottom decisions.',
            ],
            'openingHand' => [
                'keepableHandRate' => $this->rate($opening['keepableHand'], $runs),
                'zeroOrOneLandRate' => $this->rate($opening['zeroOrOneLand'], $runs),
                'twoToFourLandsRate' => $this->rate($opening['twoToFourLands'], $runs),
                'fivePlusLandsRate' => $this->rate($opening['fivePlusLands'], $runs),
                'permanentRampInOpeningRate' => $this->rate($opening['permanentRampInOpening'], $runs),
                'fastManaInOpeningRate' => $this->rate($opening['fastManaInOpening'], $runs),
                'burstManaInOpeningRate' => $this->rate($opening['burstManaInOpening'], $runs),
                'earlyInteractionInOpeningRate' => $this->rate($opening['earlyInteractionInOpening'], $runs),
                'drawOrSelectionInOpeningRate' => $this->rate($opening['drawOrSelectionInOpening'], $runs),
                'trueTutorInOpeningRate' => $this->rate($opening['trueTutorInOpening'], $runs),
                'earlyPlayInOpeningRate' => $this->rate($opening['earlyPlayInOpening'], $runs),
                'anyComboPieceInOpeningRate' => $this->rate($opening['anyComboPieceInOpening'], $runs),
                'completeTwoCardComboInOpeningRate' => $this->rate($opening['completeTwoCardComboInOpening'], $runs),
            ],
            'keepRule' => [
                'description' => 'Keepable means 2-4 lands, at least one early play, at least one development or interaction signal, at most two cards with mana value 5+, and not only reactive cards.',
                'failedByTooFewLandsRate' => $this->rate($opening['failedByTooFewLands'], $runs),
                'failedByTooManyLandsRate' => $this->rate($opening['failedByTooManyLands'], $runs),
                'failedByNoEarlyPlayRate' => $this->rate($opening['failedByNoEarlyPlay'], $runs),
                'failedByTooTopHeavyRate' => $this->rate($opening['failedByTooTopHeavy'], $runs),
            ],
            'mulligan' => [
                'keepableAt7Rate' => $this->rate($mulligan['keepAt7'], $runs),
                'keepableBy6Rate' => $this->rate($mulligan['keepAt7'] + $mulligan['keepAt6'], $runs),
                'keepableBy5Rate' => $this->rate($mulligan['keepAt7'] + $mulligan['keepAt6'] + $mulligan['keepAt5'], $runs),
                'averageMulligansNeeded' => round($mulligansNeeded / $runs, 4),
            ],
            'byTurn' => [
                'turn3' => [
                    'permanentRampSeenRate' => $this->rate($turn3['permanentRampSeen'], $runs),
                    'earlyInteractionSeenRate' => $this->rate($turn3['earlyInteractionSeen'], $runs),
                    'drawOrSelectionSeenRate' => $this->rate($turn3['drawOrSelectionSeen'], $runs),
                    'trueTutorSeenRate' => $this->rate($turn3['trueTutorSeen'], $runs),
                    'protectionSeenRate' => $this->rate($turn3['protectionSeen'], $runs),
                    'winconSeenRate' => $this->rate($turn3['winconSeen'], $runs),
                    'comboPieceSeenRate' => $this->rate($turn3['comboPieceSeen'], $runs),
                ],
                'turn5' => [
                    'permanentRampSeenRate' => $this->rate($turn5['permanentRampSeen'], $runs),
                    'interactionSeenRate' => $this->rate($turn5['interactionSeen'], $runs),
                    'trueTutorSeenRate' => $this->rate($turn5['trueTutorSeen'], $runs),
                    'winconSeenRate' => $this->rate($turn5['winconSeen'], $runs),
                    'comboPieceSeenRate' => $this->rate($turn5['comboPieceSeen'], $runs),
                    'completeTwoCardComboSeenRate' => $this->rate($turn5['completeTwoCardComboSeen'], $runs),
                    'comboPlusProtectionSeenRate' => $this->rate($turn5['comboPlusProtectionSeen'], $runs),
                ],
            ],
            'comboAccess' => [
                'anyComboPieceInOpeningRate' => $this->rate($opening['anyComboPieceInOpening'], $runs),
                'anyComboPieceByTurn5Rate' => $this->rate($turn5['comboPieceSeen'], $runs),
                'completeTwoCardComboInOpeningRate' => $this->rate($opening['completeTwoCardComboInOpening'], $runs),
                'completeTwoCardComboByTurn5Rate' => $this->rate($turn5['completeTwoCardComboSeen'], $runs),
                'compactWinconSeenByTurn5Rate' => $this->rate($turn5['compactWinconSeen'], $runs),
                'comboPlusProtectionSeenRate' => $this->rate($turn5['comboPlusProtectionSeen'], $runs),
            ],
        ];

        return [
            'consistency' => $consistency,
            'issues' => $this->issues($consistency, $options),
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function emptyConsistency(int $runs, string $monteCarloVersion): array
    {
        return [
            'simulationRuns' => $runs,
            'monteCarloVersion' => $monteCarloVersion,
            'method' => 'monte_carlo',
            'scope' => 'opening_hand_and_card_access',
            'disclaimer' => 'This simulates hands and card access, not match win rate.',
            'openingHand' => [],
            'keepRule' => [],
            'mulligan' => [],
            'byTurn' => ['turn3' => [], 'turn5' => []],
        ];
    }

    /**
     * @param list<array{quantity:int,oracleId:string,section?:string,analysisProfile:array<string,mixed>}> $resolvedCards
     * @return list<array<string,mixed>>
     */
    private function library(array $resolvedCards): array
    {
        $library = [];
        foreach ($resolvedCards as $card) {
            if (($card['section'] ?? 'main') === 'commander') {
                continue;
            }
            $flags = $this->cardFlags($card);
            for ($copy = 0; $copy < max(1, $card['quantity']); ++$copy) {
                $library[] = $flags;
            }
        }

        return $library;
    }

    /**
     * @param array{oracleId:string,analysisProfile:array<string,mixed>} $card
     * @return array<string,mixed>
     */
    private function cardFlags(array $card): array
    {
        $profile = $card['analysisProfile'];
        $roles = $this->stringSet($profile['roles'] ?? []);
        $subroles = $this->stringSet($profile['subroles'] ?? []);
        $powerFlags = $this->stringSet($profile['powerFlags'] ?? []);
        $manaValue = is_numeric($profile['manaValue'] ?? null) ? (float) $profile['manaValue'] : 0.0;
        $land = $this->boolPath($profile, ['types', 'land']) || isset($roles['land']);
        $burst = isset($roles['burst_mana']) || isset($roles['ritual']) || isset($subroles['one_shot_mana']);
        $permanentRamp = isset($roles['ramp']) && !$burst && $this->roleRepeatability($profile, 'ramp') !== 'one_shot';
        $fastMana = isset($roles['fast_mana']) || isset($powerFlags['fast_mana']) || $this->boolPath($profile, ['flags', 'fastMana']);
        $earlyInteraction = isset($roles['spot_removal'])
            || isset($roles['creature_removal'])
            || isset($roles['artifact_removal'])
            || isset($roles['enchantment_removal'])
            || isset($roles['counterspell'])
            || isset($roles['graveyard_hate'])
            || $this->boolPath($profile, ['flags', 'freeInteraction']);
        $drawOrSelection = isset($roles['draw']) || isset($roles['card_selection']);
        $trueTutor = isset($subroles['true_tutor']) || (isset($roles['tutor']) && !$this->hasAny($subroles, ['land_tutor', 'ramp_search', 'opponent_tutor']));
        $protection = isset($roles['protection']);
        $wincon = isset($roles['wincon']) || isset($powerFlags['compact_wincon']);
        $comboPiece = isset($roles['combo_piece']) || isset($powerFlags['compact_wincon']) || isset($powerFlags['mana_positive_combo_piece']);
        $development = $permanentRamp || $fastMana || $drawOrSelection || $trueTutor || $wincon || $comboPiece || isset($roles['enabler']) || isset($roles['token_maker']) || isset($roles['cost_reducer']);
        $earlyPlay = !$land && $manaValue <= 2.0 && ($development || $earlyInteraction || $protection);

        return [
            'oracleId' => $card['oracleId'],
            'land' => $land,
            'permanentRamp' => $permanentRamp,
            'fastMana' => $fastMana,
            'burstMana' => $burst,
            'earlyInteraction' => $earlyInteraction,
            'drawOrSelection' => $drawOrSelection,
            'trueTutor' => $trueTutor,
            'protection' => $protection,
            'wincon' => $wincon,
            'comboPiece' => $comboPiece,
            'compactWincon' => isset($powerFlags['compact_wincon']),
            'earlyPlay' => $earlyPlay,
            'highManaValue' => !$land && $manaValue >= 5.0,
            'development' => $development,
            'reactive' => $earlyInteraction || $protection,
        ];
    }

    /**
     * @param array<string,mixed> $combos
     * @return list<list<string>>
     */
    private function comboPlans(array $combos): array
    {
        $plans = [];
        foreach (($combos['complete'] ?? []) as $combo) {
            if (!is_array($combo)) {
                continue;
            }
            $required = $this->stringList($combo['requiredOracleIds'] ?? []);
            if (count($required) < 2 || count($required) > 3) {
                continue;
            }
            $plans[] = $required;
        }

        return $plans;
    }

    /**
     * @param list<array<string,mixed>> $hand
     * @param list<list<string>> $comboPlans
     * @return array<string,int|bool>
     */
    private function handStats(array $hand, array $comboPlans): array
    {
        $stats = [
            'lands' => 0,
            'permanentRamp' => 0,
            'fastMana' => 0,
            'burstMana' => 0,
            'earlyInteraction' => 0,
            'interaction' => 0,
            'drawOrSelection' => 0,
            'trueTutor' => 0,
            'protection' => 0,
            'wincon' => 0,
            'comboPiece' => 0,
            'compactWincon' => 0,
            'earlyPlay' => 0,
            'highManaValue' => 0,
            'development' => 0,
            'reactive' => 0,
            'completeTwoCardCombo' => false,
        ];
        $seenOracleIds = [];
        foreach ($hand as $card) {
            $seenOracleIds[$card['oracleId']] = true;
            foreach (['land' => 'lands', 'permanentRamp' => 'permanentRamp', 'fastMana' => 'fastMana', 'burstMana' => 'burstMana', 'earlyInteraction' => 'earlyInteraction', 'drawOrSelection' => 'drawOrSelection', 'trueTutor' => 'trueTutor', 'protection' => 'protection', 'wincon' => 'wincon', 'comboPiece' => 'comboPiece', 'compactWincon' => 'compactWincon', 'earlyPlay' => 'earlyPlay', 'highManaValue' => 'highManaValue', 'development' => 'development', 'reactive' => 'reactive'] as $flag => $key) {
                if ($card[$flag] === true) {
                    ++$stats[$key];
                }
            }
            if ($card['earlyInteraction'] === true || $card['protection'] === true) {
                ++$stats['interaction'];
            }
        }

        foreach ($comboPlans as $plan) {
            if (count($plan) !== 2) {
                continue;
            }
            if ($this->hasAllOracleIds($seenOracleIds, $plan)) {
                $stats['completeTwoCardCombo'] = true;
                break;
            }
        }

        return $stats;
    }

    /**
     * @param array<string,int|bool> $stats
     * @return array{keepable:bool,tooFewLands:bool,tooManyLands:bool,noEarlyPlay:bool,tooTopHeavy:bool}
     */
    private function keepEvaluation(array $stats): array
    {
        $tooFewLands = $stats['lands'] <= 1;
        $tooManyLands = $stats['lands'] >= 5;
        $noEarlyPlay = $stats['earlyPlay'] < 1;
        $tooTopHeavy = $stats['highManaValue'] > 2;
        $hasSupport = ($stats['permanentRamp'] + $stats['drawOrSelection'] + $stats['earlyInteraction'] + $stats['trueTutor']) > 0;
        $reactiveOnly = $stats['reactive'] > 0 && $stats['development'] === 0;

        return [
            'keepable' => !$tooFewLands && !$tooManyLands && !$noEarlyPlay && !$tooTopHeavy && $hasSupport && !$reactiveOnly,
            'tooFewLands' => $tooFewLands,
            'tooManyLands' => $tooManyLands,
            'noEarlyPlay' => $noEarlyPlay,
            'tooTopHeavy' => $tooTopHeavy,
        ];
    }

    /**
     * @param array<string,int> $opening
     * @param array<string,int|bool> $stats
     * @param array<string,bool> $keep
     */
    private function countOpening(array &$opening, array $stats, array $keep): void
    {
        $opening['keepableHand'] += $keep['keepable'] ? 1 : 0;
        $opening['zeroOrOneLand'] += $stats['lands'] <= 1 ? 1 : 0;
        $opening['twoToFourLands'] += ($stats['lands'] >= 2 && $stats['lands'] <= 4) ? 1 : 0;
        $opening['fivePlusLands'] += $stats['lands'] >= 5 ? 1 : 0;
        foreach (['permanentRamp', 'fastMana', 'burstMana', 'earlyInteraction', 'drawOrSelection', 'trueTutor', 'earlyPlay'] as $key) {
            $opening[$key.'InOpening'] += $stats[$key] > 0 ? 1 : 0;
        }
        $opening['failedByTooFewLands'] += $keep['tooFewLands'] ? 1 : 0;
        $opening['failedByTooManyLands'] += $keep['tooManyLands'] ? 1 : 0;
        $opening['failedByNoEarlyPlay'] += $keep['noEarlyPlay'] ? 1 : 0;
        $opening['failedByTooTopHeavy'] += $keep['tooTopHeavy'] ? 1 : 0;
        $opening['anyComboPieceInOpening'] += $stats['comboPiece'] > 0 ? 1 : 0;
        $opening['completeTwoCardComboInOpening'] += $stats['completeTwoCardCombo'] ? 1 : 0;
    }

    /**
     * @param array<string,int> $mulligan
     * @param list<array<string,mixed>> $library
     * @param list<list<string>> $comboPlans
     */
    private function countMulligan(array &$mulligan, int &$mulligansNeeded, array $openingKeep, array $library, array $comboPlans, int &$seed): void
    {
        if ($openingKeep['keepable']) {
            ++$mulligan['keepAt7'];

            return;
        }

        $keepAt6 = $this->keepEvaluation($this->handStats($this->sample($library, 7, $seed), $comboPlans));
        if ($keepAt6['keepable']) {
            ++$mulligan['keepAt6'];
            ++$mulligansNeeded;

            return;
        }

        $keepAt5 = $this->keepEvaluation($this->handStats($this->sample($library, 7, $seed), $comboPlans));
        if ($keepAt5['keepable']) {
            ++$mulligan['keepAt5'];
            $mulligansNeeded += 2;

            return;
        }

        $mulligansNeeded += 3;
    }

    /**
     * @param array<string,int> $turn3
     * @param array<string,int|bool> $stats
     */
    private function countTurn3(array &$turn3, array $stats): void
    {
        foreach (['permanentRamp', 'earlyInteraction', 'drawOrSelection', 'trueTutor', 'protection', 'wincon', 'comboPiece'] as $key) {
            $turn3[$key.'Seen'] += $stats[$key] > 0 ? 1 : 0;
        }
    }

    /**
     * @param array<string,int> $turn5
     * @param array<string,int|bool> $stats
     */
    private function countTurn5(array &$turn5, array $stats): void
    {
        foreach (['permanentRamp', 'interaction', 'trueTutor', 'wincon', 'comboPiece'] as $key) {
            $turn5[$key.'Seen'] += $stats[$key] > 0 ? 1 : 0;
        }
        $turn5['completeTwoCardComboSeen'] += $stats['completeTwoCardCombo'] ? 1 : 0;
        $turn5['comboPlusProtectionSeen'] += ($stats['completeTwoCardCombo'] && $stats['protection'] > 0) ? 1 : 0;
        $turn5['compactWinconSeen'] += $stats['compactWincon'] > 0 ? 1 : 0;
    }

    /**
     * @param array<string,mixed> $consistency
     * @param array{wantsEarlyInteraction?:bool,comboDeckLikely?:bool} $options
     * @return list<array{code:string,severity:string,message:string}>
     */
    private function issues(array $consistency, array $options): array
    {
        $issues = [];
        $opening = $consistency['openingHand'];
        $mulligan = $consistency['mulligan'];
        $turn3 = $consistency['byTurn']['turn3'];
        $comboAccess = $consistency['comboAccess'];

        $this->issueIf($issues, $opening['keepableHandRate'] < 0.60, 'low_keepable_hand_rate', sprintf('Opening hand simulation estimates a %.1f%% keepable hand rate.', $opening['keepableHandRate'] * 100));
        $this->issueIf($issues, $mulligan['keepableBy6Rate'] < 0.75, 'high_mulligan_pressure', sprintf('Opening hand simulation estimates only %.1f%% keepable hands by a mulligan to 6.', $mulligan['keepableBy6Rate'] * 100));
        $this->issueIf($issues, $opening['zeroOrOneLandRate'] > 0.30, 'too_many_low_land_openers', sprintf('Opening hand simulation estimates %.1f%% zero-or-one-land hands.', $opening['zeroOrOneLandRate'] * 100));
        $this->issueIf($issues, $opening['fivePlusLandsRate'] > 0.20, 'too_many_flooded_openers', sprintf('Opening hand simulation estimates %.1f%% five-plus-land hands.', $opening['fivePlusLandsRate'] * 100));
        $this->issueIf($issues, $opening['earlyPlayInOpeningRate'] < 0.55, 'low_early_development', sprintf('Opening hand simulation estimates %.1f%% hands with an early play.', $opening['earlyPlayInOpeningRate'] * 100));
        $this->issueIf($issues, ($options['wantsEarlyInteraction'] ?? false) && $opening['earlyInteractionInOpeningRate'] < 0.30, 'low_early_interaction', sprintf('Opening hand simulation estimates %.1f%% hands with early interaction.', $opening['earlyInteractionInOpeningRate'] * 100));
        $this->issueIf($issues, $turn3['permanentRampSeenRate'] < 0.35, 'ramp_not_seen_early', sprintf('Card access simulation estimates %.1f%% access to permanent ramp by turn 3.', $turn3['permanentRampSeenRate'] * 100));
        $this->issueIf($issues, ($options['comboDeckLikely'] ?? false) && $comboAccess['completeTwoCardComboByTurn5Rate'] < 0.15, 'low_combo_access', sprintf('Card access simulation estimates %.1f%% access to a complete two-card combo by turn 5.', $comboAccess['completeTwoCardComboByTurn5Rate'] * 100));

        return $issues;
    }

    /**
     * @param list<array{code:string,severity:string,message:string}> $issues
     */
    private function issueIf(array &$issues, bool $condition, string $code, string $message): void
    {
        if (!$condition) {
            return;
        }

        $issues[] = ['code' => $code, 'severity' => 'warning', 'message' => $message];
    }

    /**
     * @param list<string> $keys
     * @return array<string,int>
     */
    private function emptyCounters(array $keys): array
    {
        return array_fill_keys($keys, 0);
    }

    /**
     * @param list<array<string,mixed>> $library
     * @return list<array<string,mixed>>
     */
    private function sample(array $library, int $count, int &$seed): array
    {
        $size = count($library);
        if ($count >= $size) {
            return $library;
        }

        $pool = $library;
        $hand = [];
        for ($index = 0; $index < $count; ++$index) {
            $selected = $index + $this->randomInt($seed, $size - $index);
            $hand[] = $pool[$selected];
            $pool[$selected] = $pool[$index];
        }

        return $hand;
    }

    private function randomInt(int &$seed, int $maxExclusive): int
    {
        $seed = (int) ((1103515245 * $seed + 12345) & 0x7fffffff);

        return $maxExclusive <= 1 ? 0 : $seed % $maxExclusive;
    }

    private function seed(string $seed): int
    {
        $value = (int) hexdec(substr(hash('sha256', $seed), 0, 8)) & 0x7fffffff;

        return $value > 0 ? $value : 1;
    }

    private function rate(int $count, int $runs): float
    {
        return round($count / max(1, $runs), 4);
    }

    /**
     * @param array<string,true> $seenOracleIds
     * @param list<string> $requiredOracleIds
     */
    private function hasAllOracleIds(array $seenOracleIds, array $requiredOracleIds): bool
    {
        foreach ($requiredOracleIds as $oracleId) {
            if (!isset($seenOracleIds[$oracleId])) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param array<string,true> $set
     * @param list<string> $keys
     */
    private function hasAny(array $set, array $keys): bool
    {
        foreach ($keys as $key) {
            if (isset($set[$key])) {
                return true;
            }
        }

        return false;
    }

    private function roleRepeatability(array $profile, string $role): ?string
    {
        $roleScores = $profile['roleScores'] ?? [];
        if (!is_array($roleScores) || !is_array($roleScores[$role] ?? null)) {
            return null;
        }
        $repeatability = $roleScores[$role]['repeatability'] ?? null;
        if (!is_scalar($repeatability)) {
            return null;
        }

        return mb_strtolower(trim((string) $repeatability));
    }

    /**
     * @return list<string>
     */
    private function stringList(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        return array_values(array_filter(
            array_map(static fn (mixed $item): ?string => is_scalar($item) && trim((string) $item) !== '' ? trim((string) $item) : null, $value),
            static fn (?string $item): bool => $item !== null,
        ));
    }

    /**
     * @return array<string,true>
     */
    private function stringSet(mixed $value): array
    {
        $set = [];
        foreach ($this->stringList($value) as $item) {
            $set[mb_strtolower($item)] = true;
        }

        return $set;
    }

    /**
     * @param array<string,mixed> $source
     * @param list<string> $path
     */
    private function boolPath(array $source, array $path): bool
    {
        $value = $source;
        foreach ($path as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) {
                return false;
            }
            $value = $value[$segment];
        }

        return $value === true;
    }
}
