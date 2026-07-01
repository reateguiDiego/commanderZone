<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260701120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Normalize user roles and add premium tier.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE app_role (
    code VARCHAR(32) NOT NULL,
    label VARCHAR(80) NOT NULL,
    PRIMARY KEY(code)
)
SQL,
        );
        $this->addSql(
            <<<'SQL'
INSERT INTO app_role (code, label) VALUES
    ('ROLE_USER', 'User'),
    ('ROLE_ADMIN', 'Admin'),
    ('ROLE_OWNER', 'Owner')
SQL,
        );

        $this->addSql(
            <<<'SQL'
CREATE TABLE app_user_role (
    user_id VARCHAR(36) NOT NULL,
    role_code VARCHAR(32) NOT NULL,
    PRIMARY KEY(user_id, role_code)
)
SQL,
        );
        $this->addSql('CREATE INDEX IDX_APP_USER_ROLE_USER ON app_user_role (user_id)');
        $this->addSql('CREATE INDEX IDX_APP_USER_ROLE_ROLE ON app_user_role (role_code)');
        $this->addSql('ALTER TABLE app_user_role ADD CONSTRAINT FK_APP_USER_ROLE_USER FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE app_user_role ADD CONSTRAINT FK_APP_USER_ROLE_ROLE FOREIGN KEY (role_code) REFERENCES app_role (code) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');

        $this->addSql(
            <<<'SQL'
INSERT INTO app_user_role (user_id, role_code)
SELECT DISTINCT app_user.id, role.value
FROM app_user
CROSS JOIN LATERAL json_array_elements_text(app_user.roles) AS role(value)
JOIN app_role ON app_role.code = role.value
ON CONFLICT DO NOTHING
SQL,
        );
        $this->addSql(
            <<<'SQL'
INSERT INTO app_user_role (user_id, role_code)
SELECT id, 'ROLE_USER'
FROM app_user
ON CONFLICT DO NOTHING
SQL,
        );
        $this->addSql("CREATE UNIQUE INDEX uniq_single_owner ON app_user_role (role_code) WHERE role_code = 'ROLE_OWNER'");

        $this->addSql("ALTER TABLE app_user ADD premium_tier VARCHAR(16) DEFAULT 'none' NOT NULL");
        $this->addSql("ALTER TABLE app_user ADD CONSTRAINT chk_app_user_premium_tier CHECK (premium_tier IN ('none', 'tier1', 'tier2', 'tier3'))");
        $this->addSql('ALTER TABLE app_user DROP COLUMN roles');
    }

    public function down(Schema $schema): void
    {
        $this->addSql("ALTER TABLE app_user ADD roles JSON DEFAULT '[\"ROLE_USER\"]' NOT NULL");
        $this->addSql(
            <<<'SQL'
UPDATE app_user
SET roles = role_payload.roles
FROM (
    SELECT
        user_id,
        json_agg(role_code ORDER BY role_code) AS roles
    FROM app_user_role
    GROUP BY user_id
) AS role_payload
WHERE app_user.id = role_payload.user_id
SQL,
        );
        $this->addSql('ALTER TABLE app_user ALTER COLUMN roles DROP DEFAULT');
        $this->addSql('ALTER TABLE app_user DROP CONSTRAINT chk_app_user_premium_tier');
        $this->addSql('ALTER TABLE app_user DROP COLUMN premium_tier');
        $this->addSql('DROP TABLE app_user_role');
        $this->addSql('DROP TABLE app_role');
    }
}
