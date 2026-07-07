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

    /**
     * @param list<array{quantity:int,oracleId:string,section:string,analysisProfile:array<string,mixed>}> $cards
     * @param array<string,mixed> $combos
     * @return array<string,mixed>
     */
    private function simulate(array $cards, array $combos = [], int $runs = 2000, string $seed = 'test-seed'): array
    {
        $summary = array_replace([
            'complete' => [],
            'partialOneMissing' => [],
            'partialTwoMissing' => [],
        ], $combos);

        return (new DeckConsistencySimulator())->simulate($cards, $summary, [
            'runs' => $runs,
            'seed' => $seed,
        ])['consistency'];
    }

    /**
     * @param list<string> $roles
     * @param list<string> $powerFlags
     * @param array<string,array<string,mixed>> $roleScores
     * @return array{quantity:int,oracleId:string,section:string,analysisProfile:array<string,mixed>}
     */
    private function card(
        int $quantity,
        string $oracleId,
        array $roles = [],
        array $powerFlags = [],
        array $roleScores = [],
        int $manaValue = 2,
    ): array {
        return [
            'quantity' => $quantity,
            'oracleId' => $oracleId,
            'section' => 'main',
            'analysisProfile' => [
                'roles' => $roles,
                'subroles' => [],
                'roleScores' => $roleScores,
                'powerFlags' => $powerFlags,
                'flags' => [],
                'types' => [
                    'land' => in_array('land', $roles, true),
                ],
                'manaValue' => $manaValue,
            ],
        ];
    }
}
