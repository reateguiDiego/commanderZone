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

    public function testMonarchInitiativeAndCitysBlessingCanStoreOptionalCardRefs(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id()));
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.created', [
            'template' => 'monarch',
            'ownerPlayerId' => $actor->id(),
            'card' => $this->specialCardRef('The Monarch'),
        ], $actor);
        $handler->apply($game, 'helper.created', [
            'template' => 'initiative',
            'ownerPlayerId' => $actor->id(),
            'card' => $this->specialCardRef('The Initiative'),
        ], $actor);
        $handler->apply($game, 'helper.created', [
            'template' => 'citys_blessing',
            'ownerPlayerId' => $actor->id(),
            'card' => $this->specialCardRef('City\'s Blessing'),
        ], $actor);

        $entities = $game->snapshot()['specialEntities'];
        self::assertCount(3, $entities);
        self::assertSame('The Monarch', $entities[0]['card']['name']);
        self::assertSame('The Initiative', $entities[1]['card']['name']);
        self::assertSame('City\'s Blessing', $entities[2]['card']['name']);
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

    public function testMonarchCanBeGivenToAnotherPlayerByCurrentActor(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $snapshot = $this->snapshot($actor->id());
        $snapshot['players'][$opponent->id()] = $this->player($opponent->id(), []);
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.created', [
            'template' => 'monarch',
            'ownerPlayerId' => $actor->id(),
        ], $actor);
        $handler->apply($game, 'helper.created', [
            'template' => 'monarch',
            'ownerPlayerId' => $opponent->id(),
        ], $actor);

        self::assertCount(1, $game->snapshot()['specialEntities']);
        self::assertSame('monarch', $game->snapshot()['specialEntities'][0]['template']);
        self::assertSame($opponent->id(), $game->snapshot()['specialEntities'][0]['ownerPlayerId']);
    }

    public function testMonarchCanBeGivenByCurrentHolderEvenWhenTheyDidNotCreateIt(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $third = new User('third@example.test', 'Third');
        $snapshot = $this->snapshot($actor->id());
        $snapshot['players'][$opponent->id()] = $this->player($opponent->id(), []);
        $snapshot['players'][$third->id()] = $this->player($third->id(), []);
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.created', [
            'template' => 'monarch',
            'ownerPlayerId' => $actor->id(),
        ], $actor);
        $handler->apply($game, 'helper.created', [
            'template' => 'monarch',
            'ownerPlayerId' => $opponent->id(),
        ], $actor);
        $handler->apply($game, 'helper.created', [
            'template' => 'monarch',
            'ownerPlayerId' => $third->id(),
        ], $opponent);

        self::assertCount(1, $game->snapshot()['specialEntities']);
        self::assertSame('monarch', $game->snapshot()['specialEntities'][0]['template']);
        self::assertSame($third->id(), $game->snapshot()['specialEntities'][0]['ownerPlayerId']);
    }

    public function testMonarchCannotBeGivenByPlayerWhoIsNotCurrentHolder(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $third = new User('third@example.test', 'Third');
        $snapshot = $this->snapshot($actor->id());
        $snapshot['players'][$opponent->id()] = $this->player($opponent->id(), []);
        $snapshot['players'][$third->id()] = $this->player($third->id(), []);
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.created', [
            'template' => 'monarch',
            'ownerPlayerId' => $actor->id(),
        ], $actor);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('You can only create helpers for your own player.');
        $handler->apply($game, 'helper.created', [
            'template' => 'monarch',
            'ownerPlayerId' => $third->id(),
        ], $opponent);
    }

    public function testInitiativeCanBeGivenByCurrentHolderEvenWhenTheyDidNotCreateIt(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $third = new User('third@example.test', 'Third');
        $snapshot = $this->snapshot($actor->id());
        $snapshot['players'][$opponent->id()] = $this->player($opponent->id(), []);
        $snapshot['players'][$third->id()] = $this->player($third->id(), []);
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.created', [
            'template' => 'initiative',
            'ownerPlayerId' => $actor->id(),
        ], $actor);
        $handler->apply($game, 'helper.created', [
            'template' => 'initiative',
            'ownerPlayerId' => $opponent->id(),
        ], $actor);
        $handler->apply($game, 'helper.created', [
            'template' => 'initiative',
            'ownerPlayerId' => $third->id(),
            'card' => $this->initiativeCardRef(),
        ], $opponent);

        self::assertCount(1, $game->snapshot()['specialEntities']);
        self::assertSame('initiative', $game->snapshot()['specialEntities'][0]['template']);
        self::assertSame($third->id(), $game->snapshot()['specialEntities'][0]['ownerPlayerId']);
        self::assertSame('Undercity', $game->snapshot()['players'][$third->id()]['zones']['battlefield'][0]['name'] ?? null);
    }

    public function testInitiativeCreatesUndercityForItsOwnerWhenNoDungeonIsActive(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id()));
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.created', [
            'template' => 'initiative',
            'ownerPlayerId' => $actor->id(),
            'card' => $this->initiativeCardRef(),
        ], $actor);

        $battlefield = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'];
        self::assertCount(1, $battlefield);
        self::assertSame('Undercity', $battlefield[0]['name']);
        self::assertSame('dungeon', $battlefield[0]['layout']);
        self::assertSame(['x' => 0, 'y' => 0, 'unit' => 'ratio'], $battlefield[0]['position']);
    }

    public function testInitiativeCannotBeGivenByPlayerWhoIsNotCurrentHolder(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $third = new User('third@example.test', 'Third');
        $snapshot = $this->snapshot($actor->id());
        $snapshot['players'][$opponent->id()] = $this->player($opponent->id(), []);
        $snapshot['players'][$third->id()] = $this->player($third->id(), []);
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.created', [
            'template' => 'initiative',
            'ownerPlayerId' => $actor->id(),
        ], $actor);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('You can only create helpers for your own player.');
        $handler->apply($game, 'helper.created', [
            'template' => 'initiative',
            'ownerPlayerId' => $third->id(),
        ], $opponent);
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

    public function testDayNightStoresCreatorSharedModeAndFixedPosition(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $snapshot = $this->snapshot($actor->id());
        $snapshot['players'][$opponent->id()] = $this->player($opponent->id(), []);
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.created', [
            'template' => 'day_night',
            'state' => ['mode' => 'day'],
        ], $actor);

        $dayNight = $game->snapshot()['specialEntities'][0] ?? null;
        self::assertIsArray($dayNight);
        self::assertSame('day_night', $dayNight['template']);
        self::assertSame('global', $dayNight['scope']);
        self::assertNull($dayNight['ownerPlayerId']);
        self::assertSame($actor->id(), $dayNight['state']['createdByPlayerId']);
        self::assertSame('day', $dayNight['state']['mode']);
        self::assertSame(['x' => 1, 'y' => 0, 'unit' => 'ratio'], $dayNight['state']['positions'][$actor->id()]);
        self::assertSame(['x' => 1, 'y' => 0, 'unit' => 'ratio'], $dayNight['state']['positions'][$opponent->id()]);

        $handler->apply($game, 'helper.updated', [
            'entityId' => $dayNight['id'],
            'state' => [
                'mode' => 'night',
                'positions' => [
                    $opponent->id() => ['x' => 0.33, 'y' => 0.44, 'unit' => 'ratio'],
                ],
            ],
        ], $opponent);

        $updated = $game->snapshot()['specialEntities'][0];
        self::assertSame('night', $updated['state']['mode']);
        self::assertSame($actor->id(), $updated['state']['createdByPlayerId']);
        self::assertSame(['x' => 1, 'y' => 0, 'unit' => 'ratio'], $updated['state']['positions'][$actor->id()]);
        self::assertSame(['x' => 1, 'y' => 0, 'unit' => 'ratio'], $updated['state']['positions'][$opponent->id()]);
    }

    public function testOnlyDayNightCreatorCanRemoveIt(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $snapshot = $this->snapshot($actor->id());
        $snapshot['players'][$opponent->id()] = $this->player($opponent->id(), []);
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.created', [
            'template' => 'day_night',
            'state' => ['mode' => 'day'],
        ], $actor);
        $entityId = $game->snapshot()['specialEntities'][0]['id'];

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Only the player who created day/night can remove it.');
        $handler->apply($game, 'helper.removed', ['entityId' => $entityId], $opponent);
    }

    public function testUpdatingLegacyDayNightBackfillsCreatorAndPositions(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $snapshot = $this->snapshot($actor->id(), [
            'specialEntities' => [[
                'id' => 'day-night-legacy',
                'template' => 'day_night',
                'scope' => 'global',
                'ownerPlayerId' => null,
                'card' => null,
                'state' => ['mode' => 'day'],
                'createdAt' => '2026-01-01T00:00:00+00:00',
            ]],
        ]);
        $snapshot['players'][$opponent->id()] = $this->player($opponent->id(), []);
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.updated', [
            'entityId' => 'day-night-legacy',
            'state' => ['mode' => 'day'],
        ], $opponent);

        $state = $game->snapshot()['specialEntities'][0]['state'];
        self::assertSame($actor->id(), $state['createdByPlayerId']);
        self::assertSame(['x' => 1, 'y' => 0, 'unit' => 'ratio'], $state['positions'][$actor->id()]);
        self::assertSame(['x' => 1, 'y' => 0, 'unit' => 'ratio'], $state['positions'][$opponent->id()]);
    }

    public function testUpdatingDayNightCanAttachItsDatabaseCard(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'specialEntities' => [[
                'id' => 'day-night-legacy',
                'template' => 'day_night',
                'scope' => 'global',
                'ownerPlayerId' => null,
                'card' => null,
                'state' => ['mode' => 'day'],
                'createdAt' => '2026-01-01T00:00:00+00:00',
            ]],
        ]));
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.updated', [
            'entityId' => 'day-night-legacy',
            'card' => [
                'scryfallId' => '9c0f7843-4cbb-4d0f-8887-ec823a9238da',
                'name' => 'Day // Night',
                'layout' => 'double_faced_token',
                'typeLine' => 'Card // Card',
                'imageUris' => ['normal' => 'https://img.example.test/day-night.jpg'],
                'cardFaces' => [
                    ['name' => 'Day', 'imageUris' => ['normal' => 'https://img.example.test/day.jpg']],
                    ['name' => 'Night', 'imageUris' => ['normal' => 'https://img.example.test/night.jpg']],
                ],
            ],
            'state' => ['mode' => 'night'],
        ], $actor);

        $dayNight = $game->snapshot()['specialEntities'][0];
        self::assertSame('Day // Night', $dayNight['card']['name']);
        self::assertSame('double_faced_token', $dayNight['card']['layout']);
        self::assertSame('night', $dayNight['state']['mode']);
    }

    public function testDayNightCreatesUpdatesAndRemovesBattlefieldCardsForEveryPlayer(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $snapshot = $this->snapshot($actor->id());
        $snapshot['players'][$opponent->id()] = $this->player($opponent->id(), []);
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'helper.created', [
            'template' => 'day_night',
            'card' => $this->dayNightCardRef(),
            'state' => ['mode' => 'day'],
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertSame('Day // Night', $snapshot['players'][$actor->id()]['zones']['battlefield'][0]['name']);
        self::assertSame('Day // Night', $snapshot['players'][$opponent->id()]['zones']['battlefield'][0]['name']);
        self::assertSame(['x' => 1, 'y' => 0, 'unit' => 'ratio'], $snapshot['players'][$actor->id()]['zones']['battlefield'][0]['position']);
        self::assertSame(['x' => 1, 'y' => 0, 'unit' => 'ratio'], $snapshot['players'][$opponent->id()]['zones']['battlefield'][0]['position']);
        self::assertSame(0, $snapshot['players'][$actor->id()]['zones']['battlefield'][0]['activeFaceIndex']);
        self::assertSame($actor->id(), $snapshot['players'][$opponent->id()]['zones']['battlefield'][0]['ownerId']);
        self::assertSame($opponent->id(), $snapshot['players'][$opponent->id()]['zones']['battlefield'][0]['controllerId']);

        $handler->apply($game, 'helper.updated', [
            'entityId' => $snapshot['specialEntities'][0]['id'],
            'state' => ['mode' => 'night'],
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertSame(1, $snapshot['players'][$actor->id()]['zones']['battlefield'][0]['activeFaceIndex']);
        self::assertSame(1, $snapshot['players'][$opponent->id()]['zones']['battlefield'][0]['activeFaceIndex']);

        $handler->apply($game, 'helper.removed', [
            'entityId' => $snapshot['specialEntities'][0]['id'],
        ], $actor);

        self::assertSame([], $game->snapshot()['players'][$actor->id()]['zones']['battlefield']);
        self::assertSame([], $game->snapshot()['players'][$opponent->id()]['zones']['battlefield']);
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

    /**
     * @return array<string,mixed>
     */
    private function dayNightCardRef(): array
    {
        return [
            'scryfallId' => '9c0f7843-4cbb-4d0f-8887-ec823a9238da',
            'name' => 'Day // Night',
            'layout' => 'double_faced_token',
            'typeLine' => 'Card // Card',
            'imageUris' => ['normal' => 'https://img.example.test/day-night.jpg'],
            'cardFaces' => [
                ['name' => 'Day', 'imageUris' => ['normal' => 'https://img.example.test/day.jpg']],
                ['name' => 'Night', 'imageUris' => ['normal' => 'https://img.example.test/night.jpg']],
            ],
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function specialCardRef(string $name): array
    {
        return [
            'scryfallId' => strtolower(str_replace([' ', '\'', '/'], '-', $name)),
            'name' => $name,
            'layout' => 'token',
            'typeLine' => 'Card',
            'imageUris' => ['normal' => sprintf('https://img.example.test/%s.jpg', strtolower(str_replace(' ', '-', $name)))],
            'cardFaces' => [],
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function initiativeCardRef(): array
    {
        return [
            'scryfallId' => 'initiative-card',
            'name' => 'Undercity // The Initiative',
            'layout' => 'double_faced_token',
            'typeLine' => 'Dungeon - Undercity // Card',
            'imageUris' => ['normal' => 'https://img.example.test/undercity.jpg'],
            'cardFaces' => [
                [
                    'name' => 'Undercity',
                    'typeLine' => 'Dungeon - Undercity',
                    'oracleText' => 'Venture into Undercity only.',
                    'imageUris' => ['normal' => 'https://img.example.test/undercity.jpg'],
                ],
                [
                    'name' => 'The Initiative',
                    'typeLine' => 'Card',
                    'oracleText' => 'You have the initiative.',
                    'imageUris' => ['normal' => 'https://img.example.test/the-initiative.jpg'],
                ],
            ],
        ];
    }
}
