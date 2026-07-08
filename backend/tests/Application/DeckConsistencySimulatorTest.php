<?php

namespace App\Tests\Application;

use App\Application\Deck\DeckConsistencySimulator;
use PHPUnit\Framework\TestCase;

final class DeckConsistencySimulatorTest extends TestCase
{
    public function testLandCountsShapeOpeningHands(): void
    {
        $lowLand = $this->simulate([
            $this->card(20, 'land', roles: ['land']),
            $this->card(80, 'spell', roles: ['enabler'], manaValue: 2),
        ]);
        $healthyLand = $this->simulate([
            $this->card(40, 'land', roles: ['land']),
            $this->card(60, 'spell', roles: ['enabler'], manaValue: 2),
        ]);
        $flooded = $this->simulate([
            $this->card(50, 'land', roles: ['land']),
            $this->card(50, 'spell', roles: ['enabler'], manaValue: 2),
        ]);

        self::assertGreaterThan(0.45, $lowLand['openingHand']['zeroOrOneLandRate']);
        self::assertGreaterThan(0.70, $healthyLand['openingHand']['twoToFourLandsRate']);
        self::assertGreaterThan(0.20, $flooded['openingHand']['fivePlusLandsRate']);
    }

    public function testRitualsAndPetalsDoNotIncreasePermanentRamp(): void
    {
        $oneShotOnly = $this->simulate([
            $this->card(40, 'land', roles: ['land']),
            $this->card(6, 'dark-ritual', roles: ['ramp', 'burst_mana', 'ritual'], roleScores: ['ramp' => ['repeatability' => 'one_shot']]),
            $this->card(54, 'spell', roles: ['enabler'], manaValue: 2),
        ]);
        $withPermanentRamp = $this->simulate([
            $this->card(40, 'land', roles: ['land']),
            $this->card(4, 'arcane-signet', roles: ['ramp'], roleScores: ['ramp' => ['repeatability' => 'permanent']]),
            $this->card(56, 'spell', roles: ['enabler'], manaValue: 2),
        ]);

        self::assertSame(0.0, $oneShotOnly['openingHand']['permanentRampInOpeningRate']);
        self::assertGreaterThan(0.0, $oneShotOnly['openingHand']['burstManaInOpeningRate']);
        self::assertGreaterThan(0.0, $withPermanentRamp['openingHand']['permanentRampInOpeningRate']);
    }

    public function testLandWithTutorRoleDoesNotIncreaseTrueTutorAccess(): void
    {
        $contaminatedFetch = $this->simulate([
            $this->card(40, 'land', roles: ['land']),
            $this->card(4, 'polluted-delta', roles: ['land', 'tutor'], subroles: ['true_tutor']),
            $this->card(56, 'spell', roles: ['enabler'], manaValue: 2),
        ]);
        $realTutor = $this->simulate([
            $this->card(40, 'land', roles: ['land']),
            $this->card(4, 'demonic-tutor', roles: ['tutor'], subroles: ['true_tutor']),
            $this->card(56, 'spell', roles: ['enabler'], manaValue: 2),
        ]);

        self::assertSame(0.0, $contaminatedFetch['openingHand']['trueTutorInOpeningRate']);
        self::assertSame(0.0, $contaminatedFetch['byTurn']['turn3']['trueTutorSeenRate']);
        self::assertGreaterThan(0.0, $realTutor['openingHand']['trueTutorInOpeningRate']);
        self::assertGreaterThan(0.0, $realTutor['byTurn']['turn3']['trueTutorSeenRate']);
    }

