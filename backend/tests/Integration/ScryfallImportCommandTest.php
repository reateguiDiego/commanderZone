<?php

namespace App\Tests\Integration;

use App\Application\Card\CardSearchOptionsRebuilder;
use App\Application\Card\CardSearchEntryRebuilder;
use App\Infrastructure\Scryfall\CardPrintBackfillCommand;
use App\Infrastructure\Scryfall\ScryfallBulkDataClient;
use App\Infrastructure\Scryfall\ScryfallCardMetadataBackfillCommand;
use App\Infrastructure\Scryfall\ScryfallSyncCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Contracts\HttpClient\HttpClientInterface;

class ScryfallImportCommandTest extends ApiTestCase
{
    public function testScryfallSyncSkipsUnavailablePrintRows(): void
    {
        $cardsFile = $this->writeTempJson([
            $this->scryfallCardData('40000000-0000-0000-0000-000000000001', 'Sol Ring', [
                'oracle_id' => '40000000-0000-0000-0000-000000000101',
                'lang' => 'en',
                'image_status' => 'highres_scan',
            ]),
            $this->scryfallCardData('40000000-0000-0000-0000-000000000002', 'Arcane Signet', [
                'lang' => 'es',
                'printed_name' => 'Sello arcano',
                'image_status' => 'placeholder',
            ]),
        ]);
        $rulingsFile = $this->writeTempJson([]);

        try {
            $rebuilder = new CardSearchOptionsRebuilder($this->entityManager->getConnection());
            $entryRebuilder = new CardSearchEntryRebuilder($this->entityManager->getConnection());
            $command = new ScryfallSyncCommand(
                new ScryfallBulkDataClient($this->createStub(HttpClientInterface::class), 'test-agent'),
                $this->entityManager->getConnection(),
                $rebuilder,
                $entryRebuilder,
                '512M',
            );
            $tester = new CommandTester($command);
            $status = $tester->execute([
                '--file' => $cardsFile,
                '--rulings-file' => $rulingsFile,
            ]);

            self::assertSame(Command::SUCCESS, $status);
            self::assertSame('1', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card'));
            self::assertSame('1', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_print'));
            self::assertSame('1', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_print_locale'));
            self::assertSame('Sol Ring', (string) $this->entityManager->getConnection()->fetchOne('SELECT name FROM card LIMIT 1'));
            self::assertSame('rare', (string) $this->entityManager->getConnection()->fetchOne('SELECT rarity FROM card LIMIT 1'));
            self::assertSame('Test Set', (string) $this->entityManager->getConnection()->fetchOne('SELECT set_name FROM card LIMIT 1'));
            self::assertSame('40000000-0000-0000-0000-000000000101', (string) $this->entityManager->getConnection()->fetchOne('SELECT oracle_id FROM card LIMIT 1'));
            self::assertSame('40000000-0000-0000-0000-000000000101', (string) $this->entityManager->getConnection()->fetchOne('SELECT oracle_id FROM card_print LIMIT 1'));
            self::assertSame('Test Set', (string) $this->entityManager->getConnection()->fetchOne('SELECT default_set_name FROM card_print LIMIT 1'));
            self::assertSame('Test Set', (string) $this->entityManager->getConnection()->fetchOne('SELECT set_name FROM card_print_locale LIMIT 1'));
            self::assertGreaterThan(0, (int) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_search_option WHERE kind = \'rarity\''));
            self::assertStringContainsString('Skipped 1 unavailable prints.', $tester->getDisplay());
        } finally {
            @unlink($cardsFile);
            @unlink($rulingsFile);
        }
    }

    public function testScryfallSyncPersistsTokenRelationsAndRemovesStaleRelations(): void
    {
        $sourceId = '40000000-0000-0000-0000-000000000011';
        $sourceOracleId = '40000000-0000-0000-0000-000000000111';
        $tokenId = '40000000-0000-0000-0000-000000000012';
        $firstCardsFile = $this->writeTempJson([
            $this->scryfallCardData($sourceId, 'Token Maker', [
                'oracle_id' => $sourceOracleId,
                'type_line' => 'Creature - Wizard',
                'all_parts' => [
                    [
                        'id' => $tokenId,
                        'component' => 'token',
                        'name' => 'Wizard Token',
                        'uri' => 'https://api.scryfall.com/cards/'.$tokenId,
                    ],
                ],
            ]),
            $this->scryfallCardData($tokenId, 'Wizard Token', [
                'type_line' => 'Token Creature - Wizard',
            ]),
        ]);
        $secondCardsFile = $this->writeTempJson([
            $this->scryfallCardData($sourceId, 'Token Maker', [
                'oracle_id' => $sourceOracleId,
                'type_line' => 'Creature - Wizard',
                'all_parts' => [],
            ]),
        ]);
        $rulingsFile = $this->writeTempJson([]);

        try {
            $this->runScryfallSyncCommand($firstCardsFile, $rulingsFile);

            $relation = $this->entityManager->getConnection()->fetchAssociative(
                'SELECT source_scryfall_id, source_oracle_id, token_scryfall_id, token_name, token_uri FROM card_token_relation WHERE source_scryfall_id = :sourceScryfallId',
                ['sourceScryfallId' => $sourceId],
            );
            self::assertIsArray($relation);
            self::assertSame($sourceId, $relation['source_scryfall_id']);
            self::assertSame($sourceOracleId, $relation['source_oracle_id']);
            self::assertSame($tokenId, $relation['token_scryfall_id']);
            self::assertSame('Wizard Token', $relation['token_name']);
            self::assertSame('https://api.scryfall.com/cards/'.$tokenId, $relation['token_uri']);

            $this->runScryfallSyncCommand($secondCardsFile, $rulingsFile);

            self::assertSame(
                '0',
                (string) $this->entityManager->getConnection()->fetchOne(
                    'SELECT COUNT(*) FROM card_token_relation WHERE source_scryfall_id = :sourceScryfallId',
                    ['sourceScryfallId' => $sourceId],
                ),
            );
        } finally {
            @unlink($firstCardsFile);
            @unlink($secondCardsFile);
            @unlink($rulingsFile);
        }
    }

    public function testCardPrintBackfillSkipsUnavailablePrintRows(): void
    {
        $this->seedCard('50000000-0000-0000-0000-000000000001', 'Sol Ring', [
            'lang' => 'en',
            'image_status' => 'highres_scan',
        ]);
        $this->seedCard('50000000-0000-0000-0000-000000000002', 'Arcane Signet', [
            'lang' => 'es',
            'printed_name' => 'Sello arcano',
            'image_status' => 'placeholder',
        ]);

        $this->entityManager->getConnection()->executeStatement('TRUNCATE card_print_locale, card_print RESTART IDENTITY CASCADE');

        $command = new CardPrintBackfillCommand(
            $this->entityManager->getConnection(),
            new CardSearchOptionsRebuilder($this->entityManager->getConnection()),
            new CardSearchEntryRebuilder($this->entityManager->getConnection()),
        );
        $tester = new CommandTester($command);
        $status = $tester->execute([]);

        self::assertSame(Command::SUCCESS, $status);
        self::assertSame('1', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_print'));
        self::assertSame('1', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_print_locale'));
        self::assertSame('Sol Ring', (string) $this->entityManager->getConnection()->fetchOne('SELECT default_name FROM card_print LIMIT 1'));
        self::assertStringContainsString('Skipped 1 unavailable prints.', $tester->getDisplay());
    }

    public function testScryfallMetadataBackfillPersistsRarityAndSetNameForExistingCards(): void
    {
        $this->seedCard('60000000-0000-0000-0000-000000000001', 'Sol Ring', [
            'set_name' => null,
            'rarity' => null,
        ]);
        $this->seedCard('60000000-0000-0000-0000-000000000002', 'Arcane Signet', [
            'set_name' => null,
            'rarity' => null,
        ]);
        $cardsFile = $this->writeTempJson([
            $this->scryfallCardData('60000000-0000-0000-0000-000000000001', 'Sol Ring', [
                'set_name' => 'Commander Legends',
                'rarity' => 'rare',
            ]),
            $this->scryfallCardData('60000000-0000-0000-0000-000000000002', 'Arcane Signet', [
                'set_name' => 'Throne of Eldraine',
                'rarity' => 'common',
            ]),
        ]);

        try {
            $command = new ScryfallCardMetadataBackfillCommand(
                new ScryfallBulkDataClient($this->createStub(HttpClientInterface::class), 'test-agent'),
                $this->entityManager->getConnection(),
            );
            $tester = new CommandTester($command);
            $status = $tester->execute([
                '--cards-file' => $cardsFile,
                '--only-missing' => true,
            ]);

            self::assertSame(Command::SUCCESS, $status);
            self::assertSame(
                'rare',
                (string) $this->entityManager->getConnection()->fetchOne(
                    'SELECT rarity FROM card WHERE scryfall_id = :scryfallId',
                    ['scryfallId' => '60000000-0000-0000-0000-000000000001'],
                ),
            );
            self::assertSame(
                'Throne of Eldraine',
                (string) $this->entityManager->getConnection()->fetchOne(
                    'SELECT set_name FROM card WHERE scryfall_id = :scryfallId',
                    ['scryfallId' => '60000000-0000-0000-0000-000000000002'],
                ),
            );
            self::assertStringContainsString('updated 2 local rows', $tester->getDisplay());
        } finally {
            @unlink($cardsFile);
        }
    }

    /**
     * @param list<array<string,mixed>> $data
     */
    private function writeTempJson(array $data): string
    {
        $file = tempnam(sys_get_temp_dir(), 'scryfall-test-');
        self::assertNotFalse($file);
        file_put_contents($file, json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));

        return $file;
    }

    private function runScryfallSyncCommand(string $cardsFile, string $rulingsFile): void
    {
        $command = new ScryfallSyncCommand(
            new ScryfallBulkDataClient($this->createStub(HttpClientInterface::class), 'test-agent'),
            $this->entityManager->getConnection(),
            new CardSearchOptionsRebuilder($this->entityManager->getConnection()),
            new CardSearchEntryRebuilder($this->entityManager->getConnection()),
            '512M',
        );
        $tester = new CommandTester($command);
        $status = $tester->execute([
            '--file' => $cardsFile,
            '--rulings-file' => $rulingsFile,
        ]);

        self::assertSame(Command::SUCCESS, $status);
    }

    /**
     * @param array<string,mixed> $overrides
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
}
