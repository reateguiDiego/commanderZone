<?php

namespace App\Application\Deck;

final class DeckBracketClassifier
{
    public const METHOD = 'commander_brackets_beta_v1';

    private const LABELS = [
        1 => 'Exhibition',
        2 => 'Core',
        3 => 'Upgraded',
        4 => 'Optimized',
        5 => 'cEDH',
    ];

    private const WARNING = 'Commander Brackets are a pregame communication tool. CommanderZone assigns an operational bracket from detectable deck signals.';

    private const OFFICIAL_CRITERIA = [
        [
            'bracket' => 1,
            'label' => 'Exhibition',
            'summary' => 'Theme-first decks with no Game Changers, no mass land denial, no extra turns and no two-card combos.',
        ],
        [
            'bracket' => 2,
            'label' => 'Core',
            'summary' => 'Casual functional decks with no Game Changers, no mass land denial, no chaining extra turns and no two-card combos.',
        ],
        [
            'bracket' => 3,
            'label' => 'Upgraded',
            'summary' => 'Upgraded decks with up to 3 Game Changers, no mass land denial, no chaining extra turns and no two-card combos before turn 6.',
        ],
        [
            'bracket' => 4,
            'label' => 'Optimized',
            'summary' => 'Optimized decks with no deck restrictions; can include mass land denial, early combos, many Game Changers and high speed.',
        ],
        [
            'bracket' => 5,
            'label' => 'cEDH',
            'summary' => 'cEDH metagame decks with optimized win conditions, fast mana, efficient tutors, free interaction and strong mana efficiency.',
        ],
    ];

    private const DIFFERENCE_MODEL = [
        'theme' => 'Difference between Bracket 1 and 2.',
        'staples' => 'Difference between Bracket 2 and 3.',
        'speed' => 'Difference between Bracket 3 and 4.',
        'metagame' => 'Difference between Bracket 4 and 5.',
        'manaEfficiency' => 'Important factor for Bracket 5.',
    ];

    /**
     * @param array<string,mixed> $signals
     * @return array<string,mixed>
     */
    public function classify(array $signals): array
    {
        $floor = $this->officialFloor($signals);
        $scores = $this->differenceScores($signals);
        $ceiling = $this->ceiling($signals, $scores);
        $bracket = $this->assignBracket($floor, $ceiling, $signals, $scores);
        $confidence = $this->confidence($bracket, $floor, $ceiling, $signals, $scores);
        $ruleBreakers = $this->ruleBreakers($signals);
        $officialSignals = $this->officialSignals($signals);
        $reasonCodes = $this->reasonCodes($bracket, $floor, $ceiling, $signals, $scores);
        $reasons = $this->reasons($bracket, $floor, $ceiling, $signals, $scores);

        return [
            'bracket' => $bracket,
            'label' => self::LABELS[$bracket],
            'confidence' => $confidence,
            'method' => self::METHOD,
            'floor' => $floor,
            'ceiling' => $ceiling,
            'ruleBreakers' => $ruleBreakers,
            'differences' => $scores,
            'officialSignals' => $officialSignals,
            'reasonCodes' => $reasonCodes,
            'reasons' => $reasons,
            'warnings' => [self::WARNING],
            'explanation' => $this->explanation($bracket, $floor, $ceiling, $signals, $scores, $ruleBreakers, $reasonCodes, $reasons),
        ];
    }

