<?php

namespace App\Application\Game\WebSocket;

final readonly class GameWebsocketConnectionContext
{
    /**
     * @param list<string> $permissions
     */
    public function __construct(
        public string $gameId,
        public string $userId,
        public string $playerId,
        public array $permissions,
        public string $displayName,
        public int $currentVersion,
        public int $viewerMask = 0,
    ) {
    }
}
