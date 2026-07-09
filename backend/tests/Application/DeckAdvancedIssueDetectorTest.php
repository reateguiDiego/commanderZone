<?php

namespace App\Tests\Application;

use App\Application\Deck\DeckAdvancedIssueDetector;
use App\Application\Deck\DeckAdvancedAnalysisHealthEvaluator;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Result;
use PHPUnit\Framework\TestCase;

final class DeckAdvancedIssueDetectorTest extends TestCase
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

    public function testWipeIssuesUseDedicatedBoardWipeMetricsWhenAvailable(): void
    {
        $issues = $this->detect(
            [
                'boardWipes' => 5,
                'massBounce' => 0,
                'pseudoWipes' => 0,
                'conditionalWipes' => 0,
            ],
            boardWipes: [
                'hardTotal' => 1,
                'hardCreatureWipes' => 1,
                'massBounce' => 2,
                'pseudoTotal' => 1,
                'conditionalWipes' => 1,
                'selfPlanRiskWipes' => 2,
            ],
        );

        $codes = $this->issueCodes($issues);
        self::assertContains('low_hard_board_wipes', $codes);
        self::assertContains('wipes_are_mostly_bounce_or_conditional', $codes);
        self::assertContains('board_wipes_self_plan_risk', $codes);
    }

    public function testArtifactOnlyWipesDoNotSatisfyHardBoardWipeRequirement(): void
    {
        $issues = $this->detect(
            ['boardWipes' => 0],
            boardWipes: [
                'hardTotal' => 0,
                'hardCreatureWipes' => 0,
                'artifactWipes' => 3,
                'massBounce' => 0,
                'pseudoTotal' => 0,
                'conditionalWipes' => 0,
            ],
        );

        self::assertContains('low_hard_board_wipes', $this->issueCodes($issues));
    }

    public function testNoWipesControlCreatesLowHardBoardWipeIssue(): void
    {
        $issues = $this->detect(
            ['boardWipes' => 0],
            archetypes: ['primary' => 'control', 'secondary' => [], 'confidence' => 'medium'],
            boardWipes: $this->boardWipes([
                'total' => 0,
                'hardTotal' => 0,
                'hardCreatureWipes' => 0,
            ]),
        );

        $lowWipe = $this->issueByCode($issues, 'low_hard_board_wipes');
        self::assertNotNull($lowWipe);
        self::assertSame('critical', $lowWipe['severity']);
        self::assertSame('add_hard_creature_wipe', $lowWipe['suggestedActionType']);
    }

    public function testPseudoOnlyWipesCreateSpecificPseudoIssue(): void
    {
        $issues = $this->detect(
            [],
            boardWipes: $this->boardWipes([
                'total' => 2,
                'hardTotal' => 0,
                'hardCreatureWipes' => 0,
                'pseudoTotal' => 2,
                'combatOnlyWipes' => 2,
            ]),
        );

        self::assertContains('wipes_are_mostly_pseudo', $this->issueCodes($issues));
    }

    public function testBounceOnlyWipesCreateSpecificBounceIssue(): void
    {
        $issues = $this->detect(
            [],
            boardWipes: $this->boardWipes([
                'total' => 2,
                'hardTotal' => 0,
                'hardCreatureWipes' => 0,
                'massBounce' => 2,
            ]),
        );

        self::assertContains('wipes_are_mostly_bounce', $this->issueCodes($issues));
    }

    public function testHardWipesWithoutExileOrMinusXWarnAboutIndestructible(): void
    {
        $issues = $this->detect(
            [],
            boardWipes: $this->boardWipes([
                'total' => 2,
                'hardTotal' => 2,
                'hardCreatureWipes' => 2,
                'destroyWipes' => 1,
                'damageWipes' => 1,
                'answersIndestructible' => 0,
            ]),
        );

        $issue = $this->issueByCode($issues, 'no_indestructible_answer');
        self::assertNotNull($issue);
        self::assertSame('add_wipe_that_answers_indestructible', $issue['suggestedActionType']);
    }

    public function testModalFlexibleWipesCreateStrengthSignal(): void
    {
        $issues = $this->detect(
            [],
            boardWipes: $this->boardWipes([
                'total' => 2,
                'hardTotal' => 2,
                'hardCreatureWipes' => 2,
                'modalWipes' => 2,
                'answersIndestructible' => 1,
            ]),
        );

        self::assertContains('modal_wipe_strength', $this->issueCodes($issues));
    }

    public function testAsymmetricalWipesCreateStrengthSignal(): void
    {
        $issues = $this->detect(
            [],
            boardWipes: $this->boardWipes([
                'total' => 2,
                'hardTotal' => 2,
                'hardCreatureWipes' => 2,
                'asymmetricalWipes' => 2,
                'oneSidedWipes' => 1,
                'answersIndestructible' => 1,
            ]),
        );

        self::assertContains('asymmetrical_wipe_strength', $this->issueCodes($issues));
    }

    public function testCreatureHeavyDeckWithSymmetricalWipesCreatesCollisionIssue(): void
    {
        $issues = $this->detect(
            ['tokenMakers' => 8],
            archetypes: ['primary' => 'tokens', 'secondary' => [], 'confidence' => 'medium'],
            boardWipes: $this->boardWipes([
                'total' => 4,
                'hardTotal' => 4,
                'hardCreatureWipes' => 4,
                'selfPlanRiskWipes' => 4,
                'answersIndestructible' => 1,
            ]),
        );

        self::assertContains('too_many_symmetrical_wipes_for_creature_deck', $this->issueCodes($issues));
        self::assertContains('own_plan_collision_wipes', $this->issueCodes($issues));
    }

    public function testArtifactDeckWithArtifactWipeCreatesOwnPlanCollisionIssue(): void
    {
        $issues = $this->detect(
            [],
            archetypes: ['primary' => 'artifacts', 'secondary' => [], 'confidence' => 'medium'],
            boardWipes: $this->boardWipes([
                'total' => 1,
                'hardTotal' => 0,
                'artifactWipes' => 1,
                'selfPlanRiskWipes' => 1,
                'details' => [
                    ['name' => 'Bane of Progress', 'manaValue' => 6, 'effectiveCostMin' => 6, 'notes' => ['artifact_plan_risk']],
                ],
            ]),
        );

        $issue = $this->issueByCode($issues, 'own_plan_collision_wipes');
        self::assertNotNull($issue);
        self::assertContains('artifact_plan_risk', $issue['evidence']['riskNotes']);
    }

    public function testExpensiveWipePackageCreatesCostIssue(): void
    {
        $issues = $this->detect(
            [],
            archetypes: ['primary' => 'control', 'secondary' => [], 'confidence' => 'medium'],
            boardWipes: $this->boardWipes([
                'total' => 3,
                'hardTotal' => 3,
                'hardCreatureWipes' => 3,
                'answersIndestructible' => 1,
                'effectiveLowCostWipes' => 0,
                'averageManaValue' => 7.0,
                'details' => [
                    ['name' => 'In Garruk\'s Wake', 'manaValue' => 9, 'effectiveCostMin' => 9, 'notes' => []],
                    ['name' => 'Ruinous Ultimatum', 'manaValue' => 7, 'effectiveCostMin' => 7, 'notes' => []],
                    ['name' => 'Hour of Revelation', 'manaValue' => 6, 'effectiveCostMin' => 6, 'notes' => []],
                ],
            ]),
        );

        self::assertContains('expensive_wipe_package', $this->issueCodes($issues));
        self::assertContains('no_cheap_emergency_wipe', $this->issueCodes($issues));
    }

    public function testBalancedBoardWipePackageDoesNotCreateCriticalWipeIssues(): void
    {
        $issues = $this->detect(
            [],
            archetypes: ['primary' => 'control', 'secondary' => [], 'confidence' => 'medium'],
            boardWipes: $this->boardWipes([
                'total' => 4,
                'hardTotal' => 3,
                'hardCreatureWipes' => 2,
                'massBounce' => 1,
                'exileWipes' => 1,
                'minusXMinusXWipes' => 1,
                'artifactEnchantmentWipes' => 1,
                'graveyardWipes' => 1,
                'modalWipes' => 1,
                'asymmetricalWipes' => 1,
                'answersIndestructible' => 2,
                'effectiveLowCostWipes' => 1,
                'averageManaValue' => 4.0,
            ]),
        );

        self::assertNotContains('critical', array_column($issues, 'severity'));
        self::assertNotContains('low_hard_board_wipes', $this->issueCodes($issues));
        self::assertNotContains('wipes_are_mostly_pseudo', $this->issueCodes($issues));
        self::assertNotContains('wipes_are_mostly_bounce', $this->issueCodes($issues));
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

    public function testComboTutorIssueUsesTrueAndTypedTutorsOnly(): void
    {
        $issues = $this->detect(
            [
                'trueTutors' => 0,
                'typedTutors' => 2,
                'rampSearch' => 5,
                'landTutors' => 3,
            ],
            archetypes: ['primary' => 'combo', 'secondary' => [], 'confidence' => 'medium'],
        );

        self::assertContains('low_true_tutors_for_combo', $this->issueCodes($issues));
        self::assertContains('tutor_count_inflated_by_ramp_search', $this->issueCodes($issues));
    }

    public function testManaAnalysisIssuesAreReported(): void
    {
        $issues = $this->detect([], mana: [
            'fetchlands' => ['count' => 3, 'deadFetchlands' => 1],
            'lands' => ['tappedLands' => 14, 'conditionallyTappedLands' => 5, 'colorlessUtilityLands' => 8],
            'landCycleAnalysis' => [
                'tappedLandPressure' => 'critical',
                'colorlessUtilityPressure' => 'warning',
            ],
            'fixing' => ['landRampFixing' => 0],
        ]);

        self::assertContains('fetchlands_without_targets', $this->issueCodes($issues));
        self::assertContains('too_many_tapped_lands', $this->issueCodes($issues));
        self::assertContains('colorless_land_pressure', $this->issueCodes($issues));
    }

    public function testSpecificManabaseIssuesAreReported(): void
    {
        $issues = $this->detect([
            'permanentRamp' => 9,
            'landRamp' => 3,
            'rituals' => 5,
            'burstMana' => 5,
            'costReducers' => 5,
        ], mana: [
            'sources' => [
                'white' => 6,
                'blue' => 3,
                'black' => 9,
                'red' => 14,
                'green' => 12,
            ],
            'earlySources' => [
                'turn2' => [
                    'white' => 2,
                    'blue' => 1,
                    'black' => 3,
                    'red' => 9,
                    'green' => 8,
                ],
            ],
            'requirements' => [
                'pipDemand' => [
                    'white' => 16,
                    'blue' => 18,
                    'black' => 4,
                    'red' => 8,
                    'green' => 6,
                ],
                'earlyPipDemand' => [
                    'white' => 8,
                    'blue' => 10,
                    'black' => 0,
                    'red' => 2,
                    'green' => 0,
                ],
                'commanderCastability' => [
                    'blue' => [
                        'requiredPips' => 1,
                        'sourceCount' => 3,
                        'earlySourceCount' => 1,
                        'status' => 'critical',
                    ],
                ],
            ],
            'fetchlands' => [
                'count' => 4,
                'deadFetchlands' => 0,
                'effectiveColorSources' => ['blue' => 4],
                'untappedEffectiveColorSources' => ['blue' => 0],
                'tappedOnlyEffectiveColorSources' => ['blue' => 4],
            ],
            'lands' => ['tappedLands' => 12, 'conditionallyTappedLands' => 4, 'colorlessUtilityLands' => 7],
            'landCycles' => ['painland' => 6],
            'landCycleAnalysis' => [
                'fetchSynergyScore' => 'warning',
                'typedLandDensity' => 0.12,
                'tappedLandPressure' => 'critical',
                'colorlessUtilityPressure' => 'warning',
                'checklandSupport' => 'warning',
                'filterlandInputPressure' => 'warning',
                'pathwayColorChoicePressure' => 'warning',
                'bounceLandTempoPressure' => 'warning',
            ],
            'fixing' => ['landRampFixing' => 0],
        ], consistency: [
            'openingHand' => [
                'keepableHandRate' => 0.8,
                'keepableManaRate' => 0.5,
                'hasPrimaryColorRate' => 0.55,
                'tappedLandHeavyRate' => 0.3,
                'slowlandEarlyDelayRate' => 0.35,
                'zeroOrOneLandRate' => 0.1,
                'fivePlusLandsRate' => 0.1,
                'earlyPlayInOpeningRate' => 0.8,
                'earlyInteractionInOpeningRate' => 0.4,
            ],
            'mulligan' => ['keepableBy6Rate' => 0.85],
            'byTurn' => ['turn3' => ['permanentRampSeenRate' => 0.5]],
            'comboAccess' => ['completeTwoCardComboByTurn5Rate' => 0.3],
            'colorAccess' => ['commanderCurve' => ['canCastOnCurveRate' => 0.4]],
        ]);
        $codes = $this->issueCodes($issues);

        foreach ([
            'low_colored_sources',
            'weak_primary_color_sources',
            'low_early_color_access',
            'low_commander_castability',
            'commander_color_bottleneck',
            'fetchlands_mostly_tapped_targets',
            'typed_land_density_low_for_fetches',
            'typed_land_density_low_for_checklands',
            'checklands_not_supported',
            'filterlands_need_input_sources',
            'pathways_create_color_choice_pressure',
            'bounce_lands_tempo_risk',
            'painland_life_pressure',
            'ramp_does_not_fix_colors',
            'rituals_not_stable_ramp',
            'cost_reducers_not_mana_sources',
            'too_many_slow_lands',
            'colorless_land_pressure',
        ] as $expectedCode) {
            self::assertContains($expectedCode, $codes);
        }

    }

    public function testGoodManabaseDoesNotProduceCriticalManaIssues(): void
    {
        $issues = $this->detect([], mana: $this->goodMana());

        self::assertNotContains('critical', array_column($issues, 'severity'));
        self::assertNotContains('fetchlands_without_targets', $this->issueCodes($issues));
        self::assertNotContains('low_colored_sources', $this->issueCodes($issues));
    }

    public function testManaHealthSummarizesManaEvidence(): void
    {
        $connection = $this->createStub(Connection::class);
        $result = $this->createStub(Result::class);
        $result->method('iterateAssociative')->willReturn(new \ArrayIterator([]));
        $connection->method('executeQuery')->willReturn($result);
        $issues = [
            ['code' => 'commander_color_bottleneck', 'severity' => 'warning'],
        ];

        $health = (new DeckAdvancedAnalysisHealthEvaluator($connection))->evaluate(
            ['roles' => $this->roles([]), 'mana' => $this->goodMana([
                'requirements' => [
                    'commanderCastability' => [
                        'blue' => ['status' => 'warning', 'sourceCount' => 9, 'earlySourceCount' => 5],
                    ],
                ],
            ])],
            issues: $issues,
        );

        self::assertArrayHasKey('mana', $health);
        self::assertSame('warning', $health['mana']['status']);
        self::assertSame('manaIssueDetected', $health['mana']['reasonCode']);
        self::assertSame(36, $health['mana']['evidence']['lands']);
        self::assertSame('warning', $health['mana']['evidence']['commanderCastability']);
        self::assertSame(14, $health['mana']['evidence']['coloredSources']['blue']);
    }

    public function testComboPiecesWithoutCompleteCombosCreatesPackageWarning(): void
    {
        $issues = $this->detect(['comboPieces' => 7], combos: ['completeCount' => 0, 'partialOneMissingCount' => 0]);

        self::assertContains('combo_pieces_without_complete_combos', $this->issueCodes($issues));
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
        array $mana = [],
        array $boardWipes = [],
    ): array {
        $metrics = ['roles' => $this->roles($roles), 'mana' => $mana];
        if ($boardWipes !== []) {
            $metrics['boardWipes'] = $boardWipes;
        }

        return (new DeckAdvancedIssueDetector())->detect(
            $metrics,
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
            'graveyardHate' => 0,
        ];
    }

    /**
     * @param array<string,mixed> $overrides
     * @return array<string,mixed>
     */
    private function boardWipes(array $overrides): array
    {
        return $overrides + [
            'total' => 0,
            'hardTotal' => 0,
            'pseudoTotal' => 0,
            'creatureWipes' => 0,
            'hardCreatureWipes' => 0,
            'exileWipes' => 0,
            'destroyWipes' => 0,
            'sacrificeWipes' => 0,
            'bounceWipes' => 0,
            'massBounce' => 0,
            'damageWipes' => 0,
            'minusXMinusXWipes' => 0,
            'artifactWipes' => 0,
            'enchantmentWipes' => 0,
            'artifactEnchantmentWipes' => 0,
            'graveyardWipes' => 0,
            'modalWipes' => 0,
            'conditionalWipes' => 0,
            'asymmetricalWipes' => 0,
            'oneSidedWipes' => 0,
            'overloadedWipes' => 0,
            'scalableWipes' => 0,
            'combatOnlyWipes' => 0,
            'answersIndestructible' => 0,
            'opponentCompensationWipes' => 0,
            'effectiveLowCostWipes' => 0,
            'selfPlanRiskWipes' => 0,
            'averageManaValue' => 0.0,
            'details' => [],
        ];
    }

    /**
     * @param list<array{code:string}> $issues
     * @return array<string,mixed>|null
     */
    private function issueByCode(array $issues, string $code): ?array
    {
        foreach ($issues as $issue) {
            if ($issue['code'] === $code) {
                return $issue;
            }
        }

        return null;
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
     * @param array<string,mixed> $overrides
     * @return array<string,mixed>
     */
    private function goodMana(array $overrides = []): array
    {
        return array_replace_recursive([
            'sources' => [
                'white' => 14,
                'blue' => 14,
                'black' => 12,
                'red' => 0,
                'green' => 0,
            ],
            'earlySources' => [
                'turn2' => [
                    'white' => 8,
                    'blue' => 8,
                    'black' => 7,
                    'red' => 0,
                    'green' => 0,
                ],
            ],
            'requirements' => [
                'pipDemand' => [
                    'white' => 12,
                    'blue' => 12,
                    'black' => 8,
                    'red' => 0,
                    'green' => 0,
                ],
                'earlyPipDemand' => [
                    'white' => 4,
                    'blue' => 4,
                    'black' => 2,
                    'red' => 0,
                    'green' => 0,
                ],
                'commanderCastability' => [
                    'white' => ['status' => 'good', 'sourceCount' => 14, 'earlySourceCount' => 8],
                    'blue' => ['status' => 'good', 'sourceCount' => 14, 'earlySourceCount' => 8],
                ],
            ],
            'fetchlands' => [
                'count' => 4,
                'deadFetchlands' => 0,
                'effectiveColorSources' => ['white' => 4, 'blue' => 4],
                'untappedEffectiveColorSources' => ['white' => 4, 'blue' => 4],
                'tappedOnlyEffectiveColorSources' => ['white' => 0, 'blue' => 0],
            ],
            'lands' => ['total' => 36, 'tappedLands' => 4, 'conditionallyTappedLands' => 2, 'colorlessUtilityLands' => 2],
            'landCycles' => ['painland' => 2],
            'landCycleAnalysis' => [
                'fetchSynergyScore' => 'good',
                'typedLandDensity' => 0.35,
                'tappedLandPressure' => 'good',
                'colorlessUtilityPressure' => 'good',
                'checklandSupport' => 'good',
                'filterlandInputPressure' => 'unknown',
                'pathwayColorChoicePressure' => 'unknown',
                'bounceLandTempoPressure' => 'unknown',
            ],
            'fixing' => ['landRampFixing' => 2],
        ], $overrides);
    }
}
