<?php

namespace App\Infrastructure\Observability;

final class RequestPerformanceContext
{
    private float $sqlDurationMs = 0.0;
    private int $queryCount = 0;
    private int $rows = 0;
    private array $stages = [];
    private int $failedQueries = 0;

    public function reset(): void
    {
        $this->sqlDurationMs = 0.0;
        $this->queryCount = 0;
        $this->rows = 0;
        $this->stages = [];
        $this->failedQueries = 0;
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
        try {
            return $operation();
        } finally {
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
        return [
            'sql_duration_ms' => round($this->sqlDurationMs, 3),
            'query_count' => $this->queryCount,
            'rows' => $this->rows,
            'failed_queries' => $this->failedQueries,
            'stages' => $this->stages,
            'peak_memory_bytes' => memory_get_peak_usage(true),
        ];
    }
}
