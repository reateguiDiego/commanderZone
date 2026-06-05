<?php

namespace App\Infrastructure\Scryfall;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:card-print:backfill', description: 'Backfills card_print and card_print_locale from legacy card rows.')]
final class CardPrintBackfillCommand extends Command
{
    public function __construct(private readonly Connection $connection)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('batch-size', null, InputOption::VALUE_REQUIRED, 'Rows to process per batch.', '2000')
            ->addOption('limit', null, InputOption::VALUE_REQUIRED, 'Maximum rows to process in this run.', null)
            ->addOption('from-scryfall-id', null, InputOption::VALUE_REQUIRED, 'Resume cursor (exclusive).', null);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        if (!$this->printTablesAvailable()) {
            $output->writeln('<error>card_print/card_print_locale tables not found. Run migrations first.</error>');

            return Command::FAILURE;
        }

        $batchSize = max(100, min(10000, (int) $input->getOption('batch-size')));
        $limit = $input->getOption('limit');
        $maxRows = $limit !== null ? max(1, (int) $limit) : null;
        $cursor = is_string($input->getOption('from-scryfall-id')) ? trim((string) $input->getOption('from-scryfall-id')) : '';
        $processed = 0;
        $skippedUnavailable = 0;

        while (true) {
            if ($maxRows !== null && $processed >= $maxRows) {
                break;
            }

            $remaining = $maxRows !== null ? max(0, $maxRows - $processed) : $batchSize;
            $currentBatchSize = min($batchSize, max(1, $remaining));

            $rows = $this->connection->executeQuery(
                <<<'SQL'
SELECT
    scryfall_id,
    normalized_name,
    set_code,
    collector_number,
    name,
    lang,
    mana_cost,
    type_line,
    oracle_text,
    image_uris,
    card_faces,
    image_status,
    printed_name,
    layout,
    commander_legal
FROM card
WHERE scryfall_id > :cursor
ORDER BY scryfall_id ASC
LIMIT :batch_size
SQL,
                [
                    'cursor' => $cursor,
                    'batch_size' => $currentBatchSize,
                ],
                [
                    'batch_size' => ParameterType::INTEGER,
                ],
            )->fetchAllAssociative();

            if ($rows === []) {
                break;
            }

            foreach ($rows as $row) {
                $cursor = (string) $row['scryfall_id'];
                ++$processed;

                if ($this->isImageStatusUnavailable($row['image_status'] ?? null)) {
                    ++$skippedUnavailable;
                    continue;
                }

                $this->upsertCardPrint($row);
                $this->upsertCardPrintLocale($row);
            }

            $output->writeln(sprintf(
                'Backfilled %d rows (cursor=%s, skipped_unavailable=%d)',
                $processed - $skippedUnavailable,
                $cursor,
                $skippedUnavailable,
            ));
        }

        $output->writeln(sprintf(
            'Done. Processed %d rows. Skipped %d unavailable prints.',
            $processed,
            $skippedUnavailable,
        ));

