<?php

namespace App\Application\Game\WebSocket;

final class GameWebsocketRoomRegistry
{
    /**
     * @var array<string, array<string, GameWebsocketPeer>>
     */
    private array $rooms = [];
    /**
     * @var array<string, array<string, array<string, true>>>
     */
    private array $connectionsByGameAndUser = [];
    /**
     * @var array<string, array{gameId:string,userId:string}>
     */
    private array $connectionGameAndUser = [];
    /**
     * @var array<string, array<string, int>>
     */
    private array $offlineSinceByGameAndUser = [];

    public function join(GameWebsocketPeer $peer): void
    {
        $this->rooms[$peer->gameId][$peer->connectionId] = $peer;
        $this->connectionsByGameAndUser[$peer->gameId][$peer->userId][$peer->connectionId] = true;
        $this->connectionGameAndUser[$peer->connectionId] = [
            'gameId' => $peer->gameId,
            'userId' => $peer->userId,
        ];
    }

    public function leave(string $connectionId): ?GameWebsocketPeer
    {
        foreach ($this->rooms as $gameId => $peers) {
            if (!isset($peers[$connectionId])) {
                continue;
            }

            $peer = $peers[$connectionId];
            unset($this->rooms[$gameId][$connectionId]);
            if ($this->rooms[$gameId] === []) {
                unset($this->rooms[$gameId]);
            }
            $this->removeIndexedConnection($connectionId, $peer->gameId, $peer->userId);

            return $peer;
        }
        $this->removeIndexedConnection($connectionId);

        return null;
    }

    /**
     * @return list<GameWebsocketPeer>
     */
    public function peersForGame(string $gameId): array
    {
        return array_values($this->rooms[$gameId] ?? []);
    }

    public function countForGame(string $gameId): int
    {
        return count($this->rooms[$gameId] ?? []);
    }

    public function countConnectionsForUserInGame(string $gameId, string $userId): int
    {
        return count($this->connectionsByGameAndUser[$gameId][$userId] ?? []);
    }

    /**
     * @return list<string>
     */
    public function connectedUserIdsForGame(string $gameId): array
    {
        return array_values(array_keys($this->connectionsByGameAndUser[$gameId] ?? []));
    }

    public function markUserOffline(string $gameId, string $userId, ?\DateTimeImmutable $now = null): void
    {
        $now ??= new \DateTimeImmutable();
        $this->offlineSinceByGameAndUser[$gameId][$userId] = $now->getTimestamp();
    }

    public function clearUserOffline(string $gameId, string $userId): void
    {
        unset($this->offlineSinceByGameAndUser[$gameId][$userId]);
        if (($this->offlineSinceByGameAndUser[$gameId] ?? []) === []) {
            unset($this->offlineSinceByGameAndUser[$gameId]);
        }
    }

    public function isUserOfflineBeyondGrace(
        string $gameId,
        string $userId,
        int $graceSeconds,
        ?\DateTimeImmutable $now = null,
    ): bool {
        if ($this->countConnectionsForUserInGame($gameId, $userId) > 0) {
            return false;
        }

        $offlineSince = $this->offlineSinceByGameAndUser[$gameId][$userId] ?? null;
        if (!is_int($offlineSince)) {
            return false;
        }

        $now ??= new \DateTimeImmutable();

        return $offlineSince + max(0, $graceSeconds) <= $now->getTimestamp();
    }

    /**
     * @param array<string,mixed> $message
     */
    public function broadcast(string $gameId, array $message, ?string $exceptConnectionId = null): void
    {
        foreach ($this->peersForGame($gameId) as $peer) {
            if ($peer->connectionId === $exceptConnectionId) {
                continue;
            }

            $peer->send($message);
        }
    }

    private function removeIndexedConnection(string $connectionId, ?string $gameId = null, ?string $userId = null): void
    {
        $indexed = $this->connectionGameAndUser[$connectionId] ?? null;
        if (is_array($indexed)) {
            $gameId ??= $indexed['gameId'];
            $userId ??= $indexed['userId'];
        }
        if ($gameId === null || $userId === null) {
            return;
        }

        unset($this->connectionsByGameAndUser[$gameId][$userId][$connectionId], $this->connectionGameAndUser[$connectionId]);
        if (($this->connectionsByGameAndUser[$gameId][$userId] ?? []) === []) {
            unset($this->connectionsByGameAndUser[$gameId][$userId]);
        }
        if (($this->connectionsByGameAndUser[$gameId] ?? []) === []) {
            unset($this->connectionsByGameAndUser[$gameId]);
        }
    }
}
