<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260425130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add deck folders and assign decks to folders.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE deck_folder (id VARCHAR(36) NOT NULL, owner_id VARCHAR(36) NOT NULL, name VARCHAR(120) NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE INDEX IDX_DECK_FOLDER_OWNER ON deck_folder (owner_id)');
        $this->addSql('ALTER TABLE deck_folder ADD CONSTRAINT FK_DECK_FOLDER_OWNER FOREIGN KEY (owner_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE deck ADD folder_id VARCHAR(36) DEFAULT NULL');
        $this->addSql('CREATE INDEX IDX_DECK_FOLDER ON deck (folder_id)');
        $this->addSql('ALTER TABLE deck ADD CONSTRAINT FK_DECK_FOLDER FOREIGN KEY (folder_id) REFERENCES deck_folder (id) ON DELETE SET NULL NOT DEFERRABLE INITIALLY IMMEDIATE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE deck DROP CONSTRAINT FK_DECK_FOLDER');
        $this->addSql('ALTER TABLE deck_folder DROP CONSTRAINT FK_DECK_FOLDER_OWNER');
        $this->addSql('DROP INDEX IDX_DECK_FOLDER');
        $this->addSql('DROP INDEX IDX_DECK_FOLDER_OWNER');
        $this->addSql('ALTER TABLE deck DROP folder_id');
        $this->addSql('DROP TABLE deck_folder');
    }
}
