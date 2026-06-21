<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260619100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Limit app_user.display_name to 20 chars to match username constraints.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("UPDATE app_user SET display_name = LEFT(display_name, 20) WHERE LENGTH(display_name) > 20");
        $this->addSql('ALTER TABLE app_user ALTER COLUMN display_name TYPE VARCHAR(20)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user ALTER COLUMN display_name TYPE VARCHAR(25)');
    }
}
