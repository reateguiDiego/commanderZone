<?php

namespace App\Application\Game\WebSocket;

final readonly class GameWebsocketPeer
{
    /**
     * @param \Closure(array<string,mixed>):void $send
     * @param list<string>                       $permissions
     */
    public function __construct(
        public string $connectionId,
        public string $gameId,
        public string $userId,
        public string $displayName,
        public \DateTimeImmutable $connectedAt,
        private \Closure $send,
        public string $playerId = '',
        public array $permissions = ['view', 'command'],
        public int $viewerMask = 0,
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
            'playerId' => $this->effectivePlayerId(),
            'displayName' => $this->displayName,
            'connectedAt' => $this->connectedAt->format(DATE_ATOM),
        ];
    }

    public function effectivePlayerId(): string
    {
        return $this->playerId !== '' ? $this->playerId : $this->userId;
    }

    public function hasPermission(string $permission): bool
    {
        return in_array($permission, $this->permissions, true);
    }
}
