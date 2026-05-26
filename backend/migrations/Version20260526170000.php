<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260526170000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add app/card language preferences to app_user.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE app_user ADD card_language VARCHAR(8) DEFAULT 'en' NOT NULL");
        $this->addSql("ALTER TABLE app_user ADD app_language VARCHAR(8) DEFAULT 'en' NOT NULL");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user DROP card_language');
        $this->addSql('ALTER TABLE app_user DROP app_language');
    }
}
