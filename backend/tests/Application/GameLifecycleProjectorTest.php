<?php

namespace App\Tests\Application;

use App\Application\Game\Lifecycle\GameLifecycleHandoff;
use App\Application\Game\Lifecycle\GameLifecycleProjector;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

final class GameLifecycleProjectorTest extends TestCase
{
    public function testFinishProjectionPersistsWinnerAndIsIdempotent(): void
    {
        $game = $this->game();
        $projector = new GameLifecycleProjector();
        $finishedAt = new \DateTimeImmutable('2026-08-10T12:00:00+00:00');
        $handoff = new GameLifecycleHandoff(
            'game-event-8',
            $game->id(),
            GameLifecycleHandoff::GAME_FINISHED,
            8,
            1,
            12,
            $finishedAt,
            'concede-p2',
            'player-2',
            'conceded',
            'player-1',
            'last_player_standing',
        );

        self::assertSame(GameLifecycleProjector::APPLIED, $projector->apply($game, $handoff));
        self::assertSame(Game::STATUS_FINISHED, $game->status());
        self::assertSame('player-1', $game->winnerPlayerId());
        self::assertEquals($finishedAt, $game->finishedAt());
        self::assertSame('last_player_standing', $game->finishReason());
        self::assertSame('conceded', $game->lifecycleState()['players']['player-2']['status']);
        self::assertEquals($finishedAt->modify('+60 seconds'), $game->nextLifecycleAt());
        self::assertSame($finishedAt->modify('+60 seconds')->format(DATE_ATOM), $game->rematchState()['deadlineAt']);

        self::assertSame(GameLifecycleProjector::DUPLICATE, $projector->apply($game, $handoff));
        self::assertSame('player-1', $game->winnerPlayerId());
    }

    public function testStaleHandoffCannotOverwriteNewerLifecycleState(): void
    {
        $game = $this->game();
        $projector = new GameLifecycleProjector();
        $newer = new GameLifecycleHandoff(
            'presence-newer',
            $game->id(),
            GameLifecycleHandoff::ALL_PLAYERS_DISCONNECTED,
            7,
            1,
            3,
            new \DateTimeImmutable('2026-08-10T12:00:10+00:00'),
        );
        $stale = new GameLifecycleHandoff(
            'presence-stale',
            $game->id(),
            GameLifecycleHandoff::ALL_DISCONNECTED_CANCELLED,
            6,
            1,
            3,
            new \DateTimeImmutable('2026-08-10T12:00:20+00:00'),
        );

        self::assertSame(GameLifecycleProjector::APPLIED, $projector->apply($game, $newer));
        self::assertSame(GameLifecycleProjector::STALE, $projector->apply($game, $stale));
        self::assertEquals($newer->occurredAt, $game->allDisconnectedSince());
        self::assertEquals($newer->occurredAt->modify('+5 minutes'), $game->nextLifecycleAt());
    }

    public function testLaterReconnectAtSameGameplayVersionCancelsGraceDeadline(): void
    {
        $game = $this->game();
        $projector = new GameLifecycleProjector();
        $offlineAt = new \DateTimeImmutable('2026-08-10T12:00:00+00:00');
        $projector->apply($game, new GameLifecycleHandoff(
            'presence-offline', $game->id(), GameLifecycleHandoff::ALL_PLAYERS_DISCONNECTED,
            4, 1, 2, $offlineAt,
        ));

        $result = $projector->apply($game, new GameLifecycleHandoff(
            'presence-online', $game->id(), GameLifecycleHandoff::ALL_DISCONNECTED_CANCELLED,
            4, 1, 2, $offlineAt->modify('+10 seconds'),
        ));

        self::assertSame(GameLifecycleProjector::APPLIED, $result);
        self::assertNull($game->allDisconnectedSince());
        self::assertNull($game->nextLifecycleAt());
    }

    private function game(): Game
    {
        $owner = new User('lifecycle-owner@example.test', 'Lifecycle Owner');

        return new Game(new Room($owner), [
            'version' => 1,
            'players' => [
                'player-1' => ['status' => 'active', 'life' => 0, 'commanderDamage' => ['commander' => 21]],
                'player-2' => ['status' => 'active', 'life' => 40, 'commanderDamage' => []],
            ],
        ]);
    }
}
