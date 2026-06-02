<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameDisconnectVoteService;
use App\Application\Game\GameProjectionService;
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

        return $this->serviceWithRegistry($registry, $projection, $resolver);
    }

    private function serviceWithRegistry(
        ManagerRegistry $registry,
        ?GameProjectionService $projection = null,
        ?GameWebsocketCardLocalizationResolver $resolver = null,
    ): GameWebsocketCommandPatchService
    {
        $messages = new GameWebsocketMessageFactory();

        return new GameWebsocketCommandPatchService(
            new GameCommandHandler(),
            new GameDisconnectVoteService(new GameCommandHandler()),
            new GameWebsocketPatchBuilder($messages),
            $messages,
            new \App\Application\Game\WebSocket\GameWebsocketRoomRegistry(),
            $registry,
            $projection ?? new GameProjectionService(new GameCommandHandler()),
            $resolver,
        );
    }

    /**
     * @return array<string,mixed>
     */
    private function snapshot(User $actor): array
    {
        return [
            'version' => 1,
            'ownerId' => $actor->id(),
            'players' => [
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
            ],
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
