<?php

namespace App\Infrastructure\WebSocket;

use Amp\Http\Server\Request;
use Amp\Http\Server\Response;
use Amp\Websocket\Server\WebsocketClientHandler;
use Amp\Websocket\WebsocketClient;
use Amp\Websocket\WebsocketCloseCode;
use App\Application\Game\Debug\GameDebugHealthLiveStore;
use App\Application\Game\GameDisconnectVoteService;
use App\Application\Game\WebSocket\GameWebsocketConnectionAuthorizer;
use App\Application\Game\WebSocket\GameWebsocketCommandResult;
use App\Application\Game\WebSocket\GameWebsocketDisconnectVoteOrchestrator;
use App\Application\Game\WebSocket\GameWebsocketMessageHandler;
use App\Application\Game\WebSocket\GameWebsocketMessageFactory;
use App\Application\Game\WebSocket\GameWebsocketMulliganService;
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
        private GameWebsocketMulliganService $mulligans,
        private GameWebsocketPatchReplayBuffer $replayBuffer,
        private GameDebugHealthLiveStore $debugHealth,
        private LoggerInterface $logger,
    ) {
    }

    public function handleClient(WebsocketClient $client, Request $request, Response $response): void
    {
        $socketConnectStartedAt = microtime(true);
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
        $userConnections = $this->rooms->countConnectionsForUserInGame($peer->gameId, $peer->userId);
        $totalConnections = $this->rooms->countForGame($peer->gameId);
        $wasOffline = $userConnections === 1;
        $this->safeRecordConnectionSnapshot($peer->gameId, $peer->userId, $peer->displayName, 'online', $totalConnections, $userConnections);
        $this->safeRecordBootstrapStage($peer->gameId, 'socket_connect', $this->elapsedMs($socketConnectStartedAt), [
            'debugObserved' => true,
            'lastSeenVersionProvided' => is_int($lastSeenVersion),
            'totalConnections' => $totalConnections,
            'userConnections' => $userConnections,
        ]);

        $connectionState = [
            'kind' => 'connection_state',
            'gameId' => $peer->gameId,
            'connectionId' => $peer->connectionId,
            'status' => 'connected',
            'serverTime' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];
        $connectionStateStartedAt = microtime(true);
        $peer->send($connectionState);
        $this->safeRecordOutboundMessage($peer->gameId, $connectionState, 'direct');
        $this->safeRecordBootstrapStage($peer->gameId, 'first_connection_state', $this->elapsedMs($connectionStateStartedAt), [
            'debugObserved' => true,
            'status' => 'connected',
            'channel' => 'direct',
        ]);
        if (is_int($lastSeenVersion)) {
            $replay = $this->replayBuffer->replay($peer->gameId, $peer->userId, $lastSeenVersion, $context->currentVersion);
            if ($replay === null) {
                $gapMessage = $this->messageFactory->resyncRequired($peer->gameId, $context->currentVersion, 'version_gap');
                $peer->send($gapMessage);
                $this->safeRecordOutboundMessage($peer->gameId, $gapMessage, 'direct');
                $this->safeRecordReplayResult($peer->gameId, $peer->userId, $lastSeenVersion, $context->currentVersion, null, 'gap');
            } else {
                $this->safeRecordReplayResult($peer->gameId, $peer->userId, $lastSeenVersion, $context->currentVersion, count($replay), 'hit');
                foreach ($replay as $message) {
                    $peer->send($message);
                    $this->safeRecordOutboundMessage($peer->gameId, $message, 'replay');
                }
            }
        }
        foreach ($this->mulligans->initialStateMessages($peer->gameId, $peer->userId) as $mulliganStateMessage) {
            $peer->send($mulliganStateMessage);
            $this->safeRecordOutboundMessage($peer->gameId, $mulliganStateMessage, 'direct');
        }
        $joinedMessage = [
            'kind' => 'connection_joined',
            'gameId' => $peer->gameId,
            'connection' => $peer->presencePayload(),
        ];
        $this->rooms->broadcast($peer->gameId, $joinedMessage, $peer->connectionId);
        $this->safeRecordOutboundMessage($peer->gameId, $joinedMessage, 'broadcast');
        if ($wasOffline) {
            $this->rooms->clearUserOffline($peer->gameId, $peer->userId);
            $this->broadcastPresenceChanged($peer, 'online');
            $this->publishDisconnectVotePatch($peer->gameId, $peer->userId, 'online');
        }

        try {
            while (!$client->isClosed() && ($message = $client->receive()) !== null) {
                if ($message->isBinary()) {
                    $error = $this->errorMessage($peer, 'BINARY_NOT_SUPPORTED', 'Binary WebSocket messages are not supported.');
                    $peer->send($error);
                    $this->safeRecordIncomingValidationError($peer->gameId, 'BINARY_NOT_SUPPORTED', 'Binary WebSocket messages are not supported.', ['kind' => 'binary']);
                    $this->safeRecordOutboundMessage($peer->gameId, $error, 'direct');
                    continue;
                }

                $rawMessage = '';
                try {
                    $rawMessage = $message->buffer(limit: 64 * 1024);
                    $payload = json_decode($rawMessage, true, flags: JSON_THROW_ON_ERROR);
                } catch (\Throwable) {
                    $error = $this->errorMessage($peer, 'INVALID_JSON', 'WebSocket message must be valid JSON.');
                    $peer->send($error);
                    $this->safeRecordIncomingValidationError($peer->gameId, 'INVALID_JSON', 'WebSocket message must be valid JSON.', ['kind' => 'invalid_json', 'characters' => strlen($rawMessage)]);
                    $this->safeRecordOutboundMessage($peer->gameId, $error, 'direct');
                    continue;
                }

                if (!is_array($payload)) {
                    $error = $this->errorMessage($peer, 'INVALID_MESSAGE', 'WebSocket message must be a JSON object.');
                    $peer->send($error);
                    $this->safeRecordIncomingValidationError($peer->gameId, 'INVALID_MESSAGE', 'WebSocket message must be a JSON object.', ['kind' => 'invalid_message', 'characters' => strlen($rawMessage)]);
                    $this->safeRecordOutboundMessage($peer->gameId, $error, 'direct');
                    continue;
                }

                $payloadKind = is_string($payload['kind'] ?? null) ? $payload['kind'] : '';
                $isCommand = $payloadKind === 'command'
                    || $payloadKind === 'command.v2'
                    || $this->mulligans->supports($payloadKind);
                $debugEnabled = $this->debugHealth->isObserved($peer->gameId);
                $incomingCharacters = strlen($rawMessage);
                $incomingDebug = [];
                if ($debugEnabled && $isCommand) {
                    $incomingDebug = $this->incomingDebugSummary($payload, $incomingCharacters, $peer->userId);
                } elseif ($debugEnabled) {
                    $this->safeRecordIncomingMessage($peer->gameId, $payload, $incomingCharacters);
                }

                $this->publishDisconnectVoteTimeoutPatch($peer->gameId);
                $startedAt = microtime(true);
                try {
                    $reply = $this->messages->handle($payload, $peer);
                } catch (\Throwable $exception) {
                    $failedCommand = is_array($payload['command'] ?? null) ? $payload['command'] : [];
                    $this->safeRecordIncomingValidationError($peer->gameId, 'UNHANDLED_WEBSOCKET_ERROR', $exception->getMessage(), [
                        'kind' => is_string($payload['kind'] ?? null) ? $payload['kind'] : 'unknown',
                        'action' => is_string($failedCommand['type'] ?? null)
                            ? $failedCommand['type']
                            : (is_string($payload['type'] ?? null) ? $payload['type'] : null),
                        'characters' => $incomingCharacters,
                    ]);

                    throw $exception;
                }
                if ($reply instanceof GameWebsocketCommandResult) {
                    $outgoingDebug = [];
                    foreach ($this->rooms->peersForGame($peer->gameId) as $roomPeer) {
                        foreach ($reply->messagesForPeer($roomPeer) as $messageForPeer) {
                            $roomPeer->send($messageForPeer);
                            if ($isCommand && $debugEnabled) {
                                $outgoingDebug[] = $this->outgoingDebugSummary($messageForPeer, 'broadcast', $roomPeer->userId);
                            } else {
                                $this->safeRecordOutboundMessage($peer->gameId, $messageForPeer, 'broadcast');
                            }
                        }
                    }
                    if ($isCommand && $debugEnabled) {
                        $this->safeRecordActionExchange(
                            $peer->gameId,
                            $incomingDebug,
                            $outgoingDebug,
                            $this->elapsedMs($startedAt),
                            $reply->debugProfile(),
                        );
                    }
                    $this->replayBuffer->rememberResult($peer->gameId, $reply);
                    continue;
                }

                if ($reply !== null) {
                    $peer->send($reply);
                    if ($isCommand && $debugEnabled) {
                        $this->safeRecordActionExchange($peer->gameId, $incomingDebug, [$this->outgoingDebugSummary($reply, 'direct', $peer->userId)], $this->elapsedMs($startedAt));
                    } else {
                        $this->safeRecordOutboundMessage($peer->gameId, $reply, 'direct');
                    }
                } elseif ($isCommand && $debugEnabled) {
                    $this->safeRecordActionExchange($peer->gameId, $incomingDebug, [], $this->elapsedMs($startedAt));
                }
            }
        } finally {
            $left = $this->rooms->leave($peer->connectionId);
            if ($left instanceof GameWebsocketPeer) {
                $leftMessage = [
                    'kind' => 'connection_left',
                    'gameId' => $left->gameId,
                    'connection' => $left->presencePayload(),
                    'leftAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
                ];
                $this->rooms->broadcast($left->gameId, $leftMessage);
                $this->safeRecordOutboundMessage($left->gameId, $leftMessage, 'broadcast');

                $leftUserConnections = $this->rooms->countConnectionsForUserInGame($left->gameId, $left->userId);
                $leftTotalConnections = $this->rooms->countForGame($left->gameId);
                $leftStatus = $leftUserConnections === 0 ? 'offline' : 'online';
                $this->safeRecordConnectionSnapshot($left->gameId, $left->userId, $left->displayName, $leftStatus, $leftTotalConnections, $leftUserConnections);

                if ($leftUserConnections === 0) {
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
        $presenceMessage = [
            'kind' => 'player_presence_changed',
            'gameId' => $peer->gameId,
            'playerId' => $peer->userId,
            'displayName' => $peer->displayName,
            'status' => $status,
            'changedAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];
        $this->rooms->broadcast($peer->gameId, $presenceMessage);
        $this->safeRecordOutboundMessage($peer->gameId, $presenceMessage, 'broadcast');
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
            try {
                if (!$this->rooms->isUserOfflineBeyondGrace($gameId, $targetUserId, self::DISCONNECT_VOTE_GRACE_SECONDS)) {
                    return;
                }

                $this->publishDisconnectVotePatch($gameId, $targetUserId, 'offline');
            } catch (\Throwable $exception) {
                $this->logger->warning('Could not publish delayed disconnect vote patch.', [
                    'exception' => $exception,
                    'gameId' => $gameId,
                    'targetUserId' => $targetUserId,
                ]);
            }
        });
    }

    private function broadcastCommandResult(string $gameId, ?GameWebsocketCommandResult $result): void
    {
        if (!$result instanceof GameWebsocketCommandResult) {
            return;
        }

        foreach ($this->rooms->peersForGame($gameId) as $roomPeer) {
            foreach ($result->messagesForPeer($roomPeer) as $message) {
                $roomPeer->send($message);
                $this->safeRecordOutboundMessage($gameId, $message, 'broadcast');
            }
        }
        $this->replayBuffer->rememberResult($gameId, $result);
    }

    private function safeRecordConnectionSnapshot(string $gameId, string $userId, string $displayName, string $status, int $totalConnections, int $userConnections): void
    {
        if (!$this->debugHealth->isObserved($gameId)) {
            return;
        }

        try {
            $this->debugHealth->recordConnectionSnapshot($gameId, $userId, $displayName, $status, $totalConnections, $userConnections);
        } catch (\Throwable $exception) {
            $this->logger->warning('Could not record gameplay debug health connection snapshot.', ['exception' => $exception]);
        }
    }

    /**
     * @param array<string,mixed> $message
     */
    private function safeRecordOutboundMessage(string $gameId, array $message, ?string $channel): void
    {
        if (!$this->debugHealth->isObserved($gameId)) {
            return;
        }

        try {
            $this->debugHealth->recordOutboundMessage($gameId, $message, $channel);
        } catch (\Throwable $exception) {
            $this->logger->warning('Could not record gameplay debug health outbound message.', ['exception' => $exception]);
        }
    }

    /**
     * @param array<string,mixed> $message
     */
    private function safeRecordIncomingMessage(string $gameId, array $message, int $characters): void
    {
        if (!$this->debugHealth->isObserved($gameId)) {
            return;
        }

        try {
            $this->debugHealth->recordIncomingMessage($gameId, $message, $characters);
        } catch (\Throwable $exception) {
            $this->logger->warning('Could not record gameplay debug health incoming message.', ['exception' => $exception]);
        }
    }

    /**
     * @param array<string,mixed>       $incoming
     * @param list<array<string,mixed>> $outgoing
     */
    private function safeRecordActionExchange(string $gameId, array $incoming, array $outgoing, float $durationMs, ?array $phases = null): void
    {
        if (!$this->debugHealth->isObserved($gameId)) {
            return;
        }

        try {
            $this->debugHealth->recordActionExchange($gameId, $incoming, $outgoing, $durationMs, $phases);
        } catch (\Throwable $exception) {
            $this->logger->warning('Could not record gameplay debug health action exchange.', ['exception' => $exception]);
        }
    }

    /**
     * @param array<string,mixed>|null $meta
     */
    private function safeRecordIncomingValidationError(string $gameId, string $code, string $message, ?array $meta = null): void
    {
        if (!$this->debugHealth->isObserved($gameId)) {
            return;
        }

        try {
            $this->debugHealth->recordIncomingValidationError($gameId, $code, $message, $meta);
        } catch (\Throwable $exception) {
            $this->logger->warning('Could not record gameplay debug health incoming validation error.', ['exception' => $exception]);
        }
    }

    private function safeRecordReplayResult(string $gameId, string $userId, int $lastSeenVersion, int $currentVersion, ?int $replayedCount, string $result): void
    {
        if (!$this->debugHealth->isObserved($gameId)) {
            return;
        }

        try {
            $this->debugHealth->recordReplayResult($gameId, $userId, $lastSeenVersion, $currentVersion, $replayedCount, $result);
        } catch (\Throwable $exception) {
            $this->logger->warning('Could not record gameplay debug health replay result.', ['exception' => $exception]);
        }
    }

    /**
     * @param array<string,mixed>|null $context
     */
    private function safeRecordBootstrapStage(string $gameId, string $stage, float $durationMs, ?array $context = null): void
    {
        if (!$this->debugHealth->isObserved($gameId)) {
            return;
        }

        try {
            $this->debugHealth->recordBootstrapStage($gameId, $stage, $durationMs, $context);
        } catch (\Throwable $exception) {
            $this->logger->warning('Could not record gameplay debug health bootstrap stage.', ['exception' => $exception]);
        }
    }

    /**
     * @param array<string,mixed> $message
     *
     * @return array<string,mixed>
     */
    private function incomingDebugSummary(array $message, int $characters, string $userId): array
    {
        $command = is_array($message['command'] ?? null) ? $message['command'] : [];
        $kind = is_string($message['kind'] ?? null) ? $message['kind'] : 'unknown';
        $isCommandV2 = $kind === 'command.v2';
        $action = is_string($command['type'] ?? null)
            ? $command['type']
            : ($isCommandV2 && is_string($message['type'] ?? null)
                ? $message['type']
                : ($this->mulligans->supports($kind) ? $kind : null));
        $clientActionId = is_string($command['clientActionId'] ?? null)
            ? $command['clientActionId']
            : ($isCommandV2 && is_string($message['clientActionId'] ?? null)
                ? $message['clientActionId']
                : (is_string($message['messageId'] ?? null) ? $message['messageId'] : null));
        $baseVersion = is_int($command['baseVersion'] ?? null)
            ? $command['baseVersion']
            : ($isCommandV2 && is_int($message['baseVersion'] ?? null) ? $message['baseVersion'] : null);

        return [
            'userId' => $userId,
            'kind' => $kind,
            'action' => $action,
            'clientActionId' => $clientActionId,
            'baseVersion' => $baseVersion,
            'characters' => max(0, $characters),
        ];
    }

    /**
     * @param array<string,mixed> $message
     *
     * @return array<string,mixed>
     */
    private function outgoingDebugSummary(array $message, string $channel, string $recipientUserId): array
    {
        $operationTypes = $this->operationTypes($message);
        $summary = [
            'kind' => is_string($message['kind'] ?? null) ? $message['kind'] : 'unknown',
            'status' => is_string($message['status'] ?? null) ? $message['status'] : null,
            'version' => is_int($message['version'] ?? null) ? $message['version'] : null,
            'currentVersion' => is_int($message['currentVersion'] ?? null) ? $message['currentVersion'] : null,
            'operationCount' => is_array($message['operations'] ?? null)
                ? count($message['operations'])
                : (is_array($message['ops'] ?? null) ? count($message['ops']) : 0),
            'operationTypes' => $operationTypes,
            'characters' => $this->jsonCharacters($message),
            'channel' => $channel,
            'recipientUserId' => $recipientUserId,
            'error' => is_array($message['error'] ?? null)
                ? [
                    'code' => is_string($message['error']['code'] ?? null) ? $message['error']['code'] : null,
                ]
                : null,
        ];

        if ($operationTypes !== []) {
            $summary['operations'] = array_map(
                static fn (string $operationType): array => ['op' => $operationType],
                $operationTypes,
            );
        }

        return $summary;
    }

    /**
     * @param array<string,mixed> $message
     *
     * @return list<string>
     */
    private function operationTypes(array $message): array
    {
        $operations = is_array($message['operations'] ?? null)
            ? $message['operations']
            : (is_array($message['ops'] ?? null) ? $message['ops'] : null);
        if (!is_array($operations)) {
            return [];
        }

        $types = [];
        foreach ($operations as $operation) {
            if (!is_array($operation)) {
                continue;
            }

            $operationType = $operation['op'] ?? null;
            if (!is_string($operationType) || trim($operationType) === '') {
                continue;
            }

            $types[$operationType] = true;
        }

        return array_values(array_keys($types));
    }

    /**
     * @param array<string,mixed> $message
     */
    private function jsonCharacters(array $message): int
    {
        try {
            return strlen(json_encode($message, JSON_THROW_ON_ERROR));
        } catch (\JsonException) {
            return 0;
        }
    }

    private function elapsedMs(float $startedAt): float
    {
        return (microtime(true) - $startedAt) * 1000;
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
