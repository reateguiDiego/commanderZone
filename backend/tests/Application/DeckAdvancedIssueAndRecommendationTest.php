<?php

namespace App\Tests\Application;

use App\Application\Deck\DeckAdvancedIssueDetector;
use App\Application\Deck\DeckAdvancedRecommendationBuilder;
use PHPUnit\Framework\TestCase;

final class DeckAdvancedIssueAndRecommendationTest extends TestCase
{
    public function testFakeAristocratsRequiresRealSacrificeOutlets(): void
    {
        $issues = $this->detect([
            'sacrificeOutlets' => 1,
            'oneShotSacrifice' => 4,
            'selfSacrifice' => 3,
            'sacrificePayoffs' => 3,
            'payoffs' => 2,
        ], archetypes: ['primary' => 'aristocrats', 'secondary' => [], 'confidence' => 'low']);

        self::assertContains('low_real_sacrifice_outlets', $this->issueCodes($issues));
        self::assertContains('add_repeatable_sacrifice_outlet', $this->recommendationCodes($issues));
    }

    public function testGoWideTokensWithoutSacrificePlanDoesNotRequireSacrificeOutlets(): void
    {
        $issues = $this->detect([
            'tokenMakers' => 8,
            'payoffs' => 5,
            'combatFinishers' => 3,
            'sacrificeOutlets' => 0,
            'sacrificePayoffs' => 0,
        ], archetypes: ['primary' => 'tokens', 'secondary' => [], 'confidence' => 'medium']);

        self::assertNotContains('low_real_sacrifice_outlets', $this->issueCodes($issues));
        self::assertNotContains('add_repeatable_sacrifice_outlet', $this->recommendationCodes($issues));
    }

    public function testBlinkValueWithoutSacrificePlanDoesNotRequireSacrificeOutlets(): void
    {
        $issues = $this->detect([
            'enablers' => 7,
            'payoffs' => 5,
            'sacrificeOutlets' => 0,
            'sacrificePayoffs' => 0,
        ], archetypes: ['primary' => 'blink', 'secondary' => [], 'confidence' => 'high']);

        self::assertNotContains('low_real_sacrifice_outlets', $this->issueCodes($issues));
    }

    public function testGenericGoodstuffDoesNotRequireSacrificeOutletsFromGenericPayoffs(): void
    {
        $issues = $this->detect([
            'payoffs' => 6,
            'draw' => 10,
            'spotRemoval' => 6,
            'sacrificeOutlets' => 0,
            'sacrificePayoffs' => 0,
        ], archetypes: ['primary' => 'control', 'secondary' => [], 'confidence' => 'medium']);

        self::assertNotContains('low_real_sacrifice_outlets', $this->issueCodes($issues));
    }

    public function testTempoBounceSeparatesSoftWipesFromHardWipes(): void
    {
        $issues = $this->detect([
            'boardWipes' => 0,
            'massBounce' => 3,
            'pseudoWipes' => 1,
            'conditionalWipes' => 1,
        ]);

        self::assertContains('low_hard_board_wipes', $this->issueCodes($issues));
        self::assertContains('wipes_are_mostly_bounce_or_conditional', $this->issueCodes($issues));
    }

    public function testRitualStormWarnsWhenRampIsMostlyOneShot(): void
    {
        $issues = $this->detect([
            'permanentRamp' => 1,
            'burstMana' => 4,
            'rituals' => 3,
            'oneShotMana' => 2,
        ]);

        self::assertContains('ramp_is_mostly_one_shot', $this->issueCodes($issues));
    }

    public function testComboPiecesWithoutCompleteCombosCreatesPackageWarning(): void
    {
        $issues = $this->detect(['comboPieces' => 7], combos: ['completeCount' => 0, 'partialOneMissingCount' => 0]);

        self::assertContains('combo_pieces_without_complete_combos', $this->issueCodes($issues));
        self::assertContains('review_combo_package', $this->recommendationCodes($issues));
    }

    public function testStaxReportsSymmetricalRisk(): void
    {
        $issues = $this->detect([
            'stax' => 5,
            'tax' => 2,
            'symmetricalStaxRisk' => 3,
        ]);

        self::assertContains('symmetrical_stax_risk', $this->issueCodes($issues));
    }