    /**
     * @param array<string,mixed> $signals
     */
    private function officialFloor(array $signals): int
    {
        $floor = 1;
        $gameChangers = $this->count($signals, 'gameChangerSignal');
        if ($gameChangers >= 4) {
            $floor = max($floor, 4);
        } elseif ($gameChangers >= 1) {
            $floor = max($floor, 3);
        }

        if ($this->count($signals, 'massLandDenialSignal') >= 1) {
            $floor = max($floor, 4);
        }

        $extraTurns = $this->signal($signals, 'extraTurnSignal');
        if ((int) ($extraTurns['count'] ?? 0) > 0) {
            $floor = max($floor, 2);
        }
        if (($extraTurns['chainsOrLoops'] ?? false) === true || ($extraTurns['repeatableExtraTurns'] ?? false) === true) {
            $floor = max($floor, 4);
        }

        $twoCardCombos = $this->signal($signals, 'twoCardComboSignal');
        if ((int) ($twoCardCombos['count'] ?? 0) > 0) {
            $floor = max($floor, 3);
        }
        if ((int) ($twoCardCombos['beforeTurnSix'] ?? 0) > 0) {
            $floor = max($floor, 4);
        }

        return $floor;
    }

    /**
     * @param array<string,mixed> $signals
     * @return array{themeScore:int,staplesScore:int,speedScore:int,metagameScore:int,manaEfficiencyScore:int}
     */
    private function differenceScores(array $signals): array
    {
        $gameChangers = $this->count($signals, 'gameChangerSignal');
        $nonLandTutors = $this->signal($signals, 'nonLandTutorSignal');
        $fastMana = $this->signal($signals, 'fastManaSignal');
        $freeInteraction = $this->signal($signals, 'freeInteractionSignal');
        $compactWincons = $this->signal($signals, 'compactWinconSignal');
        $manaEfficiency = $this->signal($signals, 'manaEfficiencySignal');
        $theme = $this->signal($signals, 'themeSignal');
        $staples = $this->signal($signals, 'staplesSignal');
        $speed = $this->signal($signals, 'speedSignal');
        $metagame = $this->signal($signals, 'metagameSignal');

        $manaEfficiencyScore = $this->score($manaEfficiency);
        $staplesScore = $this->clamp(
            $this->score($staples)
            + $gameChangers * 12
            + (int) ($freeInteraction['count'] ?? 0) * 4
            + (int) round($this->score($theme) * 0.15)
        );
        $speedScore = $this->clamp(
            $this->score($speed)
            + (int) ($nonLandTutors['efficientCount'] ?? 0) * 6
            + (int) ($compactWincons['count'] ?? 0) * 8
            + (int) ($freeInteraction['premiumCount'] ?? 0) * 4
        );
        $metagameScore = $this->clamp(
            $this->score($metagame)
            + (int) ($staples['cedhStaples'] ?? 0) * 8
            + (int) ($fastMana['premiumCount'] ?? 0) * 8
            + (int) ($nonLandTutors['efficientCount'] ?? 0) * 7
            + (int) ($freeInteraction['premiumCount'] ?? 0) * 8
            + (int) ($compactWincons['count'] ?? 0) * 10
        );
        $highestPowerSignal = max($staplesScore, $speedScore, $metagameScore, $manaEfficiencyScore);
        $themeScore = $this->clamp(100 - $highestPowerSignal + ($manaEfficiencyScore < 30 ? 25 : 0));

        return [
            'themeScore' => $themeScore,
            'staplesScore' => $staplesScore,
            'speedScore' => $speedScore,
            'metagameScore' => $metagameScore,
            'manaEfficiencyScore' => $manaEfficiencyScore,
        ];
    }

    /**
     * @param array<string,mixed> $signals
     * @param array<string,int> $scores
     */
    private function ceiling(array $signals, array $scores): int
    {
        if ($this->hasCedhPackage($signals, $scores)) {
            return 5;
        }

        if ($scores['metagameScore'] >= 75 && $scores['manaEfficiencyScore'] < 60) {
            return 4;
        }

        return 5;
    }

    /**
     * @param array<string,mixed> $signals
     * @param array<string,int> $scores
     */
    private function assignBracket(int $floor, int $ceiling, array $signals, array $scores): int
    {
        if ($this->hasCedhPackage($signals, $scores)) {
            return 5;
        }

        if ($floor >= 4) {
            return min(4, $ceiling);
        }

        if ($floor === 3) {
            return min($scores['speedScore'] >= 70 ? 4 : 3, $ceiling);
        }

        if ($scores['speedScore'] >= 70) {
            return min(4, $ceiling);
        }
        if ($scores['staplesScore'] >= 50) {
            return 3;
        }
        if ($scores['themeScore'] >= 80 && $scores['staplesScore'] < 30 && $scores['speedScore'] < 35) {
            return 1;
        }

        return 2;
    }

