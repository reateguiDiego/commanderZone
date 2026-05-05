<?php

namespace App\Tests\Domain;

use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class RoomVisibilityTest extends TestCase
{
    public function testRoomDefaultsToPrivateVisibility(): void
    {
        $room = new Room(new User('owner@example.test', 'Owner'));

        self::assertSame(Room::VISIBILITY_PRIVATE, $room->visibility());
        self::assertSame(Room::VISIBILITY_PRIVATE, $room->toArray()['visibility']);
    }

    public function testRoomAcceptsOnlyKnownVisibilityValues(): void
    {
        $room = new Room(new User('owner@example.test', 'Owner'));

        $room->setVisibility(Room::VISIBILITY_PUBLIC);
        self::assertSame(Room::VISIBILITY_PUBLIC, $room->visibility());

        $room->setVisibility('team-only');
        self::assertSame(Room::VISIBILITY_PRIVATE, $room->visibility());
    }

    public function testPublicWaitingRoomCanBeViewedByAnyAuthenticatedUser(): void
    {
        $room = new Room(new User('owner@example.test', 'Owner'));
        $room->setVisibility(Room::VISIBILITY_PUBLIC);

        self::assertTrue($room->canBeViewedBy(new User('guest@example.test', 'Guest')));
    }

    public function testPrivateWaitingRoomCannotBeViewedByExternalUserWithoutInvite(): void
    {
        $room = new Room(new User('owner@example.test', 'Owner'));

        self::assertFalse($room->canBeViewedBy(new User('guest@example.test', 'Guest')));
    }

    public function testPrivateWaitingRoomCanBeViewedByInvitedUser(): void
    {
        $room = new Room(new User('owner@example.test', 'Owner'));

        self::assertTrue($room->canBeViewedBy(new User('guest@example.test', 'Guest'), true));
    }

    public function testStartedRoomCanOnlyBeViewedByOwnerOrPlayer(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $player = new User('player@example.test', 'Player');
        $external = new User('external@example.test', 'External');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $room->addPlayer(new RoomPlayer($room, $player));
        $room->start(new \App\Domain\Game\Game($room, ['players' => []]));

        self::assertTrue($room->canBeViewedBy($owner));
        self::assertTrue($room->canBeViewedBy($player));
        self::assertFalse($room->canBeViewedBy($external));
    }
}
