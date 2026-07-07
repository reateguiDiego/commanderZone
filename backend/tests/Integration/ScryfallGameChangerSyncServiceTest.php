<?php

namespace App\Tests\Integration;

use App\Application\Card\ScryfallGameChangerSyncService;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

final class ScryfallGameChangerSyncServiceTest extends ApiTestCase
{
    public function testSyncMarksCurrentGameChangersAndClearsStaleOnes(): void
    {
        $currentId = '88000000-0000-0000-0000-000000000001';
        $staleId = '88000000-0000-0000-0000-000000000002';
        $this->insertOracleProfile($currentId, 'Current Game Changer', false);
        $this->insertOracleProfile($staleId, 'Stale Game Changer', true);
        $service = new ScryfallGameChangerSyncService(
            new MockHttpClient([
                new MockResponse(json_encode([
                    'object' => 'list',
                    'has_more' => false,
                    'data' => [
                        [
                            'id' => '88000000-0000-0000-0000-000000000101',
                            'oracle_id' => $currentId,
                            'name' => 'Current Game Changer',
                        ],
                    ],
                ], JSON_THROW_ON_ERROR)),
            ]),
            $this->entityManager->getConnection(),
            'CommanderZoneTest/1.0',
            0,
        );

        $result = $service->sync();

        self::assertSame('success', $result['status']);
        self::assertSame(1, $result['itemsSeen']);
        self::assertSame('1', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM external_sync_run WHERE source = :source AND status = :status', [
            'source' => ScryfallGameChangerSyncService::SOURCE,
            'status' => 'success',
        ]));
        self::assertTrue($this->isGameChanger($currentId));
        self::assertFalse($this->isGameChanger($staleId));
    }

    private function insertOracleProfile(string $oracleId, string $name, bool $isGameChanger): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_oracle_profile (
    oracle_id,
    name,
    normalized_name,
    colors,
    color_identity,
    produced_mana,
    keywords,
    card_faces,
    is_game_changer,
    data_hash,
    updated_at
) VALUES (
    :oracle_id,
    :name,
    :normalized_name,
    '[]',
    '[]',
    '[]',
    '[]',
    '[]',
    :is_game_changer,
    :data_hash,
    NOW()
)
SQL,
            [
                'oracle_id' => $oracleId,
                'name' => $name,
                'normalized_name' => mb_strtolower($name),
                'is_game_changer' => $isGameChanger,
                'data_hash' => hash('sha256', $oracleId.$name),
            ],
            ['is_game_changer' => \Doctrine\DBAL\ParameterType::BOOLEAN],
        );
    }

    private function isGameChanger(string $oracleId): bool
    {
        return (bool) $this->entityManager->getConnection()->fetchOne(
            'SELECT is_game_changer FROM card_oracle_profile WHERE oracle_id = :oracleId',
            ['oracleId' => $oracleId],
        );
    }
}
