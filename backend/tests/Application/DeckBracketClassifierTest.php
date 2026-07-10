<?php

namespace App\Tests\Application;

use App\Application\Deck\DeckBracketClassifier;
use PHPUnit\Framework\TestCase;

final class DeckBracketClassifierTest extends TestCase
{
    public function testExhibitionDeckStaysBracketOne(): void
    {
        $result = $this->classify($this->signals(manaEfficiencyScore: 20));

        self::assertSame(1, $result['bracket']);
        self::assertSame('Exhibition', $result['label']);
        self::assertArrayHasKey('explanation', $result);
        self::assertStringContainsString('Bracket 1 - Exhibition', $result['explanation']['short']);
    }

    public function testCoreDeckStaysBracketTwo(): void
    {
        $result = $this->classify($this->signals(manaEfficiencyScore: 45));

        self::assertSame(2, $result['bracket']);
        self::assertSame('Core', $result['label']);
    }

    public function testGameChangersSetUpgradedFloor(): void
    {
        $result = $this->classify($this->signals(gameChangers: 2, manaEfficiencyScore: 55));

        self::assertSame(3, $result['bracket']);
        self::assertSame(3, $result['floor']);
        self::assertSame('allowed_in_bracket_3', $result['officialSignals']['gameChangers']['status']);
        self::assertContains('Official Commander Bracket gates set a minimum bracket of 3.', $result['reasons']);
        self::assertSame('bracket.reason.official_floor', $result['explanation']['reasonCodes'][0]['code']);
    }

    public function testStaplesCanLiftDeckToUpgraded(): void
    {
        $result = $this->classify($this->signals(staplesScore: 55, manaEfficiencyScore: 55));

        self::assertSame(3, $result['bracket']);
        self::assertSame(1, $result['floor']);
    }

    public function testFourGameChangersSetOptimizedFloor(): void
    {
        $result = $this->classify($this->signals(gameChangers: 4, manaEfficiencyScore: 60));

        self::assertSame(4, $result['bracket']);
        self::assertSame(4, $result['floor']);
    }

    public function testMassLandDenialSetsOptimizedFloor(): void
    {
        $result = $this->classify($this->signals(massLandDenial: 1, manaEfficiencyScore: 60));

        self::assertSame(4, $result['bracket']);
        self::assertSame(['mass_land_denial'], $result['ruleBreakers']);
    }

    public function testEarlyTwoCardComboSetsOptimizedFloor(): void
    {
        $result = $this->classify($this->signals(twoCardCombos: 1, beforeTurnSixCombos: 1, manaEfficiencyScore: 70));

        self::assertSame(4, $result['bracket']);
        self::assertSame(4, $result['floor']);
        self::assertContains('early_two_card_combo', $result['ruleBreakers']);
    }

    public function testExtraTurnLoopSetsOptimizedFloor(): void
    {
        $result = $this->classify($this->signals(extraTurns: 2, extraTurnLoop: true, manaEfficiencyScore: 60));

        self::assertSame(4, $result['bracket']);
        self::assertSame(4, $result['floor']);
        self::assertContains('extra_turn_chaining', $result['ruleBreakers']);
    }

    public function testCedhLikeDeckWithWeakManaIsCappedAtBracketFour(): void
    {
        $result = $this->classify($this->signals(
            twoCardCombos: 1,
            beforeTurnSixCombos: 1,
            efficientTutors: 3,
            fastManaPremium: 2,
            freeInteractionPremium: 3,
            compactWincons: 2,
            cedhStaples: 4,
            metagameScore: 50,
            manaEfficiencyScore: 52,
        ));

        self::assertSame(4, $result['bracket']);
        self::assertSame(4, $result['ceiling']);
        self::assertContains('Mana efficiency is not high enough for Bracket 5, so this remains Bracket 4.', $result['reasons']);
        self::assertSame('bracket.reason.mana_efficiency_blocks_cedh', $result['explanation']['reasonCodes'][1]['code']);
        self::assertStringContainsString('mana efficiency is not high enough for Bracket 5', $result['explanation']['short']);
    }

    public function testCompleteCedhPackageCanReachBracketFive(): void
    {
        $result = $this->classify($this->signals(
            twoCardCombos: 1,
            beforeTurnSixCombos: 1,
            efficientTutors: 3,
            fastManaPremium: 3,
            freeInteractionPremium: 3,
            compactWincons: 2,
            cedhStaples: 4,
            metagameScore: 50,
            manaEfficiencyScore: 60,
        ));

        self::assertSame(5, $result['bracket']);
        self::assertSame('cEDH', $result['label']);
        self::assertSame('high', $result['confidence']);
    }

