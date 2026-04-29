<?php

namespace App\Domain\Friendship;

use App\Domain\User\User;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'friendship')]
#[ORM\Index(name: 'idx_friendship_requester', columns: ['requester_id'])]
#[ORM\Index(name: 'idx_friendship_recipient', columns: ['recipient_id'])]
class Friendship
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_ACCEPTED = 'accepted';
    public const STATUS_DECLINED = 'declined';
    public const STATUS_BLOCKED = 'blocked';

    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $requester;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $recipient;

    #[ORM\Column(type: 'string', length: 24)]
    private string $status = self::STATUS_PENDING;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    public function __construct(User $requester, User $recipient)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->requester = $requester;
        $this->recipient = $recipient;
        $this->createdAt = new \DateTimeImmutable();
        $this->updatedAt = $this->createdAt;
    }

    public function id(): string
    {
        return $this->id;
    }

    public function requester(): User
    {
        return $this->requester;
    }

    public function recipient(): User
    {
        return $this->recipient;
    }

    public function status(): string
    {
        return $this->status;
    }

    public function involves(User $user): bool
    {
        return $this->requester->id() === $user->id() || $this->recipient->id() === $user->id();
    }

    public function friendFor(User $user): User
    {
        return $this->requester->id() === $user->id() ? $this->recipient : $this->requester;
    }

    public function resendFrom(User $requester, User $recipient): void
    {
        $this->requester = $requester;
        $this->recipient = $recipient;
        $this->status = self::STATUS_PENDING;
        $this->touch();
    }

    public function accept(): void
    {
        $this->status = self::STATUS_ACCEPTED;
        $this->touch();
    }

    public function decline(): void
    {
        $this->status = self::STATUS_DECLINED;
        $this->touch();
    }

    public function toArray(User $viewer, ?string $friendPresence = null): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'requester' => $this->userToArray($this->requester),
            'recipient' => $this->userToArray($this->recipient),
            'friend' => $this->userToArray($this->friendFor($viewer), $friendPresence),
            'createdAt' => $this->createdAt->format(DATE_ATOM),
            'updatedAt' => $this->updatedAt->format(DATE_ATOM),
        ];
    }

    private function userToArray(User $user, ?string $presence = null): array
    {
        $data = [
            'id' => $user->id(),
            'displayName' => $user->displayName(),
        ];

        if ($presence !== null) {
            $data['presence'] = $presence;
        }

        return $data;
    }

    private function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }
}
