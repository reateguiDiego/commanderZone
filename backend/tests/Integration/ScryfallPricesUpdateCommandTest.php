<?php

namespace App\Tests\Integration;

use App\Infrastructure\Scryfall\ScryfallBulkDataClient;
use App\Infrastructure\Scryfall\ScryfallPricesUpdateCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Contracts\HttpClient\HttpClientInterface;

class ScryfallPricesUpdateCommandTest extends ApiTestCase
{
    public function testItUpdatesOnlyMatchingLocalCardPrices(): void
    {
        $updatedId = '90000000-0000-0000-0000-000000000001';
        $unchangedId = '90000000-0000-0000-0000-000000000002';
        $this->seedCard($updatedId, 'Updated Price Card', ['prices' => ['eur' => '1.00', 'usd' => '1.10']]);
        $this->seedCard($unchangedId, 'Untouched Price Card', ['prices' => ['eur' => '2.00']]);
        $cardsFile = $this->writeTempJson([
            ['id' => $updatedId, 'prices' => ['eur' => '3.50', 'usd' => '4.00', 'tix' => null]],
            ['id' => '90000000-0000-0000-0000-000000000003', 'prices' => ['eur' => '9.99']],
        ]);

        try {
            $tester = new CommandTester($this->command());
            $status = $tester->execute(['--cards-file' => $cardsFile]);

            self::assertSame(Command::SUCCESS, $status);
            self::assertSame(
                ['eur' => '3.50', 'usd' => '4.00', 'tix' => null],
                json_decode((string) $this->entityManager->getConnection()->fetchOne(
                    'SELECT prices FROM card WHERE scryfall_id = :scryfallId',
                    ['scryfallId' => $updatedId],
                ), true, 512, JSON_THROW_ON_ERROR),
            );
            self::assertSame(
                ['eur' => '2.00'],
                json_decode((string) $this->entityManager->getConnection()->fetchOne(
                    'SELECT prices FROM card WHERE scryfall_id = :scryfallId',
                    ['scryfallId' => $unchangedId],
                ), true, 512, JSON_THROW_ON_ERROR),
            );
            self::assertSame('2', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card'));
            self::assertStringContainsString('Done. Scanned 2 cards, updated 1 local prices.', $tester->getDisplay());
        } finally {
            @unlink($cardsFile);
        }
    }

    public function testItClearsPricesWhenScryfallProvidesAnEmptyPriceObject(): void
    {
        $scryfallId = '90000000-0000-0000-0000-000000000004';
        $this->seedCard($scryfallId, 'No Price Card', ['prices' => ['eur' => '7.50']]);
        $cardsFile = $this->writeTempJson([['id' => $scryfallId, 'prices' => []]]);

        try {
            $tester = new CommandTester($this->command());
            $status = $tester->execute(['--cards-file' => $cardsFile]);

            self::assertSame(Command::SUCCESS, $status);
            self::assertSame(
                [],
                json_decode((string) $this->entityManager->getConnection()->fetchOne(
                    'SELECT prices FROM card WHERE scryfall_id = :scryfallId',
                    ['scryfallId' => $scryfallId],
                ), true, 512, JSON_THROW_ON_ERROR),
            );
        } finally {
            @unlink($cardsFile);
        }
    }

    private function command(): ScryfallPricesUpdateCommand
    {
        return new ScryfallPricesUpdateCommand(
            new ScryfallBulkDataClient($this->createStub(HttpClientInterface::class), 'test-agent'),
            $this->entityManager->getConnection(),
        );
    }

    /**
     * @param list<array<string,mixed>> $data
     */
    private function writeTempJson(array $data): string
    {
        $file = tempnam(sys_get_temp_dir(), 'scryfall-prices-test-');
        self::assertNotFalse($file);
        file_put_contents($file, json_encode($data, JSON_THROW_ON_ERROR));

        return $file;
    }
}
