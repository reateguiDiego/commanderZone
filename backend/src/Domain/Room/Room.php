<?php

namespace App\Domain\Room;

use App\Domain\Game\Game;
use App\Domain\User\User;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'room')]
class Room
{
    public const STATUS_WAITING = 'waiting';
    public const STATUS_STARTED = 'started';

    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false)]
    private User $owner;

    #[ORM\Column(type: 'string', length: 40)]
    private string $status = self::STATUS_WAITING;

    #[ORM\OneToMany(mappedBy: 'room', targetEntity: RoomPlayer::class, cascade: ['persist', 'remove'], orphanRemoval: true)]
    private Collection $players;

    #[ORM\OneToOne(targetEntity: Game::class)]
    private ?Game $game = null;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    public function __construct(User $owner)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->owner = $owner;
        $this->players = new ArrayCollection();
        $this->createdAt = new \DateTimeImmutable();
    }

    public function id(): string
    {
        return $this->id;
    }

    public function owner(): User
    {
        return $this->owner;
    }

    public function status(): string
    {
        return $this->status;
    }

    public function players(): Collection
    {
        return $this->players;
    }

    public function game(): ?Game
    {
        return $this->game;
    }

    public function addPlayer(RoomPlayer $player): void
    {
        foreach ($this->players as $existing) {
            if ($existing->user()->id() === $player->user()->id()) {
                return;
            }
        }

        $this->players->add($player);
    }

    public function removeUser(User $user): void
    {
        foreach ($this->players as $player) {
            if ($player->user()->id() === $user->id()) {
                $this->players->removeElement($player);
            }
        }
    }

    public function start(Game $game): void
    {
        $this->status = self::STATUS_STARTED;
        $this->game = $game;
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'owner' => $this->owner->toArray(),
            'status' => $this->status,
            'players' => array_map(static fn (RoomPlayer $player) => $player->toArray(), $this->players->toArray()),
            'gameId' => $this->game?->id(),
        ];
    }
}
