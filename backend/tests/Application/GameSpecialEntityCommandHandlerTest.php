<?php

namespace App\Tests\Application;

use App\Application\Game\GameCommandHandler;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class GameSpecialEntityCommandHandlerTest extends TestCase
{
    public function testCanCreateUpdateAndRemoveSpecialHelpers(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id()));
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.created', [
            'template' => 'the_ring',
            'ownerPlayerId' => $actor->id(),
            'state' => ['level' => 1, 'ringBearerInstanceId' => null],
        ], $actor);

        $ring = $game->snapshot()['specialEntities'][0] ?? null;
        self::assertIsArray($ring);
        self::assertSame('the_ring', $ring['template']);
        self::assertSame($actor->id(), $ring['ownerPlayerId']);
        self::assertSame(['level' => 1, 'ringBearerInstanceId' => null], $ring['state']);

        $handler->apply($game, 'helper.updated', [
            'entityId' => $ring['id'],
            'state' => ['level' => 3, 'ringBearerInstanceId' => null],
        ], $actor);

        self::assertSame(3, $game->snapshot()['specialEntities'][0]['state']['level']);

        $handler->apply($game, 'helper.removed', [
            'entityId' => $ring['id'],
        ], $actor);

        self::assertSame([], $game->snapshot()['specialEntities']);
    }

    public function testGlobalSingletonHelpersKeepOnlyOneEntityAndTrackItsOwner(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id()));
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.created', [
            'template' => 'monarch',
            'ownerPlayerId' => $actor->id(),
        ], $actor);
        $handler->apply($game, 'helper.created', [
            'template' => 'monarch',
            'ownerPlayerId' => $actor->id(),
        ], $actor);

        self::assertCount(1, $game->snapshot()['specialEntities']);
        self::assertSame('monarch', $game->snapshot()['specialEntities'][0]['template']);
        self::assertSame($actor->id(), $game->snapshot()['specialEntities'][0]['ownerPlayerId']);
        self::assertSame('global', $game->snapshot()['specialEntities'][0]['scope']);
    }

    public function testMonarchTransfersToTheNewestOwnerAcrossPlayers(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $challenger = new User('challenger@example.test', 'Challenger');
        $snapshot = $this->snapshot($actor->id());
        $snapshot['players'][$challenger->id()] = $this->player($challenger->id(), []);
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.created', [
            'template' => 'monarch',
            'ownerPlayerId' => $actor->id(),
        ], $actor);
        $handler->apply($game, 'helper.created', [
            'template' => 'monarch',
            'ownerPlayerId' => $challenger->id(),
        ], $challenger);

        self::assertCount(1, $game->snapshot()['specialEntities']);
        self::assertSame('monarch', $game->snapshot()['specialEntities'][0]['template']);
        self::assertSame($challenger->id(), $game->snapshot()['specialEntities'][0]['ownerPlayerId']);
    }

    public function testGlobalHelpersResolveOwnerFromSnapshotPlayerKeys(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $snapshot = $this->snapshotWithSeatKey('seat-1', $actor->id());
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.created', [
            'template' => 'monarch',
        ], $actor);

        self::assertCount(1, $game->snapshot()['specialEntities']);
        self::assertSame('seat-1', $game->snapshot()['specialEntities'][0]['ownerPlayerId']);
    }

    public function testNormalizeSnapshotClearsRingBearerThatLeftTheBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $handler = new GameCommandHandler();
        $snapshot = $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('bear-1', 'Ring Bearer', 'battlefield'),
                    'ownerId' => $actor->id(),
                    'controllerId' => $actor->id(),
                    'typeLine' => 'Creature - Bear',
                ],
            ],
            'specialEntities' => [[
                'id' => 'ring-1',
                'template' => 'the_ring',
                'scope' => 'player',
                'ownerPlayerId' => $actor->id(),
                'card' => null,
                'state' => ['level' => 2, 'ringBearerInstanceId' => 'bear-1'],
                'createdAt' => '2026-01-01T00:00:00+00:00',
            ]],
        ]);

        $game = new Game(new Room($actor), $snapshot);
        $handler->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'bear-1',
        ], $actor);

        self::assertSame(
            ['level' => 2, 'ringBearerInstanceId' => null],
            $game->snapshot()['specialEntities'][0]['state'],
        );
    }

    /**
     * @param array<string,mixed> $patch
     *
     * @return array<string,mixed>
     */
    private function snapshot(string $actorId, array $patch = []): array
    {
        $player = $this->player($actorId, $patch['battlefield'] ?? []);

        $snapshot = [
            'version' => 1,
            'ownerId' => $actorId,
            'players' => [
                $actorId => $player,
            ],
            'turn' => ['activePlayerId' => $actorId, 'phase' => 'main', 'number' => 1],
            'stack' => [],
            'arrows' => [],
            'attachments' => [],
            'specialEntities' => $patch['specialEntities'] ?? [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ];

        return $snapshot;
    }

    /**
     * @return array<string,mixed>
     */
    private function snapshotWithSeatKey(string $playerKey, string $actorUserId, array $patch = []): array
    {
        $player = $this->player($actorUserId, $patch['battlefield'] ?? []);

        return [
            'version' => 1,
            'ownerId' => $playerKey,
            'players' => [
                $playerKey => $player,
            ],
            'turn' => ['activePlayerId' => $playerKey, 'phase' => 'main', 'number' => 1],
            'stack' => [],
            'arrows' => [],
            'attachments' => [],
            'specialEntities' => $patch['specialEntities'] ?? [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ];
    }

    /**
     * @param list<array<string,mixed>> $battlefield
     *
     * @return array<string,mixed>
     */
    private function player(string $playerId, array $battlefield): array
    {
        return [
            'user' => ['id' => $playerId, 'email' => $playerId.'@example.test', 'displayName' => $playerId, 'roles' => []],
            'life' => 40,
            'zones' => [
                'library' => [],
                'hand' => [],
                'battlefield' => $battlefield,
                'graveyard' => [],
                'exile' => [],
                'command' => [],
            ],
            'zoneCounts' => [
                'library' => 0,
                'hand' => 0,
                'battlefield' => count($battlefield),
                'graveyard' => 0,
                'exile' => 0,
                'command' => 0,
            ],
            'commanderDamage' => [],
            'counters' => [],
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function card(string $instanceId, string $name, string $zone): array
    {
        return [
            'instanceId' => $instanceId,
            'name' => $name,
            'zone' => $zone,
            'tapped' => false,
            'counters' => [],
        ];
    }
}
