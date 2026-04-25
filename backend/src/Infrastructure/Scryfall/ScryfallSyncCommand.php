<?php

namespace App\Infrastructure\Scryfall;

use App\Domain\Card\Card;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;
use JsonMachine\Items;
use JsonMachine\JsonDecoder\ExtJsonDecoder;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Uid\Uuid;
use Symfony\Contracts\HttpClient\HttpClientInterface;

#[AsCommand(name: 'app:scryfall:sync', description: 'Imports Scryfall bulk card data into the local database.')]
class ScryfallSyncCommand extends Command
{
    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly Connection $connection,
        #[Autowire('%env(SCRYFALL_USER_AGENT)%')]
        private readonly string $userAgent,
        #[Autowire('%env(default::SCRYFALL_SYNC_MEMORY_LIMIT)%')]
        private readonly string $defaultMemoryLimit = '512M',
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('file', null, InputOption::VALUE_REQUIRED, 'Local Scryfall JSON file to import instead of downloading bulk data.')
            ->addOption('limit', null, InputOption::VALUE_REQUIRED, 'Maximum number of cards to import. Useful for development.', null)
            ->addOption('memory-limit', null, InputOption::VALUE_REQUIRED, 'PHP memory_limit used for this import.', null)
            ->addOption('skip-existing', null, InputOption::VALUE_NONE, 'Skip Scryfall ids already present in the database. Useful when resuming a failed import.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $memoryLimit = $input->getOption('memory-limit');
        ini_set('memory_limit', is_string($memoryLimit) && $memoryLimit !== '' ? $memoryLimit : $this->defaultMemoryLimit);

        $file = $input->getOption('file');
        $limit = $input->getOption('limit') !== null ? (int) $input->getOption('limit') : null;
        $existingIds = $input->getOption('skip-existing') ? $this->loadExistingScryfallIds($output) : [];
        $cards = is_string($file) && $file !== '' ? $this->loadLocalFile($file) : $this->downloadDefaultCards();

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

            $this->upsertCard($cardData);
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

    private function downloadDefaultCards(): iterable
    {
        $headers = [
            'Accept' => 'application/json',
            'User-Agent' => $this->userAgent,
        ];

        $bulkResponse = $this->httpClient->request('GET', 'https://api.scryfall.com/bulk-data', ['headers' => $headers])->toArray();
        $downloadUri = null;
        foreach ($bulkResponse['data'] ?? [] as $bulkData) {
            if (($bulkData['type'] ?? null) === 'default_cards') {
                $downloadUri = $bulkData['download_uri'] ?? null;
                break;
            }
        }

        if (!is_string($downloadUri)) {
            throw new \RuntimeException('Scryfall default_cards bulk download URI was not found.');
        }

        $temporaryFile = tempnam(sys_get_temp_dir(), 'scryfall-default-cards-');
        if ($temporaryFile === false) {
            throw new \RuntimeException('Could not create temporary file for Scryfall bulk download.');
        }

        $handle = fopen($temporaryFile, 'wb');
        if ($handle === false) {
            throw new \RuntimeException('Could not open temporary file for Scryfall bulk download.');
        }

        $response = $this->httpClient->request('GET', $downloadUri, ['headers' => $headers]);
        foreach ($this->httpClient->stream($response) as $chunk) {
            fwrite($handle, $chunk->getContent());
        }
        fclose($handle);

        try {
            yield from Items::fromFile($temporaryFile, ['decoder' => new ExtJsonDecoder(true)]);
        } finally {
            @unlink($temporaryFile);
        }
    }

    private function loadLocalFile(string $file): iterable
    {
        if (!is_file($file)) {
            throw new \RuntimeException(sprintf('File "%s" does not exist.', $file));
        }

        return Items::fromFile($file, ['decoder' => new ExtJsonDecoder(true)]);
    }

    private function upsertCard(array $data): void
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
    colors,
    color_identity,
    legalities,
    image_uris,
    layout,
    commander_legal,
    set_code,
    collector_number
) VALUES (
    :id,
    :scryfall_id,
    :name,
    :normalized_name,
    :mana_cost,
    :type_line,
    :oracle_text,
    :colors,
    :color_identity,
    :legalities,
    :image_uris,
    :layout,
    :commander_legal,
    :set_code,
    :collector_number
)
ON CONFLICT (scryfall_id) DO UPDATE SET
    name = EXCLUDED.name,
    normalized_name = EXCLUDED.normalized_name,
    mana_cost = EXCLUDED.mana_cost,
    type_line = EXCLUDED.type_line,
    oracle_text = EXCLUDED.oracle_text,
    colors = EXCLUDED.colors,
    color_identity = EXCLUDED.color_identity,
    legalities = EXCLUDED.legalities,
    image_uris = EXCLUDED.image_uris,
    layout = EXCLUDED.layout,
    commander_legal = EXCLUDED.commander_legal,
    set_code = EXCLUDED.set_code,
    collector_number = EXCLUDED.collector_number
SQL,
            [
                'id' => Uuid::v7()->toRfc4122(),
                'scryfall_id' => (string) $data['id'],
                'name' => $name,
                'normalized_name' => Card::normalizeName($name),
                'mana_cost' => $data['mana_cost'] ?? null,
                'type_line' => $data['type_line'] ?? null,
                'oracle_text' => $data['oracle_text'] ?? null,
                'colors' => $this->json($data['colors'] ?? []),
                'color_identity' => $this->json($data['color_identity'] ?? []),
                'legalities' => $this->json($legalities),
                'image_uris' => $this->json($data['image_uris'] ?? ($data['card_faces'][0]['image_uris'] ?? [])),
                'layout' => $data['layout'] ?? 'normal',
                'commander_legal' => ($legalities['commander'] ?? null) === 'legal',
                'set_code' => $data['set'] ?? null,
                'collector_number' => $data['collector_number'] ?? null,
            ],
            [
                'commander_legal' => ParameterType::BOOLEAN,
            ],
        );
    }

    private function json(array $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR);
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
}
