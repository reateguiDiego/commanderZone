<?php

namespace App\Application\Game\Runtime;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final readonly class GameRuntimeCommandClient implements GameRuntimeCommandClientInterface
{
    public function __construct(
        private HttpClientInterface $httpClient,
        private LegacyMulliganRuntimeStateMapper $stateMapper,
        #[Autowire('%game_runtime_internal_url%')]
        private string $runtimeUrl = 'http://game-runtime:8091',
    ) {
    }

    public function dispatch(
        string $type,
        string $gameId,
        string $actorId,
        int $baseVersion,
        string $clientActionId,
        array $snapshot,
        array $payload,
        bool $shadow = false,
    ): GameRuntimeCommandResult {
        $runtimeGameId = $shadow ? $gameId.'-shadow' : $gameId;
        $runtimeClientActionId = $shadow ? $clientActionId.'-shadow' : $clientActionId;

        try {
            $response = $this->httpClient->request('POST', rtrim($this->runtimeUrl, '/').'/commands', [
                'json' => [
                    'actorId' => $actorId,
                    'initialState' => $this->stateMapper->map($snapshot, $runtimeGameId),
                    'command' => [
                        'gameId' => $runtimeGameId,
                        'baseVersion' => max(1, $baseVersion),
                        'clientActionId' => $runtimeClientActionId,
                        'type' => $type,
                        'payload' => $payload,
                    ],
                ],
                'timeout' => 3,
            ]);
            $statusCode = $response->getStatusCode();
            $data = $response->toArray(false);
        } catch (ExceptionInterface $exception) {
            throw new GameRuntimeGatewayException('Runtime command request failed: '.$exception->getMessage(), 0, $exception);
        }

        if ($statusCode < 200 || $statusCode >= 300) {
            $message = is_string($data['error'] ?? null) ? $data['error'] : 'Runtime command failed.';
            throw new GameRuntimeGatewayException($message);
        }
        if (!is_array($data['event'] ?? null) || !is_array($data['patches'] ?? null)) {
            throw new GameRuntimeGatewayException('Runtime command response is malformed.');
        }

        return new GameRuntimeCommandResult(
            $data['event'],
            array_values(array_filter($data['patches'], static fn (mixed $patch): bool => is_array($patch))),
            is_array($data['metrics'] ?? null) ? $data['metrics'] : [],
        );
    }
}
