<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260514153000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add card face_stats and standardized updated_at columns across core domain and auth tables.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE card ADD COLUMN IF NOT EXISTS face_stats JSON NOT NULL DEFAULT '{\"root\":{\"power\":null,\"toughness\":null,\"loyalty\":null,\"defense\":null,\"handModifier\":null,\"lifeModifier\":null},\"faces\":[]}'");
        $this->addSql("UPDATE card SET face_stats = jsonb_build_object(
            'root', jsonb_build_object(
                'power', power,
                'toughness', toughness,
                'loyalty', loyalty,
                'defense', NULL,
                'handModifier', NULL,
                'lifeModifier', NULL
            ),
            'faces', COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'name', face->>'name',
                            'power', face->>'power',
                            'toughness', face->>'toughness',
                            'loyalty', face->>'loyalty',
                            'defense', face->>'defense',
                            'handModifier', face->>'hand_modifier',
                            'lifeModifier', face->>'life_modifier'
                        )
                    )
                    FROM jsonb_array_elements(COALESCE(card_faces::jsonb, '[]'::jsonb)) AS face
                ),
                '[]'::jsonb
            )
        )::json");
        $this->addSql('ALTER TABLE card ALTER COLUMN face_stats DROP DEFAULT');

        $this->addSql('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('UPDATE app_user SET updated_at = created_at WHERE updated_at IS NULL');
        $this->addSql('ALTER TABLE app_user ALTER COLUMN updated_at SET NOT NULL');

        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql("UPDATE card SET updated_at = NOW() WHERE updated_at IS NULL");
        $this->addSql('ALTER TABLE card ALTER COLUMN updated_at SET NOT NULL');

        $this->addSql('ALTER TABLE deck_card ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql("UPDATE deck_card SET updated_at = NOW() WHERE updated_at IS NULL");
        $this->addSql('ALTER TABLE deck_card ALTER COLUMN updated_at SET NOT NULL');

        $this->addSql('ALTER TABLE room ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('UPDATE room SET updated_at = created_at WHERE updated_at IS NULL');
        $this->addSql('ALTER TABLE room ALTER COLUMN updated_at SET NOT NULL');

        $this->addSql('ALTER TABLE room_player ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('UPDATE room_player SET updated_at = joined_at WHERE updated_at IS NULL');
        $this->addSql('ALTER TABLE room_player ALTER COLUMN updated_at SET NOT NULL');

        $this->addSql('ALTER TABLE game ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('UPDATE game SET updated_at = created_at WHERE updated_at IS NULL');
        $this->addSql('ALTER TABLE game ALTER COLUMN updated_at SET NOT NULL');

        $this->addSql('ALTER TABLE game_event ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('UPDATE game_event SET updated_at = created_at WHERE updated_at IS NULL');
        $this->addSql('ALTER TABLE game_event ALTER COLUMN updated_at SET NOT NULL');

        $this->addSql('ALTER TABLE password_reset_token ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('UPDATE password_reset_token SET updated_at = created_at WHERE updated_at IS NULL');
        $this->addSql('ALTER TABLE password_reset_token ALTER COLUMN updated_at SET NOT NULL');

        $this->addSql('ALTER TABLE email_verification_token ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('UPDATE email_verification_token SET updated_at = created_at WHERE updated_at IS NULL');
        $this->addSql('ALTER TABLE email_verification_token ALTER COLUMN updated_at SET NOT NULL');

        $this->addSql('ALTER TABLE login_attempt ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('UPDATE login_attempt SET updated_at = COALESCE(last_failed_at, NOW()) WHERE updated_at IS NULL');
        $this->addSql('ALTER TABLE login_attempt ALTER COLUMN updated_at SET NOT NULL');

        $this->addSql('ALTER TABLE auth_request_throttle ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('UPDATE auth_request_throttle SET updated_at = window_started_at WHERE updated_at IS NULL');
        $this->addSql('ALTER TABLE auth_request_throttle ALTER COLUMN updated_at SET NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE auth_request_throttle DROP COLUMN IF EXISTS updated_at');
        $this->addSql('ALTER TABLE login_attempt DROP COLUMN IF EXISTS updated_at');
        $this->addSql('ALTER TABLE email_verification_token DROP COLUMN IF EXISTS updated_at');
        $this->addSql('ALTER TABLE password_reset_token DROP COLUMN IF EXISTS updated_at');
        $this->addSql('ALTER TABLE game_event DROP COLUMN IF EXISTS updated_at');
        $this->addSql('ALTER TABLE game DROP COLUMN IF EXISTS updated_at');
        $this->addSql('ALTER TABLE room_player DROP COLUMN IF EXISTS updated_at');
        $this->addSql('ALTER TABLE room DROP COLUMN IF EXISTS updated_at');
        $this->addSql('ALTER TABLE deck_card DROP COLUMN IF EXISTS updated_at');
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS updated_at');
        $this->addSql('ALTER TABLE app_user DROP COLUMN IF EXISTS updated_at');
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS face_stats');
    }
}

