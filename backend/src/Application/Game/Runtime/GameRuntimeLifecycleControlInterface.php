<?php

namespace App\Application\Game\Runtime;

/** Control-plane operation that is safe to retry from the durable stop queue. */
interface GameRuntimeLifecycleControlInterface
{
    public function stopByGameId(string $gameId): void;
}
