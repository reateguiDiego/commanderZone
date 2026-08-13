<?php

namespace App\Domain\Game;

use App\Domain\Room\Room;
use App\Domain\User\User;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'game')]
#[ORM\Index(name: 'idx_game_next_lifecycle_at', columns: ['next_lifecycle_at'], options: ['where' => 'next_lifecycle_at IS NOT NULL'])]
class Game
{
    public const STATUS_ACTIVE = 'active';
    public const STATUS_FINISHED = 'finished';

    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Room::class)]
    #[ORM\JoinColumn(nullable: false)]
    private Room $room;

    #[ORM\Column(type: 'string', length: 40)]
    private string $status = self::STATUS_ACTIVE;

    #[ORM\Column(type: 'json')]
    private array $snapshot;

    /**
     * Low-frequency lifecycle/control-plane state. It is intentionally kept
     * outside the versioned gameplay event stream owned by the Go actor.
     *
     * @var array{votes: array<string,array<string,mixed>>, deadlineAt: ?string}
     */
    #[ORM\Column(type: 'json')]
    private array $rematchState = ['votes' => [], 'deadlineAt' => null];

    /** @var array{players: array<string,array<string,mixed>>} */
    #[ORM\Column(type: 'json')]
    private array $lifecycleState = ['players' => []];

    #[ORM\Column(type: 'string', length: 36, nullable: true)]
    private ?string $winnerPlayerId = null;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $finishedAt = null;

    #[ORM\Column(type: 'string', length: 40, nullable: true)]
    private ?string $finishReason = null;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $allDisconnectedSince = null;

    /**
     * Durable acknowledgement that the runtime hibernation job was scheduled.
     * It prevents the lifecycle sweeper from enqueueing the same low-frequency
     * operation on every pass while keeping the final expiry independently due.
     */
    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $allDisconnectedHibernateRequestedAt = null;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $nextLifecycleAt = null;

    #[ORM\Column(type: 'integer')]
    private int $lifecycleGeneration = 0;

    #[ORM\Column(type: 'bigint')]
    private string $lifecycleFencing = '0';

    #[ORM\Column(type: 'integer')]
    private int $lifecycleVersion = 0;

    /**
     * Monotonic revision for durable lifecycle/rematch state only.
     *
     * It never participates in the Go-owned game_event stream version.
     */
    #[ORM\Column(type: 'integer')]
    private int $controlPlaneRevision = 0;

    #[ORM\Column(type: 'string', length: 120, nullable: true)]
    private ?string $lastLifecycleEventId = null;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $lastLifecycleOccurredAt = null;

    /**
     * Runtime-only snapshot used by V2 event-sourced flows.
     *
     * @var array<string,mixed>|null
     */
    private ?array $runtimeSnapshot = null;

    #[ORM\OneToMany(mappedBy: 'game', targetEntity: GameEvent::class, cascade: ['persist', 'remove'], orphanRemoval: false)]
    private Collection $events;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    public function __construct(Room $room, array $snapshot)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->room = $room;
        $this->snapshot = $snapshot;
        if (is_array($snapshot['rematch'] ?? null)) {
            $this->rematchState = [
                'votes' => is_array($snapshot['rematch']['votes'] ?? null) ? $snapshot['rematch']['votes'] : [],
                'deadlineAt' => is_string($snapshot['rematch']['deadlineAt'] ?? null) ? $snapshot['rematch']['deadlineAt'] : null,
            ];
        }
        $this->events = new ArrayCollection();
        $this->createdAt = new \DateTimeImmutable();
        $this->updatedAt = $this->createdAt;
    }

    public function id(): string
    {
        return $this->id;
    }

    public function snapshot(): array
    {
        $snapshot = $this->runtimeSnapshot ?? $this->snapshot;
        foreach ($this->lifecycleState()['players'] as $playerId => $lifecyclePlayer) {
            if (!isset($snapshot['players'][$playerId]) || !is_array($snapshot['players'][$playerId])) {
                continue;
            }

            $snapshot['players'][$playerId]['status'] = $lifecyclePlayer['status'];
            $snapshot['players'][$playerId]['concededAt'] = $lifecyclePlayer['occurredAt'];
        }

        // Go owns the gameplay stream, while the lifecycle handoff makes the
        // terminal control-plane fact durable here. A compact gameplay
        // snapshot may legitimately lag its terminal handoff, so never expose
        // a playable snapshot once Symfony has authoritatively projected it
        // as finished.
        if ($this->status === self::STATUS_FINISHED) {
            $snapshot['status'] = self::STATUS_FINISHED;
            $snapshot['gamePhase'] = 'FINISHED';
            $snapshot['winnerPlayerId'] = $this->winnerPlayerId;
            $snapshot['finishedAt'] = $this->finishedAt?->format(DATE_ATOM);
            $snapshot['finishReason'] = $this->finishReason;
        }

        return $snapshot;
    }

    public function persistedSnapshot(): array
    {
        return $this->snapshot;
    }

    /**
     * @return array{votes: array<string,array<string,mixed>>, deadlineAt: ?string}
     */
    public function rematchState(): array
    {
        $votes = is_array($this->rematchState['votes'] ?? null) ? $this->rematchState['votes'] : [];

        $deadlineAt = $this->rematchState['deadlineAt'] ?? null;

        return [
            'votes' => array_filter($votes, static fn (mixed $entry): bool => is_array($entry)),
            'deadlineAt' => is_string($deadlineAt) ? $deadlineAt : null,
        ];
    }

    public function recordRematchVote(User $actor, string $vote, \DateTimeImmutable $votedAt, string $clientActionId): void
    {
        $this->rematchState = $this->rematchState();
        $this->rematchState['votes'][$actor->id()] = [
            'playerId' => $actor->id(),
            'displayName' => $actor->displayName(),
            'vote' => $vote,
            'votedAt' => $votedAt->format(DATE_ATOM),
            'clientActionId' => $clientActionId,
        ];
        $this->advanceControlPlaneRevision();
        $this->touch();
    }

    /** @return array<string,mixed>|null */
    public function rematchVoteFor(string $playerId): ?array
    {
        $vote = $this->rematchState()['votes'][$playerId] ?? null;

        return is_array($vote) ? $vote : null;
    }

    public function hasRematchAction(string $playerId, string $clientActionId): bool
    {
        $vote = $this->rematchVoteFor($playerId);

        return is_array($vote) && ($vote['clientActionId'] ?? null) === $clientActionId;
    }

    /** @return array{players: array<string,array<string,mixed>>} */
    public function lifecycleState(): array
    {
        $players = is_array($this->lifecycleState['players'] ?? null) ? $this->lifecycleState['players'] : [];

        return ['players' => array_filter($players, static fn (mixed $entry): bool => is_array($entry))];
    }

    /** @return array{generation:int,fencing:int,version:int,eventId:?string,occurredAt:?\DateTimeImmutable} */
    public function lifecycleCursor(): array
    {
        return [
            'generation' => $this->lifecycleGeneration,
            'fencing' => (int) $this->lifecycleFencing,
            'version' => $this->lifecycleVersion,
            'eventId' => $this->lastLifecycleEventId,
            'occurredAt' => $this->lastLifecycleOccurredAt,
        ];
    }

    public function projectConcededPlayer(string $playerId, string $reason, \DateTimeImmutable $occurredAt): void
    {
        $this->lifecycleState = $this->lifecycleState();
        $this->lifecycleState['players'][$playerId] = [
            'status' => 'conceded',
            'reason' => $reason,
            'occurredAt' => $occurredAt->format(DATE_ATOM),
        ];
        $this->touch();
    }

    public function projectFinished(?string $winnerPlayerId, \DateTimeImmutable $finishedAt, string $finishReason): void
    {
        if ($this->status === self::STATUS_FINISHED) {
            return;
        }
        $this->status = self::STATUS_FINISHED;
        $this->winnerPlayerId = $winnerPlayerId;
        $this->finishedAt = $finishedAt;
        $this->finishReason = $finishReason;
        $this->allDisconnectedSince = null;
        $this->nextLifecycleAt = $finishedAt->modify('+60 seconds');
        $this->rematchState = $this->rematchState();
        $this->rematchState['deadlineAt'] = $this->nextLifecycleAt->format(DATE_ATOM);
        $this->touch();
    }

    public function markAllDisconnected(\DateTimeImmutable $since, \DateTimeImmutable $hibernateAt): void
    {
        if ($this->status === self::STATUS_FINISHED) {
            return;
        }
        $this->allDisconnectedSince = $since;
        $this->allDisconnectedHibernateRequestedAt = null;
        $this->nextLifecycleAt = $hibernateAt;
        $this->touch();
    }

    public function scheduleAllDisconnectedHibernation(\DateTimeImmutable $requestedAt, \DateTimeImmutable $expiresAt): bool
    {
        if ($this->status === self::STATUS_FINISHED || $this->allDisconnectedSince === null || $this->allDisconnectedHibernateRequestedAt !== null) {
            return false;
        }

        $this->allDisconnectedHibernateRequestedAt = $requestedAt;
        $this->nextLifecycleAt = $expiresAt;
        $this->touch();

        return true;
    }

    public function cancelAllDisconnected(): void
    {
        if ($this->status === self::STATUS_FINISHED) {
            return;
        }
        $this->allDisconnectedSince = null;
        $this->allDisconnectedHibernateRequestedAt = null;
        $this->nextLifecycleAt = null;
        $this->touch();
    }

    public function recordLifecycleCursor(int $generation, int $fencing, int $version, string $eventId, \DateTimeImmutable $occurredAt): void
    {
        $this->lifecycleGeneration = $generation;
        $this->lifecycleFencing = (string) $fencing;
        $this->lifecycleVersion = $version;
        $this->lastLifecycleEventId = $eventId;
        $this->lastLifecycleOccurredAt = $occurredAt;
        $this->advanceControlPlaneRevision();
        $this->touch();
    }

    public function controlPlaneRevision(): int
    {
        return $this->controlPlaneRevision;
    }

    public function winnerPlayerId(): ?string
    {
        return $this->winnerPlayerId;
    }

    public function finishedAt(): ?\DateTimeImmutable
    {
        return $this->finishedAt;
    }

    public function finishReason(): ?string
    {
        return $this->finishReason;
    }

    public function allDisconnectedSince(): ?\DateTimeImmutable
    {
        return $this->allDisconnectedSince;
    }

    public function nextLifecycleAt(): ?\DateTimeImmutable
    {
        return $this->nextLifecycleAt;
    }

    public function allDisconnectedHibernateRequestedAt(): ?\DateTimeImmutable
    {
        return $this->allDisconnectedHibernateRequestedAt;
    }

    public function room(): Room
    {
        return $this->room;
    }

    public function status(): string
    {
        return $this->status;
    }

    public function canBeAccessedBy(User $user): bool
    {
        return $this->room->owner()->id() === $user->id() || $this->room->hasPlayer($user);
    }

    public function canBeViewedBy(User $user): bool
    {
        // A former game participant is not automatically a spectator. Only a
        // current RoomPlayer retains table access; conceding without leaving
        // keeps that membership and therefore remains spectating.
        return $this->canBeAccessedBy($user);
    }

    public function canBeControlledBy(User $user): bool
    {
        return $this->room->hasPlayer($user);
    }

    public function replaceSnapshot(array $snapshot): void
    {
        $this->snapshot = $snapshot;
        $this->runtimeSnapshot = $snapshot;
        $this->touch();
    }

    public function replaceRuntimeSnapshot(array $snapshot): void
    {
        $this->runtimeSnapshot = $snapshot;
        $this->touch();
    }

    public function clearRuntimeSnapshot(): void
    {
        $this->runtimeSnapshot = null;
        $this->touch();
    }

    public function finish(): void
    {
        $this->status = self::STATUS_FINISHED;
        $this->touch();
    }

    public function addEvent(GameEvent $event): void
    {
        $this->events->add($event);
        $this->touch();
    }

    /**
     * @return Collection<int, GameEvent>
     */
    public function events(): Collection
    {
        return $this->events;
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'controlPlaneRevision' => $this->controlPlaneRevision,
            'winnerPlayerId' => $this->winnerPlayerId,
            'finishedAt' => $this->finishedAt?->format(DATE_ATOM),
            'finishReason' => $this->finishReason,
            'allDisconnectedSince' => $this->allDisconnectedSince?->format(DATE_ATOM),
            'nextLifecycleAt' => $this->nextLifecycleAt?->format(DATE_ATOM),
            'snapshot' => $this->snapshot,
            'createdAt' => $this->createdAt->format(DATE_ATOM),
            'updatedAt' => $this->updatedAt->format(DATE_ATOM),
        ];
    }

    private function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }

    private function advanceControlPlaneRevision(): void
    {
        ++$this->controlPlaneRevision;
    }
}
