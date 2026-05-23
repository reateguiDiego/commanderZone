<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\WebSocket\GameWebsocketTicketManager;
use PHPUnit\Framework\TestCase;

class GameWebsocketTicketManagerTest extends TestCase
{
    public function testValidTicketCanBeIssuedAndValidated(): void
    {
        $manager = new GameWebsocketTicketManager('test-secret');
        $now = new \DateTimeImmutable('2026-01-01T00:00:00+00:00');

        $issued = $manager->issue('game-1', 'user-1', $now);
        $validated = $manager->validate($issued->ticket, 'game-1', $now->modify('+30 seconds'));

        self::assertSame('game-1', $validated->gameId);
        self::assertSame('user-1', $validated->userId);
        self::assertSame($now->getTimestamp(), $validated->issuedAt->getTimestamp());
        self::assertSame($now->modify('+60 seconds')->getTimestamp(), $validated->expiresAt->getTimestamp());
    }

    public function testExpiredTicketIsRejected(): void
    {
        $manager = new GameWebsocketTicketManager('test-secret');
        $now = new \DateTimeImmutable('2026-01-01T00:00:00+00:00');
        $issued = $manager->issue('game-1', 'user-1', $now);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('expired');

        $manager->validate($issued->ticket, 'game-1', $now->modify('+61 seconds'));
    }

    public function testManipulatedTicketIsRejected(): void
    {
        $manager = new GameWebsocketTicketManager('test-secret');
        $issued = $manager->issue('game-1', 'user-1', new \DateTimeImmutable('2026-01-01T00:00:00+00:00'));
        $manipulated = substr($issued->ticket, 0, -1).'x';

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('signature');

        $manager->validate($manipulated, 'game-1', new \DateTimeImmutable('2026-01-01T00:00:01+00:00'));
    }

    public function testTicketForAnotherGameIsRejected(): void
    {
        $manager = new GameWebsocketTicketManager('test-secret');
        $issued = $manager->issue('game-1', 'user-1', new \DateTimeImmutable('2026-01-01T00:00:00+00:00'));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('game mismatch');

        $manager->validate($issued->ticket, 'game-2', new \DateTimeImmutable('2026-01-01T00:00:01+00:00'));
    }
}
