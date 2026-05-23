<?php

namespace App\Application\Game\WebSocket;

final readonly class GameWebsocketConnectionContext
{
    public function __construct(
        public string $gameId,
        public string $userId,
        public string $displayName,
        public int $currentVersion,
    ) {
    }
}
