<?php

namespace App\Application\Game;

use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\User\User;
use Symfony\Component\Uid\Uuid;

class GameDisconnectVoteService
{
    public const COMMAND_TYPE = 'disconnect.vote';
    public const EVENT_TYPE = 'disconnect.vote.updated';
    public const VOTE_WAIT = 'wait';
    public const VOTE_EXPEL = 'expel';
    public const STATUS_OPEN = 'open';
    public const STATUS_RESOLVED_WAIT = 'rejected';
    public const STATUS_RESOLVED_EXPEL = 'executed';
    public const STATUS_CANCELLED = 'cancelled';
	public const STATUS_EXPIRED = 'expired';
    public const OFFLINE_GRACE_SECONDS = 5;

    private const TIMEOUT_SECONDS = 60;
    private const COOLDOWN_SECONDS = 300;

    public function __construct(private readonly GameCommandHandler $normalizer)
    {
    }

    /**
     * @param list<string> $connectedUserIds
     *
     * @return array{event: GameEvent, snapshot: array<string,mixed>}|null
     */
    public function openVoteIfEligible(Game $game, string $targetPlayerId, array $connectedUserIds, ?\DateTimeImmutable $now = null): ?array
    {
        $now ??= new \DateTimeImmutable();
        $snapshot = $game->snapshot();
        $state = $this->currentDisconnectVote($game, $snapshot);

        if ($this->maybeResolveOnTimeout($snapshot, $state, $connectedUserIds, $now)) {
            $game->replaceRuntimeSnapshot($snapshot);

            return $this->createTechnicalEvent($game, $snapshot, 'timeout.wait', null);
        }

        if (!isset($snapshot['players'][$targetPlayerId])) {
            return null;
        }
        if (($snapshot['players'][$targetPlayerId]['status'] ?? 'active') !== 'active') {
            return null;
        }
        if ($this->isOpenVote($state)) {
            return null;
        }
        if (in_array($targetPlayerId, $connectedUserIds, true)) {
            return null;
        }
		$snapshot['presence'] = is_array($snapshot['presence'] ?? null) ? $snapshot['presence'] : [];
		foreach ($connectedUserIds as $connectedPlayerId) {
			if (is_string($connectedPlayerId) && isset($snapshot['players'][$connectedPlayerId])) {
				$snapshot['presence'][$connectedPlayerId] = ['playerId' => $connectedPlayerId, 'connected' => true, 'activeConnectionCount' => 1, 'lastSeenAt' => $now->format(DATE_ATOM), 'disconnectedAt' => null];
			}
		}
		$snapshot['presence'][$targetPlayerId] = ['playerId' => $targetPlayerId, 'connected' => false, 'activeConnectionCount' => 0, 'lastSeenAt' => $now->format(DATE_ATOM), 'disconnectedAt' => $now->format(DATE_ATOM)];
		$targetCooldown = is_array($snapshot['disconnectCooldowns'][$targetPlayerId] ?? null)
			? $snapshot['disconnectCooldowns'][$targetPlayerId]
			: [];
		if ($this->isFutureDate($targetCooldown['cooldownUntil'] ?? null, $now)) {
			return null;
		}
        if (
            ($state['targetPlayerId'] ?? null) === $targetPlayerId
            && $this->isFutureDate($state['cooldownUntil'] ?? null, $now)
        ) {
            return null;
        }

        $voterIds = $this->eligibleVoterIds($snapshot, $targetPlayerId, $connectedUserIds);
        if ($voterIds === []) {
			return null;
        }

        $openedAt = $now->format(DATE_ATOM);
        $state = [
			'voteId' => Uuid::v7()->toRfc4122(),
            'targetPlayerId' => $targetPlayerId,
			'openedByPlayerId' => $voterIds[0],
            'status' => self::STATUS_OPEN,
			'eligibleVoterIds' => $voterIds,
			'requiredVotes' => intdiv(count($voterIds), 2) + 1,
            'openedAt' => $openedAt,
			'expiresAt' => $now->modify('+'.self::TIMEOUT_SECONDS.' seconds')->format(DATE_ATOM),
            'deadlineAt' => $now->modify('+'.self::TIMEOUT_SECONDS.' seconds')->format(DATE_ATOM),
			'resolvedAt' => null,
            'cooldownUntil' => null,
			'resolution' => null,
			'effectVersion' => 4,
			'votesByPlayerId' => [],
            'votes' => [],
        ];
        $snapshot['disconnectVote'] = $state;
		$this->appendSystemLog($snapshot, 'gameLog.disconnect.vote.opened', $now, ['targetPlayerId' => $targetPlayerId]);
        $game->replaceRuntimeSnapshot($snapshot);

        return $this->createTechnicalEvent($game, $snapshot, 'opened', null);
    }

