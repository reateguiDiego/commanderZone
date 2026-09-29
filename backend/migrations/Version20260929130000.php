<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260929130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Reduce moderation evidence to reviewer-relevant historical chat and game-log fields.';
    }

    public function up(Schema $schema): void
    {
        // Freeze the chat sender name at send time. Evidence must not depend on
        // a later account rename (or on a user record that may be deleted).
        $this->addSql('ALTER TABLE game_chat_message ADD COLUMN actor_display_name VARCHAR(120) DEFAULT NULL');
        $this->addSql(<<<'SQL'
UPDATE game_chat_message message
SET actor_display_name = user_row.display_name
FROM app_user user_row
WHERE user_row.id = message.actor_id
SQL);
        // The actor relation is required, but retain a deterministic fallback
        // for any legacy row that predates that constraint.
        $this->addSql("UPDATE game_chat_message SET actor_display_name = 'Unknown player' WHERE actor_display_name IS NULL");
        $this->addSql('ALTER TABLE game_chat_message ALTER COLUMN actor_display_name SET NOT NULL');

        // A game evidence snapshot is a lightweight capture marker. Reviewer
        // content is deliberately held in the immutable child rows below.
        $this->addSql('ALTER TABLE game_moderation_evidence_snapshot DROP COLUMN finished_at');
        $this->addSql('ALTER TABLE game_moderation_evidence_snapshot DROP COLUMN metadata');

        // Keep only the immutable chat evidence a reviewer can read. Source
        // IDs remain internal idempotency/order keys and are not exposed.
        $this->addSql('ALTER TABLE game_moderation_evidence_chat_message DROP COLUMN actor_id');
        $this->addSql('ALTER TABLE game_moderation_evidence_chat_message DROP COLUMN reactions');
        $this->addSql('ALTER TABLE game_moderation_evidence_chat_message DROP COLUMN target_player_id');
        $this->addSql('ALTER TABLE game_moderation_evidence_chat_message DROP COLUMN target_display_name');

        // The normalized action text is all moderation needs from the game
        // log. Preserve a historical actor label when it was already captured.
        $this->addSql('ALTER TABLE game_moderation_evidence_log_entry ADD COLUMN actor_display_name VARCHAR(120) DEFAULT NULL');
        $this->addSql(<<<'SQL'
UPDATE game_moderation_evidence_log_entry
SET actor_display_name = NULLIF(BTRIM(metadata->>'actorDisplayName'), '')
WHERE metadata->>'actorDisplayName' IS NOT NULL
SQL);
        $this->addSql('ALTER TABLE game_moderation_evidence_log_entry DROP COLUMN type');
        $this->addSql('ALTER TABLE game_moderation_evidence_log_entry DROP COLUMN metadata');
    }

    public function down(Schema $schema): void
    {
        // The removed fields cannot be reconstructed perfectly after a
        // reduced capture. Restore the previous schema with safe neutral
        // values so a rollback remains executable on populated databases.
        $this->addSql('ALTER TABLE game_moderation_evidence_snapshot ADD COLUMN finished_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql("ALTER TABLE game_moderation_evidence_snapshot ADD COLUMN metadata JSON NOT NULL DEFAULT '{}'::json");
        $this->addSql('ALTER TABLE game_moderation_evidence_snapshot ALTER COLUMN metadata DROP DEFAULT');

        $this->addSql('ALTER TABLE game_moderation_evidence_chat_message ADD COLUMN actor_id VARCHAR(36) DEFAULT NULL');
        $this->addSql("ALTER TABLE game_moderation_evidence_chat_message ADD COLUMN reactions JSON NOT NULL DEFAULT '{}'::json");
        $this->addSql('ALTER TABLE game_moderation_evidence_chat_message ALTER COLUMN reactions DROP DEFAULT');
        $this->addSql('ALTER TABLE game_moderation_evidence_chat_message ADD COLUMN target_player_id VARCHAR(36) DEFAULT NULL');
        $this->addSql('ALTER TABLE game_moderation_evidence_chat_message ADD COLUMN target_display_name VARCHAR(120) DEFAULT NULL');
        $this->addSql(<<<'SQL'
UPDATE game_moderation_evidence_chat_message evidence
SET actor_id = source.actor_id
FROM game_moderation_evidence_snapshot snapshot,
     game_chat_message source
WHERE evidence.snapshot_id = snapshot.id
  AND source.game_id = snapshot.game_id
  AND source.message_id = evidence.source_message_id
SQL);
        $this->addSql("UPDATE game_moderation_evidence_chat_message SET actor_id = '' WHERE actor_id IS NULL");
        $this->addSql('ALTER TABLE game_moderation_evidence_chat_message ALTER COLUMN actor_id SET NOT NULL');

        $this->addSql("ALTER TABLE game_moderation_evidence_log_entry ADD COLUMN type VARCHAR(80) NOT NULL DEFAULT 'moderation'");
        $this->addSql('ALTER TABLE game_moderation_evidence_log_entry ALTER COLUMN type DROP DEFAULT');
        $this->addSql("ALTER TABLE game_moderation_evidence_log_entry ADD COLUMN metadata JSON NOT NULL DEFAULT '{}'::json");
        $this->addSql(<<<'SQL'
UPDATE game_moderation_evidence_log_entry
SET metadata = json_build_object('actorDisplayName', actor_display_name)::json
WHERE actor_display_name IS NOT NULL
SQL);
        $this->addSql('ALTER TABLE game_moderation_evidence_log_entry ALTER COLUMN metadata DROP DEFAULT');
        $this->addSql('ALTER TABLE game_moderation_evidence_log_entry DROP COLUMN actor_display_name');

        $this->addSql('ALTER TABLE game_chat_message DROP COLUMN actor_display_name');
    }
}
