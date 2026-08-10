<?php

namespace App\Application\Game\Runtime;

use App\Domain\Game\Game;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/** Low-frequency control-plane disposal; it never dispatches a game command. */
final readonly class GameRuntimeLifecycleControlClient
{
    public function __construct(
        private HttpClientInterface $httpClient,
        #[Autowire('%game_runtime_internal_url%')]
        private string $runtimeUrl = 'http://game-runtime:8091',
    ) {
    }

    public function stop(Game $game): void
    {
		$this->request(['gameId' => $game->id(), 'action' => 'stop']);
    }

    public function release(string $gameId): void
    {
		$this->request(['gameId' => $gameId, 'action' => 'release']);
    }

    /** @param array<string,string> $payload */
    private function request(array $payload): void
    {
        try {
            $response = $this->httpClient->request('POST', rtrim($this->runtimeUrl, '/').'/lifecycle/stop', [
                'json' => $payload,
                'timeout' => 3,
            ]);
            if ($response->getStatusCode() >= 300) {
                throw new GameRuntimeGatewayException('Runtime lifecycle request was rejected.');
            }
        } catch (ExceptionInterface $exception) {
            throw new GameRuntimeGatewayException('Runtime lifecycle request failed: '.$exception->getMessage(), 0, $exception);
        }
    }
}
