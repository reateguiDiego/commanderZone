<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\Compact\GameplayCompactRuntimeFlags;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameDisconnectVoteService;
use App\Application\Game\GameProjectionService;
use App\Application\Game\GameVisibilityIndex;
use App\Application\Game\Performance\GameplayMetricsInspector;
use App\Application\Game\Performance\GameplayMetricsStore;
use App\Application\Game\WebSocket\GameWebsocketCardLocalizationResolver;
use App\Application\Game\WebSocket\GameWebsocketCommandPatchService;
use App\Application\Game\WebSocket\GameWebsocketMessageFactory;
use App\Application\Game\WebSocket\GameWebsocketPatchBuilder;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use Doctrine\Persistence\ManagerRegistry;
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
    ): GameWebsocketCommandPatchService {
        $actor ??= $game->room()->owner();
        $gameRepository = $this->createMock(EntityRepository::class);
        $gameRepository->expects(self::once())->method('find')->with($game->id())->willReturn($game);
        $userRepository = $this->createMock(EntityRepository::class);
        $userRepository->expects(self::once())->method('find')->with($actor->id())->willReturn($actor);
        $eventRepository = $this->createMock(EntityRepository::class);
        $eventRepository->expects($expectTransaction ? self::once() : self::never())->method('findOneBy')->willReturn($existingEvent);

        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->method('getRepository')->willReturnMap([
            [Game::class, $gameRepository],
            [User::class, $userRepository],
            [GameEvent::class, $eventRepository],
        ]);
        $manager->expects($expectTransaction ? self::once() : self::never())->method('beginTransaction');
        $manager->expects($expectTransaction ? self::once() : self::never())->method('lock')->with($game, LockMode::PESSIMISTIC_WRITE);
        $manager->expects($expectPersist ? self::once() : self::never())->method('persist')->with(self::isInstanceOf(GameEvent::class));
        $manager->expects($expectFlush ? self::once() : self::never())->method('flush');
        $manager->expects($expectPersist && $expectFlush ? self::once() : self::never())->method('commit');
        $manager->expects($expectTransaction && (!$expectPersist || !$expectFlush) ? self::once() : self::never())->method('rollback');
        $manager->expects($expectClear ? self::once() : self::never())->method('clear');

        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::once())->method('getManagerForClass')->with(Game::class)->willReturn($manager);

        return $this->serviceWithRegistry($registry, $projection, $resolver, $metricsStore, $flagsV2, $handler, $patchBuilder);
    }

    private function serviceWithRegistry(
        ManagerRegistry $registry,
        ?GameProjectionService $projection = null,
        ?GameWebsocketCardLocalizationResolver $resolver = null,
        ?GameplayMetricsStore $metricsStore = null,
        ?GameplayV2Flags $flagsV2 = null,
        ?GameCommandHandler $handler = null,
        ?GameWebsocketPatchBuilder $patchBuilder = null,
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
            new \App\Application\Game\WebSocket\GameWebsocketRoomRegistry(),
            $registry,
            $projection ?? new GameProjectionService($handler),
            $resolver,
            $metricsStore,
            new GameplayMetricsInspector(),
            $contractsV2,
            $flagsV2,
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
