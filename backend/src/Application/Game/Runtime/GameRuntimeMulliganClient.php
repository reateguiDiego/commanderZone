<?php

namespace App\Application\Game\Runtime;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;

final readonly class GameRuntimeMulliganClient implements GameRuntimeMulliganClientInterface
{
    public function __construct(
        private HttpClientInterface $httpClient,
        private LegacyMulliganRuntimeStateMapper $stateMapper,
        #[Autowire('%game_runtime_internal_url%')]
        private string $runtimeUrl = 'http://game-runtime:8091',
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
        $url = rtrim($this->runtimeUrl, '/').'/commands';
        $runtimeGameId = $shadow ? $gameId.'-shadow' : $gameId;
        $command = [
            'gameId' => $runtimeGameId,
            'baseVersion' => max(1, $baseVersion),
            'clientActionId' => $shadow ? $clientActionId.'-shadow' : $clientActionId,
            'type' => $kind,
            'payload' => $this->runtimePayload($kind, $actorId, $payload),
        ];

        try {
            $response = $this->httpClient->request('POST', $url, [
                'json' => [
                    'actorId' => $actorId,
                    'initialState' => $this->stateMapper->map($snapshot, $runtimeGameId),
                    'command' => $command,
                ],
                'timeout' => 3,
            ]);
            $statusCode = $response->getStatusCode();
            $data = $response->toArray(false);
        } catch (ExceptionInterface $exception) {
            throw new GameRuntimeMulliganException('Runtime mulligan request failed: '.$exception->getMessage(), 0, $exception);
        }

        if ($statusCode < 200 || $statusCode >= 300) {
            $message = is_string($data['error'] ?? null) ? $data['error'] : 'Runtime mulligan command failed.';
            throw new GameRuntimeMulliganException($message);
        }
        if (!is_array($data['event'] ?? null) || !is_array($data['patches'] ?? null)) {
            throw new GameRuntimeMulliganException('Runtime mulligan response is malformed.');
        }

        return new GameRuntimeMulliganResult(
            $data['event'],
            array_values(array_filter($data['patches'], static fn (mixed $patch): bool => is_array($patch))),
            is_array($data['metrics'] ?? null) ? $data['metrics'] : [],
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
