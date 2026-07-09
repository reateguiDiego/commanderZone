<?php

namespace App\Tests\Integration;

use App\Application\Deck\DeckBoardWipeAnalyzer;
use Doctrine\DBAL\ParameterType;

final class DeckBoardWipeAnalyzerTest extends ApiTestCase
{
    public function testClassicWrathPackageCountsHardCreatureWipes(): void
    {
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000001', 'Wrath of God', methods: ['destroy'], scope: ['creatures'], hardCreature: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000002', 'Damnation', methods: ['destroy'], scope: ['creatures'], hardCreature: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000003', 'Supreme Verdict', methods: ['destroy'], scope: ['creatures'], hardCreature: true);

        $metrics = $this->analyze(['Wrath of God', 'Damnation', 'Supreme Verdict']);

        self::assertSame(3, $metrics['total']);
        self::assertSame(3, $metrics['hardTotal']);
        self::assertSame(3, $metrics['hardCreatureWipes']);
        self::assertSame(3, $metrics['destroyWipes']);
        self::assertSame(0, $metrics['pseudoTotal']);
    }

    public function testBouncePackageSeparatesMassBouncePseudoAndCombatOnly(): void
    {
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000011', 'Cyclonic Rift', type: 'bounce_wipe', methods: ['bounce'], scope: ['nonland_permanents', 'opponents_only'], symmetry: 'one_sided', overload: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000012', 'Evacuation', type: 'bounce_wipe', methods: ['bounce'], scope: ['creatures']);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000013', 'Aetherize', type: 'combat_only_wipe', methods: ['bounce'], scope: ['attacking_creatures'], pseudo: true, instant: true);

        $metrics = $this->analyze(['Cyclonic Rift', 'Evacuation', 'Aetherize']);

