<?php

namespace App\Application\Game;

use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;

class GameRematchService
{
    private const COMMANDER_DAMAGE_DEFEAT_THRESHOLD = 21;

    public const VOTE_PLAY_AGAIN = 'play_again';
    public const VOTE_LEAVE = 'leave';
    public const STATUS_LEFT = 'left';
    public const STATUS_ROOM_DELETED = 'room_deleted';
    public const STATUS_WAITING_FOR_GAME_END = 'waiting_for_game_end';
    public const STATUS_WAITING_FOR_VOTES = 'waiting_for_votes';
    public const STATUS_ROOM_READY = 'room_ready';

    public function __construct(private readonly GameCommandHandler $normalizer)
    {
    }

    /**
     * @return array{event: GameEvent, snapshot: array<string,mixed>}
     */
    public function recordVote(Game $game, User $actor, string $vote): array
    {
        if (!in_array($vote, [self::VOTE_PLAY_AGAIN, self::VOTE_LEAVE], true)) {
            throw new \InvalidArgumentException('Unsupported rematch vote.');
        }

        $snapshot = $this->normalizer->normalizeSnapshot($game->snapshot());
        if (!isset($snapshot['players'][$actor->id()])) {
            throw new \InvalidArgumentException('Only game players can vote for a rematch.');
        }

        $votedAt = (new \DateTimeImmutable())->format(DATE_ATOM);
        $snapshot['rematch'] = $this->rematchState($snapshot);
        $snapshot['rematch']['votes'][$actor->id()] = [
            'playerId' => $actor->id(),
            'displayName' => $actor->displayName(),
            'vote' => $vote,
            'votedAt' => $votedAt,
        ];
        $snapshot['version'] = ((int) ($snapshot['version'] ?? 1)) + 1;
        $snapshot['updatedAt'] = $votedAt;

        $game->replaceSnapshot($snapshot);
        $event = new GameEvent($game, 'rematch.vote', [
            'playerId' => $actor->id(),
            'vote' => $vote,
            'votedAt' => $votedAt,
        ], $actor);
        $game->addEvent($event);

        return ['event' => $event, 'snapshot' => $snapshot];
    }

    /**
     * @return list<string>
     */
    public function eligiblePlayAgainPlayerIds(Room $room, array $snapshot): array
    {
        $votes = $this->rematchState($snapshot)['votes'];
        $roomPlayerIds = [];
        foreach ($room->orderedPlayers() as $player) {
            if ($player instanceof RoomPlayer) {
                $roomPlayerIds[] = $player->user()->id();
            }
        }

        return array_values(array_filter(
            $roomPlayerIds,
            static fn (string $playerId): bool => ($votes[$playerId]['vote'] ?? null) === self::VOTE_PLAY_AGAIN,
        ));
    }

    public function activeLifePlayerCount(array $snapshot): int
    {
        $count = 0;
        foreach ($snapshot['players'] ?? [] as $player) {
            if (!is_array($player)) {
                continue;
            }

            if (($player['status'] ?? 'active') === 'active' && !$this->playerIsDefeated($player)) {
                ++$count;
            }
        }

        return $count;
    }

    public function allSnapshotPlayersHaveVoted(array $snapshot): bool
    {
        $playerIds = array_keys($snapshot['players'] ?? []);
        if ($playerIds === []) {
            return false;
        }

        $votes = $this->rematchState($snapshot)['votes'];
        foreach ($playerIds as $playerId) {
            if (!is_string($playerId) || !isset($votes[$playerId]['vote'])) {
                return false;
            }
        }

        return true;
    }

    public function shouldWaitForGameEnd(array $snapshot, User $actor): bool
    {
        $actorState = $snapshot['players'][$actor->id()] ?? [];

        return is_array($actorState) && $this->playerIsDefeated($actorState) && $this->activeLifePlayerCount($snapshot) > 1;
    }

    public function rematchOwner(Room $room, array $playerUserIds): User
    {
        $eligible = array_flip($playerUserIds);
        if (isset($eligible[$room->owner()->id()])) {
            return $room->owner();
        }

        foreach ($room->orderedPlayers() as $player) {
            if ($player instanceof RoomPlayer && isset($eligible[$player->user()->id()])) {
                return $player->user();
            }
        }

        throw new \InvalidArgumentException('Could not resolve a rematch room owner.');
    }

    /**
     * @return array{votes: array<string,array{playerId: string, displayName: string, vote: string, votedAt: string}>}
     */
    private function rematchState(array $snapshot): array
    {
        $rematch = is_array($snapshot['rematch'] ?? null) ? $snapshot['rematch'] : [];
        $votes = is_array($rematch['votes'] ?? null) ? $rematch['votes'] : [];

        return ['votes' => array_filter($votes, static fn (mixed $vote): bool => is_array($vote))];
    }

    /**
     * @param array<string,mixed> $player
     */
    private function playerIsDefeated(array $player): bool
    {
        if ((int) ($player['life'] ?? 0) <= 0) {
            return true;
        }

        foreach (($player['commanderDamage'] ?? []) as $damage) {
            if ((int) $damage >= self::COMMANDER_DAMAGE_DEFEAT_THRESHOLD) {
                return true;
            }
        }

        return false;
    }
}
