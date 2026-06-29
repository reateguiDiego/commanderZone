<?php

namespace App\Application\Game\WebSocket;

final readonly class GameWebsocketTicket
{
    public function __construct(
        public string $ticket,
        public string $gameId,
        public string $userId,
        public string $playerId,
        public string $role,
        /** @var list<string> */
        public array $permissions,
        public \DateTimeImmutable $issuedAt,
        public \DateTimeImmutable $expiresAt,
    ) {
    }
}
