<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260429121000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Drop room invite partial index not represented in Doctrine metadata.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS uniq_room_invite_pending');
    }

    public function down(Schema $schema): void
    {
    }
}
