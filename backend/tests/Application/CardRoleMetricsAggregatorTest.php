<?php

namespace App\Tests\Application;

use App\Application\Deck\CardRoleMetricsAggregator;
use PHPUnit\Framework\TestCase;

final class CardRoleMetricsAggregatorTest extends TestCase
{
    public function testRitualHeavyStormKeepsBurstManaOutOfPermanentRamp(): void
    {
        $metrics = $this->aggregate([
            $this->card(2, roles: ['ramp', 'burst_mana', 'ritual'], roleScores: ['ramp' => ['quality' => 'premium', 'repeatability' => 'one_shot']]),
            $this->card(1, roles: ['ramp', 'burst_mana'], roleScores: ['ramp' => ['quality' => 'good', 'repeatability' => 'one_shot']]),
            $this->card(1, roles: ['ramp'], roleScores: ['ramp' => ['quality' => 'good', 'repeatability' => 'permanent']]),
        ]);

        self::assertSame(3, $metrics['roles']['burstMana']);
        self::assertSame(2, $metrics['roles']['rituals']);
        self::assertSame(1, $metrics['roles']['permanentRamp']);
        self::assertSame(3, $metrics['roles']['oneShotMana']);
        self::assertSame(2, $metrics['quality']['ramp']['premium']);
        self::assertSame(3, $metrics['quality']['ramp']['oneShot']);
    }

    public function testFakeAristocratsDoesNotInflateSacrificeOutlets(): void
    {
        $metrics = $this->aggregate([
            $this->card(3, subroles: ['one_shot_sacrifice']),
            $this->card(2, subroles: ['self_sacrifice']),
            $this->card(1, roles: ['sacrifice_outlet']),
            $this->card(2, subroles: ['sacrifice_payoff']),
        ]);

        self::assertSame(1, $metrics['roles']['sacrificeOutlets']);
        self::assertSame(3, $metrics['roles']['oneShotSacrifice']);
        self::assertSame(2, $metrics['roles']['selfSacrifice']);
        self::assertSame(2, $metrics['roles']['sacrificePayoffs']);
    }

    public function testTempoBounceDoesNotInflateHardBoardWipes(): void
    {
        $metrics = $this->aggregate([
            $this->card(3, subroles: ['mass_bounce']),
            $this->card(1, subroles: ['pseudo_wipe']),
            $this->card(1, subroles: ['conditional_wipe']),
            $this->card(1, roles: ['board_wipe'], roleScores: ['board_wipe' => ['quality' => 'good']]),
        ]);

        self::assertSame(1, $metrics['roles']['boardWipes']);
        self::assertSame(3, $metrics['roles']['massBounce']);
        self::assertSame(1, $metrics['roles']['pseudoWipes']);
        self::assertSame(1, $metrics['roles']['conditionalWipes']);
        self::assertSame(1, $metrics['quality']['wipe']['good']);
    }

    public function testLandSearchRampDoesNotInflateTrueTutors(): void
    {
        $metrics = $this->aggregate([
            $this->card(4, subroles: ['ramp_search']),
            $this->card(1, subroles: ['land_tutor']),
            $this->card(1, roles: ['tutor'], subroles: ['true_tutor']),
        ]);

        self::assertSame(1, $metrics['roles']['trueTutors']);
        self::assertSame(1, $metrics['roles']['landTutors']);
        self::assertSame(4, $metrics['roles']['rampSearch']);
        self::assertSame(0, $metrics['roles']['opponentTutors']);
    }

    public function testFetchlandsStaySeparateFromTutorMetrics(): void
    {
        $metrics = $this->aggregate([
            $this->card(10, roles: ['tutor'], subroles: ['land_tutor'], manaProfile: [
                'isFetchland' => true,
                'isLand' => true,
                'isColorFixing' => true,
                'manaSourceCategory' => 'fetchland',
            ]),
        ]);

        self::assertSame(0, $metrics['roles']['trueTutors']);
        self::assertSame(0, $metrics['roles']['typedTutors']);
        self::assertSame(0, $metrics['roles']['landTutors']);
        self::assertSame(0, $metrics['roles']['rampSearch']);
        self::assertSame(10, $metrics['roles']['fetchlands']);
        self::assertSame(10, $metrics['roles']['manaFixing']);
    }