    /**
     * @param list<string> $connectedUserIds
     *
     * @return array{event: GameEvent, snapshot: array<string,mixed>}
     */
    public function recordVote(
        Game $game,
        User $actor,
        string $targetPlayerId,
        string $vote,
        array $connectedUserIds,
        ?\DateTimeImmutable $now = null,
		?string $voteId = null,
    ): array {
        if (!in_array($vote, [self::VOTE_WAIT, self::VOTE_EXPEL], true)) {
            throw new \InvalidArgumentException('Unsupported disconnect vote.');
        }

        $now ??= new \DateTimeImmutable();
        $snapshot = $game->snapshot();
        $state = $this->currentDisconnectVote($game, $snapshot);
        if ($this->maybeResolveOnTimeout($snapshot, $state, $connectedUserIds, $now)) {
            throw new \InvalidArgumentException('Disconnect vote already expired.');
        }

        if (!$this->isOpenVote($state) || ($state['targetPlayerId'] ?? null) !== $targetPlayerId) {
            throw new \InvalidArgumentException('There is no open disconnect vote for the selected player.');
        }
		if ($voteId !== null && $voteId !== '' && ($state['voteId'] ?? null) !== $voteId) {
			throw new \InvalidArgumentException('VOTE_NOT_FOUND');
		}
        if (!isset($snapshot['players'][$actor->id()])) {
            throw new \InvalidArgumentException('Only game players can vote.');
        }
        if ($actor->id() === $targetPlayerId) {
            throw new \InvalidArgumentException('Target player cannot vote on own disconnect vote.');
        }

		$eligibleVoterIds = array_values(array_filter(
			is_array($state['eligibleVoterIds'] ?? null) ? $state['eligibleVoterIds'] : $this->eligibleVoterIds($snapshot, $targetPlayerId, $connectedUserIds),
			'is_string',
		));
        if (!in_array($actor->id(), $eligibleVoterIds, true)) {
            throw new \InvalidArgumentException('Only connected players can vote.');
        }
		if (!in_array($actor->id(), $connectedUserIds, true)) {
			throw new \InvalidArgumentException('NOT_ELIGIBLE_VOTER');
		}

		if (isset($state['votesByPlayerId'][$actor->id()]) || isset($state['votes'][$actor->id()])) {
			throw new \InvalidArgumentException('DUPLICATE_VOTE');
		}
		if (($snapshot['players'][$actor->id()]['status'] ?? 'active') !== 'active') {
			throw new \InvalidArgumentException('PLAYER_NOT_ACTIVE');
		}
		$entry = [
            'playerId' => $actor->id(),
            'displayName' => $actor->displayName(),
			'decision' => $vote,
            'vote' => $vote,
            'votedAt' => $now->format(DATE_ATOM),
        ];
		$state['votesByPlayerId'][$actor->id()] = $entry;
		$state['votes'][$actor->id()] = $entry;
		$this->appendSystemLog(
			$snapshot,
			$vote === self::VOTE_EXPEL ? 'gameLog.disconnect.vote.castExpel' : 'gameLog.disconnect.vote.castWait',
			$now,
			['targetPlayerId' => $targetPlayerId, 'playerId' => $actor->id()],
		);

        $waitVotes = 0;
        $expelVotes = 0;
        foreach ($eligibleVoterIds as $voterId) {
			$entry = $state['votesByPlayerId'][$voterId] ?? $state['votes'][$voterId] ?? null;
            if (!is_array($entry)) {
                continue;
            }

            if (($entry['vote'] ?? null) === self::VOTE_WAIT) {
                ++$waitVotes;
            } elseif (($entry['vote'] ?? null) === self::VOTE_EXPEL) {
                ++$expelVotes;
            }
        }

		$majority = max(1, (int) ($state['requiredVotes'] ?? (intdiv(count($eligibleVoterIds), 2) + 1)));
        $resolution = null;
        if ($expelVotes >= $majority) {
            $resolution = self::STATUS_RESOLVED_EXPEL;
            $this->applyExpelResolution($game, $snapshot, $targetPlayerId, $now);
			$this->appendSystemLog($snapshot, 'gameLog.disconnect.vote.passed', $now, ['targetPlayerId' => $targetPlayerId]);
		} elseif ($expelVotes + (count($eligibleVoterIds) - count($state['votesByPlayerId'])) < $majority || count($state['votesByPlayerId']) === count($eligibleVoterIds)) {
            $resolution = self::STATUS_RESOLVED_WAIT;
			$this->appendSystemLog($snapshot, 'gameLog.disconnect.vote.rejected', $now, ['targetPlayerId' => $targetPlayerId]);
        }

        if ($resolution !== null) {
            $state = $this->resolvedState($state, $resolution, $now);
			if ($resolution !== self::STATUS_RESOLVED_EXPEL) {
				$this->setCooldown($snapshot, $state, 'wait');
			}
        }
        $snapshot['disconnectVote'] = $state;
        $game->replaceRuntimeSnapshot($snapshot);

        return $this->createTechnicalEvent($game, $snapshot, $resolution === null ? 'vote.recorded' : 'vote.resolved', $actor);
    }

