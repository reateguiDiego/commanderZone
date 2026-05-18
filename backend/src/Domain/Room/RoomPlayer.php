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

    #[ORM\Column(type: 'integer', nullable: true)]
    private ?int $turnRoll = null;

    /**
     * @var list<int>
     */
    #[ORM\Column(type: 'json')]
    private array $turnRolls = [];

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $joinedAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    public function __construct(Room $room, User $user, ?Deck $deck = null)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->room = $room;
        $this->user = $user;
        $this->deck = $deck;
        $this->joinedAt = new \DateTimeImmutable();
        $this->updatedAt = $this->joinedAt;
    }

    public function user(): User
    {
        return $this->user;
    }

    public function id(): string
    {
        return $this->id;
    }

    public function deck(): ?Deck
    {
        return $this->deck;
    }

    public function turnRoll(): ?int
    {
        return $this->turnRoll;
    }

    /**
     * @return list<int>
     */
    public function turnRolls(): array
    {
        if ($this->turnRolls === [] && $this->turnRoll !== null) {
            return [$this->turnRoll];
        }

        return array_values(array_filter(
            $this->turnRolls,
            static fn (mixed $roll): bool => is_int($roll) && $roll >= 1 && $roll <= 20,
        ));
    }

    public function joinedAt(): \DateTimeImmutable
    {
        return $this->joinedAt;
    }

    public function changeDeck(?Deck $deck): void
    {
        $this->deck = $deck;
        $this->touch();
    }

    public function rollTurnOrder(int $roll): void
    {
        $normalizedRoll = max(1, min(20, $roll));
        $this->turnRolls = [...$this->turnRolls(), $normalizedRoll];
        $this->turnRoll = $normalizedRoll;
        $this->touch();
    }

    public function clearTurnRoll(): void
    {
        if ($this->turnRoll === null && $this->turnRolls === []) {
            return;
        }

        $this->turnRoll = null;
        $this->turnRolls = [];
        $this->touch();
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'user' => $this->user->toArray(),
            'deckId' => $this->deck?->id(),
            'deck' => $this->deck?->toArray(),
            'turnRoll' => $this->turnRoll,
            'turnRolls' => $this->turnRolls(),
        ];
    }

    private function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }
}
