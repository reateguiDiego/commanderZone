<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260911120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Index case-insensitive friend substring searches using the existing pg_trgm extension.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        $this->addSql('CREATE INDEX idx_app_user_display_name_trgm ON app_user USING GIN (LOWER(display_name) gin_trgm_ops)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX idx_app_user_display_name_trgm');
    }
}
