<?php

namespace App\Domain\Auth;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'login_attempt')]
#[ORM\UniqueConstraint(name: 'uniq_login_attempt_scope_identifier', columns: ['scope', 'identifier'])]
class LoginAttempt
{
    private const FAILURE_WINDOW_SECONDS = 3600;
    private const MAX_FAILURES_PER_WINDOW = 5;

    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\Column(type: 'string', length: 16)]
    private string $scope;

    #[ORM\Column(type: 'string', length: 191)]
    private string $identifier;

    #[ORM\Column(type: 'integer')]
    private int $failureCount = 0;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $lockoutUntil = null;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $lastFailedAt = null;

    public function __construct(string $scope, string $identifier)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->scope = trim($scope);
        $this->identifier = trim($identifier);
    }

    public function isLockedAt(\DateTimeImmutable $now): bool
    {
        return $this->lockoutUntil !== null && $this->lockoutUntil > $now;
    }

    public function registerFailure(\DateTimeImmutable $now): void
    {
        $windowStart = $now->modify(sprintf('-%d seconds', self::FAILURE_WINDOW_SECONDS));
        if ($this->lastFailedAt === null || $this->lastFailedAt <= $windowStart) {
            $this->failureCount = 0;
            $this->lockoutUntil = null;
            $this->lastFailedAt = $now;
        }

        $this->failureCount++;
        if ($this->failureCount < self::MAX_FAILURES_PER_WINDOW) {
            return;
        }

        $windowAnchor = $this->lastFailedAt ?? $now;
        $this->lockoutUntil = $windowAnchor->modify(sprintf('+%d seconds', self::FAILURE_WINDOW_SECONDS));
    }

    public function resetFailures(): void
    {
        $this->failureCount = 0;
        $this->lockoutUntil = null;
        $this->lastFailedAt = null;
    }
}
