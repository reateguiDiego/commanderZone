<?php

namespace App\Application\Game\Runtime;

interface GameRuntimeCommandClientInterface
{
    /**
     * @param array<string,mixed> $snapshot Legacy caller context; normal runtime commands must not serialize it.
     * @param array<string,mixed> $payload Runtime-ready command payload.
     */
    public function dispatch(
        string $type,
        string $gameId,
        string $actorId,
        int $baseVersion,
        string $clientActionId,
        array $snapshot,
        array $payload,
        bool $shadow = false,
    ): GameRuntimeCommandResult;
}
