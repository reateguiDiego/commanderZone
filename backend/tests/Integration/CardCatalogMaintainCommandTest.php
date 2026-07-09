<?php

namespace App\Tests\Integration;

use App\Application\Card\ScryfallTagSyncService;
use App\Application\Card\ScryfallGameChangerSyncService;
use App\Application\Deck\CommanderSpellbookClient;
use App\Application\Deck\SpellbookSyncService;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;
use App\Infrastructure\DeckAnalysis\DeckAnalysisLocalDataRebuildCommand;
use App\Infrastructure\DeckAnalysis\ScryfallGameChangersSyncCommand;
use App\Infrastructure\DeckAnalysis\ScryfallTagsSyncCommand;
use App\Infrastructure\DeckAnalysis\SpellbookSyncCommand;
use App\Infrastructure\Scryfall\CardPrintBackfillCommand;
use App\Infrastructure\Scryfall\CardCatalogCommandRunner;
use App\Infrastructure\Scryfall\CardCatalogMaintainCommand;
use App\Infrastructure\Scryfall\CardCatalogResetService;
use App\Infrastructure\Scryfall\CardSearchEntryRebuildCommand;
use App\Infrastructure\Scryfall\CardSearchOptionsRebuildCommand;
use App\Infrastructure\Scryfall\ScryfallCardMetadataBackfillCommand;
use App\Infrastructure\Scryfall\ScryfallSyncCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

final class CardCatalogMaintainCommandTest extends ApiTestCase
{
    public function testCheckReportsMissingDerivedTablesWithoutWriting(): void
    {
        $connection = $this->entityManager->getConnection();
        $connection->executeStatement('DROP TABLE IF EXISTS card_search_entry');
        $connection->executeStatement('DROP TABLE IF EXISTS card_search_set_option');
        $connection->executeStatement('DROP TABLE IF EXISTS card_search_option');

        $tester = new CommandTester(static::getContainer()->get(CardCatalogMaintainCommand::class));
        $status = $tester->execute(['--mode' => 'check']);

        self::assertSame(Command::SUCCESS, $status);
        self::assertStringContainsString('Missing schema objects:', $tester->getDisplay());
        self::assertStringContainsString('table:card_search_option', $tester->getDisplay());
        self::assertStringContainsString('table:card_search_set_option', $tester->getDisplay());
        self::assertStringContainsString('table:card_search_entry', $tester->getDisplay());
        self::assertFalse($this->tableExists('card_search_option'));
        self::assertFalse($this->tableExists('card_search_set_option'));
        self::assertFalse($this->tableExists('card_search_entry'));
    }

    public function testRefreshExistingBackfillsCatalogMetadataAndDerivedTablesFromLocalFixture(): void
    {
        $this->seedCard('70000000-0000-0000-0000-000000000001', 'Sol Ring', [
            'set_name' => null,
            'rarity' => null,
            'image_status' => 'highres_scan',
        ]);
        $connection = $this->entityManager->getConnection();
        $connection->executeStatement('UPDATE card_print SET default_set_name = NULL');
        $connection->executeStatement('UPDATE card_print_locale SET set_name = NULL');
        $connection->executeStatement('TRUNCATE card_search_entry, card_search_option, card_search_set_option');
        $cardsFile = $this->writeTempJson([
            $this->scryfallCardData('70000000-0000-0000-0000-000000000001', 'Sol Ring', [
                'set_name' => 'Commander Legends',
                'rarity' => 'rare',
                'image_status' => 'highres_scan',
            ]),
        ]);

        try {
            $tester = new CommandTester(static::getContainer()->get(CardCatalogMaintainCommand::class));
            $status = $tester->execute([
                '--mode' => 'refresh-existing',
                '--apply' => true,
                '--cards-file' => $cardsFile,
                '--limit' => '1',
            ]);

            self::assertSame(Command::SUCCESS, $status);
            self::assertSame(
                'rare',
                (string) $connection->fetchOne('SELECT rarity FROM card WHERE scryfall_id = :id', ['id' => '70000000-0000-0000-0000-000000000001']),
            );
            self::assertSame(
                'Commander Legends',
                (string) $connection->fetchOne('SELECT set_name FROM card WHERE scryfall_id = :id', ['id' => '70000000-0000-0000-0000-000000000001']),
            );
            self::assertSame('Commander Legends', (string) $connection->fetchOne('SELECT default_set_name FROM card_print LIMIT 1'));
            self::assertSame('Commander Legends', (string) $connection->fetchOne('SELECT set_name FROM card_print_locale LIMIT 1'));
            self::assertGreaterThan(0, (int) $connection->fetchOne("SELECT COUNT(*) FROM card_search_option WHERE kind = 'rarity'"));
            self::assertGreaterThan(0, (int) $connection->fetchOne('SELECT COUNT(*) FROM card_search_set_option'));
            self::assertGreaterThan(0, (int) $connection->fetchOne('SELECT COUNT(*) FROM card_search_entry'));
            self::assertStringContainsString('Card catalog refresh completed.', $tester->getDisplay());
        } finally {
            @unlink($cardsFile);
        }
    }

