<?php

namespace App\Tests\Integration;

use App\Application\Deck\CardBoardWipeClassifier;
use App\Application\Deck\CardBoardWipeProfileRebuilder;
use App\Infrastructure\DeckAnalysis\CardBoardWipeProfileRebuildCommand;
use Doctrine\DBAL\ParameterType;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;

final class CardBoardWipeProfileRebuilderTest extends ApiTestCase
{
    public function testClassifiesRepresentativeBoardWipeProfiles(): void
    {
        $this->seedBoardWipeCards();

        $result = $this->rebuilder()->rebuild();

        self::assertSame(26, $result['seen']);
        self::assertSame(25, $result['wipes']);

        $this->assertProfile('Wrath of God', [
            'is_board_wipe' => true,
            'is_creature_wipe' => true,
            'board_wipe_type' => 'hard_creature_wipe',
            'symmetry_profile' => 'symmetrical',
            'answers_indestructible' => false,
        ], ['destroy'], ['creatures']);
        foreach (['Damnation', 'Supreme Verdict'] as $hardCreatureWipe) {
            $this->assertProfile($hardCreatureWipe, [
                'is_board_wipe' => true,
                'is_creature_wipe' => true,
                'board_wipe_type' => 'hard_creature_wipe',
                'symmetry_profile' => 'symmetrical',
                'answers_indestructible' => false,
            ], ['destroy'], ['creatures']);
        }

        $this->assertProfile('Cyclonic Rift', [
            'is_board_wipe' => true,
            'is_spot_removal_with_mass_mode' => true,
            'board_wipe_type' => 'bounce_wipe',
            'symmetry_profile' => 'one_sided',
            'alternative_cost_type' => 'overload',
            'base_mode_type' => 'bounce',
            'mass_mode_type' => 'mass_bounce',
        ], ['bounce'], ['nonland_permanents', 'opponents_only']);

        $this->assertProfile('Vandalblast', [
            'is_board_wipe' => true,
            'is_creature_wipe' => false,
            'is_noncreature_wipe' => true,
            'board_wipe_type' => 'artifact_wipe',
            'alternative_cost_type' => 'overload',
            'mass_mode_type' => 'artifact_wipe',
        ], ['destroy'], ['artifacts', 'opponents_only']);

        $this->assertProfile('Toxic Deluge', [
            'is_board_wipe' => true,
            'is_scalable' => true,
            'board_wipe_type' => 'minus_x_minus_x_wipe',
            'answers_indestructible' => true,
        ], ['minus_x_minus_x'], ['creatures']);

        $this->assertProfile('Blasphemous Act', [
            'is_board_wipe' => true,
            'has_cost_reduction' => true,
            'board_wipe_type' => 'damage_wipe',
            'answers_indestructible' => false,
        ], ['damage'], ['creatures']);

        $this->assertProfile('All Is Dust', [
            'is_board_wipe' => true,
            'board_wipe_type' => 'sacrifice_wipe',
            'answers_indestructible' => true,
            'gets_around_hexproof_shroud' => true,
        ], ['sacrifice'], ['colored_permanents', 'all_players']);

        $this->assertProfile('Aetherize', [
            'is_board_wipe' => true,
            'is_pseudo_wipe' => true,
            'board_wipe_type' => 'combat_only_wipe',
        ], ['bounce'], ['attacking_creatures']);
        $this->assertProfile('Aetherspouts', [
            'is_board_wipe' => true,
            'is_pseudo_wipe' => true,
            'board_wipe_type' => 'combat_only_wipe',
            'answers_indestructible' => true,
        ], ['tuck'], ['attacking_creatures']);
        $this->assertProfile('Settle the Wreckage', [
            'is_board_wipe' => true,
            'is_pseudo_wipe' => true,
            'board_wipe_type' => 'combat_only_wipe',
            'opponent_compensation' => 'ramps_opponents',
        ], ['exile'], ['attacking_creatures']);

        $this->assertProfile('Oblivion Stone', [
            'is_board_wipe' => true,
            'is_permanent_activated' => true,
            'is_delayed' => true,
            'board_wipe_type' => 'repeatable_wipe',
        ], ['destroy'], ['nonland_permanents']);
        foreach (['Nevinyrral\'s Disk', 'Pernicious Deed'] as $permanentWipe) {
            $this->assertProfile($permanentWipe, [
                'is_board_wipe' => true,
                'is_permanent_activated' => true,
            ], ['destroy'], ['creatures']);
        }

        foreach (['Farewell', 'Austere Command', 'Merciless Eviction', 'Cleansing Nova'] as $modalWipe) {
            $this->assertProfile($modalWipe, [
                'is_board_wipe' => true,
                'has_modes' => true,
                'board_wipe_type' => 'modal_wipe',
            ], [], []);
        }

        $this->assertProfile('Ruinous Ultimatum', [
            'is_board_wipe' => true,
            'is_permanent_wipe' => true,
            'symmetry_profile' => 'opponents_only',
            'leaves_own_board' => true,
            'board_wipe_type' => 'nonland_permanent_wipe',
        ], ['destroy'], ['nonland_permanents', 'opponents_only']);
        $this->assertProfile('In Garruk\'s Wake', [
            'is_board_wipe' => true,
            'symmetry_profile' => 'one_sided',
            'leaves_own_board' => true,
        ], ['destroy'], ['creatures', 'planeswalkers']);
        $this->assertProfile('Kindred Dominance', [
            'is_board_wipe' => true,
            'board_wipe_type' => 'conditional_wipe',
            'symmetry_profile' => 'creature_type_asymmetry',
            'can_be_built_around' => true,
        ], ['destroy'], ['creatures', 'chosen_creature_type']);
        $this->assertProfile('Bane of Progress', [
            'is_board_wipe' => true,
            'is_creature_wipe' => false,
            'is_noncreature_wipe' => true,
            'board_wipe_type' => 'artifact_enchantment_wipe',
            'is_triggered_wipe' => true,
        ], ['destroy'], ['artifacts', 'enchantments']);

        $this->assertProfile('Heroic Intervention', [
            'is_board_wipe' => false,
            'board_wipe_type' => 'other',
        ], [], []);
    }

