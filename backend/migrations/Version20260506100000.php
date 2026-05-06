<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260506100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add room name, max players, and format metadata with Commander-only defaults.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE room ADD COLUMN IF NOT EXISTS name VARCHAR(120) DEFAULT 'Mesa Commander'");
        $this->addSql("ALTER TABLE room ADD COLUMN IF NOT EXISTS format VARCHAR(20) DEFAULT 'commander'");
        $this->addSql('ALTER TABLE room ADD COLUMN IF NOT EXISTS max_players INT DEFAULT 4');
        $this->addSql("
            UPDATE room AS r
            SET name = COALESCE(NULLIF(TRIM(r.name), ''), 'Mesa de ' || COALESCE(NULLIF(TRIM(u.display_name), ''), 'Commander'))
            FROM app_user AS u
            WHERE r.owner_id = u.id
        ");
        $this->addSql("UPDATE room SET name = 'Mesa Commander' WHERE name IS NULL OR TRIM(name) = ''");
        $this->addSql("UPDATE room SET format = 'commander' WHERE format IS NULL OR format <> 'commander'");
        $this->addSql('UPDATE room SET max_players = 4 WHERE max_players IS NULL');
        $this->addSql('UPDATE room SET max_players = 2 WHERE max_players < 2');
        $this->addSql('UPDATE room SET max_players = 6 WHERE max_players > 6');
        $this->addSql('ALTER TABLE room ALTER COLUMN name SET NOT NULL');
        $this->addSql('ALTER TABLE room ALTER COLUMN format SET NOT NULL');
        $this->addSql('ALTER TABLE room ALTER COLUMN max_players SET NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE room DROP COLUMN IF EXISTS max_players');
        $this->addSql('ALTER TABLE room DROP COLUMN IF EXISTS format');
        $this->addSql('ALTER TABLE room DROP COLUMN IF EXISTS name');
    }
}

