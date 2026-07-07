<?php

namespace App\Application\Card;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ArrayParameterType;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Uid\Uuid;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class ScryfallTagSyncService
{
    public const SOURCE = 'scryfall_tagger';
    private const TAG_TYPE = 'oracle_tag';
    private const SEARCH_URL = 'https://api.scryfall.com/cards/search';
    private const MAX_RATE_LIMIT_RETRIES = 3;

    /**
     * @var list<string>
     */
    public const DEFAULT_QUERIES = [
        'otag:ramp',
        'otag:mana-rock',
        'otag:mana-dork',
        'otag:ritual',
        'otag:cost-reducer',
        'otag:draw',
        'otag:card-advantage',
        'otag:loot',
        'otag:rummage',
        'otag:tutor',
        'otag:removal',
        'otag:creature-removal',
        'otag:artifact-removal',
        'otag:enchantment-removal',
        'otag:board-wipe',
        'otag:counterspell',
        'otag:protection',
        'otag:graveyard-hate',
        'otag:recursion',
        'otag:reanimate',
        'otag:sacrifice-outlet',
        'otag:tax',
        'otag:extra-turn',
        'otag:extra-combat',
        'otag:win-condition',
    ];

    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly Connection $connection,
        #[Autowire('%env(SCRYFALL_USER_AGENT)%')]
        private readonly string $userAgent,
        private readonly int $rateLimitMicros = 250000,
    ) {
    }

    /**
     * @param list<string> $queries
     * @return array{
     *   runId:string,
     *   status:string,
     *   queries:int,
     *   itemsSeen:int,
     *   itemsInserted:int,
     *   itemsUpdated:int,
     *   itemsFailed:int,
     *   warnings:list<string>
     * }
     */
    public function sync(array $queries = self::DEFAULT_QUERIES): array
    {
        $runId = Uuid::v7()->toRfc4122();
        $this->startRun($runId, $queries);

        $itemsSeen = 0;
        $itemsInserted = 0;
        $itemsUpdated = 0;
        $itemsFailed = 0;
        $warnings = [];

        try {
            foreach ($queries as $query) {
                $query = trim($query);
                if ($query === '') {
                    continue;
                }

                $tagSlug = $this->tagSlug($query);
                $result = $this->syncQuery($query, $tagSlug);
                $itemsSeen += $result['seen'];
                $itemsInserted += $result['inserted'];
                $itemsUpdated += $result['updated'];
                $itemsFailed += $result['failed'];
                $warnings = [...$warnings, ...$result['warnings']];
            }

            $this->finishRun($runId, 'success', $itemsSeen, $itemsInserted, $itemsUpdated, $itemsFailed, $warnings);

            return [
                'runId' => $runId,
                'status' => 'success',
                'queries' => count($queries),
                'itemsSeen' => $itemsSeen,
                'itemsInserted' => $itemsInserted,
                'itemsUpdated' => $itemsUpdated,
                'itemsFailed' => $itemsFailed,
                'warnings' => $warnings,
            ];
        } catch (\Throwable $exception) {
            $this->finishRun($runId, 'failed', $itemsSeen, $itemsInserted, $itemsUpdated, $itemsFailed + 1, [$exception->getMessage()]);

            throw $exception;
        }
    }

    /**
     * @return array{seen:int,inserted:int,updated:int,failed:int,warnings:list<string>}
     */
    private function syncQuery(string $query, string $tagSlug): array
    {
        $seen = 0;
        $failed = 0;
        $oracleIds = [];

        foreach ($this->searchCards($query) as $card) {
            ++$seen;
            $oracleId = $this->oracleId($card);
            if ($oracleId === null) {
                ++$failed;
                continue;
            }

            $oracleIds[$oracleId] = true;
        }

        if ($oracleIds === []) {
            return [
                'seen' => $seen,
                'inserted' => 0,
                'updated' => 0,
                'failed' => $failed,
                'warnings' => [sprintf('Scryfall query "%s" returned no usable oracle ids.', $query)],
            ];
        }

        $replace = $this->replaceQueryTags($query, $tagSlug, array_keys($oracleIds));

        return [
            'seen' => $seen,
            'inserted' => $replace['inserted'],
            'updated' => $replace['updated'],
            'failed' => $failed,
            'warnings' => [],
        ];
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    private function searchCards(string $query): iterable
    {
        $url = self::SEARCH_URL;
        $options = [
            'headers' => $this->headers(),
            'query' => [
                'q' => $query,
                'unique' => 'cards',
                'order' => 'name',
            ],
            'timeout' => 30,
        ];

        do {
            [$statusCode, $payload] = $this->requestSearchPage($query, $url, $options);
            $this->throttle();

            if ($statusCode === 404) {
                return;
            }
            if ($statusCode < 200 || $statusCode >= 300) {
                $message = is_string($payload['details'] ?? null) ? $payload['details'] : 'Unexpected Scryfall response.';
                throw new \RuntimeException(sprintf('Scryfall query "%s" failed with HTTP %d: %s', $query, $statusCode, $message));
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
     * @param array<string,mixed> $options
     * @return array{0:int,1:array<string,mixed>}
     */
    private function requestSearchPage(string $query, string $url, array $options): array
    {
        $attempt = 0;

        do {
            try {
                $response = $this->httpClient->request('GET', $url, $options);
                $statusCode = $response->getStatusCode();
                $payload = $response->toArray(false);
            } catch (ExceptionInterface $exception) {
                throw new \RuntimeException(sprintf('Scryfall query "%s" failed: %s', $query, $exception->getMessage()), 0, $exception);
            }

            if ($statusCode !== 429 || $attempt >= self::MAX_RATE_LIMIT_RETRIES) {
                return [$statusCode, is_array($payload) ? $payload : []];
            }

            ++$attempt;
            $headers = $response->getHeaders(false);
            $retryAfter = $this->retryAfterSeconds($headers['retry-after'][0] ?? null);
            sleep($retryAfter);
        } while (true);
    }

    /**
     * @param list<string> $oracleIds
     * @return array{inserted:int,updated:int}
     */
    private function replaceQueryTags(string $query, string $tagSlug, array $oracleIds): array
    {
        return $this->connection->transactional(function () use ($query, $tagSlug, $oracleIds): array {
            $existing = $this->existingTags($tagSlug, $oracleIds);
            $this->connection->executeStatement(
                <<<'SQL'
UPDATE external_card_tag
SET active = false,
    imported_at = NOW()
WHERE source = :source
  AND tag_slug = :tag_slug
  AND import_query = :import_query
  AND active = true
SQL,
                [
                    'source' => self::SOURCE,
                    'tag_slug' => $tagSlug,
                    'import_query' => $query,
                ],
            );

            $inserted = 0;
            $updated = 0;
            foreach ($oracleIds as $oracleId) {
                if (isset($existing[$oracleId])) {
                    ++$updated;
                } else {
                    ++$inserted;
                }

                $this->connection->executeStatement(
                    <<<'SQL'
INSERT INTO external_card_tag (
    id,
    oracle_id,
    source,
    tag_type,
    tag_slug,
    import_query,
    confidence,
    active,
    imported_at
) VALUES (
    :id,
    :oracle_id,
    :source,
    :tag_type,
    :tag_slug,
    :import_query,
    1.0,
    true,
    NOW()
)
ON CONFLICT (oracle_id, source, tag_slug) DO UPDATE SET
    tag_type = EXCLUDED.tag_type,
    import_query = EXCLUDED.import_query,
    confidence = EXCLUDED.confidence,
    active = true,
    imported_at = NOW()
SQL,
                    [
                        'id' => Uuid::v7()->toRfc4122(),
                        'oracle_id' => $oracleId,
                        'source' => self::SOURCE,
                        'tag_type' => self::TAG_TYPE,
                        'tag_slug' => $tagSlug,
                        'import_query' => $query,
                    ],
                );
            }

            return [
                'inserted' => $inserted,
                'updated' => $updated,
            ];
        });
    }

    /**
     * @param list<string> $oracleIds
     * @return array<string,true>
     */
    private function existingTags(string $tagSlug, array $oracleIds): array
    {
        if ($oracleIds === []) {
            return [];
        }

        $rows = $this->connection->fetchFirstColumn(
            <<<'SQL'
SELECT oracle_id
FROM external_card_tag
WHERE source = :source
  AND tag_slug = :tag_slug
  AND oracle_id IN (:oracle_ids)
SQL,
            [
                'source' => self::SOURCE,
                'tag_slug' => $tagSlug,
                'oracle_ids' => $oracleIds,
            ],
            [
                'oracle_ids' => ArrayParameterType::STRING,
            ],
        );

        $existing = [];
        foreach ($rows as $oracleId) {
            $existing[(string) $oracleId] = true;
        }

        return $existing;
    }

    /**
     * @param list<string> $queries
     */
    private function startRun(string $runId, array $queries): void
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
    :status,
    :metadata
)
SQL,
            [
                'id' => $runId,
                'source' => self::SOURCE,
                'status' => 'running',
                'metadata' => $this->json(['queries' => array_values($queries)]),
            ],
        );
    }

    /**
     * @param list<string> $messages
     */
    private function finishRun(
        string $runId,
        string $status,
        int $itemsSeen,
        int $itemsInserted,
        int $itemsUpdated,
        int $itemsFailed,
        array $messages,
    ): void {
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

    private function tagSlug(string $query): string
    {
        $query = trim($query);
        if (str_starts_with($query, 'otag:')) {
            return substr($query, 5);
        }

        return preg_replace('/[^a-z0-9-]+/', '-', mb_strtolower($query)) ?: $query;
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

    private function retryAfterSeconds(mixed $value): int
    {
        if (is_numeric($value)) {
            return max(1, min(120, (int) $value));
        }

        return 60;
    }

    private function throttle(): void
    {
        if ($this->rateLimitMicros > 0) {
            usleep($this->rateLimitMicros);
        }
    }

    private function json(array $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR);
    }
}