    public function testSemanticRebuildUsesBoardWipeProfileWithoutCountingArtifactOnlyWipesAsHardWipes(): void
    {
        $this->seedBoardWipeCards();
        $connection = $this->entityManager->getConnection();

        $this->rebuilder()->rebuild();
        (new \App\Application\Deck\CardSemanticDataRebuilder($connection))->rebuild();

        self::assertTrue($this->hasRole('Wrath of God', 'board_wipe'));
        self::assertFalse($this->hasRole('Vandalblast', 'board_wipe'));
        self::assertTrue($this->hasRole('Vandalblast', 'artifact_wipe'));
        self::assertTrue($this->hasRole('Cyclonic Rift', 'mass_bounce'));
        self::assertTrue($this->hasRole('Cyclonic Rift', 'overloaded_wipe'));
        self::assertTrue($this->hasSubrole('Aetherize', 'pseudo_wipe'));
        self::assertTrue($this->hasRole('Toxic Deluge', 'answers_indestructible'));
    }

    public function testCommandCreatesProfilesIsIdempotentUpdatesVersionAndDoesNotRegisterExternalSyncs(): void
    {
        $this->seedBoardWipeCards();
        $connection = $this->entityManager->getConnection();
        $command = new CardBoardWipeProfileRebuildCommand($this->rebuilder());
        $tester = new CommandTester($command);

        self::assertSame('app:deck-analysis:board-wipe-profile:rebuild', $command->getName());
        self::assertContains('app:deck-analysis:card-board-wipe-profile:rebuild', $command->getAliases());

        $firstStatus = $tester->execute([]);
        $firstOutput = $tester->getDisplay();

        self::assertSame(Command::SUCCESS, $firstStatus);
        self::assertStringContainsString('totalProcessed=26', $firstOutput);
        self::assertStringContainsString('inserted=26', $firstOutput);
        self::assertStringContainsString('updated=0', $firstOutput);
        self::assertStringContainsString('boardWipes=25', $firstOutput);
        self::assertStringContainsString('creatureWipes=', $firstOutput);
        self::assertStringContainsString('artifactWipes=', $firstOutput);
        self::assertStringContainsString('enchantmentWipes=', $firstOutput);
        self::assertStringContainsString('graveyardWipes=', $firstOutput);
        self::assertStringContainsString('modalWipes=', $firstOutput);
        self::assertStringContainsString('asymmetricalWipes=', $firstOutput);
        self::assertStringContainsString('overloadedMassModes=', $firstOutput);
        self::assertStringContainsString('pseudoWipes=', $firstOutput);
        self::assertStringContainsString('conditionalWipes=', $firstOutput);
        self::assertStringContainsString('answersIndestructible=', $firstOutput);
        self::assertStringContainsString('unknownNeedsReview=0', $firstOutput);

        self::assertSame(26, (int) $connection->fetchOne('SELECT COUNT(*) FROM card_board_wipe_profile'));
        self::assertSame(0, (int) $connection->fetchOne('SELECT COUNT(*) FROM external_sync_run'));
        $firstVersion = (string) $connection->fetchOne("SELECT version FROM deck_analysis_data_version WHERE key = 'board_wipe'");
        self::assertStringStartsWith('sha256:', $firstVersion);
        $firstUpdatedAt = (string) $connection->fetchOne("SELECT updated_at FROM card_board_wipe_profile WHERE name = 'Wrath of God'");

        $secondTester = new CommandTester($command);
        $secondStatus = $secondTester->execute([]);
        $secondOutput = $secondTester->getDisplay();

        self::assertSame(Command::SUCCESS, $secondStatus);
        self::assertStringContainsString('inserted=0', $secondOutput);
        self::assertStringContainsString('updated=0', $secondOutput);
        self::assertStringContainsString('skipped=26', $secondOutput);
        self::assertSame(26, (int) $connection->fetchOne('SELECT COUNT(*) FROM card_board_wipe_profile'));
        self::assertSame(0, (int) $connection->fetchOne('SELECT COUNT(*) FROM external_sync_run'));
        self::assertSame(
            $firstVersion,
            (string) $connection->fetchOne("SELECT version FROM deck_analysis_data_version WHERE key = 'board_wipe'"),
        );
        self::assertSame(
            $firstUpdatedAt,
            (string) $connection->fetchOne("SELECT updated_at FROM card_board_wipe_profile WHERE name = 'Wrath of God'"),
        );
    }

