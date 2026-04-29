<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260429122000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add public and private visibility to decks and deck folders.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE deck ADD visibility VARCHAR(20) DEFAULT 'private' NOT NULL");
        $this->addSql('ALTER TABLE deck ALTER visibility DROP DEFAULT');
        $this->addSql("ALTER TABLE deck_folder ADD visibility VARCHAR(20) DEFAULT 'private' NOT NULL");
        $this->addSql('ALTER TABLE deck_folder ALTER visibility DROP DEFAULT');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE deck DROP visibility');
        $this->addSql('ALTER TABLE deck_folder DROP visibility');
    }
}
