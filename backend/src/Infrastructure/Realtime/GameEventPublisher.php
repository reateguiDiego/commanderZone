<?php

namespace App\Infrastructure\Realtime;

use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\User\User;
use Symfony\Component\Mercure\HubInterface;
use Symfony\Component\Mercure\Update;

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

    public function publishRematchCreated(Game $game, Room $room, ?User $createdBy): void
    {
        $this->publish($game, new GameEvent($game, 'room.rematch.created', [
            'roomId' => $room->id(),
            'room' => $room->toArray(),
        ], $createdBy));
    }
}
