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
}
