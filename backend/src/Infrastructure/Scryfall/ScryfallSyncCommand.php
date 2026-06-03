<?php

namespace App\Infrastructure\Scryfall;

use App\Domain\Card\Card;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Uid\Uuid;

#[AsCommand(name: 'app:scryfall:sync', description: 'Imports Scryfall bulk card data into the local database.')]
class ScryfallSyncCommand extends Command
{
    /**
     * @var list<string>
     */
    private const SUPPORTED_BULK_TYPES = ['default_cards', 'all_cards'];
    private ?bool $printTablesAvailable = null;

    public function __construct(
        private readonly ScryfallBulkDataClient $bulkDataClient,
        private readonly Connection $connection,
        #[Autowire('%env(default::SCRYFALL_SYNC_MEMORY_LIMIT)%')]
        private readonly string $defaultMemoryLimit = '512M',
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('file', null, InputOption::VALUE_REQUIRED, 'Local Scryfall JSON file to import instead of downloading bulk data.')
            ->addOption('rulings-file', null, InputOption::VALUE_REQUIRED, 'Local Scryfall rulings JSON file used to compute has_rulings metadata.')
            ->addOption('bulk-type', null, InputOption::VALUE_REQUIRED, 'Scryfall bulk type to import when downloading. Supported values: default_cards, all_cards.', 'all_cards')
            ->addOption('limit', null, InputOption::VALUE_REQUIRED, 'Maximum number of cards to import. Useful for development.', null)
            ->addOption('memory-limit', null, InputOption::VALUE_REQUIRED, 'PHP memory_limit used for this import.', null)
            ->addOption('skip-existing', null, InputOption::VALUE_NONE, 'Skip Scryfall ids already present in the database. Useful when resuming a failed import.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $memoryLimit = $input->getOption('memory-limit');
        ini_set('memory_limit', is_string($memoryLimit) && $memoryLimit !== '' ? $memoryLimit : $this->defaultMemoryLimit);

        $file = $input->getOption('file');
        $rulingsFile = $input->getOption('rulings-file');
        $bulkType = is_string($input->getOption('bulk-type')) ? trim((string) $input->getOption('bulk-type')) : 'all_cards';
        $limit = $input->getOption('limit') !== null ? (int) $input->getOption('limit') : null;
        $existingIds = $input->getOption('skip-existing') ? $this->loadExistingScryfallIds($output) : [];
        if (!in_array($bulkType, self::SUPPORTED_BULK_TYPES, true)) {
            throw new \InvalidArgumentException(sprintf(
                'Unsupported bulk type "%s". Supported values: %s.',
                $bulkType,
                implode(', ', self::SUPPORTED_BULK_TYPES),
            ));
        }

        $cards = $this->bulkDataClient->loadBulkItems($bulkType, is_string($file) && $file !== '' ? $file : null);
        $oracleIdsWithRulings = $this->oracleIdsWithRulings(
            is_string($rulingsFile) && trim($rulingsFile) !== '' ? trim($rulingsFile) : null,
            is_string($file) && $file !== '',
            $output,
        );

        $count = 0;
        $skipped = 0;
        foreach ($cards as $cardData) {
            if (!is_array($cardData) || !isset($cardData['id'], $cardData['name'])) {
                continue;
            }

            $scryfallId = (string) $cardData['id'];
            if (isset($existingIds[$scryfallId])) {
                ++$skipped;
                if ($skipped % 5000 === 0) {
                    $output->writeln(sprintf('Skipped %d existing cards...', $skipped));
                }
                continue;
            }

            $this->upsertCard($cardData, $this->hasRulings($cardData, $oracleIdsWithRulings));
            if ($this->printTablesAvailable()) {
                $this->upsertCardPrintAndLocale($cardData);
            }
            $existingIds[$scryfallId] = true;
            ++$count;

            if ($count % 500 === 0) {
                $output->writeln(sprintf('Imported %d cards... memory=%s', $count, $this->formatBytes(memory_get_usage(true))));
                gc_collect_cycles();
            }

            if ($limit !== null && $count >= $limit) {
                break;
            }
        }

        $output->writeln(sprintf('Imported %d cards. Skipped %d existing cards.', $count, $skipped));

        return Command::SUCCESS;
    }

    /**
     * @return array<string,true>
     */
    private function oracleIdsWithRulings(?string $rulingsFile, bool $usingLocalCardsFile, OutputInterface $output): array
    {
        if ($usingLocalCardsFile && $rulingsFile === null) {
            $output->writeln('<comment>Local cards file provided without --rulings-file. has_rulings will default to false unless the card payload already includes it.</comment>');

            return [];
        }

        $oracleIds = [];
        foreach ($this->bulkDataClient->loadBulkItems('rulings', $rulingsFile) as $entry) {
            if (!is_array($entry)) {
                continue;
            }

            $oracleId = trim((string) ($entry['oracle_id'] ?? ''));
            if ($oracleId !== '') {
                $oracleIds[$oracleId] = true;
            }
        }

        return $oracleIds;
    }

    private function hasRulings(array $data, array $oracleIdsWithRulings): bool
    {
        if (array_key_exists('has_rulings', $data)) {
            return (bool) $data['has_rulings'];
        }

        $oracleId = trim((string) ($data['oracle_id'] ?? ''));

        return $oracleId !== '' && isset($oracleIdsWithRulings[$oracleId]);
    }

    private function upsertCard(array $data, bool $hasRulings): void
    {
        $name = (string) $data['name'];
        $legalities = $data['legalities'] ?? [];

        $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO card (
    id,
    scryfall_id,
    name,
    normalized_name,
    mana_cost,
    type_line,
    oracle_text,
    power,
    toughness,
    loyalty,
    face_stats,
    colors,
    color_identity,
    legalities,
    image_uris,
    card_faces,
    all_parts,
    mana_value,
    produced_mana,
    prices,
    layout,
    commander_legal,
    set_code,
    collector_number,
    lang,
    printed_name,
    flavor_name,
    image_status,
    has_rulings,
    updated_at
) VALUES (
    :id,
    :scryfall_id,
    :name,
    :normalized_name,
    :mana_cost,
    :type_line,
    :oracle_text,
    :power,
    :toughness,
    :loyalty,
    :face_stats,
    :colors,
    :color_identity,
    :legalities,
    :image_uris,
    :card_faces,
    :all_parts,
    :mana_value,
    :produced_mana,
    :prices,
    :layout,
    :commander_legal,
    :set_code,
    :collector_number,
    :lang,
    :printed_name,
    :flavor_name,
    :image_status,
    :has_rulings,
    NOW()
)
ON CONFLICT (scryfall_id) DO UPDATE SET
    name = EXCLUDED.name,
    normalized_name = EXCLUDED.normalized_name,
    mana_cost = EXCLUDED.mana_cost,
    type_line = EXCLUDED.type_line,
    oracle_text = EXCLUDED.oracle_text,
    power = EXCLUDED.power,
    toughness = EXCLUDED.toughness,
    loyalty = EXCLUDED.loyalty,
    face_stats = EXCLUDED.face_stats,
    colors = EXCLUDED.colors,
    color_identity = EXCLUDED.color_identity,
    legalities = EXCLUDED.legalities,
    image_uris = EXCLUDED.image_uris,
    card_faces = EXCLUDED.card_faces,
    all_parts = EXCLUDED.all_parts,
    mana_value = EXCLUDED.mana_value,
    produced_mana = EXCLUDED.produced_mana,
    prices = EXCLUDED.prices,
    layout = EXCLUDED.layout,
    commander_legal = EXCLUDED.commander_legal,
    set_code = EXCLUDED.set_code,
    collector_number = EXCLUDED.collector_number,
    lang = EXCLUDED.lang,
    printed_name = EXCLUDED.printed_name,
    flavor_name = EXCLUDED.flavor_name,
    image_status = EXCLUDED.image_status,
    has_rulings = EXCLUDED.has_rulings,
    updated_at = NOW()
SQL,
            [
                'id' => Uuid::v7()->toRfc4122(),
                'scryfall_id' => (string) $data['id'],
                'name' => $name,
                'normalized_name' => Card::normalizeName($name),
                'mana_cost' => $this->cardString($data, 'mana_cost'),
                'type_line' => $this->cardString($data, 'type_line'),
                'oracle_text' => $this->oracleText($data),
                'power' => $this->cardString($data, 'power'),
                'toughness' => $this->cardString($data, 'toughness'),
                'loyalty' => $this->cardString($data, 'loyalty'),
                'face_stats' => $this->json($this->faceStats($data)),
                'colors' => $this->json($data['colors'] ?? []),
                'color_identity' => $this->json($data['color_identity'] ?? []),
                'legalities' => $this->json($legalities),
                'image_uris' => $this->json($data['image_uris'] ?? ($data['card_faces'][0]['image_uris'] ?? [])),
                'card_faces' => $this->json($this->cardFaces($data)),
                'all_parts' => $this->json($data['all_parts'] ?? []),
                'mana_value' => isset($data['cmc']) ? (float) $data['cmc'] : null,
                'produced_mana' => $this->json($data['produced_mana'] ?? []),
                'prices' => $this->json($data['prices'] ?? []),
                'layout' => $data['layout'] ?? 'normal',
                'commander_legal' => ($legalities['commander'] ?? null) === 'legal',
                'set_code' => $data['set'] ?? null,
                'collector_number' => $data['collector_number'] ?? null,
                'lang' => $data['lang'] ?? null,
                'printed_name' => $data['printed_name'] ?? null,
                'flavor_name' => $data['flavor_name'] ?? null,
                'image_status' => isset($data['image_status']) && is_scalar($data['image_status']) && (string) $data['image_status'] !== ''
                    ? (string) $data['image_status']
                    : null,
                'has_rulings' => $hasRulings,
            ],
            [
                'commander_legal' => ParameterType::BOOLEAN,
                'has_rulings' => ParameterType::BOOLEAN,
            ],
        );
    }

