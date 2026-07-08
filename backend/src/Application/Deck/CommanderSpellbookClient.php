<?php

namespace App\Application\Deck;

use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class CommanderSpellbookClient
{
    private const BASE_URL = 'https://backend.commanderspellbook.com';
    private const MAX_RETRIES = 3;

    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly string $userAgent = 'CommanderZone/1.0 deck-analysis',
        private readonly int $pageLimit = 500,
        private readonly int $throttleMicros = 500000,
    ) {
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    public function features(): iterable
    {
        yield from $this->pagedEndpoint('/features/');
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    public function templates(): iterable
    {
        yield from $this->pagedEndpoint('/templates/');
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    public function variants(): iterable
    {
        yield from $this->pagedEndpoint('/variants/');
    }

    /**
     * @return list<string>
     */
    public function endpointNames(): array
    {
        return ['features', 'templates', 'variants'];
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    private function pagedEndpoint(string $path): iterable
    {
        $url = self::BASE_URL.$path.'?limit='.$this->pageLimit;

        do {
            $payload = $this->requestJson($url);
            $this->throttle();

            $results = $payload['results'] ?? [];
            if (!is_array($results)) {
                throw new \RuntimeException(sprintf('Commander Spellbook endpoint returned invalid results: %s', $url));
            }

            foreach ($results as $result) {
                if (is_array($result)) {
                    yield $result;
                }
            }

            $next = $payload['next'] ?? null;
            $url = is_string($next) && trim($next) !== '' ? $next : null;
        } while ($url !== null);
    }

    /**
     * @return array<string,mixed>
     */
    private function requestJson(string $url): array
    {
        $attempt = 0;
        $lastError = null;

        while ($attempt <= self::MAX_RETRIES) {
            try {
                $response = $this->httpClient->request('GET', $url, [
                    'headers' => [
                        'Accept' => 'application/json;q=0.9,*/*;q=0.8',
                        'User-Agent' => $this->userAgent,
                    ],
                    'timeout' => 30,
                ]);
                $statusCode = $response->getStatusCode();

                if ($statusCode >= 200 && $statusCode < 300) {
                    $payload = $response->toArray(false);

                    return is_array($payload) ? $payload : [];
                }

                $lastError = sprintf('HTTP %d', $statusCode);
                if (!in_array($statusCode, [429, 500, 502, 503, 504], true) || $attempt >= self::MAX_RETRIES) {
                    break;
                }

                $headers = $response->getHeaders(false);
                sleep($this->retryAfterSeconds($headers['retry-after'][0] ?? null, $attempt, $statusCode === 429));
            } catch (ExceptionInterface $exception) {
                $lastError = $exception->getMessage();
                if ($attempt >= self::MAX_RETRIES) {
                    break;
                }

                sleep($this->retryAfterSeconds(null, $attempt, false));
            }

            ++$attempt;
        }

        throw new \RuntimeException(sprintf('Commander Spellbook request failed for %s: %s', $url, $lastError ?? 'unknown error'));
    }

    private function retryAfterSeconds(mixed $value, int $attempt, bool $rateLimited): int
    {
        if (is_numeric($value)) {
            return max(1, min(120, (int) $value));
        }

        if ($rateLimited) {
            return 120;
        }

        return min(10, $attempt + 1);
    }

    private function throttle(): void
    {
        if ($this->throttleMicros > 0) {
            usleep($this->throttleMicros);
        }
    }
}