    public function testKeepableHandRules(): void
    {
        $keepable = $this->simulate([
            $this->card(2, 'land', roles: ['land']),
            $this->card(1, 'ramp', roles: ['ramp'], roleScores: ['ramp' => ['repeatability' => 'permanent']]),
            $this->card(4, 'spell', roles: ['enabler'], manaValue: 2),
        ], runs: 5);
        $noLands = $this->simulate([
            $this->card(7, 'spell', roles: ['enabler'], manaValue: 2),
        ], runs: 5);
        $sixLands = $this->simulate([
            $this->card(6, 'land', roles: ['land']),
            $this->card(1, 'ramp', roles: ['ramp'], roleScores: ['ramp' => ['repeatability' => 'permanent']]),
        ], runs: 5);
        $topHeavy = $this->simulate([
            $this->card(3, 'land', roles: ['land']),
            $this->card(4, 'expensive', roles: ['wincon'], manaValue: 7),
        ], runs: 5);

        self::assertSame(1.0, $keepable['openingHand']['keepableHandRate']);
        self::assertSame(0.0, $noLands['openingHand']['keepableHandRate']);
        self::assertSame(0.0, $sixLands['openingHand']['keepableHandRate']);
        self::assertSame(0.0, $topHeavy['openingHand']['keepableHandRate']);
        self::assertSame(1.0, $noLands['keepRule']['failedByTooFewLandsRate']);
        self::assertSame(1.0, $sixLands['keepRule']['failedByTooManyLandsRate']);
        self::assertSame(1.0, $topHeavy['keepRule']['failedByTooTopHeavyRate']);
    }

    public function testCompleteTwoCardComboAccessRequiresCompleteComboSummary(): void
    {
        $complete = $this->simulate([
            $this->card(1, 'oracle', roles: ['combo_piece'], powerFlags: ['compact_wincon']),
            $this->card(1, 'consultation', roles: ['combo_piece']),
            $this->card(5, 'land', roles: ['land']),
        ], combos: [
            'complete' => [[
                'requiredOracleIds' => ['oracle', 'consultation'],
            ]],
        ], runs: 5);
        $oracleOnly = $this->simulate([
            $this->card(1, 'oracle', roles: ['combo_piece'], powerFlags: ['compact_wincon']),
            $this->card(6, 'land', roles: ['land']),
        ], runs: 5);

        self::assertSame(1.0, $complete['comboAccess']['completeTwoCardComboByTurn5Rate']);
        self::assertSame(0.0, $oracleOnly['comboAccess']['completeTwoCardComboByTurn5Rate']);
    }

    public function testSameSeedAndDeckReturnsSameResult(): void
    {
        $cards = [
            $this->card(36, 'land', roles: ['land']),
            $this->card(8, 'ramp', roles: ['ramp'], roleScores: ['ramp' => ['repeatability' => 'permanent']]),
            $this->card(56, 'spell', roles: ['enabler'], manaValue: 2),
        ];

        self::assertSame($this->simulate($cards, seed: 'same-seed'), $this->simulate($cards, seed: 'same-seed'));
    }

    public function testFetchShockProvidesUntappedColorsAndDeadFetchDoesNot(): void
    {
        $fetchShock = $this->simulate([
            $this->card(1, 'commander', section: 'commander', manaCost: '{1}{W}{U}', manaValue: 3, colorIdentity: ['W', 'U']),
            $this->card(1, 'fetch', roles: ['land'], manaProfile: $this->fetchProfile()),
            $this->card(1, 'shock', roles: ['land'], manaProfile: $this->landProfile(['W', 'U'], ['Plains', 'Island'], 'shockland', canEnterUntapped: true)),
            $this->card(5, 'spell', roles: ['enabler'], manaValue: 2, manaCost: '{W}', colorIdentity: ['W']),
        ], mana: $this->manaAnalysis([
            [
                'oracleId' => 'fetch',
                'effectiveColors' => ['white', 'blue'],
                'untappedEffectiveColors' => ['white', 'blue'],
                'tappedOnlyEffectiveColors' => [],
                'dead' => false,
            ],
        ], earlyDemand: ['white' => 5, 'blue' => 0]), runs: 5);
        $deadFetch = $this->simulate([
            $this->card(1, 'commander', section: 'commander', manaCost: '{1}{U}{B}', manaValue: 3, colorIdentity: ['U', 'B']),
            $this->card(1, 'fetch', roles: ['land'], manaProfile: $this->fetchProfile()),
            $this->card(6, 'forest', roles: ['land'], manaProfile: $this->landProfile(['G'], ['Forest'], 'basic', canEnterUntapped: true)),
        ], mana: $this->manaAnalysis([
            [
                'oracleId' => 'fetch',
                'effectiveColors' => [],
                'untappedEffectiveColors' => [],
                'tappedOnlyEffectiveColors' => [],
                'dead' => true,
            ],
        ], earlyDemand: ['blue' => 4]), runs: 5);

        self::assertSame(1.0, $fetchShock['openingHand']['fetchlandWithValidTargetRate']);
        self::assertSame(1.0, $fetchShock['openingHand']['hasCommanderColorsRate']);
        self::assertSame(1.0, $fetchShock['colorAccess']['turn1']['white']);
        self::assertSame(1.0, $fetchShock['colorAccess']['turn1']['blue']);
        self::assertSame(1.0, $deadFetch['openingHand']['fetchlandWithoutTargetRate']);
        self::assertSame(0.0, $deadFetch['colorAccess']['turn1']['blue']);
    }

