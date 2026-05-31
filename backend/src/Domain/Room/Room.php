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

    #[ORM\OneToMany(mappedBy: 'room', targetEntity: RoomWaitingLogEntry::class, cascade: ['persist', 'remove'], orphanRemoval: true)]
    #[ORM\OrderBy(['createdAt' => 'ASC'])]
    private Collection $waitingLogEntries;

    #[ORM\OneToOne(targetEntity: Game::class)]
    private ?Game $game = null;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    public function __construct(User $owner)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->owner = $owner;
        $this->name = self::defaultNameForOwner($owner);
        $this->players = new ArrayCollection();
        $this->waitingLogEntries = new ArrayCollection();
        $this->createdAt = new \DateTimeImmutable();
        $this->updatedAt = $this->createdAt;
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
        $this->touch();
    }

    public function setName(string $name): void
    {
        $trimmed = trim($name);
        if ($trimmed === '') {
            $this->name = self::defaultNameForOwner($this->owner);
            $this->touch();

            return;
        }

        $this->name = substr($trimmed, 0, 120);
        $this->touch();
    }

    public function setFormat(string $format): void
    {
        $this->format = $format === self::FORMAT_COMMANDER ? $format : self::FORMAT_COMMANDER;
        $this->touch();
    }

    public function setMaxPlayers(int $maxPlayers): void
    {
        $this->maxPlayers = max(self::MIN_MAX_PLAYERS, min(self::MAX_MAX_PLAYERS, $maxPlayers));
        $this->touch();
    }

    public function setStartingLife(int $startingLife): void
    {
        $this->startingLife = max(self::MIN_STARTING_LIFE, min(self::MAX_STARTING_LIFE, $startingLife));
        $this->touch();
    }

    public function setTimerMode(string $timerMode): void
    {
        $this->timerMode = in_array($timerMode, [self::TIMER_NONE, self::TIMER_TURN], true)
            ? $timerMode
            : self::DEFAULT_TIMER_MODE;
        $this->touch();
    }

    public function setTimerDurationSeconds(int $timerDurationSeconds): void
    {
        $this->timerDurationSeconds = max(
            self::MIN_TIMER_DURATION_SECONDS,
            min(self::MAX_TIMER_DURATION_SECONDS, $timerDurationSeconds),
        );
        $this->touch();
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

        if (!$this->allPlayersHaveTurnRolls($players)) {
            return array_values($players);
        }

        usort($players, fn (RoomPlayer $left, RoomPlayer $right): int => $this->comparePlayersByTurnRolls($left, $right));

        return array_values($players);
    }

    public function hasResolvedTurnOrder(): bool
    {
        $players = $this->players->toArray();

        return $this->allPlayersHaveTurnRolls($players) && $this->turnRollTieGroups($players) === [];
    }

    public function canPlayerRollTurnOrder(RoomPlayer $player): bool
    {
        if ($player->turnRolls() === []) {
            return true;
        }

        foreach ($this->turnRollTieGroups($this->players->toArray()) as $group) {
            foreach ($group as $tiedPlayer) {
                if ($tiedPlayer->id() === $player->id()) {
                    return true;
                }
            }
        }

        return false;
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
                    $this->touch();
                }

                return true;
            }
        }

        if ($this->isFull()) {
            return false;
        }

        $this->players->add($player);
        $this->touch();

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
                $this->touch();
            }
        }
    }

    /**
     * @param list<string> $playerUserIds
     */
    public function returnToWaitingForRematch(User $owner, array $playerUserIds): void
    {
        $playerUserIds = array_values(array_unique(array_filter($playerUserIds, static fn (string $playerId): bool => $playerId !== '')));
        if (count($playerUserIds) < self::MIN_PLAYERS) {
            throw new \InvalidArgumentException('At least two players are required to create a rematch room.');
        }

        $remainingPlayerIds = array_flip($playerUserIds);
        foreach ($this->players as $player) {
            if (!isset($remainingPlayerIds[$player->user()->id()])) {
                $this->players->removeElement($player);
                continue;
            }

            $player->clearTurnRoll();
        }

        if (!$this->hasPlayer($owner)) {
            throw new \InvalidArgumentException('The rematch owner must be one of the rematch players.');
        }

        $this->owner = $owner;
        $this->status = self::STATUS_WAITING;
        $this->game = null;
        $this->maxPlayers = max(self::MIN_MAX_PLAYERS, min(self::MAX_MAX_PLAYERS, $this->players->count()));
        $this->touch();
    }

    public function start(Game $game): void
    {
        $this->status = self::STATUS_STARTED;
        $this->game = $game;
        $this->waitingLogEntries->clear();
        $this->touch();
    }

    public function detachGame(): void
    {
        $this->game = null;
        $this->touch();
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
            'waitingLog' => array_map(
                static fn (RoomWaitingLogEntry $entry): array => $entry->toArray(),
                $this->waitingLogEntries->toArray(),
            ),
            'gameId' => $this->game?->id(),
            'createdAt' => $this->createdAt->format(DATE_ATOM),
            'updatedAt' => $this->updatedAt->format(DATE_ATOM),
        ];
    }

    public function appendWaitingLog(string $label, string $tone = RoomWaitingLogEntry::TONE_DEFAULT): void
    {
        $trimmed = trim($label);
        if ($trimmed === '') {
            return;
        }

        $this->waitingLogEntries->add(new RoomWaitingLogEntry($this, $trimmed, $tone));
        $this->touch();
    }

    private function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }

    /**
     * @param list<RoomPlayer> $players
     */
    private function allPlayersHaveTurnRolls(array $players): bool
    {
        return $players !== [] && array_reduce(
            $players,
            static fn (bool $allRolled, RoomPlayer $player): bool => $allRolled && $player->turnRolls() !== [],
            true,
        );
    }

    private function comparePlayersByTurnRolls(RoomPlayer $left, RoomPlayer $right): int
    {
        $leftRolls = $left->turnRolls();
        $rightRolls = $right->turnRolls();
        $levels = max(count($leftRolls), count($rightRolls));

        for ($index = 0; $index < $levels; ++$index) {
            $leftRoll = $leftRolls[$index] ?? -1;
            $rightRoll = $rightRolls[$index] ?? -1;
            if ($leftRoll !== $rightRoll) {
                return $rightRoll <=> $leftRoll;
            }
        }

        return $left->joinedAt() <=> $right->joinedAt();
    }

    /**
     * @param list<RoomPlayer> $players
     *
     * @return list<list<RoomPlayer>>
     */
    private function turnRollTieGroups(array $players): array
    {
        if (!$this->allPlayersHaveTurnRolls($players)) {
            return [];
        }

        $groups = [];
        foreach ($players as $player) {
            $groups[implode('-', $player->turnRolls())][] = $player;
        }

        return array_values(array_filter(
            $groups,
            static fn (array $group): bool => count($group) > 1,
        ));
    }

    private static function defaultNameForOwner(User $owner): string
    {
        $ownerName = trim($owner->displayName());

        return $ownerName !== '' ? sprintf('Mesa de %s', $ownerName) : 'Mesa Commander';
    }
}
