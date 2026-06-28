<?php

namespace App\Application\Game\Runtime;

final readonly class GameRuntimeCommandResult
{
    /**
     * @param array<string,mixed> $event
     * @param list<array<string,mixed>> $patches
     * @param array<string,mixed> $metrics
     */
    public function __construct(
        public array $event,
        public array $patches,
        public array $metrics = [],
    ) {
    }
}
