<?php

declare(strict_types=1);

namespace App\Domain\Report;

use App\Domain\User\User;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'user_strike')]
#[ORM\Index(name: 'idx_user_strike_user_created', columns: ['user_id', 'created_at'])]
class UserStrike
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'issued_by_id', referencedColumnName: 'id', nullable: true, onDelete: 'SET NULL')]
    private ?User $issuedBy;

    #[ORM\Column(type: 'text')]
    private string $description;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    public function __construct(User $user, User $issuedBy, string $description, ?\DateTimeImmutable $createdAt = null)
    {
        $description = trim($description);
        if ($description === '') {
            throw new \InvalidArgumentException('A strike description is required.');
        }

        $this->id = Uuid::v7()->toRfc4122();
        $this->user = $user;
        $this->issuedBy = $issuedBy;
        $this->description = mb_substr($description, 0, 4000);
        $this->createdAt = $createdAt ?? new \DateTimeImmutable();
    }

    public function id(): string
    {
        return $this->id;
    }

    public function user(): User
    {
        return $this->user;
    }

    /** @return array<string,mixed> */
    public function toAdminArray(): array
    {
        return [
            'id' => $this->id,
            'description' => $this->description,
            'issuedBy' => $this->issuedBy === null ? null : [
                'id' => $this->issuedBy->id(),
                'displayName' => $this->issuedBy->displayName(),
            ],
            'issuedAt' => $this->createdAt->format(DATE_ATOM),
        ];
    }
}