    /**
     * @param array<string,mixed> $signals
     * @param array<string,int> $scores
     */
    private function hasCedhPackage(array $signals, array $scores): bool
    {
        $fastMana = $this->signal($signals, 'fastManaSignal');
        $nonLandTutors = $this->signal($signals, 'nonLandTutorSignal');
        $freeInteraction = $this->signal($signals, 'freeInteractionSignal');
        $compactWincons = $this->signal($signals, 'compactWinconSignal');
        $twoCardCombos = $this->signal($signals, 'twoCardComboSignal');
        $theme = $this->signal($signals, 'themeSignal');
        $archetype = $this->lowerString($theme['primaryArchetype'] ?? null);
        $cedhArchetype = str_contains($archetype, 'cedh')
            || str_contains($archetype, 'turbo')
            || str_contains($archetype, 'consult')
            || str_contains($archetype, 'breach');
        $hasCoreCedhPackage = $scores['metagameScore'] >= 80
            && $scores['manaEfficiencyScore'] >= 60
            && (int) ($fastMana['premiumCount'] ?? 0) >= 2
            && (int) ($nonLandTutors['efficientCount'] ?? 0) >= 2
            && (int) ($freeInteraction['premiumCount'] ?? 0) >= 2;

        if ($hasCoreCedhPackage
            && (int) ($compactWincons['count'] ?? 0) >= 1
            && (
                (int) ($twoCardCombos['beforeTurnSix'] ?? 0) >= 1
                || $cedhArchetype
            )
        ) {
            return true;
        }

        return $hasCoreCedhPackage
            && $scores['staplesScore'] >= 95
            && $scores['speedScore'] >= 95
            && $scores['metagameScore'] >= 95
            && $scores['manaEfficiencyScore'] >= 60
            && $this->count($signals, 'gameChangerSignal') >= 10
            && (int) ($nonLandTutors['count'] ?? 0) >= 10
            && (int) ($nonLandTutors['efficientCount'] ?? 0) >= 4;
    }

    /**
     * @param array<string,mixed> $signals
     * @param array<string,int> $scores
     */
    private function confidence(int $bracket, int $floor, int $ceiling, array $signals, array $scores): string
    {
        if ($ceiling < 5 && $scores['metagameScore'] >= 75) {
            return 'high';
        }
        if ($bracket === 5 && $this->hasCedhPackage($signals, $scores)) {
            return 'high';
        }
        if ($floor >= 4 || ($floor === 3 && $scores['speedScore'] < 70)) {
            return 'high';
        }

        $spread = max($scores) - min($scores);
        if ($spread < 20 || ($scores['themeScore'] >= 65 && $scores['staplesScore'] >= 45)) {
            return 'low';
        }

        return 'medium';
    }

    /**
     * @param array<string,mixed> $signals
     * @return list<string>
     */
    private function ruleBreakers(array $signals): array
    {
        $breakers = [];
        if ($this->count($signals, 'massLandDenialSignal') > 0) {
            $breakers[] = 'mass_land_denial';
        }
        if (($this->signal($signals, 'extraTurnSignal')['chainsOrLoops'] ?? false) === true) {
            $breakers[] = 'extra_turn_chaining';
        }
        if ((int) ($this->signal($signals, 'twoCardComboSignal')['beforeTurnSix'] ?? 0) > 0) {
            $breakers[] = 'early_two_card_combo';
        }

        return $breakers;
    }

