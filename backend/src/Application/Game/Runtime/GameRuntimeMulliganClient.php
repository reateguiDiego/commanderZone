<?php

namespace App\Application\Game\Runtime;

final readonly class GameRuntimeMulliganClient implements GameRuntimeMulliganClientInterface
{
    public function __construct(
        private GameRuntimeCommandClientInterface $commands,
    ) {
    }

    public function dispatch(
        string $kind,
        string $gameId,
        string $actorId,
        int $baseVersion,
        string $clientActionId,
        array $snapshot,
        array $payload,
        bool $shadow = false,
    ): GameRuntimeMulliganResult {
        try {
            $result = $this->commands->dispatch(
                $kind,
                $gameId,
                $actorId,
                $baseVersion,
                $clientActionId,
                $snapshot,
                $this->runtimePayload($kind, $actorId, $payload),
                $shadow,
            );
        } catch (GameRuntimeGatewayException $exception) {
            throw new GameRuntimeMulliganException('Runtime mulligan request failed: '.$exception->getMessage(), 0, $exception);
        }

        return new GameRuntimeMulliganResult(
            $result->event,
            $result->patches,
            $result->metrics,
        );
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @return array<string,mixed>
     */
    private function runtimePayload(string $kind, string $actorId, array $payload): array
    {
        return match ($kind) {
            'mulligan.keep' => [
                'playerId' => $actorId,
                'bottomCardIds' => $this->bottomCardIds($payload['bottomCardInstanceIds'] ?? []),
            ],
            'mulligan.scry.confirm' => [
                'playerId' => $actorId,
                'choice' => $this->scryChoice($payload['destination'] ?? null),
            ],
            default => ['playerId' => $actorId],
        };
    }

    /**
     * @return list<string>
     */
    private function bottomCardIds(mixed $bottomCardInstanceIds): array
    {
        if (!is_array($bottomCardInstanceIds)) {
            return [];
        }

        return array_values(array_filter(
            array_map(static fn (mixed $id): string => is_string($id) ? trim($id) : '', $bottomCardInstanceIds),
            static fn (string $id): bool => $id !== '',
        ));
    }

    private function scryChoice(mixed $destination): string
    {
        return strtolower((string) $destination) === 'bottom' ? 'bottom' : 'top';
    }
}