    public function testGreenLandRampDoesNotInflateTutors(): void
    {
        $metrics = $this->aggregate([
            $this->card(3, roles: ['tutor', 'ramp'], subroles: ['ramp_search'], manaProfile: [
                'isLandRamp' => true,
                'isLandSearchToBattlefield' => true,
                'isPermanentRamp' => true,
                'manaSourceCategory' => 'land_ramp',
            ]),
        ]);

        self::assertSame(0, $metrics['roles']['trueTutors']);
        self::assertSame(3, $metrics['roles']['rampSearch']);
        self::assertSame(3, $metrics['roles']['landRamp']);
        self::assertSame(3, $metrics['roles']['permanentRamp']);
    }

    public function testLandTutorsStaySeparateFromTrueTutors(): void
    {
        $metrics = $this->aggregate([
            $this->card(2, roles: ['tutor'], subroles: ['land_tutor'], manaProfile: [
                'isLandTutor' => true,
                'isLandSearchToHand' => true,
                'manaSourceCategory' => 'land_tutor',
            ]),
        ]);

        self::assertSame(0, $metrics['roles']['trueTutors']);
        self::assertSame(2, $metrics['roles']['landTutors']);
    }

    public function testTrueTutorsStillCountStrategicTutors(): void
    {
        $metrics = $this->aggregate([
            $this->card(1, roles: ['tutor'], name: 'Demonic Tutor'),
            $this->card(1, roles: ['tutor'], subroles: ['true_tutor'], name: 'Vampiric Tutor'),
        ]);

        self::assertSame(2, $metrics['roles']['trueTutors']);
    }

    public function testMixedFetchlandsAndTrueTutorsCountIndependently(): void
    {
        $metrics = $this->aggregate([
            $this->card(4, roles: ['tutor'], subroles: ['land_tutor'], manaProfile: [
                'isFetchland' => true,
                'isLand' => true,
                'isColorFixing' => true,
                'manaSourceCategory' => 'fetchland',
            ]),
            $this->card(1, roles: ['tutor'], name: 'Demonic Tutor'),
        ]);

        self::assertSame(1, $metrics['roles']['trueTutors']);
        self::assertSame(4, $metrics['roles']['fetchlands']);
        self::assertSame(0, $metrics['roles']['landTutors']);
    }

    public function testCostReducersAreNotPermanentRamp(): void
    {
        $metrics = $this->aggregate([
            $this->card(1, roles: ['cost_reducer', 'ramp'], name: 'Goblin Electromancer', manaProfile: [
                'isCostReducer' => true,
                'manaSourceCategory' => 'cost_reducer',
            ]),
        ]);

        self::assertSame(1, $metrics['roles']['costReducers']);
        self::assertSame(0, $metrics['roles']['permanentRamp']);
        self::assertSame(0, $metrics['roles']['manaRocks']);
        self::assertSame(0, $metrics['roles']['manaDorks']);
    }

    public function testRitualsAreBurstNotPermanentRamp(): void
    {
        $metrics = $this->aggregate([
            $this->card(2, roles: ['ramp', 'burst_mana', 'ritual'], roleScores: ['ramp' => ['repeatability' => 'one_shot']], manaProfile: [
                'isRitual' => true,
                'isBurstMana' => true,
                'isOneShotMana' => true,
                'manaSourceCategory' => 'ritual',
            ]),
        ]);

        self::assertSame(2, $metrics['roles']['rituals']);
        self::assertSame(2, $metrics['roles']['burstMana']);
        self::assertSame(2, $metrics['roles']['oneShotMana']);
        self::assertSame(0, $metrics['roles']['permanentRamp']);
    }

