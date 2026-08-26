<?php

namespace App\Tests\Support;

use App\Application\Game\Runtime\GameRuntimeLifecycleControlInterface;

/** Test-only control plane: lifecycle outcomes are already asserted by the API tests. */
final class InMemoryGameRuntimeLifecycleControl implements GameRuntimeLifecycleControlInterface
{
    public function stopByGameId(string $gameId): void
    {
    }

    public function hibernateByGameId(string $gameId): bool
    {
        return true;
    }
}
