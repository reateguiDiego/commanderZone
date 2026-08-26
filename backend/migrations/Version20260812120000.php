<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260812120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add an independent monotonic revision for game control-plane realtime state.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE game ADD COLUMN control_plane_revision INT NOT NULL DEFAULT 0');
        $this->addSql('ALTER TABLE game ALTER COLUMN control_plane_revision DROP DEFAULT');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE game DROP COLUMN control_plane_revision');
    }
}
