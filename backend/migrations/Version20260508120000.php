<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260508120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Legacy placeholder migration kept for migration history consistency.';
    }

    public function up(Schema $schema): void
    {
        // Intentionally left empty.
    }

    public function down(Schema $schema): void
    {
        // Intentionally left empty.
    }
}
