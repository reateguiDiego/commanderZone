<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260812130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add a durable, cross-runtime lifecycle closing fence.';
    }

    public function up(Schema $schema): void
    {
        // This flag lives on the parent row so Postgres' existing FK/key-share
        // coordination serializes a final claim with an in-flight append.
        // It is not a gameplay version and is never projected to clients.
        $this->addSql('ALTER TABLE game ADD COLUMN IF NOT EXISTS runtime_closing BOOLEAN NOT NULL DEFAULT FALSE');
        // No foreign key by design: this fence must remain readable by a
        // runtime while Symfony deletes the game row, and must not participate
        // in the snapshot FK lock cycle that it prevents.
        $this->addSql(<<<'SQL'
CREATE TABLE IF NOT EXISTS game_runtime_closing (
    game_id VARCHAR(36) NOT NULL,
    claimed_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY(game_id)
)
SQL);
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS game_runtime_closing');
        $this->addSql('ALTER TABLE game DROP COLUMN IF EXISTS runtime_closing');
    }
}
