<?php

namespace App\Tests\Application;

use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameMulliganRules;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class GameMulliganPerformanceTest extends TestCase
{
    public function testMulliganBaselineFixtureRecordsMetricsForLargeGame(): void
    {
        [$game, $players] = $this->largeMulliganGame();
        $handler = new GameCommandHandler();
        $startedAt = microtime(true);

        foreach ($players as $player) {
            $handler->apply($game, 'mulligan.take', [], $player);
            $metrics = $handler->consumeLastCommandMetrics();
            self::assertArrayHasKey('mulligan.take_ms', $metrics);
            self::assertArrayHasKey('mulligan.draw_hand_ms', $metrics);
            self::assertSame(7, $metrics['mulligan.hand_size'] ?? null);
            self::assertSame(93, $metrics['mulligan.library_size'] ?? null);
        }

        $currentHand = array_values($game->snapshot()['players'][$players[0]->id()]['zones']['hand'] ?? []);
        $handler->apply($game, 'mulligan.keep', [
            'bottomCardInstanceIds' => array_map(
                static fn (array $card): string => (string) ($card['instanceId'] ?? ''),
                array_slice($currentHand, 0, 3),
            ),
        ], $players[0]);
        $keepMetrics = $handler->consumeLastCommandMetrics();
        self::assertArrayHasKey('mulligan.keep_ms', $keepMetrics);
        self::assertArrayHasKey('mulligan.bottom_cards_ms', $keepMetrics);

        self::assertLessThan(5000, (microtime(true) - $startedAt) * 1000);
    }

    /**
     * @return array{Game,list<User>}
     */
    private function largeMulliganGame(): array
    {
        $players = [
            new User('p1@example.test', 'Player 1'),
            new User('p2@example.test', 'Player 2'),
            new User('p3@example.test', 'Player 3'),
            new User('p4@example.test', 'Player 4'),
        ];
        $room = new Room($players[0]);
        foreach ($players as $player) {
            $room->addPlayer(new RoomPlayer($room, $player));
        }

        $snapshotPlayers = [];
        foreach ($players as $seat => $player) {
            $key = 'p'.($seat + 1);
            $snapshotPlayers[$player->id()] = [
                'user' => $player->toArray(),
                'life' => 40,
                'zones' => [
                    'library' => $this->cards($key.'-library', 93, 'library', $player->id()),
                    'hand' => $this->cards($key.'-hand', 7, 'hand', $player->id()),
                    'battlefield' => [],
                    'graveyard' => [],
                    'exile' => [],
                    'command' => [],
                ],
                'mulligan' => [
                    ...GameMulliganRules::calculateMulliganState(Room::MULLIGAN_LONDON, false, $seat === 0 ? 2 : 0),
                    'status' => 'DECIDING',
                    'ready' => false,
                    'scryCardInstanceId' => null,
                ],
                'commanderDamage' => [],
                'counters' => [],
            ];
        }

        $game = new Game($room, [
            'version' => 1,
            'ownerId' => $players[0]->id(),
            'gamePhase' => 'MULLIGAN',
            'mulligan' => ['rule' => Room::MULLIGAN_LONDON, 'firstMulliganFree' => false],
            'players' => $snapshotPlayers,
            'turn' => ['activePlayerId' => $players[0]->id(), 'phase' => 'main', 'number' => 1],
            'stack' => [],
            'arrows' => [],
            'attachments' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ]);

        return [$game, $players];
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function cards(string $prefix, int $count, string $zone, string $playerId): array
    {
        $cards = [];
        for ($index = 1; $index <= $count; ++$index) {
            $cards[] = [
                'instanceId' => sprintf('%s-%d', $prefix, $index),
                'ownerId' => $playerId,
                'controllerId' => $playerId,
                'cardKey' => sprintf('%s-card-%d@1', $prefix, $index),
                'name' => sprintf('%s %d', $prefix, $index),
                'imageUris' => ['normal' => sprintf('https://cards.example/%s/%d.jpg', $prefix, $index)],
                'oracleText' => 'Benchmark text',
                'cardFaces' => [],
                'typeLine' => 'Creature - Benchmark',
                'zone' => $zone,
                'tapped' => false,
                'revealedTo' => [],
            ];
        }

        return $cards;
    }
}
