<?php

namespace App\Application\Game\Runtime;

final readonly class GameplayRuntimeGateway
{
    public function __construct(
        private GameplayRuntimeRouter $router,
        private GameplayRuntimePatchAdapter $patchAdapter,
    ) {
    }

    public function routeFor(string $commandType): GameplayRuntimeRoute
    {
        return $this->router->routeFor($commandType);
    }

    /**
     * @param array<string,mixed> $snapshot
     * @param array<string,mixed> $payload Runtime-ready command payload.
     */
    public function dispatchPrimary(
        string $type,
        string $gameId,
        string $actorId,
        int $baseVersion,
        string $clientActionId,
        array $snapshot,
        array $payload,
    ): GameRuntimeCommandResult {
        if ($this->routeFor($type) !== GameplayRuntimeRoute::RuntimePrimary) {
            throw new GameRuntimeGatewayException(sprintf('Runtime primary is not enabled for command "%s".', $type));
        }

        return $this->dispatch($type, $gameId, $actorId, $baseVersion, $clientActionId, $snapshot, $payload, false);
    }

    /**
     * @param array<string,mixed> $snapshot
     * @param array<string,mixed> $payload Runtime-ready command payload.
     */
    public function dispatchShadow(
        string $type,
        string $gameId,
        string $actorId,
        int $baseVersion,
        string $clientActionId,
        array $snapshot,
        array $payload,
    ): GameRuntimeCommandResult {
        if ($this->routeFor($type) !== GameplayRuntimeRoute::Shadow) {
            throw new GameRuntimeGatewayException(sprintf('Runtime shadow is not enabled for command "%s".', $type));
        }

        return $this->dispatch($type, $gameId, $actorId, $baseVersion, $clientActionId, $snapshot, $payload, true);
    }

    /**
     * @param array<string,mixed> $snapshot
     * @param array<string,mixed> $payload
     */
    private function dispatch(
        string $type,
        string $gameId,
        string $actorId,
        int $baseVersion,
        string $clientActionId,
        array $snapshot,
        array $payload,
        bool $shadow,
    ): GameRuntimeCommandResult {
        $result = $this->router->runtimeClient()->dispatch($type, $gameId, $actorId, $baseVersion, $clientActionId, $snapshot, $payload, $shadow);

        return new GameRuntimeCommandResult(
            $result->event,
            $this->patchAdapter->normalize($result->patches),
            $result->metrics,
        );
    }
}
