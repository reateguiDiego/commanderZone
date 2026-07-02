<?php

namespace App\Domain\Auth;

use App\Domain\User\User;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'auth_identity')]
#[ORM\UniqueConstraint(name: 'uniq_auth_identity_provider_user', columns: ['provider', 'provider_user_id'])]
#[ORM\Index(name: 'idx_auth_identity_user', columns: ['user_id'])]
class AuthIdentity
{
    public const PROVIDER_GOOGLE = 'google';

    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(type: 'string', length: 32)]
    private string $provider;

    #[ORM\Column(name: 'provider_user_id', type: 'string', length: 255)]
    private string $providerUserId;

    #[ORM\Column(name: 'provider_email', type: 'string', length: 180)]
    private string $providerEmail;

    #[ORM\Column(name: 'provider_email_verified', type: 'boolean')]
    private bool $providerEmailVerified;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $lastUsedAt = null;

    public function __construct(
        User $user,
        string $provider,
        string $providerUserId,
        string $providerEmail,
        bool $providerEmailVerified,
    ) {
        if (!self::isSupportedProvider($provider)) {
            throw new \InvalidArgumentException('Unsupported auth identity provider.');
        }

        $this->id = Uuid::v7()->toRfc4122();
        $this->user = $user;
        $this->provider = $provider;
        $this->providerUserId = trim($providerUserId);
        $this->providerEmail = mb_strtolower(trim($providerEmail));
        $this->providerEmailVerified = $providerEmailVerified;
        $this->createdAt = new \DateTimeImmutable();
        $this->updatedAt = $this->createdAt;
    }

    public function user(): User
    {
        return $this->user;
    }

    public function provider(): string
    {
        return $this->provider;
    }

    public function providerUserId(): string
    {
        return $this->providerUserId;
    }

    public function providerEmail(): string
    {
        return $this->providerEmail;
    }

    public function providerEmailVerified(): bool
    {
        return $this->providerEmailVerified;
    }

    public function markUsed(?\DateTimeImmutable $usedAt = null): void
    {
        $this->lastUsedAt = $usedAt ?? new \DateTimeImmutable();
        $this->touch();
    }

    public static function isSupportedProvider(string $provider): bool
    {
        return in_array($provider, [self::PROVIDER_GOOGLE], true);
    }

    private function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }
}