    /**
     * @param array<string,mixed> $signals
     * @return array<string,mixed>
     */
    private function officialSignals(array $signals): array
    {
        $gameChangers = $this->signal($signals, 'gameChangerSignal');
        $extraTurns = $this->signal($signals, 'extraTurnSignal');
        $twoCardCombos = $this->signal($signals, 'twoCardComboSignal');

        return [
            'gameChangers' => [
                'count' => (int) ($gameChangers['count'] ?? 0),
                'cards' => is_array($gameChangers['cards'] ?? null) ? $gameChangers['cards'] : [],
                'status' => $this->gameChangerStatus((int) ($gameChangers['count'] ?? 0)),
            ],
            'massLandDenial' => [
                'count' => $this->count($signals, 'massLandDenialSignal'),
                'cards' => is_array($this->signal($signals, 'massLandDenialSignal')['cards'] ?? null) ? $this->signal($signals, 'massLandDenialSignal')['cards'] : [],
                'detected' => ($this->signal($signals, 'massLandDenialSignal')['detected'] ?? false) === true,
            ],
            'extraTurns' => [
                'count' => (int) ($extraTurns['count'] ?? 0),
                'cards' => is_array($extraTurns['cards'] ?? null) ? $extraTurns['cards'] : [],
                'chainsOrLoops' => ($extraTurns['chainsOrLoops'] ?? false) === true,
            ],
            'twoCardCombos' => [
                'count' => (int) ($twoCardCombos['count'] ?? 0),
                'beforeTurnSix' => (int) ($twoCardCombos['beforeTurnSix'] ?? 0) > 0,
                'lateGameOnly' => (int) ($twoCardCombos['lateGameOnly'] ?? 0) > 0,
            ],
            'nonLandTutors' => [
                'count' => (int) ($this->signal($signals, 'nonLandTutorSignal')['count'] ?? 0),
                'efficientCount' => (int) ($this->signal($signals, 'nonLandTutorSignal')['efficientCount'] ?? 0),
                'cards' => is_array($this->signal($signals, 'nonLandTutorSignal')['cards'] ?? null) ? $this->signal($signals, 'nonLandTutorSignal')['cards'] : [],
            ],
        ];
    }

    private function gameChangerStatus(int $count): string
    {
        if ($count >= 4) {
            return 'requires_bracket_4_plus';
        }
        if ($count >= 1) {
            return 'allowed_in_bracket_3';
        }

        return 'none_detected';
    }

    /**
     * @param array<string,mixed> $signals
     * @param array<string,int> $scores
     * @param list<string> $ruleBreakers
     * @param list<array{code:string,params:array<string,mixed>,message:string}> $reasonCodes
     * @param list<string> $reasons
     * @return array<string,mixed>
     */
    private function explanation(int $bracket, int $floor, int $ceiling, array $signals, array $scores, array $ruleBreakers, array $reasonCodes, array $reasons): array
    {
        $short = sprintf(
            'Estimated as Bracket %d - %s because %s',
            $bracket,
            self::LABELS[$bracket],
            $this->primaryExplanation($bracket, $floor, $ceiling, $signals, $scores),
        );

        return [
            'short' => $short,
            'long' => $this->longExplanation($bracket, $floor, $ceiling, $scores, $reasons),
            'officialCriteria' => self::OFFICIAL_CRITERIA,
            'detectedSignalsExplanation' => $this->detectedSignalsExplanation($signals, $scores),
            'ruleBreakersExplanation' => $this->ruleBreakersExplanation($ruleBreakers),
            'differenceModel' => self::DIFFERENCE_MODEL,
            'reasonCodes' => $reasonCodes,
        ];
    }

