<?php

namespace App\Application\Game\WebSocket;

use App\Domain\Game\GameEvent;

final readonly class GameWebsocketMessageFactory
{
    private const ACK_STATUSES = ['rejected', 'duplicate', 'resync_required'];

    /**
     * @param list<array<string,mixed>> $operations
     *
     * @return array<string,mixed>
     */
    /**
     * @param array<string,mixed>|null $eventPayload
     */
    public function gamePatch(string $gameId, int $baseVersion, int $version, array $operations, GameEvent $event, ?array $eventPayload = null): array
    {
        $eventData = $event->toArray();
        if ($eventPayload !== null) {
            $eventData['payload'] = $eventPayload;
        }

        $message = [
            'kind' => 'game_patch',
            'gameId' => $gameId,
            'baseVersion' => $baseVersion,
            'version' => $version,
            'operations' => $operations,
            'event' => $eventData,
        ];

        if ($event->clientActionId() !== null) {
            $message['clientActionId'] = $event->clientActionId();
        }

        return $message;
    }

    /**
     * @return array<string,mixed>
     */
    public function commandAck(
        string $gameId,
        ?string $messageId,
        string $clientActionId,
        string $status,
        int $version,
        ?array $error = null,
    ): array {
        if (!in_array($status, self::ACK_STATUSES, true)) {
            throw new \InvalidArgumentException(sprintf('Unsupported command_ack status: %s', $status));
        }

        $message = [
            'kind' => 'command_ack',
            'gameId' => $gameId,
            'clientActionId' => $clientActionId,
            'status' => $status,
            'version' => $version,
        ];
        if ($messageId !== null) {
            $message['messageId'] = $messageId;
        }
        if ($error !== null) {
            $message['error'] = $error;
        }

        return $message;
    }

    /**
     * @return array<string,mixed>
     */
    public function rejectedCommand(string $gameId, ?string $messageId, string $clientActionId, int $version, string $code, string $message): array
    {
        return $this->commandAck($gameId, $messageId, $clientActionId, 'rejected', $version, [
            'code' => $code,
            'message' => $message,
            'retryable' => false,
        ]);
    }

    /**
     * @return array<string,mixed>
     */
    public function duplicateCommand(string $gameId, ?string $messageId, string $clientActionId, int $version): array
    {
        return $this->commandAck($gameId, $messageId, $clientActionId, 'duplicate', $version);
    }

    /**
     * @return array<string,mixed>
     */
    public function resyncRequiredCommand(string $gameId, ?string $messageId, string $clientActionId, int $version, string $code, string $message): array
    {
        return $this->commandAck($gameId, $messageId, $clientActionId, 'resync_required', $version, [
            'code' => $code,
            'message' => $message,
            'retryable' => true,
        ]);
    }

    /**
     * @return array<string,mixed>
     */
    public function resyncRequired(string $gameId, int $currentVersion, string $reason = 'projection_unavailable'): array
    {
        return [
            'kind' => 'resync_required',
            'gameId' => $gameId,
            'currentVersion' => $currentVersion,
            'reason' => $reason,
        ];
    }
}
