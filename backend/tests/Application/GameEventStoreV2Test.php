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

    public function testReplayHydratesPersistedStructuredCompactSnapshotWithoutRuntimeFormat(): void
    {
        $actor = new User('compact-format-owner@example.test', 'Compact Format Owner');
        $flags = new GameplayV2Flags(true, false, false, true);
        $handler = new GameCommandHandler(flagsV2: $flags);
        $mapper = new CompactGameCardStateMapper();
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'battlefield' => [$this->card('dfc-compact-1', 'Persisted Double Faced Card', 'battlefield')],
        ]));
        $baseSnapshot['players'][$actor->id()]['zones']['battlefield'][0]['cardFaces'] = [
            ['name' => 'Front', 'typeLine' => 'Creature', 'oracleText' => '', 'imageUris' => ['normal' => 'https://example.test/front.jpg']],
            ['name' => 'Back', 'typeLine' => 'Creature', 'oracleText' => '', 'imageUris' => ['normal' => 'https://example.test/back.jpg']],
        ];
        $baseSnapshot['players'][$actor->id()]['zones']['battlefield'][0]['activeFaceIndex'] = 1;
        $baseSnapshot['players'][$actor->id()]['zones']['battlefield'][0]['tapped'] = true;
        $baseSnapshot['players'][$actor->id()]['zones']['battlefield'][0]['rotation'] = 90;
        $baseSnapshot['version'] = 2;
        $game = new Game(new Room($actor), $baseSnapshot);
        $store = $this->eventStore($handler, $flags);
        $compactSnapshot = $mapper->compactSnapshot($baseSnapshot, $game->id(), $game->status());
        unset($compactSnapshot['runtimeFormat'], $compactSnapshot['cardCatalog']);
        self::assertSame(1, $compactSnapshot['instances']['dfc-compact-1']['activeFace'] ?? null);
        $compactRecord = new GameSnapshotCompact($game, 2, $compactSnapshot, $store->checksum($compactSnapshot));

        $rebuilt = $store->rebuildSnapshot(new Game(new Room($actor), $baseSnapshot), $compactRecord, []);
        $card = $this->cardById($rebuilt, $actor->id(), 'battlefield', 'dfc-compact-1');

        self::assertSame(1, $card['activeFaceIndex'] ?? null);
        self::assertTrue($card['tapped'] ?? false);
        self::assertSame(90, $card['rotation'] ?? null);
        self::assertSame('Back', $card['cardFaces'][1]['name'] ?? null);
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

    public function testReplayAppliesRuntimeDisconnectVoteEvents(): void
    {
        $actor = new User('owner-disconnect@example.test', 'Disconnect Owner');
        $target = new User('target-disconnect@example.test', 'Disconnect Target');
        $handler = new GameCommandHandler(flagsV2: new GameplayV2Flags(true, false, false, true));
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), []));
        $baseSnapshot['players'][$target->id()] = [
            'user' => ['id' => $target->id(), 'email' => $target->email(), 'displayName' => $target->displayName(), 'roles' => []],
            'life' => 40,
            'status' => 'active',
            'zones' => [
                'library' => [],
                'hand' => [],
                'battlefield' => [],
                'graveyard' => [],
                'exile' => [],
                'command' => [],
            ],
            'commanderDamage' => [],
            'counters' => [],
        ];
        $game = new Game(new Room($actor), $baseSnapshot);
        $disconnectVote = [
            'targetPlayerId' => $target->id(),
            'status' => 'resolved_expel',
            'openedAt' => null,
            'deadlineAt' => null,
            'cooldownUntil' => null,
            'votes' => [
                $actor->id() => [
                    'playerId' => $actor->id(),
                    'displayName' => $actor->displayName(),
                    'vote' => 'expel',
                    'votedAt' => '2026-01-01T00:00:10+00:00',
                ],
            ],
        ];
        $event = new GameEvent($game, 'disconnect.vote.updated', [
            'targetPlayerId' => $target->id(),
            'status' => 'resolved_expel',
            'disconnectVote' => $disconnectVote,
            'concededAt' => '2026-01-01T00:00:11+00:00',
        ], $actor, 'runtime-disconnect-vote', 2);

        $rebuilt = (new GameEventReplayService())->replay($baseSnapshot, [$event]);

        self::assertSame($disconnectVote, $rebuilt['disconnectVote']);
        self::assertSame('conceded', $rebuilt['players'][$target->id()]['status']);
        self::assertSame('2026-01-01T00:00:11+00:00', $rebuilt['players'][$target->id()]['concededAt']);
        self::assertSame(2, $rebuilt['version']);
    }

    public function testCompactSnapshotPreservesDisconnectVoteState(): void
    {
        $actor = new User('compact-disconnect@example.test', 'Compact Disconnect');
        $handler = new GameCommandHandler(flagsV2: new GameplayV2Flags(true, false, false, true));
        $snapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), []));
        $snapshot['disconnectVote'] = [
            'targetPlayerId' => $actor->id(),
            'status' => 'open',
            'openedAt' => '2026-01-01T00:00:00+00:00',
            'deadlineAt' => '2026-01-01T00:01:00+00:00',
            'cooldownUntil' => null,
            'votes' => [],
        ];

        $mapper = new CompactGameCardStateMapper();
        $hydrated = $mapper->hydrateSnapshot($mapper->compactSnapshot($snapshot, 'game-compact-disconnect', 'active'));

        self::assertSame($snapshot['disconnectVote'], $hydrated['disconnectVote']);
    }

    public function testReplayAndBootstrapPreserveLongRunningTurnStateAfterConcede(): void
    {
        $actor = new User('runtime-turn-owner@example.test', 'Runtime Turn Owner');
        $second = new User('runtime-turn-second@example.test', 'Runtime Turn Second');
        $third = new User('runtime-turn-third@example.test', 'Runtime Turn Third');
        $handler = new GameCommandHandler(flagsV2: new GameplayV2Flags(true, false, false, true));
        $baseSnapshot = $this->baseSnapshot($actor->id(), []);
        foreach ([$second, $third] as $player) {
            $baseSnapshot['players'][$player->id()] = [
                'user' => ['id' => $player->id(), 'email' => $player->email(), 'displayName' => $player->displayName(), 'roles' => []],
                'life' => $player === $second ? 31 : 27,
                'status' => 'active',
                'zones' => [
                    'library' => [],
                    'hand' => [],
                    'battlefield' => [],
                    'graveyard' => [],
                    'exile' => [],
                    'command' => [],
                ],
                'commanderDamage' => [],
                'counters' => [],
            ];
        }
        $baseSnapshot['gamePhase'] = 'PLAYING';
        $baseSnapshot = $handler->normalizeSnapshot($baseSnapshot);
        $game = new Game(new Room($actor), $baseSnapshot);
        $players = [$actor->id(), $second->id(), $third->id()];
        $phases = ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'];
        $events = [];
        $version = 2;

        for ($index = 0; $index < 24; ++$index) {
            $activePlayerId = $players[$index % count($players)];
            $phase = $phases[$index % count($phases)];
            $events[] = new GameEvent($game, 'turn.changed', [
                'turn' => [
                    'activePlayerId' => $activePlayerId,
                    'phase' => $phase,
                    'number' => 1 + intdiv($index, count($players)),
                ],
            ], $actor, sprintf('runtime-turn-%02d', $index), $version++);
        }

        $events[] = new GameEvent($game, 'game.concede', [
            'playerId' => $second->id(),
            'status' => 'conceded',
            'concededAt' => '2026-01-01T00:05:00+00:00',
            'turn' => ['activePlayerId' => $third->id(), 'phase' => 'untap', 'number' => 9],
        ], $second, 'runtime-concede-second', $version++);
        $events[] = new GameEvent($game, 'turn.changed', [
            'turn' => ['activePlayerId' => $actor->id(), 'phase' => 'main-1', 'number' => 10],
        ], $third, 'runtime-turn-after-concede', $version++);

        $rebuilt = (new GameEventReplayService())->replay($baseSnapshot, $events);
        $bootstrap = (new GameplayV2ContractFactory())->bootstrap(new Game(new Room($actor), $rebuilt), $actor, $rebuilt);

        self::assertSame(['activePlayerId' => $actor->id(), 'phase' => 'main-1', 'number' => 10], $rebuilt['turn']);
        self::assertSame('conceded', $rebuilt['players'][$second->id()]['status']);
        self::assertSame('2026-01-01T00:05:00+00:00', $rebuilt['players'][$second->id()]['concededAt']);
        self::assertSame('PLAYING', $rebuilt['gamePhase']);
        self::assertSame(31, $rebuilt['players'][$second->id()]['life']);
        self::assertSame(27, $rebuilt['players'][$third->id()]['life']);
        self::assertSame($version - 1, $rebuilt['version']);
        self::assertSame($rebuilt['turn'], $bootstrap->turn);
        self::assertSame('conceded', $bootstrap->players[$second->id()]['status']);
        self::assertSame('PLAYING', $bootstrap->game['gamePhase']);
    }

    public function testRebuildSnapshotPreservesRuntimeCloseFinishedPhaseAfterNormalization(): void
    {
        $actor = new User('runtime-close-owner@example.test', 'Runtime Close Owner');
        $flags = new GameplayV2Flags(true, false, false, true);
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), []));
        $baseSnapshot['gamePhase'] = 'PLAYING';
        $game = new Game(new Room($actor), $baseSnapshot);
        $close = new GameEvent($game, 'game.close', [
            'status' => 'finished',
            'phase' => 'FINISHED',
        ], $actor, 'runtime-close', 2);

        $rebuilt = $this->eventStore($handler, $flags)->rebuildSnapshot($game, null, [$close]);
        $bootstrap = (new GameplayV2ContractFactory())->bootstrap(new Game(new Room($actor), $rebuilt), $actor, $rebuilt);

        self::assertSame('FINISHED', $rebuilt['gamePhase']);
        self::assertSame(2, $rebuilt['version']);
        self::assertSame('FINISHED', $bootstrap->game['gamePhase']);
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

    public function testPersistCompactSnapshotUsesManagedGameReferenceForDetachedGame(): void
    {
        $actor = new User('detached-owner@example.test', 'Detached Owner');
        $flags = new GameplayV2Flags(true, false, false, true);
        $handler = new GameCommandHandler(flagsV2: $flags);
        $runtimeSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), []));
        $runtimeSnapshot['version'] = 3;

        $detachedGame = new Game(new Room($actor), $runtimeSnapshot);
        $managedGame = new Game(new Room($actor), $runtimeSnapshot);
        $snapshotRepository = $this->createMock(EntityRepository::class);
        $snapshotRepository->expects(self::once())->method('findOneBy')->with(['game' => $managedGame], ['version' => 'DESC'])->willReturn(null);

        $entityManager = $this->createMock(EntityManagerInterface::class);
        $entityManager->method('getRepository')->with(GameSnapshotCompact::class)->willReturn($snapshotRepository);
        $entityManager->expects(self::once())->method('contains')->with($detachedGame)->willReturn(false);
        $entityManager->expects(self::once())->method('getReference')->with(Game::class, $detachedGame->id())->willReturn($managedGame);
        $entityManager->expects(self::once())
            ->method('persist')
            ->with(self::callback(static function (mixed $record) use ($managedGame): bool {
                return $record instanceof GameSnapshotCompact && $record->game() === $managedGame;
            }));

        $registry = $this->createMock(ManagerRegistry::class);
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

        $record = $store->persistCompactSnapshotIfDue($entityManager, $detachedGame, $runtimeSnapshot);

        self::assertInstanceOf(GameSnapshotCompact::class, $record);
        self::assertSame($managedGame, $record->game());
    }

    public function testHydrateGameDetachesReadOnlyCompactSnapshotAfterReplay(): void
    {
        $actor = new User('hydrate-detach-owner@example.test', 'Hydrate Detach Owner');
        $flags = new GameplayV2Flags(true, false, false, true);
        $handler = new GameCommandHandler(flagsV2: $flags);
        $snapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'library' => [$this->card('library-1', 'Top Draw', 'library')],
        ]));
        $snapshot['version'] = 2;
        $game = new Game(new Room($actor), $snapshot);
        $compactSnapshot = (new CompactGameCardStateMapper())->compactSnapshot($snapshot, $game->id(), $game->status());
        $compactRecord = new GameSnapshotCompact($game, 2, $compactSnapshot, hash('sha256', json_encode($compactSnapshot, JSON_THROW_ON_ERROR)));

        $snapshotRepository = $this->createMock(EntityRepository::class);
        $snapshotRepository->expects(self::once())->method('findOneBy')->with(['game' => $game], ['version' => 'DESC'])->willReturn($compactRecord);
        $eventRepository = $this->createMock(EntityRepository::class);
        $eventRepository->expects(self::once())->method('findBy')->with(['game' => $game], ['version' => 'ASC'])->willReturn([]);

        $entityManager = $this->createMock(EntityManagerInterface::class);
        $entityManager->expects(self::once())->method('contains')->with($game)->willReturn(true);
        $entityManager->method('getRepository')->willReturnMap([
            [GameSnapshotCompact::class, $snapshotRepository],
            [GameEvent::class, $eventRepository],
        ]);
        $entityManager->expects(self::once())->method('detach')->with($compactRecord);

        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::once())->method('getManagerForClass')->with(Game::class)->willReturn($entityManager);
        $store = new GameEventStoreV2(
            $registry,
            $handler,
            new CompactGameCardStateMapper(),
            new GameEventReplayService(),
            $flags,
        );

        $hydrated = $store->hydrateGame($game);

        self::assertSame(2, $hydrated['version']);
        self::assertSame($hydrated, $game->snapshot());
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

    public function testReplayRebuildsCompactRuntimeGoMulliganWithoutLibraryOrder(): void
    {
        $actor = new User('runtime-go-mulligan-compact@example.test', 'Runtime Go Mulligan Compact');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'mulligan.take,mulligan.keep');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->mulliganSnapshot($actor, [
            'hand' => $this->cards('hand', 7, 'hand'),
            'library' => $this->cards('library', 10, 'library'),
        ], Room::MULLIGAN_LONDON, false, 0));
        $game = new Game(new Room($actor), $baseSnapshot);

        $takePayload = [
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
            'drawCount' => 7,
            'shuffleSeed' => 123,
            'shuffleAlgorithm' => 'cz.lcg32.fisher-yates.v1',
        ];
        self::assertArrayNotHasKey('libraryOrder', $takePayload);
        self::assertArrayNotHasKey('handIds', $takePayload);
        $take = new GameEvent($game, 'mulligan.player_took', $takePayload, $actor, 'runtime-compact-take', 2);
        $afterTake = (new GameEventReplayService())->replay($baseSnapshot, [$take]);
        $bottomedId = $this->zoneIds($afterTake, $actor->id(), 'hand')[0] ?? null;
        self::assertIsString($bottomedId);

        $keepPayload = [
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
            'bottomedIds' => [$bottomedId],
        ];
        self::assertArrayNotHasKey('libraryOrder', $keepPayload);
        self::assertArrayNotHasKey('handIds', $keepPayload);
        $keep = new GameEvent($game, 'mulligan.player_kept', $keepPayload, $actor, 'runtime-compact-keep', 3);

        $rebuilt = (new GameEventReplayService())->replay($baseSnapshot, [$take, $keep]);
        $rebuiltAgain = (new GameEventReplayService())->replay($baseSnapshot, [$take, $keep]);

        self::assertSame($this->comparableSnapshot($rebuilt), $this->comparableSnapshot($rebuiltAgain));
        self::assertSame(3, $rebuilt['version']);
        self::assertSame('PLAYING', $rebuilt['gamePhase']);
        self::assertSame('READY', $rebuilt['players'][$actor->id()]['mulligan']['status']);
        self::assertCount(6, $this->zoneIds($rebuilt, $actor->id(), 'hand'));
        self::assertNotContains($bottomedId, $this->zoneIds($rebuilt, $actor->id(), 'hand'));
        self::assertSame($bottomedId, $this->zoneIds($rebuilt, $actor->id(), 'library')[0] ?? null);
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

    public function testReplayAppliesRuntimeGoCardFaceChangeForReconnect(): void
    {
        $actor = new User('runtime-go-face-change@example.test', 'Runtime Go Face Change');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'card.face.changed,card.tapped');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'battlefield' => [$this->card('dfc-1', 'Double Faced Commander', 'battlefield')],
        ]));
        $baseSnapshot['players'][$actor->id()]['zones']['battlefield'][0]['cardFaces'] = [
            ['name' => 'Front', 'typeLine' => 'Creature', 'oracleText' => '', 'imageUris' => ['normal' => 'https://example.test/front.jpg']],
            ['name' => 'Back', 'typeLine' => 'Creature', 'oracleText' => '', 'imageUris' => ['normal' => 'https://example.test/back.jpg']],
        ];
        $baseSnapshot['players'][$actor->id()]['zones']['battlefield'][0]['activeFaceIndex'] = 0;
        $game = new Game(new Room($actor), $baseSnapshot);

        $face = new GameEvent($game, 'card.face.changed', [
            'playerId' => $actor->id(),
            'instanceId' => 'dfc-1',
            'zone' => 'battlefield',
            'activeFaceIndex' => 1,
        ], $actor, 'runtime-face-1', 2);
        $tap = new GameEvent($game, 'card.tapped', [
            'playerId' => $actor->id(),
            'instanceId' => 'dfc-1',
            'zone' => 'battlefield',
            'tapped' => true,
            'rotation' => 90,
        ], $actor, 'runtime-tap-1', 3);

        $rebuilt = $this->eventStore($handler, $flags)->rebuildSnapshot(new Game(new Room($actor), $baseSnapshot), null, [$face, $tap]);
        $card = $this->cardById($rebuilt, $actor->id(), 'battlefield', 'dfc-1');

        self::assertSame(1, $card['activeFaceIndex'] ?? null);
        self::assertTrue($card['tapped'] ?? false);
        self::assertSame(90, $card['rotation'] ?? null);
    }

    public function testReplayPreservesRuntimeGoFaceDownMoveAndResetsBattlefieldExitForReconnect(): void
    {
        $owner = new User('runtime-zone-owner@example.test', 'Runtime Zone Owner');
        $controller = new User('runtime-zone-controller@example.test', 'Runtime Zone Controller');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'card.moved');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $rawSnapshot = $this->baseSnapshot($owner->id(), [
            'hand' => [$this->card('hand-hidden-1', 'Hidden From Hand', 'hand')],
            'battlefield' => [
                $this->card('controlled-permanent-1', 'Controlled Permanent', 'battlefield'),
                $this->card('equipment-1', 'Equipment', 'battlefield'),
            ],
        ]);
        $rawSnapshot['players'][$controller->id()] = [
            'user' => ['id' => $controller->id(), 'email' => $controller->id(), 'displayName' => $controller->displayName(), 'roles' => []],
            'life' => 35,
            'zones' => [
                'library' => [],
                'hand' => [],
                'battlefield' => [],
                'graveyard' => [],
                'exile' => [],
                'command' => [],
            ],
            'commanderDamage' => [],
            'counters' => [],
        ];
        $baseSnapshot = $handler->normalizeSnapshot($rawSnapshot);
        $baseSnapshot['players'][$owner->id()]['life'] = 31;
        $baseSnapshot['arrows'] = [[
            'id' => 'arrow-controlled',
            'fromInstanceId' => 'controlled-permanent-1',
            'toInstanceId' => 'equipment-1',
            'color' => 'yellow',
            'ownerId' => $owner->id(),
        ]];
        $baseSnapshot['attachments'] = [[
            'id' => 'attachment-controlled',
            'equipmentInstanceId' => 'equipment-1',
            'attachedToInstanceId' => 'controlled-permanent-1',
            'ownerId' => $owner->id(),
        ]];
        $baseSnapshot['players'][$owner->id()]['zones']['battlefield'][0] = [
            ...$baseSnapshot['players'][$owner->id()]['zones']['battlefield'][0],
            'ownerId' => $owner->id(),
            'controllerId' => $controller->id(),
            'tapped' => true,
            'rotation' => 90,
            'faceDown' => true,
            'revealedTo' => [$owner->id()],
            'counters' => ['charge' => 2],
            'position' => ['x' => 0.42, 'y' => 0.66, 'unit' => 'ratio'],
            'power' => 8,
            'toughness' => 9,
            'defaultPower' => 2,
            'defaultToughness' => 3,
        ];
        $baseSnapshot['players'][$owner->id()]['zones']['battlefield'][1]['ownerId'] = $owner->id();
        $baseSnapshot['players'][$owner->id()]['zones']['battlefield'][1]['controllerId'] = $owner->id();
        $game = new Game(new Room($owner), $baseSnapshot);

        $moveFaceDown = new GameEvent($game, 'card.moved', [
            'playerId' => $owner->id(),
            'fromZone' => 'hand',
            'toZone' => 'battlefield',
            'instanceId' => 'hand-hidden-1',
            'instanceIds' => ['hand-hidden-1'],
            'faceDown' => true,
            'moves' => [[
                'instanceId' => 'hand-hidden-1',
                'from' => ['playerId' => $owner->id(), 'zone' => 'hand', 'index' => 0],
                'to' => ['playerId' => $owner->id(), 'zone' => 'battlefield', 'index' => 2],
                'position' => ['x' => 0.57, 'y' => 0.63, 'unit' => 'ratio'],
            ]],
        ], $owner, 'runtime-zone-face-down', 2);
        $moveToGraveyard = new GameEvent($game, 'card.moved', [
            'playerId' => $controller->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'targetPlayerId' => $owner->id(),
            'instanceId' => 'controlled-permanent-1',
            'instanceIds' => ['controlled-permanent-1'],
            'moves' => [[
                'instanceId' => 'controlled-permanent-1',
                'from' => ['playerId' => $owner->id(), 'zone' => 'battlefield', 'index' => 0],
                'to' => ['playerId' => $owner->id(), 'zone' => 'graveyard', 'index' => 0],
            ]],
        ], $controller, 'runtime-zone-owner-destination', 3);

        $rebuilt = $this->eventStore($handler, $flags)->rebuildSnapshot(new Game(new Room($owner), $baseSnapshot), null, [$moveFaceDown, $moveToGraveyard]);

        $faceDownCard = $this->cardById($rebuilt, $owner->id(), 'battlefield', 'hand-hidden-1');
        self::assertTrue($faceDownCard['faceDown'] ?? false);
        self::assertSame([$owner->id()], $faceDownCard['revealedTo'] ?? null);
        self::assertSame(['x' => 0.57, 'y' => 0.63, 'unit' => 'ratio'], $faceDownCard['position'] ?? null);

        self::assertSame(['controlled-permanent-1'], $this->zoneIds($rebuilt, $owner->id(), 'graveyard'));
        self::assertSame([], $this->zoneIds($rebuilt, $controller->id(), 'graveyard'));
        $graveyardCard = $this->cardById($rebuilt, $owner->id(), 'graveyard', 'controlled-permanent-1');
        self::assertSame($owner->id(), $graveyardCard['ownerId'] ?? null);
        self::assertSame($owner->id(), $graveyardCard['controllerId'] ?? null);
        self::assertFalse($graveyardCard['tapped'] ?? true);
        self::assertSame(0, $graveyardCard['rotation'] ?? null);
        self::assertFalse($graveyardCard['faceDown'] ?? true);
        self::assertSame([], $graveyardCard['revealedTo'] ?? null);
        self::assertSame([], $graveyardCard['counters'] ?? null);
        self::assertSame(2, $graveyardCard['power'] ?? null);
        self::assertSame(3, $graveyardCard['toughness'] ?? null);
        self::assertNotSame(['x' => 0.42, 'y' => 0.66, 'unit' => 'ratio'], $graveyardCard['position'] ?? null);
        self::assertNotSame(['x' => 0, 'y' => 0], $graveyardCard['position'] ?? null);
        self::assertSame([], $rebuilt['arrows'] ?? null);
        self::assertSame([], $rebuilt['attachments'] ?? null);
        self::assertSame(31, $rebuilt['players'][$owner->id()]['life']);
        self::assertSame(35, $rebuilt['players'][$controller->id()]['life']);
    }

    public function testRuntimeGoReplayPreservesBattlefieldStateAcrossCounterForRefresh(): void
    {
        $actor = new User('runtime-integrity-owner@example.test', 'Runtime Integrity Owner');
        $controller = new User('runtime-integrity-controller@example.test', 'Runtime Integrity Controller');
        $spectator = new User('runtime-integrity-spectator@example.test', 'Runtime Integrity Spectator');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'life.changed,card.position.changed,card.tapped,card.face_down.changed,card.controller.changed,arrow.created,attachment.created,card.counter.changed,card.power_toughness.changed');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $rawSnapshot = $this->baseSnapshot($actor->id(), [
            'battlefield' => [
                $this->card('battlefield-1', 'Integrity Permanent', 'battlefield'),
                $this->card('equipment-1', 'Integrity Equipment', 'battlefield'),
            ],
        ]);
        foreach ([$controller, $spectator] as $player) {
            $rawSnapshot['players'][$player->id()] = [
                'user' => ['id' => $player->id(), 'email' => $player->id(), 'displayName' => $player->displayName(), 'roles' => []],
                'life' => 40,
                'zones' => [
                    'library' => [],
                    'hand' => [],
                    'battlefield' => [],
                    'graveyard' => [],
                    'exile' => [],
                    'command' => [],
                ],
                'commanderDamage' => [],
                'counters' => [],
            ];
        }
        $baseSnapshot = $handler->normalizeSnapshot($rawSnapshot);
        $game = new Game(new Room($actor), $baseSnapshot);

        $events = [
            new GameEvent($game, 'life.changed', [
                'playerId' => $actor->id(),
                'life' => 33,
            ], $actor, 'runtime-life', 2),
            new GameEvent($game, 'card.position.changed', [
                'instanceId' => 'battlefield-1',
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'position' => ['x' => 0.37, 'y' => 0.61, 'unit' => 'ratio'],
            ], $actor, 'runtime-position', 3),
            new GameEvent($game, 'card.tapped', [
                'instanceId' => 'battlefield-1',
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'tapped' => true,
                'rotation' => 90,
            ], $actor, 'runtime-tap', 4),
            new GameEvent($game, 'card.face_down.changed', [
                'instanceId' => 'battlefield-1',
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'faceDown' => true,
            ], $actor, 'runtime-face-down', 5),
            new GameEvent($game, 'card.controller.changed', [
                'instanceId' => 'battlefield-1',
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'controllerId' => $controller->id(),
            ], $actor, 'runtime-controller', 6),
            new GameEvent($game, 'arrow.created', [
                'id' => 'arrow-1',
                'playerId' => $actor->id(),
                'fromInstanceId' => 'battlefield-1',
                'toInstanceId' => 'equipment-1',
            ], $actor, 'runtime-arrow', 7),
            new GameEvent($game, 'attachment.created', [
                'id' => 'attachment-1',
                'playerId' => $actor->id(),
                'equipmentInstanceId' => 'equipment-1',
                'attachedToInstanceId' => 'battlefield-1',
            ], $actor, 'runtime-attachment', 8),
            new GameEvent($game, 'card.power_toughness.changed', [
                'instanceId' => 'battlefield-1',
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'power' => 5,
                'toughness' => 7,
            ], $actor, 'runtime-stats', 9),
            new GameEvent($game, 'card.counter.changed', [
                'instanceId' => 'battlefield-1',
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'counter' => '+1/+1',
                'value' => 3,
                'power' => 8,
                'toughness' => 10,
            ], $actor, 'runtime-counter', 10),
        ];

        $rebuilt = $this->eventStore($handler, $flags)->rebuildSnapshot(new Game(new Room($actor), $baseSnapshot), null, $events);

        self::assertSame(10, $rebuilt['version']);
        self::assertSame(33, $rebuilt['players'][$actor->id()]['life']);
        self::assertSame(40, $rebuilt['players'][$controller->id()]['life']);
        $card = $this->cardById($rebuilt, $actor->id(), 'battlefield', 'battlefield-1');
        self::assertSame(['x' => 0.37, 'y' => 0.61, 'unit' => 'ratio'], $card['position'] ?? null);
        self::assertTrue($card['tapped'] ?? false);
        self::assertSame(90, $card['rotation'] ?? null);
        self::assertTrue($card['faceDown'] ?? false);
        self::assertSame($controller->id(), $card['controllerId'] ?? null);
        self::assertSame(['+1/+1' => 3], $card['counters'] ?? null);
        self::assertSame(8, $card['power'] ?? null);
        self::assertSame(10, $card['toughness'] ?? null);
        self::assertSame('arrow-1', $rebuilt['arrows'][0]['id'] ?? null);
        self::assertSame('attachment-1', $rebuilt['attachments'][0]['id'] ?? null);
        $equipment = $this->cardById($rebuilt, $actor->id(), 'battlefield', 'equipment-1');
        self::assertSame(['x' => 0, 'y' => 0], $equipment['position'] ?? null);
        self::assertFalse($equipment['tapped'] ?? true);
    }

    public function testCompactReplayBootstrapDoesNotInventMissingBattlefieldPosition(): void
    {
        $actor = new User('runtime-compact-position@example.test', 'Runtime Compact Position');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'card.counter.changed');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $snapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'battlefield' => [$this->card('battlefield-without-position', 'Positionless Permanent', 'battlefield')],
        ]));
        unset($snapshot['players'][$actor->id()]['zones']['battlefield'][0]['position']);
        $snapshot['version'] = 2;
        $game = new Game(new Room($actor), $snapshot);
        $store = $this->eventStore($handler, $flags);
        $compact = (new CompactGameCardStateMapper())->compactSnapshot($snapshot, $game->id(), $game->status());
        $compactRecord = new GameSnapshotCompact($game, 2, $compact, $store->checksum($compact));

        self::assertArrayNotHasKey('position', $compact['instances']['battlefield-without-position']);

        $counter = new GameEvent($game, 'card.counter.changed', [
            'instanceId' => 'battlefield-without-position',
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'counter' => 'charge',
            'value' => 1,
        ], $actor, 'runtime-positionless-counter', 3);

        $rebuilt = $store->rebuildSnapshot(new Game(new Room($actor), $snapshot), $compactRecord, [$counter]);
        $card = $this->cardById($rebuilt, $actor->id(), 'battlefield', 'battlefield-without-position');
        self::assertArrayNotHasKey('position', $card);
        self::assertSame(['charge' => 1], $card['counters'] ?? null);

        $bootstrap = (new GameplayV2ContractFactory())->bootstrap(
            new Game(new Room($actor), $rebuilt),
            $actor,
            $rebuilt,
        );
        self::assertNull($bootstrap->instances['battlefield-without-position']['position'] ?? null);
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

    public function testReplayDoesNotReintroduceRuntimeGoEvaporatedToken(): void
    {
        $actor = new User('runtime-go-token-evaporate@example.test', 'Runtime Go Token Evaporate');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'card.moved');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'battlefield' => [[
                ...$this->card('runtime-token-1', 'Runtime Bear Token', 'battlefield'),
                'isToken' => true,
                'isTokenCopy' => false,
                'tokenMeta' => ['isCopy' => false],
            ]],
            'graveyard' => [],
            'exile' => [],
        ]));
        $game = new Game(new Room($actor), $baseSnapshot);
        $move = new GameEvent($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceIds' => ['runtime-token-1'],
            'instanceId' => 'runtime-token-1',
            'moves' => [[
                'instanceId' => 'runtime-token-1',
                'from' => ['playerId' => $actor->id(), 'zone' => 'battlefield', 'index' => 0],
                'to' => ['playerId' => $actor->id(), 'zone' => 'graveyard', 'index' => 0],
                'evaporates' => true,
            ]],
        ], $actor, 'runtime-token-evaporate', 2);

        $rebuilt = $this->eventStore($handler, $flags)->rebuildSnapshot(new Game(new Room($actor), $baseSnapshot), null, [$move]);
        $bootstrap = (new GameplayV2ContractFactory())->bootstrap(new Game(new Room($actor), $rebuilt), $actor, $rebuilt)->toArray();

        self::assertSame([], $this->zoneIds($rebuilt, $actor->id(), 'battlefield'));
        self::assertSame([], $this->zoneIds($rebuilt, $actor->id(), 'graveyard'));
        self::assertArrayNotHasKey('runtime-token-1', $rebuilt['loc'] ?? []);
        self::assertArrayNotHasKey('runtime-token-1', $bootstrap['instances']);
    }

    public function testReplayPreservesRuntimeGoUntapAllForControlledPermanentsAcrossBattlefields(): void
    {
        $actor = new User('runtime-go-untap-owner@example.test', 'Runtime Go Untap Owner');
        $opponent = new User('runtime-go-untap-opponent@example.test', 'Runtime Go Untap Opponent');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'battlefield.untap_all');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $rawSnapshot = $this->baseSnapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('commander-1', 'Runtime Commander', 'battlefield'),
                    'ownerId' => $actor->id(),
                    'controllerId' => $actor->id(),
                    'isCommander' => true,
                    'tapped' => true,
                    'rotation' => 90,
                ],
                [
                    ...$this->card('token-1', 'Runtime Soldier', 'battlefield'),
                    'ownerId' => $actor->id(),
                    'controllerId' => $actor->id(),
                    'isToken' => true,
                    'tapped' => true,
                    'rotation' => 90,
                ],
            ],
        ]);
        $rawSnapshot['players'][$opponent->id()] = [
            'user' => ['id' => $opponent->id(), 'email' => $opponent->email(), 'displayName' => $opponent->displayName(), 'roles' => []],
            'life' => 40,
            'zones' => [
                'library' => [],
                'hand' => [],
                'battlefield' => [
                    [
                        ...$this->card('borrowed-1', 'Borrowed Permanent', 'battlefield'),
                        'ownerId' => $opponent->id(),
                        'controllerId' => $actor->id(),
                        'tapped' => true,
                        'rotation' => 90,
                    ],
                    [
                        ...$this->card('opponent-1', 'Opponent Permanent', 'battlefield'),
                        'ownerId' => $opponent->id(),
                        'controllerId' => $opponent->id(),
                        'tapped' => true,
                        'rotation' => 90,
                    ],
                ],
                'graveyard' => [],
                'exile' => [],
                'command' => [],
            ],
            'commanderDamage' => [],
            'counters' => [],
        ];
        $baseSnapshot = $handler->normalizeSnapshot($rawSnapshot);
        $game = new Game(new Room($actor), $baseSnapshot);
        $untap = new GameEvent($game, 'battlefield.untap_all', [
            'playerId' => $actor->id(),
            'instanceIds' => ['commander-1', 'token-1', 'borrowed-1'],
        ], $actor, 'runtime-untap-all', 2);

        $rebuilt = $this->eventStore($handler, $flags)->rebuildSnapshot(new Game(new Room($actor), $baseSnapshot), null, [$untap]);

        self::assertFalse($this->cardById($rebuilt, $actor->id(), 'battlefield', 'commander-1')['tapped'] ?? true);
        self::assertSame(0, $this->cardById($rebuilt, $actor->id(), 'battlefield', 'commander-1')['rotation'] ?? null);
        self::assertFalse($this->cardById($rebuilt, $actor->id(), 'battlefield', 'token-1')['tapped'] ?? true);
        self::assertSame(0, $this->cardById($rebuilt, $actor->id(), 'battlefield', 'token-1')['rotation'] ?? null);
        self::assertFalse($this->cardById($rebuilt, $opponent->id(), 'battlefield', 'borrowed-1')['tapped'] ?? true);
        self::assertSame(0, $this->cardById($rebuilt, $opponent->id(), 'battlefield', 'borrowed-1')['rotation'] ?? null);
        self::assertTrue($this->cardById($rebuilt, $opponent->id(), 'battlefield', 'opponent-1')['tapped'] ?? false);
        self::assertSame(90, $this->cardById($rebuilt, $opponent->id(), 'battlefield', 'opponent-1')['rotation'] ?? null);

        $bootstrap = (new GameplayV2ContractFactory())->bootstrap(new Game(new Room($actor), $rebuilt), $actor, $rebuilt)->toArray();
        self::assertFalse($bootstrap['instances']['commander-1']['tapped'] ?? true);
        self::assertFalse($bootstrap['instances']['token-1']['tapped'] ?? true);
        self::assertFalse($bootstrap['instances']['borrowed-1']['tapped'] ?? true);
        self::assertTrue($bootstrap['instances']['opponent-1']['tapped'] ?? false);
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
