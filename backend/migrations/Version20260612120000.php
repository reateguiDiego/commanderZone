<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260612120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Persist the latest deck validation status.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE deck ADD is_valid BOOLEAN DEFAULT false NOT NULL');
        $this->addSql('ALTER TABLE deck ALTER is_valid DROP DEFAULT');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE deck DROP is_valid');
    }
}
