<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260929120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add moderation reports, evidence snapshots, strikes, durable queues, and historical user counters.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user ADD COLUMN reports_made_count INT NOT NULL DEFAULT 0');
        $this->addSql('ALTER TABLE app_user ADD COLUMN reports_received_count INT NOT NULL DEFAULT 0');
        $this->addSql('ALTER TABLE app_user ADD COLUMN strikes_count INT NOT NULL DEFAULT 0');

        $this->addSql('ALTER TABLE game ADD COLUMN requires_moderation_review BOOLEAN NOT NULL DEFAULT FALSE');

        $this->addSql('ALTER TABLE user_report RENAME COLUMN reason TO comment');
        $this->addSql('ALTER TABLE user_report ALTER COLUMN comment TYPE TEXT');
        $this->addSql('ALTER TABLE user_report ALTER COLUMN comment DROP NOT NULL');
        $this->addSql("ALTER TABLE user_report ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'legacy'");
        $this->addSql("ALTER TABLE user_report ADD COLUMN category VARCHAR(72) NOT NULL DEFAULT 'other_problem'");
        $this->addSql("ALTER TABLE user_report ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending_review'");
        $this->addSql('ALTER TABLE user_report ADD COLUMN game_id VARCHAR(36) DEFAULT NULL');
        $this->addSql('ALTER TABLE user_report ADD COLUMN original_game_id VARCHAR(36) DEFAULT NULL');
        $this->addSql('ALTER TABLE user_report ADD COLUMN message_id VARCHAR(36) DEFAULT NULL');
        $this->addSql('ALTER TABLE user_report ADD COLUMN reported_user_snapshot JSON DEFAULT NULL');
        $this->addSql('ALTER TABLE user_report ADD COLUMN game_evidence_snapshot_id VARCHAR(36) DEFAULT NULL');
        $this->addSql('ALTER TABLE user_report ADD COLUMN resolution_outcome VARCHAR(32) DEFAULT NULL');
        $this->addSql('ALTER TABLE user_report ADD COLUMN resolution_note TEXT DEFAULT NULL');
        $this->addSql('ALTER TABLE user_report ADD COLUMN resolved_by_id VARCHAR(36) DEFAULT NULL');
        $this->addSql('ALTER TABLE user_report ADD COLUMN resolved_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('ALTER TABLE user_report ADD COLUMN updated_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('UPDATE user_report SET source = \'legacy\', category = \'other_problem\', status = \'pending_review\', updated_at = created_at');
        $this->addSql("UPDATE user_report SET comment = 'Legacy report' WHERE btrim(COALESCE(comment, '')) = ''");

        // Retain the oldest historical report per pair. New partial uniqueness
        // protects all future collecting/pending reports without losing legacy rows.
        $this->addSql(<<<'SQL'
WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY reporter_id, reported_user_id ORDER BY created_at ASC, id ASC) AS position
    FROM user_report
)
UPDATE user_report report
SET status = 'resolved',
    resolution_outcome = 'nothing',
    resolution_note = 'Closed during moderation migration: duplicate legacy report.',
    resolved_at = report.created_at
