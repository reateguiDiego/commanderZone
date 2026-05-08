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
    public const FORMAT_COMMANDER = 'commander';
    public const MIN_PLAYERS = 2;
    public const MIN_MAX_PLAYERS = 2;
    public const MAX_MAX_PLAYERS = 6;
    public const DEFAULT_MAX_PLAYERS = 4;
    public const MIN_STARTING_LIFE = 1;
    public const MAX_STARTING_LIFE = 999;
    public const DEFAULT_STARTING_LIFE = 40;
    public const TIMER_NONE = 'none';
    public const TIMER_TURN = 'turn';
    public const DEFAULT_TIMER_MODE = self::TIMER_NONE;
    public const DEFAULT_TIMER_DURATION_SECONDS = 300;
    public const MIN_TIMER_DURATION_SECONDS = 30;
    public const MAX_TIMER_DURATION_SECONDS = 1800;

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

    #[ORM\Column(type: 'string', length: 120)]
    private string $name;

    #[ORM\Column(type: 'string', length: 20)]
    private string $format = self::FORMAT_COMMANDER;

    #[ORM\Column(type: 'integer')]
    private int $maxPlayers = self::DEFAULT_MAX_PLAYERS;

    #[ORM\Column(type: 'integer')]
    private int $startingLife = self::DEFAULT_STARTING_LIFE;

    #[ORM\Column(type: 'string', length: 12)]
    private string $timerMode = self::DEFAULT_TIMER_MODE;

    #[ORM\Column(type: 'integer')]
    private int $timerDurationSeconds = self::DEFAULT_TIMER_DURATION_SECONDS;

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
        $this->name = self::defaultNameForOwner($owner);
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

    public function name(): string
    {
        return $this->name;
    }

    public function format(): string
    {
        return $this->format;
    }

    public function maxPlayers(): int
    {
        return $this->maxPlayers;
    }

    public function startingLife(): int
    {
        return $this->startingLife;
    }

    public function timerMode(): string
    {
        return $this->timerMode;
    }

    public function timerDurationSeconds(): int
    {
        return $this->timerDurationSeconds;
    }

    public function setVisibility(string $visibility): void
    {
        $this->visibility = in_array($visibility, [self::VISIBILITY_PRIVATE, self::VISIBILITY_PUBLIC], true)
            ? $visibility
            : self::VISIBILITY_PRIVATE;
    }

    public function setName(string $name): void
    {
        $trimmed = trim($name);
        if ($trimmed === '') {
            $this->name = self::defaultNameForOwner($this->owner);

            return;
        }

        $this->name = substr($trimmed, 0, 120);
    }

    public function setFormat(string $format): void
    {
        $this->format = $format === self::FORMAT_COMMANDER ? $format : self::FORMAT_COMMANDER;
    }

    public function setMaxPlayers(int $maxPlayers): void
    {
        $this->maxPlayers = max(self::MIN_MAX_PLAYERS, min(self::MAX_MAX_PLAYERS, $maxPlayers));
    }

    public function setStartingLife(int $startingLife): void
    {
        $this->startingLife = max(self::MIN_STARTING_LIFE, min(self::MAX_STARTING_LIFE, $startingLife));
    }

    public function setTimerMode(string $timerMode): void
    {
        $this->timerMode = in_array($timerMode, [self::TIMER_NONE, self::TIMER_TURN], true)
            ? $timerMode
            : self::DEFAULT_TIMER_MODE;
    }

    public function setTimerDurationSeconds(int $timerDurationSeconds): void
    {
        $this->timerDurationSeconds = max(
            self::MIN_TIMER_DURATION_SECONDS,
            min(self::MAX_TIMER_DURATION_SECONDS, $timerDurationSeconds),
        );
    }

    public function players(): Collection
    {
        return $this->players;
    }

    /**
     * @return list<RoomPlayer>
     */
    public function orderedPlayers(): array
    {
        $players = $this->players->toArray();
        $allPlayersRolled = $players !== [] && array_reduce(
            $players,
            static fn (bool $allRolled, RoomPlayer $player): bool => $allRolled && $player->turnRoll() !== null,
            true,
        );

        if (!$allPlayersRolled) {
            return array_values($players);
        }

        usort($players, static function (RoomPlayer $left, RoomPlayer $right): int {
            $leftRoll = $left->turnRoll();
            $rightRoll = $right->turnRoll();
            if ($leftRoll !== $rightRoll) {
                return ($rightRoll ?? -1) <=> ($leftRoll ?? -1);
            }

            return $left->joinedAt() <=> $right->joinedAt();
        });

        return array_values($players);
    }

    public function game(): ?Game
    {
        return $this->game;
    }

    public function addPlayer(RoomPlayer $player): bool
    {
        foreach ($this->players as $existing) {
            if ($existing->user()->id() === $player->user()->id()) {
                if ($player->deck() !== null) {
                    $existing->changeDeck($player->deck());
                }

                return true;
            }
        }

        if ($this->isFull()) {
            return false;
        }

        $this->players->add($player);

        return true;
    }

    public function isFull(): bool
    {
        return $this->players->count() >= $this->maxPlayers;
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

    public function playerFor(User $user): ?RoomPlayer
    {
        foreach ($this->players as $player) {
            if ($player->user()->id() === $user->id()) {
                return $player;
            }
        }

        return null;
    }

    public function canBeViewedBy(User $user): bool
    {
        if ($this->owner->id() === $user->id() || $this->hasPlayer($user)) {
            return true;
        }

        if ($this->status !== self::STATUS_WAITING) {
            return false;
        }

        // Private waiting rooms are not publicly listed, but a direct link or
        // room code is enough to open the waiting room.
        return true;
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
            'name' => $this->name,
            'owner' => $this->owner->toArray(),
            'status' => $this->status,
            'visibility' => $this->visibility,
            'format' => $this->format,
            'maxPlayers' => $this->maxPlayers,
            'startingLife' => $this->startingLife,
            'timerMode' => $this->timerMode,
            'timerDurationSeconds' => $this->timerDurationSeconds,
            'players' => array_map(static fn (RoomPlayer $player) => $player->toArray(), $this->orderedPlayers()),
            'gameId' => $this->game?->id(),
        ];
    }

    private static function defaultNameForOwner(User $owner): string
    {
        $ownerName = trim($owner->displayName());

        return $ownerName !== '' ? sprintf('Mesa de %s', $ownerName) : 'Mesa Commander';
    }
}
