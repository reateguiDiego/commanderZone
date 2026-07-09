<?php

namespace App\Tests\Integration;

use App\Application\Deck\CardManaProfileRebuilder;
use App\Infrastructure\DeckAnalysis\CardManaProfileRebuildCommand;
use Doctrine\DBAL\ParameterType;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;

final class CardManaProfileRebuilderTest extends ApiTestCase
{
    public function testClassifiesRepresentativeLandCyclesConservatively(): void
    {
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000001', 'Island', [
            'type_line' => 'Basic Land — Island',
            'produced_mana' => ['U'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000002', 'Hallowed Fountain', [
            'type_line' => 'Land — Plains Island',
            'oracle_text' => 'As Hallowed Fountain enters the battlefield, you may pay 2 life. If you don\'t, it enters the battlefield tapped.',
            'produced_mana' => ['W', 'U'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000003', 'Raugrin Triome', [
            'type_line' => 'Land — Island Mountain Plains',
            'oracle_text' => 'Raugrin Triome enters the battlefield tapped. Cycling {3}.',
            'produced_mana' => ['U', 'R', 'W'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000004', 'Meticulous Archive', [
            'type_line' => 'Land — Plains Island',
            'oracle_text' => 'Meticulous Archive enters the battlefield tapped. When it enters, surveil 1.',
            'produced_mana' => ['W', 'U'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000005', 'Seachrome Coast', [
            'type_line' => 'Land',
            'oracle_text' => 'Seachrome Coast enters the battlefield tapped unless you control two or fewer other lands.',
            'produced_mana' => ['W', 'U'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000006', 'Deserted Beach', [
            'type_line' => 'Land',
            'oracle_text' => 'Deserted Beach enters the battlefield tapped unless you control two or more other lands.',
            'produced_mana' => ['W', 'U'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000007', 'Adarkar Wastes', [
            'type_line' => 'Land',
            'oracle_text' => '{T}: Add {C}. {T}: Add {W} or {U}. Adarkar Wastes deals 1 damage to you.',
            'produced_mana' => ['C', 'W', 'U'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000008', 'Glacial Fortress', [
            'type_line' => 'Land',
            'oracle_text' => 'Glacial Fortress enters the battlefield tapped unless you control a Plains or an Island.',
            'produced_mana' => ['W', 'U'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000009', 'Mystic Gate', [
            'type_line' => 'Land',
            'oracle_text' => '{T}: Add {C}. {W/U}, {T}: Add {W}{W}, {W}{U}, or {U}{U}.',
            'produced_mana' => ['C', 'W', 'U'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000010', 'Hengegate Pathway // Mistgate Pathway', [
            'type_line' => 'Land // Land',
            'produced_mana' => ['W', 'U'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000011', 'Prairie Stream', [
            'type_line' => 'Land — Plains Island',
            'oracle_text' => 'Prairie Stream enters the battlefield tapped unless you control two or more basic lands.',
            'produced_mana' => ['W', 'U'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000012', 'Sea of Clouds', [
            'type_line' => 'Land',
            'oracle_text' => 'Sea of Clouds enters the battlefield tapped unless you have two or more opponents.',
            'produced_mana' => ['W', 'U'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000013', 'Azorius Chancery', [
            'type_line' => 'Land',
            'oracle_text' => 'Azorius Chancery enters the battlefield tapped. When it enters, return a land you control to its owner\'s hand. {T}: Add {W}{U}.',
            'produced_mana' => ['W', 'U'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000014', 'Temple of Enlightenment', [
            'type_line' => 'Land',
            'oracle_text' => 'Temple of Enlightenment enters the battlefield tapped. When it enters, scry 1.',
            'produced_mana' => ['W', 'U'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000015', 'Tranquil Cove', [
            'type_line' => 'Land',
            'oracle_text' => 'Tranquil Cove enters the battlefield tapped. When it enters, you gain 1 life.',
            'produced_mana' => ['W', 'U'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000016', 'Bala Ged Recovery // Bala Ged Sanctuary', [
            'type_line' => 'Sorcery // Land',
            'oracle_text' => 'Return target card from your graveyard to your hand. Bala Ged Sanctuary enters the battlefield tapped.',
            'produced_mana' => ['G'],
            'is_land' => true,
            'is_sorcery' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000017', 'Bojuka Bog', [
            'type_line' => 'Land',
            'oracle_text' => 'Bojuka Bog enters the battlefield tapped. When it enters, exile target player\'s graveyard.',
            'produced_mana' => ['B'],
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000018', 'Strip Mine', [
            'type_line' => 'Land',
            'oracle_text' => '{T}: Add {C}. {T}, Sacrifice Strip Mine: Destroy target land.',
            'produced_mana' => ['C'],
            'is_land' => true,
            'is_artifact' => false,
        ]);

        $this->rebuilder()->rebuild();

        self::assertProfile('Island', ['land_cycle_type' => 'basic', 'land_speed_profile' => 'always_untapped', 'land_fixing_profile' => 'mono_color']);
        self::assertProfile('Hallowed Fountain', ['land_cycle_type' => 'shockland', 'land_speed_profile' => 'untapped_with_life_payment']);
        self::assertProfile('Raugrin Triome', ['land_cycle_type' => 'triome', 'land_fixing_profile' => 'tri_color']);
        self::assertProfile('Meticulous Archive', ['land_cycle_type' => 'surveil_land']);
        self::assertProfile('Seachrome Coast', ['land_cycle_type' => 'fastland', 'land_speed_profile' => 'untapped_early']);
        self::assertProfile('Deserted Beach', ['land_cycle_type' => 'slowland', 'land_speed_profile' => 'untapped_late']);
        self::assertProfile('Adarkar Wastes', ['land_cycle_type' => 'painland']);
        self::assertProfile('Glacial Fortress', ['land_cycle_type' => 'checkland', 'untapped_condition_type' => 'requires_basic_types']);
        self::assertProfile('Mystic Gate', ['land_cycle_type' => 'filterland', 'requires_input_mana' => true]);
        self::assertProfile('Hengegate Pathway // Mistgate Pathway', ['land_cycle_type' => 'pathway', 'land_fixing_profile' => 'modal_choice']);
        self::assertProfile('Prairie Stream', ['land_cycle_type' => 'battle_land']);
        self::assertProfile('Sea of Clouds', ['land_cycle_type' => 'bond_land']);
        self::assertProfile('Azorius Chancery', ['land_cycle_type' => 'bounce_land']);
        self::assertProfile('Temple of Enlightenment', ['land_cycle_type' => 'temple']);
        self::assertProfile('Tranquil Cove', ['land_cycle_type' => 'gain_land']);
        self::assertProfile('Bala Ged Recovery // Bala Ged Sanctuary', ['land_cycle_type' => 'mdfc_land']);
        self::assertProfile('Bojuka Bog', ['mana_source_category' => 'utility_land', 'land_cycle_type' => 'utility_land']);
        self::assertProfile('Strip Mine', ['land_cycle_type' => 'colorless_utility_land', 'mana_source_category' => 'colorless_utility_land']);
        self::assertContains('cycling_upside', $this->jsonColumn('Raugrin Triome', 'land_synergy_profile'));
        self::assertContains('requires_existing_source', $this->jsonColumn('Mystic Gate', 'land_risk_profile'));
    }

    public function testClassifiesFetchRampTutorsRitualsReducersRocksAndDorks(): void
    {
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000101', 'Polluted Delta', [
            'type_line' => 'Land',
            'oracle_text' => '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.',
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000102', 'Wood Elves', [
            'type_line' => 'Creature — Elf Scout',
            'oracle_text' => 'When Wood Elves enters the battlefield, search your library for a Forest card, put that card onto the battlefield, then shuffle.',
            'is_creature' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000103', 'Sylvan Scrying', [
            'type_line' => 'Sorcery',
            'oracle_text' => 'Search your library for a land card, reveal it, put it into your hand, then shuffle.',
            'is_sorcery' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000104', 'Sol Ring', [
            'type_line' => 'Artifact',
            'oracle_text' => '{T}: Add {C}{C}.',
            'produced_mana' => ['C'],
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000105', 'Llanowar Elves', [
            'type_line' => 'Creature — Elf Druid',
            'oracle_text' => '{T}: Add {G}.',
            'produced_mana' => ['G'],
            'is_creature' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000106', 'Dark Ritual', [
            'type_line' => 'Instant',
            'oracle_text' => 'Add {B}{B}{B}.',
            'produced_mana' => ['B'],
            'is_instant' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000107', 'Goblin Electromancer', [
            'type_line' => 'Creature — Goblin Wizard',
            'oracle_text' => 'Instant and sorcery spells you cast cost {1} less to cast.',
            'is_creature' => true,
            'is_artifact' => false,
        ]);

        $this->rebuilder()->rebuild();

        self::assertProfile('Polluted Delta', [
            'mana_source_category' => 'fetchland',
            'land_cycle_type' => 'fetchland',
            'is_fetchland' => true,
            'is_fetchland_fixing' => true,
            'fetch_life_payment' => true,
            'fetch_enters_untapped_itself' => false,
        ]);
        self::assertProfile('Wood Elves', ['mana_source_category' => 'land_ramp', 'is_land_ramp' => true, 'is_land_search_to_battlefield' => true]);
        self::assertProfile('Sylvan Scrying', ['mana_source_category' => 'land_tutor', 'is_land_tutor' => true]);
        self::assertProfile('Sol Ring', ['mana_source_category' => 'mana_rock', 'is_mana_rock' => true, 'is_fast_mana' => true]);
        self::assertProfile('Llanowar Elves', ['mana_source_category' => 'mana_dork', 'is_mana_dork' => true]);
        self::assertProfile('Dark Ritual', ['mana_source_category' => 'ritual', 'is_ritual' => true, 'is_burst_mana' => true, 'is_permanent_ramp' => false]);
        self::assertProfile('Goblin Electromancer', ['mana_source_category' => 'cost_reducer', 'is_cost_reducer' => true, 'is_repeatable_mana' => false]);
        self::assertContains('no_mana_ability', $this->jsonColumn('Polluted Delta', 'land_risk_profile'));
        self::assertSame(['Island', 'Swamp'], $this->jsonColumn('Polluted Delta', 'fetchable_land_types'));
    }

    public function testKeepsManaClassificationsConservativeForLandsTreasureEnergyAndMdfcLandFaces(): void
    {
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000151', 'Sokenzan, Crucible of Defiance', [
            'type_line' => 'Legendary Land',
            'oracle_text' => 'Channel - {3}{R}, Discard Sokenzan, Crucible of Defiance: Create two 1/1 colorless Spirit creature tokens with haste. This ability costs {1} less to activate for each legendary creature you control. {T}: Add {R}.',
            'mana_value' => 0,
            'produced_mana' => ['R'],
            'is_land' => true,
            'is_legendary' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000152', 'Pitiless Plunderer', [
            'type_line' => 'Creature — Human Pirate',
            'oracle_text' => 'Whenever another creature you control dies, create a Treasure token.',
            'produced_mana' => ['B'],
            'is_creature' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000153', 'Guide of Souls', [
            'type_line' => 'Creature — Human Cleric',
            'oracle_text' => 'Whenever another creature enters the battlefield under your control, you get {E}. Whenever you attack, you may pay {E}{E}{E}.',
            'mana_value' => 1,
            'produced_mana' => ['W'],
            'is_creature' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000154', 'Agate Instigator', [
            'type_line' => 'Creature — Lizard Rogue',
            'oracle_text' => 'Offspring {1}{R}. Whenever another creature you control enters, Agate Instigator deals 1 damage to each opponent.',
            'produced_mana' => ['R'],
            'is_creature' => true,
            'is_artifact' => false,
        ]);
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000155', 'MDFC Creature Land', [
            'type_line' => 'Creature — Elf // Land',
            'oracle_text' => 'Vigilance. {T}: Add {G}.',
            'produced_mana' => ['G'],
            'is_land' => true,
            'is_creature' => true,
            'is_artifact' => false,
        ]);

        $this->rebuilder()->rebuild();

        self::assertProfile('Sokenzan, Crucible of Defiance', [
            'is_fast_mana' => false,
            'is_cost_reducer' => false,
            'is_mana_dork' => false,
        ]);
        self::assertProfile('Pitiless Plunderer', [
            'mana_source_category' => 'treasure_creator',
            'is_mana_dork' => false,
            'is_treasure_related' => true,
        ]);
        self::assertProfile('Guide of Souls', [
            'mana_source_category' => 'other',
            'is_fast_mana' => false,
            'is_mana_dork' => false,
        ]);
        self::assertProfile('Agate Instigator', [
            'mana_source_category' => 'other',
            'is_mana_dork' => false,
        ]);
        self::assertProfile('MDFC Creature Land', [
            'land_cycle_type' => 'mdfc_land',
            'is_mana_dork' => false,
            'is_fast_mana' => false,
        ]);
    }

    public function testRebuildIsIdempotentAndUpdatesManaDataVersion(): void
    {
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000201', 'Steam Vents', [
            'type_line' => 'Land â€” Island Mountain',
            'oracle_text' => 'As Steam Vents enters the battlefield, you may pay 2 life. If you don\'t, it enters the battlefield tapped.',
            'produced_mana' => ['U', 'R'],
            'is_land' => true,
            'is_artifact' => false,
        ]);

        $first = $this->rebuilder()->rebuild();
        $firstRows = (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_mana_profile');
        $firstVersion = (string) $this->entityManager->getConnection()->fetchOne(
            "SELECT version FROM deck_analysis_data_version WHERE key = 'mana'",
        );
        $second = $this->rebuilder()->rebuild();
        $secondRows = (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_mana_profile');
        $secondVersion = (string) $this->entityManager->getConnection()->fetchOne(
            "SELECT version FROM deck_analysis_data_version WHERE key = 'mana'",
        );

        self::assertSame(1, $first['inserted']);
        self::assertSame(0, $first['updated']);
        self::assertSame(0, $second['inserted']);
        self::assertSame(1, $second['updated']);
        self::assertSame($firstRows, $secondRows);
        self::assertSame($first['dataVersion'], $second['dataVersion']);
        self::assertSame($firstVersion, $secondVersion);
        self::assertStringStartsWith('sha256:', $firstVersion);
    }

    public function testAmbiguousManaTextIsMarkedForManualReview(): void
    {
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000202', 'Ambiguous Mana Card', [
            'type_line' => 'Enchantment',
            'oracle_text' => 'Whenever you add mana, scry 1.',
            'is_artifact' => false,
            'is_enchantment' => true,
        ]);

        $result = $this->rebuilder()->rebuild();

        self::assertSame(1, $result['unknownNeedsReview']);
        self::assertProfile('Ambiguous Mana Card', [
            'mana_source_category' => 'other',
            'classification_status' => 'unknown',
            'needs_manual_review' => true,
        ]);
    }

    public function testCommandCreatesProfilesReportsStatsAndDoesNotCreateExternalSyncRuns(): void
    {
        $this->insertOracleProfile('85000000-0000-0000-0000-000000000301', 'Bloodstained Mire', [
            'type_line' => 'Land',
            'oracle_text' => '{T}, Pay 1 life, Sacrifice Bloodstained Mire: Search your library for a Swamp or Mountain card, put it onto the battlefield, then shuffle.',
            'is_land' => true,
            'is_artifact' => false,
        ]);
        $tester = new CommandTester(new CardManaProfileRebuildCommand($this->rebuilder()));

        $status = $tester->execute([]);
        $display = $tester->getDisplay();

        self::assertSame(Command::SUCCESS, $status);
        self::assertStringContainsString('total processed: 1', $display);
        self::assertStringContainsString('inserted: 1', $display);
        self::assertStringContainsString('fetchlands: 1', $display);
        self::assertStringContainsString('unknown/needs_review: 0', $display);
        self::assertStringContainsString('data version: sha256:', $display);
        self::assertProfile('Bloodstained Mire', [
            'mana_source_category' => 'fetchland',
            'land_cycle_type' => 'fetchland',
            'is_fetchland' => true,
        ]);
        self::assertSame('0', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM external_sync_run'));
    }

    private function rebuilder(): CardManaProfileRebuilder
    {
        return new CardManaProfileRebuilder($this->entityManager->getConnection());
    }

    /**
     * @param array<string,mixed> $expected
     */
    private static function assertProfile(string $name, array $expected): void
    {
        $connection = self::getContainer()->get('doctrine')->getConnection();
        $row = $connection->fetchAssociative(
            'SELECT * FROM card_mana_profile WHERE name = :name',
            ['name' => $name],
        );
        self::assertIsArray($row, 'Missing mana profile for '.$name);

        foreach ($expected as $column => $value) {
            if (is_bool($value)) {
                self::assertSame($value, in_array((string) $row[$column], ['1', 't', 'true'], true), $name.' '.$column);
            } else {
                self::assertSame($value, $row[$column], $name.' '.$column);
            }
        }
    }

    /**
     * @return list<string>
     */
    private function jsonColumn(string $name, string $column): array
    {
        self::assertContains($column, ['land_risk_profile', 'land_synergy_profile', 'fetchable_land_types']);
        $value = $this->entityManager->getConnection()->fetchOne(
            sprintf('SELECT %s FROM card_mana_profile WHERE name = :name', $column),
            ['name' => $name],
        );
        self::assertIsString($value);
        $decoded = json_decode($value, true);

        return is_array($decoded) ? array_values(array_filter($decoded, is_string(...))) : [];
    }

    /**
     * @param array<string,mixed> $overrides
     */
    private function insertOracleProfile(string $oracleId, string $name, array $overrides = []): void
    {
        $profile = array_replace([
            'oracle_id' => $oracleId,
            'default_scryfall_id' => null,
            'name' => $name,
            'normalized_name' => mb_strtolower($name),
            'mana_cost' => null,
            'mana_value' => null,
            'type_line' => 'Artifact',
            'oracle_text' => '',
            'colors' => [],
            'color_identity' => [],
            'produced_mana' => [],
            'keywords' => [],
            'layout' => null,
            'card_faces' => [],
            'power' => null,
            'toughness' => null,
            'loyalty' => null,
            'defense' => null,
            'commander_legal' => true,
            'commander_banned' => false,
            'can_be_commander' => false,
            'is_land' => false,
            'is_creature' => false,
            'is_artifact' => true,
            'is_enchantment' => false,
            'is_instant' => false,
            'is_sorcery' => false,
            'is_planeswalker' => false,
            'is_battle' => false,
            'is_legendary' => false,
            'edhrec_rank' => null,
            'is_game_changer' => false,
            'data_hash' => hash('sha256', $oracleId.$name),
        ], $overrides);

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
    :colors,
    :color_identity,
    :produced_mana,
    :keywords,
    :layout,
    :card_faces,
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
