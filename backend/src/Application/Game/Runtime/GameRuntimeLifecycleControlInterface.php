<?php

namespace App\Application\Game\Runtime;

/** Control-plane operation that is safe to retry from the durable stop queue. */
interface GameRuntimeLifecycleControlInterface
{
    public function stopByGameId(string $gameId): void;

    /** True when the actor was absent or hibernated; false when a reconnect owns it. */
    public function hibernateByGameId(string $gameId): bool;
}
