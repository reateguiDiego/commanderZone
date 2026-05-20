<?php

namespace App\Domain\Auth;

use App\Domain\User\User;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'refresh_session')]
#[ORM\UniqueConstraint(name: 'uniq_refresh_session_token_hash', columns: ['token_hash'])]
#[ORM\Index(name: 'idx_refresh_session_user', columns: ['user_id'])]
#[ORM\Index(name: 'idx_refresh_session_expires_at', columns: ['expires_at'])]
class RefreshSession
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(name: 'token_hash', type: 'string', length: 64)]
    private string $tokenHash;

    #[ORM\Column(name: 'replaced_by_token_hash', type: 'string', length: 64, nullable: true)]
    private ?string $replacedByTokenHash = null;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $expiresAt;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $rotatedAt = null;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $revokedAt = null;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $lastUsedAt = null;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    #[ORM\Column(type: 'string', length: 64, nullable: true)]
    private ?string $requestIp;

    #[ORM\Column(type: 'string', length: 255, nullable: true)]
    private ?string $requestUserAgent;

    public function __construct(
        User $user,
        string $tokenHash,
        \DateTimeImmutable $expiresAt,
        ?string $requestIp = null,
        ?string $requestUserAgent = null,
    ) {
        $this->id = Uuid::v7()->toRfc4122();
        $this->user = $user;
        $this->tokenHash = $tokenHash;
        $this->expiresAt = $expiresAt;
        $this->createdAt = new \DateTimeImmutable();
        $this->updatedAt = $this->createdAt;
        $this->requestIp = $requestIp;
        $this->requestUserAgent = $requestUserAgent;
    }

    public function user(): User
    {
        return $this->user;
    }

    public function tokenHash(): string
    {
        return $this->tokenHash;
    }

    public function replacedByTokenHash(): ?string
    {
        return $this->replacedByTokenHash;
    }

    public function rotatedAt(): ?\DateTimeImmutable
    {
        return $this->rotatedAt;
    }

    public function isActiveAt(\DateTimeImmutable $now): bool
    {
        return $this->revokedAt === null
            && $this->rotatedAt === null
            && $this->expiresAt > $now;
    }

    public function isReplayCandidateAt(\DateTimeImmutable $now): bool
    {
        return $this->replacedByTokenHash !== null
            || ($this->rotatedAt !== null && $this->expiresAt > $now);
    }

    public function markRotated(string $replacedByTokenHash, ?\DateTimeImmutable $rotatedAt = null): void
    {
        $this->replacedByTokenHash = $replacedByTokenHash;
        $this->rotatedAt = $rotatedAt ?? new \DateTimeImmutable();
        $this->lastUsedAt = $this->rotatedAt;
        $this->touch();
    }

    public function revoke(?\DateTimeImmutable $revokedAt = null): void
    {
        $this->revokedAt = $revokedAt ?? new \DateTimeImmutable();
        $this->touch();
    }

    public function markUsed(?\DateTimeImmutable $usedAt = null): void
    {
        $this->lastUsedAt = $usedAt ?? new \DateTimeImmutable();
        $this->touch();
    }

    private function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }
}
