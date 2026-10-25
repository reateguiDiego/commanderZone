<?php

namespace App\Infrastructure\Observability;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

final class RequestPerformanceContext
{
    private float $sqlDurationMs = 0.0;
    private int $queryCount = 0;
    private int $rows = 0;
    private array $stages = [];
    private int $failedQueries = 0;
    private float $connectionDurationMs = 0.0;
    private int $connectionCount = 0;
    private int $failedConnections = 0;
    private bool $profileEnabled = false;
    private array $queryProfiles = [];
    private int $droppedQueryProfiles = 0;
    private ?string $currentStage = null;

    public function __construct(
        #[Autowire(env: 'default::DECK_DETAIL_SQL_PROFILE_SLUG')]
        private readonly ?string $profileSlug = null,
    ) {
    }

    public function enableDeckSqlProfile(string $slug): void
    {
        $this->profileEnabled = $this->profileSlug !== null && $this->profileSlug !== '' && $slug === $this->profileSlug;
    }

    public function recordQueryProfile(string $sql, float $prepareMs, float $executeMs, int $rows, bool $failed): ?SqlQueryProfile
    {
        if (!$this->profileEnabled) return null;
        if (count($this->queryProfiles) >= 64) {
            ++$this->droppedQueryProfiles;
            return null;
        }
        // Only a fingerprint leaves the process, never SQL, literals or bindings.
        $profile = new SqlQueryProfile();
        $profile->values = [
            'sequence' => $this->queryCount, 'fingerprint' => hash('sha256', trim((string) preg_replace('/\s+/', ' ', $sql))),
            'stage' => $this->currentStage, 'prepare_ms' => round($prepareMs, 3),
            'execute_ms' => round($executeMs, 3), 'rows' => max(0, $rows), 'failed' => $failed,
        ];
        $this->queryProfiles[] = $profile;
        return $profile;
    }

    public function reset(): void
    {
        $this->sqlDurationMs = 0.0;
        $this->queryCount = 0;
        $this->rows = 0;
        $this->stages = [];
        $this->failedQueries = 0;
        $this->connectionDurationMs = 0.0;
        $this->connectionCount = 0;
        $this->failedConnections = 0;
        $this->profileEnabled = false;
        $this->queryProfiles = [];
        $this->droppedQueryProfiles = 0;
        $this->currentStage = null;
    }

    public function recordConnection(float $durationMs, bool $failed = false): void
    {
        $this->connectionDurationMs += $durationMs;
        ++$this->connectionCount;
        $this->failedConnections += (int) $failed;
    }

    public function recordQuery(float $durationMs, int $rows = 0, bool $failed = false): void
    {
        $this->sqlDurationMs += $durationMs;
        ++$this->queryCount;
        $this->rows += max(0, $rows);
        $this->failedQueries += (int) $failed;
    }

    public function measure(string $stage, callable $operation): mixed
    {
        $started = hrtime(true);
        $queries = $this->queryCount;
        $rows = $this->rows;
        $previousStage = $this->currentStage;
        $this->currentStage = $stage;
        try {
            return $operation();
        } finally {
            $this->currentStage = $previousStage;
            $previous = $this->stages[$stage] ?? ['duration_ms' => 0, 'queries' => 0, 'rows' => 0, 'calls' => 0];
            $this->stages[$stage] = [
                'duration_ms' => round($previous['duration_ms'] + (hrtime(true) - $started) / 1_000_000, 3),
                'queries' => $previous['queries'] + $this->queryCount - $queries,
                'rows' => $previous['rows'] + $this->rows - $rows,
                'calls' => $previous['calls'] + 1,
            ];
        }
    }

    /** @return array{sql_duration_ms: float, query_count: int, rows: int} */
    public function metrics(): array
    {
        $metrics = [
            'sql_duration_ms' => round($this->sqlDurationMs, 3),
            'query_count' => $this->queryCount,
            'rows' => $this->rows,
            'failed_queries' => $this->failedQueries,
            'db_connection_duration_ms' => round($this->connectionDurationMs, 3),
            'db_connection_count' => $this->connectionCount,
            'db_failed_connections' => $this->failedConnections,
            'stages' => $this->stages,
            'peak_memory_bytes' => memory_get_peak_usage(true),
        ];
        if ($this->profileEnabled) {
            $metrics['sql_profile'] = array_map(static fn (SqlQueryProfile $profile): array => $profile->metrics(), $this->queryProfiles);
            $metrics['sql_profile_dropped'] = $this->droppedQueryProfiles;
        }
        return $metrics;
    }
}
