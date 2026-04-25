<?php

namespace App\Infrastructure\Scryfall;

use App\Domain\Card\Card;
use Doctrine\ORM\EntityManagerInterface;
use JsonMachine\Items;
use JsonMachine\JsonDecoder\ExtJsonDecoder;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\HttpClient\HttpClientInterface;

#[AsCommand(name: 'app:scryfall:sync', description: 'Imports Scryfall bulk card data into the local database.')]
class ScryfallSyncCommand extends Command
{
    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly EntityManagerInterface $entityManager,
        #[Autowire('%env(SCRYFALL_USER_AGENT)%')]
        private readonly string $userAgent,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('file', null, InputOption::VALUE_REQUIRED, 'Local Scryfall JSON file to import instead of downloading bulk data.')
            ->addOption('limit', null, InputOption::VALUE_REQUIRED, 'Maximum number of cards to import. Useful for development.', null);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $file = $input->getOption('file');
        $limit = $input->getOption('limit') !== null ? (int) $input->getOption('limit') : null;
        $cards = is_string($file) && $file !== '' ? $this->loadLocalFile($file) : $this->downloadDefaultCards();

        $count = 0;
        foreach ($cards as $cardData) {
            if (!is_array($cardData) || !isset($cardData['id'], $cardData['name'])) {
                continue;
            }

            $card = $this->entityManager->getRepository(Card::class)->findOneBy(['scryfallId' => $cardData['id']]);
            if (!$card instanceof Card) {
                $card = new Card((string) $cardData['id']);
                $this->entityManager->persist($card);
            }

            $card->updateFromScryfall($cardData);
            ++$count;

            if ($count % 500 === 0) {
                $this->entityManager->flush();
                $this->entityManager->clear();
                $output->writeln(sprintf('Imported %d cards...', $count));
            }

            if ($limit !== null && $count >= $limit) {
                break;
            }
        }

        $this->entityManager->flush();
        $output->writeln(sprintf('Imported %d cards.', $count));

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

        return Items::fromFile($temporaryFile, ['decoder' => new ExtJsonDecoder(true)]);
    }

    private function loadLocalFile(string $file): iterable
    {
        if (!is_file($file)) {
            throw new \RuntimeException(sprintf('File "%s" does not exist.', $file));
        }

        return Items::fromFile($file, ['decoder' => new ExtJsonDecoder(true)]);
    }
}
