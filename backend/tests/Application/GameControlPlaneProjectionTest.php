<?php

namespace App\Tests\Application;

use App\Application\Game\GameControlPlaneProjection;
use App\Application\Game\GameRematchService;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

final class GameControlPlaneProjectionTest extends TestCase
{
    public function testProjectsOnlyDurableControlPlaneState(): void
    {
        $owner = new User('control-plane-owner@example.test', 'Control Plane Owner');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $game = new Game($room, [
            'version' => 17,
            'players' => [$owner->id() => ['status' => 'conceded']],
        ]);
        (new GameRematchService())->recordVote($game, $owner, GameRematchService::VOTE_PLAY_AGAIN, 'control-plane-action-1');

        $projection = (new GameControlPlaneProjection())->project($game);

        self::assertSame(1, $projection['controlPlaneRevision']);
        self::assertSame(Game::STATUS_ACTIVE, $projection['status']);
        self::assertSame($owner->id(), $projection['ownerId']);
        self::assertSame('play_again', $projection['rematch']['votes'][$owner->id()]['vote']);
        self::assertSame('control-plane-action-1', $projection['rematch']['votes'][$owner->id()]['clientActionId']);
        self::assertArrayNotHasKey('version', $projection);
        self::assertArrayNotHasKey('snapshot', $projection);
    }
}
