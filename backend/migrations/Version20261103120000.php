<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261103120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Include legendary Vehicles and eligible Spacecraft in the community commander index.';
    }

    public function isTransactional(): bool
    {
        return false;
    }

    public function up(Schema $schema): void
    {
        $this->addSql(<<<'SQL'
CREATE INDEX CONCURRENTLY idx_card_community_commander_artifact_id ON card (id)
WHERE commander_legal = true
  AND ((LOWER(COALESCE(type_line, '')) LIKE '%legendary%'
        AND LOWER(COALESCE(type_line, '')) LIKE '%creature%')
       OR LOWER(COALESCE(oracle_text, '')) LIKE '%can be your commander%'
       OR (LOWER(COALESCE(card_faces->0->>'type_line', card_faces->0->>'typeLine', SPLIT_PART(type_line, '//', 1), '')) ~ '\mlegendary\M'
           AND (LOWER(COALESCE(card_faces->0->>'type_line', card_faces->0->>'typeLine', SPLIT_PART(type_line, '//', 1), '')) ~ '\mvehicle\M'
                OR (LOWER(COALESCE(card_faces->0->>'type_line', card_faces->0->>'typeLine', SPLIT_PART(type_line, '//', 1), '')) ~ '\mspacecraft\M'
                    AND NULLIF(BTRIM(COALESCE(card_faces->0->>'power', power)), '') IS NOT NULL
                    AND NULLIF(BTRIM(COALESCE(card_faces->0->>'toughness', toughness)), '') IS NOT NULL))))
SQL);
        $this->addSql('DROP INDEX CONCURRENTLY idx_card_community_commander_id');
    }

    public function down(Schema $schema): void
    {
        $this->addSql(<<<'SQL'
CREATE INDEX CONCURRENTLY idx_card_community_commander_id ON card (id)
WHERE commander_legal = true AND ((LOWER(COALESCE(type_line, '')) LIKE '%legendary%' AND LOWER(COALESCE(type_line, '')) LIKE '%creature%') OR LOWER(COALESCE(oracle_text, '')) LIKE '%can be your commander%')
SQL);
        $this->addSql('DROP INDEX CONCURRENTLY idx_card_community_commander_artifact_id');
    }
}
