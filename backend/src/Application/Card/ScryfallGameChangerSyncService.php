<?php

namespace App\Application\Card;

use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Uid\Uuid;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class ScryfallGameChangerSyncService
{
    public const SOURCE = 'scryfall_game_changer';
    private const SEARCH_URL = 'https://api.scryfall.com/cards/search';
    private const QUERY = 'is:game-changer';

    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly Connection $connection,
        #[Autowire('%env(SCRYFALL_USER_AGENT)%')]
        private readonly string $userAgent,
        private readonly int $rateLimitMicros = 250000,
    ) {
    }

    /**
     * @return array{runId:string,status:string,itemsSeen:int,itemsUpdated:int,itemsFailed:int,warnings:list<string>}
     */
    public function sync(): array
    {
        $runId = Uuid::v7()->toRfc4122();
        $this->startRun($runId);
        $itemsSeen = 0;
        $itemsFailed = 0;
        $warnings = [];

        try {
            $oracleIds = [];
            foreach ($this->searchGameChangers() as $card) {
                ++$itemsSeen;
                $oracleId = $this->oracleId($card);
                if ($oracleId === null) {
                    ++$itemsFailed;
                    continue;
                }

                $oracleIds[$oracleId] = true;
            }

            if ($oracleIds === []) {
                $warnings[] = 'Scryfall query "'.self::QUERY.'" returned no usable oracle ids.';
            }

            $updated = $this->replaceLocalGameChangers(array_keys($oracleIds));
            $this->finishRun($runId, 'success', $itemsSeen, 0, $updated, $itemsFailed, $warnings);

            return [
                'runId' => $runId,
                'status' => 'success',
                'itemsSeen' => $itemsSeen,
                'itemsUpdated' => $updated,
                'itemsFailed' => $itemsFailed,
                'warnings' => $warnings,
            ];
        } catch (\Throwable $exception) {
            $this->finishRun($runId, 'failed', $itemsSeen, 0, 0, $itemsFailed + 1, [$exception->getMessage()]);

            throw $exception;
        }
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    private function searchGameChangers(): iterable
    {
        $url = self::SEARCH_URL;
        $options = [
            'headers' => $this->headers(),
            'query' => [
                'q' => self::QUERY,
                'unique' => 'cards',
                'order' => 'name',
            ],
            'timeout' => 30,
        ];

        do {
            try {
                $response = $this->httpClient->request('GET', $url, $options);
                $statusCode = $response->getStatusCode();
                $payload = $response->toArray(false);
            } catch (ExceptionInterface $exception) {
                throw new \RuntimeException(sprintf('Scryfall query "%s" failed: %s', self::QUERY, $exception->getMessage()), 0, $exception);
            }

            $this->throttle();

            if ($statusCode < 200 || $statusCode >= 300) {
                $message = is_string($payload['details'] ?? null) ? $payload['details'] : 'Unexpected Scryfall response.';
                throw new \RuntimeException(sprintf('Scryfall query "%s" failed with HTTP %d: %s', self::QUERY, $statusCode, $message));
            }

            foreach (($payload['data'] ?? []) as $card) {
                if (is_array($card)) {
                    yield $card;
                }
            }

            $nextPage = $payload['next_page'] ?? null;
            $hasMore = ($payload['has_more'] ?? false) === true && is_string($nextPage) && trim($nextPage) !== '';
            $url = $hasMore ? $nextPage : '';
            $options = [
                'headers' => $this->headers(),
                'timeout' => 30,
            ];
        } while ($hasMore);
    }

    /**
     * @param list<string> $oracleIds
     */
    private function replaceLocalGameChangers(array $oracleIds): int
    {
        return $this->connection->transactional(function () use ($oracleIds): int {
            $changed = $this->connection->executeStatement(
                'UPDATE card_oracle_profile SET is_game_changer = false, updated_at = NOW() WHERE is_game_changer = true',
            );

            if ($oracleIds === []) {
                return $changed;
            }

            $changed += $this->connection->executeStatement(
                'UPDATE card_oracle_profile SET is_game_changer = true, updated_at = NOW() WHERE oracle_id IN (:oracle_ids)',
                ['oracle_ids' => $oracleIds],
                ['oracle_ids' => ArrayParameterType::STRING],
            );

            return $changed;
        });
    }

    private function startRun(string $runId): void
    {
        $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO external_sync_run (
    id,
    source,
    started_at,
    status,
    metadata
) VALUES (
    :id,
    :source,
    NOW(),
    'running',
    :metadata
)
SQL,
            [
                'id' => $runId,
                'source' => self::SOURCE,
                'metadata' => $this->json(['query' => self::QUERY]),
            ],
        );
    }

    /**
     * @param list<string> $messages
     */
    private function finishRun(string $runId, string $status, int $itemsSeen, int $itemsInserted, int $itemsUpdated, int $itemsFailed, array $messages): void
    {
        $this->connection->executeStatement(
            <<<'SQL'
UPDATE external_sync_run
SET finished_at = NOW(),
    status = :status,
    items_seen = :items_seen,
    items_inserted = :items_inserted,
    items_updated = :items_updated,
    items_failed = :items_failed,
    error_summary = :error_summary
WHERE id = :id
SQL,
            [
                'id' => $runId,
                'status' => $status,
                'items_seen' => $itemsSeen,
                'items_inserted' => $itemsInserted,
                'items_updated' => $itemsUpdated,
                'items_failed' => $itemsFailed,
                'error_summary' => $messages === [] ? null : implode("\n", array_slice($messages, 0, 10)),
            ],
        );
    }

    /**
     * @param array<string,mixed> $card
     */
    private function oracleId(array $card): ?string
    {
        $oracleId = $card['oracle_id'] ?? null;
        if (!is_scalar($oracleId)) {
            return null;
        }

        $oracleId = trim((string) $oracleId);

        return $oracleId !== '' ? $oracleId : null;
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

    private function throttle(): void
    {
        if ($this->rateLimitMicros > 0) {
            usleep($this->rateLimitMicros);
        }
    }

    /**
     * @param array<string,mixed> $value
     */
    private function json(array $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR);
    }
}