    /**
     * @param array<string,mixed> $signals
     * @param array<string,int> $scores
     */
    private function primaryExplanation(int $bracket, int $floor, int $ceiling, array $signals, array $scores): string
    {
        if ($ceiling === 4 && $scores['metagameScore'] >= 75) {
            return 'the deck has cEDH-like metagame signals, but its mana efficiency is not high enough for Bracket 5.';
        }
        if ($bracket === 5) {
            return 'the deck combines cEDH metagame signals with strong mana efficiency, fast mana, tutors, free interaction and compact win conditions.';
        }
        if ($floor >= 4) {
            return 'official bracket gates set an Optimized floor for this deck.';
        }
        if ($bracket === 4) {
            return 'the deck has speed and compact win-condition signals consistent with Optimized play.';
        }
        if ($floor === 3) {
            return 'official bracket gates place it above Core and Exhibition decks.';
        }
        if ($bracket === 3) {
            return 'staple density and synergy signals are consistent with Upgraded decks.';
        }
        if ($bracket === 2) {
            return 'it looks like a functional casual deck without stronger restriction or speed signals.';
        }

        return 'detectable power, speed and staple signals are low and the deck appears theme-first.';
    }

    /**
     * @param array<string,int> $scores
     * @param list<string> $reasons
     */
    private function longExplanation(int $bracket, int $floor, int $ceiling, array $scores, array $reasons): string
    {
        $parts = [
            sprintf('CommanderZone estimates this deck as Bracket %d - %s.', $bracket, self::LABELS[$bracket]),
            sprintf('The official-gate floor is %d and the current ceiling is %d.', $floor, $ceiling),
            sprintf(
                'The difference scores are theme %d, staples %d, speed %d, metagame %d and mana efficiency %d.',
                $scores['themeScore'],
                $scores['staplesScore'],
                $scores['speedScore'],
                $scores['metagameScore'],
                $scores['manaEfficiencyScore'],
            ),
        ];

        if ($reasons !== []) {
            $parts[] = implode(' ', $reasons);
        }
        if ($bracket < 5) {
            $parts[] = $ceiling === 4
                ? 'It does not move to Bracket 5 because the mana profile is not strong enough for the detected metagame signals.'
                : 'It does not move higher because the higher-bracket speed, metagame or mana-efficiency package is incomplete.';
        }

        return implode(' ', $parts);
    }

    /**
     * @param array<string,mixed> $signals
     * @param array<string,int> $scores
     * @return list<array{code:string,params:array<string,mixed>,message:string}>
     */
    private function detectedSignalsExplanation(array $signals, array $scores): array
    {
        $items = [];
        $gameChangers = $this->count($signals, 'gameChangerSignal');
        if ($gameChangers > 0) {
            $items[] = $this->coded('bracket.signal.game_changers_detected', ['count' => $gameChangers], sprintf('%d Game Changer%s detected.', $gameChangers, $gameChangers === 1 ? '' : 's'));
        }
        $massLandDenial = $this->count($signals, 'massLandDenialSignal');
        if ($massLandDenial > 0) {
            $items[] = $this->coded('bracket.signal.mass_land_denial_detected', ['count' => $massLandDenial], 'Mass Land Denial was detected.');
        }
        $extraTurns = $this->signal($signals, 'extraTurnSignal');
        if ((int) ($extraTurns['count'] ?? 0) > 0) {
            $items[] = $this->coded('bracket.signal.extra_turns_detected', ['count' => (int) ($extraTurns['count'] ?? 0), 'chainsOrLoops' => ($extraTurns['chainsOrLoops'] ?? false) === true], 'Extra turn cards were detected.');
        }
        $twoCardCombos = $this->signal($signals, 'twoCardComboSignal');
        if ((int) ($twoCardCombos['count'] ?? 0) > 0) {
            $items[] = $this->coded('bracket.signal.two_card_combos_detected', ['count' => (int) ($twoCardCombos['count'] ?? 0), 'beforeTurnSix' => (int) ($twoCardCombos['beforeTurnSix'] ?? 0)], 'Two-card combo lines were detected.');
        }
        $nonLandTutors = $this->signal($signals, 'nonLandTutorSignal');
        if ((int) ($nonLandTutors['count'] ?? 0) > 0) {
            $items[] = $this->coded('bracket.signal.non_land_tutors_detected', ['count' => (int) ($nonLandTutors['count'] ?? 0), 'efficientCount' => (int) ($nonLandTutors['efficientCount'] ?? 0)], 'Strategic non-land tutors were detected.');
        }
        if ((int) ($this->signal($signals, 'fastManaSignal')['premiumCount'] ?? 0) > 0) {
            $items[] = $this->coded('bracket.signal.premium_fast_mana_detected', ['premiumCount' => (int) ($this->signal($signals, 'fastManaSignal')['premiumCount'] ?? 0)], 'Premium fast mana was detected.');
        }
        if ((int) ($this->signal($signals, 'freeInteractionSignal')['premiumCount'] ?? 0) > 0) {
            $items[] = $this->coded('bracket.signal.premium_free_interaction_detected', ['premiumCount' => (int) ($this->signal($signals, 'freeInteractionSignal')['premiumCount'] ?? 0)], 'Premium free interaction was detected.');
        }
        if ((int) ($this->signal($signals, 'compactWinconSignal')['count'] ?? 0) > 0) {
            $items[] = $this->coded('bracket.signal.compact_wincons_detected', ['count' => (int) ($this->signal($signals, 'compactWinconSignal')['count'] ?? 0)], 'Compact win conditions were detected.');
        }

        $items[] = $this->coded('bracket.signal.mana_efficiency_score', ['manaEfficiencyScore' => $scores['manaEfficiencyScore']], sprintf('Mana efficiency score is %d.', $scores['manaEfficiencyScore']));

        return $items;
    }

