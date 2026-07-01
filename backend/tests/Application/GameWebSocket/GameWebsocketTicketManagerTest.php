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
        self::assertSame('user-1', $validated->playerId);
        self::assertSame('player', $validated->role);
        self::assertSame(['view', 'command'], $validated->permissions);
        self::assertSame($now->getTimestamp(), $validated->issuedAt->getTimestamp());
        self::assertSame($now->modify('+60 seconds')->getTimestamp(), $validated->expiresAt->getTimestamp());
    }

    public function testRuntimeClaimsCanBeIssuedAndValidated(): void
    {
        $manager = new GameWebsocketTicketManager('test-secret');
        $now = new \DateTimeImmutable('2026-01-01T00:00:00+00:00');

        $issued = $manager->issue('game-1', 'user-1', $now, 'player-1', 'viewer', ['view']);
        $validated = $manager->validate($issued->ticket, 'game-1', $now->modify('+1 second'));

        self::assertSame('player-1', $validated->playerId);
        self::assertSame('viewer', $validated->role);
        self::assertSame(['view'], $validated->permissions);

        [$encodedPayload] = explode('.', $issued->ticket, 2);
        $payloadJson = base64_decode(str_pad(strtr($encodedPayload, '-_', '+/'), (int) ceil(strlen($encodedPayload) / 4) * 4, '=', STR_PAD_RIGHT), true);
        self::assertIsString($payloadJson);
        $payload = json_decode($payloadJson, true, flags: JSON_THROW_ON_ERROR);

        self::assertSame('game-1', $payload['gameId'] ?? null);
        self::assertSame('user-1', $payload['userId'] ?? null);
        self::assertSame('player-1', $payload['playerId'] ?? null);
        self::assertSame('viewer', $payload['role'] ?? null);
        self::assertSame(['view'], $payload['permissions'] ?? null);
        self::assertSame(['viewer'], $payload['roles'] ?? null);
        self::assertSame('v2', $payload['protocol'] ?? null);
        self::assertSame($now->modify('+60 seconds')->getTimestamp(), $payload['exp'] ?? null);
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
