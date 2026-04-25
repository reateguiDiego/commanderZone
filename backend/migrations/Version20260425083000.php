<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260425083000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Initial CommanderZone backend schema.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE app_user (id VARCHAR(36) NOT NULL, email VARCHAR(180) NOT NULL, display_name VARCHAR(80) NOT NULL, password VARCHAR(255) NOT NULL, roles JSON NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE UNIQUE INDEX uniq_user_email ON app_user (email)');

        $this->addSql('CREATE TABLE card (id VARCHAR(36) NOT NULL, scryfall_id VARCHAR(36) NOT NULL, name VARCHAR(255) NOT NULL, normalized_name VARCHAR(255) NOT NULL, mana_cost VARCHAR(255) DEFAULT NULL, type_line TEXT DEFAULT NULL, oracle_text TEXT DEFAULT NULL, colors JSON NOT NULL, color_identity JSON NOT NULL, legalities JSON NOT NULL, image_uris JSON NOT NULL, layout VARCHAR(80) NOT NULL, commander_legal BOOLEAN NOT NULL, set_code VARCHAR(16) DEFAULT NULL, collector_number VARCHAR(32) DEFAULT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE UNIQUE INDEX uniq_card_scryfall_id ON card (scryfall_id)');
        $this->addSql('CREATE INDEX idx_card_normalized_name ON card (normalized_name)');

        $this->addSql('CREATE TABLE deck (id VARCHAR(36) NOT NULL, owner_id VARCHAR(36) NOT NULL, name VARCHAR(120) NOT NULL, format VARCHAR(40) NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE INDEX IDX_4FAC36377E3C61F9 ON deck (owner_id)');

        $this->addSql('CREATE TABLE deck_card (id VARCHAR(36) NOT NULL, deck_id VARCHAR(36) NOT NULL, card_id VARCHAR(36) NOT NULL, quantity INT NOT NULL, section VARCHAR(32) NOT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE INDEX IDX_2AF3DCED111948DC ON deck_card (deck_id)');
        $this->addSql('CREATE INDEX IDX_2AF3DCED4ACC9A20 ON deck_card (card_id)');

        $this->addSql('CREATE TABLE room (id VARCHAR(36) NOT NULL, owner_id VARCHAR(36) NOT NULL, game_id VARCHAR(36) DEFAULT NULL, status VARCHAR(40) NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE INDEX IDX_729F519B7E3C61F9 ON room (owner_id)');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_729F519BE48FD905 ON room (game_id)');

        $this->addSql('CREATE TABLE room_player (id VARCHAR(36) NOT NULL, room_id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL, deck_id VARCHAR(36) DEFAULT NULL, joined_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE UNIQUE INDEX uniq_room_player_user ON room_player (room_id, user_id)');
        $this->addSql('CREATE INDEX IDX_D957BCA454177093 ON room_player (room_id)');
        $this->addSql('CREATE INDEX IDX_D957BCA4A76ED395 ON room_player (user_id)');
        $this->addSql('CREATE INDEX IDX_D957BCA4111948DC ON room_player (deck_id)');

        $this->addSql('CREATE TABLE game (id VARCHAR(36) NOT NULL, room_id VARCHAR(36) NOT NULL, status VARCHAR(40) NOT NULL, snapshot JSON NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE INDEX IDX_232B318C54177093 ON game (room_id)');

        $this->addSql('CREATE TABLE game_event (id VARCHAR(36) NOT NULL, game_id VARCHAR(36) NOT NULL, created_by_id VARCHAR(36) DEFAULT NULL, type VARCHAR(80) NOT NULL, payload JSON NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE INDEX IDX_99D7328E48FD905 ON game_event (game_id)');
        $this->addSql('CREATE INDEX IDX_99D7328B03A8386 ON game_event (created_by_id)');

        $this->addSql('ALTER TABLE deck ADD CONSTRAINT FK_4FAC36327E3C61F9 FOREIGN KEY (owner_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE deck_card ADD CONSTRAINT FK_651950C1E2636C3B FOREIGN KEY (deck_id) REFERENCES deck (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE deck_card ADD CONSTRAINT FK_651950C14ACC9A20 FOREIGN KEY (card_id) REFERENCES card (id) NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE room ADD CONSTRAINT FK_729F519B7E3C61F9 FOREIGN KEY (owner_id) REFERENCES app_user (id) NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE room ADD CONSTRAINT FK_729F519BE48FD905 FOREIGN KEY (game_id) REFERENCES game (id) NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE room_player ADD CONSTRAINT FK_8E68DAD354177093 FOREIGN KEY (room_id) REFERENCES room (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE room_player ADD CONSTRAINT FK_8E68DAD3A76ED395 FOREIGN KEY (user_id) REFERENCES app_user (id) NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE room_player ADD CONSTRAINT FK_8E68DAD3E2636C3B FOREIGN KEY (deck_id) REFERENCES deck (id) NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE game ADD CONSTRAINT FK_232B318C54177093 FOREIGN KEY (room_id) REFERENCES room (id) NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE game_event ADD CONSTRAINT FK_99097F27E48FD905 FOREIGN KEY (game_id) REFERENCES game (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE game_event ADD CONSTRAINT FK_99097F27B03A8386 FOREIGN KEY (created_by_id) REFERENCES app_user (id) NOT DEFERRABLE INITIALLY IMMEDIATE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE game_event DROP CONSTRAINT FK_99097F27B03A8386');
        $this->addSql('ALTER TABLE game_event DROP CONSTRAINT FK_99097F27E48FD905');
        $this->addSql('ALTER TABLE game DROP CONSTRAINT FK_232B318C54177093');
        $this->addSql('ALTER TABLE room_player DROP CONSTRAINT FK_8E68DAD3E2636C3B');
        $this->addSql('ALTER TABLE room_player DROP CONSTRAINT FK_8E68DAD3A76ED395');
        $this->addSql('ALTER TABLE room_player DROP CONSTRAINT FK_8E68DAD354177093');
        $this->addSql('ALTER TABLE room DROP CONSTRAINT FK_729F519BE48FD905');
        $this->addSql('ALTER TABLE room DROP CONSTRAINT FK_729F519B7E3C61F9');
        $this->addSql('ALTER TABLE deck_card DROP CONSTRAINT FK_651950C14ACC9A20');
        $this->addSql('ALTER TABLE deck_card DROP CONSTRAINT FK_651950C1E2636C3B');
        $this->addSql('ALTER TABLE deck DROP CONSTRAINT FK_4FAC36327E3C61F9');
        $this->addSql('DROP TABLE game_event');
        $this->addSql('DROP TABLE game');
        $this->addSql('DROP TABLE room_player');
        $this->addSql('DROP TABLE room');
        $this->addSql('DROP TABLE deck_card');
        $this->addSql('DROP TABLE deck');
        $this->addSql('DROP TABLE card');
        $this->addSql('DROP TABLE app_user');
    }
}
