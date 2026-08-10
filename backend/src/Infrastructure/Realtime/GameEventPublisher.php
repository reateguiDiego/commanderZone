<?php

namespace App\Infrastructure\Realtime;

use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\User\User;
use Symfony\Component\Mercure\HubInterface;
use Symfony\Component\Mercure\Update;
use Symfony\Component\Uid\Uuid;

class GameEventPublisher
{
    public function __construct(private readonly HubInterface $hub)
    {
    }

    public function publish(Game $game, GameEvent $event): void
    {
        $this->hub->publish(new Update(
            sprintf('games/%s', $game->id()),
            json_encode([
                'gameId' => $game->id(),
                'event' => $event->toArray(),
                'version' => $game->snapshot()['version'] ?? null,
            ], JSON_THROW_ON_ERROR)
        ));
    }

    /**
     * @param array<string,mixed> $event Unversioned lifecycle notification.
     */
    public function publishControlPlane(Game $game, array $event): void
    {
        $this->hub->publish(new Update(
            sprintf('games/%s', $game->id()),
            json_encode([
                'gameId' => $game->id(),
                'event' => $event,
                'version' => $game->snapshot()['version'] ?? null,
                // A compact projection for lifecycle/rematch UI. This is
                // deliberately outside game_event and does not advance the
                // Go-owned gameplay stream version.
                'controlPlane' => [
                    'status' => $game->status(),
                    'winnerPlayerId' => $game->winnerPlayerId(),
                    'finishedAt' => $game->finishedAt()?->format(DATE_ATOM),
                    'finishReason' => $game->finishReason(),
                    'allDisconnectedSince' => $game->allDisconnectedSince()?->format(DATE_ATOM),
                    'nextLifecycleAt' => $game->nextLifecycleAt()?->format(DATE_ATOM),
                    'ownerId' => $game->room()->owner()->id(),
                    'rematch' => $game->rematchState(),
                ],
            ], JSON_THROW_ON_ERROR)
        ));
    }

    public function publishRematchCreated(Game $game, Room $room, ?User $createdBy): void
    {
        $createdAt = new \DateTimeImmutable();
        $this->publishControlPlane($game, [
            'id' => Uuid::v7()->toRfc4122(),
            'type' => 'room.rematch.created',
            'payload' => [
                'roomId' => $room->id(),
                'room' => $room->toArray(),
            ],
            'clientActionId' => null,
            'createdBy' => $createdBy?->id(),
            'createdAt' => $createdAt->format(DATE_ATOM),
        ]);
    }
}
