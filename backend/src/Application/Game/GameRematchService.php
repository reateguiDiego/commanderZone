<?php

namespace App\Application\Game;

use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Symfony\Component\Uid\Uuid;

class GameRematchService
{
    public const VOTE_PLAY_AGAIN = 'play_again';
    public const VOTE_LEAVE = 'leave_room';
    public const STATUS_LEFT = 'left';
    public const STATUS_ROOM_DELETED = 'room_deleted';
    public const STATUS_WAITING_FOR_GAME_END = 'waiting_for_game_end';
    public const STATUS_WAITING_FOR_VOTES = 'waiting_for_votes';
    public const STATUS_ROOM_READY = 'room_ready';

    /**
     * @return array{event: array<string,mixed>}
     */
    public function recordVote(Game $game, User $actor, string $vote): array
    {
        if (!in_array($vote, [self::VOTE_PLAY_AGAIN, self::VOTE_LEAVE], true)) {
            throw new \InvalidArgumentException('Unsupported rematch vote.');
        }

        if (!$game->room()->hasPlayer($actor)) {
            throw new \InvalidArgumentException('Only game players can vote for a rematch.');
        }

        $votedAt = new \DateTimeImmutable();
        $game->recordRematchVote($actor, $vote, $votedAt);
        // This is a control-plane notification payload, not a GameEvent entity.
        // It deliberately does not reserve or advance a gameplay stream version.
        $event = [
            'id' => Uuid::v7()->toRfc4122(),
            // This is intentionally informational only. It is never used as a
            // game_event stream version and does not participate in recovery.
            'version' => max(1, (int) ($game->snapshot()['version'] ?? 1)),
            'type' => 'room.rematch.vote',
            'payload' => [
                'playerId' => $actor->id(),
                'vote' => $vote,
                'votedAt' => $votedAt->format(DATE_ATOM),
                'rematch' => $game->rematchState(),
            ],
            'clientActionId' => null,
            'createdBy' => $actor->id(),
            'createdAt' => $votedAt->format(DATE_ATOM),
        ];

        return ['event' => $event];
    }

    /**
     * @return list<string>
     */
    public function eligiblePlayAgainPlayerIds(Room $room, Game $game): array
    {
        $votes = $game->rematchState()['votes'];
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

            if (($player['status'] ?? null) === 'active') {
                ++$count;
            }
        }

        return $count;
    }

    public function allRemainingRoomPlayersHaveVoted(Room $room, Game $game): bool
    {
        if ($room->players()->count() === 0) {
            return false;
        }

        $votes = $game->rematchState()['votes'];
        foreach ($room->players() as $player) {
            if (!$player instanceof RoomPlayer || !isset($votes[$player->user()->id()]['vote'])) {
                return false;
            }
        }

        return true;
    }

    public function shouldWaitForGameEnd(Game $game): bool
    {
        return $game->status() !== Game::STATUS_FINISHED;
    }

    public function rematchOwner(Room $room, array $playerUserIds): User
    {
        $eligible = array_flip($playerUserIds);
        if (isset($eligible[$room->owner()->id()])) {
            return $room->owner();
        }

        $players = array_values(array_filter($room->players()->toArray(), static fn (mixed $player): bool => $player instanceof RoomPlayer));
        usort($players, static fn (RoomPlayer $left, RoomPlayer $right): int => $left->joinedAt() <=> $right->joinedAt());
        foreach ($players as $player) {
            if (isset($eligible[$player->user()->id()])) {
                return $player->user();
            }
        }

        throw new \InvalidArgumentException('Could not resolve a rematch room owner.');
    }

    /**
     * @return array{votes: array<string,array{playerId: string, displayName: string, vote: string, votedAt: string}>}
     */
}
