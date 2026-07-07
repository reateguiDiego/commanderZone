<?php

namespace App\Tests\Integration;

use App\Application\Deck\ComboAnalysisProfileRebuilder;
use Doctrine\DBAL\ParameterType;

final class ComboAnalysisProfileRebuilderTest extends ApiTestCase
{
    public function testWinTheGameFeatureMarksProducesWin(): void
    {
        $comboId = '87000000-0000-0000-0000-000000000001';
        $featureId = '87000000-0000-0000-0000-000000000011';
        $this->insertVariant($comboId, 'combo-win');
        $this->insertCard($comboId, '87000000-0000-0000-0000-000000000101');
        $this->insertFeature($featureId, 'feature-win', 'win_game');
        $this->insertComboFeature($comboId, $featureId);

        $this->rebuilder()->rebuild();

        $profile = $this->profile($comboId);
        self::assertTrue($profile['produces_win']);
        self::assertSame(['win_game'], $profile['features']);
        self::assertSame(50, (int) $profile['combo_power_score']);
    }

    public function testInfiniteManaFeatureMarksProducesInfiniteMana(): void
    {
        $comboId = '87000000-0000-0000-0000-000000000002';
        $featureId = '87000000-0000-0000-0000-000000000012';
        $this->insertVariant($comboId, 'combo-mana', ['bracket_tag' => 'R']);
        $this->insertCard($comboId, '87000000-0000-0000-0000-000000000102');
        $this->insertFeature($featureId, 'feature-mana', 'infinite_mana');
        $this->insertComboFeature($comboId, $featureId);

        $this->rebuilder()->rebuild();

        $profile = $this->profile($comboId);
        self::assertTrue($profile['produces_infinite_mana']);
        self::assertFalse($profile['produces_win']);
        self::assertSame(25, (int) $profile['combo_power_score']);
    }

    public function testTemplateRequirementMarksRequiresTemplate(): void
    {
        $comboId = '87000000-0000-0000-0000-000000000003';
        $templateId = '87000000-0000-0000-0000-000000000013';
        $this->insertVariant($comboId, 'combo-template');
        $this->insertCard($comboId, '87000000-0000-0000-0000-000000000103');
        $this->insertTemplate($templateId, 'template-1');
        $this->insertRequirement($comboId, $templateId);

        $this->rebuilder()->rebuild();

        $profile = $this->profile($comboId);
        self::assertTrue($profile['requires_template']);
        self::assertSame(2, (int) $profile['combo_size']);
        self::assertSame(65, (int) $profile['combo_complexity_score']);
    }

    public function testMustBeCommanderMarksRequiresCommander(): void
    {
        $comboId = '87000000-0000-0000-0000-000000000004';
        $this->insertVariant($comboId, 'combo-commander');
        $this->insertCard($comboId, '87000000-0000-0000-0000-000000000104', mustBeCommander: true);

        $this->rebuilder()->rebuild();

        $profile = $this->profile($comboId);
        self::assertTrue($profile['requires_commander']);
        self::assertSame(65, (int) $profile['combo_complexity_score']);
    }

    public function testLethalLifeLoopIsMarkedAsWinLikeFeatureWithHigherPowerScore(): void
    {
        $comboId = '87000000-0000-0000-0000-000000000006';
        $this->insertVariant($comboId, 'combo-lethal-loop', ['bracket_tag' => null]);
        $this->insertCard($comboId, '87000000-0000-0000-0000-000000000106', name: 'Exquisite Blood');
        $this->insertCard($comboId, '87000000-0000-0000-0000-000000000107', name: 'Sanguine Bond');

        $this->rebuilder()->rebuild();

        $profile = $this->profile($comboId);
        self::assertContains('lethal_loop', $profile['features']);
        self::assertFalse($profile['produces_win']);
        self::assertGreaterThanOrEqual(35, (int) $profile['combo_power_score']);
    }

