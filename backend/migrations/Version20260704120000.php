<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260704120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add deck social counters, original creator, and per-user likes.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE deck ADD likes INT NOT NULL DEFAULT 0');
        $this->addSql('ALTER TABLE deck ADD copies INT NOT NULL DEFAULT 0');
        $this->addSql('ALTER TABLE deck ADD creator_user_id VARCHAR(36) DEFAULT NULL');
        $this->addSql('UPDATE deck SET creator_user_id = owner_id WHERE creator_user_id IS NULL');
        $this->addSql('ALTER TABLE deck ALTER creator_user_id SET NOT NULL');
        $this->addSql('CREATE INDEX IDX_DECK_CREATOR_USER ON deck (creator_user_id)');
        $this->addSql('ALTER TABLE deck ADD CONSTRAINT FK_DECK_CREATOR_USER FOREIGN KEY (creator_user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql(<<<'SQL'
CREATE TABLE deck_like (
    deck_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY(deck_id, user_id)
)
SQL);
        $this->addSql('CREATE UNIQUE INDEX uniq_deck_like_deck_user ON deck_like (deck_id, user_id)');
        $this->addSql('CREATE INDEX idx_deck_like_user ON deck_like (user_id)');
        $this->addSql('ALTER TABLE deck_like ADD CONSTRAINT FK_DECK_LIKE_DECK FOREIGN KEY (deck_id) REFERENCES deck (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE deck_like ADD CONSTRAINT FK_DECK_LIKE_USER FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE deck_like DROP CONSTRAINT FK_DECK_LIKE_DECK');
        $this->addSql('ALTER TABLE deck_like DROP CONSTRAINT FK_DECK_LIKE_USER');
        $this->addSql('DROP TABLE deck_like');
        $this->addSql('ALTER TABLE deck DROP CONSTRAINT FK_DECK_CREATOR_USER');
        $this->addSql('DROP INDEX IDX_DECK_CREATOR_USER');
        $this->addSql('ALTER TABLE deck DROP creator_user_id');
        $this->addSql('ALTER TABLE deck DROP copies');
        $this->addSql('ALTER TABLE deck DROP likes');
    }
}
