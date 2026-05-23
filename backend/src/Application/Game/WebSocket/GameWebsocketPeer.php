<?php

namespace App\Application\Game\WebSocket;

final readonly class GameWebsocketPeer
{
    /**
     * @param \Closure(array<string,mixed>):void $send
     */
    public function __construct(
        public string $connectionId,
        public string $gameId,
        public string $userId,
        public string $displayName,
        public \DateTimeImmutable $connectedAt,
        private \Closure $send,
    ) {
    }

    /**
     * @param array<string,mixed> $message
     */
    public function send(array $message): void
    {
        ($this->send)($message);
    }

    /**
     * @return array<string,mixed>
     */
    public function presencePayload(): array
    {
        return [
            'connectionId' => $this->connectionId,
            'gameId' => $this->gameId,
            'userId' => $this->userId,
            'displayName' => $this->displayName,
            'connectedAt' => $this->connectedAt->format(DATE_ATOM),
        ];
    }
}
