<?php

namespace App\Domain\Room;

use App\Domain\Deck\Deck;
use App\Domain\User\User;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'room_player')]
#[ORM\UniqueConstraint(name: 'uniq_room_player_user', columns: ['room_id', 'user_id'])]
class RoomPlayer
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Room::class, inversedBy: 'players')]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Room $room;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false)]
    private User $user;

    #[ORM\ManyToOne(targetEntity: Deck::class)]
    private ?Deck $deck;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $joinedAt;

    public function __construct(Room $room, User $user, ?Deck $deck = null)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->room = $room;
        $this->user = $user;
        $this->deck = $deck;
        $this->joinedAt = new \DateTimeImmutable();
    }

    public function user(): User
    {
        return $this->user;
    }

    public function deck(): ?Deck
    {
        return $this->deck;
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'user' => $this->user->toArray(),
            'deckId' => $this->deck?->id(),
        ];
    }
}
