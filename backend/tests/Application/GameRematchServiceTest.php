<?php

namespace App\Tests\Application;

use App\Application\Game\GameRematchService;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class GameRematchServiceTest extends TestCase
{
    public function testRecordVotePersistsControlPlaneStateWithoutAdvancingGameplayVersion(): void
    {
        $actor = new User('rematch-control@example.test', 'Rematch Control');
        $room = new Room($actor);
        $room->addPlayer(new RoomPlayer($room, $actor));
        $game = new Game($room, [
            'version' => 7,
            'players' => [$actor->id() => $this->player('conceded')],
        ]);
        $service = new GameRematchService();

        $recorded = $service->recordVote($game, $actor, GameRematchService::VOTE_PLAY_AGAIN);

        self::assertSame(7, $game->snapshot()['version']);
        self::assertCount(0, $game->events());
        self::assertSame('play_again', $game->rematchState()['votes'][$actor->id()]['vote']);
        self::assertSame('room.rematch.vote', $recorded['event']['type']);
        self::assertSame(7, $recorded['event']['version']);
    }

    public function testConcededPlayerPlayAgainVoteWaitsWhileMultiplePlayersRemainAlive(): void
    {
        $actor = new User('conceded@example.test', 'Conceded');
        $aliveOne = new User('alive-one@example.test', 'Alive One');
        $aliveTwo = new User('alive-two@example.test', 'Alive Two');
        $room = new Room($actor);
        $room->addPlayer(new RoomPlayer($room, $actor));
        $game = new Game($room, ['players' => [$actor->id() => $this->player('conceded'), $aliveOne->id() => $this->player('active'), $aliveTwo->id() => $this->player('active')]]);
        $service = new GameRematchService();

        self::assertTrue($service->shouldWaitForGameEnd($game));
    }

    public function testOnlyActiveStatusDefinesAlivePlayer(): void
    {
        $actor = new User('active-zero@example.test', 'Active Zero');
        $other = new User('active-damage@example.test', 'Active Damage');
        $service = new GameRematchService();
        $snapshot = [
            'players' => [
                $actor->id() => ['status' => 'active', 'life' => 0, 'commanderDamage' => []],
                $other->id() => ['status' => 'active', 'life' => 40, 'commanderDamage' => ['commander' => 21]],
                'conceded' => ['status' => 'conceded', 'life' => 40, 'commanderDamage' => []],
                'unknown' => ['status' => 'spectator', 'life' => 40, 'commanderDamage' => []],
            ],
        ];

        self::assertSame(2, $service->activeLifePlayerCount($snapshot));
    }

    /**
     * @return array<string,mixed>
     */
    private function player(string $status): array
    {
        return [
            'status' => $status,
            'life' => 40,
            'commanderDamage' => [],
        ];
    }
}
