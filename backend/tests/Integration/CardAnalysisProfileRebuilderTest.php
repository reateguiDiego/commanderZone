<?php

namespace App\Tests\Integration;

use App\Application\Card\CardOracleProfileRebuilder;
use App\Application\Deck\CardAnalysisProfileRebuilder;

final class CardAnalysisProfileRebuilderTest extends ApiTestCase
{
    public function testGeneratesAggregatedRolesAndFlags(): void
    {
        $oracleId = '84000000-0000-0000-0000-000000000001';
        $this->seedProfile($oracleId, 'Aggregated Role Card');
        $this->insertRole('84000000-0000-0000-0000-000000000011', $oracleId, 'ramp', null, true);
        $this->insertRole('84000000-0000-0000-0000-000000000012', $oracleId, 'fast_mana', 'artifact', true);
        $this->insertRole('84000000-0000-0000-0000-000000000013', $oracleId, 'tutor', null, false);
        $this->insertPowerFlag('84000000-0000-0000-0000-000000000014', $oracleId, 'free_interaction');

        $result = $this->rebuilder()->rebuild();

        self::assertSame(['seen' => 1, 'inserted' => 1, 'updated' => 0, 'skipped' => 0], $result);
        $profile = $this->analysisProfile($oracleId);
        self::assertSame(['fast_mana', 'ramp'], $profile['roles']);
        self::assertSame(['artifact'], $profile['subroles']);
        self::assertTrue($profile['is_fast_mana']);
        self::assertTrue($profile['is_free_interaction']);
    }

    public function testGeneratesRoleScores(): void
    {
        $oracleId = '84000000-0000-0000-0000-000000000002';
        $this->seedProfile($oracleId, 'Role Score Card');
        $this->insertRole('84000000-0000-0000-0000-000000000021', $oracleId, 'draw', null, true);
        $this->insertRoleQuality('84000000-0000-0000-0000-000000000022', $oracleId, 'draw');

        $this->rebuilder()->rebuild();

        $profile = $this->analysisProfile($oracleId);
        $drawScore = $profile['role_scores']['draw'] ?? null;
        self::assertIsArray($drawScore);
        ksort($drawScore);
        self::assertSame([
            'conditionality' => 'low',
            'mana_efficiency' => 'high',
            'quality' => 'good',
            'repeatability' => 'permanent',
            'score' => 80,
            'speed' => 'fast',
        ], $drawScore);
    }

    public function testGeneratesConditionKeysAndArchetypeWeights(): void
    {
        $oracleId = '84000000-0000-0000-0000-000000000003';
        $this->seedProfile($oracleId, 'Condition Card');
        $this->insertCondition('84000000-0000-0000-0000-000000000031', $oracleId, 'requires_low_curve');
        $this->insertCondition('84000000-0000-0000-0000-000000000032', $oracleId, 'requires_combo_plan');
        $this->insertArchetypeSignal('84000000-0000-0000-0000-000000000033', $oracleId, 'spellslinger', 7);

        $this->rebuilder()->rebuild();

        $profile = $this->analysisProfile($oracleId);
        self::assertSame(['requires_combo_plan', 'requires_low_curve'], $profile['condition_keys']);
        self::assertSame(7, $profile['archetype_weights']['spellslinger'] ?? null);
    }

    public function testAggregatesExpandedSemanticDataForAnalyzerReads(): void
    {
        $oracleId = '84000000-0000-0000-0000-000000000005';
        $this->seedProfile($oracleId, 'Expanded Semantic Card');
        $this->insertRole('84000000-0000-0000-0000-000000000051', $oracleId, 'token_maker', null, true);
        $this->insertRole('84000000-0000-0000-0000-000000000052', $oracleId, 'combo_piece', null, true);
        $this->insertCondition('84000000-0000-0000-0000-000000000053', $oracleId, 'requires_combo_plan');
        $this->insertArchetypeSignal('84000000-0000-0000-0000-000000000054', $oracleId, 'combo', 4);
        $this->insertPowerFlag('84000000-0000-0000-0000-000000000055', $oracleId, 'compact_wincon');
        $this->insertPowerFlag('84000000-0000-0000-0000-000000000056', $oracleId, 'efficient_tutor');

        $this->rebuilder()->rebuild();

        $profile = $this->analysisProfile($oracleId);
        self::assertContains('token_maker', $profile['roles']);
        self::assertContains('combo_piece', $profile['roles']);
        self::assertContains('requires_combo_plan', $profile['condition_keys']);
        self::assertContains('compact_wincon', $profile['power_flags']);
        self::assertSame(4, $profile['archetype_weights']['combo'] ?? null);
        self::assertTrue($profile['is_efficient_tutor']);
    }

    public function testAggregatesFinalSemanticFlagsForAnalyzerReads(): void
    {
        $oracleId = '84000000-0000-0000-0000-000000000006';
        $this->seedProfile($oracleId, 'Final Semantic Card');
        $this->entityManager->getConnection()->executeStatement(
            'UPDATE card_oracle_profile SET is_game_changer = true WHERE oracle_id = :oracleId',
            ['oracleId' => $oracleId],
        );
        $this->insertRole('84000000-0000-0000-0000-000000000061', $oracleId, 'cost_reducer', null, true);
        $this->insertPowerFlag('84000000-0000-0000-0000-000000000062', $oracleId, 'game_changer');
        $this->insertPowerFlag('84000000-0000-0000-0000-000000000063', $oracleId, 'low_opportunity_cost');

        $this->rebuilder()->rebuild();

        $profile = $this->analysisProfile($oracleId);
        self::assertTrue($profile['is_game_changer']);
        self::assertContains('cost_reducer', $profile['roles']);
        self::assertContains('game_changer', $profile['power_flags']);
        self::assertContains('low_opportunity_cost', $profile['power_flags']);
    }

