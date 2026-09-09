<?php

namespace App\Infrastructure\Observability;

final class RequestPerformanceContext
{
    private float $sqlDurationMs = 0.0;
    private int $queryCount = 0;
    private int $rows = 0;

    public function reset(): void
    {
        $this->sqlDurationMs = 0.0;
        $this->queryCount = 0;
        $this->rows = 0;
    }

    public function recordQuery(float $durationMs, int $rows = 0): void
    {
        $this->sqlDurationMs += $durationMs;
        ++$this->queryCount;
        $this->rows += max(0, $rows);
    }

    /** @return array{sql_duration_ms: float, query_count: int, rows: int} */
    public function metrics(): array
    {
        return [
            'sql_duration_ms' => round($this->sqlDurationMs, 3),
            'query_count' => $this->queryCount,
            'rows' => $this->rows,
        ];
    }
}
