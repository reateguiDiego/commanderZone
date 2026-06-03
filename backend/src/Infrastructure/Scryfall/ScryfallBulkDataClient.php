<?php

namespace App\Infrastructure\Scryfall;

use JsonMachine\Items;
use JsonMachine\JsonDecoder\ExtJsonDecoder;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class ScryfallBulkDataClient
{
    public function __construct(
        private readonly HttpClientInterface $httpClient,
        #[Autowire('%env(SCRYFALL_USER_AGENT)%')]
        private readonly string $userAgent,
    ) {
    }

    public function loadBulkItems(string $bulkType, ?string $localFile = null): iterable
    {
        if (is_string($localFile) && $localFile !== '') {
            return $this->loadLocalFile($localFile);
        }

        return $this->downloadBulkItems($bulkType);
    }

    public function loadLocalFile(string $file): iterable
    {
        if (!is_file($file)) {
            throw new \RuntimeException(sprintf('File "%s" does not exist.', $file));
        }

        return Items::fromFile($file, ['decoder' => new ExtJsonDecoder(true)]);
    }

    private function downloadBulkItems(string $bulkType): iterable
    {
        $downloadUri = $this->downloadUriForType($bulkType);
        $temporaryFile = tempnam(sys_get_temp_dir(), sprintf('scryfall-%s-', str_replace('_', '-', $bulkType)));
        if ($temporaryFile === false) {
            throw new \RuntimeException('Could not create temporary file for Scryfall bulk download.');
        }

        $handle = fopen($temporaryFile, 'wb');
        if ($handle === false) {
            throw new \RuntimeException('Could not open temporary file for Scryfall bulk download.');
        }

        $response = $this->httpClient->request('GET', $downloadUri, ['headers' => $this->headers()]);
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

    private function downloadUriForType(string $bulkType): string
    {
        $bulkResponse = $this->httpClient->request('GET', 'https://api.scryfall.com/bulk-data', [
            'headers' => $this->headers(),
        ])->toArray();

        foreach ($bulkResponse['data'] ?? [] as $bulkData) {
            if (($bulkData['type'] ?? null) === $bulkType && is_string($bulkData['download_uri'] ?? null)) {
                return $bulkData['download_uri'];
            }
        }

        throw new \RuntimeException(sprintf('Scryfall %s bulk download URI was not found.', $bulkType));
    }

    /**
     * @return array{Accept:string,User-Agent:string}
     */
    private function headers(): array
    {
        return [
            'Accept' => 'application/json;q=0.9,*/*;q=0.8',
            'User-Agent' => $this->userAgent,
        ];
    }
}
