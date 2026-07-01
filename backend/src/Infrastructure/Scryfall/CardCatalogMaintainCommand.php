<?php

namespace App\Infrastructure\Scryfall;

use Doctrine\DBAL\Connection;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

#[AsCommand(name: 'app:card-catalog:maintain', description: 'Checks, refreshes, imports, or locally resets the card catalog safely.')]
final class CardCatalogMaintainCommand extends Command
{
    private const MODE_CHECK = 'check';
    private const MODE_REFRESH_EXISTING = 'refresh-existing';
    private const MODE_FULL_IMPORT = 'full-import';
    private const MODE_RESET = 'reset';
    private const RESET_CONFIRMATION = 'RESET-CARD-CATALOG';

    /**
     * @var list<string>
     */
    private const TABLES = [
        'card',
        'card_print',
        'card_print_locale',
        'card_search_option',
        'card_search_set_option',
        'card_search_entry',
        'deck',
        'deck_card',
    ];

    /**
     * @var array<string,list<string>>
     */
    private const REQUIRED_COLUMNS = [
        'card' => ['rarity', 'set_name'],
        'card_print' => ['default_set_name'],
        'card_print_locale' => ['set_name'],
    ];

    public function __construct(
        private readonly Connection $connection,
        private readonly CardCatalogCommandRunner $runner,
        private readonly CardCatalogResetService $resetService,
        #[Autowire('%kernel.environment%')]
        private readonly string $kernelEnvironment,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('mode', null, InputOption::VALUE_REQUIRED, 'Mode: check, refresh-existing, full-import, or reset.', self::MODE_CHECK)
            ->addOption('apply', null, InputOption::VALUE_NONE, 'Required for modes that write to the database.')
            ->addOption('allow-destructive', null, InputOption::VALUE_NONE, 'Required for reset mode.')
            ->addOption('confirm', null, InputOption::VALUE_REQUIRED, sprintf('Required for reset mode. Use %s.', self::RESET_CONFIRMATION))
            ->addOption('bulk-type', null, InputOption::VALUE_REQUIRED, 'Scryfall bulk type: default_cards or all_cards.', 'all_cards')
            ->addOption('cards-file', null, InputOption::VALUE_REQUIRED, 'Local Scryfall cards JSON file.')
            ->addOption('rulings-file', null, InputOption::VALUE_REQUIRED, 'Local Scryfall rulings JSON file.')
            ->addOption('memory-limit', null, InputOption::VALUE_REQUIRED, 'PHP memory_limit for Scryfall scans/imports.')
            ->addOption('limit', null, InputOption::VALUE_REQUIRED, 'Maximum cards/rows to process. Useful for dev and tests.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $mode = $this->stringOption($input, 'mode') ?? self::MODE_CHECK;
        if (!in_array($mode, [self::MODE_CHECK, self::MODE_REFRESH_EXISTING, self::MODE_FULL_IMPORT, self::MODE_RESET], true)) {
            $output->writeln('<error>Invalid --mode. Use check, refresh-existing, full-import, or reset.</error>');

            return Command::FAILURE;
        }

        if ($mode === self::MODE_CHECK) {
            return $this->check($output);
        }

        if (!$input->getOption('apply')) {
            $output->writeln(sprintf('<error>Mode "%s" writes to the database. Re-run with --apply.</error>', $mode));

            return Command::FAILURE;
        }

        return match ($mode) {
            self::MODE_REFRESH_EXISTING => $this->refreshExisting($input, $output),
            self::MODE_FULL_IMPORT => $this->fullImport($input, $output),
            self::MODE_RESET => $this->reset($input, $output),
            default => Command::FAILURE,
        };
    }

    private function check(OutputInterface $output): int
    {
        $output->writeln('Card catalog maintenance check');

        $missingSchemaObjects = $this->missingSchemaObjects();
        if ($missingSchemaObjects === []) {
            $output->writeln('Schema objects: OK');
        } else {
            $output->writeln('<comment>Missing schema objects:</comment>');
            foreach ($missingSchemaObjects as $missingObject) {
                $output->writeln('- '.$missingObject);
            }
        }

        $output->writeln('Catalog counts:');
        foreach (self::TABLES as $table) {
            if (!$this->tableExists($table)) {
                $output->writeln(sprintf('- %s: missing', $table));
                continue;
            }

            $output->writeln(sprintf('- %s: %d', $table, $this->tableCount($table)));
        }

        $output->writeln('Missing metadata:');
        $output->writeln(sprintf('- card.rarity_or_set_name: %s', $this->missingCardMetadataCount()));
        $output->writeln(sprintf('- card_print.default_set_name: %s', $this->missingColumnValueCount('card_print', 'default_set_name')));
        $output->writeln(sprintf('- card_print_locale.set_name: %s', $this->missingColumnValueCount('card_print_locale', 'set_name')));

        return Command::SUCCESS;
    }

    private function refreshExisting(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Refreshing existing card catalog metadata and derived tables...');

        $status = $this->runner->runMetadataBackfill($this->metadataBackfillOptions($input), $output);
        if ($status !== Command::SUCCESS) {
            return $status;
        }

        $status = $this->runner->runCardPrintBackfill($this->cardPrintBackfillOptions($input), $output);
        if ($status !== Command::SUCCESS) {
            return $status;
        }

        $status = $this->runner->runSearchOptionsRebuild($output);
        if ($status !== Command::SUCCESS) {
            return $status;
        }

        $status = $this->runner->runSearchEntryRebuild($output);
        if ($status !== Command::SUCCESS) {
            return $status;
        }

        $output->writeln('Card catalog refresh completed.');

        return Command::SUCCESS;
    }

    private function fullImport(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Running non-truncating Scryfall catalog import...');
        $status = $this->runner->runScryfallSync($this->scryfallSyncOptions($input), $output);
        if ($status !== Command::SUCCESS) {
            return $status;
        }

        $output->writeln('Card catalog full import completed.');

        return Command::SUCCESS;
    }

    private function reset(InputInterface $input, OutputInterface $output): int
    {
        if (!$this->resetConfirmed($input)) {
            $message = $this->kernelEnvironment === 'prod'
                ? 'Production reset is blocked without --allow-destructive --confirm=RESET-CARD-CATALOG.'
                : 'Reset mode is destructive. Re-run with --allow-destructive --confirm=RESET-CARD-CATALOG.';
            $output->writeln('<error>'.$message.'</error>');

            return Command::FAILURE;
        }

        $output->writeln('Preparing destructive card catalog reset...');
        $prepareResult = $this->resetService->prepare();
        $output->writeln(sprintf(
            'Backed up %d deck card rows and truncated: %s.',
            $prepareResult->backedUpDeckCards,
            $prepareResult->truncatedTables === [] ? '(none)' : implode(', ', $prepareResult->truncatedTables),
        ));

        $status = $this->runner->runScryfallSync($this->scryfallSyncOptions($input), $output);
        if ($status !== Command::SUCCESS) {
            $output->writeln('<error>Scryfall import failed. Deck-card backup table was kept for manual restore.</error>');

            return $status;
        }

        $restoreResult = $this->resetService->restore();
        $output->writeln(sprintf('Restored %d deck card rows after catalog reset.', $restoreResult->restoredDeckCards));
        if ($restoreResult->missingCards !== []) {
            $output->writeln('<comment>Some deck cards could not be restored because their Scryfall ids were not imported again. Backup table was kept.</comment>');
            foreach ($restoreResult->missingCards as $row) {
                $output->writeln(sprintf(
                    '- deck=%s scryfallId=%s quantity=%s section=%s',
                    (string) $row['deck_id'],
                    (string) $row['scryfall_id'],
                    (string) $row['quantity'],
                    (string) $row['section'],
                ));
            }
        }

        if ($restoreResult->backupCleared) {
            $output->writeln('Reset backup table was cleared.');
        }
        $output->writeln('Card catalog reset completed.');

        return Command::SUCCESS;
    }

    /**
     * @return list<string>
     */
    private function missingSchemaObjects(): array
    {
        $missing = [];
        foreach (self::TABLES as $table) {
            if (!$this->tableExists($table)) {
                $missing[] = sprintf('table:%s', $table);
            }
        }

        foreach (self::REQUIRED_COLUMNS as $table => $columns) {
            foreach ($columns as $column) {
                if (!$this->columnExists($table, $column)) {
                    $missing[] = sprintf('column:%s.%s', $table, $column);
                }
            }
        }

        return $missing;
    }

    private function missingCardMetadataCount(): string
    {
        if (!$this->tableExists('card') || !$this->columnExists('card', 'rarity') || !$this->columnExists('card', 'set_name')) {
            return 'unavailable';
        }

        return (string) $this->connection->fetchOne(
            "SELECT COUNT(*) FROM card WHERE rarity IS NULL OR rarity = '' OR set_name IS NULL OR set_name = ''",
        );
    }

    private function missingColumnValueCount(string $table, string $column): string
    {
        if (!$this->tableExists($table) || !$this->columnExists($table, $column)) {
            return 'unavailable';
        }

        return (string) $this->connection->fetchOne(sprintf(
            "SELECT COUNT(*) FROM %s WHERE %s IS NULL OR %s = ''",
            $table,
            $column,
            $column,
        ));
    }

    private function tableCount(string $table): int
    {
        return (int) $this->connection->fetchOne(sprintf('SELECT COUNT(*) FROM %s', $table));
    }

    private function tableExists(string $table): bool
    {
        $result = $this->connection->fetchOne('SELECT to_regclass(:table)', ['table' => 'public.'.$table]);

        return is_string($result) && $result !== '';
    }

    private function columnExists(string $table, string $column): bool
    {
        $result = $this->connection->fetchOne(
            <<<'SQL'
SELECT 1
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = :table
  AND column_name = :column
LIMIT 1
SQL,
            [
                'table' => $table,
                'column' => $column,
            ],
        );

        return $result !== false;
    }

    /**
     * @return array<string,mixed>
     */
    private function metadataBackfillOptions(InputInterface $input): array
    {
        $options = [
            '--bulk-type' => $this->stringOption($input, 'bulk-type') ?? 'all_cards',
            '--only-missing' => true,
        ];
        $this->addOptionalOption($options, '--cards-file', $this->stringOption($input, 'cards-file'));
        $this->addOptionalOption($options, '--memory-limit', $this->stringOption($input, 'memory-limit'));
        $this->addOptionalOption($options, '--limit', $this->stringOption($input, 'limit'));

        return $options;
    }

    /**
     * @return array<string,mixed>
     */
    private function cardPrintBackfillOptions(InputInterface $input): array
    {
        $options = [];
        $this->addOptionalOption($options, '--limit', $this->stringOption($input, 'limit'));

        return $options;
    }

    /**
     * @return array<string,mixed>
     */
    private function scryfallSyncOptions(InputInterface $input): array
    {
        $options = [
            '--bulk-type' => $this->stringOption($input, 'bulk-type') ?? 'all_cards',
        ];
        $this->addOptionalOption($options, '--file', $this->stringOption($input, 'cards-file'));
        $this->addOptionalOption($options, '--rulings-file', $this->stringOption($input, 'rulings-file'));
        $this->addOptionalOption($options, '--memory-limit', $this->stringOption($input, 'memory-limit'));
        $this->addOptionalOption($options, '--limit', $this->stringOption($input, 'limit'));

        return $options;
    }

    /**
     * @param array<string,mixed> $options
     */
    private function addOptionalOption(array &$options, string $name, ?string $value): void
    {
        if ($value === null) {
            return;
        }

        $options[$name] = $value;
    }

    private function stringOption(InputInterface $input, string $name): ?string
    {
        $value = $input->getOption($name);
        if (!is_scalar($value)) {
            return null;
        }

        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function resetConfirmed(InputInterface $input): bool
    {
        return (bool) $input->getOption('allow-destructive')
            && $this->stringOption($input, 'confirm') === self::RESET_CONFIRMATION;
    }
}
