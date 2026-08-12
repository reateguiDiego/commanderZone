<?php

namespace App\Infrastructure\Realtime;

use App\Application\Game\GameControlPlaneProjection;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\User\User;
use Symfony\Component\Mercure\HubInterface;
use Symfony\Component\Mercure\Update;
use Symfony\Component\Uid\Uuid;

class GameEventPublisher
{
    public function __construct(
        private readonly HubInterface $hub,
        private readonly GameControlPlaneProjection $controlPlane,
    )
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
        $controlPlane = $this->controlPlane->project($game);
        $eventId = is_string($event['id'] ?? null) && trim((string) $event['id']) !== ''
            ? (string) $event['id']
            : null;

        $this->hub->publish(new Update(
            sprintf('games/%s', $game->id()),
            json_encode([
                'gameId' => $game->id(),
                'event' => $event,
                'version' => $game->snapshot()['version'] ?? null,
                'controlPlaneRevision' => $controlPlane['controlPlaneRevision'],
                // A compact projection for lifecycle/rematch UI. This is
                // deliberately outside game_event and does not advance the
                // Go-owned gameplay stream version.
                'controlPlane' => $controlPlane,
            ], JSON_THROW_ON_ERROR),
            false,
            $eventId,
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

    /**
     * The game row no longer exists at this point, so this intentionally
     * carries no control-plane projection. It only releases table clients
     * subscribed to the old game topic; the waiting-room topic still carries
     * the authoritative room deletion for room screens.
     */
    public function publishRoomDeleted(string $gameId, string $roomId): void
    {
        $createdAt = new \DateTimeImmutable();
        $eventId = Uuid::v7()->toRfc4122();
        $this->hub->publish(new Update(
            sprintf('games/%s', $gameId),
            json_encode([
                'gameId' => $gameId,
                'event' => [
                    'id' => $eventId,
                    'type' => 'room.deleted',
                    'payload' => ['roomId' => $roomId],
                    'clientActionId' => null,
                    'createdBy' => null,
                    'createdAt' => $createdAt->format(DATE_ATOM),
                ],
                'version' => null,
            ], JSON_THROW_ON_ERROR),
            false,
            $eventId,
        ));
    }
}
