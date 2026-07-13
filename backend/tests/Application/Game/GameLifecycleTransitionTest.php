<?php

namespace App\Tests\Application\Game;

use App\Application\Game\GameLifecycleTransition;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class GameLifecycleTransitionTest extends TestCase
{
    #[DataProvider('playerCounts')]
    public function testEliminationUsesStableTurnOrderForTwoToSixPlayers(int $count): void
    {
        $players = [];
        $turnOrder = [];
        for ($seat = 1; $seat <= $count; ++$seat) {
            $id = 'seat-'.$seat;
            $players[$id] = ['status' => 'active', 'life' => 40];
            $turnOrder[] = $id;
        }
        $snapshot = [
            'version' => 10,
            'players' => $players,
            'turnOrder' => $turnOrder,
            'turn' => ['activePlayerId' => 'seat-1', 'phase' => 'combat', 'number' => 7],
            'specialEntities' => [
                ['id' => 'monarch', 'template' => 'monarch', 'ownerPlayerId' => 'seat-1', 'state' => []],
                ['id' => 'initiative', 'template' => 'initiative', 'ownerPlayerId' => 'seat-1', 'state' => []],
            ],
        ];

        for ($seat = 1; $seat < $count; ++$seat) {
            GameLifecycleTransition::eliminate($snapshot, 'seat-'.$seat, 'life');
        }

        self::assertSame($turnOrder, $snapshot['turnOrder']);
        self::assertSame('combat', $snapshot['turn']['phase']);
        self::assertSame(7, $snapshot['turn']['number']);
        self::assertSame('seat-'.$count, $snapshot['turn']['activePlayerId']);
        self::assertSame('seat-'.$count, $snapshot['winnerPlayerId']);
        self::assertSame('survivor', $snapshot['resultState']);
        self::assertSame('last_active', $snapshot['finishedReason']);
        foreach ($snapshot['specialEntities'] as $designation) {
            self::assertSame('seat-'.$count, $designation['ownerPlayerId']);
        }
    }

    /** @return iterable<string,array{int}> */
    public static function playerCounts(): iterable
    {
        for ($count = 2; $count <= 6; ++$count) {
            yield $count.' players' => [$count];
        }
    }
}
