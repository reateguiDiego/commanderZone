<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260913130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Cover community random preview IDs with partial indexes before loading card payloads.';
    }

    public function isTransactional(): bool
    {
        return false;
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE INDEX CONCURRENTLY idx_card_community_legal_id ON card (id) WHERE commander_legal = true');
        $this->addSql(<<<'SQL'
CREATE INDEX CONCURRENTLY idx_card_community_commander_id ON card (id)
WHERE commander_legal = true
  AND ((LOWER(COALESCE(type_line, '')) LIKE '%legendary%'
        AND LOWER(COALESCE(type_line, '')) LIKE '%creature%')
       OR LOWER(COALESCE(oracle_text, '')) LIKE '%can be your commander%')
SQL);
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX CONCURRENTLY idx_card_community_commander_id');
        $this->addSql('DROP INDEX CONCURRENTLY idx_card_community_legal_id');
    }
}
