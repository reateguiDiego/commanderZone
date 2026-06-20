<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260618120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Persist waiting room mulligan configuration.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE room ADD mulligan_rule VARCHAR(20) DEFAULT 'LONDON' NOT NULL");
        $this->addSql('ALTER TABLE room ADD first_mulligan_free BOOLEAN DEFAULT true NOT NULL');
        $this->addSql('ALTER TABLE room ALTER mulligan_rule DROP DEFAULT');
        $this->addSql('ALTER TABLE room ALTER first_mulligan_free DROP DEFAULT');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE room DROP mulligan_rule');
        $this->addSql('ALTER TABLE room DROP first_mulligan_free');
    }
}
