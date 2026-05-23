<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\WebSocket\GameWebsocketAccessService;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class GameWebsocketAccessServiceTest extends TestCase
{
    public function testAllowsGameOwnerAndRoomPlayers(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $player = new User('player@example.test', 'Player');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $room->addPlayer(new RoomPlayer($room, $player));
        $game = new Game($room, ['players' => []]);
        $access = new GameWebsocketAccessService();

        self::assertTrue($access->canConnect($game, $owner));
        self::assertTrue($access->canConnect($game, $player));
    }

    public function testAllowsSnapshotViewerAndRejectsOutsider(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $outsider = new User('outsider@example.test', 'Outsider');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $game = new Game($room, ['players' => [$viewer->id() => ['zones' => []]]]);
        $access = new GameWebsocketAccessService();

        self::assertTrue($access->canConnect($game, $viewer));
        self::assertFalse($access->canConnect($game, $outsider));
    }
}