        return Command::SUCCESS;
    }

    /**
     * @param array<string,mixed> $row
     */
    private function upsertCardPrint(array $row): void
    {
        $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO card_print (
    scryfall_id,
    normalized_name,
    set_code,
    collector_number,
    default_name,
    default_lang,
    default_mana_cost,
    default_type_line,
    default_oracle_text,
    default_image_uris,
    default_card_faces,
    layout,
    commander_legal,
    updated_at
) VALUES (
    :scryfall_id,
    :normalized_name,
    :set_code,
    :collector_number,
    :default_name,
    :default_lang,
    :default_mana_cost,
    :default_type_line,
    :default_oracle_text,
    :default_image_uris,
    :default_card_faces,
    :layout,
    :commander_legal,
    NOW()
)
ON CONFLICT (scryfall_id) DO UPDATE SET
    normalized_name = EXCLUDED.normalized_name,
    set_code = EXCLUDED.set_code,
    collector_number = EXCLUDED.collector_number,
    default_name = CASE
        WHEN EXCLUDED.default_lang = 'en' OR card_print.default_lang IS NULL THEN EXCLUDED.default_name
        ELSE card_print.default_name
    END,
    default_lang = CASE
        WHEN EXCLUDED.default_lang = 'en' OR card_print.default_lang IS NULL THEN EXCLUDED.default_lang
        ELSE card_print.default_lang
    END,
    default_mana_cost = CASE
        WHEN EXCLUDED.default_lang = 'en' OR card_print.default_lang IS NULL THEN EXCLUDED.default_mana_cost
        ELSE card_print.default_mana_cost
    END,
    default_type_line = CASE
        WHEN EXCLUDED.default_lang = 'en' OR card_print.default_lang IS NULL THEN EXCLUDED.default_type_line
        ELSE card_print.default_type_line
    END,
    default_oracle_text = CASE
        WHEN EXCLUDED.default_lang = 'en' OR card_print.default_lang IS NULL THEN EXCLUDED.default_oracle_text
        ELSE card_print.default_oracle_text
    END,
    default_image_uris = CASE
        WHEN EXCLUDED.default_lang = 'en' OR card_print.default_lang IS NULL THEN EXCLUDED.default_image_uris
        ELSE card_print.default_image_uris
    END,
    default_card_faces = CASE
        WHEN EXCLUDED.default_lang = 'en' OR card_print.default_lang IS NULL THEN EXCLUDED.default_card_faces
        ELSE card_print.default_card_faces
    END,
    layout = EXCLUDED.layout,
    commander_legal = EXCLUDED.commander_legal,
    updated_at = NOW()
SQL,
            [
                'scryfall_id' => (string) $row['scryfall_id'],
                'normalized_name' => (string) $row['normalized_name'],
                'set_code' => $row['set_code'],
                'collector_number' => $row['collector_number'],
                'default_name' => (string) $row['name'],
                'default_lang' => $this->nullableString($row['lang']),
                'default_mana_cost' => $row['mana_cost'],
                'default_type_line' => $row['type_line'],
                'default_oracle_text' => $row['oracle_text'],
                'default_image_uris' => $this->jsonString($row['image_uris']),
                'default_card_faces' => $this->jsonString($row['card_faces']),
                'layout' => $row['layout'] ?? 'normal',
                'commander_legal' => (bool) ($row['commander_legal'] ?? false),
            ],
            [
                'commander_legal' => ParameterType::BOOLEAN,
            ],
        );
    }

    /**
     * @param array<string,mixed> $row
     */
    private function upsertCardPrintLocale(array $row): void
    {
        $lang = $this->nullableString($row['lang']);
        if ($lang === null) {
            return;
        }

        $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO card_print_locale (
    print_scryfall_id,
    lang,
    name,
    printed_name,
    mana_cost,
    type_line,
    oracle_text,
    image_uris,
    card_faces,
    image_status,
    updated_at
) VALUES (
    :print_scryfall_id,
    :lang,
    :name,
    :printed_name,
    :mana_cost,
    :type_line,
    :oracle_text,
    :image_uris,
    :card_faces,
    :image_status,
    NOW()
)
ON CONFLICT (print_scryfall_id, lang) DO UPDATE SET
    name = EXCLUDED.name,
    printed_name = EXCLUDED.printed_name,
    mana_cost = EXCLUDED.mana_cost,
    type_line = EXCLUDED.type_line,
    oracle_text = EXCLUDED.oracle_text,
    image_uris = EXCLUDED.image_uris,
    card_faces = EXCLUDED.card_faces,
    image_status = EXCLUDED.image_status,
    updated_at = NOW()
SQL,
            [
                'print_scryfall_id' => (string) $row['scryfall_id'],
                'lang' => $lang,
                'name' => (string) $row['name'],
                'printed_name' => $this->nullableString($row['printed_name']),
                'mana_cost' => $row['mana_cost'],
                'type_line' => $row['type_line'],
                'oracle_text' => $row['oracle_text'],
                'image_uris' => $this->jsonString($row['image_uris']),
                'card_faces' => $this->jsonString($row['card_faces']),
                'image_status' => $this->nullableString($row['image_status']),
            ],
        );
    }

    private function printTablesAvailable(): bool
    {
        $cardPrint = $this->connection->fetchOne("SELECT to_regclass('public.card_print')");
        $cardPrintLocale = $this->connection->fetchOne("SELECT to_regclass('public.card_print_locale')");

        return is_string($cardPrint)
            && $cardPrint !== ''
            && is_string($cardPrintLocale)
            && $cardPrintLocale !== '';
    }

    private function nullableString(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    private function jsonString(mixed $value): string
    {
        if (is_string($value)) {
            return $value;
        }

        if (is_array($value)) {
            return json_encode($value, JSON_THROW_ON_ERROR);
        }

        return '[]';
    }

    private function isImageStatusUnavailable(mixed $value): bool
    {
        if (!is_scalar($value)) {
            return false;
        }

        return in_array(strtolower(trim((string) $value)), ['missing', 'placeholder'], true);
    }
}

