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
        self::assertSame('Mesa de Owner', $room->name());
        self::assertSame(Room::FORMAT_COMMANDER, $room->format());
        self::assertSame(Room::DEFAULT_MAX_PLAYERS, $room->maxPlayers());
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

    public function testRoomMaxPlayersIsClampedAndBlocksNewPlayersWhenFull(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $room = new Room($owner);
        $room->setMaxPlayers(20);
        self::assertSame(Room::MAX_MAX_PLAYERS, $room->maxPlayers());

        for ($index = 0; $index < Room::MAX_MAX_PLAYERS; $index++) {
            $player = $index === 0 ? $owner : new User(sprintf('guest-%d@example.test', $index), sprintf('Guest %d', $index));
            self::assertTrue($room->addPlayer(new RoomPlayer($room, $player)));
        }

        self::assertTrue($room->isFull());
        self::assertFalse($room->addPlayer(new RoomPlayer($room, new User('extra@example.test', 'Extra'))));
    }

    public function testRoomPlayersAreOrderedByTurnRollWithUnrolledPlayersLast(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $secondUser = new User('second@example.test', 'Second');
        $thirdUser = new User('third@example.test', 'Third');
        $room = new Room($owner);
        $first = new RoomPlayer($room, $owner);
        $second = new RoomPlayer($room, $secondUser);
        $third = new RoomPlayer($room, $thirdUser);

        $first->rollTurnOrder(7);
        $second->rollTurnOrder(19);

        $room->addPlayer($first);
        $room->addPlayer($second);
        $room->addPlayer($third);

        self::assertSame([$second, $first, $third], $room->orderedPlayers());
        self::assertSame(19, $room->toArray()['players'][0]['turnRoll']);
        self::assertNull($room->toArray()['players'][2]['turnRoll']);
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
