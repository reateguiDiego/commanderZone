<?php

namespace App\Infrastructure\Observability;

use Psr\Log\AbstractLogger;

/** Dedicated structured sink; independent of the application's error-only logger. */
final class PerformanceLogger extends AbstractLogger
{
    public function log($level, string|\Stringable $message, array $context = []): void
    {
        file_put_contents('php://stderr', json_encode(['event' => (string) $message, 'level' => $level, ...$context], JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE).PHP_EOL);
    }
}
