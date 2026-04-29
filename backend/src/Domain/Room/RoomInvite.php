<?php

namespace App\Domain\Room;

use App\Domain\User\User;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'room_invite')]
#[ORM\Index(name: 'idx_room_invite_recipient', columns: ['recipient_id'])]
#[ORM\Index(name: 'idx_room_invite_room', columns: ['room_id'])]
class RoomInvite
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_ACCEPTED = 'accepted';
    public const STATUS_DECLINED = 'declined';

    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Room::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Room $room;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $sender;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $recipient;

    #[ORM\Column(type: 'string', length: 24)]
    private string $status = self::STATUS_PENDING;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    public function __construct(Room $room, User $sender, User $recipient)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->room = $room;
        $this->sender = $sender;
        $this->recipient = $recipient;
        $this->createdAt = new \DateTimeImmutable();
        $this->updatedAt = $this->createdAt;
    }

    public function id(): string
    {
        return $this->id;
    }

    public function room(): Room
    {
        return $this->room;
    }

    public function sender(): User
    {
        return $this->sender;
    }

    public function recipient(): User
    {
        return $this->recipient;
    }

    public function status(): string
    {
        return $this->status;
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

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'room' => $this->room->toArray(),
            'sender' => [
                'id' => $this->sender->id(),
                'displayName' => $this->sender->displayName(),
            ],
            'recipient' => [
                'id' => $this->recipient->id(),
                'displayName' => $this->recipient->displayName(),
            ],
            'createdAt' => $this->createdAt->format(DATE_ATOM),
            'updatedAt' => $this->updatedAt->format(DATE_ATOM),
        ];
    }

    private function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }
}