FROM ranked
WHERE report.id = ranked.id AND ranked.position > 1
SQL);
        // The current owner is never a valid moderation target. Preserve the
        // audit row, but make it closed so it cannot become an inaccessible
        // pending item under the current role policy.
        $this->addSql(<<<'SQL'
UPDATE user_report report
SET status = 'resolved',
    resolution_outcome = 'nothing',
    resolution_note = 'Closed during moderation migration: owners cannot be reported.',
    resolved_at = COALESCE(report.resolved_at, report.created_at)
WHERE report.status <> 'resolved'
  AND EXISTS (
      SELECT 1
      FROM app_user_role role_assignment
      WHERE role_assignment.user_id = report.reported_user_id
        AND role_assignment.role_code = 'ROLE_OWNER'
  )
SQL);
        $this->addSql('ALTER TABLE user_report ALTER COLUMN updated_at SET NOT NULL');

        $this->addSql('ALTER TABLE user_report DROP CONSTRAINT IF EXISTS fk_user_report_reporter');
        $this->addSql('ALTER TABLE user_report DROP CONSTRAINT IF EXISTS fk_user_report_reported_user');
        $this->addSql('ALTER TABLE user_report ALTER COLUMN reporter_id DROP NOT NULL');
        $this->addSql('ALTER TABLE user_report ALTER COLUMN reported_user_id DROP NOT NULL');
        $this->addSql('ALTER TABLE user_report ADD CONSTRAINT fk_user_report_reporter FOREIGN KEY (reporter_id) REFERENCES app_user (id) ON DELETE SET NULL NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE user_report ADD CONSTRAINT fk_user_report_reported_user FOREIGN KEY (reported_user_id) REFERENCES app_user (id) ON DELETE SET NULL NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE user_report ADD CONSTRAINT fk_user_report_game FOREIGN KEY (game_id) REFERENCES game (id) ON DELETE SET NULL NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE user_report ADD CONSTRAINT fk_user_report_resolved_by FOREIGN KEY (resolved_by_id) REFERENCES app_user (id) ON DELETE SET NULL NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql("ALTER TABLE user_report ADD CONSTRAINT chk_user_report_source CHECK (source IN ('profile', 'game_player', 'chat_message', 'legacy'))");
        $this->addSql("ALTER TABLE user_report ADD CONSTRAINT chk_user_report_category CHECK (category IN ('harassment', 'discrimination_or_unwanted_sexual_content', 'threats_or_safety', 'personal_data_exposure', 'spam_advertising_scam_phishing', 'impersonation', 'public_offensive_content', 'intentional_game_disruption', 'serious_gameplay_deception', 'other_problem'))");
        $this->addSql("ALTER TABLE user_report ADD CONSTRAINT chk_user_report_status CHECK (status IN ('collecting_evidence', 'pending_review', 'resolved'))");
        $this->addSql("ALTER TABLE user_report ADD CONSTRAINT chk_user_report_resolution CHECK (resolution_outcome IS NULL OR resolution_outcome IN ('strike', 'nothing'))");
        $this->addSql("ALTER TABLE user_report ADD CONSTRAINT chk_user_report_references CHECK ((source = 'profile' AND original_game_id IS NULL AND message_id IS NULL) OR (source = 'game_player' AND original_game_id IS NOT NULL AND message_id IS NULL) OR (source = 'chat_message' AND original_game_id IS NOT NULL AND message_id IS NOT NULL) OR (source = 'legacy' AND original_game_id IS NULL AND message_id IS NULL))");
        $this->addSql("ALTER TABLE user_report ADD CONSTRAINT chk_user_report_other_comment CHECK (category <> 'other_problem' OR (comment IS NOT NULL AND btrim(comment) <> ''))");
        $this->addSql("CREATE UNIQUE INDEX uniq_open_user_report_pair ON user_report (reporter_id, reported_user_id) WHERE status IN ('collecting_evidence', 'pending_review') AND reporter_id IS NOT NULL AND reported_user_id IS NOT NULL");
        $this->addSql('CREATE INDEX idx_user_report_pending_fifo ON user_report (status, created_at, id)');
        $this->addSql('CREATE INDEX idx_user_report_reporter_status ON user_report (reporter_id, status)');
        $this->addSql('CREATE INDEX idx_user_report_reported_user_status ON user_report (reported_user_id, status)');

        $this->addSql(<<<'SQL'
CREATE TABLE user_strike (
    id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    issued_by_id VARCHAR(36) DEFAULT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY(id)
)
SQL);
        $this->addSql('CREATE INDEX idx_user_strike_user_created ON user_strike (user_id, created_at)');
        $this->addSql('ALTER TABLE user_strike ADD CONSTRAINT fk_user_strike_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE user_strike ADD CONSTRAINT fk_user_strike_issued_by FOREIGN KEY (issued_by_id) REFERENCES app_user (id) ON DELETE SET NULL NOT DEFERRABLE INITIALLY IMMEDIATE');

        $this->addSql(<<<'SQL'
CREATE TABLE game_moderation_evidence_snapshot (
    id VARCHAR(36) NOT NULL,
    game_id VARCHAR(36) NOT NULL,
    status VARCHAR(20) NOT NULL,
    finished_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL,
    captured_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL,
    metadata JSON NOT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY(id)
)
SQL);
        $this->addSql('CREATE UNIQUE INDEX uniq_game_moderation_evidence_game ON game_moderation_evidence_snapshot (game_id)');
        $this->addSql("ALTER TABLE game_moderation_evidence_snapshot ADD CONSTRAINT chk_game_moderation_evidence_status CHECK (status IN ('capturing', 'complete', 'failed'))");
        $this->addSql('ALTER TABLE user_report ADD CONSTRAINT fk_user_report_game_evidence_snapshot FOREIGN KEY (game_evidence_snapshot_id) REFERENCES game_moderation_evidence_snapshot (id) ON DELETE SET NULL NOT DEFERRABLE INITIALLY IMMEDIATE');

        $this->addSql(<<<'SQL'
CREATE TABLE game_moderation_evidence_chat_message (
    id VARCHAR(36) NOT NULL,
    snapshot_id VARCHAR(36) NOT NULL,
    source_message_id VARCHAR(36) NOT NULL,
    actor_id VARCHAR(36) NOT NULL,
    actor_display_name VARCHAR(120) NOT NULL,
    body VARCHAR(800) NOT NULL,
    reactions JSON NOT NULL,
    target_player_id VARCHAR(36) DEFAULT NULL,
    target_display_name VARCHAR(120) DEFAULT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY(id)
)
SQL);
        $this->addSql('CREATE UNIQUE INDEX uniq_game_moderation_evidence_chat_source ON game_moderation_evidence_chat_message (snapshot_id, source_message_id)');
        $this->addSql('ALTER TABLE game_moderation_evidence_chat_message ADD CONSTRAINT fk_game_moderation_evidence_chat_snapshot FOREIGN KEY (snapshot_id) REFERENCES game_moderation_evidence_snapshot (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');

        $this->addSql(<<<'SQL'
CREATE TABLE game_moderation_evidence_log_entry (
    id VARCHAR(36) NOT NULL,
    snapshot_id VARCHAR(36) NOT NULL,
    source_log_entry_id VARCHAR(36) NOT NULL,
    version INT NOT NULL,
    type VARCHAR(80) NOT NULL,
    text VARCHAR(1000) NOT NULL,
    metadata JSON NOT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY(id)
)
SQL);
        $this->addSql('CREATE UNIQUE INDEX uniq_game_moderation_evidence_log_source ON game_moderation_evidence_log_entry (snapshot_id, source_log_entry_id)');
        $this->addSql('ALTER TABLE game_moderation_evidence_log_entry ADD CONSTRAINT fk_game_moderation_evidence_log_snapshot FOREIGN KEY (snapshot_id) REFERENCES game_moderation_evidence_snapshot (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');

        $this->addSql(<<<'SQL'
CREATE TABLE game_moderation_evidence_queue (
    game_id VARCHAR(36) NOT NULL,
    queued_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    available_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempts INT NOT NULL DEFAULT 0,
    PRIMARY KEY(game_id)
)
SQL);
        $this->addSql('CREATE INDEX idx_game_moderation_evidence_queue_available ON game_moderation_evidence_queue (available_at, queued_at)');

        $this->addSql(<<<'SQL'
CREATE TABLE report_profile_evidence_queue (
    report_id VARCHAR(36) NOT NULL,
    queued_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    available_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempts INT NOT NULL DEFAULT 0,
    PRIMARY KEY(report_id)
)
SQL);
        $this->addSql('CREATE INDEX idx_report_profile_evidence_queue_available ON report_profile_evidence_queue (available_at, queued_at)');
        $this->addSql('ALTER TABLE report_profile_evidence_queue ADD CONSTRAINT fk_report_profile_evidence_queue_report FOREIGN KEY (report_id) REFERENCES user_report (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');

        $this->addSql(<<<'SQL'
UPDATE app_user user_row
SET reports_made_count = (SELECT COUNT(*) FROM user_report report WHERE report.reporter_id = user_row.id),
    reports_received_count = (SELECT COUNT(*) FROM user_report report WHERE report.reported_user_id = user_row.id),
    strikes_count = 0
SQL);
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE report_profile_evidence_queue');
        $this->addSql('DROP TABLE game_moderation_evidence_queue');
        $this->addSql('ALTER TABLE user_report DROP CONSTRAINT fk_user_report_game_evidence_snapshot');
        $this->addSql('DROP TABLE game_moderation_evidence_chat_message');
        $this->addSql('DROP TABLE game_moderation_evidence_log_entry');
        $this->addSql('DROP TABLE game_moderation_evidence_snapshot');
        $this->addSql('DROP TABLE user_strike');
        $this->addSql('ALTER TABLE user_report DROP CONSTRAINT fk_user_report_game');
        $this->addSql('ALTER TABLE user_report DROP CONSTRAINT fk_user_report_resolved_by');
        $this->addSql('ALTER TABLE user_report DROP CONSTRAINT fk_user_report_reporter');
        $this->addSql('ALTER TABLE user_report DROP CONSTRAINT fk_user_report_reported_user');
        $this->addSql('ALTER TABLE user_report DROP CONSTRAINT chk_user_report_source');
        $this->addSql('ALTER TABLE user_report DROP CONSTRAINT chk_user_report_category');
        $this->addSql('ALTER TABLE user_report DROP CONSTRAINT chk_user_report_status');
        $this->addSql('ALTER TABLE user_report DROP CONSTRAINT chk_user_report_resolution');
        $this->addSql('ALTER TABLE user_report DROP CONSTRAINT chk_user_report_references');
        $this->addSql('ALTER TABLE user_report DROP CONSTRAINT chk_user_report_other_comment');
        $this->addSql('DROP INDEX uniq_open_user_report_pair');
        $this->addSql('DROP INDEX idx_user_report_pending_fifo');
        $this->addSql('DROP INDEX idx_user_report_reporter_status');
        $this->addSql('DROP INDEX idx_user_report_reported_user_status');
        $this->addSql('ALTER TABLE user_report RENAME COLUMN comment TO reason');
        $this->addSql('ALTER TABLE user_report ALTER COLUMN reason TYPE VARCHAR(255)');
        $this->addSql('ALTER TABLE user_report ALTER COLUMN reason SET NOT NULL');
        $this->addSql('ALTER TABLE user_report DROP COLUMN source, DROP COLUMN category, DROP COLUMN status, DROP COLUMN game_id, DROP COLUMN original_game_id, DROP COLUMN message_id, DROP COLUMN reported_user_snapshot, DROP COLUMN game_evidence_snapshot_id, DROP COLUMN resolution_outcome, DROP COLUMN resolution_note, DROP COLUMN resolved_by_id, DROP COLUMN resolved_at, DROP COLUMN updated_at');
        $this->addSql('ALTER TABLE user_report ALTER COLUMN reporter_id SET NOT NULL');
        $this->addSql('ALTER TABLE user_report ALTER COLUMN reported_user_id SET NOT NULL');
        $this->addSql('ALTER TABLE user_report ADD CONSTRAINT fk_user_report_reporter FOREIGN KEY (reporter_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE user_report ADD CONSTRAINT fk_user_report_reported_user FOREIGN KEY (reported_user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE game DROP COLUMN requires_moderation_review');
        $this->addSql('ALTER TABLE app_user DROP COLUMN reports_made_count, DROP COLUMN reports_received_count, DROP COLUMN strikes_count');
    }
}
