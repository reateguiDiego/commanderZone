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
        private ?array $debugProfile = null,
    ) {
    }

    /**
     * @param array<string,array<string,mixed>> $messagesByUserId
     * @param array<string,mixed>               $fallbackMessage
     */
    public static function forViewers(array $messagesByUserId, array $fallbackMessage, ?array $debugProfile = null): self
    {
        return new self($messagesByUserId, $fallbackMessage, $debugProfile);
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

    /**
     * @return array<string,float>|null
     */
    public function debugProfile(): ?array
    {
        return $this->debugProfile;
    }
}
