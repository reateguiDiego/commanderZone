<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260703130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Allow system user messages without a sender account.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE user_message ALTER sender_id DROP NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DELETE FROM user_message WHERE sender_id IS NULL');
        $this->addSql('ALTER TABLE user_message ALTER sender_id SET NOT NULL');
    }
}