    public function testFullImportRebuildsAdvancedAnalysisLocalData(): void
    {
        $connection = $this->entityManager->getConnection();
        $solRingOracleId = '70000000-0000-0000-0001-000000000010';
        $wrathOracleId = '70000000-0000-0000-0001-000000000011';
        $cardsFile = $this->writeTempJson([
            $this->scryfallCardData('70000000-0000-0000-0000-000000000010', 'Sol Ring', [
                'oracle_id' => $solRingOracleId,
                'mana_cost' => '{1}',
                'type_line' => 'Artifact',
                'oracle_text' => '{T}: Add {C}{C}.',
                'cmc' => 1,
                'produced_mana' => ['C'],
                'set_name' => 'Commander Test',
                'rarity' => 'uncommon',
            ]),
            $this->scryfallCardData('70000000-0000-0000-0000-000000000011', 'Wrath of God', [
                'oracle_id' => $wrathOracleId,
                'mana_cost' => '{2}{W}{W}',
                'type_line' => 'Sorcery',
                'oracle_text' => "Destroy all creatures. They can't be regenerated.",
                'cmc' => 4,
                'colors' => ['W'],
                'color_identity' => ['W'],
                'set_name' => 'Commander Test',
                'rarity' => 'rare',
            ]),
        ]);

        try {
            $tester = new CommandTester($this->maintainCommandWithMockedExternalAnalysisSyncs());
            $status = $tester->execute([
                '--mode' => 'full-import',
                '--apply' => true,
                '--cards-file' => $cardsFile,
                '--limit' => '2',
            ]);

            self::assertSame(Command::SUCCESS, $status);
            self::assertStringContainsString('Syncing external advanced deck analysis data after full import...', $tester->getDisplay());
            self::assertStringContainsString('Scryfall functional tags synced.', $tester->getDisplay());
            self::assertStringContainsString('Scryfall game changers synced.', $tester->getDisplay());
            self::assertStringContainsString('Commander Spellbook synced.', $tester->getDisplay());
            self::assertStringContainsString('Rebuilding advanced deck analysis data after full import...', $tester->getDisplay());
            self::assertStringContainsString('Local deck analysis rebuild summary:', $tester->getDisplay());
            self::assertStringContainsString('card board wipe profiles inserted=', $tester->getDisplay());
            self::assertStringContainsString('card mana profiles processed=', $tester->getDisplay());
            self::assertStringContainsString('Card catalog full import completed.', $tester->getDisplay());

            self::assertSame('2', (string) $connection->fetchOne(
                'SELECT COUNT(*) FROM card_oracle_profile WHERE oracle_id IN (:solRing, :wrath)',
                ['solRing' => $solRingOracleId, 'wrath' => $wrathOracleId],
            ));
            self::assertSame('mana_rock', (string) $connection->fetchOne(
                'SELECT mana_source_category FROM card_mana_profile WHERE oracle_id = :oracleId',
                ['oracleId' => $solRingOracleId],
            ));
            self::assertTrue((bool) $connection->fetchOne(
                'SELECT is_board_wipe FROM card_board_wipe_profile WHERE oracle_id = :oracleId',
                ['oracleId' => $wrathOracleId],
            ));
            self::assertSame('hard_creature_wipe', (string) $connection->fetchOne(
                'SELECT board_wipe_type FROM card_board_wipe_profile WHERE oracle_id = :oracleId',
                ['oracleId' => $wrathOracleId],
            ));
            self::assertSame('sha256:', substr((string) $connection->fetchOne(
                "SELECT version FROM deck_analysis_data_version WHERE key = 'mana'",
            ), 0, 7));
            self::assertSame('sha256:', substr((string) $connection->fetchOne(
                "SELECT version FROM deck_analysis_data_version WHERE key = 'board_wipe'",
            ), 0, 7));
            self::assertTrue((bool) $connection->fetchOne(
                'SELECT is_game_changer FROM card WHERE oracle_id = :oracleId LIMIT 1',
                ['oracleId' => $solRingOracleId],
            ));
            self::assertSame('3', (string) $connection->fetchOne(
                'SELECT COUNT(DISTINCT source) FROM external_sync_run WHERE source IN (:tags, :gameChangers, :spellbook) AND status = :status',
                [
                    'tags' => ScryfallTagSyncService::SOURCE,
                    'gameChangers' => ScryfallGameChangerSyncService::SOURCE,
                    'spellbook' => SpellbookSyncService::SOURCE,
                    'status' => 'success',
                ],
            ));
        } finally {
            @unlink($cardsFile);
        }
    }