    /**
     * @param list<string> $connectedUserIds
     *
     * @return array{event: GameEvent, snapshot: array<string,mixed>}|null
     */
    public function resolveOnTimeout(Game $game, array $connectedUserIds, ?\DateTimeImmutable $now = null): ?array
    {
        $now ??= new \DateTimeImmutable();
        $snapshot = $game->snapshot();
        $state = $this->currentDisconnectVote($game, $snapshot);
        if (!$this->maybeResolveOnTimeout($snapshot, $state, $connectedUserIds, $now)) {
            return null;
        }

        $game->replaceRuntimeSnapshot($snapshot);

        return $this->createTechnicalEvent($game, $snapshot, 'timeout.wait', null);
    }

    /**
     * @return array{event: GameEvent, snapshot: array<string,mixed>}|null
     */
    public function cancelOnReconnect(Game $game, string $targetPlayerId, ?\DateTimeImmutable $now = null): ?array
    {
        $now ??= new \DateTimeImmutable();
        $snapshot = $game->snapshot();
        $state = $this->currentDisconnectVote($game, $snapshot);
        if (!$this->isOpenVote($state) || ($state['targetPlayerId'] ?? null) !== $targetPlayerId) {
            return null;
        }

        $state['status'] = self::STATUS_CANCELLED;
		$snapshot['presence'] = is_array($snapshot['presence'] ?? null) ? $snapshot['presence'] : [];
		$snapshot['presence'][$targetPlayerId] = ['playerId' => $targetPlayerId, 'connected' => true, 'activeConnectionCount' => 1, 'lastSeenAt' => $now->format(DATE_ATOM), 'disconnectedAt' => null];
		$state['resolution'] = 'reconnected';
		$state['resolvedAt'] = $now->format(DATE_ATOM);
		$state['expiresAt'] = null;
        $state['deadlineAt'] = null;
		$state['cooldownUntil'] = $now->modify('+'.self::COOLDOWN_SECONDS.' seconds')->format(DATE_ATOM);
        $snapshot['disconnectVote'] = $state;
		$this->setCooldown($snapshot, $state, 'reconnected');
		$this->appendSystemLog($snapshot, 'gameLog.disconnect.vote.cancelledByReconnect', $now, ['targetPlayerId' => $targetPlayerId]);
        $game->replaceRuntimeSnapshot($snapshot);

        return $this->createTechnicalEvent($game, $snapshot, 'cancelled.reconnect', null);
    }

