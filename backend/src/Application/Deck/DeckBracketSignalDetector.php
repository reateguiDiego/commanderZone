<?php

namespace App\Application\Deck;

final class DeckBracketSignalDetector
{
    private const MASS_LAND_DENIAL_NAMES = [
        'armageddon',
        'ravages of war',
        'ruination',
        'sunder',
        'jokulhaups',
        'obliterate',
        'decree of annihilation',
        'winter orb',
        'static orb',
        'blood moon',
        'magus of the moon',
        'back to basics',
        'stasis',
    ];

    private const EXTRA_TURN_NAMES = [
        'time warp',
        'temporal manipulation',
        'nexus of fate',
        'expropriate',
        'time stretch',
        'capture of jingzhou',
        'temporal mastery',
        'walk the aeons',
        'karn\'s temporal sundering',
    ];

    private const REPEATABLE_EXTRA_TURN_NAMES = [
        'nexus of fate',
        'walk the aeons',
    ];

    private const EFFICIENT_TUTOR_NAMES = [
        'demonic tutor',
        'vampiric tutor',
        'imperial seal',
        'gamble',
        'diabolic intent',
        'mystical tutor',
        'enlightened tutor',
        'worldly tutor',
        'eladamri\'s call',
        'green sun\'s zenith',
        'finale of devastation',
        'demonic consultation',
        'tainted pact',
        'grim tutor',
        'personal tutor',
        'spellseeker',
        'stoneforge mystic',
        'fabricate',
        'recruiter of the guard',
    ];

    private const PREMIUM_FAST_MANA_NAMES = [
        'mana crypt',
        'mox diamond',
        'chrome mox',
        'mox opal',
        'lotus petal',
        'jeweled lotus',
        'mana vault',
        'grim monolith',
        'ancient tomb',
        'sol ring',
    ];

    private const FREE_INTERACTION_NAMES = [
        'force of will',
        'force of negation',
        'fierce guardianship',
        'deflecting swat',
        'deadly rollick',
        'flawless maneuver',
        'pact of negation',
        'mental misstep',
        'mindbreak trap',
        'snuff out',
        'subtlety',
        'endurance',
        'fury',
        'solitude',
    ];

    private const COMPACT_WINCON_NAMES = [
        'thassa\'s oracle',
        'demonic consultation',
        'tainted pact',
        'underworld breach',
        'dockside extortionist',
        'isochron scepter',
        'dramatic reversal',
        'food chain',
        'hermit druid',
        'ad nauseam',
        'doomsday',
    ];

