<?php

namespace App\Infrastructure\Realtime;

use App\Domain\TableAssistant\TableAssistantRoom;
use Symfony\Component\Mercure\HubInterface;
use Symfony\Component\Mercure\Update;

class TableAssistantEventPublisher
{
    public function __construct(private readonly HubInterface $hub)
    {
    }

    public function publish(TableAssistantRoom $room, string $type, array $payload = []): void
    {
        $this->hub->publish(new Update(
            sprintf('table-assistant/rooms/%s', $room->room()->id()),
            json_encode([
                'roomId' => $room->room()->id(),
                'type' => $type,
                'state' => $room->snapshot(),
                'version' => $room->version(),
                'payload' => $payload,
            ], JSON_THROW_ON_ERROR)
        ));
    }
}
