<?php

namespace App\Tests\Integration;

use App\Infrastructure\Scryfall\CardPrintBackfillCommand;
use App\Infrastructure\Scryfall\ScryfallBulkDataClient;
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
            $command = new ScryfallSyncCommand(
                new ScryfallBulkDataClient($this->createMock(HttpClientInterface::class), 'test-agent'),
                $this->entityManager->getConnection(),
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
            self::assertStringContainsString('Skipped 1 unavailable prints.', $tester->getDisplay());
        } finally {
            @unlink($cardsFile);
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

        $command = new CardPrintBackfillCommand($this->entityManager->getConnection());
        $tester = new CommandTester($command);
        $status = $tester->execute([]);

        self::assertSame(Command::SUCCESS, $status);
        self::assertSame('1', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_print'));
        self::assertSame('1', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_print_locale'));
        self::assertSame('Sol Ring', (string) $this->entityManager->getConnection()->fetchOne('SELECT default_name FROM card_print LIMIT 1'));
        self::assertStringContainsString('Skipped 1 unavailable prints.', $tester->getDisplay());
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
            'collector_number' => '1',
            'lang' => 'en',
        ], $overrides);
    }
}
