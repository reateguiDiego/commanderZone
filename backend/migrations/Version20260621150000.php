<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260621150000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Extract gameplay chat and game log from snapshots into dedicated stream tables.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(<<<'SQL'
CREATE TABLE game_chat_message (
    message_id VARCHAR(36) NOT NULL,
    game_id VARCHAR(36) NOT NULL,
    actor_id VARCHAR(36) NOT NULL,
    body VARCHAR(800) NOT NULL,
    reactions JSON NOT NULL,
    target_player_id VARCHAR(36) DEFAULT NULL,
    target_display_name VARCHAR(120) DEFAULT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY(message_id)
)
SQL);
        $this->addSql('CREATE INDEX idx_game_chat_game_created_at ON game_chat_message (game_id, created_at)');
        $this->addSql('CREATE INDEX idx_game_chat_game_message ON game_chat_message (game_id, message_id)');
        $this->addSql('ALTER TABLE game_chat_message ADD CONSTRAINT FK_GAME_CHAT_GAME FOREIGN KEY (game_id) REFERENCES game (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE game_chat_message ADD CONSTRAINT FK_GAME_CHAT_ACTOR FOREIGN KEY (actor_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');

        $this->addSql(<<<'SQL'
CREATE TABLE game_log_entry (
    id VARCHAR(36) NOT NULL,
    game_id VARCHAR(36) NOT NULL,
    version INT NOT NULL,
    type VARCHAR(80) NOT NULL,
    text VARCHAR(1000) NOT NULL,
    metadata JSON NOT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY(id)
)
SQL);
        $this->addSql('CREATE INDEX idx_game_log_game_version ON game_log_entry (game_id, version)');
        $this->addSql('CREATE INDEX idx_game_log_game_created_at ON game_log_entry (game_id, created_at)');
        $this->addSql('ALTER TABLE game_log_entry ADD CONSTRAINT FK_GAME_LOG_GAME FOREIGN KEY (game_id) REFERENCES game (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');

        $this->addSql(<<<'SQL'
INSERT INTO game_chat_message (message_id, game_id, actor_id, body, reactions, target_player_id, target_display_name, created_at, updated_at)
SELECT
    COALESCE(NULLIF(entry->>'id', ''), substr(md5(game.id || '-' || ordinality::text || '-chat'), 1, 36)) AS message_id,
    game.id,
    entry->>'userId' AS actor_id,
    left(COALESCE(entry->>'message', ''), 800) AS body,
    COALESCE((entry->'reactions')::json, '{}'::json) AS reactions,
    NULLIF(entry->>'targetPlayerId', '') AS target_player_id,
    NULLIF(entry->>'targetDisplayName', '') AS target_display_name,
    COALESCE(NULLIF(entry->>'createdAt', ''), game.created_at::text)::timestamp(0) without time zone AS created_at,
    COALESCE(NULLIF(entry->>'createdAt', ''), game.created_at::text)::timestamp(0) without time zone AS updated_at
FROM game,
LATERAL jsonb_array_elements(COALESCE(game.snapshot::jsonb->'chat', '[]'::jsonb)) WITH ORDINALITY AS chat(entry, ordinality)
WHERE COALESCE(entry->>'userId', '') <> ''
SQL);

        $this->addSql(<<<'SQL'
INSERT INTO game_log_entry (id, game_id, version, type, text, metadata, created_at)
SELECT
    COALESCE(NULLIF(entry->>'id', ''), substr(md5(game.id || '-' || ordinality::text || '-log'), 1, 36)) AS id,
    game.id,
    COALESCE(NULLIF(entry->>'version', ''), NULLIF(game.snapshot::jsonb->>'version', ''))::int,
    COALESCE(entry->>'type', 'game.log') AS type,
    left(COALESCE(entry->>'message', ''), 1000) AS text,
    (entry - 'id' - 'type' - 'message' - 'createdAt' - 'version')::json AS metadata,
    COALESCE(NULLIF(entry->>'createdAt', ''), game.created_at::text)::timestamp(0) without time zone AS created_at
FROM game,
LATERAL jsonb_array_elements(COALESCE(game.snapshot::jsonb->'eventLog', '[]'::jsonb)) WITH ORDINALITY AS log(entry, ordinality)
WHERE COALESCE(entry->>'message', '') <> ''
SQL);
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE game_log_entry DROP CONSTRAINT FK_GAME_LOG_GAME');
        $this->addSql('DROP TABLE game_log_entry');
        $this->addSql('ALTER TABLE game_chat_message DROP CONSTRAINT FK_GAME_CHAT_ACTOR');
        $this->addSql('ALTER TABLE game_chat_message DROP CONSTRAINT FK_GAME_CHAT_GAME');
        $this->addSql('DROP TABLE game_chat_message');
    }
}
