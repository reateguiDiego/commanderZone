<?php

namespace App\Application\Game\Runtime;

interface GameRuntimeMulliganClientInterface
{
    /**
     * @param array<string,mixed> $snapshot
     * @param array<string,mixed> $payload
     */
    public function dispatch(
        string $kind,
        string $gameId,
        string $actorId,
        int $baseVersion,
        string $clientActionId,
        array $snapshot,
        array $payload,
        bool $shadow = false,
    ): GameRuntimeMulliganResult;
}
