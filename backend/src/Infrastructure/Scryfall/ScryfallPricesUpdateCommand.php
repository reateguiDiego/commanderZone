<?php

namespace App\Infrastructure\Scryfall;

use Doctrine\DBAL\Connection;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:scryfall:prices-update', description: 'Updates local card prices from Scryfall bulk card data.')]
final class ScryfallPricesUpdateCommand extends Command
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
            ->addOption('bulk-type', null, InputOption::VALUE_REQUIRED, 'Scryfall cards bulk type to use. Use all_cards to refresh every local print.', 'all_cards')
            ->addOption('cards-file', null, InputOption::VALUE_REQUIRED, 'Local Scryfall cards JSON file. Useful for development and tests.')
            ->addOption('batch-size', null, InputOption::VALUE_REQUIRED, 'Rows to flush per database batch.', '2000')
            ->addOption('limit', null, InputOption::VALUE_REQUIRED, 'Maximum Scryfall cards to scan. Useful for development and tests.', null);
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

        $cardsFile = $this->nullableTrimmedString($input->getOption('cards-file'));
        $batchSize = max(100, min(10000, (int) $input->getOption('batch-size')));
        $limit = $input->getOption('limit') !== null ? max(0, (int) $input->getOption('limit')) : null;
        $scanned = 0;
        $updated = 0;
        $batch = [];

        foreach ($this->bulkDataClient->loadBulkItems($bulkType, $cardsFile) as $cardData) {
            if (!is_array($cardData)) {
                continue;
            }

            ++$scanned;
            $priceRow = $this->priceRowFromCardData($cardData);
            if ($priceRow !== null) {
                // A bulk source should not repeat a print id, but keeping the latest row makes the update deterministic.
                $batch[$priceRow['scryfallId']] = $priceRow;
            }

            if (count($batch) >= $batchSize) {
                $updated += $this->flushBatch(array_values($batch));
                $batch = [];
                $output->writeln(sprintf(
                    'Scanned %d cards, updated %d local prices... memory=%s',
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
            $updated += $this->flushBatch(array_values($batch));
        }

        $output->writeln(sprintf('Done. Scanned %d cards, updated %d local prices.', $scanned, $updated));

        return Command::SUCCESS;
    }

    /**
     * @param array<string,mixed> $cardData
     *
     * @return array{scryfallId:string,prices:array<string,mixed>}|null
     */
    private function priceRowFromCardData(array $cardData): ?array
    {
        $scryfallId = $this->nullableTrimmedString($cardData['id'] ?? null);
        if ($scryfallId === null || !is_array($cardData['prices'] ?? null)) {
            return null;
        }

        return [
            'scryfallId' => $scryfallId,
            'prices' => $cardData['prices'],
        ];
    }

    /**
     * @param list<array{scryfallId:string,prices:array<string,mixed>}> $batch
     */
    private function flushBatch(array $batch): int
    {
        if ($batch === []) {
            return 0;
        }

        $values = [];
        $params = [];
        foreach ($batch as $index => $row) {
            $values[] = sprintf(
                '(CAST(:scryfall_id_%d AS VARCHAR), CAST(:prices_%d AS JSON))',
                $index,
                $index,
            );
            $params[sprintf('scryfall_id_%d', $index)] = $row['scryfallId'];
            $params[sprintf('prices_%d', $index)] = json_encode($row['prices'], JSON_THROW_ON_ERROR);
        }

        return $this->connection->executeStatement(
            sprintf(
                <<<'SQL'
UPDATE card AS c
SET
    prices = source.prices,
    updated_at = NOW()
FROM (VALUES %s) AS source(scryfall_id, prices)
WHERE c.scryfall_id = source.scryfall_id
  AND c.prices::jsonb IS DISTINCT FROM source.prices::jsonb
SQL,
                implode(', ', $values),
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

    private function formatBytes(int $bytes): string
    {
        return sprintf('%.1f MB', $bytes / 1024 / 1024);
    }
}
