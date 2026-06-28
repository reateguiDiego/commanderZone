<?php

namespace App\Infrastructure\Scryfall;

use Doctrine\DBAL\Connection;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:scryfall:metadata-backfill', description: 'Backfills card rarity and set metadata from Scryfall bulk cards.')]
final class ScryfallCardMetadataBackfillCommand extends Command
{
    /**
     * @var list<string>
     */
    private const SUPPORTED_BULK_TYPES = ['default_cards', 'all_cards'];

    public function __construct(
        private readonly ScryfallBulkDataClient $bulkDataClient,
        private readonly Connection $connection,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('bulk-type', null, InputOption::VALUE_REQUIRED, 'Scryfall cards bulk type to use.', 'all_cards')
            ->addOption('cards-file', null, InputOption::VALUE_REQUIRED, 'Local Scryfall cards JSON file.')
            ->addOption('memory-limit', null, InputOption::VALUE_REQUIRED, 'Optional PHP memory_limit override for this backfill.')
            ->addOption('batch-size', null, InputOption::VALUE_REQUIRED, 'Rows to flush per database batch.', '2000')
            ->addOption('limit', null, InputOption::VALUE_REQUIRED, 'Maximum Scryfall cards to scan. Useful for tests and development.', null)
            ->addOption('only-missing', null, InputOption::VALUE_NONE, 'Only update rows missing rarity or set name.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $bulkType = trim((string) $input->getOption('bulk-type'));
        if (!in_array($bulkType, self::SUPPORTED_BULK_TYPES, true)) {
            throw new \InvalidArgumentException(sprintf(
                'Unsupported bulk type "%s". Supported values: %s.',
                $bulkType,
                implode(', ', self::SUPPORTED_BULK_TYPES),
            ));
        }

        $memoryLimit = $this->nullableTrimmedString($input->getOption('memory-limit'));
        if ($memoryLimit !== null) {
            ini_set('memory_limit', $memoryLimit);
        }

        $cardsFile = $this->nullableTrimmedString($input->getOption('cards-file'));
        $batchSize = max(100, min(10000, (int) $input->getOption('batch-size')));
        $limit = $input->getOption('limit') !== null ? max(0, (int) $input->getOption('limit')) : null;
        $onlyMissing = (bool) $input->getOption('only-missing');

        $scanned = 0;
        $updated = 0;
        $batch = [];

        foreach ($this->bulkDataClient->loadBulkItems($bulkType, $cardsFile) as $cardData) {
            if (!is_array($cardData)) {
                continue;
            }

            ++$scanned;
            $metadata = $this->metadataFromCardData($cardData);
            if ($metadata !== null) {
                $batch[] = $metadata;
            }

            if (count($batch) >= $batchSize) {
                $updated += $this->flushBatch($batch, $onlyMissing);
                $batch = [];
                $output->writeln(sprintf(
                    'Scanned %d cards, updated %d local rows... memory=%s',
                    $scanned,
                    $updated,
                    $this->formatBytes(memory_get_usage(true)),
                ));
                gc_collect_cycles();
            }

            if ($limit !== null && $scanned >= $limit) {
                break;
            }
        }

        if ($batch !== []) {
            $updated += $this->flushBatch($batch, $onlyMissing);
        }

        $output->writeln(sprintf('Done. Scanned %d cards, updated %d local rows.', $scanned, $updated));

        return Command::SUCCESS;
    }

    /**
     * @param array<string,mixed> $cardData
     *
     * @return array{scryfallId:string,rarity:?string,setName:?string}|null
     */
    private function metadataFromCardData(array $cardData): ?array
    {
        $scryfallId = $this->scalarString($cardData['id'] ?? null);
        if ($scryfallId === null) {
            return null;
        }

        return [
            'scryfallId' => $scryfallId,
            'rarity' => $this->scalarString($cardData['rarity'] ?? null),
            'setName' => $this->scalarString($cardData['set_name'] ?? null),
        ];
    }

    /**
     * @param list<array{scryfallId:string,rarity:?string,setName:?string}> $batch
     */
    private function flushBatch(array $batch, bool $onlyMissing): int
    {
        if ($batch === []) {
            return 0;
        }

        $values = [];
        $params = [];
        foreach ($batch as $index => $row) {
            $values[] = sprintf(
                '(CAST(:scryfall_id_%d AS VARCHAR), CAST(:rarity_%d AS VARCHAR), CAST(:set_name_%d AS VARCHAR))',
                $index,
                $index,
                $index,
            );
            $params[sprintf('scryfall_id_%d', $index)] = $row['scryfallId'];
            $params[sprintf('rarity_%d', $index)] = $row['rarity'];
            $params[sprintf('set_name_%d', $index)] = $row['setName'];
        }

        $where = 'c.scryfall_id = source.scryfall_id';
        if ($onlyMissing) {
            $where .= " AND (c.rarity IS NULL OR c.rarity = '' OR c.set_name IS NULL OR c.set_name = '')";
        }

        return $this->connection->executeStatement(
            sprintf(
                <<<'SQL'
UPDATE card AS c
SET
    rarity = COALESCE(source.rarity, c.rarity),
    set_name = COALESCE(source.set_name, c.set_name),
    updated_at = NOW()
FROM (VALUES %s) AS source(scryfall_id, rarity, set_name)
WHERE %s
SQL,
                implode(', ', $values),
                $where,
            ),
            $params,
        );
    }

    private function nullableTrimmedString(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function scalarString(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $stringValue = trim((string) $value);

        return $stringValue === '' ? null : $stringValue;
    }

    private function formatBytes(int $bytes): string
    {
        return sprintf('%.1f MB', $bytes / 1024 / 1024);
    }
}
