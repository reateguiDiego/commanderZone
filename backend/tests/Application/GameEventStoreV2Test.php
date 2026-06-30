<?php

namespace App\Tests\Application;

use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameRandomizer;
use App\Application\Game\GameEventReplayService;
use App\Application\Game\GameEventStoreV2;
use App\Application\Game\GameMulliganEventTypes;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Game\GameSnapshotCompact;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use PHPUnit\Framework\TestCase;

class GameEventStoreV2Test extends TestCase
{
    public function testMulliganCompactEventTypesAreDeclared(): void
    {
        self::assertSame([
            'mulligan.started',
            'mulligan.player_took_mulligan',
            'mulligan.hand_drawn',
            'mulligan.player_kept',
            'mulligan.cards_bottomed',
            'mulligan.scry_available',
            'mulligan.scry_confirmed',
            'mulligan.player_ready',
            'mulligan.completed',
            'game.phase_changed',
        ], GameMulliganEventTypes::all());
    }

    public function testReplayRebuildsExactRuntimeStateFromPersistedLegacySnapshotAndEvents(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $flags = new GameplayV2Flags(true, false, false, true);
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'library' => [
                $this->card('library-2', 'Second Draw', 'library'),
                $this->card('library-1', 'Top Draw', 'library'),
            ],
            'battlefield' => [
                $this->card('battlefield-1', 'Bear', 'battlefield'),
            ],
        ]));
        $runtimeGame = new Game(new Room($actor), $baseSnapshot);

        $drawEvent = $handler->apply($runtimeGame, 'library.draw', ['playerId' => $actor->id()], $actor, 'draw-action');
        $tapEvent = $handler->apply($runtimeGame, 'card.tapped', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
            'tapped' => true,
        ], $actor, 'tap-action');
        $expectedSnapshot = $runtimeGame->snapshot();

        $rebuiltGame = new Game(new Room($actor), $baseSnapshot);
        $store = $this->eventStore($handler, $flags);
        $rebuiltSnapshot = $store->rebuildSnapshot($rebuiltGame, null, [$drawEvent, $tapEvent]);

        self::assertSame($this->comparableSnapshot($expectedSnapshot), $this->comparableSnapshot($rebuiltSnapshot));
        self::assertSame(3, $rebuiltSnapshot['version']);
    }

    public function testReplayCanRecoverFromCompactSnapshotPlusLaterEvents(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $flags = new GameplayV2Flags(true, false, false, true);
        $handler = new GameCommandHandler(flagsV2: $flags);
        $mapper = new CompactGameCardStateMapper();
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'library' => [
                $this->card('library-2', 'Second Draw', 'library'),
                $this->card('library-1', 'Top Draw', 'library'),
            ],
            'battlefield' => [
                $this->card('battlefield-1', 'Bear', 'battlefield'),
            ],
        ]));
        $runtimeGame = new Game(new Room($actor), $baseSnapshot);

        $drawEvent = $handler->apply($runtimeGame, 'library.draw', ['playerId' => $actor->id()], $actor, 'draw-action');
        $snapshotV2 = $runtimeGame->snapshot();
        $store = $this->eventStore($handler, $flags);
        $compactSnapshot = $mapper->compactSnapshot($snapshotV2, $runtimeGame->id(), $runtimeGame->status());
        $compactRecord = new GameSnapshotCompact($runtimeGame, 2, $compactSnapshot, $store->checksum($compactSnapshot));

        $tapEvent = $handler->apply($runtimeGame, 'card.tapped', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
            'tapped' => true,
        ], $actor, 'tap-action');
        $expectedSnapshot = $handler->normalizeSnapshot($mapper->hydrateSnapshot($mapper->compactSnapshot($runtimeGame->snapshot())));

        $recoveredGame = new Game(new Room($actor), $baseSnapshot);
        $recoveredSnapshot = $store->rebuildSnapshot($recoveredGame, $compactRecord, [$drawEvent, $tapEvent]);

        self::assertSame($this->comparableSnapshot($expectedSnapshot), $this->comparableSnapshot($recoveredSnapshot));
        self::assertSame(3, $recoveredSnapshot['version']);
    }

    public function testReplayAppliesRuntimeLifecycleEvents(): void
    {
        $actor = new User('owner-lifecycle@example.test', 'Lifecycle Owner');
        $handler = new GameCommandHandler(flagsV2: new GameplayV2Flags(true, false, false, true));
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), []));
        $game = new Game(new Room($actor), $baseSnapshot);

        $concede = new GameEvent($game, 'game.concede', [
            'playerId' => $actor->id(),
            'status' => 'conceded',
            'concededAt' => '2026-01-01T00:00:05+00:00',
            'turn' => ['activePlayerId' => 'next-player', 'phase' => 'untap', 'number' => 2],
        ], $actor, 'runtime-concede', 2);
        $close = new GameEvent($game, 'game.close', [
            'status' => 'finished',
            'phase' => 'FINISHED',
        ], $actor, 'runtime-close', 3);

        $rebuilt = (new GameEventReplayService())->replay($baseSnapshot, [$concede, $close]);

        self::assertSame('conceded', $rebuilt['players'][$actor->id()]['status']);
        self::assertSame('2026-01-01T00:00:05+00:00', $rebuilt['players'][$actor->id()]['concededAt']);
        self::assertSame('next-player', $rebuilt['turn']['activePlayerId']);
        self::assertSame('FINISHED', $rebuilt['gamePhase']);
        self::assertSame(3, $rebuilt['version']);
    }

    public function testPersistCompactSnapshotStoresStateWithoutStaticCardPayload(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $flags = new GameplayV2Flags(true, false, false, true);
        $handler = new GameCommandHandler(flagsV2: $flags);
        $runtimeSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'battlefield' => [[
                ...$this->card('battlefield-1', 'Bear', 'battlefield'),
                'oracleText' => 'Draw a card.',
                'imageUris' => ['normal' => 'https://example.test/bear.jpg'],
                'cardFaces' => [['name' => 'Face A']],
            ]],
        ]));
        $runtimeSnapshot['version'] = 5;
        $game = new Game(new Room($actor), $runtimeSnapshot);
        $snapshotRepository = $this->createMock(EntityRepository::class);
        $snapshotRepository->expects(self::once())->method('findOneBy')->with(['game' => $game], ['version' => 'DESC'])->willReturn(null);
        $entityManager = $this->createMock(EntityManagerInterface::class);
        $entityManager->method('getRepository')->with(GameSnapshotCompact::class)->willReturn($snapshotRepository);
        $entityManager->expects(self::once())
            ->method('persist')
            ->with(self::callback(function (mixed $record): bool {
                if (!$record instanceof GameSnapshotCompact) {
                    return false;
                }

                $encoded = json_encode($record->snapshot(), JSON_THROW_ON_ERROR);

                self::assertStringNotContainsString('oracleText', $encoded);
                self::assertStringNotContainsString('imageUris', $encoded);
                self::assertStringNotContainsString('cardFaces', $encoded);

                return true;
            }));
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::once())->method('getManagerForClass')->with(Game::class)->willReturn($entityManager);
        $store = new GameEventStoreV2(
            $registry,
            $handler,
            new CompactGameCardStateMapper(),
            new GameEventReplayService(),
            $flags,
            null,
            1,
            1,
        );

        $record = $store->persistCompactSnapshotIfDue($entityManager, $game, $runtimeSnapshot);

        self::assertInstanceOf(GameSnapshotCompact::class, $record);
        self::assertSame(5, $record->version());
    }

    public function testInitializeStartedGamePersistsStartedEventAndInitialCompactSnapshot(): void
    {
        $actor = new User('start-owner@example.test', 'Start Owner');
        $flags = new GameplayV2Flags(false, false, false, true);
        $handler = new GameCommandHandler(flagsV2: $flags);
        $runtimeSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'library' => [$this->card('library-1', 'Top Draw', 'library')],
        ]));
        $game = new Game(new Room($actor), $runtimeSnapshot);

        $snapshotRepository = $this->createMock(EntityRepository::class);
        $snapshotRepository->expects(self::once())->method('findOneBy')->with(['game' => $game], ['version' => 'DESC'])->willReturn(null);
        $persisted = [];
        $entityManager = $this->createMock(EntityManagerInterface::class);
        $entityManager->method('getRepository')->with(GameSnapshotCompact::class)->willReturn($snapshotRepository);
        $entityManager->expects(self::exactly(2))
            ->method('persist')
            ->willReturnCallback(static function (mixed $entity) use (&$persisted): void {
                $persisted[] = $entity;
            });
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::once())->method('getManagerForClass')->with(Game::class)->willReturn($entityManager);
        $store = new GameEventStoreV2(
            $registry,
            $handler,
            new CompactGameCardStateMapper(),
            new GameEventReplayService(),
            $flags,
            null,
            1,
            1,
        );

        $event = $store->initializeStartedGame($entityManager, $game, $actor);

        self::assertInstanceOf(GameEvent::class, $event);
        self::assertSame('game.started', $event->type());
        self::assertSame(1, $event->version());
        self::assertSame('game-started-'.$game->id(), $event->clientActionId());
        self::assertArrayNotHasKey('snapshot', $event->payload());
        self::assertArrayNotHasKey('players', $event->payload());
        self::assertArrayNotHasKey('zones', $event->payload());
        self::assertContains(GameEvent::class, array_map(static fn (object $entity): string => $entity::class, $persisted));
        self::assertContains(GameSnapshotCompact::class, array_map(static fn (object $entity): string => $entity::class, $persisted));
    }

    public function testMulliganReplayRebuildsLondonTakeKeepAndBottomFromCompactEvents(): void
    {
        $actor = new User('mulligan-owner@example.test', 'Mulligan Owner');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'mulligan.take,mulligan.keep');
        $handler = new GameCommandHandler(
            randomizer: new class() extends GameRandomizer {
                public function shuffle(array $items): array
                {
                    return array_reverse($items);
                }
            },
            flagsV2: $flags,
        );
        $baseSnapshot = $handler->normalizeSnapshot($this->mulliganSnapshot($actor, [
            'hand' => $this->cards('hand', 7, 'hand'),
            'library' => $this->cards('library', 10, 'library'),
        ], Room::MULLIGAN_LONDON, false, 0));
        $runtimeGame = new Game(new Room($actor), $baseSnapshot);

        $take = $handler->apply($runtimeGame, 'mulligan.take', [], $actor, 'mulligan-take-1');
        $handIds = $this->zoneIds($handler->normalizeSnapshot((new CompactGameCardStateMapper())->hydrateSnapshot($runtimeGame->snapshot())), $actor->id(), 'hand');
        $keep = $handler->apply($runtimeGame, 'mulligan.keep', [
            'bottomCardInstanceIds' => [$handIds[0]],
        ], $actor, 'mulligan-keep-1');
        $expected = $handler->normalizeSnapshot((new CompactGameCardStateMapper())->hydrateSnapshot($runtimeGame->snapshot()));

        $rebuilt = $this->eventStore($handler, $flags)->rebuildSnapshot(new Game(new Room($actor), $baseSnapshot), null, [$take, $keep]);

        self::assertSame($this->comparableSnapshot($expected), $this->comparableSnapshot($rebuilt));
        self::assertSame('PLAYING', $rebuilt['gamePhase']);
        self::assertSame(count($this->allZoneIds($rebuilt)), count(array_unique($this->allZoneIds($rebuilt))));
    }

    public function testMulliganReplayRebuildsVancouverScryToBottom(): void
    {
        $actor = new User('vancouver-owner@example.test', 'Vancouver Owner');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'mulligan.keep,mulligan.scry_confirm');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->mulliganSnapshot($actor, [
            'hand' => $this->cards('hand', 6, 'hand'),
            'library' => $this->cards('library', 2, 'library'),
        ], Room::MULLIGAN_VANCOUVER, false, 1));
        $runtimeGame = new Game(new Room($actor), $baseSnapshot);

        $keep = $handler->apply($runtimeGame, 'mulligan.keep', [], $actor, 'vancouver-keep-1');
        $scry = $handler->apply($runtimeGame, 'mulligan.scry_confirm', ['destination' => 'BOTTOM'], $actor, 'vancouver-scry-1');
        $expected = $handler->normalizeSnapshot((new CompactGameCardStateMapper())->hydrateSnapshot($runtimeGame->snapshot()));
        $store = $this->eventStore($handler, $flags);

        $rebuilt = $store->rebuildSnapshot(new Game(new Room($actor), $baseSnapshot), null, [$keep, $scry]);
        $metrics = $store->consumeLastReplayMetrics();

        self::assertSame($this->comparableSnapshot($expected), $this->comparableSnapshot($rebuilt));
        self::assertSame(['library-2', 'library-1'], $this->libraryProjectionIds($rebuilt, $actor->id()));
        self::assertSame(2, $metrics['mulligan.replay_event_count'] ?? null);
        self::assertArrayHasKey('mulligan.replay_ms', $metrics);
    }

    public function testReplayRebuildsRuntimeGoMulliganEventsForReconnect(): void
    {
        $actor = new User('runtime-go-mulligan@example.test', 'Runtime Go Mulligan');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'mulligan.take,mulligan.keep');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->mulliganSnapshot($actor, [
            'hand' => $this->cards('hand', 7, 'hand'),
            'library' => $this->cards('library', 10, 'library'),
        ], Room::MULLIGAN_LONDON, false, 0));
        $game = new Game(new Room($actor), $baseSnapshot);

        $take = new GameEvent($game, 'mulligan.player_took', [
            'playerId' => $actor->id(),
            'phase' => 'MULLIGAN',
            'mulligan' => [
                'rule' => Room::MULLIGAN_LONDON,
                'firstMulliganFree' => false,
                'playerStatus' => [
                    $actor->id() => [
                        'status' => 'DECIDING',
                        'mulliganCount' => 1,
                        'effectiveMulligans' => 1,
                        'currentHandSize' => 7,
                        'cardsToBottom' => 1,
                        'bottomPending' => true,
                        'scryPending' => false,
                        'bottomOrderMode' => 'PLAYER_CHOSEN_ORDER',
                        'scryMode' => 'NONE',
                        'scryCardInstanceId' => '',
                    ],
                ],
                'readyPlayers' => [],
                'completed' => false,
            ],
            'handIds' => ['library-1', 'library-2', 'library-3', 'library-4', 'library-5', 'library-6', 'library-7'],
            'libraryOrder' => ['library-8', 'library-9', 'library-10', 'hand-1', 'hand-2', 'hand-3', 'hand-4', 'hand-5', 'hand-6', 'hand-7'],
        ], $actor, 'runtime-take', 2);
        $keep = new GameEvent($game, 'mulligan.player_kept', [
            'playerId' => $actor->id(),
            'phase' => 'PLAYING',
            'mulligan' => [
                'rule' => Room::MULLIGAN_LONDON,
                'firstMulliganFree' => false,
                'playerStatus' => [
                    $actor->id() => [
                        'status' => 'READY',
                        'mulliganCount' => 1,
                        'effectiveMulligans' => 1,
                        'currentHandSize' => 6,
                        'cardsToBottom' => 0,
                        'bottomPending' => false,
                        'scryPending' => false,
                        'bottomOrderMode' => 'NONE',
                        'scryMode' => 'NONE',
                        'scryCardInstanceId' => '',
                    ],
                ],
                'readyPlayers' => [$actor->id() => true],
                'completed' => true,
            ],
            'handIds' => ['library-2', 'library-3', 'library-4', 'library-5', 'library-6', 'library-7'],
            'libraryOrder' => ['library-8', 'library-9', 'library-10', 'hand-1', 'hand-2', 'hand-3', 'hand-4', 'hand-5', 'hand-6', 'hand-7', 'library-1'],
        ], $actor, 'runtime-keep', 3);

        $rebuilt = $this->eventStore($handler, $flags)->rebuildSnapshot(new Game(new Room($actor), $baseSnapshot), null, [$take, $keep]);

        self::assertSame(3, $rebuilt['version']);
        self::assertSame('PLAYING', $rebuilt['gamePhase']);
        self::assertSame('READY', $rebuilt['players'][$actor->id()]['mulligan']['status']);
        self::assertSame(1, $rebuilt['players'][$actor->id()]['mulligan']['mulligansTaken']);
        self::assertFalse($rebuilt['players'][$actor->id()]['mulligan']['needsBottomSelection']);
        self::assertSame(['library-2', 'library-3', 'library-4', 'library-5', 'library-6', 'library-7'], $this->zoneIds($rebuilt, $actor->id(), 'hand'));
        self::assertSame(['library-8', 'library-9', 'library-10', 'hand-1', 'hand-2', 'hand-3', 'hand-4', 'hand-5', 'hand-6', 'hand-7', 'library-1'], $this->zoneIds($rebuilt, $actor->id(), 'library'));
        self::assertSame(count($this->allZoneIds($rebuilt)), count(array_unique($this->allZoneIds($rebuilt))));
    }

    public function testReplayRebuildsRuntimeGoDrawAndMoveEventsForReconnect(): void
    {
        $actor = new User('runtime-go-gameplay@example.test', 'Runtime Go Gameplay');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'library.draw,card.moved');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'library' => $this->cards('library', 2, 'library'),
            'hand' => [],
            'battlefield' => [],
        ]));
        $game = new Game(new Room($actor), $baseSnapshot);

        $draw = new GameEvent($game, 'library.draw', [
            'playerId' => $actor->id(),
            'instanceIds' => ['library-1'],
        ], $actor, 'runtime-draw-1', 2);
        $move = new GameEvent($game, 'card.moved', [
            'moves' => [[
                'instanceId' => 'library-1',
                'from' => ['playerId' => $actor->id(), 'zone' => 'hand'],
                'to' => ['playerId' => $actor->id(), 'zone' => 'battlefield', 'index' => 0],
                'position' => ['x' => 0.37, 'y' => 0.61, 'unit' => 'ratio'],
            ]],
        ], $actor, 'runtime-move-1', 3);

        $rebuilt = $this->eventStore($handler, $flags)->rebuildSnapshot(new Game(new Room($actor), $baseSnapshot), null, [$draw, $move]);

        self::assertSame(3, $rebuilt['version']);
        self::assertSame(['library-2'], $this->zoneIds($rebuilt, $actor->id(), 'library'));
        self::assertSame([], $this->zoneIds($rebuilt, $actor->id(), 'hand'));
        self::assertSame(['library-1'], $this->zoneIds($rebuilt, $actor->id(), 'battlefield'));
        $battlefieldCard = $this->cardById($rebuilt, $actor->id(), 'battlefield', 'library-1');
        self::assertSame(['x' => 0.37, 'y' => 0.61, 'unit' => 'ratio'], $battlefieldCard['position'] ?? null);
        self::assertSame('battlefield', $rebuilt['loc']['library-1']['zone'] ?? null);
        self::assertSame($actor->id(), $rebuilt['loc']['library-1']['playerId'] ?? null);
        self::assertSame(count($this->allZoneIds($rebuilt)), count(array_unique($this->allZoneIds($rebuilt))));
    }

    public function testReplayRebuildsRuntimeGoShuffleFromCompactSeed(): void
    {
        $actor = new User('runtime-go-shuffle@example.test', 'Runtime Go Shuffle');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'library.shuffle');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'library' => $this->cards('library', 4, 'library'),
        ]));
        $game = new Game(new Room($actor), $baseSnapshot);
        $shuffle = new GameEvent($game, 'library.shuffle', [
            'playerId' => $actor->id(),
            'shuffleSeed' => 123,
            'shuffleAlgorithm' => 'cz.lcg32.fisher-yates.v1',
            'visibilityEpoch' => 2,
        ], $actor, 'runtime-shuffle-seed', 2);

        $rebuilt = (new GameEventReplayService())->replay($baseSnapshot, [$shuffle]);

        self::assertSame(2, $rebuilt['version']);
        self::assertSame(['library-3', 'library-1', 'library-4', 'library-2'], $this->zoneIds($rebuilt, $actor->id(), 'library'));
        self::assertSame(['library-2', 'library-4', 'library-1', 'library-3'], $this->libraryProjectionIds($rebuilt, $actor->id()));
        self::assertSame(count($this->allZoneIds($rebuilt)), count(array_unique($this->allZoneIds($rebuilt))));
    }

    public function testReplayRejectsUnsupportedRuntimeGoShuffleAlgorithm(): void
    {
        $actor = new User('runtime-go-shuffle-unsupported@example.test', 'Runtime Go Shuffle Unsupported');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'library.shuffle');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'library' => $this->cards('library', 4, 'library'),
        ]));
        $game = new Game(new Room($actor), $baseSnapshot);
        $shuffle = new GameEvent($game, 'library.shuffle', [
            'playerId' => $actor->id(),
            'shuffleSeed' => 123,
            'shuffleAlgorithm' => 'unknown.shuffle.v1',
            'visibilityEpoch' => 2,
        ], $actor, 'runtime-shuffle-unsupported', 2);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Unsupported runtime shuffle algorithm');

        (new GameEventReplayService())->replay($baseSnapshot, [$shuffle]);
    }

    public function testReplayRebuildsRuntimeGoCommanderCastCountersForReconnect(): void
    {
        $actor = new User('runtime-go-commander@example.test', 'Runtime Go Commander');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'card.moved');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $commander = [
            ...$this->card('commander-1', 'Runtime Commander', 'command'),
            'ownerId' => $actor->id(),
            'controllerId' => $actor->id(),
            'isCommander' => true,
        ];
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'command' => [$commander],
            'battlefield' => [],
        ]));
        $game = new Game(new Room($actor), $baseSnapshot);

        $move = new GameEvent($game, 'card.moved', [
            'moves' => [[
                'instanceId' => 'commander-1',
                'from' => ['playerId' => $actor->id(), 'zone' => 'command', 'index' => 0],
                'to' => ['playerId' => $actor->id(), 'zone' => 'battlefield', 'index' => 0],
                'position' => ['x' => 0.16, 'y' => 0.18, 'unit' => 'ratio'],
            ]],
            'commanderCastCounters' => [[
                'scope' => 'commander:commander-1',
                'instanceId' => 'commander-1',
                'playerId' => $actor->id(),
                'counters' => ['casts' => 1],
            ]],
        ], $actor, 'runtime-commander-cast-1', 2);

        $rebuilt = $this->eventStore($handler, $flags)->rebuildSnapshot(new Game(new Room($actor), $baseSnapshot), null, [$move]);

        self::assertSame(2, $rebuilt['version']);
        self::assertSame([], $this->zoneIds($rebuilt, $actor->id(), 'command'));
        self::assertSame(['commander-1'], $this->zoneIds($rebuilt, $actor->id(), 'battlefield'));
        self::assertSame(1, $rebuilt['counters']['commander:commander-1']['casts'] ?? null);
        self::assertSame(count($this->allZoneIds($rebuilt)), count(array_unique($this->allZoneIds($rebuilt))));
    }

    public function testReplayRebuildsRuntimeGoGameplaySemanticEventsForReconnect(): void
    {
        $actor = new User('runtime-go-semantics@example.test', 'Runtime Go Semantics');
        $opponent = new User('runtime-go-semantics-opponent@example.test', 'Runtime Go Semantics Opponent');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'counter.changed,commander.damage.changed,card.counter.changed,card.power_toughness.changed,helper.created');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $rawSnapshot = $this->baseSnapshot($actor->id(), [
            'battlefield' => [$this->card('battlefield-1', 'Runtime Creature', 'battlefield')],
        ]);
        $rawSnapshot['players'][$opponent->id()] = [
            'user' => ['id' => $opponent->id(), 'email' => $opponent->email(), 'displayName' => $opponent->displayName(), 'roles' => []],
            'life' => 40,
            'zones' => [
                'library' => [],
                'hand' => [],
                'battlefield' => [],
                'graveyard' => [],
                'exile' => [],
                'command' => [[
                    ...$this->card('opponent-commander', 'Opponent Commander', 'command'),
                    'ownerId' => $opponent->id(),
                    'controllerId' => $opponent->id(),
                    'isCommander' => true,
                ]],
            ],
            'commanderDamage' => [],
            'counters' => [],
        ];
        $baseSnapshot = $handler->normalizeSnapshot($rawSnapshot);
        $game = new Game(new Room($actor), $baseSnapshot);

        $poison = new GameEvent($game, 'counter.changed', [
            'scope' => 'player:'.$actor->id(),
            'key' => 'poison',
            'value' => 2,
        ], $actor, 'runtime-poison', 2);
        $energy = new GameEvent($game, 'counter.changed', [
            'scope' => 'player:'.$actor->id(),
            'key' => 'energy',
            'value' => 3,
        ], $actor, 'runtime-energy', 3);
        $experience = new GameEvent($game, 'counter.changed', [
            'scope' => 'player:'.$actor->id(),
            'key' => 'experience',
            'value' => 4,
        ], $actor, 'runtime-experience', 4);
        $damage = new GameEvent($game, 'commander.damage.changed', [
            'targetPlayerId' => $actor->id(),
            'commanderInstanceId' => 'opponent-commander',
            'damage' => 7,
        ], $actor, 'runtime-damage', 5);
        $cardCounter = new GameEvent($game, 'card.counter.changed', [
            'instanceId' => 'battlefield-1',
            'counter' => 'charge',
            'value' => 2,
        ], $actor, 'runtime-card-counter', 6);
        $stats = new GameEvent($game, 'card.power_toughness.changed', [
            'instanceId' => 'battlefield-1',
            'power' => 5,
            'toughness' => 6,
        ], $actor, 'runtime-card-stats', 7);
        $helper = new GameEvent($game, 'helper.created', [
            'entityId' => 'helper-runtime-blessing',
            'template' => 'citys_blessing',
            'scope' => 'player',
            'ownerPlayerId' => $actor->id(),
            'state' => ['label' => 'Runtime blessing'],
        ], $actor, 'runtime-helper', 8);

        $rebuilt = $this->eventStore($handler, $flags)->rebuildSnapshot(
            new Game(new Room($actor), $baseSnapshot),
            null,
            [$poison, $energy, $experience, $damage, $cardCounter, $stats, $helper],
        );

        self::assertSame(8, $rebuilt['version']);
        self::assertSame(2, $rebuilt['players'][$actor->id()]['counters']['poison'] ?? null);
        self::assertSame(3, $rebuilt['players'][$actor->id()]['counters']['energy'] ?? null);
        self::assertSame(4, $rebuilt['players'][$actor->id()]['counters']['experience'] ?? null);
        self::assertSame(7, $rebuilt['players'][$actor->id()]['commanderDamage']['opponent-commander'] ?? null);
        $card = $this->cardById($rebuilt, $actor->id(), 'battlefield', 'battlefield-1');
        self::assertSame(2, $card['counters']['charge'] ?? null);
        self::assertSame(5, $card['power'] ?? null);
        self::assertSame(6, $card['toughness'] ?? null);
        self::assertSame('citys_blessing', $rebuilt['specialEntities'][0]['template'] ?? null);
        self::assertSame($actor->id(), $rebuilt['specialEntities'][0]['ownerPlayerId'] ?? null);
    }

    public function testReplayRebuildsRuntimeGoTokenCreateAndCopyForReconnect(): void
    {
        $actor = new User('runtime-go-token@example.test', 'Runtime Go Token');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'card.token.created,card.token_copy.created');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('source-1', 'Source Creature', 'battlefield'),
                    'cardKey' => 'source-card:card',
                    'cardRef' => 'source-card:card',
                ],
            ],
        ]));
        $game = new Game(new Room($actor), $baseSnapshot);
        $create = new GameEvent($game, 'card.token.created', [
            'playerId' => $actor->id(),
            'instanceIds' => ['runtime-token-1'],
            'cardKey' => 'runtime-goblin:token',
            'name' => 'Runtime Goblin',
            'staticCards' => [
                'runtime-goblin:token' => [
                    'cardKey' => 'runtime-goblin:token',
                    'scryfallId' => 'runtime-goblin',
                    'name' => 'Runtime Goblin',
                    'imageUris' => ['normal' => 'https://example.test/runtime-goblin.jpg'],
                    'oracleText' => 'must-not-leak',
                    'cardFaces' => [[
                        'name' => 'Runtime Goblin',
                        'oracleText' => 'must-not-leak',
                        'imageUris' => ['normal' => 'https://example.test/runtime-goblin-face.jpg'],
                    ]],
                    'power' => 1,
                    'toughness' => 1,
                ],
            ],
            'tokens' => [[
                'instanceId' => 'runtime-token-1',
                'ownerId' => $actor->id(),
                'controllerId' => $actor->id(),
                'name' => 'Runtime Goblin',
                'cardKey' => 'runtime-goblin:token',
                'isToken' => true,
                'tokenMeta' => ['isCopy' => false],
                'position' => ['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'],
                'power' => 1,
                'toughness' => 1,
            ]],
        ], $actor, 'runtime-token-create', 2);
        $copy = new GameEvent($game, 'card.token_copy.created', [
            'playerId' => $actor->id(),
            'targetPlayerId' => $actor->id(),
            'instanceId' => 'runtime-copy-1',
            'sourceInstanceId' => 'source-1',
            'copiedFromCardKey' => 'source-card:card',
            'tokens' => [[
                'instanceId' => 'runtime-copy-1',
                'ownerId' => $actor->id(),
                'controllerId' => $actor->id(),
                'name' => 'Token Copy',
                'cardKey' => 'source-card:card',
                'isToken' => true,
                'isTokenCopy' => true,
                'tokenMeta' => ['isCopy' => true, 'copiedFromInstanceId' => 'source-1'],
                'position' => ['x' => 0.528, 'y' => 0.54, 'unit' => 'ratio'],
            ]],
        ], $actor, 'runtime-token-copy', 3);

        $rebuilt = $this->eventStore($handler, $flags)->rebuildSnapshot(new Game(new Room($actor), $baseSnapshot), null, [$create, $copy]);

        self::assertSame(3, $rebuilt['version']);
        self::assertSame(['source-1', 'runtime-token-1', 'runtime-copy-1'], $this->zoneIds($rebuilt, $actor->id(), 'battlefield'));
        $token = $this->cardById($rebuilt, $actor->id(), 'battlefield', 'runtime-token-1');
        self::assertSame('runtime-goblin:token', $token['cardKey'] ?? null);
        self::assertSame('Runtime Goblin', $token['name'] ?? null);
        self::assertTrue($token['isToken'] ?? false);
        self::assertSame('battlefield', $rebuilt['loc']['runtime-token-1']['zone'] ?? null);
        self::assertSame('https://example.test/runtime-goblin.jpg', $rebuilt['cardCatalog']['runtime-goblin:token']['imageUris']['normal'] ?? null);
        $copyCard = $this->cardById($rebuilt, $actor->id(), 'battlefield', 'runtime-copy-1');
        self::assertSame('source-card:card', $copyCard['cardKey'] ?? null);
        self::assertTrue($copyCard['isTokenCopy'] ?? false);
        self::assertSame('source-1', $copyCard['tokenMeta']['copiedFromInstanceId'] ?? null);
        self::assertSame('battlefield', $rebuilt['loc']['runtime-copy-1']['zone'] ?? null);
        $bootstrap = (new GameplayV2ContractFactory())->bootstrap(new Game(new Room($actor), $baseSnapshot), $actor, $rebuilt);
        self::assertSame('https://example.test/runtime-goblin.jpg', $bootstrap->staticCards['runtime-goblin:token']['imageUris']['normal'] ?? null);
        self::assertSame('https://example.test/card.jpg', $bootstrap->staticCards['source-card:card']['imageUris']['normal'] ?? null);
        $encoded = json_encode($rebuilt, JSON_THROW_ON_ERROR);
        self::assertStringNotContainsString('oracleText":"must-not-leak', $encoded);
        self::assertSame(count($this->allZoneIds($rebuilt)), count(array_unique($this->allZoneIds($rebuilt))));
    }

    public function testReplayIgnoresCorruptCompactSnapshotWhenEventsCanRecover(): void
    {
        $actor = new User('corrupt-compact-runtime@example.test', 'Corrupt Compact Runtime');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'mulligan.take');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->mulliganSnapshot($actor, [
            'hand' => $this->cards('hand', 7, 'hand'),
            'library' => $this->cards('library', 10, 'library'),
        ], Room::MULLIGAN_LONDON, false, 0));
        $game = new Game(new Room($actor), $baseSnapshot);
        $badCompact = new GameSnapshotCompact($game, 2, [
            'gameId' => $game->id(),
            'version' => 2,
            'gamePhase' => 'MULLIGAN',
            'players' => [],
        ], 'invalid-checksum');
        $take = new GameEvent($game, 'mulligan.player_took', [
            'playerId' => $actor->id(),
            'phase' => 'MULLIGAN',
            'mulligan' => [
                'rule' => Room::MULLIGAN_LONDON,
                'firstMulliganFree' => false,
                'playerStatus' => [
                    $actor->id() => [
                        'status' => 'DECIDING',
                        'mulliganCount' => 1,
                        'effectiveMulligans' => 1,
                        'currentHandSize' => 7,
                        'cardsToBottom' => 1,
                        'bottomPending' => true,
                        'scryPending' => false,
                        'bottomOrderMode' => 'PLAYER_CHOSEN_ORDER',
                    ],
                ],
                'readyPlayers' => [],
                'completed' => false,
            ],
            'handIds' => ['library-1', 'library-2', 'library-3', 'library-4', 'library-5', 'library-6', 'library-7'],
            'libraryOrder' => ['library-8', 'library-9', 'library-10', 'hand-1', 'hand-2', 'hand-3', 'hand-4', 'hand-5', 'hand-6', 'hand-7'],
        ], $actor, 'runtime-take-corrupt-compact', 2);
        $store = $this->eventStore($handler, $flags);

        $rebuilt = $store->rebuildSnapshot(new Game(new Room($actor), $baseSnapshot), $badCompact, [$take]);
        $metrics = $store->consumeLastReplayMetrics();

        self::assertSame(2, $rebuilt['version']);
        self::assertSame(['library-1', 'library-2', 'library-3', 'library-4', 'library-5', 'library-6', 'library-7'], $this->zoneIds($rebuilt, $actor->id(), 'hand'));
        self::assertSame(1, $metrics['gameplay.compact_snapshot_checksum_mismatch'] ?? null);
    }

    public function testMulliganEventPayloadsAreCompactAndPublicPayloadIsSanitized(): void
    {
        $actor = new User('payload-owner@example.test', 'Payload Owner');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'mulligan.keep');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->mulliganSnapshot($actor, [
            'hand' => [[
                ...$this->card('hand-1', 'Private Spell', 'hand'),
                'oracleText' => 'Private text',
                'imageUris' => ['normal' => 'https://example.test/private.jpg'],
                'cardFaces' => [['name' => 'Private Face']],
            ]],
            'library' => $this->cards('library', 1, 'library'),
        ], Room::MULLIGAN_LONDON, false, 1));
        $runtimeGame = new Game(new Room($actor), $baseSnapshot);

        $event = $handler->apply($runtimeGame, 'mulligan.keep', [
            'bottomCardInstanceIds' => ['hand-1'],
        ], $actor, 'payload-keep-1');
        $payloadJson = json_encode($event->payload(), JSON_THROW_ON_ERROR);
        $publicJson = json_encode($event->toArray()['payload'], JSON_THROW_ON_ERROR);
        $metrics = $handler->consumeLastCommandMetrics();

        self::assertStringContainsString('mulligan.cards_bottomed', $payloadJson);
        self::assertStringContainsString('hand-1', $payloadJson);
        self::assertStringNotContainsString('oracleText', $payloadJson);
        self::assertStringNotContainsString('imageUris', $payloadJson);
        self::assertStringNotContainsString('cardFaces', $payloadJson);
        self::assertStringNotContainsString('hand-1', $publicJson);
        self::assertStringNotContainsString('Private Spell', $publicJson);
        self::assertArrayHasKey('mulligan.event_payload_bytes', $metrics);
        self::assertArrayHasKey('mulligan.public_event_payload_bytes', $metrics);
        self::assertArrayHasKey('mulligan.snapshot_compact_bytes', $metrics);
    }

    public function testMulliganCompactSnapshotDoesNotContainStaticPayloadInRuntimeInstances(): void
    {
        $actor = new User('compact-mulligan@example.test', 'Compact Mulligan');
        $handler = new GameCommandHandler();
        $snapshot = $handler->normalizeSnapshot($this->mulliganSnapshot($actor, [
            'hand' => [[
                ...$this->card('hand-1', 'Static Heavy', 'hand'),
                'oracleText' => 'Rules text',
                'imageUris' => ['normal' => 'https://example.test/static-heavy.jpg'],
                'cardFaces' => [['name' => 'Face']],
            ]],
        ]));
        $compact = (new CompactGameCardStateMapper())->compactSnapshot($snapshot, 'game-mulligan-compact', Game::STATUS_ACTIVE);
        unset($compact['cardCatalog']);
        $encoded = json_encode($compact, JSON_THROW_ON_ERROR);

        self::assertSame('MULLIGAN', $compact['gamePhase']);
        self::assertArrayHasKey('mulligan', $compact);
        self::assertStringNotContainsString('oracleText', $encoded);
        self::assertStringNotContainsString('imageUris', $encoded);
        self::assertStringNotContainsString('cardFaces', $encoded);
    }

    private function eventStore(
        GameCommandHandler $handler,
        GameplayV2Flags $flags,
        int $snapshotEveryEvents = 25,
        int $snapshotEverySeconds = 30,
    ): GameEventStoreV2 {
        $registry = $this->createMock(ManagerRegistry::class);

        return new GameEventStoreV2(
            $registry,
            $handler,
            new CompactGameCardStateMapper(),
            new GameEventReplayService(),
            $flags,
            null,
            $snapshotEveryEvents,
            $snapshotEverySeconds,
        );
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    private function comparableSnapshot(array $snapshot): array
    {
        unset($snapshot['updatedAt'], $snapshot['cardCatalog']);
        $snapshot['eventLog'] = array_values(array_map(static function (array $entry): array {
            unset($entry['id'], $entry['createdAt']);

            return $entry;
        }, is_array($snapshot['eventLog'] ?? null) ? $snapshot['eventLog'] : []));

        return $this->canonicalize($snapshot);
    }

    private function canonicalize(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }

        if (array_is_list($value)) {
            return array_values(array_map([$this, 'canonicalize'], $value));
        }

        foreach ($value as $key => $item) {
            if ($item === null) {
                unset($value[$key]);
                continue;
            }
            if ($key === 'oracleText' && $item === '') {
                unset($value[$key]);
                continue;
            }
            if ($key === 'timer' && $item === []) {
                unset($value[$key]);
                continue;
            }
            if ($key === 'visibility'
                && $item === ['strategy' => 'legacy_revealed_to', 'ready' => false, 'byViewer' => []]) {
                unset($value[$key]);
                continue;
            }

            $value[$key] = $this->canonicalize($item);
        }

        ksort($value);

        return $value;
    }

    /**
     * @param array<string,list<array<string,mixed>>> $zones
     *
     * @return array<string,mixed>
     */
    private function baseSnapshot(string $actorId, array $zones): array
    {
        return [
            'version' => 1,
            'ownerId' => $actorId,
            'players' => [
                $actorId => [
                    'user' => ['id' => $actorId, 'email' => $actorId, 'displayName' => $actorId, 'roles' => []],
                    'life' => 40,
                    'zones' => [
                        'library' => $zones['library'] ?? [],
                        'hand' => $zones['hand'] ?? [],
                        'battlefield' => $zones['battlefield'] ?? [],
                        'graveyard' => $zones['graveyard'] ?? [],
                        'exile' => $zones['exile'] ?? [],
                        'command' => $zones['command'] ?? [],
                    ],
                    'commanderDamage' => [],
                    'counters' => [],
                ],
            ],
            'turn' => ['activePlayerId' => $actorId, 'phase' => 'main', 'number' => 1],
            'stack' => [],
            'arrows' => [],
            'attachments' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
            'updatedAt' => '2026-01-01T00:00:00+00:00',
        ];
    }

    /**
     * @param array<string,list<array<string,mixed>>> $zones
     *
     * @return array<string,mixed>
     */
    private function mulliganSnapshot(User $actor, array $zones, string $rule = Room::MULLIGAN_LONDON, bool $firstMulliganFree = true, int $mulligansTaken = 0): array
    {
        $state = (new GameCommandHandler())->normalizeSnapshot($this->baseSnapshot($actor->id(), $zones));
        foreach (['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'] as $zone) {
            if (!is_array($state['players'][$actor->id()]['zones'][$zone] ?? null)) {
                continue;
            }
            foreach ($state['players'][$actor->id()]['zones'][$zone] as &$card) {
                if (!is_array($card)) {
                    continue;
                }
                $card['ownerId'] = $actor->id();
                $card['controllerId'] = $actor->id();
            }
            unset($card);
        }
        $state['gamePhase'] = 'MULLIGAN';
        $state['mulligan'] = ['rule' => $rule, 'firstMulliganFree' => $firstMulliganFree];
        $state['players'][$actor->id()]['mulligan'] = [
            'rule' => $rule,
            'firstMulliganFree' => $firstMulliganFree,
            'mulligansTaken' => $mulligansTaken,
            'effectiveMulligans' => $firstMulliganFree ? max(0, $mulligansTaken - 1) : $mulligansTaken,
            'drawCount' => $rule === Room::MULLIGAN_PARIS ? max(0, 7 - $mulligansTaken) : 7,
            'bottomSelectionCount' => $rule === Room::MULLIGAN_LONDON ? ($firstMulliganFree ? max(0, $mulligansTaken - 1) : $mulligansTaken) : 0,
            'finalHandSize' => $rule === Room::MULLIGAN_LONDON ? 7 : max(0, 7 - ($firstMulliganFree ? max(0, $mulligansTaken - 1) : $mulligansTaken)),
            'needsBottomSelection' => $rule === Room::MULLIGAN_LONDON && ($firstMulliganFree ? max(0, $mulligansTaken - 1) : $mulligansTaken) > 0,
            'bottomOrderMode' => $rule === Room::MULLIGAN_LONDON ? 'CLIENT' : 'NONE',
            'needsScryAfterKeep' => $rule === Room::MULLIGAN_VANCOUVER && $mulligansTaken > 0,
            'canTakeAnotherMulligan' => true,
            'status' => 'DECIDING',
            'ready' => false,
            'scryCardInstanceId' => null,
        ];

        return $state;
    }

    /**
     * @return list<string>
     */
    private function zoneIds(array $snapshot, string $playerId, string $zone): array
    {
        return array_values(array_map(
            static fn (array $card): string => (string) ($card['instanceId'] ?? ''),
            is_array($snapshot['players'][$playerId]['zones'][$zone] ?? null) ? $snapshot['players'][$playerId]['zones'][$zone] : [],
        ));
    }

    /**
     * @return list<string>
     */
    private function allZoneIds(array $snapshot): array
    {
        $ids = [];
        foreach (is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [] as $player) {
            if (!is_array($player) || !is_array($player['zones'] ?? null)) {
                continue;
            }
            foreach ($player['zones'] as $cards) {
                foreach (is_array($cards) ? $cards : [] as $card) {
                    if (is_array($card) && is_string($card['instanceId'] ?? null)) {
                        $ids[] = $card['instanceId'];
                    }
                }
            }
        }

        return $ids;
    }

    /**
     * @return list<string>
     */
    private function libraryProjectionIds(array $snapshot, string $playerId): array
    {
        return array_values(array_map(
            static fn (array $card): string => (string) ($card['instanceId'] ?? ''),
            (new \App\Application\Game\GameLibraryOps())->projectionOrderCards($snapshot['players'][$playerId] ?? []),
        ));
    }

    /**
     * @return array<string,mixed>
     */
    private function cardById(array $snapshot, string $playerId, string $zone, string $instanceId): array
    {
        foreach (is_array($snapshot['players'][$playerId]['zones'][$zone] ?? null) ? $snapshot['players'][$playerId]['zones'][$zone] : [] as $card) {
            if (is_array($card) && ($card['instanceId'] ?? null) === $instanceId) {
                return $card;
            }
        }

        self::fail(sprintf('Card %s not found in %s.', $instanceId, $zone));
    }

    /**
     * @return array<string,mixed>
     */
    private function card(string $instanceId, string $name, string $zone): array
    {
        return [
            'instanceId' => $instanceId,
            'ownerId' => 'owner@example.test',
            'controllerId' => 'owner@example.test',
            'name' => $name,
            'zone' => $zone,
            'scryfallId' => sprintf('%s-0000-0000-0000-000000000000', substr(md5($instanceId), 0, 8)),
            'typeLine' => 'Creature',
            'oracleText' => '',
            'imageUris' => ['normal' => 'https://example.test/card.jpg'],
            'cardFaces' => [],
            'isToken' => false,
            'tapped' => false,
            'counters' => [],
            'position' => null,
            'revealedTo' => [],
            'faceDown' => false,
        ];
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function cards(string $prefix, int $count, string $zone): array
    {
        $cards = [];
        for ($index = 1; $index <= $count; ++$index) {
            $cards[] = $this->card(sprintf('%s-%d', $prefix, $index), sprintf('%s %d', $prefix, $index), $zone);
        }

        return $cards;
    }
}