    public function testTappedTriomeDelaysFetchColors(): void
    {
        $result = $this->simulate([
            $this->card(1, 'commander', section: 'commander', manaCost: '{1}{W}{U}{R}', manaValue: 4, colorIdentity: ['W', 'U', 'R']),
            $this->card(1, 'fetch', roles: ['land'], manaProfile: $this->fetchProfile()),
            $this->card(1, 'triome', roles: ['land'], manaProfile: $this->landProfile(['W', 'U', 'R'], ['Plains', 'Island', 'Mountain'], 'triome', entersTapped: true)),
            $this->card(4, 'spell', roles: ['enabler'], manaValue: 2, manaCost: '{R}', colorIdentity: ['R']),
        ], mana: $this->manaAnalysis([
            [
                'oracleId' => 'fetch',
                'effectiveColors' => ['white', 'blue', 'red'],
                'untappedEffectiveColors' => [],
                'tappedOnlyEffectiveColors' => ['white', 'blue', 'red'],
                'dead' => false,
            ],
        ], earlyDemand: ['red' => 4]), runs: 5);

        self::assertSame(0.0, $result['colorAccess']['turn1']['red']);
        self::assertSame(1.0, $result['colorAccess']['turn2']['red']);
        self::assertSame(1.0, $result['openingHand']['fetchlandWithValidTargetRate']);
    }

