<?php

namespace App\Domain\Auth;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'login_attempt')]
#[ORM\UniqueConstraint(name: 'uniq_login_attempt_scope_identifier', columns: ['scope', 'identifier'])]
class LoginAttempt
{
    private const FAILURE_WINDOW_SECONDS = 900;
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

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    public function __construct(string $scope, string $identifier)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->scope = trim($scope);
        $this->identifier = trim($identifier);
        $this->updatedAt = new \DateTimeImmutable();
    }

    public function isLockedAt(\DateTimeImmutable $now): bool
    {
        return $this->lockoutUntil !== null && $this->lockoutUntil > $now;
    }

    public function activeFailureCountAt(\DateTimeImmutable $now): int
    {
        $windowStart = $now->modify(sprintf('-%d seconds', self::FAILURE_WINDOW_SECONDS));
        if ($this->lastFailedAt === null || $this->lastFailedAt <= $windowStart) {
            return 0;
        }

        return $this->failureCount;
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
        $this->touch();
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
        $this->touch();
    }

    private function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }
}