    public function testDoesNotUpdateWhenAnalysisHashIsUnchanged(): void
    {
        $oracleId = '84000000-0000-0000-0000-000000000004';
        $this->seedProfile($oracleId, 'Stable Analysis Card');
        $this->insertRole('84000000-0000-0000-0000-000000000041', $oracleId, 'ramp', null, true);

        $firstResult = $this->rebuilder()->rebuild();
        self::assertSame(1, $firstResult['inserted']);

        $this->entityManager->getConnection()->executeStatement(
            "UPDATE card_analysis_profile SET updated_at = TIMESTAMP '2000-01-01 00:00:00' WHERE oracle_id = :oracleId",
            ['oracleId' => $oracleId],
        );

        $secondResult = $this->rebuilder()->rebuild();

        self::assertSame(['seen' => 1, 'inserted' => 0, 'updated' => 0, 'skipped' => 1], $secondResult);
        self::assertSame(
            '2000-01-01 00:00:00',
            $this->entityManager->getConnection()->fetchOne(
                "SELECT to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS') FROM card_analysis_profile WHERE oracle_id = :oracleId",
                ['oracleId' => $oracleId],
            ),
        );
    }

    private function rebuilder(): CardAnalysisProfileRebuilder
    {
        return new CardAnalysisProfileRebuilder($this->entityManager->getConnection());
    }

    private function seedProfile(string $oracleId, string $name): void
    {
        $scryfallId = substr_replace($oracleId, '85000000', 0, 8);
        $this->seedCard($scryfallId, $name, [
            'oracle_id' => $oracleId,
            'mana_cost' => '{1}',
            'cmc' => 1,
            'type_line' => 'Artifact',
            'colors' => [],
            'color_identity' => ['W'],
            'produced_mana' => ['W'],
            'keywords' => ['Flash'],
            'legalities' => ['commander' => 'legal'],
        ]);
        (new CardOracleProfileRebuilder($this->entityManager->getConnection()))->rebuild();
    }

    /**
     * @return array<string,mixed>
     */
    private function analysisProfile(string $oracleId): array
    {
        $row = $this->entityManager->getConnection()->fetchAssociative(
            'SELECT * FROM card_analysis_profile WHERE oracle_id = :oracleId',
            ['oracleId' => $oracleId],
        );
        self::assertIsArray($row);

        foreach (['roles', 'subroles', 'role_scores', 'condition_keys', 'archetype_weights', 'power_flags'] as $jsonColumn) {
            $decoded = json_decode((string) $row[$jsonColumn], true, flags: JSON_THROW_ON_ERROR);
            self::assertIsArray($decoded);
            $row[$jsonColumn] = $decoded;
        }

        foreach (['is_fast_mana', 'is_free_interaction', 'is_efficient_tutor', 'is_cedh_staple', 'is_game_changer'] as $booleanColumn) {
            $row[$booleanColumn] = (bool) $row[$booleanColumn];
        }

        return $row;
    }

    private function insertRole(string $id, string $oracleId, string $role, ?string $subrole, bool $active): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_role (
    id,
    oracle_id,
    role,
    subrole,
    confidence,
    source,
    active,
    created_at,
    updated_at
) VALUES (
    :id,
    :oracle_id,
    :role,
    :subrole,
    1.0,
    'test',
    :active,
    NOW(),
    NOW()
)
SQL,
            [
                'id' => $id,
                'oracle_id' => $oracleId,
                'role' => $role,
                'subrole' => $subrole,
                'active' => $active,
            ],
            ['active' => \Doctrine\DBAL\ParameterType::BOOLEAN],
        );
    }

    private function insertRoleQuality(string $id, string $oracleId, string $role): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_role_quality (
    id,
    oracle_id,
    role,
    quality,
    speed,
    repeatability,
    mana_efficiency,
    conditionality,
    score,
    source,
    updated_at
) VALUES (
    :id,
    :oracle_id,
    :role,
    'good',
    'fast',
    'permanent',
    'high',
    'low',
    80,
    'test',
    NOW()
)
SQL,
            [
                'id' => $id,
                'oracle_id' => $oracleId,
                'role' => $role,
            ],
        );
    }

    private function insertCondition(string $id, string $oracleId, string $conditionKey): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_condition (
    id,
    oracle_id,
    condition_key,
    risk_if_unmet,
    description,
    updated_at
) VALUES (
    :id,
    :oracle_id,
    :condition_key,
    'medium',
    'Fixture condition.',
    NOW()
)
SQL,
            [
                'id' => $id,
                'oracle_id' => $oracleId,
                'condition_key' => $conditionKey,
            ],
        );
    }

    private function insertArchetypeSignal(string $id, string $oracleId, string $archetype, int $weight, string $source = 'test'): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_archetype_signal (
    id,
    oracle_id,
    archetype,
    weight,
    source,
    updated_at
) VALUES (
    :id,
    :oracle_id,
    :archetype,
    :weight,
    :source,
    NOW()
)
SQL,
            [
                'id' => $id,
                'oracle_id' => $oracleId,
                'archetype' => $archetype,
                'weight' => $weight,
                'source' => $source,
            ],
        );
    }

    private function insertPowerFlag(string $id, string $oracleId, string $flag): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_power_flag (
    id,
    oracle_id,
    flag,
    source,
    weight,
    updated_at
) VALUES (
    :id,
    :oracle_id,
    :flag,
    'test',
    8,
    NOW()
)
SQL,
            [
                'id' => $id,
                'oracle_id' => $oracleId,
                'flag' => $flag,
            ],
        );
    }
}
