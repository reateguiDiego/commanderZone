<?php

namespace App\Infrastructure\WebSocket;

use Amp\Http\Server\Request;
use Amp\Http\Server\Response;
use Amp\Websocket\Server\WebsocketClientHandler;
use Amp\Websocket\WebsocketClient;
use Amp\Websocket\WebsocketCloseCode;
use App\Application\Game\WebSocket\GameWebsocketConnectionAuthorizer;
use App\Application\Game\WebSocket\GameWebsocketCommandResult;
use App\Application\Game\WebSocket\GameWebsocketMessageHandler;
use App\Application\Game\WebSocket\GameWebsocketMessageFactory;
use App\Application\Game\WebSocket\GameWebsocketPeer;
use App\Application\Game\WebSocket\GameWebsocketPatchReplayBuffer;
use App\Application\Game\WebSocket\GameWebsocketRoomRegistry;
use Psr\Log\LoggerInterface;

final readonly class GameWebsocketClientHandler implements WebsocketClientHandler
{
    public function __construct(
        private GameWebsocketConnectionAuthorizer $authorizer,
        private GameWebsocketRoomRegistry $rooms,
        private GameWebsocketMessageHandler $messages,
        private GameWebsocketMessageFactory $messageFactory,
        private GameWebsocketPatchReplayBuffer $replayBuffer,
        private LoggerInterface $logger,
    ) {
    }

    public function handleClient(WebsocketClient $client, Request $request, Response $response): void
    {
        $gameId = $this->gameIdFromPath($request->getUri()->getPath());
        $ticket = $this->ticketFromQuery($request->getUri()->getQuery());
        $lastSeenVersion = $this->lastSeenVersionFromQuery($request->getUri()->getQuery());
        if ($gameId === null || $ticket === null) {
            $client->close(WebsocketCloseCode::POLICY_VIOLATION, 'Invalid gameplay websocket route.');

            return;
        }
        if ($lastSeenVersion === false) {
            $client->close(WebsocketCloseCode::POLICY_VIOLATION, 'Invalid lastSeenVersion.');

            return;
        }

        try {
            $context = $this->authorizer->authorize($gameId, $ticket);
        } catch (\InvalidArgumentException) {
            $client->close(WebsocketCloseCode::POLICY_VIOLATION, 'Game access denied.');

            return;
        }

        $peer = new GameWebsocketPeer(
            connectionId: (string) $client->getId(),
            gameId: $context->gameId,
            userId: $context->userId,
            displayName: $context->displayName,
            connectedAt: new \DateTimeImmutable(),
            send: fn (array $message): null => $this->sendJson($client, $message),
        );

        $this->rooms->join($peer);
        $peer->send([
            'kind' => 'connection_state',
            'gameId' => $peer->gameId,
            'connectionId' => $peer->connectionId,
            'status' => 'connected',
            'serverTime' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ]);
        if (is_int($lastSeenVersion)) {
            $replay = $this->replayBuffer->replay($peer->gameId, $peer->userId, $lastSeenVersion, $context->currentVersion);
            if ($replay === null) {
                $peer->send($this->messageFactory->resyncRequired($peer->gameId, $context->currentVersion, 'version_gap'));
            } else {
                foreach ($replay as $message) {
                    $peer->send($message);
                }
            }
        }
        $this->rooms->broadcast($peer->gameId, [
            'kind' => 'connection_joined',
            'gameId' => $peer->gameId,
            'connection' => $peer->presencePayload(),
        ], $peer->connectionId);

        try {
            while (!$client->isClosed() && ($message = $client->receive()) !== null) {
                if ($message->isBinary()) {
                    $peer->send($this->errorMessage($peer, 'BINARY_NOT_SUPPORTED', 'Binary WebSocket messages are not supported.'));
                    continue;
                }

                try {
                    $payload = json_decode($message->buffer(limit: 64 * 1024), true, flags: JSON_THROW_ON_ERROR);
                } catch (\Throwable) {
                    $peer->send($this->errorMessage($peer, 'INVALID_JSON', 'WebSocket message must be valid JSON.'));
                    continue;
                }

                if (!is_array($payload)) {
                    $peer->send($this->errorMessage($peer, 'INVALID_MESSAGE', 'WebSocket message must be a JSON object.'));
                    continue;
                }

                $reply = $this->messages->handle($payload, $peer);
                if ($reply instanceof GameWebsocketCommandResult) {
                    foreach ($this->rooms->peersForGame($peer->gameId) as $roomPeer) {
                        $roomPeer->send($reply->messageForPeer($roomPeer));
                    }
                    $this->replayBuffer->rememberResult($peer->gameId, $reply);
                    continue;
                }

                if ($reply !== null) {
                    $peer->send($reply);
                }
            }
        } finally {
            $left = $this->rooms->leave($peer->connectionId);
            if ($left instanceof GameWebsocketPeer) {
                $this->rooms->broadcast($left->gameId, [
                    'kind' => 'connection_left',
                    'gameId' => $left->gameId,
                    'connection' => $left->presencePayload(),
                    'leftAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
                ]);
            }
        }
    }

    private function gameIdFromPath(string $path): ?string
    {
        if (preg_match('#^/games/([^/]+)$#', $path, $matches) !== 1) {
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

    private function lastSeenVersionFromQuery(string $query): int|false|null
    {
        parse_str($query, $parameters);
        $lastSeenVersion = $parameters['lastSeenVersion'] ?? null;
        if ($lastSeenVersion === null || $lastSeenVersion === '') {
            return null;
        }
        if (!is_scalar($lastSeenVersion) || filter_var($lastSeenVersion, FILTER_VALIDATE_INT) === false) {
            return false;
        }

        $version = (int) $lastSeenVersion;

        return $version >= 1 ? $version : false;
    }

    /**
     * @param array<string,mixed> $message
     */
    private function sendJson(WebsocketClient $client, array $message): null
    {
        try {
            $client->sendText(json_encode($message, JSON_THROW_ON_ERROR));
        } catch (\Throwable $exception) {
            $this->logger->warning('Could not send gameplay websocket message.', ['exception' => $exception]);
        }

        return null;
    }

    /**
     * @return array<string,mixed>
     */
    private function errorMessage(GameWebsocketPeer $peer, string $code, string $message): array
    {
        return [
            'kind' => 'error',
            'gameId' => $peer->gameId,
            'error' => [
                'code' => $code,
                'message' => $message,
                'retryable' => false,
            ],
        ];
    }
}
