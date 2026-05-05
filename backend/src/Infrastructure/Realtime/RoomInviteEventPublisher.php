<?php

namespace App\Infrastructure\Realtime;

use App\Domain\Room\RoomInvite;
use App\Domain\User\User;
use Symfony\Component\Mercure\HubInterface;
use Symfony\Component\Mercure\Update;

class RoomInviteEventPublisher
{
    public function __construct(private readonly HubInterface $hub)
    {
    }

    public function publish(User $recipient, string $type, ?RoomInvite $invite = null): void
    {
        $payload = [
            'type' => $type,
            'recipientId' => $recipient->id(),
            'inviteId' => $invite?->id(),
            'status' => $invite?->status(),
            'roomId' => $invite?->room()->id(),
        ];

        $this->hub->publish(new Update(
            sprintf('rooms/invites/users/%s', $recipient->id()),
            json_encode($payload, JSON_THROW_ON_ERROR),
        ));
    }
}

