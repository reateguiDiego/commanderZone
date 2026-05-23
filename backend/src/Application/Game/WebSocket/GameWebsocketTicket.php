<?php

namespace App\Application\Game\WebSocket;

final readonly class GameWebsocketTicket
{
    public function __construct(
        public string $ticket,
        public string $gameId,
        public string $userId,
        public \DateTimeImmutable $issuedAt,
        public \DateTimeImmutable $expiresAt,
    ) {
    }
}
