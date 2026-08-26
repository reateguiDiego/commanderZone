<?php

namespace App\Application\Room\Lifecycle;

final readonly class WaitingRoomInactivityPolicy
{
    public const DEFAULT_GRACE_SECONDS = 1800;

    public function __construct(private int $graceSeconds = self::DEFAULT_GRACE_SECONDS)
    {
        if ($this->graceSeconds < 1) {
            throw new \InvalidArgumentException('Waiting-room grace must be positive.');
        }
    }

    public function expiresFrom(\DateTimeImmutable $activityAt): \DateTimeImmutable
    {
        return $activityAt->modify(sprintf('+%d seconds', $this->graceSeconds));
    }

    public function expiresFromNow(): \DateTimeImmutable
    {
        return $this->expiresFrom(new \DateTimeImmutable());
    }
}
