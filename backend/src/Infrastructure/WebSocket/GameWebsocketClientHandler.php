<?php

namespace App\Infrastructure\WebSocket;

use Amp\Http\Server\Request;
use Amp\Http\Server\Response;
use Amp\Websocket\Server\WebsocketClientHandler;
use Amp\Websocket\WebsocketClient;
use Amp\Websocket\WebsocketCloseCode;
use App\Application\Game\GameDisconnectVoteService;
use App\Application\Game\WebSocket\GameWebsocketConnectionAuthorizer;
use App\Application\Game\WebSocket\GameWebsocketCommandResult;
use App\Application\Game\WebSocket\GameWebsocketDisconnectVoteOrchestrator;
use App\Application\Game\WebSocket\GameWebsocketMessageHandler;
use App\Application\Game\WebSocket\GameWebsocketMessageFactory;
use App\Application\Game\WebSocket\GameWebsocketPeer;
use App\Application\Game\WebSocket\GameWebsocketPatchReplayBuffer;
use App\Application\Game\WebSocket\GameWebsocketRoomRegistry;
use Psr\Log\LoggerInterface;
use Revolt\EventLoop;

final readonly class GameWebsocketClientHandler implements WebsocketClientHandler
{
    private const DISCONNECT_VOTE_GRACE_SECONDS = GameDisconnectVoteService::OFFLINE_GRACE_SECONDS;

    public function __construct(
        private GameWebsocketConnectionAuthorizer $authorizer,
        private GameWebsocketRoomRegistry $rooms,
        private GameWebsocketDisconnectVoteOrchestrator $disconnectVotes,
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
        $wasOffline = $this->rooms->countConnectionsForUserInGame($peer->gameId, $peer->userId) === 1;
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
        if ($wasOffline) {
            $this->rooms->clearUserOffline($peer->gameId, $peer->userId);
            $this->broadcastPresenceChanged($peer, 'online');
            $this->publishDisconnectVotePatch($peer->gameId, $peer->userId, 'online');
        }

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

                $this->publishDisconnectVoteTimeoutPatch($peer->gameId);
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
                if ($this->rooms->countConnectionsForUserInGame($left->gameId, $left->userId) === 0) {
                    $this->rooms->markUserOffline($left->gameId, $left->userId);
                    $this->broadcastPresenceChanged($left, 'offline');
                    $this->scheduleDisconnectVoteOpenAfterGrace($left->gameId, $left->userId);
                }
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

    private function broadcastPresenceChanged(GameWebsocketPeer $peer, string $status): void
    {
        $this->rooms->broadcast($peer->gameId, [
            'kind' => 'player_presence_changed',
            'gameId' => $peer->gameId,
            'playerId' => $peer->userId,
            'displayName' => $peer->displayName,
            'status' => $status,
            'changedAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ]);
    }

    private function publishDisconnectVotePatch(string $gameId, string $targetUserId, string $status): void
    {
        $result = $this->disconnectVotes->handlePresenceTransition($gameId, $targetUserId, $status);
        $this->broadcastCommandResult($gameId, $result);
    }

    private function publishDisconnectVoteTimeoutPatch(string $gameId): void
    {
        $result = $this->disconnectVotes->resolveTimeout($gameId);
        $this->broadcastCommandResult($gameId, $result);
    }

    private function scheduleDisconnectVoteOpenAfterGrace(string $gameId, string $targetUserId): void
    {
        EventLoop::delay((float) self::DISCONNECT_VOTE_GRACE_SECONDS, function () use ($gameId, $targetUserId): void {
            if (!$this->rooms->isUserOfflineBeyondGrace($gameId, $targetUserId, self::DISCONNECT_VOTE_GRACE_SECONDS)) {
                return;
            }

            $this->publishDisconnectVotePatch($gameId, $targetUserId, 'offline');
        });
    }

    private function broadcastCommandResult(string $gameId, ?GameWebsocketCommandResult $result): void
    {
        if (!$result instanceof GameWebsocketCommandResult) {
            return;
        }

        foreach ($this->rooms->peersForGame($gameId) as $roomPeer) {
            $roomPeer->send($result->messageForPeer($roomPeer));
        }
        $this->replayBuffer->rememberResult($gameId, $result);
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
