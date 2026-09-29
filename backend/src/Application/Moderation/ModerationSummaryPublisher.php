<?php

declare(strict_types=1);

namespace App\Application\Moderation;

use Psr\Log\LoggerInterface;
use Symfony\Component\Mercure\HubInterface;
use Symfony\Component\Mercure\Update;

/** Publishes invalidations only; clients reload the lightweight summary endpoint. */
class ModerationSummaryPublisher
{
    public const TOPIC = 'admin/reports/summary';

    public function __construct(
        private readonly HubInterface $hub,
        private readonly ?LoggerInterface $logger = null,
    )
    {
    }

    public function invalidate(): void
    {
        try {
            $this->hub->publish(new Update(
                self::TOPIC,
                json_encode(['type' => 'moderation.reports.invalidated'], JSON_THROW_ON_ERROR),
                true,
            ));
        } catch (\Throwable $exception) {
            // Data commits do not depend on realtime delivery; clients retain
            // the summary endpoint as their authoritative fallback.
            try {
                $this->logger?->warning('Could not publish moderation summary invalidation.', [
                    'exception' => $exception,
                ]);
            } catch (\Throwable) {
                // Logging infrastructure is optional too. Mutations have
                // already committed and must remain successful when either
                // Mercure or logging is unavailable.
            }
        }
    }
}
