<?php

namespace App\Infrastructure\Scryfall;

use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:scryfall:rulings-backfill', description: 'Backfills card.has_rulings from Scryfall bulk cards + rulings data.')]
final class ScryfallRulingsBackfillCommand extends Command
{
    private const RULINGS_TEMP_TABLE = 'tmp_scryfall_rulings_oracle_ids';

    public function __construct(
        private readonly ScryfallBulkDataClient $bulkDataClient,
        private readonly Connection $connection,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('bulk-type', null, InputOption::VALUE_REQUIRED, 'Cards bulk type to use while mapping Scryfall ids.', 'all_cards')
            ->addOption('cards-file', null, InputOption::VALUE_REQUIRED, 'Local cards bulk JSON file.')
            ->addOption('rulings-file', null, InputOption::VALUE_REQUIRED, 'Local rulings bulk JSON file.')
            ->addOption('memory-limit', null, InputOption::VALUE_REQUIRED, 'Optional PHP memory_limit override for this backfill.')
            ->addOption('batch-size', null, InputOption::VALUE_REQUIRED, 'Rows to flush per database batch.', '2000')
            ->addOption('only-missing', null, InputOption::VALUE_NONE, 'Only update rows whose has_rulings is still false.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $bulkType = trim((string) $input->getOption('bulk-type'));
        $cardsFile = $this->nullableTrimmedString($input->getOption('cards-file'));
        $rulingsFile = $this->nullableTrimmedString($input->getOption('rulings-file'));
        $memoryLimit = $this->nullableTrimmedString($input->getOption('memory-limit'));
        $batchSize = max(100, min(10000, (int) $input->getOption('batch-size')));
        $onlyMissing = (bool) $input->getOption('only-missing');
        if ($memoryLimit !== null) {
            ini_set('memory_limit', $memoryLimit);
        }

        if (!$this->hasCandidateRows($onlyMissing)) {
            $output->writeln('No card rows matched the requested scope.');

            return Command::SUCCESS;
        }

        $this->prepareRulingsTempTable();

        try {
            $loadedOracleIds = $this->loadOracleIdsWithRulingsIntoTempTable($rulingsFile, max(1000, min(10000, $batchSize * 2)), $output);
            $processed = 0;
            $matched = 0;
            $scanned = 0;
            $batch = [];

            foreach ($this->bulkDataClient->loadBulkItems($bulkType, $cardsFile) as $cardData) {
                if (!is_array($cardData)) {
                    continue;
                }

                $scryfallId = trim((string) ($cardData['id'] ?? ''));
                if ($scryfallId === '') {
                    continue;
                }

                $batch[] = [
                    'scryfallId' => $scryfallId,
                    'oracleId' => trim((string) ($cardData['oracle_id'] ?? '')),
                    'hasRulingsOverride' => array_key_exists('has_rulings', $cardData) ? (bool) $cardData['has_rulings'] : null,
                ];
                ++$scanned;

                if (count($batch) >= $batchSize) {
                    [$updated, $matchedBatch] = $this->flushBatch($batch, $onlyMissing);
                    $processed += $updated;
                    $matched += $matchedBatch;
                    $batch = [];
                    $output->writeln(sprintf(
                        'Scanned %d cards, matched %d local rows, updated %d rows... memory=%s',
                        $scanned,
                        $matched,
                        $processed,
                        $this->formatBytes(memory_get_usage(true)),
                    ));
                    gc_collect_cycles();
                }
            }

            if ($batch !== []) {
                [$updated, $matchedBatch] = $this->flushBatch($batch, $onlyMissing);
                $processed += $updated;
                $matched += $matchedBatch;
            }

            $output->writeln(sprintf(
                'Done. Loaded %d oracle ids with rulings, scanned %d cards, matched %d local rows, updated %d rows.',
                $loadedOracleIds,
                $scanned,
                $matched,
                $processed,
            ));
            if ($processed === 0) {
                $output->writeln('<comment>No local card rows matched the provided Scryfall cards bulk source.</comment>');
            }

            return Command::SUCCESS;
        } finally {
            $this->dropRulingsTempTable();
        }
    }

    private function hasCandidateRows(bool $onlyMissing): bool
    {
        $sql = 'SELECT 1 FROM card';
        if ($onlyMissing) {
            $sql .= ' WHERE has_rulings = false';
        }
        $sql .= ' LIMIT 1';

        return $this->connection->fetchOne($sql) !== false;
    }

    private function prepareRulingsTempTable(): void
    {
        $this->connection->executeStatement(sprintf(
            'CREATE TEMP TABLE IF NOT EXISTS %s (oracle_id VARCHAR(36) PRIMARY KEY)',
            self::RULINGS_TEMP_TABLE,
        ));
        $this->connection->executeStatement(sprintf('TRUNCATE %s', self::RULINGS_TEMP_TABLE));
    }

    private function dropRulingsTempTable(): void
    {
        $this->connection->executeStatement(sprintf('DROP TABLE IF EXISTS %s', self::RULINGS_TEMP_TABLE));
    }

    private function loadOracleIdsWithRulingsIntoTempTable(?string $rulingsFile, int $batchSize, OutputInterface $output): int
    {
        $oracleIds = [];
        $loaded = 0;

        foreach ($this->bulkDataClient->loadBulkItems('rulings', $rulingsFile) as $entry) {
            if (!is_array($entry)) {
                continue;
            }

            $oracleId = trim((string) ($entry['oracle_id'] ?? ''));
            if ($oracleId !== '') {
                $oracleIds[$oracleId] = true;
            }

            if (count($oracleIds) >= $batchSize) {
                $loaded += $this->insertOracleIdsBatch(array_keys($oracleIds));
                $oracleIds = [];
                $output->writeln(sprintf('Loaded %d rulings oracle ids...', $loaded));
                gc_collect_cycles();
            }
        }

        if ($oracleIds !== []) {
            $loaded += $this->insertOracleIdsBatch(array_keys($oracleIds));
        }

        return $loaded;
    }

    /**
     * @param list<string> $oracleIds
     *
     * @return int
     */
    private function insertOracleIdsBatch(array $oracleIds): int
    {
        if ($oracleIds === []) {
            return 0;
        }

        $placeholders = implode(', ', array_fill(0, count($oracleIds), '(?)'));
        $this->connection->executeStatement(
            sprintf(
                'INSERT INTO %s (oracle_id) VALUES %s ON CONFLICT (oracle_id) DO NOTHING',
                self::RULINGS_TEMP_TABLE,
                $placeholders,
            ),
            array_values($oracleIds),
        );

        return count($oracleIds);
    }

    /**
     * @param list<array{scryfallId:string,oracleId:string,hasRulingsOverride:?bool}> $batch
     *
     * @return array{0:int,1:int}
     */
    private function flushBatch(array $batch, bool $onlyMissing): array
    {
        $existingIds = $this->existingScryfallIdsForBatch(
            array_values(array_unique(array_map(static fn (array $row): string => $row['scryfallId'], $batch))),
            $onlyMissing,
        );
        if ($existingIds === []) {
            return [0, 0];
        }

        $oracleIds = [];
        foreach ($batch as $row) {
            if (!isset($existingIds[$row['scryfallId']]) || $row['hasRulingsOverride'] !== null || $row['oracleId'] === '') {
                continue;
            }

            $oracleIds[$row['oracleId']] = true;
        }
        $oracleIdsWithRulings = $this->oracleIdsWithRulingsForBatch(array_keys($oracleIds));

        $updates = [];
        $matched = 0;
        foreach ($batch as $row) {
            if (!isset($existingIds[$row['scryfallId']])) {
                continue;
            }

            ++$matched;
            $updates[] = [
                'scryfallId' => $row['scryfallId'],
                'hasRulings' => $row['hasRulingsOverride'] ?? ($row['oracleId'] !== '' && isset($oracleIdsWithRulings[$row['oracleId']])),
            ];
        }

        $this->flushUpdates($updates);

        return [count($updates), $matched];
    }

    private function nullableTrimmedString(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }

    /**
     * @param list<string> $scryfallIds
     *
     * @return array<string,true>
     */
    private function existingScryfallIdsForBatch(array $scryfallIds, bool $onlyMissing): array
    {
        if ($scryfallIds === []) {
            return [];
        }

        $sql = 'SELECT scryfall_id FROM card WHERE scryfall_id IN (:ids)';
        if ($onlyMissing) {
            $sql .= ' AND has_rulings = false';
        }

        $ids = [];
        foreach ($this->connection->fetchFirstColumn($sql, ['ids' => $scryfallIds], ['ids' => ArrayParameterType::STRING]) as $scryfallId) {
            $trimmed = trim((string) $scryfallId);
            if ($trimmed !== '') {
                $ids[$trimmed] = true;
            }
        }

        return $ids;
    }

    /**
     * @param list<string> $oracleIds
     *
     * @return array<string,true>
     */
    private function oracleIdsWithRulingsForBatch(array $oracleIds): array
    {
        if ($oracleIds === []) {
            return [];
        }

        $matched = [];
        $sql = sprintf('SELECT oracle_id FROM %s WHERE oracle_id IN (:ids)', self::RULINGS_TEMP_TABLE);
        foreach ($this->connection->fetchFirstColumn($sql, ['ids' => $oracleIds], ['ids' => ArrayParameterType::STRING]) as $oracleId) {
            $trimmed = trim((string) $oracleId);
            if ($trimmed !== '') {
                $matched[$trimmed] = true;
            }
        }

        return $matched;
    }

    /**
     * @param list<array{scryfallId:string,hasRulings:bool}> $updates
     */
    private function flushUpdates(array $updates): void
    {
        if ($updates === []) {
            return;
        }

        $this->connection->beginTransaction();

        try {
            foreach ($updates as $row) {
                $this->connection->executeStatement(
                    'UPDATE card SET has_rulings = :has_rulings WHERE scryfall_id = :scryfall_id',
                    [
                        'has_rulings' => $row['hasRulings'],
                        'scryfall_id' => $row['scryfallId'],
                    ],
                    [
                        'has_rulings' => ParameterType::BOOLEAN,
                    ],
                );
            }

            $this->connection->commit();
        } catch (\Throwable $throwable) {
            $this->connection->rollBack();

            throw $throwable;
        }
    }

    private function formatBytes(int $bytes): string
    {
        return sprintf('%.1f MB', $bytes / 1024 / 1024);
    }
}