    public function testRebuildDoesNotDuplicateOrUpdateWhenHashIsUnchanged(): void
    {
        $comboId = '87000000-0000-0000-0000-000000000005';
        $this->insertVariant($comboId, 'combo-stable');
        $this->insertCard($comboId, '87000000-0000-0000-0000-000000000105');

        $first = $this->rebuilder()->rebuild();
        self::assertSame(['seen' => 1, 'inserted' => 1, 'updated' => 0, 'skipped' => 0], $first);

        $this->entityManager->getConnection()->executeStatement(
            "UPDATE combo_analysis_profile SET updated_at = TIMESTAMP '2000-01-01 00:00:00' WHERE combo_variant_id = :id",
            ['id' => $comboId],
        );
        $second = $this->rebuilder()->rebuild();

        self::assertSame(['seen' => 1, 'inserted' => 0, 'updated' => 0, 'skipped' => 1], $second);
        self::assertSame('1', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM combo_analysis_profile'));
        self::assertSame(
            '2000-01-01 00:00:00',
            $this->entityManager->getConnection()->fetchOne(
                "SELECT to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS') FROM combo_analysis_profile WHERE combo_variant_id = :id",
                ['id' => $comboId],
            ),
        );
    }

    private function rebuilder(): ComboAnalysisProfileRebuilder
    {
        return new ComboAnalysisProfileRebuilder($this->entityManager->getConnection());
    }

    /**
     * @param array<string,mixed> $overrides
     */
    private function insertVariant(string $id, string $externalId, array $overrides = []): void
    {
        $row = array_replace([
            'id' => $id,
            'external_id' => $externalId,
            'identity' => ['U'],
            'status' => 'OK',
            'popularity' => 100,
            'bracket_tag' => 'E',
            'source_hash' => hash('sha256', $externalId),
        ], $overrides);

        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO spellbook_combo_variant (
    id,
    external_id,
    identity,
    status,
    popularity,
    bracket_tag,
    source_hash,
    synced_at
) VALUES (
    :id,
    :external_id,
    :identity,
    :status,
    :popularity,
    :bracket_tag,
    :source_hash,
    NOW()
)
SQL,
            [
                ...$row,
                'identity' => json_encode($row['identity'], JSON_THROW_ON_ERROR),
            ],
        );
    }

    private function insertCard(string $comboId, string $oracleId, bool $mustBeCommander = false, string $name = 'Fixture Card'): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO spellbook_combo_card (
    id,
    combo_variant_id,
    oracle_id,
    name,
    quantity,
    zone_locations,
    must_be_commander
) VALUES (
    :id,
    :combo_variant_id,
    :oracle_id,
    :name,
    1,
    '["B"]',
    :must_be_commander
)
SQL,
            [
                'id' => str_replace('00000000010', '00000000020', $oracleId),
                'combo_variant_id' => $comboId,
                'oracle_id' => $oracleId,
                'name' => $name,
                'must_be_commander' => $mustBeCommander,
            ],
            ['must_be_commander' => ParameterType::BOOLEAN],
        );
    }

    private function insertFeature(string $id, string $externalId, string $featureType): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO spellbook_feature (
    id,
    external_id,
    name,
    normalized_name,
    feature_type
) VALUES (
    :id,
    :external_id,
    'Fixture Feature',
    'fixture feature',
    :feature_type
)
SQL,
            [
                'id' => $id,
                'external_id' => $externalId,
                'feature_type' => $featureType,
            ],
        );
    }

    private function insertComboFeature(string $comboId, string $featureId): void
    {
        $this->entityManager->getConnection()->executeStatement(
            'INSERT INTO spellbook_combo_feature (combo_variant_id, feature_id, quantity) VALUES (:combo_id, :feature_id, 1)',
            [
                'combo_id' => $comboId,
                'feature_id' => $featureId,
            ],
        );
    }

    private function insertTemplate(string $id, string $externalId): void
    {
        $this->entityManager->getConnection()->executeStatement(
            'INSERT INTO spellbook_template (id, external_id, name) VALUES (:id, :external_id, :name)',
            [
                'id' => $id,
                'external_id' => $externalId,
                'name' => 'Fixture Template',
            ],
        );
    }

    private function insertRequirement(string $comboId, string $templateId): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO spellbook_combo_requirement (
    id,
    combo_variant_id,
    template_id,
    quantity,
    zone_locations
) VALUES (
    :id,
    :combo_variant_id,
    :template_id,
    1,
    '["H"]'
)
SQL,
            [
                'id' => '87000000-0000-0000-0000-000000000033',
                'combo_variant_id' => $comboId,
                'template_id' => $templateId,
            ],
        );
    }

    /**
     * @return array<string,mixed>
     */
    private function profile(string $comboId): array
    {
        $profile = $this->entityManager->getConnection()->fetchAssociative(
            'SELECT * FROM combo_analysis_profile WHERE combo_variant_id = :id',
            ['id' => $comboId],
        );
        self::assertIsArray($profile);

        foreach (['required_oracle_ids', 'identity', 'features'] as $jsonColumn) {
            $profile[$jsonColumn] = json_decode((string) $profile[$jsonColumn], true, flags: JSON_THROW_ON_ERROR);
        }

        foreach ([
            'produces_win',
            'produces_infinite_mana',
            'requires_commander',
            'requires_template',
        ] as $booleanColumn) {
            $profile[$booleanColumn] = in_array($profile[$booleanColumn], [true, 1, '1', 't', 'true'], true);
        }

        return $profile;
    }
}
