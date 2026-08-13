<?php

namespace App\Application\Game\Lifecycle;

/**
 * Keeps an abandoned game warm briefly for network recovery, then lets its
 * runtime actor hibernate while Symfony retains the durable expiry deadline.
 */
final readonly class AllDisconnectedGracePolicy
{
    public const DEFAULT_HOT_GRACE_SECONDS = 120;
    public const DEFAULT_TOTAL_GRACE_SECONDS = 1800;

    public function __construct(
        private int $hotGraceSeconds = self::DEFAULT_HOT_GRACE_SECONDS,
        private int $totalGraceSeconds = self::DEFAULT_TOTAL_GRACE_SECONDS,
    ) {
        if ($this->hotGraceSeconds < 1) {
            throw new \InvalidArgumentException('All-disconnected hot grace must be positive.');
        }
        if ($this->totalGraceSeconds <= $this->hotGraceSeconds) {
            throw new \InvalidArgumentException('All-disconnected total grace must exceed hot grace.');
        }
    }

    public function hibernateAt(\DateTimeImmutable $disconnectedAt): \DateTimeImmutable
    {
        return $disconnectedAt->modify(sprintf('+%d seconds', $this->hotGraceSeconds));
    }

    public function expiresAt(\DateTimeImmutable $disconnectedAt): \DateTimeImmutable
    {
        return $disconnectedAt->modify(sprintf('+%d seconds', $this->totalGraceSeconds));
    }
}