    public function testLandCycleTimingAndManaSourceSeparation(): void
    {
        $fastland = $this->simulate([
            $this->card(1, 'commander', section: 'commander', manaCost: '{W}{U}', manaValue: 2, colorIdentity: ['W', 'U']),
            $this->card(1, 'fast', roles: ['land'], manaProfile: $this->landProfile(['W', 'U'], [], 'fastland', canEnterUntapped: true)),
            $this->card(5, 'spell', roles: ['enabler'], manaValue: 2, manaCost: '{W}', colorIdentity: ['W']),
        ], mana: $this->manaAnalysis(earlyDemand: ['white' => 4]), runs: 5);
        $slowland = $this->simulate([
            $this->card(1, 'commander', section: 'commander', manaCost: '{W}{U}', manaValue: 2, colorIdentity: ['W', 'U']),
            $this->card(1, 'slow', roles: ['land'], manaProfile: $this->landProfile(['W', 'U'], [], 'slowland', conditional: true, canEnterUntapped: true)),
            $this->card(5, 'spell', roles: ['enabler'], manaValue: 2, manaCost: '{W}', colorIdentity: ['W']),
        ], mana: $this->manaAnalysis(earlyDemand: ['white' => 4]), runs: 5);
        $filterWithoutInput = $this->simulate([
            $this->card(1, 'commander', section: 'commander', manaCost: '{W}{U}', manaValue: 2, colorIdentity: ['W', 'U']),
            $this->card(1, 'filter', roles: ['land'], manaProfile: $this->landProfile(['W', 'U'], [], 'filterland', conditional: true, canEnterUntapped: true, requiresInput: true)),
            $this->card(5, 'spell', roles: ['enabler'], manaValue: 2, manaCost: '{W}', colorIdentity: ['W']),
        ], mana: $this->manaAnalysis(earlyDemand: ['white' => 4]), runs: 5);
        $pathway = $this->simulate([
            $this->card(1, 'commander', section: 'commander', manaCost: '{W}{U}', manaValue: 2, colorIdentity: ['W', 'U']),
            $this->card(1, 'pathway', roles: ['land'], manaProfile: $this->landProfile(['W', 'U'], [], 'pathway', canEnterUntapped: true)),
            $this->card(5, 'spell', roles: ['enabler'], manaValue: 2, manaCost: '{W}{U}', colorIdentity: ['W', 'U']),
        ], mana: $this->manaAnalysis(earlyDemand: ['white' => 4, 'blue' => 4]), runs: 5);
        $ritual = $this->simulate([
            $this->card(3, 'land', roles: ['land'], manaProfile: $this->landProfile(['B'], ['Swamp'], 'basic', canEnterUntapped: true)),
            $this->card(1, 'ritual', roles: ['ramp', 'burst_mana', 'ritual'], manaProfile: $this->spellManaProfile(ritual: true, burst: true, oneShot: true)),
            $this->card(3, 'spell', roles: ['enabler'], manaValue: 2),
        ], runs: 5);
        $signet = $this->simulate([
            $this->card(2, 'land', roles: ['land'], manaProfile: $this->landProfile(['C'], [], 'basic', canEnterUntapped: true)),
            $this->card(1, 'signet', roles: ['ramp'], manaValue: 2, manaProfile: $this->spellManaProfile(colors: ['W', 'U'], permanentRamp: true, manaRock: true, anyColor: true)),
            $this->card(4, 'spell', roles: ['enabler'], manaValue: 2),
        ], mana: $this->manaAnalysis(earlyDemand: ['white' => 1]), runs: 5);

        self::assertSame(1.0, $fastland['openingHand']['fastlandEarlyAccessRate']);
        self::assertSame(1.0, $fastland['colorAccess']['turn1']['white']);
        self::assertSame(1.0, $slowland['openingHand']['slowlandEarlyDelayRate']);
        self::assertSame(0.0, $slowland['colorAccess']['turn2']['white']);
        self::assertSame(1.0, $slowland['colorAccess']['turn3']['white']);
        self::assertSame(1.0, $filterWithoutInput['openingHand']['filterlandNeedsInputRate']);
        self::assertSame(0.0, $filterWithoutInput['colorAccess']['turn1']['white']);
        self::assertSame(1.0, $pathway['colorAccess']['turn1']['white']);
        self::assertSame(0.0, $pathway['colorAccess']['turn1']['blue']);
        self::assertSame(0.0, $ritual['openingHand']['permanentRampInOpeningRate']);
        self::assertSame(1.0, $ritual['openingHand']['burstManaInOpeningRate']);
        self::assertSame(0.0, $signet['colorAccess']['turn1']['white']);
        self::assertSame(1.0, $signet['colorAccess']['turn3']['white']);
    }

    public function testCommanderCastabilityPenalizesColorlessUtilityLands(): void
    {
        $colored = $this->simulate([
            $this->card(1, 'commander', section: 'commander', manaCost: '{2}{W}{U}', manaValue: 4, colorIdentity: ['W', 'U']),
            $this->card(4, 'azorius-land', roles: ['land'], manaProfile: $this->landProfile(['W', 'U'], [], 'shockland', canEnterUntapped: true)),
            $this->card(2, 'spell', roles: ['enabler'], manaValue: 2, manaCost: '{W}', colorIdentity: ['W']),
        ], mana: $this->manaAnalysis(earlyDemand: ['white' => 3, 'blue' => 3]), runs: 5);
        $colorless = $this->simulate([
            $this->card(1, 'commander', section: 'commander', manaCost: '{2}{W}{U}', manaValue: 4, colorIdentity: ['W', 'U']),
            $this->card(4, 'utility-land', roles: ['land'], manaProfile: $this->landProfile(['C'], [], 'colorless_utility_land', canEnterUntapped: true, colorlessUtility: true)),
            $this->card(2, 'spell', roles: ['enabler'], manaValue: 2, manaCost: '{W}', colorIdentity: ['W']),
        ], mana: $this->manaAnalysis(earlyDemand: ['white' => 3, 'blue' => 3]), runs: 5);

        self::assertGreaterThan($colorless['colorAccess']['commanderCurve']['canCastOnCurveRate'], $colored['colorAccess']['commanderCurve']['canCastOnCurveRate']);
        self::assertSame(1.0, $colorless['colorAccess']['commanderCurve']['missingColorRate']);
    }