    public function testLowKeepableHandRateCreatesConsistencyIssue(): void
    {
        $issues = $this->detect([], consistency: [
            'openingHand' => [
                'keepableHandRate' => 0.45,
                'zeroOrOneLandRate' => 0.18,
                'fivePlusLandsRate' => 0.08,
                'earlyPlayInOpeningRate' => 0.7,
                'earlyInteractionInOpeningRate' => 0.4,
            ],
            'mulligan' => ['keepableBy6Rate' => 0.8],
            'byTurn' => ['turn3' => ['permanentRampSeenRate' => 0.55]],
            'comboAccess' => ['completeTwoCardComboByTurn5Rate' => 0.3],
        ]);

        self::assertContains('low_keepable_hand_rate', $this->issueCodes($issues));
    }

    public function testUnmatchedCardsAreReported(): void
    {
        $issues = $this->detect([], unmatchedCards: [
            ['quantity' => 2],
        ]);

        self::assertContains('unmatched_cards_skipped', $this->issueCodes($issues));
    }

    public function testBalancedDeckDoesNotProduceCriticalIssues(): void
    {
        $issues = $this->detect([
            'permanentRamp' => 10,
            'draw' => 10,
            'cardSelection' => 3,
            'trueTutors' => 2,
            'boardWipes' => 3,
            'sacrificeOutlets' => 3,
            'wincons' => 3,
            'combatFinishers' => 1,
            'spotRemoval' => 6,
            'counterspells' => 3,
        ], combos: [
            'completeCount' => 1,
            'partialOneMissingCount' => 1,
            'commanderRequiredCount' => 0,
        ], consistency: [
            'openingHand' => [
                'keepableHandRate' => 0.82,
                'zeroOrOneLandRate' => 0.12,
                'fivePlusLandsRate' => 0.08,
                'earlyPlayInOpeningRate' => 0.76,
                'earlyInteractionInOpeningRate' => 0.35,
            ],
            'mulligan' => ['keepableBy6Rate' => 0.9],
            'byTurn' => ['turn3' => ['permanentRampSeenRate' => 0.5]],
            'comboAccess' => ['completeTwoCardComboByTurn5Rate' => 0.25],
        ]);

        self::assertNotContains('critical', array_column($issues, 'severity'));
    }

    /**
     * @param array<string,int> $roles
     * @param array<string,mixed> $combos
     * @param array{primary:string,secondary:list<string>,confidence:string} $archetypes
     * @param array<string,mixed> $consistency
     * @param list<array{quantity:int}> $unmatchedCards
     * @return list<array{code:string,severity:string,title:string,message:string,evidence:array<string,mixed>,suggestedActionType:string}>
     */
    private function detect(
        array $roles,
        array $combos = [],
        array $archetypes = ['primary' => 'mixed', 'secondary' => [], 'confidence' => 'low'],
        array $consistency = [],
        array $unmatchedCards = [],
    ): array {
        return (new DeckAdvancedIssueDetector())->detect(
            ['roles' => $this->roles($roles)],
            $combos + [
                'completeCount' => 0,
                'partialOneMissingCount' => 0,
                'commanderRequiredCount' => 0,
            ],
            $archetypes,
            [
                'band' => 'casual',
                'signals' => [
                    'fastMana' => 0,
                    'efficientTutors' => 0,
                    'freeInteraction' => 0,
                    'completeWinLikeCombos' => 0,
                    'lowOpportunityCost' => 0,
                ],
            ],
            $consistency,
            $unmatchedCards,
        );
    }

    /**
     * @param array<string,int> $overrides
     * @return array<string,int>
     */
    private function roles(array $overrides): array
    {
        return $overrides + [
            'permanentRamp' => 9,
            'burstMana' => 0,
            'rituals' => 0,
            'oneShotMana' => 0,
            'draw' => 9,
            'cardSelection' => 2,
            'trueTutors' => 2,
            'typedTutors' => 0,
            'landTutors' => 0,
            'rampSearch' => 0,
            'boardWipes' => 2,
            'massBounce' => 0,
            'pseudoWipes' => 0,
            'conditionalWipes' => 0,
            'sacrificeOutlets' => 3,
            'oneShotSacrifice' => 0,
            'selfSacrifice' => 0,
            'sacrificePayoffs' => 0,
            'payoffs' => 0,
            'comboPieces' => 0,
            'wincons' => 2,
            'combatFinishers' => 0,
            'symmetricalStaxRisk' => 0,
        ];
    }

    /**
     * @param list<array{code:string}> $issues
     * @return list<string>
     */
    private function issueCodes(array $issues): array
    {
        return array_column($issues, 'code');
    }

    /**
     * @param list<array{code:string}> $issues
     * @return list<string>
     */
    private function recommendationCodes(array $issues): array
    {
        return array_column((new DeckAdvancedRecommendationBuilder())->build($issues), 'code');
    }
}
