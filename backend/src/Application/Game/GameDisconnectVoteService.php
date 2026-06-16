<?php

namespace App\Application\Game;

use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Symfony\Component\Uid\Uuid;

class GameDisconnectVoteService
{
    public const COMMAND_TYPE = 'disconnect.vote';
    public const EVENT_TYPE = 'disconnect.vote.updated';
    public const VOTE_WAIT = 'wait';
    public const VOTE_EXPEL = 'expel';
    public const STATUS_OPEN = 'open';
    public const STATUS_RESOLVED_WAIT = 'resolved_wait';
    public const STATUS_RESOLVED_EXPEL = 'resolved_expel';
    public const STATUS_CANCELLED = 'cancelled';
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
        $snapshot = $this->normalizer->normalizeSnapshot($game->snapshot());
        $state = $this->normalizedDisconnectVote($snapshot);

        if ($this->maybeResolveOnTimeout($snapshot, $state, $connectedUserIds, $now)) {
            $game->replaceSnapshot($snapshot);

            return $this->createTechnicalEvent($game, $snapshot, 'timeout.wait', null);
        }

        if (!isset($snapshot['players'][$targetPlayerId])) {
            return null;
        }
        if (($snapshot['players'][$targetPlayerId]['status'] ?? 'active') === 'conceded') {
            return null;
        }
        if ($this->isOpenVote($state)) {
            return null;
        }
        if (in_array($targetPlayerId, $connectedUserIds, true)) {
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
            $state = $this->resolvedState($state, self::STATUS_RESOLVED_WAIT, $now);
            $snapshot['disconnectVote'] = $state;
            $this->appendSystemLog($snapshot, sprintf('No hay jugadores conectados para votar sobre %s. Se espera reconexion.', $this->playerName($snapshot, $targetPlayerId)), $now);
            $game->replaceSnapshot($snapshot);

            return $this->createTechnicalEvent($game, $snapshot, 'open.skipped_wait', null);
        }

