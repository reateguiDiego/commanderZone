<?php

namespace App\Domain\Auth;

use App\Domain\User\User;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'password_reset_token')]
#[ORM\UniqueConstraint(name: 'uniq_password_reset_token_hash', columns: ['token_hash'])]
#[ORM\Index(name: 'idx_password_reset_user', columns: ['user_id'])]
#[ORM\Index(name: 'idx_password_reset_expires_at', columns: ['expires_at'])]
class PasswordResetToken
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(name: 'token_hash', type: 'string', length: 64)]
    private string $tokenHash;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $expiresAt;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $usedAt = null;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

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

    public function isUsableAt(\DateTimeImmutable $now): bool
    {
        return $this->usedAt === null && $this->expiresAt > $now;
    }

    public function markUsed(?\DateTimeImmutable $usedAt = null): void
    {
        $this->usedAt = $usedAt ?? new \DateTimeImmutable();
    }
}