    public function testStaxSymmetricalRiskIsTrackedSeparately(): void
    {
        $metrics = $this->aggregate([
            $this->card(3, roles: ['stax'], conditionKeys: ['symmetrical_stax_risk']),
            $this->card(1, roles: ['tax'], conditionKeys: ['symmetrical_stax_risk']),
        ]);

        self::assertSame(3, $metrics['roles']['stax']);
        self::assertSame(1, $metrics['roles']['tax']);
        self::assertSame(4, $metrics['roles']['symmetricalStaxRisk']);
    }

    public function testHardControlCountsWipesCounterspellsAndRemoval(): void
    {
        $metrics = $this->aggregate([
            $this->card(3, roles: ['board_wipe'], roleScores: ['board_wipe' => ['quality' => 'premium']]),
            $this->card(5, roles: ['counterspell']),
            $this->card(4, roles: ['spot_removal', 'creature_removal']),
            $this->card(2, roles: ['graveyard_hate']),
        ]);

        self::assertSame(3, $metrics['roles']['boardWipes']);
        self::assertSame(5, $metrics['roles']['counterspells']);
        self::assertSame(4, $metrics['roles']['spotRemoval']);
        self::assertSame(4, $metrics['roles']['creatureRemoval']);
        self::assertSame(2, $metrics['roles']['graveyardHate']);
        self::assertSame(3, $metrics['quality']['wipe']['premium']);
    }

    public function testVoltronInfectCountsThreatsAndProtection(): void
    {
        $metrics = $this->aggregate([
            $this->card(2, subroles: ['infect_threat']),
            $this->card(4, roles: ['protection'], roleScores: ['protection' => ['quality' => 'good']]),
        ]);

        self::assertSame(2, $metrics['roles']['infectThreats']);
        self::assertSame(4, $metrics['roles']['protection']);
        self::assertSame(4, $metrics['quality']['protection']['good']);
    }

    public function testGoWideCountsTokenMakersAndCombatFinishers(): void
    {
        $metrics = $this->aggregate([
            $this->card(6, roles: ['token_maker']),
            $this->card(2, roles: ['combat_finisher'], roleScores: ['wincon' => ['quality' => 'medium']]),
            $this->card(3, subroles: ['combat_support']),
        ]);

        self::assertSame(6, $metrics['roles']['tokenMakers']);
        self::assertSame(2, $metrics['roles']['combatFinishers']);
        self::assertSame(3, $metrics['roles']['combatSupport']);
        self::assertSame(11, $metrics['cards']['totalCards']);
        self::assertSame(3, $metrics['cards']['uniqueCards']);
    }

    /**
     * @param list<array{quantity:int,analysisProfile:array<string,mixed>}> $cards
     * @return array{cards:array<string,int>,roles:array<string,int>,quality:array<string,array<string,int>>}
     */
    private function aggregate(array $cards): array
    {
        return (new CardRoleMetricsAggregator())->aggregate($cards, []);
    }

    /**
     * @param list<string> $roles
     * @param list<string> $subroles
     * @param array<string,array<string,mixed>> $roleScores
     * @param list<string> $conditionKeys
     * @return array{quantity:int,analysisProfile:array<string,mixed>}
     */
    private function card(
        int $quantity,
        array $roles = [],
        array $subroles = [],
        array $roleScores = [],
        array $conditionKeys = [],
        array $manaProfile = [],
        ?string $name = null,
    ): array
    {
        $id = 'test-card-'.substr(hash('sha256', serialize([$quantity, $roles, $subroles, $roleScores, $conditionKeys, $manaProfile, $name])), 0, 12);

        return [
            'deckCardId' => $id.'-deck',
            'cardId' => $id.'-card',
            'scryfallId' => $id.'-scryfall',
            'oracleId' => $id.'-oracle',
            'name' => $name ?? $id,
            'imageUrl' => null,
            'imageUris' => [],
            'cardFaces' => [],
            'quantity' => $quantity,
            'section' => 'main',
            'analysisProfile' => [
                'roles' => $roles,
                'subroles' => $subroles,
                'roleScores' => $roleScores,
                'conditionKeys' => $conditionKeys,
                'powerFlags' => [],
                'flags' => [],
                'types' => ['land' => in_array('land', $roles, true)],
            ],
            'manaProfile' => $manaProfile,
        ];
    }
}
