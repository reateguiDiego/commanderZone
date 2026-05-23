<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\WebSocket\GameWebsocketPeer;
use App\Application\Game\WebSocket\GameWebsocketRoomRegistry;
use PHPUnit\Framework\TestCase;

class GameWebsocketRoomRegistryTest extends TestCase
{
    public function testJoinBroadcastAndLeaveAreScopedByGameRoom(): void
    {
        $registry = new GameWebsocketRoomRegistry();
        $sentA = [];
        $sentB = [];
        $unused = [];
        $peerA = $this->peer('connection-a', 'game-1', $sentA);
        $peerB = $this->peer('connection-b', 'game-1', $sentB);
        $peerOther = $this->peer('connection-c', 'game-2', $unused);

        $registry->join($peerA);
        $registry->join($peerB);
        $registry->join($peerOther);
        $registry->broadcast('game-1', ['kind' => 'connection_joined'], 'connection-a');

        self::assertSame(2, $registry->countForGame('game-1'));
        self::assertSame([], $sentA);
        self::assertSame([['kind' => 'connection_joined']], $sentB);

        self::assertSame($peerA, $registry->leave('connection-a'));
        self::assertSame(1, $registry->countForGame('game-1'));
    }

    public function testBroadcastWithoutExceptionSendsToActorAndOtherPeersInGameRoom(): void
    {
        $registry = new GameWebsocketRoomRegistry();
        $sentActor = [];
        $sentOther = [];
        $sentOutside = [];
        $registry->join($this->peer('connection-a', 'game-1', $sentActor));
        $registry->join($this->peer('connection-b', 'game-1', $sentOther));
        $registry->join($this->peer('connection-c', 'game-2', $sentOutside));

        $patch = ['kind' => 'game_patch', 'gameId' => 'game-1', 'version' => 2];
        $registry->broadcast('game-1', $patch);

        self::assertSame([$patch], $sentActor);
        self::assertSame([$patch], $sentOther);
        self::assertSame([], $sentOutside);
    }

    /**
     * @param list<array<string,mixed>> $sent
     */
    private function peer(string $connectionId, string $gameId, array &$sent): GameWebsocketPeer
    {
        return new GameWebsocketPeer(
            connectionId: $connectionId,
            gameId: $gameId,
            userId: 'user-1',
            displayName: 'Player',
            connectedAt: new \DateTimeImmutable('2026-01-01T00:00:00+00:00'),
            send: static function (array $message) use (&$sent): void {
                $sent[] = $message;
            },
        );
    }
}
