<?php

namespace App\Application\Game\Runtime;

final class GameRuntimeVersionConflictException extends GameRuntimeGatewayException
{
    public function __construct(
        string $message,
        public readonly int $currentVersion,
    ) {
        parent::__construct($message);
    }
}