    private function rebuilder(): CardBoardWipeProfileRebuilder
    {
        return new CardBoardWipeProfileRebuilder($this->entityManager->getConnection(), new CardBoardWipeClassifier());
    }

    /**
     * @param array<string,mixed> $expected
     * @param list<string> $methods
     * @param list<string> $scopes
     */
    private function assertProfile(string $name, array $expected, array $methods, array $scopes): void
    {
        $profile = $this->profile($name);
        foreach ($expected as $field => $value) {
            self::assertSame($value, $this->normalizeDbValue($profile[$field] ?? null), $name.' '.$field);
        }

        $actualMethods = json_decode((string) $profile['wipe_method'], true, flags: JSON_THROW_ON_ERROR);
        $actualScopes = json_decode((string) $profile['wipe_scope'], true, flags: JSON_THROW_ON_ERROR);
        foreach ($methods as $method) {
            self::assertContains($method, $actualMethods, $name.' method '.$method);
        }
        foreach ($scopes as $scope) {
            self::assertContains($scope, $actualScopes, $name.' scope '.$scope);
        }
    }

    /**
     * @return array<string,mixed>
     */
    private function profile(string $name): array
    {
        $profile = $this->entityManager->getConnection()->fetchAssociative(
            'SELECT * FROM card_board_wipe_profile WHERE name = :name',
            ['name' => $name],
        );
        self::assertIsArray($profile, $name);

        return $profile;
    }

    private function normalizeDbValue(mixed $value): mixed
    {
        if (is_bool($value)) {
            return $value;
        }
        if ($value === 't') {
            return true;
        }
        if ($value === 'f') {
            return false;
        }

        return $value;
    }

