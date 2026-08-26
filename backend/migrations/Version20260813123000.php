<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260813123000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Persist runtime presence lifecycle handoffs until Symfony acknowledges them.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(<<<'SQL'
CREATE TABLE IF NOT EXISTS game_runtime_lifecycle_outbox (
    event_id VARCHAR(120) NOT NULL PRIMARY KEY,
    game_id VARCHAR(36) NOT NULL,
    type VARCHAR(64) NOT NULL,
    generation INT NOT NULL,
    fencing BIGINT NOT NULL,
    version INT NOT NULL,
    occurred_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    queued_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    available_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    CONSTRAINT chk_game_runtime_lifecycle_outbox_type CHECK (
        type IN ('game.all_players_disconnected', 'game.all_disconnected_cancelled')
    )
)
SQL);
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_game_runtime_lifecycle_outbox_available_at ON game_runtime_lifecycle_outbox (available_at, queued_at)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS game_runtime_lifecycle_outbox');
    }
}
