<?php

namespace App\Infrastructure\Scryfall;

use Doctrine\DBAL\Connection;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:card-catalog:reset', description: 'Prepares or restores a local card catalog reset while preserving deck cards by Scryfall id.')]
final class CardCatalogResetCommand extends Command
{
    private const BACKUP_TABLE = 'card_catalog_reset_deck_card_backup';

    public function __construct(private readonly Connection $connection)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('stage', null, InputOption::VALUE_REQUIRED, 'Stage to run: prepare or restore.', 'prepare')
            ->addOption('confirm', null, InputOption::VALUE_NONE, 'Required because prepare truncates local card catalog tables.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $stage = is_string($input->getOption('stage')) ? trim($input->getOption('stage')) : 'prepare';
        if (!in_array($stage, ['prepare', 'restore'], true)) {
            $output->writeln('<error>Invalid --stage. Use prepare or restore.</error>');

            return Command::FAILURE;
        }

        if ($stage === 'prepare' && !$input->getOption('confirm')) {
            $output->writeln('<error>Refusing to truncate catalog tables without --confirm.</error>');

            return Command::FAILURE;
        }

        return $stage === 'prepare'
            ? $this->prepare($output)
            : $this->restore($output);
    }

    private function prepare(OutputInterface $output): int
    {
        $this->connection->transactional(function () use ($output): void {
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
                'card_print_locale',
                'card_print',
                'card_search_option',
                'card_search_set_option',
                'card',
            ]);
            if ($tables !== []) {
                $this->connection->executeStatement('TRUNCATE '.implode(', ', $tables).' RESTART IDENTITY CASCADE');
            }

            $output->writeln(sprintf('Backed up %d deck card rows and truncated card catalog tables.', $backupCount));
        });

        $output->writeln('Run app:scryfall:sync next, then app:card-catalog:reset --stage=restore.');

        return Command::SUCCESS;
    }

    private function restore(OutputInterface $output): int
    {
        if (!$this->tableExists(self::BACKUP_TABLE)) {
            $output->writeln('<error>No reset backup table exists. Run --stage=prepare first.</error>');

            return Command::FAILURE;
        }

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

        $output->writeln(sprintf('Restored %d deck card rows from catalog reset backup.', $restored));
        if ($missing !== []) {
            $output->writeln('<comment>Some deck cards were not restored because their Scryfall ids were not imported again. Backup table was kept.</comment>');
            foreach ($missing as $row) {
                $output->writeln(sprintf(
                    '- deck=%s scryfallId=%s quantity=%s section=%s',
                    (string) $row['deck_id'],
                    (string) $row['scryfall_id'],
                    (string) $row['quantity'],
                    (string) $row['section'],
                ));
            }

            return Command::SUCCESS;
        }

        $this->connection->executeStatement('TRUNCATE '.self::BACKUP_TABLE);
        $output->writeln('All deck cards were restored. Reset backup table was cleared.');

        return Command::SUCCESS;
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
        $result = $this->connection->fetchOne("SELECT to_regclass(:table)", ['table' => 'public.'.$table]);

        return is_string($result) && $result !== '';
    }
}