    /**
     * @param list<string> $connectedUserIds
     */
    private function maybeResolveOnTimeout(array &$snapshot, array &$state, array $connectedUserIds, \DateTimeImmutable $now): bool
    {
        if (!$this->isOpenVote($state)) {
            return false;
        }
		if (!$this->isPastOrEqualDate($state['expiresAt'] ?? $state['deadlineAt'] ?? null, $now)) {
            return false;
        }

        $targetPlayerId = (string) ($state['targetPlayerId'] ?? '');
		$state = $this->resolvedState($state, self::STATUS_EXPIRED, $now);
        $snapshot['disconnectVote'] = $state;
		$this->setCooldown($snapshot, $state, 'wait');
        if ($targetPlayerId !== '') {
			$this->appendSystemLog($snapshot, 'gameLog.disconnect.vote.expired', $now, ['targetPlayerId' => $targetPlayerId]);
        } else {
			$this->appendSystemLog($snapshot, 'gameLog.disconnect.vote.expired', $now);
        }

        return true;
    }

    /**
     * @param array<string,mixed> $state
     *
     * @return array<string,mixed>
     */
    private function resolvedState(array $state, string $status, \DateTimeImmutable $now): array
    {
        return [
            ...$state,
            'status' => $status,
			'resolution' => $status === self::STATUS_RESOLVED_EXPEL ? 'expel' : 'wait',
			'resolvedAt' => $now->format(DATE_ATOM),
			'expiresAt' => null,
            'deadlineAt' => null,
			'cooldownUntil' => in_array($status, [self::STATUS_RESOLVED_WAIT, self::STATUS_EXPIRED], true)
                ? $now->modify('+'.self::COOLDOWN_SECONDS.' seconds')->format(DATE_ATOM)
                : null,
        ];
    }

	/** @param array<string,mixed> $state */
	private function setCooldown(array &$snapshot, array $state, string $reason): void
	{
		$targetPlayerId = is_string($state['targetPlayerId'] ?? null) ? $state['targetPlayerId'] : '';
		if ($targetPlayerId === '' || !is_string($state['cooldownUntil'] ?? null)) {
			return;
		}
		$snapshot['disconnectCooldowns'] = is_array($snapshot['disconnectCooldowns'] ?? null) ? $snapshot['disconnectCooldowns'] : [];
		$snapshot['disconnectCooldowns'][$targetPlayerId] = [
			'targetPlayerId' => $targetPlayerId,
			'voteId' => $state['voteId'] ?? '',
			'reason' => $reason,
			'cooldownUntil' => $state['cooldownUntil'],
		];
	}

    private function applyExpelResolution(Game $game, array &$snapshot, string $targetPlayerId, \DateTimeImmutable $now): void
    {
        if (!isset($snapshot['players'][$targetPlayerId])) {
            return;
        }

        $snapshot['players'][$targetPlayerId]['concededAt'] = $now->format(DATE_ATOM);
        $this->markTargetAsLeavingInRematch($snapshot, $targetPlayerId, $now);
		GameLifecycleTransition::eliminate($snapshot, $targetPlayerId, 'expelled');
    }

