<?php

namespace App\Tests\Integration;

use Doctrine\DBAL\Exception\UniqueConstraintViolationException;

final class SpellbookSchemaTest extends ApiTestCase
{
    public function testSpellbookTablesExist(): void
    {
        $schemaManager = $this->entityManager->getConnection()->createSchemaManager();

        self::assertTrue($schemaManager->tablesExist(['spellbook_combo_variant']));
        self::assertTrue($schemaManager->tablesExist(['spellbook_combo_card']));
        self::assertTrue($schemaManager->tablesExist(['spellbook_feature']));
        self::assertTrue($schemaManager->tablesExist(['spellbook_combo_feature']));
        self::assertTrue($schemaManager->tablesExist(['spellbook_template']));
        self::assertTrue($schemaManager->tablesExist(['spellbook_combo_requirement']));
    }

    public function testExternalIdConstraintsPreventDuplicates(): void
    {
        $this->insertComboVariant('86000000-0000-0000-0000-000000000001', 'variant-1');
        $this->assertDuplicateRejected(fn (): int => $this->insertComboVariant('86000000-0000-0000-0000-000000000002', 'variant-1'));

        $this->insertFeature('86000000-0000-0000-0000-000000000011', 'feature-1');
        $this->assertDuplicateRejected(fn (): int => $this->insertFeature('86000000-0000-0000-0000-000000000012', 'feature-1'));

        $this->insertTemplate('86000000-0000-0000-0000-000000000021', 'template-1');
        $this->assertDuplicateRejected(fn (): int => $this->insertTemplate('86000000-0000-0000-0000-000000000022', 'template-1'));
    }

    public function testComboFeatureRelationDoesNotDuplicate(): void
    {
        $comboVariantId = '86000000-0000-0000-0000-000000000031';
        $featureId = '86000000-0000-0000-0000-000000000032';
        $this->insertComboVariant($comboVariantId, 'variant-relation');
        $this->insertFeature($featureId, 'feature-relation');

        $this->insertComboFeature($comboVariantId, $featureId);

        $this->assertDuplicateRejected(fn (): int => $this->insertComboFeature($comboVariantId, $featureId));
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

    private function insertComboVariant(string $id, string $externalId): int
    {
        return $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO spellbook_combo_variant (
    id,
    external_id,
    identity,
    source_hash,
    synced_at
) VALUES (
    :id,
    :external_id,
    '["W"]',
    :source_hash,
    NOW()
)
SQL,
            [
                'id' => $id,
                'external_id' => $externalId,
                'source_hash' => hash('sha256', $externalId),
            ],
        );
    }

    private function insertFeature(string $id, string $externalId): int
    {
        return $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO spellbook_feature (
    id,
    external_id,
    name,
    normalized_name
) VALUES (
    :id,
    :external_id,
    :name,
    :normalized_name
)
SQL,
            [
                'id' => $id,
                'external_id' => $externalId,
                'name' => 'Fixture Feature',
                'normalized_name' => 'fixture feature',
            ],
        );
    }

    private function insertTemplate(string $id, string $externalId): int
    {
        return $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO spellbook_template (
    id,
    external_id,
    name
) VALUES (
    :id,
    :external_id,
    :name
)
SQL,
            [
                'id' => $id,
                'external_id' => $externalId,
                'name' => 'Fixture Template',
            ],
        );
    }

    private function insertComboFeature(string $comboVariantId, string $featureId): int
    {
        return $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO spellbook_combo_feature (
    combo_variant_id,
    feature_id,
    quantity
) VALUES (
    :combo_variant_id,
    :feature_id,
    1
)
SQL,
            [
                'combo_variant_id' => $comboVariantId,
                'feature_id' => $featureId,
            ],
        );
    }
}
