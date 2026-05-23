<?php

namespace App\Application\Game\WebSocket;

final class GameWebsocketRoomRegistry
{
    /**
     * @var array<string, array<string, GameWebsocketPeer>>
     */
    private array $rooms = [];

    public function join(GameWebsocketPeer $peer): void
    {
        $this->rooms[$peer->gameId][$peer->connectionId] = $peer;
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

            return $peer;
        }

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
}
