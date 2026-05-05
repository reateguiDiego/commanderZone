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
    public const STATUS_ARCHIVED = 'archived';
    public const VISIBILITY_PRIVATE = 'private';
    public const VISIBILITY_PUBLIC = 'public';

    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false)]
    private User $owner;

    #[ORM\Column(type: 'string', length: 40)]
    private string $status = self::STATUS_WAITING;

    #[ORM\Column(type: 'string', length: 20)]
    private string $visibility = self::VISIBILITY_PRIVATE;

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

    public function visibility(): string
    {
        return $this->visibility;
    }

    public function setVisibility(string $visibility): void
    {
        $this->visibility = in_array($visibility, [self::VISIBILITY_PRIVATE, self::VISIBILITY_PUBLIC], true)
            ? $visibility
            : self::VISIBILITY_PRIVATE;
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
                if ($player->deck() !== null) {
                    $existing->changeDeck($player->deck());
                }

                return;
            }
        }

        $this->players->add($player);
    }

    public function hasPlayer(User $user): bool
    {
        foreach ($this->players as $player) {
            if ($player->user()->id() === $user->id()) {
                return true;
            }
        }

        return false;
    }

    public function canBeViewedBy(User $user, bool $isInvited = false): bool
    {
        if ($this->owner->id() === $user->id() || $this->hasPlayer($user)) {
            return true;
        }

        if ($this->status !== self::STATUS_WAITING) {
            return false;
        }

        if ($this->visibility === self::VISIBILITY_PUBLIC) {
            return true;
        }

        return $isInvited;
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

    public function archive(): void
    {
        $this->status = self::STATUS_ARCHIVED;
    }

    public function detachGame(): void
    {
        $this->game = null;
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'owner' => $this->owner->toArray(),
            'status' => $this->status,
            'visibility' => $this->visibility,
            'players' => array_map(static fn (RoomPlayer $player) => $player->toArray(), $this->players->toArray()),
            'gameId' => $this->game?->id(),
        ];
    }
}
