<?php

namespace App\Application\Game\Runtime;

use App\Application\Game\Contract\V2\GameplayV2Flags;

final readonly class GameplayRuntimeRouter
{
    private const RUNTIME_DENYLIST = [];

    public function __construct(
        private ?GameplayV2Flags $flags = null,
        private ?GameRuntimeCommandClientInterface $runtimeClient = null,
    ) {
    }

    public function routeFor(string $commandType): GameplayRuntimeRoute
    {
        $canonicalType = GameplayCommandCatalog::canonicalType($commandType);
        if (isset(self::RUNTIME_DENYLIST[$canonicalType])) {
            return GameplayRuntimeRoute::LegacyOnly;
        }
        if (!$this->runtimeClient instanceof GameRuntimeCommandClientInterface || !$this->flags instanceof GameplayV2Flags) {
            return GameplayRuntimeRoute::LegacyOnly;
        }
        if ($this->flags->commandsAllowlist() === []) {
            return GameplayRuntimeRoute::LegacyOnly;
        }
        if (!$this->flags->commandAllowed($canonicalType)) {
            return GameplayRuntimeRoute::LegacyOnly;
        }
        if ($this->flags->runtimeServiceEnabled()) {
            return GameplayRuntimeRoute::RuntimePrimary;
        }
        if ($this->flags->shadowCompareEnabled()) {
            return GameplayRuntimeRoute::Shadow;
        }

        return GameplayRuntimeRoute::LegacyOnly;
    }

    public function runtimeClient(): GameRuntimeCommandClientInterface
    {
        if (!$this->runtimeClient instanceof GameRuntimeCommandClientInterface) {
            throw new GameRuntimeGatewayException('Gameplay runtime client is not configured.');
        }

        return $this->runtimeClient;
    }
}
