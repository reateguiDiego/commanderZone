<?php

namespace App\Infrastructure\Realtime;

use App\Domain\Room\Room;
use Symfony\Component\Mercure\HubInterface;
use Symfony\Component\Mercure\Update;

class RoomEventPublisher
{
    public function __construct(private readonly HubInterface $hub)
    {
    }

    public function publish(Room $room, string $type): void
    {
        $this->hub->publish(new Update(
            $this->topic($room->id()),
            json_encode([
                'type' => $type,
                'roomId' => $room->id(),
                'room' => $room->toArray(),
            ], JSON_THROW_ON_ERROR),
        ));
    }

    public function publishDeleted(string $roomId): void
    {
        $this->hub->publish(new Update(
            $this->topic($roomId),
            json_encode([
                'type' => 'room.deleted',
                'roomId' => $roomId,
            ], JSON_THROW_ON_ERROR),
        ));
    }

    private function topic(string $roomId): string
    {
        return sprintf('rooms/%s/waiting', $roomId);
    }
}
