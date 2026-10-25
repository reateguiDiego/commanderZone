<?php

namespace App\Infrastructure\Observability;

/** One execution; retained by its Result so a request reset cannot mix samples. */
final class SqlQueryProfile
{
    public array $values = [];
    public float $fetchMs = 0;
    public int $fetchCalls = 0;
    public int $fetchFailures = 0;

    public function metrics(): array
    {
        return $this->values + ['fetch_ms' => round($this->fetchMs, 3), 'fetch_calls' => $this->fetchCalls, 'fetch_failures' => $this->fetchFailures];
    }
}
