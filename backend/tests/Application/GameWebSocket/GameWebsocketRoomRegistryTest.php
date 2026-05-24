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

    public function testTracksPresenceByUserAcrossMultipleConnectionsInSameGame(): void
    {
        $registry = new GameWebsocketRoomRegistry();
        $sent = [];
        $firstTab = $this->peer('connection-a', 'game-1', $sent, 'user-1');
        $secondTab = $this->peer('connection-b', 'game-1', $sent, 'user-1');

        $registry->join($firstTab);
        self::assertSame(1, $registry->countConnectionsForUserInGame('game-1', 'user-1'));
        self::assertSame(['user-1'], $registry->connectedUserIdsForGame('game-1'));

        $registry->join($secondTab);
        self::assertSame(2, $registry->countConnectionsForUserInGame('game-1', 'user-1'));
        self::assertSame(['user-1'], $registry->connectedUserIdsForGame('game-1'));

        $registry->leave('connection-a');
        self::assertSame(1, $registry->countConnectionsForUserInGame('game-1', 'user-1'));
        self::assertSame(['user-1'], $registry->connectedUserIdsForGame('game-1'));

        $registry->leave('connection-b');
        self::assertSame(0, $registry->countConnectionsForUserInGame('game-1', 'user-1'));
        self::assertSame([], $registry->connectedUserIdsForGame('game-1'));
    }

    public function testPresenceIndexesAreScopedByGame(): void
    {
        $registry = new GameWebsocketRoomRegistry();
        $sent = [];
        $gameOnePeer = $this->peer('connection-a', 'game-1', $sent, 'user-1');
        $gameTwoPeer = $this->peer('connection-b', 'game-2', $sent, 'user-1');
        $otherUserPeer = $this->peer('connection-c', 'game-1', $sent, 'user-2');

        $registry->join($gameOnePeer);
        $registry->join($gameTwoPeer);
        $registry->join($otherUserPeer);

        self::assertSame(1, $registry->countConnectionsForUserInGame('game-1', 'user-1'));
        self::assertSame(1, $registry->countConnectionsForUserInGame('game-2', 'user-1'));
        self::assertSame(1, $registry->countConnectionsForUserInGame('game-1', 'user-2'));
        self::assertEqualsCanonicalizing(['user-1', 'user-2'], $registry->connectedUserIdsForGame('game-1'));
        self::assertSame(['user-1'], $registry->connectedUserIdsForGame('game-2'));
    }

    public function testOfflineGraceTrackingRequiresUserToStayDisconnectedLongEnough(): void
    {
        $registry = new GameWebsocketRoomRegistry();
        $sent = [];
        $peer = $this->peer('connection-a', 'game-1', $sent, 'user-1');
        $registry->join($peer);
        $registry->leave('connection-a');

        $offlineAt = new \DateTimeImmutable('2026-01-01T00:00:00+00:00');
        $registry->markUserOffline('game-1', 'user-1', $offlineAt);

        self::assertFalse($registry->isUserOfflineBeyondGrace('game-1', 'user-1', 5, new \DateTimeImmutable('2026-01-01T00:00:04+00:00')));
        self::assertTrue($registry->isUserOfflineBeyondGrace('game-1', 'user-1', 5, new \DateTimeImmutable('2026-01-01T00:00:05+00:00')));
    }

    public function testOfflineGraceTrackingClearsWhenUserReconnects(): void
    {
        $registry = new GameWebsocketRoomRegistry();
        $sent = [];
        $peer = $this->peer('connection-a', 'game-1', $sent, 'user-1');
        $registry->markUserOffline('game-1', 'user-1', new \DateTimeImmutable('2026-01-01T00:00:00+00:00'));
        $registry->join($peer);
        $registry->clearUserOffline('game-1', 'user-1');

        self::assertFalse($registry->isUserOfflineBeyondGrace('game-1', 'user-1', 5, new \DateTimeImmutable('2026-01-01T00:01:00+00:00')));
    }

    /**
     * @param list<array<string,mixed>> $sent
     */
    private function peer(string $connectionId, string $gameId, array &$sent, string $userId = 'user-1'): GameWebsocketPeer
    {
        return new GameWebsocketPeer(
            connectionId: $connectionId,
            gameId: $gameId,
            userId: $userId,
            displayName: 'Player',
            connectedAt: new \DateTimeImmutable('2026-01-01T00:00:00+00:00'),
            send: static function (array $message) use (&$sent): void {
                $sent[] = $message;
            },
        );
    }
}
