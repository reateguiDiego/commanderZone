<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260911110000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Partial room browser index validated by RoomListQueryLoadTest; reuse existing membership and owner indexes.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE INDEX idx_room_list_waiting ON room (visibility, name COLLATE "C", id) WHERE status = \'waiting\' AND game_id IS NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX idx_room_list_waiting');
    }
}