    private function upsertCardPrintAndLocale(array $data): void
    {
        $name = (string) ($data['name'] ?? '');
        $normalizedName = Card::normalizeName($name);
        $lang = isset($data['lang']) && is_scalar($data['lang']) ? (string) $data['lang'] : null;
        $imageUris = $this->json($data['image_uris'] ?? ($data['card_faces'][0]['image_uris'] ?? []));
        $cardFaces = $this->json($this->cardFaces($data));
        $legalities = $data['legalities'] ?? [];

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
                'scryfall_id' => (string) $data['id'],
                'normalized_name' => $normalizedName,
                'set_code' => $data['set'] ?? null,
                'collector_number' => $data['collector_number'] ?? null,
                'default_name' => $name,
                'default_lang' => $lang,
                'default_mana_cost' => $this->cardString($data, 'mana_cost'),
                'default_type_line' => $this->cardString($data, 'type_line'),
                'default_oracle_text' => $this->oracleText($data),
                'default_image_uris' => $imageUris,
                'default_card_faces' => $cardFaces,
                'layout' => $data['layout'] ?? 'normal',
                'commander_legal' => ($legalities['commander'] ?? null) === 'legal',
            ],
            [
                'commander_legal' => ParameterType::BOOLEAN,
            ],
        );

        if ($lang === null || $lang === '') {
            return;
        }

        $printedName = isset($data['printed_name']) && is_scalar($data['printed_name']) && (string) $data['printed_name'] !== ''
            ? (string) $data['printed_name']
            : null;

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
                'print_scryfall_id' => (string) $data['id'],
                'lang' => $lang,
                'name' => $name,
                'printed_name' => $printedName,
                'mana_cost' => $this->cardString($data, 'mana_cost'),
                'type_line' => $this->cardString($data, 'type_line'),
                'oracle_text' => $this->oracleText($data),
                'image_uris' => $imageUris,
                'card_faces' => $cardFaces,
                'image_status' => isset($data['image_status']) && is_scalar($data['image_status']) && (string) $data['image_status'] !== ''
                    ? (string) $data['image_status']
                    : null,
            ],
        );
    }

    private function json(array $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR);
    }

    private function cardFaces(array $data): array
    {
        $faces = $data['card_faces'] ?? [];
        if (!is_array($faces)) {
            return [];
        }

        return array_values(array_filter($faces, static fn (mixed $face): bool => is_array($face)));
    }

    private function cardString(array $data, string $key): ?string
    {
        $value = $data[$key] ?? $this->firstFaceValue($data, $key);

        return is_scalar($value) && (string) $value !== '' ? (string) $value : null;
    }

    private function faceStats(array $data): array
    {
        $faces = [];
        foreach ($this->cardFaces($data) as $face) {
            $faces[] = [
                'name' => isset($face['name']) && is_scalar($face['name']) ? (string) $face['name'] : null,
                ...$this->statBlock([
                    'power' => $face['power'] ?? null,
                    'toughness' => $face['toughness'] ?? null,
                    'loyalty' => $face['loyalty'] ?? null,
                    'defense' => $face['defense'] ?? null,
                    'handModifier' => $face['hand_modifier'] ?? null,
                    'lifeModifier' => $face['life_modifier'] ?? null,
                ]),
            ];
        }

        return [
            'root' => $this->statBlock([
                'power' => $this->cardString($data, 'power'),
                'toughness' => $this->cardString($data, 'toughness'),
                'loyalty' => $this->cardString($data, 'loyalty'),
                'defense' => $this->cardString($data, 'defense'),
                'handModifier' => $this->cardString($data, 'hand_modifier'),
                'lifeModifier' => $this->cardString($data, 'life_modifier'),
            ]),
            'faces' => $faces,
        ];
    }

    /**
     * @param array<string,mixed> $values
     *
     * @return array{power:?string,toughness:?string,loyalty:?string,defense:?string,handModifier:?string,lifeModifier:?string}
     */
    private function statBlock(array $values): array
    {
        return [
            'power' => $this->scalarOrNull($values['power'] ?? null),
            'toughness' => $this->scalarOrNull($values['toughness'] ?? null),
            'loyalty' => $this->scalarOrNull($values['loyalty'] ?? null),
            'defense' => $this->scalarOrNull($values['defense'] ?? null),
            'handModifier' => $this->scalarOrNull($values['handModifier'] ?? null),
            'lifeModifier' => $this->scalarOrNull($values['lifeModifier'] ?? null),
        ];
    }

    private function scalarOrNull(mixed $value): ?string
    {
        return is_scalar($value) && (string) $value !== '' ? (string) $value : null;
    }

    private function firstFaceValue(array $data, string $key): mixed
    {
        $face = $data['card_faces'][0] ?? null;

        return is_array($face) ? ($face[$key] ?? null) : null;
    }

    private function oracleText(array $data): ?string
    {
        if (isset($data['oracle_text']) && is_scalar($data['oracle_text']) && (string) $data['oracle_text'] !== '') {
            return (string) $data['oracle_text'];
        }

        $faces = $data['card_faces'] ?? null;
        if (!is_array($faces)) {
            return null;
        }

        $texts = [];
        foreach ($faces as $face) {
            if (!is_array($face) || !isset($face['oracle_text']) || !is_scalar($face['oracle_text'])) {
                continue;
            }

            $text = trim((string) $face['oracle_text']);
            if ($text !== '') {
                $texts[] = $text;
            }
        }

        return $texts === [] ? null : implode("\n//\n", $texts);
    }

    /**
     * @return array<string, true>
     */
    private function loadExistingScryfallIds(OutputInterface $output): array
    {
        $output->writeln('Loading existing Scryfall ids...');
        $ids = [];

        foreach ($this->connection->iterateAssociative('SELECT scryfall_id FROM card') as $row) {
            $ids[(string) $row['scryfall_id']] = true;
        }

        $output->writeln(sprintf('Loaded %d existing Scryfall ids.', count($ids)));

        return $ids;
    }

    private function formatBytes(int $bytes): string
    {
        return sprintf('%.1f MB', $bytes / 1024 / 1024);
    }

    private function printTablesAvailable(): bool
    {
        if ($this->printTablesAvailable !== null) {
            return $this->printTablesAvailable;
        }

        $cardPrint = $this->connection->fetchOne("SELECT to_regclass('public.card_print')");
        $cardPrintLocale = $this->connection->fetchOne("SELECT to_regclass('public.card_print_locale')");

        $this->printTablesAvailable = is_string($cardPrint)
            && $cardPrint !== ''
            && is_string($cardPrintLocale)
            && $cardPrintLocale !== '';

        return $this->printTablesAvailable;
    }
}
