<?php

namespace App\Domain\Auth;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'login_attempt')]
#[ORM\UniqueConstraint(name: 'uniq_login_attempt_scope_identifier', columns: ['scope', 'identifier'])]
class LoginAttempt
{
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

    public function registerFailure(\DateTimeImmutable $now, int $baseThreshold = 5): void
    {
        $this->failureCount++;
        $this->lastFailedAt = $now;

        if ($this->failureCount < $baseThreshold) {
            return;
        }

        $overflow = $this->failureCount - $baseThreshold;
        $multiplier = 2 ** min(5, $overflow);
        $seconds = min(900, 30 * $multiplier);
        $this->lockoutUntil = $now->modify(sprintf('+%d seconds', $seconds));
    }

    public function resetFailures(): void
    {
        $this->failureCount = 0;
        $this->lockoutUntil = null;
        $this->lastFailedAt = null;
    }
}
