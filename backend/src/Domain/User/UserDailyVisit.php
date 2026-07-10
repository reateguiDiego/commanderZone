<?php

namespace App\Domain\User;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity(repositoryClass: UserDailyVisitRepository::class)]
#[ORM\Table(name: 'user_daily_visit')]
#[ORM\UniqueConstraint(name: 'uniq_user_daily_visit_user_date', columns: ['user_id', 'visit_date'])]
#[ORM\Index(name: 'idx_user_daily_visit_date', columns: ['visit_date'])]
#[ORM\Index(name: 'idx_user_daily_visit_user_first_seen', columns: ['user_id', 'first_seen_at'])]
#[ORM\Index(name: 'idx_user_daily_visit_country_code', columns: ['country_code'])]
class UserDailyVisit
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(type: 'date_immutable')]
    private \DateTimeImmutable $visitDate;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $firstSeenAt;

    #[ORM\Column(type: 'string', length: 2, nullable: true)]
    private ?string $countryCode;

    #[ORM\Column(type: 'string', length: 120, nullable: true)]
    private ?string $countryName;

    #[ORM\Column(type: 'string', length: 8, nullable: true)]
    private ?string $continentCode;

    #[ORM\Column(type: 'string', length: 64, nullable: true)]
    private ?string $ipHash;

    #[ORM\Column(type: 'string', length: 64, nullable: true)]
    private ?string $ipPrefix;

    #[ORM\Column(type: 'string', length: 64, nullable: true)]
    private ?string $userAgentHash;

    #[ORM\Column(type: 'string', length: 64, nullable: true)]
    private ?string $geoSource;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    public function __construct(
        User $user,
        \DateTimeImmutable $visitDate,
        \DateTimeImmutable $firstSeenAt,
        ?string $countryCode,
        ?string $countryName,
        ?string $continentCode,
        ?string $ipHash,
        ?string $ipPrefix,
        ?string $userAgentHash,
        ?string $geoSource,
        ?\DateTimeImmutable $createdAt = null,
    ) {
        $this->id = Uuid::v7()->toRfc4122();
        $this->user = $user;
        $this->visitDate = $visitDate;
        $this->firstSeenAt = $firstSeenAt;
        $this->countryCode = $countryCode;
        $this->countryName = $countryName;
        $this->continentCode = $continentCode;
        $this->ipHash = $ipHash;
        $this->ipPrefix = $ipPrefix;
        $this->userAgentHash = $userAgentHash;
        $this->geoSource = $geoSource;
        $this->createdAt = $createdAt ?? $firstSeenAt;
    }

    public function id(): string
    {
        return $this->id;
    }

    public function user(): User
    {
        return $this->user;
    }

    public function visitDate(): \DateTimeImmutable
    {
        return $this->visitDate;
    }

    public function firstSeenAt(): \DateTimeImmutable
    {
        return $this->firstSeenAt;
    }

    public function countryCode(): ?string
    {
        return $this->countryCode;
    }

    public function countryName(): ?string
    {
        return $this->countryName;
    }

    public function continentCode(): ?string
    {
        return $this->continentCode;
    }

    public function ipHash(): ?string
    {
        return $this->ipHash;
    }

    public function ipPrefix(): ?string
    {
        return $this->ipPrefix;
    }

    public function userAgentHash(): ?string
    {
        return $this->userAgentHash;
    }

    public function geoSource(): ?string
    {
        return $this->geoSource;
    }

    public function createdAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }
}
