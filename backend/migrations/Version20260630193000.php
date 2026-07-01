<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260630193000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add Postgres gameplay runtime ownership lease table.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(<<<'SQL'
CREATE TABLE IF NOT EXISTS game_runtime_lease (
    game_id VARCHAR(36) NOT NULL,
    owner_instance_id VARCHAR(120) NOT NULL,
    fencing_token BIGINT NOT NULL,
    expires_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    updated_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY(game_id)
)
SQL);
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_game_runtime_lease_owner ON game_runtime_lease (owner_instance_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_game_runtime_lease_expires_at ON game_runtime_lease (expires_at)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS game_runtime_lease');
    }
}