    public function testResetPreservesDeckCardsByScryfallId(): void
    {
        $card = $this->seedCard('80000000-0000-0000-0000-000000000001', 'Arcane Signet', [
            'set_name' => 'Original Set',
            'rarity' => 'common',
            'image_status' => 'highres_scan',
        ]);
        $user = new User('catalog-reset@example.test', 'CatalogReset');
        $user->setPassword('hash');
        $deck = new Deck($user, 'Reset Deck');
        $deckCard = $deck->addOrIncrementCard($card, 1, DeckCard::SECTION_MAIN);
        $deckCardId = $deckCard->id();
        $this->entityManager->persist($user);
        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        $cardsFile = $this->writeTempJson([
            $this->scryfallCardData('80000000-0000-0000-0000-000000000001', 'Arcane Signet', [
                'set_name' => 'Restored Set',
                'rarity' => 'uncommon',
                'image_status' => 'highres_scan',
            ]),
        ]);
        $rulingsFile = $this->writeTempJson([]);

        try {
            $tester = new CommandTester(static::getContainer()->get(CardCatalogMaintainCommand::class));
            $status = $tester->execute([
                '--mode' => 'reset',
                '--apply' => true,
                '--allow-destructive' => true,
                '--confirm' => 'RESET-CARD-CATALOG',
                '--cards-file' => $cardsFile,
                '--rulings-file' => $rulingsFile,
                '--limit' => '1',
            ]);

            self::assertSame(Command::SUCCESS, $status);
            self::assertSame('1', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM deck_card'));
            self::assertSame(
                '80000000-0000-0000-0000-000000000001',
                (string) $this->entityManager->getConnection()->fetchOne(
                    'SELECT c.scryfall_id FROM deck_card dc INNER JOIN card c ON c.id = dc.card_id WHERE dc.id = :id',
                    ['id' => $deckCardId],
                ),
            );
            self::assertSame('Restored Set', (string) $this->entityManager->getConnection()->fetchOne('SELECT set_name FROM card LIMIT 1'));
            self::assertStringContainsString('Restored 1 deck card rows after catalog reset.', $tester->getDisplay());
        } finally {
            @unlink($cardsFile);
            @unlink($rulingsFile);
        }
    }

    public function testProductionResetRequiresExplicitDestructiveConfirmation(): void
    {
        $backupTableExisted = $this->tableExists('card_catalog_reset_deck_card_backup');
        $backupRows = $backupTableExisted
            ? (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_catalog_reset_deck_card_backup')
            : null;
        $command = new CardCatalogMaintainCommand(
            $this->entityManager->getConnection(),
            static::getContainer()->get(CardCatalogCommandRunner::class),
            static::getContainer()->get(CardCatalogResetService::class),
            'prod',
        );

        $tester = new CommandTester($command);
        $status = $tester->execute([
            '--mode' => 'reset',
            '--apply' => true,
        ]);

        self::assertSame(Command::FAILURE, $status);
        self::assertStringContainsString('Production reset is blocked without --allow-destructive --confirm=RESET-CARD-CATALOG.', $tester->getDisplay());
        self::assertSame($backupTableExisted, $this->tableExists('card_catalog_reset_deck_card_backup'));
        if ($backupTableExisted) {
            self::assertSame($backupRows, (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_catalog_reset_deck_card_backup'));
        }
    }

    /**
     * @param list<array<string,mixed>> $data
     */
    private function writeTempJson(array $data): string
    {
        $file = tempnam(sys_get_temp_dir(), 'card-catalog-maintain-');
        self::assertNotFalse($file);
        file_put_contents($file, json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));

        return $file;
    }

    private function maintainCommandWithMockedExternalAnalysisSyncs(): CardCatalogMaintainCommand
    {
        $connection = $this->entityManager->getConnection();
        $tagResponses = [];
        for ($index = 0; $index < count(ScryfallTagSyncService::DEFAULT_QUERIES); ++$index) {
            $tagResponses[] = $this->scryfallListResponse([]);
        }

        $runner = new CardCatalogCommandRunner(
            static::getContainer()->get(ScryfallCardMetadataBackfillCommand::class),
            static::getContainer()->get(CardPrintBackfillCommand::class),
            static::getContainer()->get(ScryfallSyncCommand::class),
            static::getContainer()->get(CardSearchOptionsRebuildCommand::class),
            static::getContainer()->get(CardSearchEntryRebuildCommand::class),
            new ScryfallTagsSyncCommand(new ScryfallTagSyncService(
                new MockHttpClient($tagResponses),
                $connection,
                'CommanderZoneTest/1.0',
                0,
            )),
            new ScryfallGameChangersSyncCommand(new ScryfallGameChangerSyncService(
                new MockHttpClient([
                    $this->scryfallListResponse([
                        [
                            'id' => '70000000-0000-0000-0000-000000000010',
                            'oracle_id' => '70000000-0000-0000-0001-000000000010',
                            'name' => 'Sol Ring',
                        ],
                    ]),
                ]),
                $connection,
                'CommanderZoneTest/1.0',
                0,
            )),
            new SpellbookSyncCommand(new SpellbookSyncService(
                new CommanderSpellbookClient(
                    new MockHttpClient([
                        $this->spellbookListResponse([]),
                        $this->spellbookListResponse([]),
                        $this->spellbookListResponse([]),
                    ]),
                    'CommanderZoneTest/1.0',
                    100,
                    0,
                ),
                $connection,
            )),
            static::getContainer()->get(DeckAnalysisLocalDataRebuildCommand::class),
        );

        return new CardCatalogMaintainCommand(
            $connection,
            $runner,
            static::getContainer()->get(CardCatalogResetService::class),
            'test',
        );
    }

    /**
     * @param list<array<string,mixed>> $cards
     */
    private function scryfallListResponse(array $cards): MockResponse
    {
        return new MockResponse(json_encode([
            'object' => 'list',
            'has_more' => false,
            'data' => $cards,
        ], JSON_THROW_ON_ERROR));
    }

    /**
     * @param list<array<string,mixed>> $results
     */
    private function spellbookListResponse(array $results): MockResponse
    {
        return new MockResponse(json_encode([
            'count' => null,
            'next' => null,
            'previous' => null,
            'results' => $results,
        ], JSON_THROW_ON_ERROR));
    }

    /**
     * @param array<string,mixed> $overrides
     *
     * @return array<string,mixed>
     */
    private function scryfallCardData(string $id, string $name, array $overrides = []): array
    {
        return array_replace([
            'id' => $id,
            'name' => $name,
            'mana_cost' => '{1}',
            'type_line' => 'Artifact',
            'oracle_text' => '',
            'colors' => [],
            'color_identity' => [],
            'legalities' => ['commander' => 'legal'],
            'image_uris' => [
                'normal' => sprintf('https://cards.scryfall.io/normal/front/%s.jpg', $id),
            ],
            'card_faces' => [],
            'all_parts' => [],
            'produced_mana' => [],
            'prices' => [],
            'layout' => 'normal',
            'set' => 'tst',
            'set_name' => 'Test Set',
            'rarity' => 'rare',
            'collector_number' => '1',
            'lang' => 'en',
        ], $overrides);
    }

    private function tableExists(string $table): bool
    {
        $result = $this->entityManager->getConnection()->fetchOne('SELECT to_regclass(:table)', ['table' => 'public.'.$table]);

        return is_string($result) && $result !== '';
    }
}
