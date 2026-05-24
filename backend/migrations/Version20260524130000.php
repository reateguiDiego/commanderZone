<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260524130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create persistent debug health storage for gameplay websocket diagnostics.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("CREATE TABLE game_debug_health (game_id VARCHAR(36) NOT NULL, payload JSON NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY(game_id))");
        $this->addSql('CREATE INDEX idx_game_debug_health_updated_at ON game_debug_health (updated_at)');
        $this->addSql('ALTER TABLE game_debug_health ADD CONSTRAINT FK_GAME_DEBUG_HEALTH_GAME FOREIGN KEY (game_id) REFERENCES game (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE game_debug_health DROP CONSTRAINT FK_GAME_DEBUG_HEALTH_GAME');
        $this->addSql('DROP TABLE game_debug_health');
    }
}