    /**
     * @param list<string> $ruleBreakers
     * @return list<array{code:string,params:array<string,mixed>,message:string}>
     */
    private function ruleBreakersExplanation(array $ruleBreakers): array
    {
        $items = [];
        foreach ($ruleBreakers as $ruleBreaker) {
            $items[] = match ($ruleBreaker) {
                'mass_land_denial' => $this->coded('bracket.rule_breaker.mass_land_denial', [], 'Mass Land Denial sets an Optimized floor.'),
                'extra_turn_chaining' => $this->coded('bracket.rule_breaker.extra_turn_chaining', [], 'Extra turn chaining or loops set an Optimized floor.'),
                'early_two_card_combo' => $this->coded('bracket.rule_breaker.early_two_card_combo', [], 'Two-card combos before turn 6 set an Optimized floor.'),
                default => $this->coded('bracket.rule_breaker.unknown', ['ruleBreaker' => $ruleBreaker], 'A bracket rule breaker was detected.'),
            };
        }

        return $items;
    }

    /**
     * @param array<string,mixed> $signals
     * @param array<string,int> $scores
     * @return list<array{code:string,params:array<string,mixed>,message:string}>
     */
    private function reasonCodes(int $bracket, int $floor, int $ceiling, array $signals, array $scores): array
    {
        $items = [];
        if ($floor > 1) {
            $items[] = $this->coded('bracket.reason.official_floor', ['floor' => $floor], sprintf('Official Commander Bracket gates set a minimum bracket of %d.', $floor));
        } else {
            $items[] = $this->coded('bracket.reason.no_official_floor', [], 'No official restriction gate raises this deck above Bracket 1.');
        }

        if ($bracket === 5) {
            $items[] = $this->coded('bracket.reason.cedh_package_complete', ['manaEfficiencyScore' => $scores['manaEfficiencyScore'], 'metagameScore' => $scores['metagameScore']], 'cEDH package is complete and mana efficiency is high enough.');
        } elseif ($ceiling === 4 && $scores['metagameScore'] >= 75) {
            $items[] = $this->coded('bracket.reason.mana_efficiency_blocks_cedh', ['manaEfficiencyScore' => $scores['manaEfficiencyScore']], 'Mana efficiency is not high enough for Bracket 5, so this remains Bracket 4.');
        } elseif ($bracket === 4) {
            $items[] = $this->coded('bracket.reason.cedh_package_incomplete', ['metagameScore' => $scores['metagameScore'], 'manaEfficiencyScore' => $scores['manaEfficiencyScore']], 'The deck does not have the complete cEDH package required for Bracket 5.');
        } elseif ($bracket === 3) {
            $items[] = $this->coded('bracket.reason.speed_below_optimized', ['speedScore' => $scores['speedScore']], 'Speed signals are not high enough for Bracket 4.');
        } elseif ($bracket === 2) {
            $items[] = $this->coded('bracket.reason.staples_speed_below_upgraded', ['staplesScore' => $scores['staplesScore'], 'speedScore' => $scores['speedScore']], 'Staple and speed signals are below the Upgraded threshold.');
        } else {
            $items[] = $this->coded('bracket.reason.theme_first_low_power', ['themeScore' => $scores['themeScore']], 'Theme-first and low-power signals keep the deck in Exhibition.');
        }

        if ((int) ($this->signal($signals, 'twoCardComboSignal')['beforeTurnSix'] ?? 0) === 0) {
            $items[] = $this->coded('bracket.reason.no_early_two_card_combo', [], 'No early two-card combo was detected.');
        }

        return $items;
    }

