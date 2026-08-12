<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260812140000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add the durable, retryable runtime-stop outbox for lifecycle workers.';
    }

    public function up(Schema $schema): void
    {
        // No foreign key: the producer commits this row in the same
        // transaction that deletes game, and a stale runtime still needs its
        // stop command after the aggregate has gone.
        $this->addSql(<<<'SQL'
CREATE TABLE game_runtime_stop_queue (
    game_id VARCHAR(36) NOT NULL,
    queued_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    available_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    PRIMARY KEY(game_id)
)
SQL);
        $this->addSql('CREATE INDEX idx_game_runtime_stop_queue_available_at ON game_runtime_stop_queue (available_at, queued_at)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE game_runtime_stop_queue');
    }
}
