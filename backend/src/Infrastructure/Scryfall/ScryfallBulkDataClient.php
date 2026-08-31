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

        if (str_ends_with(strtolower($file), '.jsonl.gz')) {
            return $this->loadGzipJsonLines($file);
        }

        return Items::fromFile($file, ['decoder' => new ExtJsonDecoder(true)]);
    }

    private function downloadBulkItems(string $bulkType): iterable
    {
        $bulkDownload = $this->bulkDownloadForType($bulkType);
        $temporaryFile = tempnam(sys_get_temp_dir(), sprintf('scryfall-%s-', str_replace('_', '-', $bulkType)));
        if ($temporaryFile === false) {
            throw new \RuntimeException('Could not create temporary file for Scryfall bulk download.');
        }

        $handle = fopen($temporaryFile, 'wb');
        if ($handle === false) {
            throw new \RuntimeException('Could not open temporary file for Scryfall bulk download.');
        }

        try {
            $response = $this->httpClient->request('GET', $bulkDownload['uri'], ['headers' => $this->headers()]);
            foreach ($this->httpClient->stream($response) as $chunk) {
                if (fwrite($handle, $chunk->getContent()) === false) {
                    throw new \RuntimeException('Could not write the Scryfall bulk download.');
                }
            }
            fclose($handle);
            $handle = null;

            if ($bulkDownload['format'] === 'jsonl_gzip') {
                yield from $this->loadGzipJsonLines($temporaryFile);

                return;
            }

            yield from Items::fromFile($temporaryFile, ['decoder' => new ExtJsonDecoder(true)]);
        } finally {
            if (is_resource($handle)) {
                fclose($handle);
            }
            @unlink($temporaryFile);
        }
    }

    /**
     * @return array{uri:string,format:'json_array'|'jsonl_gzip'}
     */
    private function bulkDownloadForType(string $bulkType): array
    {
        $bulkResponse = $this->httpClient->request('GET', 'https://api.scryfall.com/bulk-data', [
            'headers' => $this->headers(),
        ])->toArray();

        foreach ($bulkResponse['data'] ?? [] as $bulkData) {
            if (($bulkData['type'] ?? null) !== $bulkType) {
                continue;
            }

            if (is_string($bulkData['download_uri'] ?? null) && $bulkData['download_uri'] !== '') {
                return ['uri' => $bulkData['download_uri'], 'format' => 'json_array'];
            }

            if (is_string($bulkData['jsonl_download_uri'] ?? null) && $bulkData['jsonl_download_uri'] !== '') {
                return ['uri' => $bulkData['jsonl_download_uri'], 'format' => 'jsonl_gzip'];
            }
        }

        throw new ScryfallBulkDataTypeNotFound($bulkType);
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    private function loadGzipJsonLines(string $file): iterable
    {
        $handle = gzopen($file, 'rb');
        if ($handle === false) {
            throw new \RuntimeException(sprintf('Could not open Scryfall JSONL gzip file "%s".', $file));
        }

        try {
            while (($line = gzgets($handle)) !== false) {
                $line = trim($line);
                if ($line === '') {
                    continue;
                }

                $item = json_decode($line, true, 512, JSON_THROW_ON_ERROR);
                if (!is_array($item)) {
                    throw new \UnexpectedValueException('Scryfall JSONL entries must be JSON objects.');
                }

                yield $item;
            }
        } finally {
            gzclose($handle);
        }
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
