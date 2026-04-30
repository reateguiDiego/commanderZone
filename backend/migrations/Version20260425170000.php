<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260425170000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add card analysis metadata from Scryfall.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card ADD mana_value DOUBLE PRECISION DEFAULT NULL');
        $this->addSql("ALTER TABLE card ADD produced_mana JSON NOT NULL DEFAULT '[]'");
        $this->addSql("ALTER TABLE card ADD prices JSON NOT NULL DEFAULT '[]'");
        $this->addSql('ALTER TABLE card ALTER produced_mana DROP DEFAULT');
        $this->addSql('ALTER TABLE card ALTER prices DROP DEFAULT');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card DROP mana_value');
        $this->addSql('ALTER TABLE card DROP produced_mana');
        $this->addSql('ALTER TABLE card DROP prices');
    }
}
