<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260704163000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Adds support authorization role.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("INSERT INTO app_role (code, label) VALUES ('ROLE_SUPPORT', 'Support') ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label");
    }

    public function down(Schema $schema): void
    {
        $this->addSql("DELETE FROM app_user_role WHERE role_code = 'ROLE_SUPPORT'");
        $this->addSql("DELETE FROM app_role WHERE code = 'ROLE_SUPPORT'");
    }
}