    public function testOverwhelmingCedhSignalsCanReachBracketFiveWithoutDetectedTwoCardCombo(): void
    {
        $result = $this->classify($this->signals(
            gameChangers: 20,
            efficientTutors: 13,
            fastManaPremium: 3,
            freeInteractionPremium: 3,
            cedhStaples: 8,
            staplesScore: 100,
            speedScore: 100,
            metagameScore: 100,
            manaEfficiencyScore: 73,
        ));

        self::assertSame(5, $result['bracket']);
        self::assertSame(5, $result['ceiling']);
        self::assertSame('cEDH', $result['label']);
        self::assertSame('bracket.reason.cedh_package_complete', $result['explanation']['reasonCodes'][1]['code']);
    }

    public function testHighStaplesAndManaDoNotReachCedhWithoutCedhProfile(): void
    {
        $result = $this->classify($this->signals(
            gameChangers: 6,
            efficientTutors: 3,
            fastManaPremium: 3,
            freeInteractionPremium: 3,
            compactWincons: 2,
            cedhStaples: 8,
            metagameScore: 100,
            manaEfficiencyScore: 73,
        ));

        self::assertSame(4, $result['bracket']);
        self::assertSame(4, $result['floor']);
        self::assertSame(5, $result['ceiling']);
        self::assertContains('The deck does not have the complete cEDH package required for Bracket 5.', array_column($result['reasonCodes'], 'message'));
        self::assertNotContains('Mana efficiency is not high enough for Bracket 5, so this remains Bracket 4.', array_column($result['reasonCodes'], 'message'));
    }

    public function testCedhArchetypeCanReachBracketFiveWithManaEfficiencyAtSixty(): void
    {
        $result = $this->classify($this->signals(
            efficientTutors: 3,
            fastManaPremium: 3,
            freeInteractionPremium: 3,
            compactWincons: 2,
            cedhStaples: 4,
            metagameScore: 60,
            manaEfficiencyScore: 60,
            primaryArchetype: 'turbo consult',
        ));

        self::assertSame(5, $result['bracket']);
        self::assertSame(5, $result['ceiling']);
    }

    public function testExplanationIncludesOfficialCriteriaAndDifferenceModel(): void
    {
        $result = $this->classify($this->signals(gameChangers: 2, staplesScore: 45, manaEfficiencyScore: 60));

        self::assertCount(5, $result['explanation']['officialCriteria']);
        self::assertSame('Exhibition', $result['explanation']['officialCriteria'][0]['label']);
        self::assertSame('cEDH', $result['explanation']['officialCriteria'][4]['label']);
        self::assertSame('Difference between Bracket 1 and 2.', $result['explanation']['differenceModel']['theme']);
        self::assertSame('Difference between Bracket 2 and 3.', $result['explanation']['differenceModel']['staples']);
        self::assertSame('Difference between Bracket 3 and 4.', $result['explanation']['differenceModel']['speed']);
        self::assertSame('Difference between Bracket 4 and 5.', $result['explanation']['differenceModel']['metagame']);
        self::assertSame('Important factor for Bracket 5.', $result['explanation']['differenceModel']['manaEfficiency']);
    }

    public function testExplanationExplainsWhyBracketDoesNotGoHigher(): void
    {
        $result = $this->classify($this->signals(staplesScore: 55, manaEfficiencyScore: 55));

        self::assertSame(3, $result['bracket']);
        self::assertSame('bracket.reason.speed_below_optimized', $result['explanation']['reasonCodes'][1]['code']);
        self::assertStringContainsString('It does not move higher', $result['explanation']['long']);
    }

    public function testMissingSignalsDoNotCrashExplanation(): void
    {
        $result = $this->classify([]);

        self::assertContains($result['bracket'], [1, 2, 3, 4, 5]);
        self::assertArrayHasKey('explanation', $result);
        self::assertNotEmpty($result['explanation']['short']);
        self::assertNotEmpty($result['explanation']['detectedSignalsExplanation']);
    }

    /**
     * @param array<string,mixed> $signals
     * @return array<string,mixed>
     */
    private function classify(array $signals): array
    {
        return (new DeckBracketClassifier())->classify($signals);
    }

