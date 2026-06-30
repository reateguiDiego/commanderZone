<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\Compact\CardStaticBundle;
use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\Compact\GameplayCompactRuntimeFlags;
use App\Application\Game\GameActivityStreamService;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameDisconnectVoteService;
use App\Application\Game\GameEventStoreV2;
use App\Application\Game\GameplayStreamsFlags;
use App\Application\Game\GameProjectionService;
use App\Application\Game\GameVisibilityIndex;
use App\Application\Game\Performance\GameplayMetricsInspector;
use App\Application\Game\Performance\GameplayMetricsStore;
use App\Application\Game\Runtime\GameRuntimeCommandClientInterface;
use App\Application\Game\Runtime\GameRuntimeCommandResult;
use App\Application\Game\Runtime\GameRuntimeGatewayException;
use App\Application\Game\Runtime\GameplayRuntimeGateway;
use App\Application\Game\Runtime\GameplayRuntimePatchAdapter;
use App\Application\Game\Runtime\GameplayRuntimeRouter;
use App\Application\Game\WebSocket\GameWebsocketCardLocalizationResolver;
use App\Application\Game\WebSocket\GameWebsocketCommandResult;
use App\Application\Game\WebSocket\GameWebsocketCommandPatchService;
use App\Application\Game\WebSocket\GameWebsocketMessageFactory;
use App\Application\Game\WebSocket\GameWebsocketPatchBuilder;
use App\Application\Game\WebSocket\GameWebsocketPeer;
use App\Application\Game\WebSocket\GameWebsocketRoomRegistry;
use App\Domain\Game\Game;
use App\Domain\Game\GameChatMessage;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class GameWebsocketCommandPatchServiceTest extends TestCase
{
    public function testAppliesCommandAndReturnsGamePatchWithoutAcceptedAck(): void
    {
        [$game, $actor] = $this->game();
        $service = $this->service($game, existingEvent: null, expectPersist: true, expectFlush: true, expectClear: true);

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'delta' => -2],
            'action-1',
            1,
            'message-1',
        );
        $message = $result->messageForUserId($actor->id());

        self::assertSame('game_patch', $message['kind']);
        self::assertSame(1, $message['baseVersion']);
        self::assertSame(2, $message['version']);
        self::assertSame('action-1', $message['clientActionId']);
        self::assertCount(2, $message['operations']);
        self::assertSame([
            'op' => 'player.life.set',
            'playerId' => $actor->id(),
            'value' => 38,
        ], $message['operations'][0]);
        self::assertSame('eventLog.append', $message['operations'][1]['op']);
        self::assertSame('life.changed', $message['operations'][1]['entries'][0]['type']);
        self::assertArrayNotHasKey('status', $message);
    }

    public function testStaleBaseVersionReturnsResyncRequiredAckWithoutApplyingCommand(): void
    {
        [$game, $actor] = $this->game();
        $service = $this->service($game, existingEvent: null, expectPersist: false, expectFlush: false, expectClear: true);

        $message = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'delta' => -2],
            'action-1',
            2,
            'message-1',
        );

        self::assertSame('command_ack', $message['kind']);
        self::assertSame('resync_required', $message['status']);
        self::assertSame('BASE_VERSION_MISMATCH', $message['error']['code']);
        self::assertSame(2, $message['error']['conflict']['commandBaseVersion']);
        self::assertSame(1, $message['error']['conflict']['currentVersion']);
        self::assertSame(0, $message['error']['conflict']['delta']);
        self::assertSame('stale_client', $message['error']['conflict']['classification']);
        self::assertSame(40, $game->snapshot()['players'][$actor->id()]['life']);
    }

    public function testDuplicateClientActionIdReturnsDuplicateAckWithoutApplyingCommand(): void
    {
        [$game, $actor] = $this->game();
        $existingEvent = new GameEvent($game, 'life.changed', ['playerId' => $actor->id(), 'delta' => -2], $actor, 'action-1');
        $service = $this->service($game, existingEvent: $existingEvent, expectPersist: false, expectFlush: false, expectClear: true);

        $message = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'delta' => -2],
            'action-1',
            1,
            'message-1',
        );

        self::assertSame('command_ack', $message['kind']);
        self::assertSame('duplicate', $message['status']);
        self::assertSame(40, $game->snapshot()['players'][$actor->id()]['life']);
    }

    public function testBaseVersionMismatchIncludesConcurrentWriteConflictMetadata(): void
    {
        [$game, $actor] = $this->game();
        $snapshot = $game->snapshot();
        $snapshot['version'] = 2;
        $game->replaceSnapshot($snapshot);
        $service = $this->service($game, existingEvent: null, expectPersist: false, expectFlush: false, expectClear: true);

        $message = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'delta' => -2],
            'action-2',
            1,
            'message-2',
        );

        self::assertSame('command_ack', $message['kind']);
        self::assertSame('resync_required', $message['status']);
        self::assertSame('BASE_VERSION_MISMATCH', $message['error']['code']);
        self::assertSame(1, $message['error']['conflict']['commandBaseVersion']);
        self::assertSame(2, $message['error']['conflict']['currentVersion']);
        self::assertSame(1, $message['error']['conflict']['delta']);
        self::assertSame('concurrent_write', $message['error']['conflict']['classification']);
    }

    public function testInvalidCommandPayloadReturnsRejectedAck(): void
    {
        [$game, $actor] = $this->game();
        $service = $this->service($game, existingEvent: null, expectPersist: false, expectFlush: false, expectClear: true);

        $message = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            [],
            'action-1',
            1,
            'message-1',
        );

        self::assertSame('command_ack', $message['kind']);
        self::assertSame('rejected', $message['status']);
        self::assertSame('COMMAND_REJECTED', $message['error']['code']);
        self::assertSame(40, $game->snapshot()['players'][$actor->id()]['life']);
    }

    public function testInvalidClientActionIdReturnsRejectedAckWithoutOpeningManager(): void
    {
        [$game, $actor] = $this->game();
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::never())->method('getManagerForClass');
        $service = $this->serviceWithRegistry($registry);

        $message = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'delta' => -2],
            '',
            1,
            'message-1',
        );

        self::assertSame('command_ack', $message['kind']);
        self::assertSame('rejected', $message['status']);
        self::assertSame('INVALID_COMMAND_MESSAGE', $message['error']['code']);
    }

    public function testInvalidBaseVersionReturnsRejectedAckWithoutOpeningManager(): void
    {
        [$game, $actor] = $this->game();
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::never())->method('getManagerForClass');
        $service = $this->serviceWithRegistry($registry);

        $message = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'delta' => -2],
            'action-1',
            0,
            'message-1',
        );

        self::assertSame('command_ack', $message['kind']);
        self::assertSame('rejected', $message['status']);
        self::assertSame('INVALID_COMMAND_MESSAGE', $message['error']['code']);
    }

    /**
     * @return array{Game, User}
     */
    private function game(): array
    {
        $actor = new User('actor@example.test', 'Actor');
        $room = new Room($actor);
        $room->addPlayer(new RoomPlayer($room, $actor));

        return [new Game($room, $this->snapshot($actor)), $actor];
    }

    public function testUserWithoutControlGetsRejectedAckWithoutApplyingCommand(): void
    {
        [$game] = $this->game();
        $outsider = new User('outsider@example.test', 'Outsider');
        $service = $this->service($game, existingEvent: null, expectPersist: false, expectFlush: false, expectClear: true, actor: $outsider, expectTransaction: false);

        $message = $service->apply(
            $game->id(),
            $outsider->id(),
            'life.changed',
            ['playerId' => $outsider->id(), 'delta' => -2],
            'action-1',
            1,
            'message-1',
        );

        self::assertSame('command_ack', $message['kind']);
        self::assertSame('rejected', $message['status']);
        self::assertSame('GAME_ACCESS_DENIED', $message['error']['code']);
    }

    public function testZoneChangedExpandsCompactWebsocketPayloadWithoutEchoingFullCards(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $service = $this->service($game, existingEvent: null, expectPersist: true, expectFlush: true, expectClear: true);

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'zone.changed',
            [
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'instanceIds' => ['battlefield-2', 'battlefield-1'],
            ],
            'action-zone',
            1,
            'message-zone',
        );
        $message = $result->messageForUserId($actor->id());
        $encoded = json_encode($message, JSON_THROW_ON_ERROR);

        self::assertSame('game_patch', $message['kind']);
        self::assertSame('zone.changed', $message['event']['type']);
        self::assertSame(['battlefield-2', 'battlefield-1'], $message['event']['payload']['instanceIds']);
        self::assertArrayNotHasKey('cards', $message['event']['payload']);
        self::assertSame('card.move', $message['operations'][0]['op']);
        self::assertStringNotContainsString('"zones"', $encoded);
    }

    public function testZoneChangedStillBuildsLegacyPatchFromCompactPersistedSnapshot(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $game->replaceSnapshot((new CompactGameCardStateMapper())->compactSnapshot($game->snapshot()));
        $handler = new GameCommandHandler(compactRuntimeFlags: new GameplayCompactRuntimeFlags(true));
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            handler: $handler,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'zone.changed',
            [
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'instanceIds' => ['battlefield-2', 'battlefield-1'],
            ],
            'action-zone-compact',
            1,
            'message-zone-compact',
        );
        $message = $result->messageForUserId($actor->id());
        $encoded = json_encode($message, JSON_THROW_ON_ERROR);

        self::assertSame('game_patch', $message['kind']);
        self::assertSame('zone.changed', $message['event']['type']);
        self::assertSame('card.move', $message['operations'][0]['op']);
        self::assertStringNotContainsString('"cardCatalog"', $encoded);
        self::assertStringNotContainsString('"runtimeFormat"', $encoded);
    }

    public function testNonCardCommandPassesExplicitEmptyLocalizationLookupToProjection(): void
    {
        [$game, $actor] = $this->game();
        $actor->updateCardLanguage('es');
        $capturedLookups = [];
        $projection = $this->getMockBuilder(GameProjectionService::class)
            ->setConstructorArgs([new GameCommandHandler()])
            ->onlyMethods(['projectSnapshot'])
            ->getMock();
        $projection
            ->expects(self::exactly(2))
            ->method('projectSnapshot')
            ->willReturnCallback(function (array $snapshot, User $viewer, bool $viewerCanUseOwnHiddenZones, ?array $localizedLookup = null) use (&$capturedLookups): array {
                self::assertTrue($viewerCanUseOwnHiddenZones);
                $capturedLookups[] = $localizedLookup;

                return $snapshot;
            });

        $connection = $this->createMock(\Doctrine\DBAL\Connection::class);
        $connection->expects(self::never())->method('executeQuery');
        $resolver = new GameWebsocketCardLocalizationResolver($connection);

        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            projection: $projection,
            resolver: $resolver,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'delta' => -2],
            'action-empty-lookup',
            1,
            'message-empty-lookup',
        );
        $message = $result->messageForUserId($actor->id());

        self::assertSame('game_patch', $message['kind']);
        self::assertSame('player.life.set', $message['operations'][0]['op']);
        self::assertSame([[], []], $capturedLookups);
        self::assertNotNull($result->debugProfile());
    }

    public function testNonCardCommandReusesPreparedRulingsLookupsAcrossViewerProjections(): void
    {
        [$game, $actor] = $this->game();
        $capturedRulingsLookups = [];
        $projection = $this->getMockBuilder(GameProjectionService::class)
            ->setConstructorArgs([new GameCommandHandler()])
            ->onlyMethods(['projectSnapshot', 'rulingsLookupForViewers'])
            ->getMock();
        $projection
            ->expects(self::exactly(2))
            ->method('rulingsLookupForViewers')
            ->willReturnOnConsecutiveCalls(
                ['before-print' => true],
                ['after-print' => true],
            );
        $projection
            ->expects(self::exactly(2))
            ->method('projectSnapshot')
            ->willReturnCallback(function (
                array $snapshot,
                User $viewer,
                bool $viewerCanUseOwnHiddenZones,
                ?array $localizedLookup = null,
                ?array $rulingsLookup = null,
            ) use (&$capturedRulingsLookups): array {
                self::assertTrue($viewerCanUseOwnHiddenZones);
                $capturedRulingsLookups[] = $rulingsLookup;

                return $snapshot;
            });

        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            projection: $projection,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'delta' => -2],
            'action-rulings-lookup',
            1,
            'message-rulings-lookup',
        );
        $message = $result->messageForUserId($actor->id());

        self::assertSame('game_patch', $message['kind']);
        self::assertSame([
            ['before-print' => true],
            ['after-print' => true],
        ], $capturedRulingsLookups);
    }

    public function testRecordsStructuredMetricsForAppliedCommand(): void
    {
        [$game, $actor] = $this->game();
        $metricsStore = new GameplayMetricsStore();
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            metricsStore: $metricsStore,
        );

        $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'delta' => -2],
            'action-metrics',
            1,
            'message-metrics',
        );

        $records = $metricsStore->records();
        self::assertCount(1, $records);
        self::assertSame('websocket', $records[0]['transport']);
        self::assertSame('life.changed', $records[0]['command.type']);
        self::assertSame($game->id(), $records[0]['gameId']);
        self::assertArrayHasKey('snapshot_load_ms', $records[0]);
        self::assertArrayHasKey('normalize_ms', $records[0]);
        self::assertArrayHasKey('command_apply_ms', $records[0]);
        self::assertArrayHasKey('persist_ms', $records[0]);
        self::assertArrayHasKey('projection_ms', $records[0]);
        self::assertArrayHasKey('patch_build_ms', $records[0]);
        self::assertArrayHasKey('snapshot_bytes_before', $records[0]);
        self::assertArrayHasKey('snapshot_bytes_after', $records[0]);
        self::assertArrayHasKey('patch_bytes', $records[0]);
        self::assertArrayHasKey('memory_peak_bytes', $records[0]);
        self::assertFalse($records[0]['resync_required']);
        self::assertFalse($records[0]['clientActionId_duplicate']);
    }

    public function testVisualPositionSpamIsRateLimitedWithoutBlockingGameplayCommands(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $metricsStore = new GameplayMetricsStore();
        $persistedTypes = [];
        $service = $this->serviceAllowingRepeatedCommands($game, $actor, $metricsStore, $persistedTypes);
        $rejected = 0;

        for ($index = 0; $index < 32; ++$index) {
            $result = $service->apply(
                $game->id(),
                $actor->id(),
                'card.position.changed',
                [
                    'playerId' => $actor->id(),
                    'zone' => 'battlefield',
                    'instanceId' => 'battlefield-1',
                    'position' => ['x' => ($index % 10) / 10, 'y' => 0.2, 'unit' => 'ratio'],
                ],
                'action-position-'.$index,
                (int) ($game->snapshot()['version'] ?? 1),
                'message-position-'.$index,
            );
            $message = $result instanceof GameWebsocketCommandResult ? $result->messageForUserId($actor->id()) : $result;
            if (($message['kind'] ?? null) === 'command_ack' && ($message['error']['code'] ?? null) === 'VISUAL_COMMAND_RATE_LIMITED') {
                ++$rejected;
            }
        }

        $lifeResult = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'delta' => -1],
            'action-life-after-position-spam',
            (int) ($game->snapshot()['version'] ?? 1),
            'message-life-after-position-spam',
        );
        $lifeMessage = $lifeResult instanceof GameWebsocketCommandResult ? $lifeResult->messageForUserId($actor->id()) : $lifeResult;

        self::assertGreaterThan(0, $rejected);
        self::assertSame('game_patch', $lifeMessage['kind']);
        self::assertSame(39, $game->snapshot()['players'][$actor->id()]['life']);
        self::assertContains('life.changed', $persistedTypes);
        $hasBackpressureMetric = false;
        foreach ($metricsStore->records() as $record) {
            if (($record['status'] ?? null) === 'visual_backpressure' && ($record['command.type'] ?? null) === 'card.position.changed') {
                $hasBackpressureMetric = true;
                break;
            }
        }
        self::assertTrue($hasBackpressureMetric);
    }

    public function testCanTranslateSuccessfulPatchToV2Envelope(): void
    {
        [$game, $actor] = $this->game();
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            flagsV2: new GameplayV2Flags(false, true, false, false),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'delta' => -2],
            'action-v2',
            1,
            'message-v2',
            'v2',
        );
        $message = $result->messageForUserId($actor->id());

        self::assertSame('patch.v2', $message['kind']);
        self::assertSame(2, $message['version']);
        self::assertSame('player:'.$actor->id(), $message['visibility']);
        self::assertSame('action-v2', $message['ackClientActionId']);
        self::assertSame('player.life.set', $message['ops'][0]['op']);
    }

    public function testStreamChatMessageUsesPatchV2WithoutProjectionOrSnapshotWrite(): void
    {
        [$game, $actor, $opponent] = $this->gameWithOpponent();
        $snapshot = $game->snapshot();
        unset($snapshot['chat'], $snapshot['eventLog']);
        $game->replaceSnapshot($snapshot);

        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');

        $gameRepository = $this->createMock(EntityRepository::class);
        $gameRepository->expects(self::once())->method('find')->with($game->id())->willReturn($game);
        $userRepository = $this->createMock(EntityRepository::class);
        $userRepository->expects(self::once())->method('find')->with($actor->id())->willReturn($actor);
        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->method('getRepository')->willReturnMap([
            [Game::class, $gameRepository],
            [User::class, $userRepository],
        ]);
        $manager->expects(self::once())->method('beginTransaction');
        $manager->expects(self::once())
            ->method('persist')
            ->with(self::isInstanceOf(GameChatMessage::class));
        $manager->expects(self::once())->method('flush');
        $manager->expects(self::once())->method('commit');
        $manager->expects(self::once())->method('clear');

        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::once())->method('getManagerForClass')->with(Game::class)->willReturn($manager);

        $messages = new GameWebsocketMessageFactory();
        $metrics = new GameplayMetricsStore();
        $handler = new GameCommandHandler();
        $service = new GameWebsocketCommandPatchService(
            $handler,
            new GameDisconnectVoteService($handler),
            new GameWebsocketPatchBuilder($messages),
            $messages,
            new \App\Application\Game\WebSocket\GameWebsocketRoomRegistry(),
            $registry,
            $projection,
            null,
            $metrics,
            new GameplayMetricsInspector(),
            new GameplayV2ContractFactory(),
            new GameplayV2Flags(false, true, false, false),
            null,
            new GameActivityStreamService($registry, new GameplayStreamsFlags(true)),
            new GameplayStreamsFlags(true),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'chat.message',
            ['message' => 'hello table'],
            'action-stream-chat',
            1,
            'message-stream-chat',
            'v2',
        );

        $ownerMessage = $result->messageForUserId($actor->id());
        $opponentMessage = $result->messageForUserId($opponent->id());

        self::assertSame('patch.v2', $ownerMessage['kind']);
        self::assertSame('chat.message.add', $ownerMessage['ops'][0]['op']);
        self::assertSame('hello table', $ownerMessage['ops'][0]['message']['message']);
        self::assertSame('patch.v2', $opponentMessage['kind']);
        self::assertSame('chat.message.add', $opponentMessage['ops'][0]['op']);
        self::assertArrayNotHasKey('chat', $game->snapshot());
        self::assertArrayNotHasKey('eventLog', $game->snapshot());
        self::assertSame(1, $game->snapshot()['version']);
        self::assertCount(1, $metrics->records());
        self::assertSame(0.0, $metrics->records()[0]['projection_ms']);
        self::assertSame(1, $metrics->records()[0]['chat.message_route'] ?? null);
        self::assertSame(0, $metrics->records()[0]['chat.snapshot_write_count'] ?? null);
        self::assertGreaterThan(0, $metrics->records()[0]['chat.patch_bytes'] ?? 0);
    }

    public function testStreamChatReactionUsesPatchV2WithoutProjectionOrSnapshotWrite(): void
    {
        [$game, $actor, $opponent] = $this->gameWithOpponent();
        $snapshot = $game->snapshot();
        unset($snapshot['chat'], $snapshot['eventLog']);
        $game->replaceSnapshot($snapshot);
        $chat = new GameChatMessage($game, $opponent, 'hello');

        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');

        $gameRepository = $this->createMock(EntityRepository::class);
        $gameRepository->expects(self::once())->method('find')->with($game->id())->willReturn($game);
        $userRepository = $this->createMock(EntityRepository::class);
        $userRepository->expects(self::once())->method('find')->with($actor->id())->willReturn($actor);
        $chatRepository = $this->createMock(EntityRepository::class);
        $chatRepository->expects(self::once())->method('findOneBy')->willReturn($chat);
        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->method('getRepository')->willReturnMap([
            [Game::class, $gameRepository],
            [User::class, $userRepository],
            [GameChatMessage::class, $chatRepository],
        ]);
        $manager->expects(self::once())->method('beginTransaction');
        $manager->expects(self::once())
            ->method('persist')
            ->with(self::isInstanceOf(GameChatMessage::class));
        $manager->expects(self::once())->method('flush');
        $manager->expects(self::once())->method('commit');
        $manager->expects(self::once())->method('clear');

        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::exactly(2))->method('getManagerForClass')->with(Game::class)->willReturn($manager);

        $messages = new GameWebsocketMessageFactory();
        $metrics = new GameplayMetricsStore();
        $service = new GameWebsocketCommandPatchService(
            new GameCommandHandler(),
            new GameDisconnectVoteService(new GameCommandHandler()),
            new GameWebsocketPatchBuilder($messages),
            $messages,
            new \App\Application\Game\WebSocket\GameWebsocketRoomRegistry(),
            $registry,
            $projection,
            null,
            $metrics,
            new GameplayMetricsInspector(),
            new GameplayV2ContractFactory(),
            new GameplayV2Flags(false, true, false, false),
            null,
            new GameActivityStreamService($registry, new GameplayStreamsFlags(true)),
            new GameplayStreamsFlags(true),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'chat.reaction.toggled',
            ['messageId' => $chat->messageId(), 'reaction' => 'like'],
            'action-stream-reaction',
            1,
            'message-stream-reaction',
            'v2',
        );

        $ownerMessage = $result->messageForUserId($actor->id());
        $opponentMessage = $result->messageForUserId($opponent->id());

        self::assertSame('patch.v2', $ownerMessage['kind']);
        self::assertSame('chat.reaction.set', $ownerMessage['ops'][0]['op']);
        self::assertSame($chat->messageId(), $ownerMessage['ops'][0]['messageId']);
        self::assertSame('patch.v2', $opponentMessage['kind']);
        self::assertSame('chat.reaction.set', $opponentMessage['ops'][0]['op']);
        self::assertArrayNotHasKey('chat', $game->snapshot());
        self::assertArrayNotHasKey('eventLog', $game->snapshot());
        self::assertSame(1, $game->snapshot()['version']);
        self::assertCount(1, $metrics->records());
        self::assertSame(0.0, $metrics->records()[0]['projection_ms']);
        self::assertSame(1, $metrics->records()[0]['chat.reaction_route'] ?? null);
        self::assertSame(0, $metrics->records()[0]['chat.snapshot_write_count'] ?? null);
        self::assertGreaterThan(0, $metrics->records()[0]['chat.patch_bytes'] ?? 0);
    }

    public function testV2DirectCommandBypassesProjectionAndDiffForCardTapped(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');
        $metrics = new GameplayMetricsStore();
        $handler = new GameCommandHandler(flagsV2: new GameplayV2Flags(true, false, false, false));
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            projection: $projection,
            metricsStore: $metrics,
            handler: $handler,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'card.tapped',
            ['playerId' => $actor->id(), 'zone' => 'battlefield', 'instanceId' => 'battlefield-1', 'tapped' => true],
            'action-v2-tap',
            1,
            'message-v2-tap',
        );
        $message = $result->messageForUserId($actor->id());

        self::assertSame('game_patch', $message['kind']);
        self::assertSame('card.state.set', $message['operations'][0]['op']);
        self::assertSame('eventLog.append', $message['operations'][1]['op']);
        self::assertCount(1, $metrics->records());
        self::assertSame(0.0, $metrics->records()[0]['projection_ms']);
        self::assertLessThan(1500, $metrics->records()[0]['patch_bytes']);
    }

    public function testV2DirectCommandCanTranslateToPatchV2WithoutLegacyDiff(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');
        $handler = new GameCommandHandler(flagsV2: new GameplayV2Flags(true, false, false, false));
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            projection: $projection,
            flagsV2: new GameplayV2Flags(false, true, false, false),
            handler: $handler,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'card.tapped',
            ['playerId' => $actor->id(), 'zone' => 'battlefield', 'instanceId' => 'battlefield-1', 'tapped' => true],
            'action-v2-tap',
            1,
            'message-v2-tap',
            'v2',
        );
        $message = $result->messageForUserId($actor->id());

        self::assertSame('patch.v2', $message['kind']);
        self::assertSame('action-v2-tap', $message['ackClientActionId']);
        self::assertSame('card.field.set', $message['ops'][0]['op']);
    }

    public function testV2ZoneChangedPrivateHandSanitizesOpponentWithoutProjection(): void
    {
        [$game, $actor, $opponent] = $this->gameWithPrivateHandCards();
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');
        $handler = new GameCommandHandler(flagsV2: new GameplayV2Flags(true, false, false, false));
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            projection: $projection,
            handler: $handler,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'zone.changed',
            ['playerId' => $actor->id(), 'zone' => 'hand', 'instanceIds' => ['hand-2', 'hand-1']],
            'action-v2-hand-reorder',
            1,
            'message-v2-hand-reorder',
        );

        $ownerMessage = $result->messageForUserId($actor->id());
        $opponentMessage = $result->messageForUserId($opponent->id());
        $encoded = json_encode($opponentMessage, JSON_THROW_ON_ERROR);

        self::assertSame('card.move', $ownerMessage['operations'][0]['op']);
        self::assertNotContains('card.move', array_column($opponentMessage['operations'], 'op'));
        self::assertStringNotContainsString('hand-1', $encoded);
        self::assertStringNotContainsString('hand-2', $encoded);
        self::assertStringNotContainsString('Private Hand One', $encoded);
    }

    public function testV2ZoneRandomCardSelectedSanitizesOpponentWithoutProjection(): void
    {
        [$game, $actor, $opponent] = $this->gameWithPrivateLibraryCards();
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');
        $handler = new GameCommandHandler(
            randomizer: new class() extends \App\Application\Game\GameRandomizer {
                public function pickOne(array $items): mixed
                {
                    return $items[0];
                }
            },
            flagsV2: new GameplayV2Flags(true, false, false, false),
        );
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            projection: $projection,
            handler: $handler,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'zone.random_card.selected',
            ['playerId' => $actor->id(), 'zone' => 'library'],
            'action-v2-random',
            1,
            'message-v2-random',
        );

        $message = $result->messageForUserId($opponent->id());
        $encoded = json_encode($message, JSON_THROW_ON_ERROR);

        self::assertSame('eventLog.append', $message['operations'][0]['op']);
        self::assertArrayNotHasKey('cardInstanceId', $message['operations'][0]['entries'][0]);
        self::assertStringNotContainsString('Private Library One', $encoded);
        self::assertStringNotContainsString('library-1', $encoded);
    }

    public function testLegacyRevealTopWithVisibilityIndexDoesNotLeakUnauthorizedOpponent(): void
    {
        [$game, $actor, $opponent] = $this->gameWithPrivateLibraryCards();
        $flags = new GameplayV2Flags(false, false, false, false, true);
        $handler = new GameCommandHandler(flagsV2: $flags);
        $projection = new GameProjectionService($handler, null, null, null, new GameVisibilityIndex(), $flags);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            projection: $projection,
            handler: $handler,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'library.reveal_top',
            ['playerId' => $actor->id(), 'count' => 1, 'to' => [$actor->id()]],
            'action-reveal-top-private',
            1,
            'message-reveal-top-private',
        );

        $opponentMessage = $result->messageForUserId($opponent->id());
        $encoded = json_encode($opponentMessage, JSON_THROW_ON_ERROR);

        self::assertStringNotContainsString('Private Library One', $encoded);
        self::assertStringNotContainsString('library-1', $encoded);
        self::assertStringNotContainsString('oracleText', $encoded);
        self::assertStringNotContainsString('imageUris', $encoded);
    }

    public function testV2DirectDrawKeepsCardMovePrivateAndCountsPublicWithoutProjection(): void
    {
        [$game, $actor, $opponent] = $this->gameWithPrivateLibraryCards();
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');
        $handler = new GameCommandHandler(flagsV2: new GameplayV2Flags(true, false, false, false));
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            projection: $projection,
            handler: $handler,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'library.draw',
            ['playerId' => $actor->id()],
            'action-v2-draw',
            1,
            'message-v2-draw',
        );

        $ownerMessage = $result->messageForUserId($actor->id());
        $opponentMessage = $result->messageForUserId($opponent->id());
        self::assertContains('card.move', array_column($ownerMessage['operations'], 'op'));
        self::assertNotContains('card.move', array_column($opponentMessage['operations'], 'op'));
        self::assertContains('zone.counts.set', array_column($ownerMessage['operations'], 'op'));
        self::assertContains('zone.counts.set', array_column($opponentMessage['operations'], 'op'));
    }

    public function testAllowlistedLibraryCommandRoutesToRuntimePrimaryPatchV2WithoutProjectionOrSnapshotWrite(): void
    {
        [$game, $actor, $opponent] = $this->gameWithPrivateLibraryCards();
        $runtimeCardKey = CardStaticBundle::fromLegacyCard($game->snapshot()['players'][$actor->id()]['zones']['library'][1])->cardKey;
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'player:'.$actor->id(),
            'ops' => [
                ['op' => 'zone.cards.remove', 'data' => ['playerId' => $actor->id(), 'zone' => 'library', 'instanceIds' => ['library-1']]],
                ['op' => 'zone.cards.add', 'data' => ['playerId' => $actor->id(), 'zone' => 'hand', 'cards' => [['instanceId' => 'library-1', 'cardKey' => $runtimeCardKey]]]],
            ],
        ], [
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [
                ['op' => 'zone.count.set', 'data' => ['playerId' => $actor->id(), 'zone' => 'library', 'count' => 1]],
                ['op' => 'zone.count.set', 'data' => ['playerId' => $actor->id(), 'zone' => 'hand', 'count' => 1]],
            ],
        ]], ['library.full_scan_count' => 0, 'library.reindex_count' => 0]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: false,
            expectClear: true,
            projection: $projection,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('library.draw', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'library.draw', runtime: true, shadow: false),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'library.draw',
            ['playerId' => $actor->id()],
            'action-runtime-draw',
            1,
            'message-runtime-draw',
            'v2',
        );

        $ownerMessage = $result->messageForUserId($actor->id());
        $opponentMessage = $result->messageForUserId($opponent->id());
        self::assertSame('patch.v2', $ownerMessage['kind']);
        self::assertSame(['zone.cards.remove', 'zone.cards.add', 'zone.count.set', 'zone.count.set'], array_column($ownerMessage['ops'], 'op'));
        self::assertArrayHasKey('staticCards', $ownerMessage['ops'][1]);
        self::assertArrayHasKey($runtimeCardKey, $ownerMessage['ops'][1]['staticCards']);
        self::assertSame('Private Library One', $ownerMessage['ops'][1]['staticCards'][$runtimeCardKey]['name']);
        self::assertSame($runtimeCardKey, $ownerMessage['ops'][1]['cards'][0]['cardRef']);
        self::assertSame($runtimeCardKey, $ownerMessage['ops'][1]['cards'][0]['cardKey']);
        self::assertSame($ownerMessage['ops'][1]['staticCards'][$runtimeCardKey]['printId'], $ownerMessage['ops'][1]['cards'][0]['printId']);
        self::assertSame($ownerMessage['ops'][1]['staticCards'][$runtimeCardKey]['cardVersion'], $ownerMessage['ops'][1]['cards'][0]['cardVersion']);
        self::assertSame('en', $ownerMessage['ops'][1]['staticCards'][$runtimeCardKey]['language']);
        self::assertSame('private', $ownerMessage['ops'][1]['staticCards'][$runtimeCardKey]['viewerVisibility']);
        $encodedOwnerMessage = json_encode($ownerMessage, JSON_THROW_ON_ERROR);
        self::assertStringNotContainsString('oracleText', $encodedOwnerMessage);
        self::assertArrayNotHasKey('imageUris', $ownerMessage['ops'][1]['cards'][0]);
        self::assertArrayNotHasKey('cardFaces', $ownerMessage['ops'][1]['cards'][0]);
        self::assertSame(['zone.count.set', 'zone.count.set'], array_column($opponentMessage['ops'], 'op'));
        self::assertStringNotContainsString($runtimeCardKey, json_encode($opponentMessage, JSON_THROW_ON_ERROR));
        self::assertSame(['library.draw'], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_route'] ?? 0);
        self::assertSame(0, $metricsStore->records()[0]['gameplay.runtime_fallback_count'] ?? 1);
        self::assertSame(0, $metricsStore->records()[0]['library.full_scan_count'] ?? 1);
        self::assertSame(0, $metricsStore->records()[0]['library.reindex_count'] ?? 1);
    }

    public function testRuntimeFinalPathBypassesDoctrineSnapshotLockHandlerAndProjection(): void
    {
        [$game, $actor, $opponent] = $this->gameWithPrivateLibraryCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [
                ['op' => 'life.total.set', 'data' => ['playerId' => $actor->id(), 'life' => 39]],
            ],
        ]]);
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::never())->method('getManagerForClass');
        $registry->expects(self::never())->method('getManager');
        $handler = $this->createMock(GameCommandHandler::class);
        $handler->expects(self::never())->method('apply');
        $handler->expects(self::never())->method('normalizeSnapshot');
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');

        $service = $this->serviceWithRegistry(
            $registry,
            projection: $projection,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('life.changed', runtime: true, shadow: false),
            handler: $handler,
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'life.changed', runtime: true, shadow: false),
            rooms: $this->runtimeRoomsFor($game),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'delta' => -1],
            'action-runtime-final-life',
            1,
            'message-runtime-final-life',
            'v2',
            ticketPlayerId: $actor->id(),
            ticketPermissions: ['view', 'command'],
        );

        self::assertSame('patch.v2', $result->messageForUserId($actor->id())['kind']);
        self::assertSame('patch.v2', $result->messageForUserId($opponent->id())['kind']);
        self::assertSame(['life.total.set'], array_column($result->messageForUserId($actor->id())['ops'], 'op'));
        self::assertSame([[]], $runtimeClient->snapshots);

        $record = $metricsStore->records()[0] ?? [];
        self::assertSame('runtime_applied', $record['status'] ?? null);
        self::assertSame(1, $record['gameplay.runtime_route'] ?? 0);
        self::assertSame(0, $record['runtime.snapshot_load_count'] ?? 1);
        self::assertSame(0, $record['runtime.snapshot_write_count'] ?? 1);
        self::assertSame(0, $record['runtime.db_lock_count'] ?? 1);
        self::assertSame(0, $record['runtime.legacy_handler_count'] ?? 1);
        self::assertSame(0, $record['runtime.previous_next_projection_count'] ?? 1);
        self::assertSame(0, $record['runtime.emergency_fallback_count'] ?? 1);
        self::assertSame(0.0, $record['snapshot_load_ms'] ?? -1.0);
        self::assertSame(0.0, $record['projection_ms'] ?? -1.0);
    }

    public function testRuntimeFinalGroupVisibilityUsesViewerMaskWithoutProjectionOrDuplicateEnvelope(): void
    {
        [$game, $actor, $opponent] = $this->gameWithPrivateLibraryCards();
        $spectator = new User('spectator@example.test', 'Spectator');
        $metricsStore = new GameplayMetricsStore();
        $actorMask = $this->viewerMaskForGame($game, $actor->id());
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [
                ['op' => 'turn.set', 'data' => ['turn' => ['activePlayerId' => $actor->id(), 'phase' => 'main-1', 'number' => 1]]],
            ],
        ], [
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'group:'.$actorMask,
            'ops' => [
                ['op' => 'library.top.revealed', 'data' => ['playerId' => $actor->id(), 'cards' => [['instanceId' => 'library-2', 'cardRef' => 'private-top-card']]]],
            ],
        ]]);
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::never())->method('getManagerForClass');
        $registry->expects(self::never())->method('getManager');
        $handler = $this->createMock(GameCommandHandler::class);
        $handler->expects(self::never())->method('apply');
        $handler->expects(self::never())->method('normalizeSnapshot');
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');

        $service = $this->serviceWithRegistry(
            $registry,
            projection: $projection,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('library.reveal_top', runtime: true, shadow: false),
            handler: $handler,
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'library.reveal_top', runtime: true, shadow: false),
            rooms: $this->runtimeRoomsFor($game, [$spectator]),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'library.reveal_top',
            ['playerId' => $actor->id(), 'count' => 1, 'to' => [$actor->id()]],
            'action-runtime-final-group',
            1,
            'message-runtime-final-group',
            'v2',
            ticketPlayerId: $actor->id(),
            ticketPermissions: ['view', 'command'],
        );

        self::assertCount(1, $result->messagesForUserId($actor->id()));
        self::assertCount(1, $result->messagesForUserId($opponent->id()));
        self::assertCount(1, $result->messagesForUserId($spectator->id()));

        $ownerMessage = $result->messageForUserId($actor->id());
        $opponentMessage = $result->messageForUserId($opponent->id());
        $spectatorMessage = $result->messageForUserId($spectator->id());

        self::assertSame(2, $ownerMessage['version']);
        self::assertSame(['turn.set', 'library.top.revealed'], array_column($ownerMessage['ops'], 'op'));
        self::assertSame(['turn.set'], array_column($opponentMessage['ops'], 'op'));
        self::assertSame(['turn.set'], array_column($spectatorMessage['ops'], 'op'));
        self::assertStringNotContainsString('private-top-card', json_encode($opponentMessage, JSON_THROW_ON_ERROR));
        self::assertStringNotContainsString('private-top-card', json_encode($spectatorMessage, JSON_THROW_ON_ERROR));

        $record = $metricsStore->records()[0] ?? [];
        self::assertSame('runtime_applied', $record['status'] ?? null);
        self::assertSame(0, $record['runtime.previous_next_projection_count'] ?? 1);
        self::assertSame(0, $record['runtime.legacy_handler_count'] ?? 1);
        self::assertSame(0, $record['runtime.db_lock_count'] ?? 1);
    }

    public function testRuntimeFinalFailureWithoutEmergencyFlagRejectsWithoutLegacyFallback(): void
    {
        [$game, $actor] = $this->gameWithPrivateLibraryCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([], [], fail: true);
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::never())->method('getManagerForClass');
        $registry->expects(self::never())->method('getManager');
        $handler = $this->createMock(GameCommandHandler::class);
        $handler->expects(self::never())->method('apply');
        $handler->expects(self::never())->method('normalizeSnapshot');

        $service = $this->serviceWithRegistry(
            $registry,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('life.changed', runtime: true, shadow: false),
            handler: $handler,
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'life.changed', runtime: true, shadow: false),
            rooms: $this->runtimeRoomsFor($game),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'delta' => -1],
            'action-runtime-final-fails',
            1,
            'message-runtime-final-fails',
            'v2',
            ticketPlayerId: $actor->id(),
            ticketPermissions: ['view', 'command'],
        );

        self::assertSame('command_ack', $result['kind'] ?? null);
        self::assertSame('rejected', $result['status'] ?? null);
        self::assertSame('RUNTIME_UNAVAILABLE', $result['error']['code'] ?? null);
        $record = $metricsStore->records()[0] ?? [];
        self::assertSame('runtime_failed', $record['status'] ?? null);
        self::assertSame(0, $record['runtime.emergency_fallback_count'] ?? 1);
        self::assertSame(0, $record['runtime.legacy_handler_count'] ?? 1);
        self::assertSame(0, $record['runtime.db_lock_count'] ?? 1);
    }

    public function testRuntimeFinalEmergencyFlagStillRejectsWithoutLegacyFallback(): void
    {
        [$game, $actor] = $this->gameWithPrivateLibraryCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([], [], fail: true);
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::never())->method('getManagerForClass');
        $registry->expects(self::never())->method('getManager');
        $handler = $this->createMock(GameCommandHandler::class);
        $handler->expects(self::never())->method('apply');
        $handler->expects(self::never())->method('normalizeSnapshot');
        $service = $this->serviceWithRegistry(
            $registry,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('life.changed', runtime: true, shadow: false),
            handler: $handler,
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'life.changed', runtime: true, shadow: false),
            emergencyLegacyFallbackEnabled: true,
            rooms: $this->runtimeRoomsFor($game),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'delta' => -1],
            'action-runtime-final-emergency',
            1,
            'message-runtime-final-emergency',
            'v2',
            ticketPlayerId: $actor->id(),
            ticketPermissions: ['view', 'command'],
        );

        self::assertIsArray($result);
        self::assertSame('command_ack', $result['kind'] ?? null);
        self::assertSame('rejected', $result['status'] ?? null);
        self::assertSame('RUNTIME_UNAVAILABLE', $result['error']['code'] ?? null);
        $record = $metricsStore->records()[0] ?? [];
        self::assertSame('runtime_failed', $record['status'] ?? null);
        self::assertSame(0, $record['gameplay.runtime_fallback_count'] ?? 1);
        self::assertSame(0, $record['command.legacy_fallback_count'] ?? 1);
        self::assertSame(0, $record['runtime.emergency_fallback_count'] ?? 1);
        self::assertSame(0, $record['runtime.legacy_handler_count'] ?? 1);
    }

    public function testAllowlistedRuntimePrimaryAcceptsRuntimeVersionAheadOfLegacySnapshot(): void
    {
        [$game, $actor] = $this->gameWithPrivateLibraryCards();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 3,
            'visibility' => 'public',
            'ops' => [
                ['op' => 'zone.count.set', 'data' => ['playerId' => $actor->id(), 'zone' => 'library', 'count' => 0]],
            ],
        ]]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: false,
            expectClear: true,
            flagsV2: $this->runtimeFlags('library.draw_many', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'library.draw_many', runtime: true, shadow: false),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'library.draw_many',
            ['playerId' => $actor->id(), 'count' => 2],
            'action-runtime-draw-many-after-runtime-version',
            2,
            'message-runtime-draw-many-after-runtime-version',
            'v2',
        );

        self::assertSame('patch.v2', $result->messageForUserId($actor->id())['kind']);
        self::assertSame(['library.draw_many'], $runtimeClient->types);
        self::assertSame([2], $runtimeClient->baseVersions);
    }

    public function testAllowlistedLibraryRuntimeErrorFallsBackToLegacy(): void
    {
        [$game, $actor] = $this->gameWithPrivateLibraryCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([], [], fail: true);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('library.draw', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'library.draw', runtime: true, shadow: false),
            expectedBeginTransactions: 2,
            expectedLocks: 2,
            expectedRollbacks: 1,
            emergencyLegacyFallbackEnabled: true,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'library.draw',
            ['playerId' => $actor->id()],
            'action-runtime-fallback',
            1,
            'message-runtime-fallback',
        );

        self::assertContains($result->messageForUserId($actor->id())['kind'], ['game_patch', 'resync_required']);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_fallback_count'] ?? 0);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_error_count'] ?? 0);
        self::assertSame('runtime_gateway_error', $metricsStore->records()[0]['gameplay.runtime_fallback_reason'] ?? null);
    }

    public function testAllowlistedLibraryPatchContractErrorFallsBackToLegacy(): void
    {
        [$game, $actor] = $this->gameWithPrivateLibraryCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'visibility' => 'player:'.$actor->id(),
            'ops' => [['op' => 'zone.cards.add', 'data' => ['playerId' => $actor->id(), 'zone' => 'hand', 'cards' => []]]],
        ]]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('library.draw', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'library.draw', runtime: true, shadow: false),
            expectedBeginTransactions: 2,
            expectedLocks: 2,
            expectedRollbacks: 1,
            emergencyLegacyFallbackEnabled: true,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'library.draw',
            ['playerId' => $actor->id()],
            'action-runtime-contract-fallback',
            1,
            'message-runtime-contract-fallback',
        );

        self::assertContains($result->messageForUserId($actor->id())['kind'], ['game_patch', 'resync_required']);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_patch_contract_error'] ?? 0);
        self::assertSame('runtime_patch_contract_error', $metricsStore->records()[0]['gameplay.runtime_fallback_reason'] ?? null);
    }

    public function testAllowlistedLibraryShadowModeExecutesRuntimeAndKeepsLegacyResponse(): void
    {
        [$game, $actor] = $this->gameWithPrivateLibraryCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [
                ['op' => 'zone.count.set', 'data' => ['playerId' => $actor->id(), 'zone' => 'library', 'count' => 1]],
            ],
        ]]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('library.draw', runtime: false, shadow: true),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'library.draw', runtime: false, shadow: true),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'library.draw',
            ['playerId' => $actor->id()],
            'action-runtime-shadow',
            1,
            'message-runtime-shadow',
        );

        self::assertContains($result->messageForUserId($actor->id())['kind'], ['game_patch', 'resync_required']);
        self::assertSame(['library.draw'], $runtimeClient->types);
        $record = $metricsStore->records()[0] ?? [];
        self::assertSame(1, $record['gameplay.runtime_shadow_executed'] ?? 0);
        self::assertSame(0, $record['gameplay.runtime_shadow_divergence'] ?? 1);
        self::assertSame(0, $record['gameplay.runtime_shadow_error_count'] ?? 1);
    }

    public function testAllowlistedMovementCommandRoutesToRuntimePrimaryPatchV2WithoutProjectionOrSnapshotWrite(): void
    {
        [$game, $actor, $opponent] = $this->gameWithOpponent();
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['battlefield'] = [[
            'instanceId' => 'battlefield-1',
            'ownerId' => $actor->id(),
            'controllerId' => $actor->id(),
            'name' => 'Battlefield One',
            'tapped' => false,
            'zone' => 'battlefield',
        ]];
        $game->replaceSnapshot($snapshot);
        $actor->updateCardLanguage('es');
        $opponent->updateCardLanguage('en');
        $runtimeCardKey = CardStaticBundle::fromLegacyCard($snapshot['players'][$actor->id()]['zones']['battlefield'][0])->cardKey;
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [[
                'op' => 'zone.cards.batchMove',
                'data' => [
                    'moves' => [[
                        'instanceId' => 'battlefield-1',
                        'from' => ['playerId' => $actor->id(), 'zone' => 'battlefield', 'index' => 0],
                        'to' => ['playerId' => $actor->id(), 'zone' => 'graveyard', 'index' => 0],
                        'card' => ['instanceId' => 'battlefield-1', 'cardKey' => $runtimeCardKey],
                    ]],
                ],
            ]],
        ]], [
            'movement.runtime_route' => 1,
            'movement.full_scan_count' => 0,
            'movement.reindex_count' => 0,
            'movement.cards_moved_count' => 1,
            'movement.patch_bytes' => 256,
            'movement.apply_ms' => 0.4,
        ]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: false,
            expectClear: true,
            projection: $projection,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('card.moved,cards.moved,zone.move_all,zone.reorderedByIds', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'card.moved,cards.moved,zone.move_all,zone.reorderedByIds', runtime: true, shadow: false),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'card.moved',
            ['playerId' => $actor->id(), 'fromZone' => 'battlefield', 'toZone' => 'graveyard', 'instanceId' => 'battlefield-1'],
            'action-runtime-move',
            1,
            'message-runtime-move',
            'v2',
        );

        $ownerMessage = $result->messageForUserId($actor->id());
        $opponentMessage = $result->messageForUserId($opponent->id());

        self::assertSame('patch.v2', $ownerMessage['kind']);
        self::assertSame(['zone.cards.batchMove'], array_column($ownerMessage['ops'], 'op'));
        self::assertArrayHasKey('moves', $ownerMessage['ops'][0]);
        self::assertSame($runtimeCardKey, $ownerMessage['ops'][0]['moves'][0]['card']['cardKey']);
        self::assertSame($runtimeCardKey, $ownerMessage['ops'][0]['moves'][0]['card']['printId']);
        self::assertSame($ownerMessage['ops'][0]['moves'][0]['staticCard']['cardVersion'], $ownerMessage['ops'][0]['moves'][0]['card']['cardVersion']);
        self::assertSame('es', $ownerMessage['ops'][0]['moves'][0]['card']['language']);
        self::assertSame('es', $ownerMessage['ops'][0]['moves'][0]['staticCard']['language']);
        self::assertSame('public', $ownerMessage['ops'][0]['moves'][0]['card']['viewerVisibility']);
        self::assertSame('en', $opponentMessage['ops'][0]['moves'][0]['card']['language']);
        self::assertSame('en', $opponentMessage['ops'][0]['moves'][0]['staticCard']['language']);
        self::assertSame($runtimeCardKey, $ownerMessage['ops'][0]['moves'][0]['staticCard']['cardKey']);
        self::assertArrayNotHasKey('cards', $ownerMessage['ops'][0]);
        self::assertSame(['card.moved'], $runtimeClient->types);
        $record = $metricsStore->records()[0] ?? [];
        self::assertSame(1, $record['gameplay.runtime_route'] ?? 0);
        self::assertSame(0, $record['gameplay.runtime_fallback_count'] ?? 1);
        self::assertSame(0, $record['movement.full_scan_count'] ?? 1);
        self::assertSame(0, $record['movement.reindex_count'] ?? 1);
        self::assertSame(1, $record['movement.cards_moved_count'] ?? 0);
    }

    public function testRuntimePublicAddWithCardKeyIsEnrichedWithCompleteIdentity(): void
    {
        [$game, $actor, $opponent] = $this->gameWithPrivateHandCards();
        $actor->updateCardLanguage('es');
        $opponent->updateCardLanguage('en');
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['hand'][0]['scryfallId'] = '00000000-0000-7000-8000-00000000cafe';
        $snapshot['players'][$actor->id()]['zones']['hand'][0]['cardKey'] = 'scryfall:00000000-0000-7000-8000-00000000cafe:stable-print-v1';
        $snapshot['players'][$actor->id()]['zones']['hand'][0]['cardVersion'] = 'stable-print-v1';
        $snapshot['players'][$actor->id()]['zones']['hand'][0]['imageUris'] = ['normal' => 'https://cards.example/private-hand-one.jpg'];
        $snapshot['players'][$actor->id()]['zones']['hand'][0]['cardFaces'] = [
            ['name' => 'Private Hand One', 'imageUris' => ['normal' => 'https://cards.example/private-hand-one-face.jpg']],
        ];
        $game->replaceSnapshot($snapshot);
        $runtimeCardKey = $snapshot['players'][$actor->id()]['zones']['hand'][0]['cardKey'];
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [[
                'op' => 'zone.cards.add',
                'data' => [
                    'playerId' => $actor->id(),
                    'zone' => 'battlefield',
                    'cards' => [[
                        'instanceId' => 'hand-1',
                        'cardKey' => $runtimeCardKey,
                    ]],
                ],
            ]],
        ]]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: false,
            expectClear: true,
            projection: $projection,
            flagsV2: $this->runtimeFlags('card.moved', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'card.moved', runtime: true, shadow: false),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'card.moved',
            ['playerId' => $actor->id(), 'fromZone' => 'hand', 'toZone' => 'battlefield', 'instanceId' => 'hand-1'],
            'action-runtime-public-add-identity',
            1,
            'message-runtime-public-add-identity',
            'v2',
        );

        $ownerMessage = $result->messageForUserId($actor->id());
        $ownerAdd = $ownerMessage['ops'][0];
        self::assertSame('es', $ownerAdd['cards'][0]['language']);
        self::assertSame('es', $ownerAdd['staticCards'][$runtimeCardKey]['language']);

        $opponentMessage = $result->messageForUserId($opponent->id());
        $add = $opponentMessage['ops'][0];
        self::assertSame('zone.cards.add', $add['op']);
        self::assertSame($runtimeCardKey, $add['cards'][0]['cardKey']);
        self::assertSame($runtimeCardKey, $add['cards'][0]['cardRef']);
        self::assertSame($runtimeCardKey, $add['staticCards'][$runtimeCardKey]['cardKey']);
        self::assertSame($runtimeCardKey, $add['staticCards'][$runtimeCardKey]['cardRef']);
        self::assertSame('00000000-0000-7000-8000-00000000cafe', $add['staticCards'][$runtimeCardKey]['printId']);
        self::assertSame($add['staticCards'][$runtimeCardKey]['printId'], $add['cards'][0]['printId']);
        self::assertSame($add['staticCards'][$runtimeCardKey]['cardVersion'], $add['cards'][0]['cardVersion']);
        self::assertSame('en', $add['cards'][0]['language']);
        self::assertSame('en', $add['staticCards'][$runtimeCardKey]['language']);
        self::assertSame('public', $add['cards'][0]['viewerVisibility']);
        self::assertArrayHasKey($runtimeCardKey, $add['staticCards']);
        self::assertSame('https://cards.example/private-hand-one.jpg', $add['staticCards'][$runtimeCardKey]['imageUris']['normal'] ?? null);
        self::assertSame('https://cards.example/private-hand-one-face.jpg', $add['staticCards'][$runtimeCardKey]['cardFaces'][0]['imageUris']['normal'] ?? null);
        self::assertArrayNotHasKey('imageUris', $add['cards'][0]);
        self::assertStringNotContainsString('oracleText', json_encode($opponentMessage, JSON_THROW_ON_ERROR));
    }

    public function testRuntimeLivePatchUsesLocalizedStaticBundleForVisibleCard(): void
    {
        [$game, $actor, $opponent] = $this->gameWithPrivateHandCards();
        $actor->updateCardLanguage('es');
        $opponent->updateCardLanguage('en');
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['hand'][0] = [
            ...$snapshot['players'][$actor->id()]['zones']['hand'][0],
            'scryfallId' => 'source-print',
            'cardKey' => 'scryfall:source-print:stable-print-v1',
            'cardVersion' => 'stable-print-v1',
            'name' => 'Forest',
            'imageUris' => ['normal' => 'https://cards.example/forest-en.jpg'],
            'cardFaces' => [
                ['name' => 'Forest', 'imageUris' => ['normal' => 'https://cards.example/forest-en-face.jpg']],
            ],
        ];
        $game->replaceSnapshot($snapshot);
        $runtimeCardKey = $snapshot['players'][$actor->id()]['zones']['hand'][0]['cardKey'];
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [[
                'op' => 'zone.cards.add',
                'data' => [
                    'playerId' => $actor->id(),
                    'zone' => 'battlefield',
                    'cards' => [[
                        'instanceId' => 'hand-1',
                        'cardKey' => $runtimeCardKey,
                    ]],
                ],
            ]],
        ]]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: false,
            expectClear: true,
            projection: $projection,
            resolver: $this->localizedRuntimeResolver(),
            flagsV2: $this->runtimeFlags('card.moved', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'card.moved', runtime: true, shadow: false),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'card.moved',
            ['playerId' => $actor->id(), 'fromZone' => 'hand', 'toZone' => 'battlefield', 'instanceId' => 'hand-1'],
            'action-runtime-public-add-localized-image',
            1,
            'message-runtime-public-add-localized-image',
            'v2',
        );

        $ownerAdd = $result->messageForUserId($actor->id())['ops'][0];
        $opponentAdd = $result->messageForUserId($opponent->id())['ops'][0];
        self::assertSame('es', $ownerAdd['cards'][0]['language']);
        self::assertSame('es', $ownerAdd['staticCards'][$runtimeCardKey]['language']);
        self::assertSame('https://cards.example/forest-es.jpg', $ownerAdd['staticCards'][$runtimeCardKey]['imageUris']['normal'] ?? null);
        self::assertSame('https://cards.example/forest-es-face.jpg', $ownerAdd['staticCards'][$runtimeCardKey]['cardFaces'][0]['imageUris']['normal'] ?? null);
        self::assertSame($ownerAdd['staticCards'][$runtimeCardKey]['printId'], $ownerAdd['cards'][0]['printId']);
        self::assertSame($ownerAdd['staticCards'][$runtimeCardKey]['cardVersion'], $ownerAdd['cards'][0]['cardVersion']);
        self::assertSame('en', $opponentAdd['cards'][0]['language']);
        self::assertSame('https://cards.example/forest-en.jpg', $opponentAdd['staticCards'][$runtimeCardKey]['imageUris']['normal'] ?? null);

        $bootstrapSnapshot = $game->snapshot();
        $bootstrapSnapshot['players'][$actor->id()]['zones']['hand'] = [];
        $bootstrapSnapshot['players'][$actor->id()]['zones']['battlefield'] = [[
            ...$snapshot['players'][$actor->id()]['zones']['hand'][0],
            'zone' => 'battlefield',
            'language' => 'es',
            'imageUris' => ['normal' => 'https://cards.example/forest-es.jpg'],
            'cardFaces' => [
                ['name' => 'Forest', 'imageUris' => ['normal' => 'https://cards.example/forest-es-face.jpg']],
            ],
        ]];
        $bootstrap = (new GameplayV2ContractFactory())->bootstrap($game, $actor, $bootstrapSnapshot)->toArray();
        $bootstrapStatic = $bootstrap['staticCards'][$runtimeCardKey];
        self::assertSame($bootstrapStatic['printId'], $ownerAdd['staticCards'][$runtimeCardKey]['printId']);
        self::assertSame($bootstrapStatic['cardVersion'], $ownerAdd['staticCards'][$runtimeCardKey]['cardVersion']);
        self::assertSame($bootstrapStatic['language'], $ownerAdd['staticCards'][$runtimeCardKey]['language']);
        self::assertSame($bootstrapStatic['imageUris']['normal'], $ownerAdd['staticCards'][$runtimeCardKey]['imageUris']['normal']);
        self::assertStringNotContainsString('oracleText', json_encode($ownerAdd, JSON_THROW_ON_ERROR));
        self::assertArrayNotHasKey('imageUris', $ownerAdd['cards'][0]);
    }

    public function testRuntimeLocalizationResolverDoesNotFallBackToEnglishWhenLocalizedPrintExists(): void
    {
        $lookup = $this->localizedRuntimeResolver()->buildLocalizedLookupForScryfallIds(['source-print'], ['es']);

        self::assertSame('https://cards.example/forest-es.jpg', $lookup['es']['source-print']['imageUris']['normal'] ?? null);
        self::assertNotSame('https://cards.example/forest-en.jpg', $lookup['es']['source-print']['imageUris']['normal'] ?? null);
    }

    public function testAllowlistedMovementRuntimeErrorFallsBackToLegacy(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([], [], fail: true);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('card.moved', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'card.moved', runtime: true, shadow: false),
            expectedBeginTransactions: 2,
            expectedLocks: 2,
            expectedRollbacks: 1,
            emergencyLegacyFallbackEnabled: true,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'card.moved',
            ['playerId' => $actor->id(), 'fromZone' => 'battlefield', 'toZone' => 'graveyard', 'instanceId' => 'battlefield-1'],
            'action-runtime-move-fallback',
            1,
            'message-runtime-move-fallback',
        );

        self::assertContains($result->messageForUserId($actor->id())['kind'], ['game_patch', 'resync_required']);
        self::assertSame(['card.moved'], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_fallback_count'] ?? 0);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_error_count'] ?? 0);
    }

    public function testAllowlistedMovementShadowModeExecutesRuntimeAndKeepsLegacyResponse(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [
                ['op' => 'zone.count.set', 'data' => ['playerId' => $actor->id(), 'zone' => 'graveyard', 'count' => 1]],
            ],
        ]]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('card.moved', runtime: false, shadow: true),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'card.moved', runtime: false, shadow: true),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'card.moved',
            ['playerId' => $actor->id(), 'fromZone' => 'battlefield', 'toZone' => 'graveyard', 'instanceId' => 'battlefield-1'],
            'action-runtime-move-shadow',
            1,
            'message-runtime-move-shadow',
        );

        self::assertContains($result->messageForUserId($actor->id())['kind'], ['game_patch', 'resync_required']);
        self::assertSame(['card.moved'], $runtimeClient->types);
        $record = $metricsStore->records()[0] ?? [];
        self::assertSame(1, $record['gameplay.runtime_shadow_executed'] ?? 0);
        self::assertSame(0, $record['gameplay.runtime_shadow_divergence'] ?? 1);
    }

    public function testAllowlistedCardsMovedShadowModeExecutesRuntimeAndKeepsLegacyResponse(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [
                ['op' => 'zone.count.set', 'data' => ['playerId' => $actor->id(), 'zone' => 'graveyard', 'count' => 2]],
            ],
        ]]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('cards.moved', runtime: false, shadow: true),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'cards.moved', runtime: false, shadow: true),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'cards.moved',
            ['playerId' => $actor->id(), 'fromZone' => 'battlefield', 'toZone' => 'graveyard', 'instanceIds' => ['battlefield-1', 'battlefield-2']],
            'action-runtime-cards-moved-shadow',
            1,
            'message-runtime-cards-moved-shadow',
        );

        self::assertContains($result->messageForUserId($actor->id())['kind'], ['game_patch', 'resync_required']);
        self::assertSame(['cards.moved'], $runtimeClient->types);
        $record = $metricsStore->records()[0] ?? [];
        self::assertSame(1, $record['gameplay.runtime_shadow_executed'] ?? 0);
        self::assertSame(0, $record['gameplay.runtime_shadow_divergence'] ?? 1);
    }

    public function testAllowlistedZoneMoveAllShadowModeExecutesRuntimeAndKeepsLegacyResponse(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [
                ['op' => 'zone.count.set', 'data' => ['playerId' => $actor->id(), 'zone' => 'graveyard', 'count' => 2]],
            ],
        ]]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('zone.move_all', runtime: false, shadow: true),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'zone.move_all', runtime: false, shadow: true),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'zone.move_all',
            ['playerId' => $actor->id(), 'fromZone' => 'battlefield', 'toZone' => 'graveyard'],
            'action-runtime-zone-move-all-shadow',
            1,
            'message-runtime-zone-move-all-shadow',
        );

        self::assertSame('game_patch', $result->messageForUserId($actor->id())['kind']);
        self::assertSame(['zone.move_all'], $runtimeClient->types);
        $record = $metricsStore->records()[0] ?? [];
        self::assertSame(1, $record['gameplay.runtime_shadow_executed'] ?? 0);
        self::assertSame(0, $record['gameplay.runtime_shadow_divergence'] ?? 1);
    }

    public function testAllowlistedZoneChangedRoutesToRuntimeReorderedAlias(): void
    {
        [$game, $actor, $opponent] = $this->gameWithOpponent();
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['battlefield'] = [
            [
                'instanceId' => 'battlefield-1',
                'ownerId' => $actor->id(),
                'controllerId' => $actor->id(),
                'name' => 'Battlefield One',
                'zone' => 'battlefield',
            ],
            [
                'instanceId' => 'battlefield-2',
                'ownerId' => $actor->id(),
                'controllerId' => $actor->id(),
                'name' => 'Battlefield Two',
                'zone' => 'battlefield',
            ],
        ];
        $game->replaceSnapshot($snapshot);
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [[
                'op' => 'zone.reordered',
                'data' => [
                    'playerId' => $actor->id(),
                    'zone' => 'battlefield',
                    'instanceIds' => ['battlefield-2', 'battlefield-1'],
                ],
            ]],
        ]], [
            'movement.runtime_route' => 1,
            'movement.full_scan_count' => 0,
            'movement.reindex_count' => 0,
            'movement.cards_moved_count' => 2,
            'movement.patch_bytes' => 192,
            'movement.apply_ms' => 0.3,
        ]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: false,
            expectClear: true,
            projection: $projection,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('zone.reorderedByIds', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'zone.reorderedByIds', runtime: true, shadow: false),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'zone.changed',
            ['playerId' => $actor->id(), 'zone' => 'battlefield', 'instanceIds' => ['battlefield-2', 'battlefield-1']],
            'action-runtime-zone-reorder',
            1,
            'message-runtime-zone-reorder',
            'v2',
        );

        $ownerMessage = $result->messageForUserId($actor->id());
        $opponentMessage = $result->messageForUserId($opponent->id());
        self::assertSame('patch.v2', $ownerMessage['kind']);
        self::assertSame(['zone.reordered'], array_column($ownerMessage['ops'], 'op'));
        self::assertSame($ownerMessage['ops'], $opponentMessage['ops']);
        self::assertSame(['zone.reorderedByIds'], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_route'] ?? 0);
    }

    public function testAllowlistedZoneChangedRuntimeRejectsCardsPayloadObjects(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: false,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('zone.reorderedByIds', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'zone.reorderedByIds', runtime: true, shadow: false),
        );

        $message = $service->apply(
            $game->id(),
            $actor->id(),
            'zone.changed',
            [
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'cards' => [
                    ['instanceId' => 'battlefield-2'],
                    ['instanceId' => 'battlefield-1'],
                ],
            ],
            'action-runtime-zone-reorder-invalid',
            1,
            'message-runtime-zone-reorder-invalid',
        );

        self::assertSame('command_ack', $message['kind']);
        self::assertSame('rejected', $message['status']);
        self::assertSame('INVALID_COMMAND_MESSAGE', $message['error']['code']);
        self::assertSame([], $runtimeClient->types);
        self::assertSame('invalid_runtime_payload', $metricsStore->records()[0]['status'] ?? null);
    }

    public function testAllowlistedZoneChangedShadowModeNormalizesRuntimeAliasWithoutDivergence(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [[
                'op' => 'zone.reordered',
                'data' => [
                    'playerId' => $actor->id(),
                    'zone' => 'battlefield',
                    'instanceIds' => ['battlefield-2', 'battlefield-1'],
                ],
            ]],
        ]], [
            'movement.runtime_route' => 1,
            'movement.full_scan_count' => 0,
            'movement.reindex_count' => 0,
        ], eventType: 'zone.reorderedByIds');
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('zone.reorderedByIds', runtime: false, shadow: true),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'zone.reorderedByIds', runtime: false, shadow: true),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'zone.changed',
            ['playerId' => $actor->id(), 'zone' => 'battlefield', 'instanceIds' => ['battlefield-2', 'battlefield-1']],
            'action-runtime-zone-reorder-shadow',
            1,
            'message-runtime-zone-reorder-shadow',
        );

        self::assertSame('game_patch', $result->messageForUserId($actor->id())['kind']);
        self::assertSame(['zone.reorderedByIds'], $runtimeClient->types);
        $record = $metricsStore->records()[0] ?? [];
        self::assertSame(1, $record['gameplay.runtime_shadow_executed'] ?? 0);
        self::assertSame(0, $record['gameplay.runtime_shadow_divergence'] ?? 1);
    }

    public function testAllowlistedMovementPatchContractErrorFallsBackToLegacy(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'visibility' => 'public',
            'ops' => [['op' => 'zone.cards.batchMove', 'data' => ['moves' => []]]],
        ]]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('card.moved', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'card.moved', runtime: true, shadow: false),
            expectedBeginTransactions: 2,
            expectedLocks: 2,
            expectedRollbacks: 1,
            emergencyLegacyFallbackEnabled: true,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'card.moved',
            ['playerId' => $actor->id(), 'fromZone' => 'battlefield', 'toZone' => 'graveyard', 'instanceId' => 'battlefield-1'],
            'action-runtime-move-contract-fallback',
            1,
            'message-runtime-move-contract-fallback',
        );

        self::assertSame('game_patch', $result->messageForUserId($actor->id())['kind']);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_patch_contract_error'] ?? 0);
    }

    public function testAllowlistedCardTappedRoutesRuntimePrimaryWithBattlefieldMetrics(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [[
                'op' => 'card.field.set',
                'data' => [
                    'playerId' => $actor->id(),
                    'zone' => 'battlefield',
                    'instanceId' => 'battlefield-1',
                    'tapped' => true,
                    'rotation' => 90,
                ],
            ]],
        ]], [
            'battlefield.runtime_route' => 1,
            'battlefield.full_scan_count' => 0,
            'battlefield.patch_bytes' => 128,
            'battlefield.apply_ms' => 0.4,
        ]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: false,
            expectClear: true,
            projection: $projection,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('card.tapped', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'card.tapped', runtime: true, shadow: false),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'card.tapped',
            ['playerId' => $actor->id(), 'zone' => 'battlefield', 'instanceId' => 'battlefield-1', 'tapped' => true],
            'action-runtime-tap',
            1,
            'message-runtime-tap',
            'v2',
        );

        $message = $result->messageForUserId($actor->id());
        self::assertSame('patch.v2', $message['kind']);
        self::assertSame('card.field.set', $message['ops'][0]['op']);
        self::assertSame(true, $message['ops'][0]['tapped']);
        self::assertSame(['card.tapped'], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_route'] ?? 0);
        self::assertSame(0, $metricsStore->records()[0]['battlefield.full_scan_count'] ?? 1);
    }

    public function testAllowlistedLifeChangedRoutesRuntimePrimary(): void
    {
        [$game, $actor] = $this->game();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [[
                'op' => 'player.life.set',
                'data' => [
                    'playerId' => $actor->id(),
                    'value' => 37,
                ],
            ]],
        ]], [
            'simple.runtime_route' => 1,
            'simple.patch_bytes' => 72,
            'simple.apply_ms' => 0.1,
        ]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: false,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('life.changed', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'life.changed', runtime: true, shadow: false),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'life.changed',
            ['playerId' => $actor->id(), 'life' => 37],
            'action-runtime-life',
            1,
            'message-runtime-life',
            'v2',
        );

        $message = $result->messageForUserId($actor->id());
        self::assertSame('patch.v2', $message['kind']);
        self::assertSame('player.life.set', $message['ops'][0]['op']);
        self::assertSame(['life.changed'], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_route'] ?? 0);
    }

    public function testAllowlistedGameConcedeRoutesRuntimePrimaryWithoutSnapshotWrite(): void
    {
        [$game, $actor] = $this->game();
        $snapshot = $game->snapshot();
        $snapshot['version'] = 3;
        $game->replaceSnapshot($snapshot);
        $snapshotBefore = $game->snapshot();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [[
                'op' => 'player.status.set',
                'data' => [
                    'playerId' => $actor->id(),
                    'status' => 'conceded',
                    'concededAt' => '2026-01-01T00:00:05+00:00',
                ],
            ]],
        ]], [
            'lifecycle.runtime_route' => 1,
            'lifecycle.snapshot_write_count' => 0,
            'lifecycle.patch_bytes' => 96,
            'lifecycle.apply_ms' => 0.1,
        ]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: false,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('game.concede', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'game.concede', runtime: true, shadow: false),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'game.concede',
            [],
            'action-runtime-concede',
            1,
            'message-runtime-concede',
            'v2',
        );

        $message = $result->messageForUserId($actor->id());
        self::assertSame('patch.v2', $message['kind']);
        self::assertSame('player.status.set', $message['ops'][0]['op']);
        self::assertSame($snapshotBefore, $game->snapshot());
        self::assertSame(['game.concede'], $runtimeClient->types);
        self::assertSame($actor->id(), $runtimeClient->payloads[0]['playerId'] ?? null);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_route'] ?? 0);
        self::assertSame(0, $metricsStore->records()[0]['lifecycle.snapshot_write_count'] ?? 1);
    }

    public function testRuntimeGameConcedeRejectsAlreadyConcededPlayerFromLifecycleEvents(): void
    {
        [$game, $actor] = $this->game();
        $concededEvent = new GameEvent(
            $game,
            'game.concede',
            ['playerId' => $actor->id()],
            $actor,
            'action-runtime-concede-original',
            2,
        );
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: false,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('game.concede', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'game.concede', runtime: true, shadow: false),
            lifecycleEvents: [$concededEvent],
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'game.concede',
            [],
            'action-runtime-concede-duplicate',
            2,
            'message-runtime-concede-duplicate',
            'v2',
        );

        $message = is_array($result) ? $result : $result->messageForUserId($actor->id());
        self::assertSame('command_ack', $message['kind']);
        self::assertSame('rejected', $message['status']);
        self::assertSame('INVALID_COMMAND_MESSAGE', $message['error']['code'] ?? null);
        self::assertStringContainsString('already conceded', (string) ($message['error']['message'] ?? ''));
        self::assertSame([], $runtimeClient->types);
        self::assertSame('invalid_runtime_lifecycle_transition', $metricsStore->records()[0]['status'] ?? null);
    }

    public function testAllowlistedGameCloseRoutesRuntimePrimaryAndPersistsLifecycleStatusOnly(): void
    {
        [$game, $actor] = $this->game();
        $snapshotBefore = $game->snapshot();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [[
                'op' => 'game.status.set',
                'data' => [
                    'status' => 'finished',
                    'phase' => 'FINISHED',
                ],
            ]],
        ]], [
            'lifecycle.runtime_route' => 1,
            'lifecycle.snapshot_write_count' => 0,
            'lifecycle.patch_bytes' => 80,
            'lifecycle.apply_ms' => 0.1,
        ]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: true,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('game.close', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'game.close', runtime: true, shadow: false),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'game.close',
            [],
            'action-runtime-close',
            1,
            'message-runtime-close',
            'v2',
        );

        $message = $result->messageForUserId($actor->id());
        self::assertSame('patch.v2', $message['kind']);
        self::assertSame('game.status.set', $message['ops'][0]['op']);
        self::assertSame($snapshotBefore, $game->snapshot());
        self::assertSame(Game::STATUS_FINISHED, $game->status());
        self::assertSame(['game.close'], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_route'] ?? 0);
        self::assertSame(0, $metricsStore->records()[0]['lifecycle.snapshot_write_count'] ?? 1);
    }

    public function testRuntimeFinalGameConcedeRequiresTicketPlayer(): void
    {
        [$game, $actor, $opponent] = $this->gameWithPrivateLibraryCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [],
        ]]);
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::never())->method('getManagerForClass');
        $service = $this->serviceWithRegistry(
            $registry,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('game.concede', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'game.concede', runtime: true, shadow: false),
            rooms: $this->runtimeRoomsFor($game),
        );

        $message = $service->apply(
            $game->id(),
            $actor->id(),
            'game.concede',
            ['playerId' => $opponent->id()],
            'action-runtime-concede-other-denied',
            1,
            'message-runtime-concede-other-denied',
            'v2',
            ticketPlayerId: $actor->id(),
            ticketPermissions: ['view', 'command'],
        );

        self::assertIsArray($message);
        self::assertSame('command_ack', $message['kind']);
        self::assertSame('rejected', $message['status']);
        self::assertSame('INVALID_COMMAND_MESSAGE', $message['error']['code'] ?? null);
        self::assertSame('Players can only concede themselves.', $message['error']['message'] ?? null);
        self::assertSame([], $runtimeClient->types);
        self::assertSame('invalid_runtime_payload', $metricsStore->records()[0]['status'] ?? null);
    }

    public function testRuntimeFinalGameCloseRequiresSignedClosePermission(): void
    {
        [$game, $actor] = $this->game();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [[
                'op' => 'game.status.set',
                'data' => [
                    'status' => 'finished',
                    'phase' => 'FINISHED',
                ],
            ]],
        ]]);
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::never())->method('getManagerForClass');
        $service = $this->serviceWithRegistry(
            $registry,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('game.close', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'game.close', runtime: true, shadow: false),
        );

        $message = $service->apply(
            $game->id(),
            $actor->id(),
            'game.close',
            [],
            'action-runtime-close-denied',
            1,
            'message-runtime-close-denied',
            'v2',
            ticketPlayerId: $actor->id(),
            ticketPermissions: ['view', 'command'],
        );

        self::assertIsArray($message);
        self::assertSame('command_ack', $message['kind']);
        self::assertSame('rejected', $message['status']);
        self::assertSame('GAME_ACCESS_DENIED', $message['error']['code'] ?? null);
        self::assertSame('Only the room owner can close the game.', $message['error']['message'] ?? null);
        self::assertSame(Game::STATUS_ACTIVE, $game->status());
        self::assertSame([], $runtimeClient->types);
        self::assertSame('runtime_permission_denied', $metricsStore->records()[0]['status'] ?? null);
    }

    public function testAllowlistedCardTappedRuntimeErrorFallsBackToLegacy(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([], [], fail: true);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('card.tapped', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'card.tapped', runtime: true, shadow: false),
            expectedBeginTransactions: 2,
            expectedLocks: 2,
            expectedRollbacks: 1,
            emergencyLegacyFallbackEnabled: true,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'card.tapped',
            ['playerId' => $actor->id(), 'zone' => 'battlefield', 'instanceId' => 'battlefield-1', 'tapped' => true],
            'action-runtime-tap-fallback',
            1,
            'message-runtime-tap-fallback',
        );

        self::assertSame('game_patch', $result->messageForUserId($actor->id())['kind']);
        self::assertSame(['card.tapped'], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_fallback_count'] ?? 0);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_error_count'] ?? 0);
    }

    public function testAllowlistedCounterChangedShadowModeExecutesRuntimeAndKeepsLegacyResponse(): void
    {
        [$game, $actor] = $this->game();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [[
                'op' => 'player.counters.set',
                'data' => [
                    'playerId' => $actor->id(),
                    'counters' => ['poison' => 2],
                ],
            ]],
        ]], [
            'counters.runtime_route' => 1,
            'counters.full_scan_count' => 0,
            'counters.patch_bytes' => 96,
            'counters.apply_ms' => 0.2,
        ]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('counter.changed', runtime: false, shadow: true),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'counter.changed', runtime: false, shadow: true),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'counter.changed',
            ['scope' => 'player:'.$actor->id(), 'key' => 'poison', 'value' => 2],
            'action-runtime-counter-shadow',
            1,
            'message-runtime-counter-shadow',
        );

        self::assertSame('game_patch', $result->messageForUserId($actor->id())['kind']);
        self::assertSame(['counter.changed'], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_shadow_executed'] ?? 0);
        self::assertSame(0, $metricsStore->records()[0]['gameplay.runtime_shadow_divergence'] ?? 1);
    }

    public function testAllowlistedCommanderDamageRoutesRuntimePrimary(): void
    {
        [$game, $actor, $opponent] = $this->gameWithOpponent();
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [[
                'op' => 'player.commanderDamage.set',
                'data' => [
                    'playerId' => $actor->id(),
                    'commanderDamage' => ['commander-2' => 11],
                ],
            ]],
        ]], [
            'counters.runtime_route' => 1,
            'counters.full_scan_count' => 0,
        ]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: false,
            expectClear: true,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags('commander.damage.changed', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'commander.damage.changed', runtime: true, shadow: false),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'commander.damage.changed',
            ['targetPlayerId' => $actor->id(), 'sourcePlayerId' => $opponent->id(), 'commanderInstanceId' => 'commander-2', 'damage' => 11],
            'action-runtime-commander-damage',
            1,
            'message-runtime-commander-damage',
            'v2',
        );

        $message = $result->messageForUserId($actor->id());
        self::assertSame('patch.v2', $message['kind']);
        self::assertSame('player.commanderDamage.set', $message['ops'][0]['op']);
        self::assertSame($actor->id(), $message['ops'][0]['playerId']);
        self::assertSame(['commander.damage.changed'], $runtimeClient->types);
    }

    #[DataProvider('battlefieldCountersSimpleRuntimeCommands')]
    public function testAllowlistedBattlefieldCountersSimpleRuntimeErrorFallsBackToLegacy(string $commandType): void
    {
        [$game, $actor] = $this->gameForRuntimeCommand($commandType);
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([], [], fail: true);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            actor: $actor,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags($commandType, runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, $commandType, runtime: true, shadow: false),
            expectedBeginTransactions: 2,
            expectedLocks: 2,
            expectedRollbacks: 1,
            emergencyLegacyFallbackEnabled: true,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            $commandType,
            $this->payloadForRuntimeCommand($commandType, $actor, $game),
            'action-runtime-fallback-'.$commandType,
            1,
            'message-runtime-fallback-'.$commandType,
        );

        self::assertContains($result->messageForUserId($actor->id())['kind'], ['game_patch', 'resync_required']);
        self::assertSame([$commandType], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_fallback_count'] ?? 0);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_error_count'] ?? 0);
    }

    #[DataProvider('battlefieldCountersSimpleRuntimeCommands')]
    public function testAllowlistedBattlefieldCountersSimplePatchContractErrorFallsBackToLegacy(string $commandType): void
    {
        [$game, $actor] = $this->gameForRuntimeCommand($commandType);
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [],
        ]]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            actor: $actor,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags($commandType, runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, $commandType, runtime: true, shadow: false),
            expectedBeginTransactions: 2,
            expectedLocks: 2,
            expectedRollbacks: 1,
            emergencyLegacyFallbackEnabled: true,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            $commandType,
            $this->payloadForRuntimeCommand($commandType, $actor, $game),
            'action-runtime-contract-'.$commandType,
            1,
            'message-runtime-contract-'.$commandType,
        );

        self::assertSame('game_patch', $result->messageForUserId($actor->id())['kind']);
        self::assertSame([$commandType], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_fallback_count'] ?? 0);
        self::assertSame(0, $metricsStore->records()[0]['gameplay.runtime_error_count'] ?? 1);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_patch_contract_error'] ?? 0);
    }

    #[DataProvider('battlefieldCountersSimpleShadowCommands')]
    public function testAllowlistedBattlefieldCountersSimpleShadowModeExecutesRuntimeAndKeepsLegacyResponse(string $commandType): void
    {
        [$game, $actor] = $this->gameForRuntimeCommand($commandType);
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [[
                'op' => 'player.life.set',
                'data' => [
                    'playerId' => $actor->id(),
                    'value' => 39,
                ],
            ]],
        ]], [
            'simple.runtime_route' => 1,
        ]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            actor: $actor,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags($commandType, runtime: false, shadow: true),
            runtimeGateway: $this->runtimeGateway($runtimeClient, $commandType, runtime: false, shadow: true),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            $commandType,
            $this->payloadForRuntimeCommand($commandType, $actor, $game),
            'action-runtime-shadow-'.$commandType,
            1,
            'message-runtime-shadow-'.$commandType,
        );

        self::assertSame('game_patch', $result->messageForUserId($actor->id())['kind']);
        self::assertSame([$commandType], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_shadow_executed'] ?? 0);
        self::assertSame(0, $metricsStore->records()[0]['gameplay.runtime_shadow_divergence'] ?? 1);
    }

    #[DataProvider('migratedSensitiveRuntimeCommands')]
    public function testMigratedSensitiveCommandsRouteToRuntimePatchV2WhenAllowlisted(string $commandType): void
    {
        [$game, $actor] = $this->gameForSensitiveCommand($commandType);
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [[
                'op' => $commandType === 'library.play_top_revealed' ? 'library.play_top_revealed.set' : 'card.field.set',
                'data' => $commandType === 'library.play_top_revealed'
                    ? ['playerId' => $actor->id(), 'enabled' => true]
                    : ['instanceId' => 'battlefield-1', 'playerId' => $actor->id(), 'zone' => 'battlefield', 'hidden' => true],
            ]],
        ]], ['sensitive.runtime_route' => 1]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: false,
            expectClear: true,
            flagsV2: $this->runtimeFlags($commandType, runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, $commandType, runtime: true, shadow: false),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            $commandType,
            $this->payloadForSensitiveCommand($commandType, $actor, $game),
            'action-sensitive-runtime-'.$commandType,
            1,
            'message-sensitive-runtime-'.$commandType,
        );

        self::assertSame('patch.v2', $result->messageForUserId($actor->id())['kind']);
        self::assertSame([$commandType], $runtimeClient->types);
    }

    #[DataProvider('stackRelationsHelpersRuntimeCommands')]
    public function testAllowlistedStackRelationsHelpersRouteToRuntimePrimaryPatchV2(string $commandType): void
    {
        [$game, $actor] = $this->gameForRuntimeCommand($commandType);
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([$this->runtimePatchForStackRelationCommand($game, $commandType)], [
            str_starts_with($commandType, 'stack.') ? 'stack.runtime_route' : 'relations.runtime_route' => 1,
            str_starts_with($commandType, 'stack.') ? 'stack.patch_bytes' : 'relations.patch_bytes' => 128,
            str_starts_with($commandType, 'stack.') ? 'stack.apply_ms' : 'relations.apply_ms' => 0.1,
        ]);
        $runtimePersistedEvent = $commandType === 'card.token.created'
            ? new GameEvent($game, 'card.token.created', [
                'playerId' => $actor->id(),
                'instanceIds' => ['runtime-token'],
                'cardKey' => 'runtime-token:token',
                'name' => 'Runtime Goblin',
                'tokens' => [[
                    'instanceId' => 'runtime-token',
                    'ownerId' => $actor->id(),
                    'controllerId' => $actor->id(),
                    'name' => 'Runtime Goblin',
                    'cardKey' => 'runtime-token:token',
                    'isToken' => true,
                ]],
            ], $actor, 'action-runtime-'.$commandType, 2)
            : null;
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: $runtimePersistedEvent instanceof GameEvent,
            expectClear: true,
            actor: $actor,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags($commandType, runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, $commandType, runtime: true, shadow: false),
            runtimePersistedEvent: $runtimePersistedEvent,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            $commandType,
            $this->payloadForRuntimeCommand($commandType, $actor, $game),
            'action-runtime-'.$commandType,
            1,
            'message-runtime-'.$commandType,
            'v2',
        );

        self::assertSame('patch.v2', $result->messageForUserId($actor->id())['kind']);
        if ($commandType === 'card.token.created') {
            $add = $result->messageForUserId($actor->id())['ops'][0];
            self::assertSame('zone.cards.add', $add['op']);
            self::assertArrayHasKey('runtime-token:token', $add['staticCards']);
            self::assertSame('Runtime Goblin', $add['staticCards']['runtime-token:token']['name']);
            self::assertSame('runtime-token', $add['staticCards']['runtime-token:token']['printId']);
            self::assertNotSame('runtime-identity-v1', $add['staticCards']['runtime-token:token']['cardVersion']);
            self::assertSame('en', $add['staticCards']['runtime-token:token']['language']);
            self::assertSame('public', $add['staticCards']['runtime-token:token']['viewerVisibility']);
            self::assertSame('https://example.test/token.jpg', $add['staticCards']['runtime-token:token']['imageUris']['normal'] ?? null);
            self::assertSame($add['staticCards']['runtime-token:token']['printId'], $add['cards'][0]['printId']);
            self::assertSame($add['staticCards']['runtime-token:token']['cardVersion'], $add['cards'][0]['cardVersion']);
            self::assertArrayNotHasKey('imageUris', $add['cards'][0]);
            self::assertArrayNotHasKey('oracleText', $add['cards'][0]);
            self::assertArrayNotHasKey('cardFaces', $add['cards'][0]);
            self::assertStringNotContainsString('oracleText', json_encode($add, JSON_THROW_ON_ERROR));
            self::assertSame(
                'https://example.test/token.jpg',
                $runtimePersistedEvent?->payload()['staticCards']['runtime-token:token']['imageUris']['normal'] ?? null,
            );
            self::assertStringNotContainsString('oracleText', json_encode($runtimePersistedEvent?->payload(), JSON_THROW_ON_ERROR));
        }
        if ($commandType === 'card.token_copy.created') {
            $add = $result->messageForUserId($actor->id())['ops'][0];
            self::assertSame('zone.cards.add', $add['op']);
            self::assertArrayHasKey('runtime-token:token', $add['staticCards']);
            self::assertSame('Runtime Token', $add['staticCards']['runtime-token:token']['name']);
            self::assertSame('runtime-token:token', $add['staticCards']['runtime-token:token']['printId']);
            self::assertSame('runtime-identity-v1', $add['staticCards']['runtime-token:token']['cardVersion']);
            self::assertSame('en', $add['staticCards']['runtime-token:token']['language']);
            self::assertSame('public', $add['staticCards']['runtime-token:token']['viewerVisibility']);
            self::assertSame($add['staticCards']['runtime-token:token']['printId'], $add['cards'][0]['printId']);
            self::assertSame($add['staticCards']['runtime-token:token']['cardVersion'], $add['cards'][0]['cardVersion']);
            self::assertArrayNotHasKey('imageUris', $add['cards'][0]);
            self::assertArrayNotHasKey('oracleText', $add['cards'][0]);
            self::assertArrayNotHasKey('cardFaces', $add['cards'][0]);
        }
        self::assertSame([$commandType], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_route'] ?? 0);
        self::assertSame(0, $metricsStore->records()[0]['gameplay.runtime_fallback_count'] ?? 1);
    }

    public function testNonAllowlistedStackRelationCommandStaysLegacy(): void
    {
        [$game, $actor] = $this->gameForRuntimeCommand('arrow.created');
        $runtimeClient = new CommandPatchRuntimeClientStub([$this->runtimePatchForStackRelationCommand($game, 'arrow.created')]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            actor: $actor,
            flagsV2: $this->runtimeFlags('stack.card_added', runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, 'stack.card_added', runtime: true, shadow: false),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'arrow.created',
            $this->payloadForRuntimeCommand('arrow.created', $actor, $game),
            'action-stack-relation-legacy',
            1,
            'message-stack-relation-legacy',
        );

        self::assertSame('game_patch', $result->messageForUserId($actor->id())['kind']);
        self::assertSame([], $runtimeClient->types);
    }

    #[DataProvider('stackRelationsHelpersRuntimeCommands')]
    public function testAllowlistedStackRelationsHelpersRuntimeErrorFallsBackToLegacy(string $commandType): void
    {
        [$game, $actor] = $this->gameForRuntimeCommand($commandType);
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([], [], fail: true);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            actor: $actor,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags($commandType, runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, $commandType, runtime: true, shadow: false),
            expectedBeginTransactions: 2,
            expectedLocks: 2,
            expectedRollbacks: 1,
            emergencyLegacyFallbackEnabled: true,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            $commandType,
            $this->payloadForRuntimeCommand($commandType, $actor, $game),
            'action-runtime-fallback-'.$commandType,
            1,
            'message-runtime-fallback-'.$commandType,
        );

        self::assertContains($result->messageForUserId($actor->id())['kind'], ['game_patch', 'resync_required']);
        self::assertSame([$commandType], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_fallback_count'] ?? 0);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_error_count'] ?? 0);
    }

    #[DataProvider('stackRelationsHelpersRuntimeCommands')]
    public function testAllowlistedStackRelationsHelpersPatchContractErrorFallsBackToLegacy(string $commandType): void
    {
        [$game, $actor] = $this->gameForRuntimeCommand($commandType);
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [],
        ]]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            actor: $actor,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags($commandType, runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, $commandType, runtime: true, shadow: false),
            expectedBeginTransactions: 2,
            expectedLocks: 2,
            expectedRollbacks: 1,
            emergencyLegacyFallbackEnabled: true,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            $commandType,
            $this->payloadForRuntimeCommand($commandType, $actor, $game),
            'action-runtime-contract-'.$commandType,
            1,
            'message-runtime-contract-'.$commandType,
        );

        self::assertContains($result->messageForUserId($actor->id())['kind'], ['game_patch', 'resync_required']);
        self::assertSame([$commandType], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_fallback_count'] ?? 0);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_patch_contract_error'] ?? 0);
    }

    #[DataProvider('stackRelationsHelpersShadowCommands')]
    public function testAllowlistedStackRelationsHelpersShadowModeExecutesRuntimeAndKeepsLegacyResponse(string $commandType): void
    {
        [$game, $actor] = $this->gameForRuntimeCommand($commandType);
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([$this->runtimePatchForStackRelationCommand($game, $commandType)]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            actor: $actor,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags($commandType, runtime: false, shadow: true),
            runtimeGateway: $this->runtimeGateway($runtimeClient, $commandType, runtime: false, shadow: true),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            $commandType,
            $this->payloadForRuntimeCommand($commandType, $actor, $game),
            'action-runtime-shadow-'.$commandType,
            1,
            'message-runtime-shadow-'.$commandType,
        );

        self::assertContains($result->messageForUserId($actor->id())['kind'], ['game_patch', 'resync_required']);
        self::assertSame([$commandType], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_shadow_executed'] ?? 0);
        self::assertSame(0, $metricsStore->records()[0]['gameplay.runtime_shadow_divergence'] ?? 1);
    }

    #[DataProvider('edgeRuntimeCommands')]
    public function testAllowlistedEdgeRuntimeCommandsRouteToRuntimePrimaryPatchV2(string $commandType): void
    {
        [$game, $actor] = $this->gameForRuntimeCommand($commandType);
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([$this->runtimePatchForEdgeCommand($game, $commandType)], [
            'edge.runtime_route' => 1,
            'edge.patch_bytes' => 96,
        ]);
        $runtimePersistedEvent = $commandType === 'card.token.created'
            ? new GameEvent($game, 'card.token.created', [
                'playerId' => $actor->id(),
                'instanceIds' => ['runtime-token'],
                'cardKey' => 'runtime-token:token',
                'name' => 'Runtime Token',
                'tokens' => [[
                    'instanceId' => 'runtime-token',
                    'ownerId' => $actor->id(),
                    'controllerId' => $actor->id(),
                    'name' => 'Runtime Token',
                    'cardKey' => 'runtime-token:token',
                    'isToken' => true,
                ]],
            ], $actor, 'action-edge-runtime-'.$commandType, 2)
            : null;
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: false,
            expectFlush: $runtimePersistedEvent instanceof GameEvent,
            expectClear: true,
            actor: $actor,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags($commandType, runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, $commandType, runtime: true, shadow: false),
            runtimePersistedEvent: $runtimePersistedEvent,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            $commandType,
            $this->payloadForRuntimeCommand($commandType, $actor, $game),
            'action-edge-runtime-'.$commandType,
            1,
            'message-edge-runtime-'.$commandType,
            'v2',
        );

        self::assertSame('patch.v2', $result->messageForUserId($actor->id())['kind']);
        if ($commandType === 'card.token.created') {
            self::assertSame(
                'https://example.test/token.jpg',
                $runtimePersistedEvent?->payload()['staticCards']['runtime-token:token']['imageUris']['normal'] ?? null,
            );
            self::assertStringNotContainsString('oracleText', json_encode($runtimePersistedEvent?->payload(), JSON_THROW_ON_ERROR));
        }
        self::assertSame([$commandType], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_route'] ?? 0);
        self::assertSame(0, $metricsStore->records()[0]['gameplay.runtime_fallback_count'] ?? 1);
    }

    #[DataProvider('edgeRuntimeCommandsWithLegacyFallback')]
    public function testAllowlistedEdgeRuntimeErrorFallsBackToLegacy(string $commandType): void
    {
        [$game, $actor] = $this->gameForRuntimeCommand($commandType);
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([], [], fail: true);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            actor: $actor,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags($commandType, runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, $commandType, runtime: true, shadow: false),
            expectedBeginTransactions: 2,
            expectedLocks: 2,
            expectedRollbacks: 1,
            emergencyLegacyFallbackEnabled: true,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            $commandType,
            $this->payloadForRuntimeCommand($commandType, $actor, $game),
            'action-edge-fallback-'.$commandType,
            1,
            'message-edge-fallback-'.$commandType,
        );

        self::assertContains($result->messageForUserId($actor->id())['kind'], ['game_patch', 'resync_required']);
        self::assertSame([$commandType], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_fallback_count'] ?? 0);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_error_count'] ?? 0);
    }

    #[DataProvider('edgeRuntimeCommandsWithLegacyFallback')]
    public function testAllowlistedEdgePatchContractErrorFallsBackToLegacy(string $commandType): void
    {
        [$game, $actor] = $this->gameForRuntimeCommand($commandType);
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([[
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [],
        ]]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            actor: $actor,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags($commandType, runtime: true, shadow: false),
            runtimeGateway: $this->runtimeGateway($runtimeClient, $commandType, runtime: true, shadow: false),
            expectedBeginTransactions: 2,
            expectedLocks: 2,
            expectedRollbacks: 1,
            emergencyLegacyFallbackEnabled: true,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            $commandType,
            $this->payloadForRuntimeCommand($commandType, $actor, $game),
            'action-edge-contract-'.$commandType,
            1,
            'message-edge-contract-'.$commandType,
        );

        self::assertContains($result->messageForUserId($actor->id())['kind'], ['game_patch', 'resync_required']);
        self::assertSame([$commandType], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_fallback_count'] ?? 0);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_patch_contract_error'] ?? 0);
    }

    #[DataProvider('edgeRuntimeCommandsWithLegacyFallback')]
    public function testAllowlistedEdgeShadowModeExecutesRuntimeAndKeepsLegacyResponse(string $commandType): void
    {
        [$game, $actor] = $this->gameForRuntimeCommand($commandType);
        $metricsStore = new GameplayMetricsStore();
        $runtimeClient = new CommandPatchRuntimeClientStub([$this->runtimePatchForEdgeCommand($game, $commandType)]);
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            actor: $actor,
            metricsStore: $metricsStore,
            flagsV2: $this->runtimeFlags($commandType, runtime: false, shadow: true),
            runtimeGateway: $this->runtimeGateway($runtimeClient, $commandType, runtime: false, shadow: true),
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            $commandType,
            $this->payloadForRuntimeCommand($commandType, $actor, $game),
            'action-edge-shadow-'.$commandType,
            1,
            'message-edge-shadow-'.$commandType,
        );

        self::assertContains($result->messageForUserId($actor->id())['kind'], ['game_patch', 'resync_required']);
        self::assertSame([$commandType], $runtimeClient->types);
        self::assertSame(1, $metricsStore->records()[0]['gameplay.runtime_shadow_executed'] ?? 0);
    }

    /**
     * @return iterable<string,array{string}>
     */
    public static function battlefieldCountersSimpleRuntimeCommands(): iterable
    {
        foreach ([
            'card.tapped',
            'battlefield.untap_all',
            'card.position.changed',
            'cards.position.changed',
            'card.counter.changed',
            'counter.changed',
            'commander.damage.changed',
            'card.power_toughness.changed',
            'life.changed',
            'turn.changed',
            'dice.rolled',
        ] as $commandType) {
            yield $commandType => [$commandType];
        }
    }

    /**
     * @return iterable<string,array{string}>
     */
    public static function battlefieldCountersSimpleShadowCommands(): iterable
    {
        foreach ([
            'card.tapped',
            'card.position.changed',
            'card.counter.changed',
            'life.changed',
            'turn.changed',
            'dice.rolled',
            'commander.damage.changed',
        ] as $commandType) {
            yield $commandType => [$commandType];
        }
    }

    /**
     * @return iterable<string,array{string}>
     */
    public static function stackRelationsHelpersRuntimeCommands(): iterable
    {
        foreach ([
            'stack.card_added',
            'stack.item_removed',
            'arrow.created',
            'arrow.removed',
            'attachment.created',
            'attachment.removed',
            'helper.created',
            'helper.updated',
            'helper.removed',
        ] as $commandType) {
            yield $commandType => [$commandType];
        }
    }

    /**
     * @return iterable<string,array{string}>
     */
    public static function stackRelationsHelpersShadowCommands(): iterable
    {
        foreach ([
            'stack.card_added',
            'arrow.created',
            'attachment.created',
            'helper.created',
            'helper.updated',
            'helper.removed',
        ] as $commandType) {
            yield $commandType => [$commandType];
        }
    }

    /**
     * @return iterable<string,array{string}>
     */
    public static function edgeRuntimeCommands(): iterable
    {
        foreach ([
            'card.token.created',
            'card.token_copy.created',
            'zone.random_card.selected',
            'card.dungeon_marker.changed',
            'card.face.changed',
        ] as $commandType) {
            yield $commandType => [$commandType];
        }
    }

    /**
     * @return iterable<string,array{string}>
     */
    public static function edgeRuntimeCommandsWithLegacyFallback(): iterable
    {
        foreach ([
            'card.token.created',
            'card.token_copy.created',
            'zone.random_card.selected',
            'card.dungeon_marker.changed',
            'card.face.changed',
        ] as $commandType) {
            yield $commandType => [$commandType];
        }
    }

    /**
     * @return iterable<string,array{string}>
     */
    public static function sensitiveRuntimeCommands(): iterable
    {
        yield 'face down' => ['card.face_down.changed'];
        yield 'face changed' => ['card.face.changed'];
        yield 'revealed' => ['card.revealed'];
        yield 'controller changed' => ['card.controller.changed'];
    }

    /**
     * @return iterable<string,array{string}>
     */
    public static function migratedSensitiveRuntimeCommands(): iterable
    {
        yield 'face down' => ['card.face_down.changed'];
        yield 'face changed' => ['card.face.changed'];
        yield 'revealed' => ['card.revealed'];
        yield 'controller changed' => ['card.controller.changed'];
        yield 'library reveal' => ['library.reveal'];
        yield 'play top revealed' => ['library.play_top_revealed'];
    }

    public function testV2DirectRevealTopSendsSemanticRevealOnlyToAuthorizedViewer(): void
    {
        [$game, $actor, $opponent] = $this->gameWithPrivateLibraryCards();
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');
        $handler = new GameCommandHandler(flagsV2: new GameplayV2Flags(true, false, false, false, true));
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            projection: $projection,
            flagsV2: new GameplayV2Flags(false, true, false, false, true),
            handler: $handler,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'library.reveal_top',
            ['playerId' => $actor->id(), 'count' => 1, 'to' => [$actor->id()]],
            'action-v2-reveal',
            1,
            'message-v2-reveal',
            'v2',
        );

        $ownerMessage = $result->messageForUserId($actor->id());
        $opponentMessage = $result->messageForUserId($opponent->id());

        self::assertSame('patch.v2', $ownerMessage['kind']);
        self::assertSame('library.top.revealed', $ownerMessage['ops'][0]['op']);
        self::assertNotContains('library.top.revealed', array_column($opponentMessage['ops'], 'op'));
        self::assertStringNotContainsString('Private Library One', json_encode($opponentMessage, JSON_THROW_ON_ERROR));
    }

    public function testV2DirectCardsMovedUsesSemanticBatchPatchWithoutProjection(): void
    {
        [$game, $actor] = $this->game();
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['hand'] = [
            [
                'instanceId' => 'hand-1',
                'ownerId' => $actor->id(),
                'controllerId' => $actor->id(),
                'name' => 'Hand One',
                'zone' => 'hand',
            ],
            [
                'instanceId' => 'hand-2',
                'ownerId' => $actor->id(),
                'controllerId' => $actor->id(),
                'name' => 'Hand Two',
                'zone' => 'hand',
            ],
        ];
        $game->replaceSnapshot($snapshot);
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');
        $handler = new GameCommandHandler(flagsV2: new GameplayV2Flags(true, false, false, false));
        $service = $this->service(
            $game,
            existingEvent: null,
            expectPersist: true,
            expectFlush: true,
            expectClear: true,
            projection: $projection,
            flagsV2: new GameplayV2Flags(false, true, false, false),
            handler: $handler,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'cards.moved',
            ['playerId' => $actor->id(), 'fromZone' => 'hand', 'toZone' => 'graveyard', 'instanceIds' => ['hand-1', 'hand-2']],
            'action-v2-batch',
            1,
            'message-v2-batch',
            'v2',
        );

        $message = $result->messageForUserId($actor->id());

        self::assertSame('patch.v2', $message['kind']);
        self::assertContains('zone.cards.batchMove', array_column($message['ops'], 'op'));
    }

    public function testEventStoreHydratesAndPersistsCompactSnapshotForV2Command(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::never())->method('projectSnapshot');
        $projection->expects(self::never())->method('rulingsLookupForViewers');
        $handlerFlags = new GameplayV2Flags(true, false, false, true);
        $handler = new GameCommandHandler(flagsV2: $handlerFlags);
        $gameRepository = $this->createMock(EntityRepository::class);
        $gameRepository->expects(self::once())->method('find')->with($game->id())->willReturn($game);
        $userRepository = $this->createMock(EntityRepository::class);
        $userRepository->expects(self::once())->method('find')->with($actor->id())->willReturn($actor);
        $eventRepository = $this->createMock(EntityRepository::class);
        $eventRepository->expects(self::once())->method('findOneBy')->willReturn(null);
        $eventRepository->expects(self::once())->method('findBy')->with(['game' => $game], ['version' => 'ASC'])->willReturn([]);
        $snapshotRepository = $this->createMock(EntityRepository::class);
        $snapshotRepository->expects(self::exactly(2))->method('findOneBy')->with(['game' => $game], ['version' => 'DESC'])->willReturn(null);
        $persisted = [];
        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->method('getRepository')->willReturnMap([
            [Game::class, $gameRepository],
            [User::class, $userRepository],
            [GameEvent::class, $eventRepository],
            [\App\Domain\Game\GameSnapshotCompact::class, $snapshotRepository],
        ]);
        $manager->expects(self::once())->method('beginTransaction');
        $manager->expects(self::once())->method('lock')->with($game, LockMode::PESSIMISTIC_WRITE);
        $manager->expects(self::exactly(2))
            ->method('persist')
            ->with(self::callback(function (mixed $entity) use (&$persisted): bool {
                $persisted[] = $entity::class;

                return $entity instanceof GameEvent || $entity instanceof \App\Domain\Game\GameSnapshotCompact;
            }));
        $manager->expects(self::once())->method('flush');
        $manager->expects(self::once())->method('commit');
        $manager->expects(self::once())->method('clear');
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->method('getManagerForClass')->with(Game::class)->willReturn($manager);
        $eventStore = new GameEventStoreV2(
            $registry,
            $handler,
            new CompactGameCardStateMapper(),
            new \App\Application\Game\GameEventReplayService(),
            $handlerFlags,
            null,
            1,
            1,
        );
        $messages = new GameWebsocketMessageFactory();
        $service = new GameWebsocketCommandPatchService(
            $handler,
            new GameDisconnectVoteService($handler),
            new GameWebsocketPatchBuilder($messages),
            $messages,
            new \App\Application\Game\WebSocket\GameWebsocketRoomRegistry(),
            $registry,
            $projection,
            null,
            null,
            new GameplayMetricsInspector(),
            new GameplayV2ContractFactory(),
            new GameplayV2Flags(false, true, false, true),
            $eventStore,
        );

        $result = $service->apply(
            $game->id(),
            $actor->id(),
            'card.tapped',
            ['playerId' => $actor->id(), 'zone' => 'battlefield', 'instanceId' => 'battlefield-1', 'tapped' => true],
            'action-v2-event-store',
            1,
            'message-v2-event-store',
        );

        self::assertContains(GameEvent::class, $persisted);
        self::assertContains(\App\Domain\Game\GameSnapshotCompact::class, $persisted);
        self::assertSame('game_patch', $result->messageForUserId($actor->id())['kind']);
    }

    /**
     * @return array{Game, User}
     */
    private function gameWithBattlefieldCards(): array
    {
        [$game, $actor] = $this->game();
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['battlefield'] = [
            [
                'instanceId' => 'battlefield-1',
                'ownerId' => $actor->id(),
                'controllerId' => $actor->id(),
                'name' => 'Battlefield One',
                'tapped' => false,
                'zone' => 'battlefield',
            ],
            [
                'instanceId' => 'battlefield-2',
                'ownerId' => $actor->id(),
                'controllerId' => $actor->id(),
                'name' => 'Battlefield Two',
                'tapped' => false,
                'zone' => 'battlefield',
            ],
        ];
        $game->replaceSnapshot($snapshot);

        return [$game, $actor];
    }

    /**
     * @return array{Game, User}
     */
    private function gameForRuntimeCommand(string $commandType): array
    {
        if ($commandType === 'commander.damage.changed') {
            [$game, $actor, $opponent] = $this->gameWithOpponent();
            $snapshot = $game->snapshot();
            $snapshot['players'][$opponent->id()]['zones']['command'] = [[
                'instanceId' => 'commander-2',
                'ownerId' => $opponent->id(),
                'controllerId' => $opponent->id(),
                'name' => 'Opponent Commander',
                'isCommander' => true,
                'zone' => 'command',
            ]];
            $game->replaceSnapshot($snapshot);

            return [$game, $actor];
        }

        if (in_array($commandType, [
            'card.tapped',
            'battlefield.untap_all',
            'card.position.changed',
            'cards.position.changed',
            'card.counter.changed',
            'card.power_toughness.changed',
            'card.token_copy.created',
            'card.dungeon_marker.changed',
            'card.face.changed',
            'stack.card_added',
            'stack.item_removed',
            'arrow.created',
            'arrow.removed',
            'attachment.created',
            'attachment.removed',
        ], true)) {
            [$game, $actor] = $this->gameWithBattlefieldCards();
            $snapshot = $game->snapshot();
            $snapshot['stack'] = [[
                'id' => 'stack-existing',
                'stackId' => 'stack-existing',
                'kind' => 'card',
                'sourceInstanceId' => 'battlefield-1',
                'instanceId' => 'battlefield-1',
                'cardKey' => 'battlefield-one',
                'controllerId' => $actor->id(),
                'createdAt' => '2026-01-01T00:00:00+00:00',
            ]];
            $snapshot['arrows'] = [[
                'id' => 'arrow-existing',
                'ownerId' => $actor->id(),
                'fromInstanceId' => 'battlefield-1',
                'toInstanceId' => 'battlefield-2',
                'color' => 'red',
                'createdAt' => '2026-01-01T00:00:00+00:00',
            ]];
            $snapshot['attachments'] = [[
                'id' => 'attachment-existing',
                'ownerId' => $actor->id(),
                'equipmentInstanceId' => 'battlefield-2',
                'attachedToInstanceId' => 'battlefield-1',
                'createdAt' => '2026-01-01T00:00:00+00:00',
            ]];
            if ($commandType === 'card.dungeon_marker.changed') {
                $snapshot['players'][$actor->id()]['zones']['battlefield'][0]['typeLine'] = 'Dungeon';
            }
            if ($commandType === 'card.face.changed') {
                $snapshot['players'][$actor->id()]['zones']['battlefield'][0]['cardFaces'] = [
                    ['name' => 'Front Face'],
                    ['name' => 'Back Face'],
                ];
            }
            $game->replaceSnapshot($snapshot);

            return [$game, $actor];
        }

        if (in_array($commandType, ['helper.created', 'helper.updated', 'helper.removed'], true)) {
            [$game, $actor] = $this->game();
            $snapshot = $game->snapshot();
            $snapshot['specialEntities'] = [[
                'id' => 'helper-existing',
                'template' => 'citys_blessing',
                'scope' => 'player',
                'ownerPlayerId' => $actor->id(),
                'card' => null,
                'state' => ['label' => 'Existing'],
                'createdAt' => '2026-01-01T00:00:00+00:00',
            ]];
            $game->replaceSnapshot($snapshot);

            return [$game, $actor];
        }

        if ($commandType === 'zone.random_card.selected') {
            [$game, $actor] = $this->game();
            $snapshot = $game->snapshot();
            $snapshot['players'][$actor->id()]['zones']['hand'] = [[
                'instanceId' => 'hand-random-1',
                'ownerId' => $actor->id(),
                'controllerId' => $actor->id(),
                'name' => 'Private Random',
                'zone' => 'hand',
            ]];
            $game->replaceSnapshot($snapshot);

            return [$game, $actor];
        }

        return $this->game();
    }

    /**
     * @return array{Game, User}
     */
    private function gameForSensitiveCommand(string $commandType): array
    {
        if ($commandType === 'card.controller.changed') {
            [$game, $actor, $opponent] = $this->gameWithOpponent();
            $snapshot = $game->snapshot();
            $snapshot['players'][$actor->id()]['zones']['battlefield'] = [
                $this->sensitiveBattlefieldCard($actor->id()),
            ];
            $snapshot['players'][$opponent->id()]['zones']['battlefield'] = [];
            $game->replaceSnapshot($snapshot);

            return [$game, $actor];
        }

        [$game, $actor] = $this->gameWithBattlefieldCards();
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['battlefield'][0] = $this->sensitiveBattlefieldCard($actor->id());
        $game->replaceSnapshot($snapshot);

        return [$game, $actor];
    }

    /**
     * @return array<string,mixed>
     */
    private function sensitiveBattlefieldCard(string $playerId): array
    {
        return [
            'instanceId' => 'battlefield-1',
            'ownerId' => $playerId,
            'controllerId' => $playerId,
            'name' => 'Battlefield One',
            'zone' => 'battlefield',
            'cardFaces' => [
                ['name' => 'Front Face'],
                ['name' => 'Back Face'],
            ],
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function payloadForRuntimeCommand(string $commandType, User $actor, Game $game): array
    {
        return match ($commandType) {
            'card.tapped' => [
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'instanceId' => 'battlefield-1',
                'tapped' => true,
            ],
            'battlefield.untap_all' => [
                'playerId' => $actor->id(),
            ],
            'card.position.changed' => [
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'instanceId' => 'battlefield-1',
                'position' => ['x' => 0.25, 'y' => 0.35, 'unit' => 'ratio'],
            ],
            'cards.position.changed' => [
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'positions' => [
                    ['instanceId' => 'battlefield-1', 'position' => ['x' => 0.25, 'y' => 0.35, 'unit' => 'ratio']],
                    ['instanceId' => 'battlefield-2', 'position' => ['x' => 0.45, 'y' => 0.55, 'unit' => 'ratio']],
                ],
            ],
            'card.counter.changed' => [
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'instanceId' => 'battlefield-1',
                'key' => 'charge',
                'counter' => 'charge',
                'value' => 2,
            ],
            'counter.changed' => [
                'scope' => 'player:'.$actor->id(),
                'key' => 'poison',
                'value' => 2,
            ],
            'commander.damage.changed' => [
                'targetPlayerId' => $actor->id(),
                'sourcePlayerId' => $this->opponentPlayerId($game, $actor),
                'commanderInstanceId' => 'commander-2',
                'damage' => 7,
            ],
            'card.power_toughness.changed' => [
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'instanceId' => 'battlefield-1',
                'power' => 5,
                'toughness' => 6,
            ],
            'life.changed' => [
                'playerId' => $actor->id(),
                'life' => 37,
            ],
            'turn.changed' => [
                'activePlayerId' => $actor->id(),
                'phase' => 'combat',
                'number' => 2,
            ],
            'dice.rolled' => [
                'kind' => 'd6',
            ],
            'stack.card_added' => [
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'instanceId' => 'battlefield-1',
            ],
            'stack.item_removed' => [
                'stackId' => 'stack-existing',
            ],
            'arrow.created' => [
                'playerId' => $actor->id(),
                'fromInstanceId' => 'battlefield-1',
                'toInstanceId' => 'battlefield-2',
                'color' => 'blue',
            ],
            'arrow.removed' => [
                'id' => 'arrow-existing',
            ],
            'attachment.created' => [
                'playerId' => $actor->id(),
                'equipmentInstanceId' => 'battlefield-2',
                'attachedToInstanceId' => 'battlefield-1',
            ],
            'attachment.removed' => [
                'id' => 'attachment-existing',
            ],
            'helper.created' => [
                'playerId' => $actor->id(),
                'template' => 'citys_blessing',
                'scope' => 'player',
                'ownerPlayerId' => $actor->id(),
                'state' => ['label' => 'Runtime Helper'],
            ],
            'helper.updated' => [
                'entityId' => 'helper-existing',
                'state' => ['label' => 'Updated Helper'],
            ],
            'helper.removed' => [
                'entityId' => 'helper-existing',
            ],
            'card.token.created' => [
                'playerId' => $actor->id(),
                'quantity' => 1,
                'card' => [
                    'name' => 'Runtime Goblin',
                    'scryfallId' => 'runtime-token',
                    'imageUris' => ['normal' => 'https://example.test/token.jpg'],
                    'oracleText' => 'heavy text must not be in runtime patch',
                    'cardFaces' => [['name' => 'Runtime Goblin']],
                    'power' => 1,
                    'toughness' => 1,
                ],
            ],
            'card.token_copy.created' => [
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'instanceId' => 'battlefield-1',
                'targetPlayerId' => $actor->id(),
            ],
            'zone.random_card.selected' => [
                'playerId' => $actor->id(),
                'zone' => 'hand',
                'instanceId' => 'hand-random-1',
            ],
            'card.dungeon_marker.changed' => [
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'instanceId' => 'battlefield-1',
                'position' => ['x' => 0.2, 'y' => 0.4, 'unit' => 'ratio'],
            ],
            'card.face.changed' => [
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'instanceId' => 'battlefield-1',
                'faceIndex' => 1,
            ],
            default => throw new \InvalidArgumentException(sprintf('Unsupported test command %s.', $commandType)),
        };
    }

    /**
     * @return array<string,mixed>
     */
    private function runtimePatchForStackRelationCommand(Game $game, string $commandType): array
    {
        $actorId = array_key_first($game->snapshot()['players'] ?? []) ?? 'player-1';
        $op = match ($commandType) {
            'stack.card_added' => [
                'op' => 'stack.item.add',
                'data' => [
                    'item' => [
                        'id' => 'stack-runtime',
                        'stackId' => 'stack-runtime',
                        'kind' => 'card',
                        'sourceInstanceId' => 'battlefield-1',
                        'cardKey' => 'battlefield-one',
                        'controllerId' => $actorId,
                    ],
                ],
            ],
            'stack.item_removed' => ['op' => 'stack.item.remove', 'data' => ['id' => 'stack-existing']],
            'arrow.created' => [
                'op' => 'arrow.add',
                'data' => [
                    'arrow' => [
                        'id' => 'arrow-runtime',
                        'ownerId' => $actorId,
                        'fromInstanceId' => 'battlefield-1',
                        'toInstanceId' => 'battlefield-2',
                        'color' => 'blue',
                        'createdAt' => '2026-01-01T00:00:00+00:00',
                    ],
                ],
            ],
            'arrow.removed' => ['op' => 'arrow.remove', 'data' => ['id' => 'arrow-existing']],
            'attachment.created' => [
                'op' => 'attachment.add',
                'data' => [
                    'attachment' => [
                        'id' => 'attachment-runtime',
                        'ownerId' => $actorId,
                        'equipmentInstanceId' => 'battlefield-2',
                        'attachedToInstanceId' => 'battlefield-1',
                        'createdAt' => '2026-01-01T00:00:00+00:00',
                    ],
                ],
            ],
            'attachment.removed' => ['op' => 'attachment.remove', 'data' => ['id' => 'attachment-existing']],
            'helper.created' => [
                'op' => 'helper.add',
                'data' => [
                    'entity' => [
                        'id' => 'helper-runtime',
                        'template' => 'citys_blessing',
                        'scope' => 'player',
                        'ownerPlayerId' => $actorId,
                        'card' => null,
                        'state' => ['label' => 'Runtime Helper'],
                        'createdAt' => '2026-01-01T00:00:00+00:00',
                    ],
                ],
            ],
            'helper.updated' => [
                'op' => 'helper.update',
                'data' => [
                    'entity' => [
                        'id' => 'helper-existing',
                        'template' => 'citys_blessing',
                        'scope' => 'player',
                        'ownerPlayerId' => $actorId,
                        'card' => null,
                        'state' => ['label' => 'Updated Helper'],
                        'createdAt' => '2026-01-01T00:00:00+00:00',
                    ],
                ],
            ],
            'helper.removed' => ['op' => 'helper.remove', 'data' => ['id' => 'helper-existing']],
            default => throw new \InvalidArgumentException(sprintf('Unsupported test command %s.', $commandType)),
        };

        return [
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [$op],
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function runtimePatchForEdgeCommand(Game $game, string $commandType): array
    {
        $actorId = array_key_first($game->snapshot()['players'] ?? []) ?? 'player-1';
        $op = match ($commandType) {
            'card.token.created',
            'card.token_copy.created' => [
                'op' => 'zone.cards.add',
                'data' => [
                    'playerId' => $actorId,
                    'zone' => 'battlefield',
                    'cards' => [[
                        'instanceId' => 'runtime-token',
                        'ownerId' => $actorId,
                        'controllerId' => $actorId,
                        'name' => 'Runtime Token',
                        'cardKey' => 'runtime-token:token',
                        'isToken' => true,
                        'tokenMeta' => ['isCopy' => $commandType === 'card.token_copy.created'],
                    ]],
                ],
            ],
            'zone.random_card.selected' => [
                'op' => 'zone.random_card.selected',
                'data' => [
                    'playerId' => $actorId,
                    'zone' => 'hand',
                    'count' => 1,
                ],
            ],
            'card.dungeon_marker.changed' => [
                'op' => 'card.field.set',
                'data' => [
                    'playerId' => $actorId,
                    'zone' => 'battlefield',
                    'instanceId' => 'battlefield-1',
                    'dungeonMarker' => ['x' => 0.2, 'y' => 0.4, 'unit' => 'ratio'],
                ],
            ],
            'card.face.changed' => [
                'op' => 'card.field.set',
                'data' => [
                    'playerId' => $actorId,
                    'zone' => 'battlefield',
                    'instanceId' => 'battlefield-1',
                    'activeFaceIndex' => 1,
                ],
            ],
            default => throw new \InvalidArgumentException(sprintf('Unsupported edge command %s.', $commandType)),
        };

        return [
            'gameId' => $game->id(),
            'version' => 2,
            'visibility' => 'public',
            'ops' => [$op],
        ];
    }

    private function opponentPlayerId(Game $game, User $actor): string
    {
        foreach (array_keys($game->snapshot()['players'] ?? []) as $playerId) {
            if (is_string($playerId) && $playerId !== $actor->id()) {
                return $playerId;
            }
        }

        throw new \InvalidArgumentException('Opponent player not found.');
    }

    /**
     * @return array<string,mixed>
     */
    private function payloadForSensitiveCommand(string $commandType, User $actor, Game $game): array
    {
        $payload = [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
        ];

        return match ($commandType) {
            'card.face_down.changed' => [...$payload, 'faceDown' => true],
            'card.face.changed' => [...$payload, 'faceIndex' => 1],
            'card.revealed' => [...$payload, 'to' => 'all'],
            'card.controller.changed' => [...$payload, 'targetPlayerId' => $this->opponentPlayerId($game, $actor)],
            'library.reveal' => ['playerId' => $actor->id(), 'to' => [$actor->id()]],
            'library.play_top_revealed' => ['playerId' => $actor->id(), 'enabled' => true],
            default => throw new \InvalidArgumentException(sprintf('Unsupported sensitive command %s.', $commandType)),
        };
    }

    /**
     * @return array{Game, User, User}
     */
    private function gameWithPrivateHandCards(): array
    {
        [$game, $actor, $opponent] = $this->gameWithOpponent();
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['hand'] = [
            [
                'instanceId' => 'hand-1',
                'ownerId' => $actor->id(),
                'controllerId' => $actor->id(),
                'name' => 'Private Hand One',
                'oracleText' => 'Private hand oracle',
                'zone' => 'hand',
            ],
            [
                'instanceId' => 'hand-2',
                'ownerId' => $actor->id(),
                'controllerId' => $actor->id(),
                'name' => 'Private Hand Two',
                'oracleText' => 'Private hand oracle two',
                'zone' => 'hand',
            ],
        ];
        $game->replaceSnapshot($snapshot);

        return [$game, $actor, $opponent];
    }

    /**
     * @return array{Game, User, User}
     */
    private function gameWithPrivateLibraryCards(): array
    {
        [$game, $actor, $opponent] = $this->gameWithOpponent();
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['library'] = [
            [
                'instanceId' => 'library-2',
                'ownerId' => $actor->id(),
                'controllerId' => $actor->id(),
                'name' => 'Private Library Two',
                'oracleText' => 'Private oracle two',
                'zone' => 'library',
            ],
            [
                'instanceId' => 'library-1',
                'ownerId' => $actor->id(),
                'controllerId' => $actor->id(),
                'name' => 'Private Library One',
                'oracleText' => 'Private oracle',
                'zone' => 'library',
            ],
        ];
        $game->replaceSnapshot($snapshot);

        return [$game, $actor, $opponent];
    }

    /**
     * @return array{Game, User, User}
     */
    private function gameWithOpponent(): array
    {
        $actor = new User('actor@example.test', 'Actor');
        $opponent = new User('opponent@example.test', 'Opponent');
        $room = new Room($actor);
        $room->addPlayer(new RoomPlayer($room, $actor));
        $room->addPlayer(new RoomPlayer($room, $opponent));

        return [new Game($room, $this->snapshot($actor, $opponent)), $actor, $opponent];
    }

    private function localizedRuntimeResolver(): GameWebsocketCardLocalizationResolver
    {
        $connection = $this->createMock(\Doctrine\DBAL\Connection::class);
        $connection->method('fetchOne')->willReturn(null);
        $connection->method('executeQuery')->willReturnCallback(function (string $sql, array $params = []): \Doctrine\DBAL\Result {
            $sourceRows = [[
                'scryfall_id' => 'source-print',
                'normalized_name' => 'forest',
                'set_code' => 'abc',
                'collector_number' => '1',
                'name' => 'Forest',
                'printed_name' => null,
                'lang' => 'en',
                'image_uris' => json_encode(['normal' => 'https://cards.example/forest-en.jpg'], JSON_THROW_ON_ERROR),
                'card_faces' => json_encode([['name' => 'Forest', 'imageUris' => ['normal' => 'https://cards.example/forest-en-face.jpg']]], JSON_THROW_ON_ERROR),
                'type_line' => 'Basic Land',
                'mana_cost' => null,
                'oracle_text' => null,
                'image_status' => null,
            ]];
            $payloadRows = [
                [
                    'scryfall_id' => 'source-print',
                    'lang' => 'en',
                    'name' => 'Forest',
                    'printed_name' => null,
                    'image_uris' => json_encode(['normal' => 'https://cards.example/forest-en.jpg'], JSON_THROW_ON_ERROR),
                    'card_faces' => json_encode([['name' => 'Forest', 'imageUris' => ['normal' => 'https://cards.example/forest-en-face.jpg']]], JSON_THROW_ON_ERROR),
                    'type_line' => 'Basic Land',
                    'mana_cost' => null,
                    'oracle_text' => null,
                ],
                [
                    'scryfall_id' => 'source-print-es',
                    'lang' => 'es',
                    'name' => 'Bosque',
                    'printed_name' => 'Bosque',
                    'image_uris' => json_encode(['normal' => 'https://cards.example/forest-es.jpg'], JSON_THROW_ON_ERROR),
                    'card_faces' => json_encode([['name' => 'Bosque', 'imageUris' => ['normal' => 'https://cards.example/forest-es-face.jpg']]], JSON_THROW_ON_ERROR),
                    'type_line' => 'Tierra basica',
                    'mana_cost' => null,
                    'oracle_text' => null,
                ],
            ];

            if (str_contains($sql, 'WHERE scryfall_id IN (:ids)') && str_contains($sql, 'AND lang IN (:languages)')) {
                $ids = array_flip(array_values(array_filter($params['ids'] ?? [], static fn (mixed $id): bool => is_string($id))));
                $languages = array_flip(array_values(array_filter($params['languages'] ?? [], static fn (mixed $language): bool => is_string($language))));

                return $this->dbalResult(array_values(array_filter(
                    $payloadRows,
                    static fn (array $row): bool => isset($ids[$row['scryfall_id']], $languages[$row['lang']]),
                )));
            }

            if (str_contains($sql, 'WHERE scryfall_id IN (:ids)')) {
                return $this->dbalResult($sourceRows);
            }

            if (str_contains($sql, 'candidate.collector_number')) {
                $languages = array_flip(array_values(array_filter($params['languages'] ?? [], static fn (mixed $language): bool => is_string($language))));
                $rows = [];
                if (isset($languages['es'])) {
                    $rows[] = [
                        'source_scryfall_id' => 'source-print',
                        'candidate_scryfall_id' => 'source-print-es',
                        'lang' => 'es',
                        'image_status' => null,
                    ];
                }
                if (isset($languages['en'])) {
                    $rows[] = [
                        'source_scryfall_id' => 'source-print',
                        'candidate_scryfall_id' => 'source-print',
                        'lang' => 'en',
                        'image_status' => null,
                    ];
                }

                return $this->dbalResult($rows);
            }

            if (str_contains($sql, 'candidate.normalized_name = source.normalized_name')) {
                return $this->dbalResult([]);
            }

            return $this->dbalResult([]);
        });

        return new GameWebsocketCardLocalizationResolver($connection);
    }

    /**
     * @param list<array<string,mixed>> $rows
     */
    private function dbalResult(array $rows): \Doctrine\DBAL\Result
    {
        $result = $this->createMock(\Doctrine\DBAL\Result::class);
        $result->method('fetchAllAssociative')->willReturn($rows);

        return $result;
    }

    private function service(
        Game $game,
        ?GameEvent $existingEvent,
        bool $expectPersist,
        bool $expectFlush,
        bool $expectClear,
        ?User $actor = null,
        bool $expectTransaction = true,
        ?GameProjectionService $projection = null,
        ?GameWebsocketCardLocalizationResolver $resolver = null,
        ?GameplayMetricsStore $metricsStore = null,
        ?GameplayV2Flags $flagsV2 = null,
        ?GameCommandHandler $handler = null,
        ?GameWebsocketPatchBuilder $patchBuilder = null,
        ?GameEventStoreV2 $eventStoreV2 = null,
        ?GameActivityStreamService $activityStreams = null,
        ?GameplayStreamsFlags $streamFlags = null,
        ?GameplayRuntimeGateway $runtimeGateway = null,
        ?int $expectedBeginTransactions = null,
        ?int $expectedLocks = null,
        ?int $expectedRollbacks = null,
        ?array &$persistedEventTypes = null,
        array $lifecycleEvents = [],
        ?GameEvent $runtimePersistedEvent = null,
        bool $emergencyLegacyFallbackEnabled = false,
        ?GameWebsocketRoomRegistry $rooms = null,
    ): GameWebsocketCommandPatchService {
        $actor ??= $game->room()->owner();
        $gameRepository = $this->createMock(EntityRepository::class);
        $gameRepository->expects(self::once())->method('find')->with($game->id())->willReturn($game);
        $userRepository = $this->createMock(EntityRepository::class);
        $userRepository->expects(self::once())->method('find')->with($actor->id())->willReturn($actor);
        $eventRepository = $this->createMock(EntityRepository::class);
        $findOneCalls = $expectTransaction ? 1 : 0;
        if ($runtimePersistedEvent instanceof GameEvent) {
            ++$findOneCalls;
        }
        $findOneExpectation = $eventRepository->expects(self::exactly($findOneCalls))->method('findOneBy');
        if ($runtimePersistedEvent instanceof GameEvent) {
            $findOneExpectation->willReturnOnConsecutiveCalls($existingEvent, $runtimePersistedEvent);
        } else {
            $findOneExpectation->willReturn($existingEvent);
        }
        $eventRepository->method('findBy')->willReturn($lifecycleEvents);

        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->method('getRepository')->willReturnMap([
            [Game::class, $gameRepository],
            [User::class, $userRepository],
            [GameEvent::class, $eventRepository],
        ]);
        $expectedBeginTransactions ??= $expectTransaction ? 1 : 0;
        $expectedLocks ??= $expectTransaction ? 1 : 0;
        $expectedRollbacks ??= $expectTransaction && (!$expectPersist || !$expectFlush) ? 1 : 0;
        $manager->expects(self::exactly($expectedBeginTransactions))->method('beginTransaction');
        $manager->expects(self::exactly($expectedLocks))->method('lock')->with($game, LockMode::PESSIMISTIC_WRITE);
        $persistExpectation = $manager->expects($expectPersist ? self::once() : self::never())->method('persist')->with(self::isInstanceOf(GameEvent::class));
        if ($persistedEventTypes !== null) {
            $persistExpectation->willReturnCallback(static function (GameEvent $event) use (&$persistedEventTypes): void {
                $persistedEventTypes[] = $event->type();
            });
        }
        $manager->expects($expectFlush ? self::once() : self::never())->method('flush');
        $manager->expects($expectPersist && $expectFlush ? self::once() : self::never())->method('commit');
        $manager->expects(self::exactly($expectedRollbacks))->method('rollback');
        $manager->expects($expectClear ? self::once() : self::never())->method('clear');

        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::once())->method('getManagerForClass')->with(Game::class)->willReturn($manager);

        return $this->serviceWithRegistry($registry, $projection, $resolver, $metricsStore, $flagsV2, $handler, $patchBuilder, $eventStoreV2, $activityStreams, $streamFlags, $runtimeGateway, $emergencyLegacyFallbackEnabled, $rooms);
    }

    /**
     * @param list<string> $persistedTypes
     */
    private function serviceAllowingRepeatedCommands(
        Game $game,
        User $actor,
        GameplayMetricsStore $metricsStore,
        array &$persistedTypes,
    ): GameWebsocketCommandPatchService {
        $gameRepository = $this->createMock(EntityRepository::class);
        $gameRepository->method('find')->with($game->id())->willReturn($game);
        $userRepository = $this->createMock(EntityRepository::class);
        $userRepository->method('find')->with($actor->id())->willReturn($actor);
        $eventRepository = $this->createMock(EntityRepository::class);
        $eventRepository->method('findOneBy')->willReturn(null);

        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->method('getRepository')->willReturnMap([
            [Game::class, $gameRepository],
            [User::class, $userRepository],
            [GameEvent::class, $eventRepository],
        ]);
        $manager->method('persist')->willReturnCallback(static function (object $entity) use (&$persistedTypes): void {
            if ($entity instanceof GameEvent) {
                $persistedTypes[] = $entity->type();
            }
        });

        $registry = $this->createMock(ManagerRegistry::class);
        $registry->method('getManagerForClass')->with(Game::class)->willReturn($manager);

        return $this->serviceWithRegistry($registry, metricsStore: $metricsStore);
    }

    private function serviceWithRegistry(
        ManagerRegistry $registry,
        ?GameProjectionService $projection = null,
        ?GameWebsocketCardLocalizationResolver $resolver = null,
        ?GameplayMetricsStore $metricsStore = null,
        ?GameplayV2Flags $flagsV2 = null,
        ?GameCommandHandler $handler = null,
        ?GameWebsocketPatchBuilder $patchBuilder = null,
        ?GameEventStoreV2 $eventStoreV2 = null,
        ?GameActivityStreamService $activityStreams = null,
        ?GameplayStreamsFlags $streamFlags = null,
        ?GameplayRuntimeGateway $runtimeGateway = null,
        bool $emergencyLegacyFallbackEnabled = false,
        ?GameWebsocketRoomRegistry $rooms = null,
    ): GameWebsocketCommandPatchService
    {
        $messages = new GameWebsocketMessageFactory();
        $contractsV2 = new GameplayV2ContractFactory();
        $handler ??= new GameCommandHandler();

        return new GameWebsocketCommandPatchService(
            $handler,
            new GameDisconnectVoteService($handler),
            $patchBuilder ?? new GameWebsocketPatchBuilder($messages),
            $messages,
            $rooms ?? new GameWebsocketRoomRegistry(),
            $registry,
            $projection ?? new GameProjectionService($handler),
            $resolver,
            $metricsStore,
            new GameplayMetricsInspector(),
            $contractsV2,
            $flagsV2,
            $eventStoreV2,
            $activityStreams,
            $streamFlags,
            $runtimeGateway,
            $emergencyLegacyFallbackEnabled,
        );
    }

    /**
     * @param list<User> $extraViewers
     */
    private function runtimeRoomsFor(Game $game, array $extraViewers = []): GameWebsocketRoomRegistry
    {
        $rooms = new GameWebsocketRoomRegistry();
        $seen = [];
        $join = function (User $user) use ($rooms, $game, &$seen): void {
            if (isset($seen[$user->id()])) {
                return;
            }
            $seen[$user->id()] = true;
            $rooms->join(new GameWebsocketPeer(
                connectionId: 'conn-'.$user->id(),
                gameId: $game->id(),
                userId: $user->id(),
                displayName: $user->displayName(),
                connectedAt: new \DateTimeImmutable('2026-01-01T00:00:00+00:00'),
                send: static fn (array $message): null => null,
                playerId: $user->id(),
                permissions: ['view', 'command'],
                viewerMask: $this->viewerMaskForGame($game, $user->id()),
            ));
        };

        $join($game->room()->owner());
        foreach ($game->room()->orderedPlayers() as $roomPlayer) {
            if ($roomPlayer instanceof RoomPlayer) {
                $join($roomPlayer->user());
            }
        }
        foreach ($extraViewers as $viewer) {
            $join($viewer);
        }

        return $rooms;
    }

    private function viewerMaskForGame(Game $game, string $playerId): int
    {
        $snapshot = $game->snapshot();
        $viewerBits = is_array($snapshot['visibility']['viewerBits'] ?? null)
            ? $snapshot['visibility']['viewerBits']
            : [];
        if (isset($viewerBits[$playerId])) {
            return max(0, (int) $viewerBits[$playerId]);
        }

        $bit = 1;
        foreach (array_keys(is_array($snapshot['players'] ?? null) ? $snapshot['players'] : []) as $snapshotPlayerId) {
            if (!is_string($snapshotPlayerId)) {
                continue;
            }
            if ($snapshotPlayerId === $playerId) {
                return $bit;
            }
            $bit <<= 1;
        }

        return 0;
    }

    private function runtimeFlags(string $allowlist, bool $runtime, bool $shadow): GameplayV2Flags
    {
        return new GameplayV2Flags(
            commandEnabled: false,
            patchEnabled: true,
            bootstrapEnabled: false,
            eventEnabled: false,
            visibilityEnabled: true,
            enabled: true,
            commandsAllowlist: $allowlist,
            runtimeServiceEnabled: $runtime,
            semanticPatchesEnabled: true,
            compactBootstrapEnabled: true,
            shadowCompareEnabled: $shadow,
        );
    }

    private function runtimeGateway(
        GameRuntimeCommandClientInterface $client,
        string $allowlist,
        bool $runtime,
        bool $shadow,
    ): GameplayRuntimeGateway {
        return new GameplayRuntimeGateway(
            new GameplayRuntimeRouter($this->runtimeFlags($allowlist, $runtime, $shadow), $client),
            new GameplayRuntimePatchAdapter(),
        );
    }

    /**
     * @return array<string,mixed>
     */
    private function snapshot(User $actor, ?User $opponent = null): array
    {
        $players = [
            $actor->id() => [
                'user' => $actor->toArray(),
                'life' => 40,
                'zones' => [
                    'library' => [],
                    'hand' => [],
                    'battlefield' => [],
                    'graveyard' => [],
                    'exile' => [],
                    'command' => [],
                ],
                'zoneCounts' => [
                    'library' => 0,
                    'hand' => 0,
                    'battlefield' => 0,
                    'graveyard' => 0,
                    'exile' => 0,
                    'command' => 0,
                ],
                'commanderDamage' => [],
                'counters' => [],
                'backgroundName' => 'G_3',
                'sleevesName' => 'default',
            ],
        ];
        if ($opponent instanceof User) {
            $players[$opponent->id()] = [
                'user' => $opponent->toArray(),
                'life' => 40,
                'zones' => [
                    'library' => [],
                    'hand' => [],
                    'battlefield' => [],
                    'graveyard' => [],
                    'exile' => [],
                    'command' => [],
                ],
                'zoneCounts' => [
                    'library' => 0,
                    'hand' => 0,
                    'battlefield' => 0,
                    'graveyard' => 0,
                    'exile' => 0,
                    'command' => 0,
                ],
                'commanderDamage' => [],
                'counters' => [],
                'backgroundName' => 'G_3',
                'sleevesName' => 'default',
            ];
        }

        return [
            'version' => 1,
            'ownerId' => $actor->id(),
            'players' => $players,
            'turn' => ['activePlayerId' => $actor->id(), 'phase' => 'main-1', 'number' => 1],
            'timer' => ['mode' => 'none', 'status' => 'idle', 'durationSeconds' => null, 'remainingSeconds' => null],
            'stack' => [],
            'arrows' => [],
            'attachments' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
            'updatedAt' => '2026-01-01T00:00:00+00:00',
        ];
    }
}

final class CommandPatchRuntimeClientStub implements GameRuntimeCommandClientInterface
{
    /** @var list<string> */
    public array $types = [];
    /** @var list<int> */
    public array $baseVersions = [];
    /** @var list<array<string,mixed>> */
    public array $payloads = [];
    /** @var list<array<string,mixed>> */
    public array $snapshots = [];

    /**
     * @param list<array<string,mixed>> $patches
     * @param array<string,mixed>       $metrics
     */
    public function __construct(
        private readonly array $patches,
        private readonly array $metrics = [],
        private readonly bool $fail = false,
        private readonly ?string $eventType = null,
    ) {
    }

    public function dispatch(
        string $type,
        string $gameId,
        string $actorId,
        int $baseVersion,
        string $clientActionId,
        array $snapshot,
        array $payload,
        bool $shadow = false,
    ): GameRuntimeCommandResult {
        $this->types[] = $type;
        $this->baseVersions[] = $baseVersion;
        $this->payloads[] = $payload;
        $this->snapshots[] = $snapshot;
        if ($this->fail) {
            throw new GameRuntimeGatewayException('runtime unavailable');
        }

        return new GameRuntimeCommandResult(
            [
                'gameId' => $gameId,
                'version' => $baseVersion + 1,
                'type' => $this->eventType ?? $type,
                'payload' => $payload,
                'createdBy' => $actorId,
                'clientActionId' => $clientActionId,
            ],
            $this->patches,
            $this->metrics,
        );
    }
}