        self::assertSame(3, $metrics['total']);
        self::assertSame(0, $metrics['hardTotal']);
        self::assertSame(2, $metrics['massBounce']);
        self::assertSame(1, $metrics['pseudoTotal']);
        self::assertSame(1, $metrics['combatOnlyWipes']);
        self::assertSame(1, $metrics['overloadedWipes']);
        self::assertSame(1, $metrics['oneSidedWipes']);
    }

    public function testModalPackageTracksCoverageWithoutOvercountingTotal(): void
    {
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000021', 'Farewell', type: 'modal_wipe', methods: ['exile', 'graveyard_exile'], scope: ['artifacts', 'creatures', 'enchantments', 'graveyards'], modal: true, answersIndestructible: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000022', 'Austere Command', type: 'modal_wipe', methods: ['destroy'], scope: ['artifacts', 'creatures', 'enchantments'], modal: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000023', 'Cleansing Nova', type: 'modal_wipe', methods: ['destroy'], scope: ['artifacts', 'creatures', 'enchantments'], modal: true);

        $metrics = $this->analyze(['Farewell', 'Austere Command', 'Cleansing Nova']);

        self::assertSame(3, $metrics['total']);
        self::assertSame(3, $metrics['modalWipes']);
        self::assertSame(3, $metrics['creatureWipes']);
        self::assertSame(3, $metrics['artifactWipes']);
        self::assertSame(3, $metrics['enchantmentWipes']);
        self::assertSame(1, $metrics['graveyardWipes']);
        self::assertSame(1, $metrics['exileWipes']);
    }

    public function testOverloadPackageCountsMassModeOnlyByActualEffect(): void
    {
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000011', 'Cyclonic Rift', type: 'bounce_wipe', methods: ['bounce'], scope: ['nonland_permanents', 'opponents_only'], symmetry: 'one_sided', overload: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000032', 'Vandalblast', type: 'artifact_wipe', methods: ['destroy'], scope: ['artifacts', 'opponents_only'], symmetry: 'one_sided', overload: true, creature: false, noncreature: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000033', 'Mizzium Mortars', type: 'damage_wipe', methods: ['damage'], scope: ['creatures', 'opponents_only'], symmetry: 'one_sided', overload: true);

        $metrics = $this->analyze(['Cyclonic Rift', 'Vandalblast', 'Mizzium Mortars']);

        self::assertSame(3, $metrics['overloadedWipes']);
        self::assertSame(1, $metrics['massBounce']);
        self::assertSame(1, $metrics['artifactWipes']);
        self::assertSame(1, $metrics['damageWipes']);
        self::assertSame(1, $metrics['hardCreatureWipes']);
        self::assertSame(3, $metrics['asymmetricalWipes']);
    }

    public function testPromptRepresentativeLegacyCountsDoNotOvercountCards(): void
    {
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000021', 'Farewell', type: 'modal_wipe', methods: ['exile', 'graveyard_exile'], scope: ['artifacts', 'creatures', 'enchantments', 'graveyards'], modal: true, answersIndestructible: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000022', 'Austere Command', type: 'modal_wipe', methods: ['destroy'], scope: ['artifacts', 'creatures', 'enchantments'], modal: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000011', 'Cyclonic Rift', type: 'bounce_wipe', methods: ['bounce'], scope: ['nonland_permanents', 'opponents_only'], symmetry: 'one_sided', overload: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000013', 'Aetherize', type: 'combat_only_wipe', methods: ['bounce'], scope: ['attacking_creatures'], pseudo: true, instant: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000032', 'Vandalblast', type: 'artifact_wipe', methods: ['destroy'], scope: ['artifacts', 'opponents_only'], symmetry: 'one_sided', overload: true, creature: false, noncreature: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000041', 'Toxic Deluge', type: 'minus_x_minus_x_wipe', methods: ['minus_x_minus_x'], scope: ['creatures'], answersIndestructible: true, scalable: true, effectiveCostMin: 3.0);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000044', 'Blasphemous Act', type: 'damage_wipe', methods: ['damage'], scope: ['creatures'], manaValue: 9.0, effectiveCostMin: 1.0);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000003', 'Supreme Verdict', methods: ['destroy'], scope: ['creatures'], hardCreature: true);

        $farewell = $this->analyze(['Farewell']);
        self::assertSame(1, $farewell['total']);
        self::assertSame(1, $farewell['modalWipes']);
        self::assertSame(1, $farewell['exileWipes']);
        self::assertSame(1, $farewell['graveyardWipes']);
        self::assertSame(1, $farewell['artifactWipes']);

        $austere = $this->analyze(['Austere Command']);
        self::assertSame(1, $austere['total']);
        self::assertSame(1, $austere['modalWipes']);
        self::assertSame(1, $austere['artifactWipes']);
        self::assertSame(1, $austere['enchantmentWipes']);

        $rift = $this->analyze(['Cyclonic Rift']);
        self::assertSame(1, $rift['overloadedWipes']);
        self::assertSame(1, $rift['massBounce']);
        self::assertSame(1, $rift['asymmetricalWipes']);
        self::assertSame(0, $rift['hardCreatureWipes']);

        $aetherize = $this->analyze(['Aetherize']);
        self::assertSame(1, $aetherize['combatOnlyWipes']);
        self::assertSame(1, $aetherize['pseudoTotal']);
        self::assertSame(0, $aetherize['hardCreatureWipes']);

        $vandalblast = $this->analyze(['Vandalblast']);
        self::assertSame(1, $vandalblast['artifactWipes']);
        self::assertSame(0, $vandalblast['creatureWipes']);

        $toxic = $this->analyze(['Toxic Deluge']);
        self::assertSame(1, $toxic['hardCreatureWipes']);
        self::assertSame(1, $toxic['answersIndestructible']);

        $blasphemous = $this->analyze(['Blasphemous Act']);
        self::assertSame(1, $blasphemous['damageWipes']);
        self::assertSame(1, $blasphemous['hardCreatureWipes']);
        self::assertSame(0, $blasphemous['answersIndestructible']);

        $verdict = $this->analyze(['Supreme Verdict']);
        self::assertSame(1, $verdict['hardCreatureWipes']);
    }

    public function testIndestructibleAnswersAreTrackedSeparately(): void
    {
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000041', 'Toxic Deluge', type: 'minus_x_minus_x_wipe', methods: ['minus_x_minus_x'], scope: ['creatures'], answersIndestructible: true, scalable: true, effectiveCostMin: 3.0);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000021', 'Farewell', type: 'modal_wipe', methods: ['exile', 'graveyard_exile'], scope: ['artifacts', 'creatures', 'enchantments', 'graveyards'], modal: true, answersIndestructible: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000043', 'All Is Dust', type: 'sacrifice_wipe', methods: ['sacrifice'], scope: ['colored_permanents', 'all_players'], answersIndestructible: true, manaValue: 7.0, effectiveCostMin: 7.0);

        $metrics = $this->analyze(['Toxic Deluge', 'Farewell', 'All Is Dust']);

        self::assertSame(3, $metrics['answersIndestructible']);
        self::assertSame(1, $metrics['minusXMinusXWipes']);
        self::assertSame(1, $metrics['sacrificeWipes']);
        self::assertSame(2, $metrics['effectiveLowCostWipes']);
    }

    public function testArtifactAndEnchantmentCoverageDoesNotInflateCreatureWipes(): void
    {
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000032', 'Vandalblast', type: 'artifact_wipe', methods: ['destroy'], scope: ['artifacts', 'opponents_only'], symmetry: 'one_sided', overload: true, creature: false, noncreature: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000052', 'Bane of Progress', type: 'artifact_enchantment_wipe', methods: ['destroy'], scope: ['artifacts', 'enchantments'], creature: false, noncreature: true);

        $metrics = $this->analyze(['Vandalblast', 'Bane of Progress']);

        self::assertSame(2, $metrics['total']);
        self::assertSame(0, $metrics['creatureWipes']);
        self::assertSame(0, $metrics['hardCreatureWipes']);
        self::assertSame(2, $metrics['artifactWipes']);
        self::assertSame(1, $metrics['enchantmentWipes']);
        self::assertSame(1, $metrics['artifactEnchantmentWipes']);
    }

    public function testCreatureHeavyDeckMarksSymmetricalCreatureWipesAsSelfPlanRisk(): void
    {
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000001', 'Wrath of God', methods: ['destroy'], scope: ['creatures'], hardCreature: true);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000002', 'Damnation', methods: ['destroy'], scope: ['creatures'], hardCreature: true);

        $cards = [
            ...$this->cards(['Wrath of God', 'Damnation']),
            ...$this->creatures(25),
        ];
        $metrics = (new DeckBoardWipeAnalyzer($this->connection()))->analyze($cards);

        self::assertSame(2, $metrics['selfPlanRiskWipes']);
        self::assertContains('self_plan_risk', $metrics['details'][0]['notes']);
    }

    public function testGoodControlDeckHealthCanBeGoodOrExcellentFromRichMetrics(): void
    {
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000003', 'Supreme Verdict', methods: ['destroy'], scope: ['creatures'], hardCreature: true, effectiveCostMin: 4.0);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000041', 'Toxic Deluge', type: 'minus_x_minus_x_wipe', methods: ['minus_x_minus_x'], scope: ['creatures'], answersIndestructible: true, scalable: true, effectiveCostMin: 3.0);
        $this->insertBoardWipeProfile('93000000-0000-0000-0001-000000000021', 'Farewell', type: 'modal_wipe', methods: ['exile', 'graveyard_exile'], scope: ['artifacts', 'creatures', 'enchantments', 'graveyards'], modal: true, answersIndestructible: true);

        $metrics = [
            'roles' => ['boardWipes' => 3],
            'roleCards' => [],
            'boardWipes' => $this->analyze(['Supreme Verdict', 'Toxic Deluge', 'Farewell'], ['primary' => 'control', 'secondary' => []]),
        ];
        $health = (new \App\Application\Deck\DeckAdvancedAnalysisHealthEvaluator($this->connection()))->evaluate($metrics);

        self::assertContains($health['boardWipes']['status'], ['good', 'excellent']);
        self::assertSame(3, $health['boardWipes']['evidence']['hardCreatureWipes']);
        self::assertGreaterThan(0, $health['boardWipes']['evidence']['answersIndestructible']);
    }

    /**
     * @param list<string> $names
     * @param array{primary?:string,secondary?:list<string>} $archetypes
     * @return array<string,mixed>
     */
    private function analyze(array $names, array $archetypes = []): array
    {
        return (new DeckBoardWipeAnalyzer($this->connection()))->analyze($this->cards($names), $archetypes);
    }

    /**
     * @param list<string> $names
     * @return list<array<string,mixed>>
     */
    private function cards(array $names): array
    {
        $cards = [];
        foreach ($names as $index => $name) {
            $cards[] = [
                'deckCardId' => 'deck-card-'.$index,
                'cardId' => 'card-'.$index,
                'scryfallId' => 'scryfall-'.$index,
                'oracleId' => $this->oracleId($name),
                'name' => $name,
                'quantity' => 1,
                'section' => 'main',
                'analysisProfile' => ['types' => [], 'roles' => [], 'subroles' => [], 'conditionKeys' => []],
                'manaProfile' => [],
            ];
        }

        return $cards;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function creatures(int $count): array
    {
        $cards = [];
        for ($index = 0; $index < $count; ++$index) {
            $cards[] = [
                'deckCardId' => 'creature-'.$index,
                'cardId' => 'creature-card-'.$index,
                'scryfallId' => 'creature-scryfall-'.$index,
                'oracleId' => '93000000-0000-0000-0002-'.str_pad((string) $index, 12, '0', STR_PAD_LEFT),
                'name' => 'Creature '.$index,
                'quantity' => 1,
                'section' => 'main',
                'analysisProfile' => ['types' => ['creature' => true], 'roles' => [], 'subroles' => [], 'conditionKeys' => []],
                'manaProfile' => [],
            ];
        }

        return $cards;
    }

    /**
     * @param list<string> $methods
     * @param list<string> $scope
     */
    private function insertBoardWipeProfile(
        string $oracleId,
        string $name,
        string $type = 'hard_creature_wipe',
        array $methods = ['destroy'],
        array $scope = ['creatures'],
        string $symmetry = 'symmetrical',
        bool $hardCreature = false,
        bool $creature = true,
        bool $noncreature = false,
        bool $permanent = false,
        bool $pseudo = false,
        bool $modal = false,
        bool $overload = false,
        bool $instant = false,
        bool $repeatable = false,
        bool $scalable = false,
        bool $answersIndestructible = false,
        float $manaValue = 4.0,
        ?float $effectiveCostMin = null,
    ): void {
        $this->connection()->executeStatement(
            <<<'SQL'
INSERT INTO card_board_wipe_profile (
    oracle_id,
    name,
    mana_value,
    is_board_wipe,
    is_creature_wipe,
    is_noncreature_wipe,
    is_permanent_wipe,
    is_pseudo_wipe,
    board_wipe_type,
    wipe_method,
    wipe_scope,
    symmetry_profile,
    effective_cost_min,
    is_instant_speed,
    is_permanent_activated,
    is_repeatable,
    has_modes,
    has_alternative_mass_mode,
    alternative_cost_type,
    mass_mode_type,
    is_scalable,
    answers_indestructible,
    gets_around_hexproof_shroud,
    opponent_compensation,
    analysis_hash,
    updated_at
) VALUES (
    :oracle_id,
    :name,
    :mana_value,
    true,
    :is_creature_wipe,
    :is_noncreature_wipe,
    :is_permanent_wipe,
    :is_pseudo_wipe,
    :board_wipe_type,
    :wipe_method::jsonb,
    :wipe_scope::jsonb,
    :symmetry_profile,
    :effective_cost_min,
    :is_instant_speed,
    :is_permanent_activated,
    :is_repeatable,
    :has_modes,
    :has_alternative_mass_mode,
    :alternative_cost_type,
    :mass_mode_type,
    :is_scalable,
    :answers_indestructible,
    :gets_around_hexproof_shroud,
    :opponent_compensation,
    :analysis_hash,
    NOW()
)
SQL,
            [
                'oracle_id' => $oracleId,
                'name' => $name,
                'mana_value' => $manaValue,
                'is_creature_wipe' => $hardCreature || $creature,
                'is_noncreature_wipe' => $noncreature,
                'is_permanent_wipe' => $permanent,
                'is_pseudo_wipe' => $pseudo,
                'board_wipe_type' => $type,
                'wipe_method' => json_encode($methods, JSON_THROW_ON_ERROR),
                'wipe_scope' => json_encode($scope, JSON_THROW_ON_ERROR),
                'symmetry_profile' => $symmetry,
                'effective_cost_min' => $effectiveCostMin ?? $manaValue,
                'is_instant_speed' => $instant,
                'is_permanent_activated' => $repeatable,
                'is_repeatable' => $repeatable,
                'has_modes' => $modal,
                'has_alternative_mass_mode' => $overload,
                'alternative_cost_type' => $overload ? 'overload' : null,
                'mass_mode_type' => in_array('bounce', $methods, true) ? 'mass_bounce' : ($type === 'artifact_wipe' ? 'artifact_wipe' : 'board_wipe'),
                'is_scalable' => $scalable,
                'answers_indestructible' => $answersIndestructible,
                'gets_around_hexproof_shroud' => $hardCreature || $permanent,
                'opponent_compensation' => 'none',
                'analysis_hash' => hash('sha256', $oracleId.$name),
            ],
            [
                'is_creature_wipe' => ParameterType::BOOLEAN,
                'is_noncreature_wipe' => ParameterType::BOOLEAN,
                'is_permanent_wipe' => ParameterType::BOOLEAN,
                'is_pseudo_wipe' => ParameterType::BOOLEAN,
                'is_instant_speed' => ParameterType::BOOLEAN,
                'is_permanent_activated' => ParameterType::BOOLEAN,
                'is_repeatable' => ParameterType::BOOLEAN,
                'has_modes' => ParameterType::BOOLEAN,
                'has_alternative_mass_mode' => ParameterType::BOOLEAN,
                'is_scalable' => ParameterType::BOOLEAN,
                'answers_indestructible' => ParameterType::BOOLEAN,
                'gets_around_hexproof_shroud' => ParameterType::BOOLEAN,
            ],
        );
    }

    private function oracleId(string $name): string
    {
        return match ($name) {
            'Wrath of God' => '93000000-0000-0000-0001-000000000001',
            'Damnation' => '93000000-0000-0000-0001-000000000002',
            'Supreme Verdict' => '93000000-0000-0000-0001-000000000003',
            'Cyclonic Rift' => '93000000-0000-0000-0001-000000000011',
            'Evacuation' => '93000000-0000-0000-0001-000000000012',
            'Aetherize' => '93000000-0000-0000-0001-000000000013',
            'Farewell' => '93000000-0000-0000-0001-000000000021',
            'Austere Command' => '93000000-0000-0000-0001-000000000022',
            'Cleansing Nova' => '93000000-0000-0000-0001-000000000023',
            'Vandalblast' => '93000000-0000-0000-0001-000000000032',
            'Mizzium Mortars' => '93000000-0000-0000-0001-000000000033',
            'Toxic Deluge' => '93000000-0000-0000-0001-000000000041',
            'Blasphemous Act' => '93000000-0000-0000-0001-000000000044',
            'All Is Dust' => '93000000-0000-0000-0001-000000000043',
            'Bane of Progress' => '93000000-0000-0000-0001-000000000052',
            default => '93000000-0000-0000-0009-'.substr(md5($name), 0, 12),
        };
    }

    private function connection(): \Doctrine\DBAL\Connection
    {
        return $this->entityManager->getConnection();
    }
}
