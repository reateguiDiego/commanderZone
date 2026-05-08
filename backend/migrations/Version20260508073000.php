<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260508073000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add timer configuration to Commander waiting rooms.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE room ADD COLUMN IF NOT EXISTS timer_mode VARCHAR(12) DEFAULT 'none'");
        $this->addSql('ALTER TABLE room ADD COLUMN IF NOT EXISTS timer_duration_seconds INT DEFAULT 300');
        $this->addSql("UPDATE room SET timer_mode = 'none' WHERE timer_mode IS NULL OR timer_mode NOT IN ('none', 'turn')");
        $this->addSql('UPDATE room SET timer_duration_seconds = 300 WHERE timer_duration_seconds IS NULL');
        $this->addSql('UPDATE room SET timer_duration_seconds = 30 WHERE timer_duration_seconds < 30');
        $this->addSql('UPDATE room SET timer_duration_seconds = 1800 WHERE timer_duration_seconds > 1800');
        $this->addSql('ALTER TABLE room ALTER COLUMN timer_mode SET NOT NULL');
        $this->addSql('ALTER TABLE room ALTER COLUMN timer_duration_seconds SET NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE room DROP COLUMN IF EXISTS timer_duration_seconds');
        $this->addSql('ALTER TABLE room DROP COLUMN IF EXISTS timer_mode');
    }
}
