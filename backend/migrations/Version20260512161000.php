<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260512161000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add deck game background and sleeves names';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE deck ADD background_name VARCHAR(80) NOT NULL DEFAULT 'back_5'");
        $this->addSql("ALTER TABLE deck ADD sleeves_name VARCHAR(80) NOT NULL DEFAULT 'facedown_card'");
        $this->addSql("UPDATE deck SET background_name = 'back_5', sleeves_name = 'facedown_card'");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE deck DROP background_name');
        $this->addSql('ALTER TABLE deck DROP sleeves_name');
    }
}
