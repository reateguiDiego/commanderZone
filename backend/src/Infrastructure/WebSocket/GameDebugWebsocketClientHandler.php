<?php

namespace App\Infrastructure\WebSocket;

use Amp\Http\Server\Request;
use Amp\Http\Server\Response;
use Amp\Websocket\Server\WebsocketClientHandler;
use Amp\Websocket\WebsocketClient;
use Amp\Websocket\WebsocketCloseCode;
use App\Application\Game\Debug\GameDebugHealthLiveStore;
use App\Application\Game\WebSocket\GameWebsocketConnectionAuthorizer;
use App\Application\Game\WebSocket\GameWebsocketRoomRegistry;
use Psr\Log\LoggerInterface;

final readonly class GameDebugWebsocketClientHandler implements WebsocketClientHandler
{
    public function __construct(
        private GameWebsocketConnectionAuthorizer $authorizer,
        private GameWebsocketRoomRegistry $rooms,
        private GameDebugHealthLiveStore $debugHealth,
        private LoggerInterface $logger,
    ) {
    }

    public function handleClient(WebsocketClient $client, Request $request, Response $response): void
    {
        $gameId = $this->gameIdFromPath($request->getUri()->getPath());
        $ticket = $this->ticketFromQuery($request->getUri()->getQuery());
        if ($gameId === null || $ticket === null) {
            $client->close(WebsocketCloseCode::POLICY_VIOLATION, 'Invalid debug websocket route.');

            return;
        }

        try {
            $context = $this->authorizer->authorize($gameId, $ticket);
        } catch (\InvalidArgumentException) {
            $client->close(WebsocketCloseCode::POLICY_VIOLATION, 'Game debug access denied.');

            return;
        }

        $this->sendJson($client, [
            'kind' => 'debug_connection_state',
            'gameId' => $context->gameId,
            'connectionId' => (string) $client->getId(),
            'status' => 'connected',
            'serverTime' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ]);

        $subscriberId = $this->debugHealth->subscribe($context->gameId, function (array $report) use ($client): void {
            $this->sendJson($client, [
                'kind' => 'debug_health',
                ...$report,
            ]);
        });
        $this->recordCurrentGameplayConnections($context->gameId);

        try {
            while (!$client->isClosed() && ($message = $client->receive()) !== null) {
                if ($message->isBinary()) {
                    $this->sendJson($client, [
                        'kind' => 'debug_error',
                        'gameId' => $context->gameId,
                        'error' => [
                            'code' => 'BINARY_NOT_SUPPORTED',
                            'message' => 'Binary debug WebSocket messages are not supported.',
                            'retryable' => false,
                        ],
                    ]);
                    continue;
                }

                $rawMessage = $message->buffer(limit: 8 * 1024);
                if (trim($rawMessage) === '') {
                    continue;
                }

                try {
                    $payload = json_decode($rawMessage, true, flags: JSON_THROW_ON_ERROR);
                } catch (\JsonException) {
                    $this->sendJson($client, [
                        'kind' => 'debug_error',
                        'gameId' => $context->gameId,
                        'error' => [
                            'code' => 'INVALID_JSON',
                            'message' => 'Debug WebSocket message must be valid JSON.',
                            'retryable' => false,
                        ],
                    ]);
                    continue;
                }

                if (is_array($payload) && ($payload['kind'] ?? null) === 'debug_ping') {
                    $this->sendJson($client, [
                        'kind' => 'debug_pong',
                        'gameId' => $context->gameId,
                        'serverTime' => (new \DateTimeImmutable())->format(DATE_ATOM),
                    ]);
                }
            }
        } finally {
            $this->debugHealth->unsubscribe($context->gameId, $subscriberId);
        }
    }

    private function gameIdFromPath(string $path): ?string
    {
        if (preg_match('#^/games/([^/]+)/debug$#', $path, $matches) !== 1) {
            return null;
        }

        return $matches[1];
    }

    private function ticketFromQuery(string $query): ?string
    {
        parse_str($query, $parameters);
        $ticket = $parameters['ticket'] ?? null;

        return is_string($ticket) && trim($ticket) !== '' ? $ticket : null;
    }

    private function recordCurrentGameplayConnections(string $gameId): void
    {
        $totalConnections = $this->rooms->countForGame($gameId);
        $seenUsers = [];
        foreach ($this->rooms->peersForGame($gameId) as $peer) {
            if (isset($seenUsers[$peer->userId])) {
                continue;
            }

            $seenUsers[$peer->userId] = true;
            $this->debugHealth->recordConnectionSnapshot(
                $gameId,
                $peer->userId,
                $peer->displayName,
                'online',
                $totalConnections,
                $this->rooms->countConnectionsForUserInGame($gameId, $peer->userId),
            );
        }
    }

    /**
     * @param array<string,mixed> $message
     */
    private function sendJson(WebsocketClient $client, array $message): void
    {
        try {
            if (!$client->isClosed()) {
                $client->sendText(json_encode($message, JSON_THROW_ON_ERROR));
            }
        } catch (\Throwable $exception) {
            $this->logger->warning('Could not send game debug websocket message.', ['exception' => $exception]);
        }
    }
}
