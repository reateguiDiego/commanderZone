<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\WebSocket\GameWebsocketMessageFactory;
use PHPUnit\Framework\TestCase;

class GameWebsocketMessageFactoryTest extends TestCase
{
    public function testCommandAckDoesNotSupportAcceptedStatus(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Unsupported command_ack status: accepted');

        (new GameWebsocketMessageFactory())->commandAck(
            'game-1',
            'message-1',
            'action-1',
            'accepted',
            3,
        );
    }

    public function testRejectedCommandAckShapeHasNoAcceptedStatus(): void
    {
        $message = (new GameWebsocketMessageFactory())->rejectedCommand(
            'game-1',
            'message-1',
            'action-1',
            3,
            'COMMAND_REJECTED',
            'Command rejected.',
        );

        self::assertSame('command_ack', $message['kind']);
        self::assertSame('rejected', $message['status']);
        self::assertNotSame('accepted', $message['status']);
    }

    public function testRejectedTokenQuantityIncludesOnlyStableBounds(): void
    {
        $message = (new GameWebsocketMessageFactory())->rejectedCommand(
            'game-1',
            'message-1',
            'action-1',
            3,
            'INVALID_TOKEN_QUANTITY',
            'Quantity must be between 1 and 20.',
            ['min' => 1, 'max' => 20],
        );

        self::assertSame('rejected', $message['status']);
        self::assertSame('INVALID_TOKEN_QUANTITY', $message['error']['code']);
        self::assertSame(1, $message['error']['min']);
        self::assertSame(20, $message['error']['max']);
        self::assertArrayNotHasKey('receivedValue', $message['error']);
    }

    public function testResyncRequiredCommandCanIncludeOptionalConflictMetadata(): void
    {
        $message = (new GameWebsocketMessageFactory())->resyncRequiredCommand(
            'game-1',
            'message-1',
            'action-1',
            7,
            'BASE_VERSION_MISMATCH',
            'Version mismatch.',
            [
                'commandBaseVersion' => 6,
                'currentVersion' => 7,
                'delta' => 1,
                'classification' => 'concurrent_write',
            ],
        );

        self::assertSame('command_ack', $message['kind']);
        self::assertSame('resync_required', $message['status']);
        self::assertSame('BASE_VERSION_MISMATCH', $message['error']['code']);
        self::assertSame(6, $message['error']['conflict']['commandBaseVersion']);
    }
}