    private function markTargetAsLeavingInRematch(array &$snapshot, string $targetPlayerId, \DateTimeImmutable $now): void
    {
        if (!isset($snapshot['players'][$targetPlayerId])) {
            return;
        }

        $snapshot['rematch'] = is_array($snapshot['rematch'] ?? null) ? $snapshot['rematch'] : ['votes' => []];
        $snapshot['rematch']['votes'] = is_array($snapshot['rematch']['votes'] ?? null) ? $snapshot['rematch']['votes'] : [];
        $snapshot['rematch']['votes'][$targetPlayerId] = [
            'playerId' => $targetPlayerId,
            'displayName' => $this->playerName($snapshot, $targetPlayerId),
            'vote' => GameRematchService::VOTE_LEAVE,
            'votedAt' => $now->format(DATE_ATOM),
        ];
    }

    private function reassignMonarchWhenPlayerLeaves(array &$snapshot, string $leavingPlayerId, string $previousActivePlayerId): void
    {
        GameGlobalDesignationSuccession::reassignWhenPlayerLeaves(
            $snapshot,
            $leavingPlayerId,
            $previousActivePlayerId,
            ['monarch', 'initiative'],
            fn (string $playerId): bool => $this->playerIsActive($snapshot, $playerId),
        );
    }

    private function playerIsActive(array $snapshot, string $playerId): bool
    {
        return isset($snapshot['players'][$playerId])
            && (($snapshot['players'][$playerId]['status'] ?? 'active') !== 'conceded');
    }

