<?php

namespace App\Tests\Integration;

use App\Application\Card\ScryfallTagSyncService;
use App\Infrastructure\DeckAnalysis\ScryfallTagsSyncCommand;
use Doctrine\DBAL\ParameterType;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

final class ScryfallTagSyncServiceTest extends ApiTestCase
{
    public function testUpsertsTagByOracleIdAndTagSlug(): void
    {
        $oracleId = '80000000-0000-0000-0000-000000000001';
        $service = $this->service([
            $this->scryfallList([$this->scryfallCard($oracleId)]),
            $this->scryfallList([$this->scryfallCard($oracleId)]),
        ]);

        $first = $service->sync(['otag:ramp']);
        $second = $service->sync(['otag:ramp']);

        self::assertSame(1, $first['itemsInserted']);
        self::assertSame(0, $first['itemsUpdated']);
        self::assertSame(0, $second['itemsInserted']);
        self::assertSame(1, $second['itemsUpdated']);
        self::assertSame('1', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM external_card_tag'));
        self::assertSame(
            'ramp',
            (string) $this->entityManager->getConnection()->fetchOne('SELECT tag_slug FROM external_card_tag WHERE oracle_id = :oracleId', ['oracleId' => $oracleId]),
        );
    }

    public function testEmptyQueryDoesNotBreakCommand(): void
    {
        $responses = [];
        for ($index = 0; $index < count(ScryfallTagSyncService::DEFAULT_QUERIES); ++$index) {
            $responses[] = $this->scryfallList([]);
        }
        $command = new ScryfallTagsSyncCommand($this->service($responses));
        $tester = new CommandTester($command);

        $status = $tester->execute([]);

        self::assertSame(Command::SUCCESS, $status);
        self::assertSame('0', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM external_card_tag'));
        self::assertStringContainsString('returned no usable oracle ids', $tester->getDisplay());
        self::assertSame(
            'success',
            (string) $this->entityManager->getConnection()->fetchOne('SELECT status FROM external_sync_run ORDER BY started_at DESC LIMIT 1'),
        );
    }

    public function testReplacesOldActiveTagsOnlyAfterSuccessfulQuery(): void
    {
        $oldOracleId = '80000000-0000-0000-0000-000000000011';
        $newOracleId = '80000000-0000-0000-0000-000000000012';
        $this->insertExternalTag($oldOracleId, 'ramp', 'otag:ramp', true);

        $failedService = $this->service([
            new MockResponse(json_encode(['details' => 'temporary failure'], JSON_THROW_ON_ERROR), ['http_code' => 500]),
        ]);

        try {
            $failedService->sync(['otag:ramp']);
            self::fail('Expected failed Scryfall query.');
        } catch (\RuntimeException) {
            self::assertSame(1, $this->activeFlag($oldOracleId, 'ramp'));
        }

        $successfulService = $this->service([
            $this->scryfallList([$this->scryfallCard($newOracleId)]),
        ]);
        $result = $successfulService->sync(['otag:ramp']);

        self::assertSame(1, $result['itemsInserted']);
        self::assertSame(0, $this->activeFlag($oldOracleId, 'ramp'));
        self::assertSame(1, $this->activeFlag($newOracleId, 'ramp'));
    }

    /**
     * @param list<MockResponse> $responses
     */
    private function service(array $responses): ScryfallTagSyncService
    {
        return new ScryfallTagSyncService(
            new MockHttpClient($responses),
            $this->entityManager->getConnection(),
            'CommanderZoneTest/1.0',
            0,
        );
    }

    /**
     * @param list<array<string,mixed>> $cards
     */
    private function scryfallList(array $cards): MockResponse
    {
        return new MockResponse(json_encode([
            'object' => 'list',
            'has_more' => false,
            'data' => $cards,
        ], JSON_THROW_ON_ERROR));
    }

    /**
     * @return array<string,string>
     */
    private function scryfallCard(string $oracleId): array
    {
        return [
            'id' => '90000000-0000-0000-0000-000000000001',
            'oracle_id' => $oracleId,
            'name' => 'Tagged Card',
        ];
    }

    private function insertExternalTag(string $oracleId, string $tagSlug, string $query, bool $active): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO external_card_tag (
    id,
    oracle_id,
    source,
    tag_type,
    tag_slug,
    import_query,
    confidence,
    active,
    imported_at
) VALUES (
    :id,
    :oracle_id,
    :source,
    :tag_type,
    :tag_slug,
    :import_query,
    1.0,
    :active,
    NOW()
)
SQL,
            [
                'id' => '81000000-0000-0000-0000-000000000001',
                'oracle_id' => $oracleId,
                'source' => ScryfallTagSyncService::SOURCE,
                'tag_type' => 'oracle_tag',
                'tag_slug' => $tagSlug,
                'import_query' => $query,
                'active' => $active,
            ],
            [
                'active' => ParameterType::BOOLEAN,
            ],
        );
    }

    private function activeFlag(string $oracleId, string $tagSlug): int
    {
        return (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT CASE WHEN active THEN 1 ELSE 0 END FROM external_card_tag WHERE oracle_id = :oracleId AND tag_slug = :tagSlug',
            [
                'oracleId' => $oracleId,
                'tagSlug' => $tagSlug,
            ],
        );
    }
}
