<?php

namespace App\Application\Game\CommandV2;

use App\Application\Game\GameCommandHandler;
use App\Domain\User\User;

interface GameCommandV2ApplierInterface
{
    public function supports(string $type): bool;

    /**
     * Returns null when the command should fall back to the legacy path.
     *
     * @param array<string,mixed> $snapshot
     * @param array<string,mixed> $payload
     */
    public function apply(array &$snapshot, array $payload, User $actor, GameCommandHandler $helper): ?GameCommandV2Result;
}
