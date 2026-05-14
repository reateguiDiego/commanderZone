<?php

namespace App\Domain\Auth;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'auth_request_throttle')]
#[ORM\UniqueConstraint(name: 'uniq_auth_request_throttle_scope_identifier', columns: ['scope', 'identifier'])]
class AuthRequestThrottle
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\Column(type: 'string', length: 48)]
    private string $scope;

    #[ORM\Column(type: 'string', length: 191)]
    private string $identifier;

    #[ORM\Column(type: 'integer')]
    private int $hits = 0;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $windowStartedAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    public function __construct(string $scope, string $identifier, \DateTimeImmutable $now)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->scope = trim($scope);
        $this->identifier = trim($identifier);
        $this->windowStartedAt = $now;
        $this->updatedAt = $now;
    }

    public function consume(\DateTimeImmutable $now, int $windowSeconds): void
    {
        $windowStart = $now->modify(sprintf('-%d seconds', $windowSeconds));
        if ($this->windowStartedAt <= $windowStart) {
            $this->windowStartedAt = $now;
            $this->hits = 0;
        }

        $this->hits++;
        $this->touch();
    }

    public function exceedsLimit(\DateTimeImmutable $now, int $windowSeconds, int $maxHits): bool
    {
        $windowStart = $now->modify(sprintf('-%d seconds', $windowSeconds));
        if ($this->windowStartedAt <= $windowStart) {
            return false;
        }

        return $this->hits >= $maxHits;
    }

    private function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }
}
