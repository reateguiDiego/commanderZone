<?php

namespace App\Application\Deck;

final class DeckConsistencySimulator
{
    private const DEFAULT_RUNS = DeckAdvancedAnalyzerVersion::DEFAULT_MONTE_CARLO_RUNS;
    private const COLOR_KEYS = [
        'W' => 'white',
        'U' => 'blue',
        'B' => 'black',
        'R' => 'red',
        'G' => 'green',
    ];
    private const COLOR_NAMES = ['white', 'blue', 'black', 'red', 'green'];

    /**
     * @param list<array{quantity:int,oracleId:string,section?:string,analysisProfile:array<string,mixed>,manaProfile?:array<string,mixed>}> $resolvedCards
     * @param array<string,mixed> $combos
     * @param array{runs?:int,seed?:string,monteCarloVersion?:string,wantsEarlyInteraction?:bool,comboDeckLikely?:bool,mana?:array<string,mixed>} $options
     * @return array{consistency:array<string,mixed>,issues:list<array{code:string,severity:string,message:string}>}
     */
    public function simulate(array $resolvedCards, array $combos, array $options = []): array
    {
        $runs = max(1, (int) ($options['runs'] ?? self::DEFAULT_RUNS));
        $seed = $this->seed($options['seed'] ?? 'commanderzone-consistency');
        $manaContext = $this->manaContext($resolvedCards, is_array($options['mana'] ?? null) ? $options['mana'] : []);
        $library = $this->library($resolvedCards, $manaContext);
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
            'keepableMana',
            'hasTwoLands',
            'hasThreeLands',
            'hasAtLeastOneUntappedSource',
            'hasCommanderColors',
            'hasPrimaryColor',
            'hasAllEarlyColors',
            'tappedLandHeavy',
            'fetchlandWithValidTarget',
            'fetchlandWithoutTarget',
            'fastlandEarlyAccess',
            'slowlandEarlyDelay',
            'painlandEarlyAccess',
            'pathwayColorChoicePressure',
            'filterlandNeedsInput',
        ]);
        $mulligan = $this->emptyCounters(['keepAt7', 'keepAt6', 'keepAt5']);
        $turn3 = $this->emptyCounters(['permanentRampSeen', 'earlyInteractionSeen', 'drawOrSelectionSeen', 'trueTutorSeen', 'protectionSeen', 'winconSeen', 'comboPieceSeen']);
        $turn5 = $this->emptyCounters(['permanentRampSeen', 'interactionSeen', 'trueTutorSeen', 'winconSeen', 'comboPieceSeen', 'completeTwoCardComboSeen', 'comboPlusProtectionSeen', 'compactWinconSeen']);
        $colorAccess = [
            'turn1' => $this->emptyColorAccessCounters(),
            'turn2' => $this->emptyColorAccessCounters(),
            'turn3' => $this->emptyColorAccessCounters(),
        ];
        $commanderCurve = $this->emptyCounters(['canCastOnCurve', 'missingColor', 'missingManaValue', 'tappedOutDelay']);

        $mulligansNeeded = 0;
        for ($run = 0; $run < $runs; ++$run) {
            $drawSequence = $this->sample($library, min(11, count($library)), $seed);
            $openingHand = array_slice($drawSequence, 0, min(7, count($drawSequence)));
            $openingStats = $this->handStats($openingHand, $comboPlans);
            $openingMana = $this->manaStats($openingHand, 2, $manaContext);
            $keep = $this->keepEvaluation($openingStats, $openingMana);
            $this->countOpening($opening, $openingStats, $keep);
            $this->countOpeningMana($opening, $openingMana, $manaContext);
            $this->countMulligan($mulligan, $mulligansNeeded, $keep, $library, $comboPlans, $manaContext, $seed);

            $turn1Hand = array_slice($drawSequence, 0, min(7, count($drawSequence)));
            $turn2Hand = array_slice($drawSequence, 0, min(8, count($drawSequence)));
            $turn3Hand = array_slice($drawSequence, 0, min(9, count($drawSequence)));
            $turn5Hand = array_slice($drawSequence, 0, min(11, count($drawSequence)));
            $turn3Stats = $this->handStats($turn3Hand, $comboPlans);
            $turn5Stats = $this->handStats($turn5Hand, $comboPlans);
            $this->countTurn3($turn3, $turn3Stats);
            $this->countTurn5($turn5, $turn5Stats);
            $this->countColorAccess($colorAccess['turn1'], $this->manaStats($turn1Hand, 1, $manaContext), $manaContext);
            $this->countColorAccess($colorAccess['turn2'], $this->manaStats($turn2Hand, 2, $manaContext), $manaContext);
            $this->countColorAccess($colorAccess['turn3'], $this->manaStats($turn3Hand, 3, $manaContext), $manaContext);
            $this->countCommanderCurve($commanderCurve, $drawSequence, $manaContext);
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
                'keepableManaRate' => $this->rate($opening['keepableMana'], $runs),
                'hasTwoLandsRate' => $this->rate($opening['hasTwoLands'], $runs),
                'hasThreeLandsRate' => $this->rate($opening['hasThreeLands'], $runs),
                'hasAtLeastOneUntappedSourceRate' => $this->rate($opening['hasAtLeastOneUntappedSource'], $runs),
                'hasCommanderColorsRate' => $this->rate($opening['hasCommanderColors'], $runs),
                'hasPrimaryColorRate' => $this->rate($opening['hasPrimaryColor'], $runs),
                'hasAllEarlyColorsRate' => $this->rate($opening['hasAllEarlyColors'], $runs),
                'tappedLandHeavyRate' => $this->rate($opening['tappedLandHeavy'], $runs),
                'fetchlandWithValidTargetRate' => $this->rate($opening['fetchlandWithValidTarget'], $runs),
                'fetchlandWithoutTargetRate' => $this->rate($opening['fetchlandWithoutTarget'], $runs),
                'fastlandEarlyAccessRate' => $this->rate($opening['fastlandEarlyAccess'], $runs),
                'slowlandEarlyDelayRate' => $this->rate($opening['slowlandEarlyDelay'], $runs),
                'painlandEarlyAccessRate' => $this->rate($opening['painlandEarlyAccess'], $runs),
                'pathwayColorChoicePressureRate' => $this->rate($opening['pathwayColorChoicePressure'], $runs),
                'filterlandNeedsInputRate' => $this->rate($opening['filterlandNeedsInput'], $runs),
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
            'colorAccess' => [
                'turn1' => $this->colorAccessRates($colorAccess['turn1'], $runs),
                'turn2' => $this->colorAccessRates($colorAccess['turn2'], $runs),
                'turn3' => $this->colorAccessRates($colorAccess['turn3'], $runs),
                'commanderCurve' => [
                    'canCastOnCurveRate' => $this->rate($commanderCurve['canCastOnCurve'], $runs),
                    'missingColorRate' => $this->rate($commanderCurve['missingColor'], $runs),
                    'missingManaValueRate' => $this->rate($commanderCurve['missingManaValue'], $runs),
                    'tappedOutDelayRate' => $this->rate($commanderCurve['tappedOutDelay'], $runs),
                ],
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
            'colorAccess' => [
                'turn1' => $this->emptyColorRates(),
                'turn2' => $this->emptyColorRates(),
                'turn3' => $this->emptyColorRates(),
                'commanderCurve' => [
                    'canCastOnCurveRate' => 0.0,
                    'missingColorRate' => 0.0,
                    'missingManaValueRate' => 0.0,
                    'tappedOutDelayRate' => 0.0,
                ],
            ],
        ];
    }

    /**
     * @param list<array{quantity:int,oracleId:string,section?:string,analysisProfile:array<string,mixed>,manaProfile?:array<string,mixed>}> $resolvedCards
     * @param array<string,mixed> $manaContext
     * @return list<array<string,mixed>>
     */
    private function library(array $resolvedCards, array $manaContext): array
    {
        $library = [];
        foreach ($resolvedCards as $card) {
            if (($card['section'] ?? 'main') === 'commander') {
                continue;
            }
            $flags = $this->cardFlags($card, $manaContext);
            for ($copy = 0; $copy < max(1, $card['quantity']); ++$copy) {
                $library[] = $flags;
            }
        }

        return $library;
    }

    /**
     * @param array{oracleId:string,analysisProfile:array<string,mixed>,manaProfile?:array<string,mixed>} $card
     * @param array<string,mixed> $manaContext
     * @return array<string,mixed>
     */
    private function cardFlags(array $card, array $manaContext): array
    {
        $profile = $card['analysisProfile'];
        $manaProfile = is_array($card['manaProfile'] ?? null) ? $card['manaProfile'] : [];
        $roles = $this->stringSet($profile['roles'] ?? []);
        $subroles = $this->stringSet($profile['subroles'] ?? []);
        $powerFlags = $this->stringSet($profile['powerFlags'] ?? []);
        $manaValue = is_numeric($profile['manaValue'] ?? null) ? (float) $profile['manaValue'] : 0.0;
        $oracleId = (string) $card['oracleId'];
        $fetchDetails = is_array($manaContext['fetchlandsByOracleId'][$oracleId] ?? null) ? $manaContext['fetchlandsByOracleId'][$oracleId] : [];
        $land = $this->boolPath($manaProfile, ['isLand']) || $this->boolPath($profile, ['types', 'land']) || isset($roles['land']);
        $isFetchland = $this->boolPath($manaProfile, ['isFetchland']);
        $burst = $this->boolPath($manaProfile, ['isBurstMana'])
            || $this->boolPath($manaProfile, ['isRitual'])
            || $this->boolPath($manaProfile, ['isOneShotMana'])
            || isset($roles['burst_mana'])
            || isset($roles['ritual'])
            || isset($subroles['one_shot_mana']);
        $costReducer = $this->boolPath($manaProfile, ['isCostReducer']) || isset($roles['cost_reducer']);
        $permanentRamp = !$costReducer
            && !$burst
            && ($this->boolPath($manaProfile, ['isPermanentRamp'])
                || $this->boolPath($manaProfile, ['isLandRamp'])
                || $this->boolPath($manaProfile, ['isManaRock'])
                || $this->boolPath($manaProfile, ['isManaDork'])
                || (isset($roles['ramp']) && $this->roleRepeatability($profile, 'ramp') !== 'one_shot'));
        $fastMana = !$costReducer && ($this->boolPath($manaProfile, ['isFastMana']) || isset($roles['fast_mana']) || isset($powerFlags['fast_mana']) || $this->boolPath($profile, ['flags', 'fastMana']));
        $earlyInteraction = isset($roles['spot_removal'])
            || isset($roles['creature_removal'])
            || isset($roles['artifact_removal'])
            || isset($roles['enchantment_removal'])
            || isset($roles['counterspell'])
            || isset($roles['graveyard_hate'])
            || $this->boolPath($profile, ['flags', 'freeInteraction']);
        $drawOrSelection = isset($roles['draw']) || isset($roles['card_selection']);
        $trueTutor = !$land
            && !$this->boolPath($manaProfile, ['isFetchland'])
            && !$this->boolPath($manaProfile, ['isLandRamp'])
            && !$this->boolPath($manaProfile, ['isLandTutor'])
            && !$this->boolPath($manaProfile, ['isLandSearchToBattlefield'])
            && (isset($subroles['true_tutor']) || (isset($roles['tutor']) && !$this->hasAny($subroles, ['land_tutor', 'ramp_search', 'opponent_tutor', 'fetchland'])));
        $protection = isset($roles['protection']);
        $wincon = isset($roles['wincon']) || isset($powerFlags['compact_wincon']);
        $comboPiece = isset($roles['combo_piece']) || isset($powerFlags['compact_wincon']) || isset($powerFlags['mana_positive_combo_piece']);
        $development = $permanentRamp || $fastMana || $drawOrSelection || $trueTutor || $wincon || $comboPiece || isset($roles['enabler']) || isset($roles['token_maker']) || $costReducer;
        $earlyPlay = !$land && $manaValue <= 2.0 && ($development || $earlyInteraction || $protection);
        $colors = $this->manaColors($manaProfile, $profile, $manaContext);
        $cycle = mb_strtolower((string) ($manaProfile['landCycleType'] ?? 'other'));

        return [
            'oracleId' => $oracleId,
            'land' => $land,
            'isFetchland' => $isFetchland,
            'fetchHasValidTarget' => $isFetchland && ($fetchDetails === [] ? false : !($fetchDetails['dead'] ?? true)),
            'fetchEffectiveColors' => $this->colorNameList($fetchDetails['effectiveColors'] ?? []),
            'fetchUntappedColors' => $this->colorNameList($fetchDetails['untappedEffectiveColors'] ?? []),
            'fetchTappedOnlyColors' => $this->colorNameList($fetchDetails['tappedOnlyEffectiveColors'] ?? []),
            'landCycleType' => $cycle,
            'basicLandTypes' => $this->stringList($manaProfile['basicLandTypes'] ?? []),
            'producedColors' => $colors,
            'producesAnyColor' => $this->boolPath($manaProfile, ['producesAnyColor']),
            'producesColorless' => $this->boolPath($manaProfile, ['producesColorless']) || in_array('colorless', $colors, true),
            'entersTapped' => $this->boolPath($manaProfile, ['entersTapped']),
            'entersTappedConditionally' => $this->boolPath($manaProfile, ['entersTappedConditionally']) || $this->boolPath($manaProfile, ['producedManaIsConditional']),
            'canEnterUntapped' => $this->boolPath($manaProfile, ['canEnterUntapped']),
            'requiresInputMana' => $this->boolPath($manaProfile, ['requiresInputMana']) || $cycle === 'filterland',
            'isColorlessUtilityLand' => $this->boolPath($manaProfile, ['isColorlessUtilityLand']),
            'permanentRamp' => $permanentRamp,
            'manaRock' => $this->boolPath($manaProfile, ['isManaRock']),
            'manaDork' => $this->boolPath($manaProfile, ['isManaDork']),
            'fastMana' => $fastMana,
            'burstMana' => $burst,
            'costReducer' => $costReducer,
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
     * @param array<string,mixed> $manaStats
     * @return array{keepable:bool,tooFewLands:bool,tooManyLands:bool,noEarlyPlay:bool,tooTopHeavy:bool}
     */
    private function keepEvaluation(array $stats, array $manaStats = []): array
    {
        $tooFewLands = $stats['lands'] <= 1;
        $tooManyLands = $stats['lands'] >= 5;
        $noEarlyPlay = $stats['earlyPlay'] < 1;
        $tooTopHeavy = $stats['highManaValue'] > 2;
        $hasSupport = ($stats['permanentRamp'] + $stats['drawOrSelection'] + $stats['earlyInteraction'] + $stats['trueTutor']) > 0;
        $reactiveOnly = $stats['reactive'] > 0 && $stats['development'] === 0;
        $hasManaSupport = $manaStats === []
            || (($manaStats['hasPrimaryColor'] ?? true) === true
                && ($manaStats['hasAllEarlyColors'] ?? true) === true
                && ($manaStats['tappedLandHeavy'] ?? false) === false
                && ($manaStats['hasAtLeastOneUntappedSource'] ?? true) === true);

        return [
            'keepable' => !$tooFewLands && !$tooManyLands && !$noEarlyPlay && !$tooTopHeavy && $hasSupport && !$reactiveOnly && $hasManaSupport,
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
     * @param array<string,int> $opening
     * @param array<string,mixed> $stats
     * @param array<string,mixed> $manaContext
     */
    private function countOpeningMana(array &$opening, array $stats, array $manaContext): void
    {
        $opening['keepableMana'] += ($stats['keepableMana'] ?? false) ? 1 : 0;
        $opening['hasTwoLands'] += ($stats['lands'] ?? 0) === 2 ? 1 : 0;
        $opening['hasThreeLands'] += ($stats['lands'] ?? 0) === 3 ? 1 : 0;
        $opening['hasAtLeastOneUntappedSource'] += ($stats['hasAtLeastOneUntappedSource'] ?? false) ? 1 : 0;
        $opening['hasCommanderColors'] += ($stats['hasCommanderColors'] ?? false) ? 1 : 0;
        $opening['hasPrimaryColor'] += ($stats['hasPrimaryColor'] ?? false) ? 1 : 0;
        $opening['hasAllEarlyColors'] += ($stats['hasAllEarlyColors'] ?? false) ? 1 : 0;
        $opening['tappedLandHeavy'] += ($stats['tappedLandHeavy'] ?? false) ? 1 : 0;
        $opening['fetchlandWithValidTarget'] += ($stats['fetchlandWithValidTarget'] ?? false) ? 1 : 0;
        $opening['fetchlandWithoutTarget'] += ($stats['fetchlandWithoutTarget'] ?? false) ? 1 : 0;
        $opening['fastlandEarlyAccess'] += ($stats['fastlandEarlyAccess'] ?? false) ? 1 : 0;
        $opening['slowlandEarlyDelay'] += ($stats['slowlandEarlyDelay'] ?? false) ? 1 : 0;
        $opening['painlandEarlyAccess'] += ($stats['painlandEarlyAccess'] ?? false) ? 1 : 0;
        $opening['pathwayColorChoicePressure'] += ($stats['pathwayColorChoicePressure'] ?? false) ? 1 : 0;
        $opening['filterlandNeedsInput'] += ($stats['filterlandNeedsInput'] ?? false) ? 1 : 0;
        unset($manaContext);
    }

    /**
     * @param array<string,int> $bucket
     * @param array<string,mixed> $stats
     * @param array<string,mixed> $manaContext
     */
    private function countColorAccess(array &$bucket, array $stats, array $manaContext): void
    {
        $colors = is_array($stats['colors'] ?? null) ? $stats['colors'] : [];
        foreach (self::COLOR_NAMES as $color) {
            $bucket[$color] += isset($colors[$color]) ? 1 : 0;
        }
        $bucket['allCommanderColors'] += $this->hasColors($colors, $this->stringList($manaContext['commanderColors'] ?? [])) ? 1 : 0;
    }

    /**
     * @param array<string,int> $commanderCurve
     * @param list<array<string,mixed>> $drawSequence
     * @param array<string,mixed> $manaContext
     */
    private function countCommanderCurve(array &$commanderCurve, array $drawSequence, array $manaContext): void
    {
        $commander = is_array($manaContext['commander'] ?? null) ? $manaContext['commander'] : [];
        if ($commander === []) {
            return;
        }

        $curveTurn = max(1, min(5, (int) ceil((float) ($commander['manaValue'] ?? 0.0))));
        $curveHand = array_slice($drawSequence, 0, min(7 + max(0, $curveTurn - 1), count($drawSequence)));
        $curveStats = $this->manaStats($curveHand, $curveTurn, $manaContext);
        $nextStats = $this->manaStats(array_slice($drawSequence, 0, min(7 + $curveTurn, count($drawSequence))), min(5, $curveTurn + 1), $manaContext);
        $requiredColors = is_array($commander['requiredColors'] ?? null) ? $commander['requiredColors'] : [];
        $colors = is_array($curveStats['colors'] ?? null) ? $curveStats['colors'] : [];
        $nextColors = is_array($nextStats['colors'] ?? null) ? $nextStats['colors'] : [];
        $hasColors = $this->hasRequiredPips($colors, $requiredColors);
        $hasManaValue = (int) ($curveStats['totalMana'] ?? 0) >= (int) ceil((float) ($commander['manaValue'] ?? 0.0));

        if ($hasColors && $hasManaValue) {
            ++$commanderCurve['canCastOnCurve'];

            return;
        }

        $commanderCurve['missingColor'] += !$hasColors ? 1 : 0;
        $commanderCurve['missingManaValue'] += !$hasManaValue ? 1 : 0;
        if (($curveStats['tappedLands'] ?? 0) > 0 && $this->hasRequiredPips($nextColors, $requiredColors) && (int) ($nextStats['totalMana'] ?? 0) >= (int) ceil((float) ($commander['manaValue'] ?? 0.0))) {
            ++$commanderCurve['tappedOutDelay'];
        }
    }

    /**
     * @param array<string,int> $mulligan
     * @param list<array<string,mixed>> $library
     * @param list<list<string>> $comboPlans
     */
    private function countMulligan(array &$mulligan, int &$mulligansNeeded, array $openingKeep, array $library, array $comboPlans, array $manaContext, int &$seed): void
    {
        if ($openingKeep['keepable']) {
            ++$mulligan['keepAt7'];

            return;
        }

        $six = $this->sample($library, 7, $seed);
        $keepAt6 = $this->keepEvaluation($this->handStats($six, $comboPlans), $this->manaStats($six, 2, $manaContext));
        if ($keepAt6['keepable']) {
            ++$mulligan['keepAt6'];
            ++$mulligansNeeded;

            return;
        }

        $five = $this->sample($library, 7, $seed);
        $keepAt5 = $this->keepEvaluation($this->handStats($five, $comboPlans), $this->manaStats($five, 2, $manaContext));
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
     * @param list<array<string,mixed>> $hand
     * @param array<string,mixed> $manaContext
     * @return array<string,mixed>
     */
    private function manaStats(array $hand, int $turn, array $manaContext): array
    {
        $landCount = 0;
        $tappedLands = 0;
        $tappedPressureLands = 0;
        $conditionalTappedLands = 0;
        $untappedSources = 0;
        $permanentRamp = 0;
        $fastMana = 0;
        $colors = [];
        $rawUntappedColors = [];
        $typedLandTypes = [];
        $hasNonFilterInput = false;
        $hasFastlandEarlyAccess = false;
        $hasSlowlandEarlyDelay = false;
        $hasPainlandEarlyAccess = false;
        $hasPathwayPressure = false;
        $hasFilterInputProblem = false;
        $hasValidFetch = false;
        $hasDeadFetch = false;
        $filterlands = [];

        foreach ($hand as $card) {
            if (($card['land'] ?? false) === true) {
                ++$landCount;
                foreach ($this->stringList($card['basicLandTypes'] ?? []) as $type) {
                    $typedLandTypes[$type] = true;
                }
            }
        }

        foreach ($hand as $card) {
            $cycle = (string) ($card['landCycleType'] ?? 'other');
            if (($card['land'] ?? false) === true) {
                $tapped = $this->landDelayedByTurn($card, $turn, $typedLandTypes);
                $tappedLands += $tapped ? 1 : 0;
                $tappedPressureLands += $this->landAddsOpeningTappedPressure($card) ? 1 : 0;
                $conditionalTappedLands += ($card['entersTappedConditionally'] ?? false) === true ? 1 : 0;

                if (($card['isFetchland'] ?? false) === true) {
                    if (($card['fetchHasValidTarget'] ?? false) === true) {
                        $hasValidFetch = true;
                        $this->addColorSet($colors, $turn === 1 ? $this->stringList($card['fetchUntappedColors'] ?? []) : $this->stringList($card['fetchEffectiveColors'] ?? []));
                        $this->addColorSet($rawUntappedColors, $this->stringList($card['fetchUntappedColors'] ?? []));
                    } else {
                        $hasDeadFetch = true;
                    }
                    continue;
                }

                if ($cycle === 'filterland') {
                    $filterlands[] = $card;
                    continue;
                }

                if ($cycle === 'pathway') {
                    $pathwayColor = $this->choosePathwayColor($card, $manaContext);
                    if ($pathwayColor !== null && !$tapped) {
                        $colors[$pathwayColor] = true;
                        $rawUntappedColors[$pathwayColor] = true;
                        $hasNonFilterInput = true;
                    }
                    $hasPathwayPressure = count($this->stringList($card['producedColors'] ?? [])) > 1 && !$this->hasColors($colors, $this->stringList($manaContext['earlyColors'] ?? []));
                    continue;
                }

                if (!$tapped) {
                    $cardColors = $this->colorsForCard($card, $manaContext);
                    $this->addColorSet($colors, $cardColors);
                    $this->addColorSet($rawUntappedColors, $cardColors);
                    $hasNonFilterInput = $hasNonFilterInput || $cardColors !== [] || (($card['producesColorless'] ?? false) === true);
                    ++$untappedSources;
                }

                $hasFastlandEarlyAccess = $hasFastlandEarlyAccess || ($cycle === 'fastland' && $turn <= 2 && !$tapped);
                $hasSlowlandEarlyDelay = $hasSlowlandEarlyDelay || ($cycle === 'slowland' && $turn <= 2);
                $hasPainlandEarlyAccess = $hasPainlandEarlyAccess || ($cycle === 'painland' && !$tapped);
                continue;
            }

            if (($card['costReducer'] ?? false) === true || ($card['burstMana'] ?? false) === true) {
                continue;
            }

            if (($card['fastMana'] ?? false) === true) {
                ++$fastMana;
            }
            if (($card['permanentRamp'] ?? false) === true) {
                ++$permanentRamp;
            }
            if ($turn >= 3 && (($card['manaRock'] ?? false) === true || ($card['manaDork'] ?? false) === true)) {
                $this->addColorSet($colors, $this->colorsForCard($card, $manaContext));
            }
        }

        foreach ($filterlands as $card) {
            if (!$hasNonFilterInput) {
                $hasFilterInputProblem = true;
                continue;
            }
            if (!$this->landDelayedByTurn($card, $turn, $typedLandTypes)) {
                $this->addColorSet($colors, $this->colorsForCard($card, $manaContext));
            }
        }

        $commanderColors = $this->stringList($manaContext['commanderColors'] ?? []);
        $earlyColors = $this->stringList($manaContext['earlyColors'] ?? []);
        $primaryColor = is_string($manaContext['primaryColor'] ?? null) ? $manaContext['primaryColor'] : null;
        $tappedHeavy = $landCount >= 2 && ($tappedPressureLands + $conditionalTappedLands) >= max(2, (int) ceil($landCount / 2));

        return [
            'lands' => $landCount,
            'colors' => $colors,
            'untappedColors' => $rawUntappedColors,
            'tappedLands' => $tappedLands,
            'hasAtLeastOneUntappedSource' => $untappedSources > 0 || $rawUntappedColors !== [],
            'hasCommanderColors' => $this->hasColors($colors, $commanderColors),
            'hasPrimaryColor' => $primaryColor === null || isset($colors[$primaryColor]),
            'hasAllEarlyColors' => $this->hasColors($colors, $earlyColors),
            'tappedLandHeavy' => $tappedHeavy,
            'keepableMana' => $landCount >= 2 && $landCount <= 4 && !$tappedHeavy && ($rawUntappedColors !== []) && ($primaryColor === null || isset($colors[$primaryColor])) && $this->hasColors($colors, $earlyColors),
            'fetchlandWithValidTarget' => $hasValidFetch,
            'fetchlandWithoutTarget' => $hasDeadFetch,
            'fastlandEarlyAccess' => $hasFastlandEarlyAccess,
            'slowlandEarlyDelay' => $hasSlowlandEarlyDelay,
            'painlandEarlyAccess' => $hasPainlandEarlyAccess,
            'pathwayColorChoicePressure' => $hasPathwayPressure,
            'filterlandNeedsInput' => $hasFilterInputProblem,
            'totalMana' => min($landCount, $turn) + $permanentRamp + $fastMana,
        ];
    }

    /**
     * @param array<string,mixed> $card
     * @param array<string,true> $typedLandTypes
     */
    private function landDelayedByTurn(array $card, int $turn, array $typedLandTypes): bool
    {
        $cycle = (string) ($card['landCycleType'] ?? 'other');
        if (($card['entersTapped'] ?? false) === true || in_array($cycle, ['triome', 'surveil_land', 'temple', 'gain_land', 'bounce_land'], true)) {
            return $turn <= 1;
        }
        if ($cycle === 'slowland') {
            return $turn <= 2;
        }
        if ($cycle === 'checkland') {
            return $typedLandTypes === [] && $turn <= 2;
        }
        if (($card['entersTappedConditionally'] ?? false) === true && ($card['canEnterUntapped'] ?? false) !== true) {
            return $turn <= 2;
        }

        return false;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function landAddsOpeningTappedPressure(array $card): bool
    {
        $cycle = (string) ($card['landCycleType'] ?? 'other');

        return ($card['entersTapped'] ?? false) === true
            || ($card['entersTappedConditionally'] ?? false) === true
            || in_array($cycle, ['triome', 'surveil_land', 'temple', 'gain_land', 'bounce_land', 'slowland', 'checkland'], true);
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
        $colorAccess = is_array($consistency['colorAccess'] ?? null) ? $consistency['colorAccess'] : [];
        $commanderCurve = is_array($colorAccess['commanderCurve'] ?? null) ? $colorAccess['commanderCurve'] : [];

        $this->issueIf($issues, $opening['keepableHandRate'] < 0.60, 'low_keepable_hand_rate', sprintf('Opening hand simulation estimates a %.1f%% keepable hand rate.', $opening['keepableHandRate'] * 100));
        $this->issueIf($issues, ($opening['keepableManaRate'] ?? 1.0) < 0.60, 'low_early_color_access', sprintf('Opening hand simulation estimates a %.1f%% keepable mana rate.', ((float) ($opening['keepableManaRate'] ?? 0.0)) * 100));
        $this->issueIf($issues, ($opening['hasPrimaryColorRate'] ?? 1.0) < 0.70, 'weak_primary_color_sources', sprintf('Opening hand simulation estimates %.1f%% access to the primary color.', ((float) ($opening['hasPrimaryColorRate'] ?? 0.0)) * 100));
        $this->issueIf($issues, ($commanderCurve['canCastOnCurveRate'] ?? 1.0) < 0.55, 'low_commander_castability', sprintf('Commander curve simulation estimates %.1f%% on-curve castability.', ((float) ($commanderCurve['canCastOnCurveRate'] ?? 0.0)) * 100));
        $this->issueIf($issues, $mulligan['keepableBy6Rate'] < 0.75, 'high_mulligan_pressure', sprintf('Opening hand simulation estimates only %.1f%% keepable hands by a mulligan to 6.', $mulligan['keepableBy6Rate'] * 100));
        $this->issueIf($issues, $opening['zeroOrOneLandRate'] > 0.30, 'too_many_low_land_openers', sprintf('Opening hand simulation estimates %.1f%% zero-or-one-land hands.', $opening['zeroOrOneLandRate'] * 100));
        $this->issueIf($issues, $opening['fivePlusLandsRate'] > 0.20, 'too_many_flooded_openers', sprintf('Opening hand simulation estimates %.1f%% five-plus-land hands.', $opening['fivePlusLandsRate'] * 100));
        $this->issueIf($issues, ($opening['tappedLandHeavyRate'] ?? 0.0) > 0.25, 'mana_base_too_slow', sprintf('Opening hand simulation estimates %.1f%% tapped-land-heavy hands.', ((float) ($opening['tappedLandHeavyRate'] ?? 0.0)) * 100));
        $this->issueIf($issues, ($opening['slowlandEarlyDelayRate'] ?? 0.0) > 0.25, 'too_many_slow_lands', sprintf('Opening hand simulation estimates %.1f%% hands delayed by slowlands.', ((float) ($opening['slowlandEarlyDelayRate'] ?? 0.0)) * 100));
        $this->issueIf($issues, ($opening['fetchlandWithoutTargetRate'] ?? 0.0) > 0.0, 'fetchlands_without_targets', sprintf('Opening hand simulation estimates %.1f%% hands with dead fetchlands.', ((float) ($opening['fetchlandWithoutTargetRate'] ?? 0.0)) * 100));
        $this->issueIf($issues, ($opening['filterlandNeedsInputRate'] ?? 0.0) > 0.10, 'filterlands_need_input_sources', sprintf('Opening hand simulation estimates %.1f%% hands where filterlands need input sources.', ((float) ($opening['filterlandNeedsInputRate'] ?? 0.0)) * 100));
        $this->issueIf($issues, ($opening['pathwayColorChoicePressureRate'] ?? 0.0) > 0.20, 'pathways_create_color_choice_pressure', sprintf('Opening hand simulation estimates %.1f%% pathway color choice pressure.', ((float) ($opening['pathwayColorChoicePressureRate'] ?? 0.0)) * 100));
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
     * @param list<array{quantity:int,oracleId:string,section?:string,analysisProfile:array<string,mixed>,manaProfile?:array<string,mixed>,name?:string}> $resolvedCards
     * @param array<string,mixed> $mana
     * @return array<string,mixed>
     */
    private function manaContext(array $resolvedCards, array $mana): array
    {
        $commanderColors = [];
        $earlyDemand = is_array($mana['requirements']['earlyPipDemand'] ?? null) ? $mana['requirements']['earlyPipDemand'] : [];
        $earlyColors = [];
        $primaryColor = null;
        $primaryDemand = 0;
        $commander = [];

        foreach ($earlyDemand as $color => $demand) {
            if (!in_array($color, self::COLOR_NAMES, true) || (int) $demand <= 0) {
                continue;
            }
            $earlyColors[] = $color;
            if ((int) $demand > $primaryDemand) {
                $primaryDemand = (int) $demand;
                $primaryColor = $color;
            }
        }

        foreach ($resolvedCards as $card) {
            $profile = is_array($card['analysisProfile'] ?? null) ? $card['analysisProfile'] : [];
            foreach ($this->colorNamesFromSymbols($this->stringList($profile['colorIdentity'] ?? [])) as $color) {
                if (($card['section'] ?? 'main') === 'commander') {
                    $commanderColors[$color] = true;
                }
            }
            if (($card['section'] ?? 'main') !== 'commander' || $commander !== []) {
                continue;
            }
            $manaValue = is_numeric($profile['manaValue'] ?? null) ? (float) $profile['manaValue'] : 0.0;
            $commander = [
                'manaValue' => $manaValue,
                'requiredColors' => $this->manaCostPips($this->stringOrNull($profile['manaCost'] ?? null)),
            ];
        }

        if ($commanderColors === [] && is_array($mana['requirements']['commanderCastability'] ?? null)) {
            foreach (array_keys($mana['requirements']['commanderCastability']) as $color) {
                if (in_array($color, self::COLOR_NAMES, true)) {
                    $commanderColors[$color] = true;
                }
            }
        }
        if ($earlyColors === []) {
            $earlyColors = array_keys($commanderColors);
        }
        if ($primaryColor === null && $earlyColors !== []) {
            $primaryColor = $earlyColors[0];
        }

        return [
            'commanderColors' => array_keys($commanderColors),
            'earlyColors' => array_values(array_unique($earlyColors)),
            'primaryColor' => $primaryColor,
            'commander' => $commander,
            'fetchlandsByOracleId' => $this->fetchlandsByOracleId($mana),
        ];
    }

    /**
     * @return array<string,array<string,mixed>>
     */
    private function fetchlandsByOracleId(array $mana): array
    {
        $byOracleId = [];
        $details = is_array($mana['fetchlands']['details'] ?? null) ? $mana['fetchlands']['details'] : [];
        foreach ($details as $detail) {
            if (!is_array($detail) || !is_string($detail['oracleId'] ?? null)) {
                continue;
            }
            $byOracleId[$detail['oracleId']] = $detail;
        }

        return $byOracleId;
    }

    /**
     * @param array<string,mixed> $manaProfile
     * @param array<string,mixed> $analysisProfile
     * @param array<string,mixed> $manaContext
     * @return list<string>
     */
    private function manaColors(array $manaProfile, array $analysisProfile, array $manaContext): array
    {
        $colors = $this->colorNamesFromSymbols($this->stringList($manaProfile['producedManaColors'] ?? []));
        if ($colors === []) {
            $colors = $this->colorNamesFromSymbols($this->stringList($analysisProfile['producedMana'] ?? []));
        }
        if (($manaProfile['producesAnyColor'] ?? false) === true) {
            $colors = [...$colors, ...$this->stringList($manaContext['commanderColors'] ?? [])];
        }
        if (($manaProfile['producesColorless'] ?? false) === true) {
            $colors[] = 'colorless';
        }

        return array_values(array_unique($colors));
    }

    /**
     * @param array<string,mixed> $card
     * @param array<string,mixed> $manaContext
     * @return list<string>
     */
    private function colorsForCard(array $card, array $manaContext): array
    {
        $colors = $this->stringList($card['producedColors'] ?? []);
        if (($card['producesAnyColor'] ?? false) === true) {
            $colors = [...$colors, ...$this->stringList($manaContext['commanderColors'] ?? [])];
        }

        return array_values(array_unique(array_filter($colors, static fn (string $color): bool => $color !== 'colorless')));
    }

    /**
     * @param array<string,true> $colors
     * @param list<string> $newColors
     */
    private function addColorSet(array &$colors, array $newColors): void
    {
        foreach ($newColors as $color) {
            if (in_array($color, self::COLOR_NAMES, true)) {
                $colors[$color] = true;
            }
        }
    }

    /**
     * @param array<string,mixed> $card
     * @param array<string,mixed> $manaContext
     */
    private function choosePathwayColor(array $card, array $manaContext): ?string
    {
        $colors = array_values(array_filter($this->stringList($card['producedColors'] ?? []), static fn (string $color): bool => in_array($color, self::COLOR_NAMES, true)));
        if ($colors === []) {
            return null;
        }
        foreach ($this->stringList($manaContext['earlyColors'] ?? []) as $wanted) {
            if (in_array($wanted, $colors, true)) {
                return $wanted;
            }
        }

        return $colors[0];
    }

    /**
     * @param array<string,true> $colors
     * @param list<string> $required
     */
    private function hasColors(array $colors, array $required): bool
    {
        foreach ($required as $color) {
            if (!isset($colors[$color])) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param array<string,true> $colors
     * @param array<string,int> $requiredPips
     */
    private function hasRequiredPips(array $colors, array $requiredPips): bool
    {
        foreach ($requiredPips as $color => $required) {
            if ((int) $required > 0 && !isset($colors[$color])) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param list<string> $colors
     * @return list<string>
     */
    private function colorNamesFromSymbols(array $colors): array
    {
        $names = [];
        foreach ($colors as $color) {
            $normalized = mb_strtoupper(trim($color));
            if (isset(self::COLOR_KEYS[$normalized])) {
                $names[] = self::COLOR_KEYS[$normalized];
                continue;
            }
            $lower = mb_strtolower(trim($color));
            if (in_array($lower, [...self::COLOR_NAMES, 'colorless'], true)) {
                $names[] = $lower;
            }
        }

        return array_values(array_unique($names));
    }

    /**
     * @param list<mixed> $colors
     * @return list<string>
     */
    private function colorNameList(array $colors): array
    {
        return $this->colorNamesFromSymbols($this->stringList($colors));
    }

    /**
     * @return array<string,int>
     */
    private function emptyColorAccessCounters(): array
    {
        return array_fill_keys([...self::COLOR_NAMES, 'allCommanderColors'], 0);
    }

    /**
     * @return array<string,float>
     */
    private function emptyColorRates(): array
    {
        return array_fill_keys([...self::COLOR_NAMES, 'allCommanderColors'], 0.0);
    }

    /**
     * @param array<string,int> $counters
     * @return array<string,float>
     */
    private function colorAccessRates(array $counters, int $runs): array
    {
        $rates = [];
        foreach ([...self::COLOR_NAMES, 'allCommanderColors'] as $key) {
            $rates[$key] = $this->rate((int) ($counters[$key] ?? 0), $runs);
        }

        return $rates;
    }

    /**
     * @return array<string,int>
     */
    private function manaCostPips(?string $manaCost): array
    {
        $pips = array_fill_keys(self::COLOR_NAMES, 0);
        if ($manaCost === null || $manaCost === '') {
            return $pips;
        }
        foreach (self::COLOR_KEYS as $symbol => $color) {
            $pips[$color] = preg_match_all('/\{[^}]*'.preg_quote($symbol, '/').'[^}]*\}/i', $manaCost);
        }

        return $pips;
    }

    private function stringOrNull(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }
        $string = trim((string) $value);

        return $string !== '' ? $string : null;
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
