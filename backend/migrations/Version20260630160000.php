<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260630160000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add canonical oracle ids and global card-token relations.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS oracle_id VARCHAR(36) DEFAULT NULL');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_oracle_id ON card (oracle_id)');
        $this->addSql('ALTER TABLE card_print ADD COLUMN IF NOT EXISTS oracle_id VARCHAR(36) DEFAULT NULL');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_print_oracle_id ON card_print (oracle_id)');

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_token_relation (
    source_scryfall_id VARCHAR(36) NOT NULL,
    source_oracle_id VARCHAR(36) DEFAULT NULL,
    token_scryfall_id VARCHAR(36) NOT NULL,
    token_name VARCHAR(255) NOT NULL,
    token_uri TEXT DEFAULT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (source_scryfall_id, token_scryfall_id)
)
SQL,
        );
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_token_relation_source_oracle ON card_token_relation (source_oracle_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_token_relation_source_scryfall ON card_token_relation (source_scryfall_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_token_relation_token_scryfall ON card_token_relation (token_scryfall_id)');
        $this->addSql(
            'ALTER TABLE card_token_relation ADD CONSTRAINT fk_card_token_relation_source FOREIGN KEY (source_scryfall_id) REFERENCES card (scryfall_id) ON DELETE CASCADE',
        );
        $this->addSql(
            <<<'SQL'
INSERT INTO card_token_relation (
    source_scryfall_id,
    source_oracle_id,
    token_scryfall_id,
    token_name,
    token_uri,
    updated_at
)
SELECT
    card.scryfall_id,
    card.oracle_id,
    token_part.value ->> 'id',
    COALESCE(NULLIF(token_part.value ->> 'name', ''), 'Unknown token'),
    NULLIF(token_part.value ->> 'uri', ''),
    NOW()
FROM card
CROSS JOIN LATERAL json_array_elements(card.all_parts) AS token_part(value)
WHERE token_part.value ->> 'component' = 'token'
  AND COALESCE(token_part.value ->> 'id', '') <> ''
ON CONFLICT (source_scryfall_id, token_scryfall_id) DO UPDATE SET
    source_oracle_id = EXCLUDED.source_oracle_id,
    token_name = EXCLUDED.token_name,
    token_uri = EXCLUDED.token_uri,
    updated_at = NOW()
SQL,
        );
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS card_token_relation');
        $this->addSql('DROP INDEX IF EXISTS idx_card_print_oracle_id');
        $this->addSql('ALTER TABLE card_print DROP COLUMN IF EXISTS oracle_id');
        $this->addSql('DROP INDEX IF EXISTS idx_card_oracle_id');
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS oracle_id');
    }
}
