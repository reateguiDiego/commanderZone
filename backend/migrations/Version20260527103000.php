<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260527103000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add card.image_status to support language fallback away from missing/placeholder prints.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS image_status VARCHAR(32) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS image_status');
    }
}

