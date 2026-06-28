<?php

namespace App\Infrastructure\Scryfall;

use Doctrine\DBAL\Connection;

final class CardCatalogResetService
{
    private const BACKUP_TABLE = 'card_catalog_reset_deck_card_backup';

    public function __construct(private readonly Connection $connection)
    {
    }

    public function prepare(): CardCatalogResetPrepareResult
    {
        return $this->connection->transactional(function (): CardCatalogResetPrepareResult {
            $this->ensureBackupTable();
            $this->connection->executeStatement('TRUNCATE '.self::BACKUP_TABLE);
            $backupCount = $this->connection->executeStatement(
                <<<'SQL'
INSERT INTO card_catalog_reset_deck_card_backup (id, deck_id, scryfall_id, quantity, section, updated_at)
SELECT dc.id, dc.deck_id, c.scryfall_id, dc.quantity, dc.section, dc.updated_at
FROM deck_card dc
INNER JOIN card c ON c.id = dc.card_id
SQL,
            );

            $tables = $this->existingTables([
                'deck_card',
                'card_search_entry',
                'card_print_locale',
                'card_print',
                'card_search_option',
                'card_search_set_option',
                'card',
            ]);
            if ($tables !== []) {
                $this->connection->executeStatement('TRUNCATE '.implode(', ', $tables).' RESTART IDENTITY CASCADE');
            }

            return new CardCatalogResetPrepareResult($backupCount, $tables);
        });
    }

    public function restore(): CardCatalogResetRestoreResult
    {
        if (!$this->tableExists(self::BACKUP_TABLE)) {
            throw new \RuntimeException('No reset backup table exists. Run prepare first.');
        }

        return $this->connection->transactional(function (): CardCatalogResetRestoreResult {
            $restored = $this->connection->executeStatement(
                <<<'SQL'
INSERT INTO deck_card (id, deck_id, card_id, quantity, section, updated_at)
SELECT backup.id, backup.deck_id, c.id, backup.quantity, backup.section, backup.updated_at
FROM card_catalog_reset_deck_card_backup backup
INNER JOIN card c ON c.scryfall_id = backup.scryfall_id
ON CONFLICT (id) DO NOTHING
SQL,
            );
            $missing = $this->connection->fetchAllAssociative(
                <<<'SQL'
SELECT backup.deck_id, backup.scryfall_id, backup.quantity, backup.section
FROM card_catalog_reset_deck_card_backup backup
LEFT JOIN card c ON c.scryfall_id = backup.scryfall_id
WHERE c.id IS NULL
ORDER BY backup.deck_id ASC, backup.scryfall_id ASC
SQL,
            );

            if ($missing !== []) {
                return new CardCatalogResetRestoreResult($restored, $missing, false);
            }

            $this->connection->executeStatement('TRUNCATE '.self::BACKUP_TABLE);

            return new CardCatalogResetRestoreResult($restored, [], true);
        });
    }

    private function ensureBackupTable(): void
    {
        $this->connection->executeStatement(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_catalog_reset_deck_card_backup (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    deck_id VARCHAR(36) NOT NULL,
    scryfall_id VARCHAR(36) NOT NULL,
    quantity INT NOT NULL,
    section VARCHAR(32) NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL
)
SQL,
        );
        $this->connection->executeStatement('CREATE INDEX IF NOT EXISTS idx_card_catalog_reset_backup_scryfall ON card_catalog_reset_deck_card_backup (scryfall_id)');
    }

    /**
     * @param list<string> $tables
     *
     * @return list<string>
     */
    private function existingTables(array $tables): array
    {
        return array_values(array_filter($tables, fn (string $table): bool => $this->tableExists($table)));
    }

    private function tableExists(string $table): bool
    {
        $result = $this->connection->fetchOne('SELECT to_regclass(:table)', ['table' => 'public.'.$table]);

        return is_string($result) && $result !== '';
    }
}
