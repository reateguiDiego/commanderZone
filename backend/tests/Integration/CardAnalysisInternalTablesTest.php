<?php

namespace App\Tests\Integration;

use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\DBAL\ParameterType;

final class CardAnalysisInternalTablesTest extends ApiTestCase
{
    public function testInternalCardAnalysisTablesExist(): void
    {
        $schemaManager = $this->entityManager->getConnection()->createSchemaManager();

        self::assertTrue($schemaManager->tablesExist(['card_role']));
        self::assertTrue($schemaManager->tablesExist(['card_role_quality']));
        self::assertTrue($schemaManager->tablesExist(['card_condition']));
        self::assertTrue($schemaManager->tablesExist(['card_archetype_signal']));
        self::assertTrue($schemaManager->tablesExist(['card_power_flag']));
    }

    public function testUniqueConstraintsPreventBasicDuplicates(): void
    {
        $oracleId = '82000000-0000-0000-0000-000000000001';

        $this->insertCardRole('82000000-0000-0000-0000-000000000011', $oracleId, 'ramp', null, true);
        $this->assertDuplicateRejected(fn (): int => $this->insertCardRole('82000000-0000-0000-0000-000000000012', $oracleId, 'ramp', null, true));

        $this->entityManager->getConnection()->executeStatement(
            'UPDATE card_role SET active = false WHERE oracle_id = :oracleId AND role = :role',
            [
                'oracleId' => $oracleId,
                'role' => 'ramp',
            ],
        );
        $this->insertCardRole('82000000-0000-0000-0000-000000000013', $oracleId, 'ramp', null, true);
        self::assertSame('2', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_role WHERE oracle_id = :oracleId', ['oracleId' => $oracleId]));

        $this->insertRoleQuality('82000000-0000-0000-0000-000000000021', $oracleId, 'ramp');
        $this->assertDuplicateRejected(fn (): int => $this->insertRoleQuality('82000000-0000-0000-0000-000000000022', $oracleId, 'ramp'));

        $this->insertCondition('82000000-0000-0000-0000-000000000031', $oracleId, 'requires_artifact_density');
        $this->assertDuplicateRejected(fn (): int => $this->insertCondition('82000000-0000-0000-0000-000000000032', $oracleId, 'requires_artifact_density'));

        $this->insertArchetypeSignal('82000000-0000-0000-0000-000000000041', $oracleId, 'artifacts');
        $this->assertDuplicateRejected(fn (): int => $this->insertArchetypeSignal('82000000-0000-0000-0000-000000000042', $oracleId, 'artifacts'));

        $this->insertPowerFlag('82000000-0000-0000-0000-000000000051', $oracleId, 'game_changer');
        $this->assertDuplicateRejected(fn (): int => $this->insertPowerFlag('82000000-0000-0000-0000-000000000052', $oracleId, 'game_changer'));
    }

    private function assertDuplicateRejected(callable $insert): void
    {
        try {
            $insert();
            self::fail('Expected duplicate insert to be rejected.');
        } catch (UniqueConstraintViolationException) {
            self::assertTrue(true);
        }
    }

    private function insertCardRole(string $id, string $oracleId, string $role, ?string $subrole, bool $active): int
    {
        return $this->entityManager->getConnection()->executeStatement(
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
            [
                'active' => ParameterType::BOOLEAN,
            ],
        );
    }

    private function insertRoleQuality(string $id, string $oracleId, string $role): int
    {
        return $this->entityManager->getConnection()->executeStatement(
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
    'medium',
    'medium',
    'single_use',
    'medium',
    'low',
    50,
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

    private function insertCondition(string $id, string $oracleId, string $conditionKey): int
    {
        return $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_condition (
    id,
    oracle_id,
    condition_key,
    required_role,
    required_count,
    risk_if_unmet,
    description,
    updated_at
) VALUES (
    :id,
    :oracle_id,
    :condition_key,
    'artifact',
    10,
    'medium',
    'Needs enough artifacts.',
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

    private function insertArchetypeSignal(string $id, string $oracleId, string $archetype): int
    {
        return $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_archetype_signal (
    id,
    oracle_id,
    archetype,
    weight,
    source,
    evidence,
    updated_at
) VALUES (
    :id,
    :oracle_id,
    :archetype,
    5,
    'test',
    'fixture',
    NOW()
)
SQL,
            [
                'id' => $id,
                'oracle_id' => $oracleId,
                'archetype' => $archetype,
            ],
        );
    }

    private function insertPowerFlag(string $id, string $oracleId, string $flag): int
    {
        return $this->entityManager->getConnection()->executeStatement(
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
    5,
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