    /**
     * @param list<string> $connectedUserIds
     *
     * @return list<string>
     */
    private function eligibleVoterIds(array $snapshot, string $targetPlayerId, array $connectedUserIds): array
    {
        $connected = array_flip($connectedUserIds);
        $eligible = [];
        foreach ($snapshot['players'] ?? [] as $playerId => $player) {
            if (
                !is_string($playerId)
                || !is_array($player)
                || $playerId === $targetPlayerId
				|| ($player['status'] ?? 'active') !== 'active'
                || !isset($connected[$playerId])
            ) {
                continue;
            }

            $eligible[] = $playerId;
        }

        return $eligible;
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    private function normalizedDisconnectVote(array $snapshot): array
    {
        $disconnectVote = is_array($snapshot['disconnectVote'] ?? null) ? $snapshot['disconnectVote'] : [];
        $status = $disconnectVote['status'] ?? null;
		$votes = is_array($disconnectVote['votesByPlayerId'] ?? null) ? $disconnectVote['votesByPlayerId'] : (is_array($disconnectVote['votes'] ?? null) ? $disconnectVote['votes'] : []);
        $normalizedVotes = [];
        foreach ($votes as $playerId => $entry) {
            if (!is_string($playerId) || !is_array($entry)) {
                continue;
            }
			$decision = $entry['decision'] ?? $entry['vote'] ?? null;
            if ($decision !== self::VOTE_WAIT && $decision !== self::VOTE_EXPEL) {
                continue;
            }

            $normalizedVotes[$playerId] = [
                'playerId' => is_string($entry['playerId'] ?? null) ? $entry['playerId'] : $playerId,
                'displayName' => is_string($entry['displayName'] ?? null) ? $entry['displayName'] : $playerId,
				'decision' => (string) $decision,
                'vote' => (string) $decision,
                'votedAt' => is_string($entry['votedAt'] ?? null) ? $entry['votedAt'] : '',
            ];
        }

        return [
			'voteId' => is_string($disconnectVote['voteId'] ?? null) ? $disconnectVote['voteId'] : null,
            'targetPlayerId' => is_string($disconnectVote['targetPlayerId'] ?? null) ? $disconnectVote['targetPlayerId'] : null,
			'openedByPlayerId' => is_string($disconnectVote['openedByPlayerId'] ?? null) ? $disconnectVote['openedByPlayerId'] : null,
			'status' => in_array($status, [self::STATUS_OPEN, self::STATUS_RESOLVED_WAIT, self::STATUS_RESOLVED_EXPEL, self::STATUS_CANCELLED, self::STATUS_EXPIRED, 'resolved_wait', 'resolved_expel'], true)
                ? $status
                : self::STATUS_CANCELLED,
			'eligibleVoterIds' => array_values(array_filter(is_array($disconnectVote['eligibleVoterIds'] ?? null) ? $disconnectVote['eligibleVoterIds'] : [], 'is_string')),
			'requiredVotes' => max(0, (int) ($disconnectVote['requiredVotes'] ?? 0)),
            'openedAt' => is_string($disconnectVote['openedAt'] ?? null) ? $disconnectVote['openedAt'] : null,
			'expiresAt' => is_string($disconnectVote['expiresAt'] ?? null) ? $disconnectVote['expiresAt'] : (is_string($disconnectVote['deadlineAt'] ?? null) ? $disconnectVote['deadlineAt'] : null),
            'deadlineAt' => is_string($disconnectVote['deadlineAt'] ?? null) ? $disconnectVote['deadlineAt'] : null,
			'resolvedAt' => is_string($disconnectVote['resolvedAt'] ?? null) ? $disconnectVote['resolvedAt'] : null,
            'cooldownUntil' => is_string($disconnectVote['cooldownUntil'] ?? null) ? $disconnectVote['cooldownUntil'] : null,
			'resolution' => is_string($disconnectVote['resolution'] ?? null) ? $disconnectVote['resolution'] : null,
			'effectVersion' => max(0, (int) ($disconnectVote['effectVersion'] ?? 0)),
			'votesByPlayerId' => $normalizedVotes,
            'votes' => $normalizedVotes,
        ];
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    private function currentDisconnectVote(Game $game, array $snapshot): array
    {
        $latest = null;
        foreach ($game->events() as $event) {
			if (!$event instanceof GameEvent || ($event->type() !== self::EVENT_TYPE && !str_starts_with($event->type(), 'disconnect.vote.'))) {
                continue;
            }
            $payload = $event->payload();
            $candidate = $payload['disconnectVote'] ?? null;
            if (!is_array($candidate)) {
                continue;
            }
            if ($latest === null || $event->version() >= (int) ($latest['version'] ?? 0)) {
                $latest = [
                    'version' => $event->version(),
                    'state' => $candidate,
                ];
            }
        }

        if (is_array($latest)) {
            return $this->normalizeDisconnectVoteState($latest['state']);
        }

        return $this->normalizedDisconnectVote($snapshot);
    }

    /**
     * @param array<string,mixed> $state
     *
     * @return array<string,mixed>
     */
    private function normalizeDisconnectVoteState(array $state): array
    {
        return $this->normalizedDisconnectVote(['disconnectVote' => $state]);
    }

    /**
     * @return array{event: GameEvent, snapshot: array<string,mixed>}
     */
    private function createTechnicalEvent(Game $game, array &$snapshot, string $reason, ?User $actor): array
    {
        $now = new \DateTimeImmutable();
        $snapshot['version'] = $this->nextEventVersion($game, $snapshot);
        $snapshot['updatedAt'] = $now->format(DATE_ATOM);
        $game->replaceRuntimeSnapshot($snapshot);

		$targetPlayerId = is_string($snapshot['disconnectVote']['targetPlayerId'] ?? null) ? $snapshot['disconnectVote']['targetPlayerId'] : '';
		$player = is_array($snapshot['players'][$targetPlayerId] ?? null) ? $snapshot['players'][$targetPlayerId] : [];
		$eventType = match ($reason) {
			'opened' => 'disconnect.vote.opened',
			'vote.recorded' => 'disconnect.vote.cast',
			'vote.resolved' => 'disconnect.vote.resolved',
			'timeout.wait' => 'disconnect.vote.expired',
			'cancelled.reconnect' => 'disconnect.vote.cancelled',
			default => self::EVENT_TYPE,
		};
		$event = new GameEvent($game, $eventType, [
			'effectVersion' => 4,
            'reason' => $reason,
			'targetPlayerId' => $targetPlayerId !== '' ? $targetPlayerId : null,
			'voteId' => $snapshot['disconnectVote']['voteId'] ?? null,
            'status' => $snapshot['disconnectVote']['status'] ?? null,
			'resolution' => $snapshot['disconnectVote']['resolution'] ?? null,
            'disconnectVote' => $snapshot['disconnectVote'] ?? null,
			'presence' => is_array($snapshot['presence'] ?? null) ? $snapshot['presence'] : [],
			'disconnectCooldowns' => is_array($snapshot['disconnectCooldowns'] ?? null) ? $snapshot['disconnectCooldowns'] : [],
			'rematch' => is_array($snapshot['rematch'] ?? null) ? $snapshot['rematch'] : [],
			'eliminationReason' => $player['eliminationReason'] ?? null,
			'eliminatedAtVersion' => $player['eliminatedAtVersion'] ?? null,
			'concededAt' => $player['concededAt'] ?? null,
			'turn' => is_array($snapshot['turn'] ?? null) ? $snapshot['turn'] : [],
			'turnOrder' => is_array($snapshot['turnOrder'] ?? null) ? $snapshot['turnOrder'] : array_keys($snapshot['players'] ?? []),
			'winnerPlayerId' => $snapshot['winnerPlayerId'] ?? null,
			'resultState' => $snapshot['resultState'] ?? null,
			'finishedReason' => $snapshot['finishedReason'] ?? null,
			'designationsAfter' => $this->designationProjection($snapshot),
            'snapshot_write_count' => 0,
        ], $actor, null, (int) $snapshot['version']);
        $game->addEvent($event);

        return ['event' => $event, 'snapshot' => $snapshot];
    }

	/** @param array<string,mixed> $snapshot @return array<string,array<string,mixed>> */
	private function designationProjection(array $snapshot): array
	{
		$result = [];
		foreach (is_array($snapshot['specialEntities'] ?? null) ? $snapshot['specialEntities'] : [] as $entity) {
			if (is_array($entity) && in_array($entity['template'] ?? null, ['monarch', 'initiative'], true)) {
				$result[(string) $entity['template']] = $entity;
			}
		}

		return $result;
	}

    /**
     * @param array<string,mixed> $snapshot
     */
    private function nextEventVersion(Game $game, array $snapshot): int
    {
        $version = max(1, (int) ($snapshot['version'] ?? 1));
        foreach ($game->events() as $event) {
            if ($event instanceof GameEvent) {
                $version = max($version, $event->version());
            }
        }

        return $version + 1;
    }

	/** @param array<string,mixed> $params */
    private function appendSystemLog(array &$snapshot, string $message, \DateTimeImmutable $now, array $params = []): void
    {
        $snapshot['eventLog'][] = [
            'id' => Uuid::v7()->toRfc4122(),
            'type' => self::EVENT_TYPE,
            'message' => $message,
			'i18nKey' => $message,
			'params' => $params,
			'visibility' => 'public',
            'actorId' => null,
            'displayName' => 'System',
            'createdAt' => $now->format(DATE_ATOM),
        ];
        $snapshot['eventLog'] = array_slice($snapshot['eventLog'], -250);
    }

    private function isOpenVote(array $state): bool
    {
        return ($state['status'] ?? null) === self::STATUS_OPEN
            && is_string($state['targetPlayerId'] ?? null)
            && trim((string) $state['targetPlayerId']) !== '';
    }

    private function isFutureDate(mixed $value, \DateTimeImmutable $now): bool
    {
        if (!is_string($value) || trim($value) === '') {
            return false;
        }

        try {
            return new \DateTimeImmutable($value) > $now;
        } catch (\Throwable) {
            return false;
        }
    }

    private function isPastOrEqualDate(mixed $value, \DateTimeImmutable $now): bool
    {
        if (!is_string($value) || trim($value) === '') {
            return false;
        }

        try {
            return new \DateTimeImmutable($value) <= $now;
        } catch (\Throwable) {
            return false;
        }
    }

    private function playerName(array $snapshot, string $playerId): string
    {
        return (string) ($snapshot['players'][$playerId]['user']['displayName'] ?? $playerId);
    }
}
