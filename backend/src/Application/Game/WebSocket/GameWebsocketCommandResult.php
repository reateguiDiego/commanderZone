<?php

namespace App\Application\Game\WebSocket;

final readonly class GameWebsocketCommandResult
{
    /**
     * @param array<string,array<string,mixed>> $messagesByUserId
     * @param array<string,mixed>               $fallbackMessage
     */
    private function __construct(
        private array $messagesByUserId,
        private array $fallbackMessage,
    ) {
    }

    /**
     * @param array<string,array<string,mixed>> $messagesByUserId
     * @param array<string,mixed>               $fallbackMessage
     */
    public static function forViewers(array $messagesByUserId, array $fallbackMessage): self
    {
        return new self($messagesByUserId, $fallbackMessage);
    }

    /**
     * @return array<string,mixed>
     */
    public function messageForPeer(GameWebsocketPeer $peer): array
    {
        return $this->messageForUserId($peer->userId);
    }

    /**
     * @return array<string,mixed>
     */
    public function messageForUserId(string $userId): array
    {
        return $this->messagesByUserId[$userId] ?? $this->fallbackMessage;
    }

    /**
     * @return array<string,array<string,mixed>>
     */
    public function messagesByUserId(): array
    {
        return $this->messagesByUserId;
    }
}
