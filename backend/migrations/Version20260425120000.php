<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260425120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add room visibility for public room listings.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE room ADD visibility VARCHAR(20) DEFAULT 'private' NOT NULL");
        $this->addSql("ALTER TABLE room ALTER visibility DROP DEFAULT");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE room DROP visibility');
    }
}
