<?php

namespace App\Tests\Application;

use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameRematchService;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class GameRematchServiceTest extends TestCase
{
    public function testConcededPlayerPlayAgainVoteWaitsWhileMultiplePlayersRemainAlive(): void
    {
        $actor = new User('conceded@example.test', 'Conceded');
        $aliveOne = new User('alive-one@example.test', 'Alive One');
        $aliveTwo = new User('alive-two@example.test', 'Alive Two');
        $service = new GameRematchService(new GameCommandHandler());
        $snapshot = [
            'players' => [
                $actor->id() => $this->player('conceded'),
                $aliveOne->id() => $this->player('active'),
                $aliveTwo->id() => $this->player('active'),
            ],
        ];

        self::assertSame(2, $service->activeLifePlayerCount($snapshot));
        self::assertTrue($service->shouldWaitForGameEnd($snapshot, $actor));
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