    private function hasRole(string $name, string $role): bool
    {
        return (bool) $this->entityManager->getConnection()->fetchOne(
            <<<'SQL'
SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM card_role
    INNER JOIN card_oracle_profile ON card_oracle_profile.oracle_id = card_role.oracle_id
    WHERE card_oracle_profile.name = :name AND card_role.role = :role AND card_role.active = true
) THEN 1 ELSE 0 END
SQL,
            ['name' => $name, 'role' => $role],
        );
    }

    private function hasSubrole(string $name, string $subrole): bool
    {
        return (bool) $this->entityManager->getConnection()->fetchOne(
            <<<'SQL'
SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM card_role
    INNER JOIN card_oracle_profile ON card_oracle_profile.oracle_id = card_role.oracle_id
    WHERE card_oracle_profile.name = :name AND card_role.subrole = :subrole AND card_role.active = true
) THEN 1 ELSE 0 END
SQL,
            ['name' => $name, 'subrole' => $subrole],
        );
    }

    private function seedBoardWipeCards(): void
    {
        $this->insertOracleCard('91000000-0000-0000-0000-000000000001', 'Wrath of God', [
            'oracle_id' => '91000000-0000-0000-0001-000000000001',
            'mana_cost' => '{2}{W}{W}',
            'cmc' => 4,
            'type_line' => 'Sorcery',
            'oracle_text' => "Destroy all creatures. They can't be regenerated.",
            'colors' => ['W'],
            'color_identity' => ['W'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000002', 'Cyclonic Rift', [
            'oracle_id' => '91000000-0000-0000-0001-000000000002',
            'mana_cost' => '{1}{U}',
            'cmc' => 2,
            'type_line' => 'Instant',
            'oracle_text' => 'Return target nonland permanent you don\'t control to its owner\'s hand. Overload {6}{U} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")',
            'colors' => ['U'],
            'color_identity' => ['U'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000003', 'Vandalblast', [
            'oracle_id' => '91000000-0000-0000-0001-000000000003',
            'mana_cost' => '{R}',
            'cmc' => 1,
            'type_line' => 'Sorcery',
            'oracle_text' => 'Destroy target artifact you don\'t control. Overload {4}{R} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")',
            'colors' => ['R'],
            'color_identity' => ['R'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000004', 'Toxic Deluge', [
            'oracle_id' => '91000000-0000-0000-0001-000000000004',
            'mana_cost' => '{2}{B}',
            'cmc' => 3,
            'type_line' => 'Sorcery',
            'oracle_text' => 'As an additional cost to cast this spell, pay X life. All creatures get -X/-X until end of turn.',
            'colors' => ['B'],
            'color_identity' => ['B'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000005', 'All Is Dust', [
            'oracle_id' => '91000000-0000-0000-0001-000000000005',
            'mana_cost' => '{7}',
            'cmc' => 7,
            'type_line' => 'Kindred Sorcery - Eldrazi',
            'oracle_text' => 'Each player sacrifices all permanents they control that are one or more colors.',
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000006', 'Aetherize', [
            'oracle_id' => '91000000-0000-0000-0001-000000000006',
            'mana_cost' => '{3}{U}',
            'cmc' => 4,
            'type_line' => 'Instant',
            'oracle_text' => "Return all attacking creatures to their owner's hand.",
            'colors' => ['U'],
            'color_identity' => ['U'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000007', 'Oblivion Stone', [
            'oracle_id' => '91000000-0000-0000-0001-000000000007',
            'mana_cost' => '{3}',
            'cmc' => 3,
            'type_line' => 'Artifact',
            'oracle_text' => '{4}, {T}: Put a fate counter on target permanent. {5}, {T}, Sacrifice this artifact: Destroy each nonland permanent without a fate counter on it, then remove all fate counters from all permanents.',
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000008', 'Heroic Intervention', [
            'oracle_id' => '91000000-0000-0000-0001-000000000008',
            'mana_cost' => '{1}{G}',
            'cmc' => 2,
            'type_line' => 'Instant',
            'oracle_text' => 'Permanents you control gain hexproof and indestructible until end of turn.',
            'colors' => ['G'],
            'color_identity' => ['G'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000009', 'Winds of Abandon', [
            'oracle_id' => '91000000-0000-0000-0001-000000000009',
            'mana_cost' => '{1}{W}',
            'cmc' => 2,
            'type_line' => 'Sorcery',
            'oracle_text' => 'Exile target creature you don\'t control. For each creature exiled this way, its controller searches their library for a basic land card. Those players put those cards onto the battlefield tapped, then shuffle. Overload {4}{W}{W} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")',
            'colors' => ['W'],
            'color_identity' => ['W'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000010', 'Mizzium Mortars', [
            'oracle_id' => '91000000-0000-0000-0001-000000000010',
            'mana_cost' => '{1}{R}',
            'cmc' => 2,
            'type_line' => 'Sorcery',
            'oracle_text' => 'Mizzium Mortars deals 4 damage to target creature you don\'t control. Overload {3}{R}{R}{R} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")',
            'colors' => ['R'],
            'color_identity' => ['R'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000011', 'Farewell', [
            'oracle_id' => '91000000-0000-0000-0001-000000000011',
            'mana_cost' => '{4}{W}{W}',
            'cmc' => 6,
            'type_line' => 'Sorcery',
            'oracle_text' => 'Choose one or more - Exile all artifacts. Exile all creatures. Exile all enchantments. Exile all graveyards.',
            'colors' => ['W'],
            'color_identity' => ['W'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000012', 'Living Death', [
            'oracle_id' => '91000000-0000-0000-0001-000000000012',
            'mana_cost' => '{3}{B}{B}',
            'cmc' => 5,
            'type_line' => 'Sorcery',
            'oracle_text' => 'Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then returns all cards they exiled this way to the battlefield.',
            'colors' => ['B'],
            'color_identity' => ['B'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000013', 'Damnation', [
            'oracle_id' => '91000000-0000-0000-0001-000000000013',
            'mana_cost' => '{2}{B}{B}',
            'cmc' => 4,
            'type_line' => 'Sorcery',
            'oracle_text' => "Destroy all creatures. They can't be regenerated.",
            'colors' => ['B'],
            'color_identity' => ['B'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000014', 'Supreme Verdict', [
            'oracle_id' => '91000000-0000-0000-0001-000000000014',
            'mana_cost' => '{1}{W}{W}{U}',
            'cmc' => 4,
            'type_line' => 'Sorcery',
            'oracle_text' => "This spell can't be countered. Destroy all creatures.",
            'colors' => ['W', 'U'],
            'color_identity' => ['W', 'U'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000015', 'Blasphemous Act', [
            'oracle_id' => '91000000-0000-0000-0001-000000000015',
            'mana_cost' => '{8}{R}',
            'cmc' => 9,
            'type_line' => 'Sorcery',
            'oracle_text' => 'This spell costs {1} less to cast for each creature on the battlefield. Blasphemous Act deals 13 damage to each creature.',
            'colors' => ['R'],
            'color_identity' => ['R'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000016', 'Aetherspouts', [
            'oracle_id' => '91000000-0000-0000-0001-000000000016',
            'mana_cost' => '{3}{U}{U}',
            'cmc' => 5,
            'type_line' => 'Instant',
            'oracle_text' => 'For each attacking creature, its owner puts it on the top or bottom of their library.',
            'colors' => ['U'],
            'color_identity' => ['U'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000017', 'Settle the Wreckage', [
            'oracle_id' => '91000000-0000-0000-0001-000000000017',
            'mana_cost' => '{2}{W}{W}',
            'cmc' => 4,
            'type_line' => 'Instant',
            'oracle_text' => 'Exile all attacking creatures target player controls. That player may search their library for that many basic land cards, put those cards onto the battlefield tapped, then shuffle.',
            'colors' => ['W'],
            'color_identity' => ['W'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000018', 'Nevinyrral\'s Disk', [
            'oracle_id' => '91000000-0000-0000-0001-000000000018',
            'mana_cost' => '{4}',
            'cmc' => 4,
            'type_line' => 'Artifact',
            'oracle_text' => 'Nevinyrral\'s Disk enters the battlefield tapped. {1}, {T}: Destroy all artifacts, creatures, and enchantments.',
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000019', 'Pernicious Deed', [
            'oracle_id' => '91000000-0000-0000-0001-000000000019',
            'mana_cost' => '{1}{B}{G}',
            'cmc' => 3,
            'type_line' => 'Enchantment',
            'oracle_text' => '{X}, Sacrifice this enchantment: Destroy each artifact, creature, and enchantment with mana value X or less.',
            'colors' => ['B', 'G'],
            'color_identity' => ['B', 'G'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000020', 'Austere Command', [
            'oracle_id' => '91000000-0000-0000-0001-000000000020',
            'mana_cost' => '{4}{W}{W}',
            'cmc' => 6,
            'type_line' => 'Sorcery',
            'oracle_text' => 'Choose two - Destroy all artifacts; destroy all enchantments; destroy all creatures with mana value 3 or less; destroy all creatures with mana value 4 or greater.',
            'colors' => ['W'],
            'color_identity' => ['W'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000021', 'Merciless Eviction', [
            'oracle_id' => '91000000-0000-0000-0001-000000000021',
            'mana_cost' => '{4}{W}{B}',
            'cmc' => 6,
            'type_line' => 'Sorcery',
            'oracle_text' => 'Choose one - Exile all artifacts; exile all creatures; exile all enchantments; exile all planeswalkers.',
            'colors' => ['W', 'B'],
            'color_identity' => ['W', 'B'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000022', 'Cleansing Nova', [
            'oracle_id' => '91000000-0000-0000-0001-000000000022',
            'mana_cost' => '{3}{W}{W}',
            'cmc' => 5,
            'type_line' => 'Sorcery',
            'oracle_text' => 'Choose one - Destroy all creatures; or destroy all artifacts and enchantments.',
            'colors' => ['W'],
            'color_identity' => ['W'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000023', 'Ruinous Ultimatum', [
            'oracle_id' => '91000000-0000-0000-0001-000000000023',
            'mana_cost' => '{R}{R}{W}{W}{W}{B}{B}',
            'cmc' => 7,
            'type_line' => 'Sorcery',
            'oracle_text' => 'Destroy all nonland permanents your opponents control.',
            'colors' => ['R', 'W', 'B'],
            'color_identity' => ['R', 'W', 'B'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000024', 'In Garruk\'s Wake', [
            'oracle_id' => '91000000-0000-0000-0001-000000000024',
            'mana_cost' => '{7}{B}{B}',
            'cmc' => 9,
            'type_line' => 'Sorcery',
            'oracle_text' => 'Destroy all creatures you don\'t control and all planeswalkers you don\'t control.',
            'colors' => ['B'],
            'color_identity' => ['B'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000025', 'Kindred Dominance', [
            'oracle_id' => '91000000-0000-0000-0001-000000000025',
            'mana_cost' => '{5}{B}{B}',
            'cmc' => 7,
            'type_line' => 'Kindred Sorcery',
            'oracle_text' => 'Choose a creature type. Destroy all creatures that aren\'t of the chosen type.',
            'colors' => ['B'],
            'color_identity' => ['B'],
        ]);
        $this->insertOracleCard('91000000-0000-0000-0000-000000000026', 'Bane of Progress', [
            'oracle_id' => '91000000-0000-0000-0001-000000000026',
            'mana_cost' => '{4}{G}{G}',
            'cmc' => 6,
            'type_line' => 'Creature - Elemental',
            'oracle_text' => 'When Bane of Progress enters the battlefield, destroy all artifacts and enchantments. Put a +1/+1 counter on Bane of Progress for each permanent destroyed this way.',
            'colors' => ['G'],
            'color_identity' => ['G'],
        ]);
    }

    /**
     * @param array<string,mixed> $overrides
     */
    private function insertOracleCard(string $scryfallId, string $name, array $overrides): void
    {
        $oracleId = (string) ($overrides['oracle_id'] ?? $scryfallId);
        $profile = array_replace([
            'oracle_id' => $oracleId,
            'default_scryfall_id' => $scryfallId,
            'name' => $name,
            'normalized_name' => mb_strtolower($name),
            'mana_cost' => null,
            'mana_value' => $overrides['cmc'] ?? null,
            'type_line' => 'Artifact',
            'oracle_text' => '',
            'colors' => [],
            'color_identity' => [],
            'produced_mana' => [],
            'keywords' => [],
            'layout' => 'normal',
            'card_faces' => [],
            'power' => null,
            'toughness' => null,
            'loyalty' => null,
            'defense' => null,
            'commander_legal' => true,
            'commander_banned' => false,
            'can_be_commander' => false,
            'is_land' => false,
            'is_creature' => str_contains(mb_strtolower((string) ($overrides['type_line'] ?? '')), 'creature'),
            'is_artifact' => str_contains(mb_strtolower((string) ($overrides['type_line'] ?? '')), 'artifact'),
            'is_enchantment' => str_contains(mb_strtolower((string) ($overrides['type_line'] ?? '')), 'enchantment'),
            'is_instant' => str_contains(mb_strtolower((string) ($overrides['type_line'] ?? '')), 'instant'),
            'is_sorcery' => str_contains(mb_strtolower((string) ($overrides['type_line'] ?? '')), 'sorcery'),
            'is_planeswalker' => str_contains(mb_strtolower((string) ($overrides['type_line'] ?? '')), 'planeswalker'),
            'is_battle' => str_contains(mb_strtolower((string) ($overrides['type_line'] ?? '')), 'battle'),
            'is_legendary' => str_contains(mb_strtolower((string) ($overrides['type_line'] ?? '')), 'legendary'),
            'edhrec_rank' => null,
            'is_game_changer' => false,
            'data_hash' => hash('sha256', $oracleId.$name),
        ], $overrides);
        unset($profile['cmc']);

        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_oracle_profile (
    oracle_id,
    default_scryfall_id,
    name,
    normalized_name,
    mana_cost,
    mana_value,
    type_line,
    oracle_text,
    colors,
    color_identity,
    produced_mana,
    keywords,
    layout,
    card_faces,
    power,
    toughness,
    loyalty,
    defense,
    commander_legal,
    commander_banned,
    can_be_commander,
    is_land,
    is_creature,
    is_artifact,
    is_enchantment,
    is_instant,
    is_sorcery,
    is_planeswalker,
    is_battle,
    is_legendary,
    edhrec_rank,
    is_game_changer,
    data_hash,
    updated_at
) VALUES (
    :oracle_id,
    :default_scryfall_id,
    :name,
    :normalized_name,
    :mana_cost,
    :mana_value,
    :type_line,
    :oracle_text,
    :colors::jsonb,
    :color_identity::jsonb,
    :produced_mana::jsonb,
    :keywords::jsonb,
    :layout,
    :card_faces::jsonb,
    :power,
    :toughness,
    :loyalty,
    :defense,
    :commander_legal,
    :commander_banned,
    :can_be_commander,
    :is_land,
    :is_creature,
    :is_artifact,
    :is_enchantment,
    :is_instant,
    :is_sorcery,
    :is_planeswalker,
    :is_battle,
    :is_legendary,
    :edhrec_rank,
    :is_game_changer,
    :data_hash,
    NOW()
)
SQL,
            [
                ...$profile,
                'colors' => json_encode($profile['colors'], JSON_THROW_ON_ERROR),
                'color_identity' => json_encode($profile['color_identity'], JSON_THROW_ON_ERROR),
                'produced_mana' => json_encode($profile['produced_mana'], JSON_THROW_ON_ERROR),
                'keywords' => json_encode($profile['keywords'], JSON_THROW_ON_ERROR),
                'card_faces' => json_encode($profile['card_faces'], JSON_THROW_ON_ERROR),
            ],
            [
                'commander_legal' => ParameterType::BOOLEAN,
                'commander_banned' => ParameterType::BOOLEAN,
                'can_be_commander' => ParameterType::BOOLEAN,
                'is_land' => ParameterType::BOOLEAN,
                'is_creature' => ParameterType::BOOLEAN,
                'is_artifact' => ParameterType::BOOLEAN,
                'is_enchantment' => ParameterType::BOOLEAN,
                'is_instant' => ParameterType::BOOLEAN,
                'is_sorcery' => ParameterType::BOOLEAN,
                'is_planeswalker' => ParameterType::BOOLEAN,
                'is_battle' => ParameterType::BOOLEAN,
                'is_legendary' => ParameterType::BOOLEAN,
                'is_game_changer' => ParameterType::BOOLEAN,
            ],
        );
    }
}