    /**
     * @return array<string,mixed>
     */
    private function signals(
        int $gameChangers = 0,
        int $massLandDenial = 0,
        int $extraTurns = 0,
        bool $extraTurnLoop = false,
        int $twoCardCombos = 0,
        int $beforeTurnSixCombos = 0,
        int $efficientTutors = 0,
        int $fastManaPremium = 0,
        int $freeInteractionPremium = 0,
        int $compactWincons = 0,
        int $cedhStaples = 0,
        int $staplesScore = 0,
        int $speedScore = 0,
        int $metagameScore = 0,
        int $manaEfficiencyScore = 40,
        string $primaryArchetype = 'mixed',
    ): array {
        return [
            'gameChangerSignal' => ['count' => $gameChangers, 'cards' => $this->cards($gameChangers, 'Game Changer')],
            'massLandDenialSignal' => ['count' => $massLandDenial, 'cards' => $this->cards($massLandDenial, 'MLD'), 'detected' => $massLandDenial > 0],
            'extraTurnSignal' => ['count' => $extraTurns, 'cards' => $this->cards($extraTurns, 'Extra Turn'), 'chainsOrLoops' => $extraTurnLoop, 'repeatableExtraTurns' => $extraTurnLoop],
            'twoCardComboSignal' => [
                'count' => $twoCardCombos,
                'beforeTurnSix' => $beforeTurnSixCombos,
                'lateGameOnly' => max(0, $twoCardCombos - $beforeTurnSixCombos),
                'combos' => [],
            ],
            'nonLandTutorSignal' => ['count' => $efficientTutors, 'efficientCount' => $efficientTutors, 'cards' => $this->cards($efficientTutors, 'Tutor')],
            'fastManaSignal' => [
                'count' => $fastManaPremium,
                'premiumCount' => $fastManaPremium,
                'permanentCount' => $fastManaPremium,
                'oneShotCount' => 0,
                'colorlessCount' => $fastManaPremium,
                'coloredCount' => 0,
                'cards' => $this->cards($fastManaPremium, 'Fast Mana'),
            ],
            'freeInteractionSignal' => ['count' => $freeInteractionPremium, 'premiumCount' => $freeInteractionPremium, 'cards' => $this->cards($freeInteractionPremium, 'Free Interaction')],
            'compactWinconSignal' => ['count' => $compactWincons, 'cardsOrCombos' => []],
            'manaEfficiencySignal' => [
                'score' => $manaEfficiencyScore,
                'fastManaPremiumCount' => $fastManaPremium,
                'earlyColorAccessScore' => $manaEfficiencyScore,
                'untappedSourceScore' => $manaEfficiencyScore,
                'tappedLandPressure' => 100 - $manaEfficiencyScore,
                'slowLandPressure' => 100 - $manaEfficiencyScore,
                'colorlessUtilityPressure' => 100 - $manaEfficiencyScore,
                'fetchTargetQuality' => $manaEfficiencyScore,
                'commanderCastability' => $manaEfficiencyScore,
                'rampFixingQuality' => $manaEfficiencyScore,
                'curveCompatibility' => $manaEfficiencyScore,
                'reasons' => [],
            ],
            'themeSignal' => ['primaryArchetype' => $primaryArchetype, 'confidence' => 'low', 'score' => 0],
            'staplesSignal' => ['score' => $staplesScore, 'cedhStaples' => $cedhStaples, 'highPowerStaples' => 0, 'lowOpportunityCost' => 0, 'cards' => []],
            'speedSignal' => ['score' => $speedScore, 'fastManaCount' => $fastManaPremium, 'premiumFastManaCount' => $fastManaPremium, 'beforeTurnSixTwoCardCombos' => $beforeTurnSixCombos, 'manaEfficiencyScore' => $manaEfficiencyScore],
            'metagameSignal' => ['score' => $metagameScore, 'freeInteractionCount' => $freeInteractionPremium, 'premiumFreeInteractionCount' => $freeInteractionPremium, 'massLandDenialCount' => $massLandDenial, 'graveyardHateCount' => 0, 'counterspellCount' => 0, 'staxCount' => 0],
        ];
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function cards(int $count, string $name): array
    {
        $cards = [];
        for ($index = 1; $index <= $count; ++$index) {
            $cards[] = [
                'deckCardId' => null,
                'cardId' => null,
                'scryfallId' => null,
                'oracleId' => strtolower(str_replace(' ', '-', $name)).'-'.$index,
                'name' => $name.' '.$index,
                'imageUrl' => null,
                'quantity' => 1,
                'section' => 'main',
            ];
        }

        return $cards;
    }
}
