<?php

namespace App\Tests\Domain;

use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class GameAccessTest extends TestCase
{
    public function testGameCanOnlyBeAccessedByRoomOwnerOrPlayer(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $player = new User('player@example.test', 'Player');
        $external = new User('external@example.test', 'External');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $room->addPlayer(new RoomPlayer($room, $player));

        $game = new Game($room, ['players' => []]);

        self::assertTrue($game->canBeAccessedBy($owner));
        self::assertTrue($game->canBeAccessedBy($player));
        self::assertFalse($game->canBeAccessedBy($external));
    }
}