    /**
     * @param list<array{quantity:int,oracleId:string,section:string,analysisProfile:array<string,mixed>,manaProfile:array<string,mixed>}> $cards
     * @param array<string,mixed> $combos
     * @return array<string,mixed>
     */
    private function simulate(array $cards, array $combos = [], int $runs = 2000, string $seed = 'test-seed', array $mana = []): array
    {
        $summary = array_replace([
            'complete' => [],
            'partialOneMissing' => [],
            'partialTwoMissing' => [],
        ], $combos);

        return (new DeckConsistencySimulator())->simulate($cards, $summary, [
            'runs' => $runs,
            'seed' => $seed,
            'mana' => $mana,
        ])['consistency'];
    }

    /**
     * @param list<string> $roles
     * @param list<string> $subroles
     * @param list<string> $powerFlags
     * @param array<string,array<string,mixed>> $roleScores
     * @param list<string> $colorIdentity
     * @param array<string,mixed> $manaProfile
     * @return array{quantity:int,oracleId:string,section:string,analysisProfile:array<string,mixed>,manaProfile:array<string,mixed>}
     */
    private function card(
        int $quantity,
        string $oracleId,
        array $roles = [],
        array $subroles = [],
        array $powerFlags = [],
        array $roleScores = [],
        int $manaValue = 2,
        string $section = 'main',
        string $manaCost = '',
        array $colorIdentity = [],
        array $manaProfile = [],
    ): array {
        return [
            'quantity' => $quantity,
            'oracleId' => $oracleId,
            'section' => $section,
            'analysisProfile' => [
                'manaCost' => $manaCost,
                'roles' => $roles,
                'subroles' => $subroles,
                'roleScores' => $roleScores,
                'powerFlags' => $powerFlags,
                'flags' => [],
                'colorIdentity' => $colorIdentity,
                'types' => [
                    'land' => in_array('land', $roles, true),
                ],
                'manaValue' => $manaValue,
            ],
            'manaProfile' => $manaProfile,
        ];
    }

    /**
     * @param list<array<string,mixed>> $fetchDetails
     * @param array<string,int> $earlyDemand
     * @return array<string,mixed>
     */
    private function manaAnalysis(array $fetchDetails = [], array $earlyDemand = []): array
    {
        return [
            'fetchlands' => ['details' => $fetchDetails],
            'requirements' => [
                'earlyPipDemand' => array_replace([
                    'white' => 0,
                    'blue' => 0,
                    'black' => 0,
                    'red' => 0,
                    'green' => 0,
                ], $earlyDemand),
            ],
        ];
    }

    /**
     * @param list<string> $colors
     * @param list<string> $basicTypes
     * @return array<string,mixed>
     */
    private function landProfile(
        array $colors,
        array $basicTypes,
        string $cycle,
        bool $entersTapped = false,
        bool $conditional = false,
        bool $canEnterUntapped = false,
        bool $requiresInput = false,
        bool $colorlessUtility = false,
    ): array {
        return [
            'manaSourceCategory' => 'land',
            'landCycleType' => $cycle,
            'isLand' => true,
            'isFetchland' => false,
            'isColorlessUtilityLand' => $colorlessUtility,
            'basicLandTypes' => $basicTypes,
            'producedManaColors' => $colors,
            'producesColorless' => in_array('C', $colors, true),
            'producesAnyColor' => false,
            'entersTapped' => $entersTapped,
            'entersTappedConditionally' => $conditional,
            'canEnterUntapped' => $canEnterUntapped,
            'requiresInputMana' => $requiresInput,
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function fetchProfile(): array
    {
        return [
            ...$this->landProfile([], [], 'fetchland'),
            'isFetchland' => true,
        ];
    }

    /**
     * @param list<string> $colors
     * @return array<string,mixed>
     */
    private function spellManaProfile(array $colors = [], bool $permanentRamp = false, bool $manaRock = false, bool $ritual = false, bool $burst = false, bool $oneShot = false, bool $anyColor = false): array
    {
        return [
            'isLand' => false,
            'isPermanentRamp' => $permanentRamp,
            'isManaRock' => $manaRock,
            'isManaDork' => false,
            'isRitual' => $ritual,
            'isBurstMana' => $burst,
            'isOneShotMana' => $oneShot,
            'isCostReducer' => false,
            'producedManaColors' => $colors,
            'producesAnyColor' => $anyColor,
        ];
    }
}