    /**
     * @param array<string,mixed> $params
     * @return array{code:string,params:array<string,mixed>,message:string}
     */
    private function coded(string $code, array $params, string $message): array
    {
        return [
            'code' => $code,
            'params' => $params,
            'message' => $message,
        ];
    }

    /**
     * @param array<string,mixed> $signals
     * @param array<string,int> $scores
     * @return list<string>
     */
    private function reasons(int $bracket, int $floor, int $ceiling, array $signals, array $scores): array
    {
        $reasons = [];
        $gameChangers = $this->count($signals, 'gameChangerSignal');
        if ($gameChangers > 0) {
            $reasons[] = sprintf('Contains %d Game Changer%s, placing it above lower brackets.', $gameChangers, $gameChangers === 1 ? '' : 's');
        }
        if ($this->count($signals, 'massLandDenialSignal') > 0) {
            $reasons[] = 'Mass Land Denial was detected, so the bracket floor is Optimized.';
        } else {
            $reasons[] = 'No Mass Land Denial was detected.';
        }
        if ((int) ($this->signal($signals, 'twoCardComboSignal')['beforeTurnSix'] ?? 0) > 0) {
            $reasons[] = 'A two-card combo that can present before turn 6 was detected.';
        } else {
            $reasons[] = 'No early two-card combo was detected.';
        }
        if ($scores['staplesScore'] >= 50) {
            $reasons[] = 'Staple density is consistent with Upgraded decks.';
        }
        if ($scores['speedScore'] >= 70) {
            $reasons[] = 'Speed profile is consistent with Optimized decks.';
        }
        if ($scores['metagameScore'] >= 75) {
            $reasons[] = 'cEDH metagame signals are high.';
        }
        if ($bracket === 5) {
            $reasons[] = 'Mana efficiency is high enough for cEDH.';
        } elseif ($ceiling === 4 && $scores['metagameScore'] >= 75) {
            $reasons[] = 'Mana efficiency is not high enough for Bracket 5, so this remains Bracket 4.';
        }
        if ($floor > 1) {
            $reasons[] = sprintf('Official Commander Bracket gates set a minimum bracket of %d.', $floor);
        }

        return array_values(array_unique($reasons));
    }

    /**
     * @param array<string,mixed> $signals
     * @return array<string,mixed>
     */
    private function signal(array $signals, string $key): array
    {
        return is_array($signals[$key] ?? null) ? $signals[$key] : [];
    }

    /**
     * @param array<string,mixed> $signals
     */
    private function count(array $signals, string $key): int
    {
        return (int) ($this->signal($signals, $key)['count'] ?? 0);
    }

    /**
     * @param array<string,mixed> $signal
     */
    private function score(array $signal): int
    {
        return $this->clamp((int) ($signal['score'] ?? 0));
    }

    private function clamp(int $score): int
    {
        return max(0, min(100, $score));
    }

    private function lowerString(mixed $value): string
    {
        return is_scalar($value) ? mb_strtolower(trim((string) $value)) : '';
    }
}
