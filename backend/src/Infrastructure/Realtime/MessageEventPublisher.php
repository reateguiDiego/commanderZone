<?php

namespace App\Infrastructure\Realtime;

use App\Domain\User\User;
use Symfony\Component\Mercure\HubInterface;
use Symfony\Component\Mercure\Update;

class MessageEventPublisher
{
    public function __construct(private readonly HubInterface $hub)
    {
    }

    public function publishListChanged(User $recipient): void
    {
        $this->hub->publish(new Update(
            'messages/users/'.$recipient->id(),
            json_encode(['type' => 'message.list.changed'], JSON_THROW_ON_ERROR),
            true,
        ));
    }
}
