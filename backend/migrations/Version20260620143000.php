<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260620143000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Persist the selected user theme.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE app_user ADD theme_id VARCHAR(48) DEFAULT 'sunrise' NOT NULL");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user DROP theme_id');
    }
}
