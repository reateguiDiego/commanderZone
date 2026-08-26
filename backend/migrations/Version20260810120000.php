<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260810120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Move rematch votes out of the versioned gameplay event stream.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(<<<'SQL'
ALTER TABLE game ADD COLUMN IF NOT EXISTS rematch_state JSON NOT NULL DEFAULT '{"votes": {}}'
SQL);
        $this->addSql(<<<'SQL'
UPDATE game
SET rematch_state = snapshot->'rematch'
WHERE json_typeof(snapshot->'rematch') = 'object'
SQL);
        $this->addSql('ALTER TABLE game ALTER COLUMN rematch_state DROP DEFAULT');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE game DROP COLUMN IF EXISTS rematch_state');
    }
}
