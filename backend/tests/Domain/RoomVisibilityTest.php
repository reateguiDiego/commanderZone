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
        self::assertSame(Room::DEFAULT_STARTING_LIFE, $room->startingLife());
        self::assertSame(Room::DEFAULT_STARTING_LIFE, $room->toArray()['startingLife']);
        self::assertSame(Room::DEFAULT_TIMER_MODE, $room->timerMode());
        self::assertSame(Room::DEFAULT_TIMER_DURATION_SECONDS, $room->timerDurationSeconds());
        self::assertSame(Room::DEFAULT_TIMER_MODE, $room->toArray()['timerMode']);
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

    public function testPrivateWaitingRoomCanBeViewedByExternalUserWithDirectLink(): void
    {
        $room = new Room(new User('owner@example.test', 'Owner'));

        self::assertTrue($room->canBeViewedBy(new User('guest@example.test', 'Guest')));
    }

    public function testPrivateWaitingRoomCanBeViewedByInvitedUser(): void
    {
        $room = new Room(new User('owner@example.test', 'Owner'));

        self::assertTrue($room->canBeViewedBy(new User('guest@example.test', 'Guest')));
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

    public function testRoomStartingLifeIsClamped(): void
    {
        $room = new Room(new User('owner@example.test', 'Owner'));

        $room->setStartingLife(0);
        self::assertSame(Room::MIN_STARTING_LIFE, $room->startingLife());

        $room->setStartingLife(1200);
        self::assertSame(Room::MAX_STARTING_LIFE, $room->startingLife());

        $room->setStartingLife(35);
        self::assertSame(35, $room->toArray()['startingLife']);
    }

    public function testRoomTimerSettingsAreValidated(): void
    {
        $room = new Room(new User('owner@example.test', 'Owner'));

        $room->setTimerMode(Room::TIMER_TURN);
        $room->setTimerDurationSeconds(10);
        self::assertSame(Room::TIMER_TURN, $room->timerMode());
        self::assertSame(Room::MIN_TIMER_DURATION_SECONDS, $room->timerDurationSeconds());

        $room->setTimerMode('phase');
        $room->setTimerDurationSeconds(9999);
        self::assertSame(Room::DEFAULT_TIMER_MODE, $room->timerMode());
        self::assertSame(Room::MAX_TIMER_DURATION_SECONDS, $room->timerDurationSeconds());
    }

    public function testRoomPlayersKeepSeatOrderUntilEveryPlayerHasRolled(): void
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

        self::assertSame([$first, $second, $third], $room->orderedPlayers());
        self::assertSame(7, $room->toArray()['players'][0]['turnRoll']);
        self::assertNull($room->toArray()['players'][2]['turnRoll']);
    }

    public function testRoomPlayersAreOrderedByTurnRollAfterEveryPlayerHasRolled(): void
    {
        $owner = new User('owner-roll@example.test', 'Owner');
        $secondUser = new User('second-roll@example.test', 'Second');
        $thirdUser = new User('third-roll@example.test', 'Third');
        $room = new Room($owner);
        $first = new RoomPlayer($room, $owner);
        $second = new RoomPlayer($room, $secondUser);
        $third = new RoomPlayer($room, $thirdUser);

        $first->rollTurnOrder(7);
        $second->rollTurnOrder(19);
        $third->rollTurnOrder(11);

        $room->addPlayer($first);
        $room->addPlayer($second);
        $room->addPlayer($third);

        self::assertSame([$second, $third, $first], $room->orderedPlayers());
        self::assertSame(19, $room->toArray()['players'][0]['turnRoll']);
    }

    public function testTiedRoomPlayersCanRerollUntilEveryTurnOrderPositionIsUnique(): void
    {
        $owner = new User('owner-tie@example.test', 'Owner');
        $secondUser = new User('second-tie@example.test', 'Second');
        $thirdUser = new User('third-tie@example.test', 'Third');
        $fourthUser = new User('fourth-tie@example.test', 'Fourth');
        $fifthUser = new User('fifth-tie@example.test', 'Fifth');
        $room = new Room($owner);
        $first = new RoomPlayer($room, $owner);
        $second = new RoomPlayer($room, $secondUser);
        $third = new RoomPlayer($room, $thirdUser);
        $fourth = new RoomPlayer($room, $fourthUser);
        $fifth = new RoomPlayer($room, $fifthUser);

        foreach ([$first, $second, $third, $fourth, $fifth] as $player) {
            $room->addPlayer($player);
        }

        $first->rollTurnOrder(4);
        $second->rollTurnOrder(5);
        $third->rollTurnOrder(5);
        $fourth->rollTurnOrder(10);
        $fifth->rollTurnOrder(10);

        self::assertFalse($room->hasResolvedTurnOrder());
        self::assertFalse($room->canPlayerRollTurnOrder($first));
        self::assertTrue($room->canPlayerRollTurnOrder($second));
        self::assertTrue($room->canPlayerRollTurnOrder($third));
        self::assertTrue($room->canPlayerRollTurnOrder($fourth));
        self::assertTrue($room->canPlayerRollTurnOrder($fifth));

        $second->rollTurnOrder(15);
        $third->rollTurnOrder(12);
        $fourth->rollTurnOrder(7);
        $fifth->rollTurnOrder(7);

        self::assertFalse($room->hasResolvedTurnOrder());
        self::assertFalse($room->canPlayerRollTurnOrder($second));
        self::assertFalse($room->canPlayerRollTurnOrder($third));
        self::assertTrue($room->canPlayerRollTurnOrder($fourth));
        self::assertTrue($room->canPlayerRollTurnOrder($fifth));

        $fourth->rollTurnOrder(2);
        $fifth->rollTurnOrder(19);

        self::assertTrue($room->hasResolvedTurnOrder());
        self::assertSame([$fifth, $fourth, $second, $third, $first], $room->orderedPlayers());
        self::assertSame([10, 19], $room->toArray()['players'][0]['turnRolls']);
        self::assertSame([5, 15], $room->toArray()['players'][2]['turnRolls']);
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