    /**
     * @param list<array<string,mixed>> $resolvedCards
     * @param array<string,mixed> $metrics
     * @param array<string,mixed> $combos
     * @param array<string,mixed> $manaMetrics
     * @param array<string,mixed> $archetypes
     * @return array<string,mixed>
     */
    public function detect(array $resolvedCards, array $metrics = [], array $combos = [], array $manaMetrics = [], array $archetypes = []): array
    {
        $resolvedCards = $this->commanderLegalCards($resolvedCards);
        $gameChangers = $this->gameChangerSignal($resolvedCards);
        $massLandDenial = $this->massLandDenialSignal($resolvedCards);
        $extraTurns = $this->extraTurnSignal($resolvedCards);
        $twoCardCombos = $this->twoCardComboSignal($combos, $resolvedCards);
        $nonLandTutors = $this->nonLandTutorSignal($resolvedCards);
        $fastMana = $this->fastManaSignal($resolvedCards);
        $freeInteraction = $this->freeInteractionSignal($resolvedCards);
        $compactWincons = $this->compactWinconSignal($resolvedCards, $combos);
        $manaEfficiency = $this->manaEfficiencySignal($resolvedCards, $manaMetrics, $fastMana);

        return [
            'gameChangerSignal' => $gameChangers,
            'massLandDenialSignal' => $massLandDenial,
            'extraTurnSignal' => $extraTurns,
            'twoCardComboSignal' => $twoCardCombos,
            'nonLandTutorSignal' => $nonLandTutors,
            'fastManaSignal' => $fastMana,
            'freeInteractionSignal' => $freeInteraction,
            'compactWinconSignal' => $compactWincons,
            'manaEfficiencySignal' => $manaEfficiency,
            'themeSignal' => $this->themeSignal($archetypes),
            'staplesSignal' => $this->staplesSignal($resolvedCards),
            'speedSignal' => $this->speedSignal($fastMana, $twoCardCombos, $manaEfficiency),
            'metagameSignal' => $this->metagameSignal($resolvedCards, $freeInteraction, $massLandDenial, $metrics),
        ];
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @return array{count:int,cards:list<array<string,mixed>>}
     */
    private function gameChangerSignal(array $cards): array
    {
        return $this->cardSignal($cards, fn (array $card): bool => (
            $this->boolPath($this->profile($card), ['isGameChanger'])
            || $this->hasPowerFlag($card, 'game_changer')
            || $this->hasPowerFlag($card, 'manual_game_changer')
        ));
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @return array{count:int,cards:list<array<string,mixed>>,detected:bool}
     */
    private function massLandDenialSignal(array $cards): array
    {
        $signal = $this->cardSignal($cards, fn (array $card): bool => $this->isMassLandDenial($card));

        return $signal + ['detected' => $signal['count'] > 0];
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @return array{count:int,cards:list<array<string,mixed>>,chainsOrLoops:bool,repeatableExtraTurns:bool}
     */
    private function extraTurnSignal(array $cards): array
    {
        $signal = $this->cardSignal($cards, fn (array $card): bool => $this->isExtraTurn($card));
        $repeatable = false;
        foreach ($signal['cards'] as $card) {
            $name = $this->normalizedName($card);
            if (in_array($name, self::REPEATABLE_EXTRA_TURN_NAMES, true)) {
                $repeatable = true;
                break;
            }
        }
        foreach ($cards as $card) {
            if ($this->hasAnyCondition($card, ['extra_turn_loop', 'repeatable_extra_turn', 'extra_turn_engine'])) {
                $repeatable = true;
                break;
            }
        }

        return $signal + [
            'chainsOrLoops' => $repeatable || $signal['count'] >= 3,
            'repeatableExtraTurns' => $repeatable,
        ];
    }

    /**
     * @param array<string,mixed> $combos
     * @param list<array<string,mixed>> $cards
     * @return array{count:int,beforeTurnSix:int,lateGameOnly:int,combos:list<array<string,mixed>>}
     */
    private function twoCardComboSignal(array $combos, array $cards): array
    {
        $cardsByOracleId = [];
        foreach ($cards as $card) {
            $oracleId = $this->stringValue($card['oracleId'] ?? null);
            if ($oracleId !== null) {
                $cardsByOracleId[$oracleId] = $card;
            }
        }

        $items = [];
        $beforeTurnSix = 0;
        $lateGameOnly = 0;
        foreach (($combos['complete'] ?? []) as $combo) {
            if (!is_array($combo) || !$this->isRealTwoCardCombo($combo)) {
                continue;
            }

            $early = $this->comboCanPresentBeforeTurnSix($combo, $cardsByOracleId);
            if ($early) {
                ++$beforeTurnSix;
            } else {
                ++$lateGameOnly;
            }

            $items[] = [
                'comboVariantId' => $this->stringValue($combo['comboVariantId'] ?? null),
                'externalId' => $this->stringValue($combo['externalId'] ?? null),
                'name' => $this->stringValue($combo['name'] ?? null),
                'beforeTurnSix' => $early,
                'lateGameOnly' => !$early,
                'requiresCommander' => ($combo['requiresCommander'] ?? false) === true,
                'requiresTemplate' => ($combo['requiresTemplate'] ?? false) === true,
                'comboPowerScore' => $this->intOrNull($combo['comboPowerScore'] ?? null),
                'comboComplexityScore' => $this->intOrNull($combo['comboComplexityScore'] ?? null),
                'bracketTag' => $this->stringValue($combo['bracketTag'] ?? null),
                'cards' => is_array($combo['cards'] ?? null) ? array_values($combo['cards']) : [],
            ];
        }

        return [
            'count' => count($items),
            'beforeTurnSix' => $beforeTurnSix,
            'lateGameOnly' => $lateGameOnly,
            'combos' => $items,
        ];
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @return array{count:int,efficientCount:int,cards:list<array<string,mixed>>}
     */
    private function nonLandTutorSignal(array $cards): array
    {
        $signalCards = [];
        $count = 0;
        $efficientCount = 0;

        foreach ($cards as $card) {
            if (!$this->isNonLandTutor($card)) {
                continue;
            }

            $quantity = $this->quantity($card);
            $count += $quantity;
            if ($this->isEfficientTutor($card)) {
                $efficientCount += $quantity;
            }
            $signalCards[] = $this->cardReference($card);
        }

        return [
            'count' => $count,
            'efficientCount' => $efficientCount,
            'cards' => $this->uniqueCards($signalCards),
        ];
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @return array{count:int,premiumCount:int,permanentCount:int,oneShotCount:int,colorlessCount:int,coloredCount:int,cards:list<array<string,mixed>>}
     */
    private function fastManaSignal(array $cards): array
    {
        $signalCards = [];
        $count = 0;
        $premiumCount = 0;
        $permanentCount = 0;
        $oneShotCount = 0;
        $colorlessCount = 0;
        $coloredCount = 0;

        foreach ($cards as $card) {
            if (!$this->isFastMana($card)) {
                continue;
            }

            $quantity = $this->quantity($card);
            $manaProfile = $this->manaProfile($card);
            $name = $this->normalizedName($card);
            $count += $quantity;
            $premiumCount += in_array($name, self::PREMIUM_FAST_MANA_NAMES, true) ? $quantity : 0;
            $permanentCount += $this->isPermanentFastMana($card) ? $quantity : 0;
            $oneShotCount += $this->boolPath($manaProfile, ['isOneShotMana']) || $this->boolPath($manaProfile, ['isRitual']) || $this->boolPath($manaProfile, ['isBurstMana']) ? $quantity : 0;
            $colorlessCount += $this->fastManaProducesOnlyColorless($manaProfile) ? $quantity : 0;
            $coloredCount += $this->fastManaProducesColor($manaProfile) ? $quantity : 0;
            $signalCards[] = $this->cardReference($card);
        }

        return [
            'count' => $count,
            'premiumCount' => $premiumCount,
            'permanentCount' => $permanentCount,
            'oneShotCount' => $oneShotCount,
            'colorlessCount' => $colorlessCount,
            'coloredCount' => $coloredCount,
            'cards' => $this->uniqueCards($signalCards),
        ];
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @return array{count:int,premiumCount:int,cards:list<array<string,mixed>>}
     */
    private function freeInteractionSignal(array $cards): array
    {
        $signal = $this->cardSignal($cards, fn (array $card): bool => $this->isFreeInteraction($card));
        $premiumCount = 0;
        foreach ($cards as $card) {
            if ($this->isFreeInteraction($card) && in_array($this->normalizedName($card), self::FREE_INTERACTION_NAMES, true)) {
                $premiumCount += $this->quantity($card);
            }
        }

        return $signal + ['premiumCount' => $premiumCount];
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @param array<string,mixed> $combos
     * @return array{count:int,cardsOrCombos:list<array<string,mixed>>}
     */
    private function compactWinconSignal(array $cards, array $combos): array
    {
        $items = [];
        foreach ($cards as $card) {
            if ($this->hasPowerFlag($card, 'compact_wincon') || in_array($this->normalizedName($card), self::COMPACT_WINCON_NAMES, true)) {
                $items[] = ['kind' => 'card', 'card' => $this->cardReference($card)];
            }
        }

        foreach (($combos['complete'] ?? []) as $combo) {
            if (!is_array($combo) || !$this->isWinLikeCombo($combo)) {
                continue;
            }
            if ((int) ($combo['comboSize'] ?? count($combo['requiredOracleIds'] ?? [])) > 3) {
                continue;
            }
            $items[] = [
                'kind' => 'combo',
                'comboVariantId' => $this->stringValue($combo['comboVariantId'] ?? null),
                'externalId' => $this->stringValue($combo['externalId'] ?? null),
                'name' => $this->stringValue($combo['name'] ?? null),
                'cards' => is_array($combo['cards'] ?? null) ? array_values($combo['cards']) : [],
            ];
        }

        return [
            'count' => count($items),
            'cardsOrCombos' => $items,
        ];
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @param array<string,mixed> $mana
     * @param array<string,mixed> $fastMana
     * @return array<string,mixed>
     */
    private function manaEfficiencySignal(array $cards, array $mana, array $fastMana): array
    {
        $reasons = [];
        $lands = is_array($mana['lands'] ?? null) ? $mana['lands'] : [];
        $landCycleAnalysis = is_array($mana['landCycleAnalysis'] ?? null) ? $mana['landCycleAnalysis'] : [];
        $requirements = is_array($mana['requirements'] ?? null) ? $mana['requirements'] : [];
        $ramp = is_array($mana['ramp'] ?? null) ? $mana['ramp'] : [];
        $fixing = is_array($mana['fixing'] ?? null) ? $mana['fixing'] : [];
        $fetchlands = is_array($mana['fetchlands'] ?? null) ? $mana['fetchlands'] : [];

        $totalLands = max(0, (int) ($lands['total'] ?? 0));
        $untappedLands = max(0, (int) ($lands['untappedLands'] ?? 0));
        $tappedLands = max(0, (int) ($lands['tappedLands'] ?? 0));
        $conditionallyTapped = max(0, (int) ($lands['conditionallyTappedLands'] ?? 0));
        $untappedSourceScore = $totalLands > 0 ? min(100, (int) round(($untappedLands / $totalLands) * 100)) : 0;
        $tappedLandPressure = $totalLands > 0 ? (int) round((($tappedLands + $conditionallyTapped * 0.5) / $totalLands) * 100) : 0;
        $slowLandPressure = $this->pressureScore($landCycleAnalysis, ['bounceLandTempoPressure', 'pathwayColorChoicePressure', 'filterlandInputPressure', 'checklandSupport']);
        $colorlessUtilityPressure = $this->statusPressure((string) ($landCycleAnalysis['colorlessUtilityPressure'] ?? 'unknown'));
        $earlyColorAccessScore = $this->earlyColorAccessScore($mana);
        $fetchTargetQuality = $this->fetchTargetQuality($fetchlands, $landCycleAnalysis);
        $commanderCastability = $this->commanderCastabilityScore($requirements);
        $rampFixingQuality = min(100, (int) (($fixing['landRampFixing'] ?? 0) * 8 + ($fixing['artifactFixing'] ?? 0) * 6 + ($fixing['creatureFixing'] ?? 0) * 6 + ($fixing['rainbowSources'] ?? 0) * 7));
        $curveCompatibility = $this->curveCompatibilityScore($cards, $ramp, $fastMana);

        $score = 40;
        $score += min(18, (int) ($fastMana['premiumCount'] ?? 0) * 4);
        $score += (int) round(($earlyColorAccessScore - 50) * 0.22);
        $score += (int) round(($untappedSourceScore - 55) * 0.18);
        $score += (int) round(($commanderCastability - 50) * 0.14);
        $score += (int) round(($rampFixingQuality - 35) * 0.08);
        $score += (int) round(($curveCompatibility - 50) * 0.10);
        $score -= (int) round($tappedLandPressure * 0.18);
        $score -= (int) round($slowLandPressure * 0.11);
        $score -= (int) round($colorlessUtilityPressure * 0.08);
        $score += (int) round(($fetchTargetQuality - 50) * 0.08);
        $score = max(0, min(100, $score));

        if (($fastMana['premiumCount'] ?? 0) > 0) {
            $reasons[] = 'Premium fast mana improves early deployment.';
        }
        if ($earlyColorAccessScore >= 75) {
            $reasons[] = 'Early colored access is strong.';
        } elseif ($earlyColorAccessScore > 0 && $earlyColorAccessScore < 45) {
            $reasons[] = 'Early colored access is constrained.';
        }
        if ($tappedLandPressure >= 30) {
            $reasons[] = 'Tapped land pressure slows early turns.';
        }
        if ($colorlessUtilityPressure >= 70) {
            $reasons[] = 'Colorless utility lands pressure colored source counts.';
        }
        if ($commanderCastability < 50) {
            $reasons[] = 'Commander castability is weak for the current sources.';
        }

        return [
            'score' => $score,
            'fastManaPremiumCount' => (int) ($fastMana['premiumCount'] ?? 0),
            'earlyColorAccessScore' => $earlyColorAccessScore,
            'untappedSourceScore' => $untappedSourceScore,
            'tappedLandPressure' => $tappedLandPressure,
            'slowLandPressure' => $slowLandPressure,
            'colorlessUtilityPressure' => $colorlessUtilityPressure,
            'fetchTargetQuality' => $fetchTargetQuality,
            'commanderCastability' => $commanderCastability,
            'rampFixingQuality' => $rampFixingQuality,
            'curveCompatibility' => $curveCompatibility,
            'reasons' => $reasons,
        ];
    }

    /**
     * @param array<string,mixed> $archetypes
     * @return array<string,mixed>
     */
    private function themeSignal(array $archetypes): array
    {
        $primary = $this->stringValue($archetypes['primary'] ?? null) ?? 'unknown';
        $confidence = $this->stringValue($archetypes['confidence'] ?? null) ?? 'low';
        $topScore = 0;
        if (is_array($archetypes['scores'] ?? null) && is_array($archetypes['scores'][0] ?? null)) {
            $topScore = (int) ($archetypes['scores'][0]['score'] ?? 0);
        }

        return [
            'primaryArchetype' => $primary,
            'confidence' => $confidence,
            'score' => $primary === 'mixed' || $primary === 'unknown' ? min(45, $topScore) : min(100, $topScore),
        ];
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @return array{score:int,cedhStaples:int,highPowerStaples:int,lowOpportunityCost:int,cards:list<array<string,mixed>>}
     */
    private function staplesSignal(array $cards): array
    {
        $cedh = 0;
        $highPower = 0;
        $lowOpportunity = 0;
        $references = [];
        foreach ($cards as $card) {
            $quantity = $this->quantity($card);
            $matched = false;
            if ($this->hasPowerFlag($card, 'cedh_staple') || $this->boolPath($this->profile($card), ['flags', 'cedhStaple'])) {
                $cedh += $quantity;
                $matched = true;
            }
            if ($this->hasPowerFlag($card, 'high_power_staple')) {
                $highPower += $quantity;
                $matched = true;
            }
            if ($this->hasPowerFlag($card, 'low_opportunity_cost')) {
                $lowOpportunity += $quantity;
                $matched = true;
            }
            if ($matched) {
                $references[] = $this->cardReference($card);
            }
        }

        return [
            'score' => min(100, $cedh * 14 + $highPower * 9 + $lowOpportunity * 2),
            'cedhStaples' => $cedh,
            'highPowerStaples' => $highPower,
            'lowOpportunityCost' => $lowOpportunity,
            'cards' => $this->uniqueCards($references),
        ];
    }

    /**
     * @param array<string,mixed> $fastMana
     * @param array<string,mixed> $twoCardCombos
     * @param array<string,mixed> $manaEfficiency
     * @return array<string,mixed>
     */
    private function speedSignal(array $fastMana, array $twoCardCombos, array $manaEfficiency): array
    {
        $score = min(100, (int) ($fastMana['premiumCount'] ?? 0) * 9 + (int) ($fastMana['count'] ?? 0) * 4 + (int) ($twoCardCombos['beforeTurnSix'] ?? 0) * 22 + (int) round(((int) ($manaEfficiency['score'] ?? 0)) * 0.35));

        return [
            'score' => $score,
            'fastManaCount' => (int) ($fastMana['count'] ?? 0),
            'premiumFastManaCount' => (int) ($fastMana['premiumCount'] ?? 0),
            'beforeTurnSixTwoCardCombos' => (int) ($twoCardCombos['beforeTurnSix'] ?? 0),
            'manaEfficiencyScore' => (int) ($manaEfficiency['score'] ?? 0),
        ];
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @param array<string,mixed> $freeInteraction
     * @param array<string,mixed> $massLandDenial
     * @param array<string,mixed> $metrics
     * @return array<string,mixed>
     */
    private function metagameSignal(array $cards, array $freeInteraction, array $massLandDenial, array $metrics): array
    {
        $graveyardHate = (int) ($metrics['roles']['graveyardHate'] ?? 0);
        $counterspells = (int) ($metrics['roles']['counterspells'] ?? 0);
        $stax = (int) ($metrics['roles']['stax'] ?? 0);
        $score = min(100, (int) ($freeInteraction['premiumCount'] ?? 0) * 12 + (int) ($freeInteraction['count'] ?? 0) * 6 + (int) ($massLandDenial['count'] ?? 0) * 10 + $graveyardHate * 3 + $counterspells * 2 + $stax * 4);

        return [
            'score' => $score,
            'freeInteractionCount' => (int) ($freeInteraction['count'] ?? 0),
            'premiumFreeInteractionCount' => (int) ($freeInteraction['premiumCount'] ?? 0),
            'massLandDenialCount' => (int) ($massLandDenial['count'] ?? 0),
            'graveyardHateCount' => $graveyardHate,
            'counterspellCount' => $counterspells,
            'staxCount' => $stax,
        ];
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @param callable(array<string,mixed>):bool $predicate
     * @return array{count:int,cards:list<array<string,mixed>>}
     */
    private function cardSignal(array $cards, callable $predicate): array
    {
        $count = 0;
        $references = [];
        foreach ($cards as $card) {
            if (!$predicate($card)) {
                continue;
            }
            $count += $this->quantity($card);
            $references[] = $this->cardReference($card);
        }

        return [
            'count' => $count,
            'cards' => $this->uniqueCards($references),
        ];
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @return list<array<string,mixed>>
     */
    private function commanderLegalCards(array $cards): array
    {
        return array_values(array_filter($cards, fn (array $card): bool => $this->isCommanderLegal($card)));
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isCommanderLegal(array $card): bool
    {
        $profile = $this->profile($card);
        if (!array_key_exists('commanderLegal', $profile) && !array_key_exists('commanderBanned', $profile)) {
            return true;
        }

        return $this->boolPath($profile, ['commanderLegal'])
            && !$this->boolPath($profile, ['commanderBanned']);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isMassLandDenial(array $card): bool
    {
        $name = $this->normalizedName($card);
        if (in_array($name, self::MASS_LAND_DENIAL_NAMES, true)) {
            return true;
        }

        return $this->hasAnyCondition($card, ['mass_land_denial', 'land_denial', 'mana_denial'])
            || $this->hasAnySubrole($card, ['mass_land_denial', 'land_denial', 'mana_denial']);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isExtraTurn(array $card): bool
    {
        return in_array($this->normalizedName($card), self::EXTRA_TURN_NAMES, true)
            || $this->hasRole($card, 'extra_turn')
            || $this->hasAnySubrole($card, ['extra_turn', 'extra_turn_engine']);
    }

    /**
     * @param array<string,mixed> $combo
     */
    private function isRealTwoCardCombo(array $combo): bool
    {
        $size = (int) ($combo['comboSize'] ?? count($combo['requiredOracleIds'] ?? []));
        if ($size !== 2) {
            return false;
        }

        return $this->isWinLikeCombo($combo);
    }

    /**
     * @param array<string,mixed> $combo
     */
    private function isWinLikeCombo(array $combo): bool
    {
        return ($combo['producesWinLike'] ?? false) === true
            || ($combo['producesWin'] ?? false) === true
            || ($combo['lethalLoop'] ?? false) === true
            || ($combo['producesInfiniteMana'] ?? false) === true
            || ($combo['producesInfiniteDamage'] ?? false) === true
            || ($combo['producesInfiniteTokens'] ?? false) === true;
    }

    /**
     * @param array<string,mixed> $combo
     * @param array<string,array<string,mixed>> $cardsByOracleId
     */
    private function comboCanPresentBeforeTurnSix(array $combo, array $cardsByOracleId): bool
    {
        $powerScore = $this->intOrNull($combo['comboPowerScore'] ?? null);
        if ($powerScore !== null && $powerScore >= 70) {
            return true;
        }

        $bracketTag = $this->stringValue($combo['bracketTag'] ?? null);
        if (in_array($bracketTag, ['bracket_4', 'bracket_5', 'cedh', 'high_power', 'fast'], true)) {
            return true;
        }

        $requiredOracleIds = is_array($combo['requiredOracleIds'] ?? null) ? $combo['requiredOracleIds'] : [];
        $totalManaValue = 0.0;
        $knownCards = 0;
        foreach ($requiredOracleIds as $oracleId) {
            if (!is_scalar($oracleId)) {
                continue;
            }
            $card = $cardsByOracleId[(string) $oracleId] ?? null;
            if ($card === null) {
                continue;
            }
            ++$knownCards;
            $totalManaValue += $this->manaValue($card);
        }

        return $knownCards >= 2 && $totalManaValue <= 5.0 && ($combo['requiresTemplate'] ?? false) !== true;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isNonLandTutor(array $card): bool
    {
        if ($this->manaProfileExcludesNonLandTutor($this->manaProfile($card))) {
            return false;
        }
        if ($this->isLand($card) || $this->hasRole($card, 'land')) {
            return false;
        }
        if ($this->hasAnySubrole($card, ['land_tutor', 'ramp_search', 'opponent_tutor', 'fetchland'])) {
            return false;
        }

        $name = $this->normalizedName($card);
        if (in_array($name, self::EFFICIENT_TUTOR_NAMES, true)) {
            return true;
        }

        return $this->hasAnySubrole($card, ['true_tutor', 'typed_tutor'])
            || ($this->hasRole($card, 'tutor') && !$this->hasAnySubrole($card, ['land_tutor', 'ramp_search', 'opponent_tutor']));
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isEfficientTutor(array $card): bool
    {
        return in_array($this->normalizedName($card), self::EFFICIENT_TUTOR_NAMES, true)
            || $this->hasPowerFlag($card, 'efficient_tutor')
            || $this->boolPath($this->profile($card), ['flags', 'efficientTutor'])
            || in_array($this->roleQuality($card, 'tutor'), ['premium', 'good'], true);
    }

    /**
     * @param array<string,mixed> $manaProfile
     */
    private function manaProfileExcludesNonLandTutor(array $manaProfile): bool
    {
        if ($manaProfile === []) {
            return false;
        }

        $category = $this->stringValue($manaProfile['manaSourceCategory'] ?? null);

        return $this->boolPath($manaProfile, ['isFetchland'])
            || $this->boolPath($manaProfile, ['isLand'])
            || $this->boolPath($manaProfile, ['isLandRamp'])
            || $this->boolPath($manaProfile, ['isLandTutor'])
            || $this->boolPath($manaProfile, ['isLandSearchToBattlefield'])
            || $this->boolPath($manaProfile, ['isLandSearchToHand'])
            || in_array($category, ['fetchland', 'land_ramp', 'ramp_search', 'land_tutor'], true);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isFastMana(array $card): bool
    {
        $manaProfile = $this->manaProfile($card);

        return $this->boolPath($manaProfile, ['isFastMana'])
            || $this->hasRole($card, 'fast_mana')
            || $this->hasPowerFlag($card, 'fast_mana')
            || $this->boolPath($this->profile($card), ['flags', 'fastMana'])
            || in_array($this->normalizedName($card), self::PREMIUM_FAST_MANA_NAMES, true);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isPermanentFastMana(array $card): bool
    {
        $manaProfile = $this->manaProfile($card);
        $profile = $this->profile($card);

        return $this->boolPath($manaProfile, ['isPermanentRamp'])
            || $this->boolPath($manaProfile, ['isManaRock'])
            || $this->boolPath($manaProfile, ['isManaDork'])
            || $this->isLand($card)
            || $this->boolPath($profile, ['types', 'artifact'])
            || $this->boolPath($profile, ['types', 'creature']);
    }

    /**
     * @param array<string,mixed> $manaProfile
     */
    private function fastManaProducesOnlyColorless(array $manaProfile): bool
    {
        $colors = $this->stringList($manaProfile['producedManaColors'] ?? $manaProfile['produced_mana_colors'] ?? []);

        return $colors === ['C'] || ($colors === [] && $this->boolPath($manaProfile, ['producesColorless']));
    }

    /**
     * @param array<string,mixed> $manaProfile
     */
    private function fastManaProducesColor(array $manaProfile): bool
    {
        foreach ($this->stringList($manaProfile['producedManaColors'] ?? $manaProfile['produced_mana_colors'] ?? []) as $color) {
            if (in_array($color, ['W', 'U', 'B', 'R', 'G'], true)) {
                return true;
            }
        }

        return $this->boolPath($manaProfile, ['producesAnyColor']);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isFreeInteraction(array $card): bool
    {
        return in_array($this->normalizedName($card), self::FREE_INTERACTION_NAMES, true)
            || $this->hasPowerFlag($card, 'free_interaction')
            || $this->boolPath($this->profile($card), ['flags', 'freeInteraction']);
    }

    /**
     * @param array<string,mixed> $mana
     */
    private function earlyColorAccessScore(array $mana): int
    {
        $earlySources = is_array($mana['earlySources']['turn2'] ?? null) ? $mana['earlySources']['turn2'] : [];
        $pipDemand = is_array($mana['requirements']['earlyPipDemand'] ?? null) ? $mana['requirements']['earlyPipDemand'] : [];
        $scores = [];
        foreach (['white', 'blue', 'black', 'red', 'green'] as $color) {
            $demand = (int) ($pipDemand[$color] ?? 0);
            if ($demand <= 0) {
                continue;
            }
            $sources = (int) ($earlySources[$color] ?? 0);
            $scores[] = min(100, (int) round(($sources / max(1, $demand * 3)) * 100));
        }

        if ($scores === []) {
            return 50;
        }

        return (int) round(array_sum($scores) / count($scores));
    }

    /**
     * @param array<string,mixed> $fetchlands
     * @param array<string,mixed> $landCycleAnalysis
     */
    private function fetchTargetQuality(array $fetchlands, array $landCycleAnalysis): int
    {
        $score = match ((string) ($landCycleAnalysis['fetchSynergyScore'] ?? 'unknown')) {
            'good' => 85,
            'warning' => 45,
            'critical' => 15,
            default => 55,
        };

        $count = (int) ($fetchlands['count'] ?? 0);
        $dead = (int) ($fetchlands['deadFetchlands'] ?? 0);
        if ($count > 0 && $dead > 0) {
            $score -= (int) round(($dead / $count) * 45);
        }

        return max(0, min(100, $score));
    }

    /**
     * @param array<string,mixed> $requirements
     */
    private function commanderCastabilityScore(array $requirements): int
    {
        $castability = is_array($requirements['commanderCastability'] ?? null) ? $requirements['commanderCastability'] : [];
        if ($castability === []) {
            return 50;
        }

        $scores = [];
        foreach ($castability as $detail) {
            if (!is_array($detail)) {
                continue;
            }
            $scores[] = match ((string) ($detail['status'] ?? 'unknown')) {
                'excellent' => 100,
                'good' => 80,
                'warning' => 45,
                'critical' => 15,
                default => 55,
            };
        }

        return $scores === [] ? 50 : (int) round(array_sum($scores) / count($scores));
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @param array<string,mixed> $ramp
     * @param array<string,mixed> $fastMana
     */
    private function curveCompatibilityScore(array $cards, array $ramp, array $fastMana): int
    {
        $values = [];
        foreach ($cards as $card) {
            if ($this->isLand($card)) {
                continue;
            }
            for ($i = 0; $i < $this->quantity($card); ++$i) {
                $values[] = $this->manaValue($card);
            }
        }
        if ($values === []) {
            return 50;
        }

        $average = array_sum($values) / count($values);
        $score = 80 - (int) max(0, round(($average - 2.6) * 16));
        $score += min(20, (int) ($ramp['permanentRamp'] ?? 0) * 3 + (int) ($fastMana['count'] ?? 0) * 4);

        return max(0, min(100, $score));
    }

    /**
     * @param array<string,mixed> $analysis
     * @param list<string> $keys
     */
    private function pressureScore(array $analysis, array $keys): int
    {
        $score = 0;
        foreach ($keys as $key) {
            $score = max($score, $this->statusPressure((string) ($analysis[$key] ?? 'unknown')));
        }

        return $score;
    }

    private function statusPressure(string $status): int
    {
        return match ($status) {
            'critical' => 100,
            'warning' => 70,
            'good', 'excellent' => 10,
            default => 35,
        };
    }

    /**
     * @param array<string,mixed> $card
     */
    private function cardReference(array $card): array
    {
        return [
            'deckCardId' => $this->stringValue($card['deckCardId'] ?? null),
            'cardId' => $this->stringValue($card['cardId'] ?? null),
            'scryfallId' => $this->stringValue($card['scryfallId'] ?? null),
            'oracleId' => $this->stringValue($card['oracleId'] ?? null),
            'name' => $this->stringValue($card['name'] ?? null) ?? 'Unknown card',
            'imageUrl' => $this->stringValue($card['imageUrl'] ?? null),
            'quantity' => $this->quantity($card),
            'section' => $this->stringValue($card['section'] ?? null) ?? 'main',
        ];
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @return list<array<string,mixed>>
     */
    private function uniqueCards(array $cards): array
    {
        $seen = [];
        $unique = [];
        foreach ($cards as $card) {
            $key = (string) ($card['oracleId'] ?? $card['deckCardId'] ?? $card['name'] ?? '');
            if ($key === '' || isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $unique[] = $card;
        }

        return $unique;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function quantity(array $card): int
    {
        return max(1, (int) ($card['quantity'] ?? 1));
    }

    /**
     * @param array<string,mixed> $card
     */
    private function manaValue(array $card): float
    {
        $profile = $this->profile($card);

        return is_numeric($profile['manaValue'] ?? null) ? (float) $profile['manaValue'] : 0.0;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function normalizedName(array $card): string
    {
        return mb_strtolower(trim((string) ($card['name'] ?? $card['analysisProfile']['name'] ?? '')));
    }

    /**
     * @param array<string,mixed> $card
     * @return array<string,mixed>
     */
    private function profile(array $card): array
    {
        return is_array($card['analysisProfile'] ?? null) ? $card['analysisProfile'] : [];
    }

    /**
     * @param array<string,mixed> $card
     * @return array<string,mixed>
     */
    private function manaProfile(array $card): array
    {
        return is_array($card['manaProfile'] ?? null) ? $card['manaProfile'] : [];
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isLand(array $card): bool
    {
        return $this->boolPath($this->profile($card), ['types', 'land'])
            || $this->boolPath($this->manaProfile($card), ['isLand']);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function hasRole(array $card, string $role): bool
    {
        return isset($this->stringSet($this->profile($card)['roles'] ?? [])[$role]);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function hasAnySubrole(array $card, array $subroles): bool
    {
        $set = $this->stringSet($this->profile($card)['subroles'] ?? []);
        foreach ($subroles as $subrole) {
            if (isset($set[$subrole])) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function hasAnyCondition(array $card, array $conditions): bool
    {
        $set = $this->stringSet($this->profile($card)['conditionKeys'] ?? []);
        foreach ($conditions as $condition) {
            if (isset($set[$condition])) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function hasPowerFlag(array $card, string $flag): bool
    {
        return isset($this->stringSet($this->profile($card)['powerFlags'] ?? [])[$flag]);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function roleQuality(array $card, string $role): ?string
    {
        $scores = $this->profile($card)['roleScores'] ?? [];
        if (!is_array($scores) || !is_array($scores[$role] ?? null)) {
            return null;
        }

        return $this->stringValue($scores[$role]['quality'] ?? null);
    }

    /**
     * @return array<string,true>
     */
    private function stringSet(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $set = [];
        foreach ($value as $item) {
            if (!is_scalar($item)) {
                continue;
            }
            $string = mb_strtolower(trim((string) $item));
            if ($string !== '') {
                $set[$string] = true;
            }
        }

        return $set;
    }

    /**
     * @return list<string>
     */
    private function stringList(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $items = [];
        foreach ($value as $item) {
            if (is_scalar($item)) {
                $string = trim((string) $item);
                if ($string !== '') {
                    $items[] = mb_strtoupper($string);
                }
            }
        }

        return array_values(array_unique($items));
    }

    private function stringValue(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = trim((string) $value);

        return $string !== '' ? $string : null;
    }

    private function intOrNull(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
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