        $openedAt = $now->format(DATE_ATOM);
        $state = [
            'targetPlayerId' => $targetPlayerId,
            'status' => self::STATUS_OPEN,
            'openedAt' => $openedAt,
            'deadlineAt' => $now->modify('+'.self::TIMEOUT_SECONDS.' seconds')->format(DATE_ATOM),
            'cooldownUntil' => null,
            'votes' => [],
        ];
        $snapshot['disconnectVote'] = $state;
        $this->appendSystemLog($snapshot, sprintf('%s se ha desconectado. Se abre votacion de mesa.', $this->playerName($snapshot, $targetPlayerId)), $now);
        $game->replaceSnapshot($snapshot);

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
    ): array {
        if (!in_array($vote, [self::VOTE_WAIT, self::VOTE_EXPEL], true)) {
            throw new \InvalidArgumentException('Unsupported disconnect vote.');
        }

        $now ??= new \DateTimeImmutable();
        $snapshot = $this->normalizer->normalizeSnapshot($game->snapshot());
        $state = $this->normalizedDisconnectVote($snapshot);
        if ($this->maybeResolveOnTimeout($snapshot, $state, $connectedUserIds, $now)) {
            throw new \InvalidArgumentException('Disconnect vote already expired.');
        }

        if (!$this->isOpenVote($state) || ($state['targetPlayerId'] ?? null) !== $targetPlayerId) {
            throw new \InvalidArgumentException('There is no open disconnect vote for the selected player.');
        }
        if (!isset($snapshot['players'][$actor->id()])) {
            throw new \InvalidArgumentException('Only game players can vote.');
        }
        if ($actor->id() === $targetPlayerId) {
            throw new \InvalidArgumentException('Target player cannot vote on own disconnect vote.');
        }

        $eligibleVoterIds = $this->eligibleVoterIds($snapshot, $targetPlayerId, $connectedUserIds);
        if (!in_array($actor->id(), $eligibleVoterIds, true)) {
            throw new \InvalidArgumentException('Only connected players can vote.');
        }

        $state['votes'][$actor->id()] = [
            'playerId' => $actor->id(),
            'displayName' => $actor->displayName(),
            'vote' => $vote,
            'votedAt' => $now->format(DATE_ATOM),
        ];

        $waitVotes = 0;
        $expelVotes = 0;
        foreach ($eligibleVoterIds as $voterId) {
            $entry = $state['votes'][$voterId] ?? null;
            if (!is_array($entry)) {
                continue;
            }

            if (($entry['vote'] ?? null) === self::VOTE_WAIT) {
                ++$waitVotes;
            } elseif (($entry['vote'] ?? null) === self::VOTE_EXPEL) {
                ++$expelVotes;
            }
        }

        $majority = intdiv(count($eligibleVoterIds), 2) + 1;
        $resolution = null;
        if ($expelVotes >= $majority) {
            $resolution = self::STATUS_RESOLVED_EXPEL;
            $this->applyExpelResolution($game, $snapshot, $targetPlayerId, $now);
            $this->appendSystemLog($snapshot, sprintf('La mesa decide expulsar a %s por desconexion.', $this->playerName($snapshot, $targetPlayerId)), $now);
        } elseif ($waitVotes >= $majority) {
            $resolution = self::STATUS_RESOLVED_WAIT;
            $this->appendSystemLog($snapshot, sprintf('La mesa decide esperar a %s.', $this->playerName($snapshot, $targetPlayerId)), $now);
        }

        if ($resolution !== null) {
            $state = $this->resolvedState($state, $resolution, $now);
        }
        $snapshot['disconnectVote'] = $state;
        $game->replaceSnapshot($snapshot);

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
        $snapshot = $this->normalizer->normalizeSnapshot($game->snapshot());
        $state = $this->normalizedDisconnectVote($snapshot);
        if (!$this->maybeResolveOnTimeout($snapshot, $state, $connectedUserIds, $now)) {
            return null;
        }

        $game->replaceSnapshot($snapshot);

        return $this->createTechnicalEvent($game, $snapshot, 'timeout.wait', null);
    }

    /**
     * @return array{event: GameEvent, snapshot: array<string,mixed>}|null
     */
    public function cancelOnReconnect(Game $game, string $targetPlayerId, ?\DateTimeImmutable $now = null): ?array
    {
        $now ??= new \DateTimeImmutable();
        $snapshot = $this->normalizer->normalizeSnapshot($game->snapshot());
        $state = $this->normalizedDisconnectVote($snapshot);
        if (!$this->isOpenVote($state) || ($state['targetPlayerId'] ?? null) !== $targetPlayerId) {
            return null;
        }

        $state['status'] = self::STATUS_CANCELLED;
        $state['openedAt'] = null;
        $state['deadlineAt'] = null;
        $state['cooldownUntil'] = null;
        $state['votes'] = [];
        $snapshot['disconnectVote'] = $state;
        $this->appendSystemLog($snapshot, sprintf('%s se ha reconectado. Votacion cancelada.', $this->playerName($snapshot, $targetPlayerId)), $now);
        $game->replaceSnapshot($snapshot);

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
        if (!$this->isPastOrEqualDate($state['deadlineAt'] ?? null, $now)) {
            return false;
        }

        $targetPlayerId = (string) ($state['targetPlayerId'] ?? '');
        $state = $this->resolvedState($state, self::STATUS_RESOLVED_WAIT, $now);
        $snapshot['disconnectVote'] = $state;
        if ($targetPlayerId !== '') {
            $this->appendSystemLog($snapshot, sprintf('Votacion de desconexion de %s expirada. Se decide esperar.', $this->playerName($snapshot, $targetPlayerId)), $now);
        } else {
            $this->appendSystemLog($snapshot, 'Votacion de desconexion expirada. Se decide esperar.', $now);
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
            'openedAt' => null,
            'deadlineAt' => null,
            'cooldownUntil' => $status === self::STATUS_RESOLVED_WAIT
                ? $now->modify('+'.self::COOLDOWN_SECONDS.' seconds')->format(DATE_ATOM)
                : null,
        ];
    }

    private function applyExpelResolution(Game $game, array &$snapshot, string $targetPlayerId, \DateTimeImmutable $now): void
    {
        if (!isset($snapshot['players'][$targetPlayerId])) {
            return;
        }

        $previousActivePlayerId = is_scalar($snapshot['turn']['activePlayerId'] ?? null)
            ? trim((string) $snapshot['turn']['activePlayerId'])
            : '';
        $snapshot['players'][$targetPlayerId]['status'] = 'conceded';
        $snapshot['players'][$targetPlayerId]['concededAt'] = $now->format(DATE_ATOM);
        $this->reassignMonarchWhenPlayerLeaves($snapshot, $targetPlayerId, $previousActivePlayerId);

        foreach ($game->room()->orderedPlayers() as $roomPlayer) {
            if (!$roomPlayer instanceof RoomPlayer || $roomPlayer->user()->id() !== $targetPlayerId) {
                continue;
            }

            $game->room()->removeUser($roomPlayer->user());
            break;
        }
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
                || ($player['status'] ?? 'active') === 'conceded'
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
        $votes = is_array($disconnectVote['votes'] ?? null) ? $disconnectVote['votes'] : [];
        $normalizedVotes = [];
        foreach ($votes as $playerId => $entry) {
            if (!is_string($playerId) || !is_array($entry)) {
                continue;
            }
            if (($entry['vote'] ?? null) !== self::VOTE_WAIT && ($entry['vote'] ?? null) !== self::VOTE_EXPEL) {
                continue;
            }

            $normalizedVotes[$playerId] = [
                'playerId' => is_string($entry['playerId'] ?? null) ? $entry['playerId'] : $playerId,
                'displayName' => is_string($entry['displayName'] ?? null) ? $entry['displayName'] : $playerId,
                'vote' => (string) $entry['vote'],
                'votedAt' => is_string($entry['votedAt'] ?? null) ? $entry['votedAt'] : '',
            ];
        }

        return [
            'targetPlayerId' => is_string($disconnectVote['targetPlayerId'] ?? null) ? $disconnectVote['targetPlayerId'] : null,
            'status' => in_array($status, [self::STATUS_OPEN, self::STATUS_RESOLVED_WAIT, self::STATUS_RESOLVED_EXPEL, self::STATUS_CANCELLED], true)
                ? $status
                : self::STATUS_CANCELLED,
            'openedAt' => is_string($disconnectVote['openedAt'] ?? null) ? $disconnectVote['openedAt'] : null,
            'deadlineAt' => is_string($disconnectVote['deadlineAt'] ?? null) ? $disconnectVote['deadlineAt'] : null,
            'cooldownUntil' => is_string($disconnectVote['cooldownUntil'] ?? null) ? $disconnectVote['cooldownUntil'] : null,
            'votes' => $normalizedVotes,
        ];
    }

    /**
     * @return array{event: GameEvent, snapshot: array<string,mixed>}
     */
    private function createTechnicalEvent(Game $game, array &$snapshot, string $reason, ?User $actor): array
    {
        $now = new \DateTimeImmutable();
        $snapshot['version'] = max(1, (int) ($snapshot['version'] ?? 1)) + 1;
        $snapshot['updatedAt'] = $now->format(DATE_ATOM);
        $game->replaceSnapshot($snapshot);

        $event = new GameEvent($game, self::EVENT_TYPE, [
            'reason' => $reason,
            'targetPlayerId' => $snapshot['disconnectVote']['targetPlayerId'] ?? null,
            'status' => $snapshot['disconnectVote']['status'] ?? null,
        ], $actor);
        $game->addEvent($event);

        return ['event' => $event, 'snapshot' => $snapshot];
    }

    private function appendSystemLog(array &$snapshot, string $message, \DateTimeImmutable $now): void
    {
        $snapshot['eventLog'][] = [
            'id' => Uuid::v7()->toRfc4122(),
            'type' => self::EVENT_TYPE,
            'message' => $message,
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
