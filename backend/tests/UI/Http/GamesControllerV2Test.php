<?php

namespace App\Tests\UI\Http;

use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\Debug\GameDebugHealthAggregator;
use App\Application\Game\Debug\GameDebugHealthLiveStore;
use App\Application\Game\GameEventStoreV2;
use App\Application\Game\GameProjectionService;
use App\Application\Game\GameCommandHandler;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Game\GameSnapshotCompact;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use App\UI\Http\GamesController;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;

class GamesControllerV2Test extends TestCase
{
    public function testBootstrapV2IncludesChatAndLogCursors(): void
    {
        [$game, $viewer] = $this->game();
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::once())->method('project')->with($game, $viewer)->willReturn($this->projectedSnapshot($viewer, [
            'chat' => [[
                'id' => 'chat-1',
                'userId' => $viewer->id(),
                'displayName' => 'Viewer',
                'message' => 'hello',
                'createdAt' => '2026-01-01T00:00:00+00:00',
                'reactions' => [],
            ]],
            'eventLog' => [[
                'id' => 'log-1',
                'type' => 'life.changed',
                'message' => 'lost 2 life',
                'actorId' => $viewer->id(),
                'displayName' => 'Viewer',
                'createdAt' => '2026-01-01T00:01:00+00:00',
            ]],
        ]));

        $controller = new GamesController();
        $controller->setContainer($this->controllerContainer());
        $response = $controller->snapshot(
            $game->id(),
            $viewer,
            $this->entityManager($game),
            $projection,
            $this->debugHealth(),
            Request::create('/games/'.$game->id().'/bootstrap?contract=v2', 'GET'),
            new GameplayV2ContractFactory(),
            new GameplayV2Flags(false, false, true, false),
        );
        $payload = json_decode($response->getContent() ?: '[]', true, flags: JSON_THROW_ON_ERROR);

        self::assertSame('chat-1', $payload['chatCursor']);
        self::assertSame('log-1', $payload['logCursor']);
    }

    public function testBootstrapCanReturnV2ContractUnderFeatureFlag(): void
    {
        [$game, $viewer] = $this->game();
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::once())->method('project')->with($game, $viewer)->willReturn($this->projectedSnapshot($viewer));

        $controller = new GamesController();
        $controller->setContainer($this->controllerContainer());
        $response = $controller->snapshot(
            $game->id(),
            $viewer,
            $this->entityManager($game),
            $projection,
            $this->debugHealth(),
            Request::create('/games/'.$game->id().'/bootstrap?contract=v2', 'GET'),
            new GameplayV2ContractFactory(),
            new GameplayV2Flags(false, false, true, false),
        );
        $payload = json_decode($response->getContent() ?: '[]', true, flags: JSON_THROW_ON_ERROR);

        self::assertSame($game->id(), $payload['game']['id']);
        self::assertSame($viewer->id(), $payload['game']['viewerId']);
        self::assertArrayHasKey($viewer->id().':battlefield', $payload['zones']);
        self::assertArrayHasKey('battlefield-1', $payload['instances']);
        self::assertArrayNotHasKey('snapshot', $payload['game']);
    }

    public function testBootstrapV2AcceptsKnownStaticCardsForCacheFriendlyPayload(): void
    {
        [$game, $viewer] = $this->game();
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::once())->method('project')->with($game, $viewer)->willReturn($this->projectedSnapshot($viewer));
        $knownStaticCatalogKey = implode('|', array_map('rawurlencode', [
            '33333333-3333-3333-3333-333333333333:card',
            '33333333-3333-3333-3333-333333333333',
            'legacy-snapshot-v1',
            'en',
            'public',
        ]));

        $controller = new GamesController();
        $controller->setContainer($this->controllerContainer());
        $response = $controller->snapshot(
            $game->id(),
            $viewer,
            $this->entityManager($game),
            $projection,
            $this->debugHealth(),
            Request::create(
                '/games/'.$game->id().'/bootstrap?contract=v2&knownStaticCards='.rawurlencode($knownStaticCatalogKey),
                'GET',
            ),
            new GameplayV2ContractFactory(),
            new GameplayV2Flags(false, false, true, false),
        );
        $payload = json_decode($response->getContent() ?: '[]', true, flags: JSON_THROW_ON_ERROR);

        self::assertSame('33333333-3333-3333-3333-333333333333:card', $payload['instances']['battlefield-1']['cardKey']);
        self::assertArrayNotHasKey('33333333-3333-3333-3333-333333333333:card', $payload['staticCards']);
    }

    public function testBootstrapKeepsLegacyShapeWhenFlagDisabled(): void
    {
        [$game, $viewer] = $this->game();
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::once())->method('project')->with($game, $viewer)->willReturn($this->projectedSnapshot($viewer));

        $controller = new GamesController();
        $controller->setContainer($this->controllerContainer());
        $response = $controller->snapshot(
            $game->id(),
            $viewer,
            $this->entityManager($game),
            $projection,
            $this->debugHealth(),
            Request::create('/games/'.$game->id().'/bootstrap?contract=v2', 'GET'),
            new GameplayV2ContractFactory(),
            new GameplayV2Flags(false, false, false, false),
        );
        $payload = json_decode($response->getContent() ?: '[]', true, flags: JSON_THROW_ON_ERROR);

        self::assertArrayHasKey('game', $payload);
        self::assertArrayHasKey('snapshot', $payload['game']);
        self::assertSame(2, $payload['game']['snapshot']['version']);
    }

    public function testSnapshotHydratesRuntimeStateFromEventStoreWhenEnabled(): void
    {
        [$game, $viewer] = $this->game();
        $projection = $this->createMock(GameProjectionService::class);
        $projection->expects(self::once())->method('project')->with($game, $viewer)->willReturn($this->projectedSnapshot($viewer));
        $eventRepository = $this->createMock(EntityRepository::class);
        $eventRepository->expects(self::once())->method('findBy')->with(['game' => $game], ['version' => 'ASC'])->willReturn([]);
        $snapshotRepository = $this->createMock(EntityRepository::class);
        $snapshotRepository->expects(self::once())->method('findOneBy')->with(['game' => $game], ['version' => 'DESC'])->willReturn(null);
        $eventStoreEntityManager = $this->createMock(EntityManagerInterface::class);
        $eventStoreEntityManager->method('getRepository')->willReturnMap([
            [GameEvent::class, $eventRepository],
            [GameSnapshotCompact::class, $snapshotRepository],
        ]);
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::atLeastOnce())->method('getManagerForClass')->with(Game::class)->willReturn($eventStoreEntityManager);
        $eventStore = new GameEventStoreV2(
            $registry,
            new GameCommandHandler(),
            null,
            null,
            new GameplayV2Flags(false, false, false, true),
        );

        $controller = new GamesController();
        $controller->setContainer($this->controllerContainer());
        $response = $controller->snapshot(
            $game->id(),
            $viewer,
            $this->entityManager($game),
            $projection,
            $this->debugHealth(),
            Request::create('/games/'.$game->id().'/snapshot', 'GET'),
            null,
            new GameplayV2Flags(false, false, false, true),
            $eventStore,
        );
        $payload = json_decode($response->getContent() ?: '[]', true, flags: JSON_THROW_ON_ERROR);

        self::assertArrayHasKey('game', $payload);
        self::assertArrayHasKey('snapshot', $payload['game']);
    }

    public function testLegacyBootstrapDuringMulliganDoesNotExposeOpponentPrivateCards(): void
    {
        $owner = new User('mulligan-owner@example.test', 'Mulligan Owner');
        $opponent = new User('mulligan-opponent@example.test', 'Mulligan Opponent');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $room->addPlayer(new RoomPlayer($room, $opponent));
        $game = new Game($room, [
            'version' => 3,
            'ownerId' => $owner->id(),
            'gamePhase' => 'MULLIGAN',
            'mulligan' => ['rule' => 'LONDON', 'firstMulliganFree' => true],
            'players' => [
                $owner->id() => [
                    'user' => $owner->toArray(),
                    'life' => 40,
                    'zones' => [
                        'library' => [[
                            'instanceId' => 'owner-library-top',
                            'ownerId' => $owner->id(),
                            'controllerId' => $owner->id(),
                            'zone' => 'library',
                            'name' => 'Private Library Top',
                            'cardKey' => 'private-library@v1',
                            'oracleText' => 'Private library oracle',
                            'imageUris' => ['normal' => 'https://cards.example/private-library.jpg'],
                        ]],
                        'hand' => [[
                            'instanceId' => 'owner-hand-1',
                            'ownerId' => $owner->id(),
                            'controllerId' => $owner->id(),
                            'zone' => 'hand',
                            'name' => 'Private Hand Card',
                            'cardKey' => 'private-hand@v1',
                            'oracleText' => 'Private hand oracle',
                            'cardFaces' => [['name' => 'Private Face']],
                            'imageUris' => ['normal' => 'https://cards.example/private-hand.jpg'],
                        ]],
                        'battlefield' => [],
                        'graveyard' => [],
                        'exile' => [],
                        'command' => [],
                    ],
                    'mulligan' => [
                        'mulligansTaken' => 1,
                        'effectiveMulligans' => 1,
                        'bottomSelectionCount' => 1,
                        'needsBottomSelection' => true,
                        'bottomOrderMode' => 'CLIENT',
                        'status' => 'DECIDING',
                        'ready' => false,
                    ],
                    'commanderDamage' => [],
                    'counters' => [],
                ],
                $opponent->id() => [
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
                    'mulligan' => [
                        'mulligansTaken' => 0,
                        'effectiveMulligans' => 0,
                        'status' => 'DECIDING',
                        'ready' => false,
                    ],
                    'commanderDamage' => [],
                    'counters' => [],
                ],
            ],
            'turn' => ['activePlayerId' => $owner->id(), 'phase' => 'main', 'number' => 1],
            'stack' => [],
            'arrows' => [],
            'attachments' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ]);

        $controller = new GamesController();
        $controller->setContainer($this->controllerContainer());
        $response = $controller->snapshot(
            $game->id(),
            $opponent,
            $this->entityManager($game),
            new GameProjectionService(new GameCommandHandler()),
            $this->debugHealth(),
            Request::create('/games/'.$game->id().'/bootstrap', 'GET'),
        );
        $payload = json_decode($response->getContent() ?: '[]', true, flags: JSON_THROW_ON_ERROR);
        $ownerProjection = $payload['game']['snapshot']['players'][$owner->id()];
        $encoded = json_encode($ownerProjection, JSON_THROW_ON_ERROR);

        self::assertSame(1, $ownerProjection['zoneCounts']['hand']);
        self::assertSame(1, $ownerProjection['zoneCounts']['library']);
        self::assertSame('Hidden card', $ownerProjection['zones']['hand'][0]['name']);
        self::assertStringNotContainsString('owner-hand-1', $encoded);
        self::assertStringNotContainsString('owner-library-top', $encoded);
        self::assertStringNotContainsString('Private Hand Card', $encoded);
        self::assertStringNotContainsString('Private Library Top', $encoded);
        self::assertStringNotContainsString('private-hand@v1', $encoded);
        self::assertStringNotContainsString('private-library@v1', $encoded);
        self::assertStringNotContainsString('Private hand oracle', $encoded);
        self::assertStringNotContainsString('Private library oracle', $encoded);
        self::assertStringNotContainsString('cardFaces', $encoded);
        self::assertStringNotContainsString('imageUris', $encoded);
    }

    /**
     * @return array{Game, User}
     */
    private function game(): array
    {
        $viewer = new User('viewer@example.test', 'Viewer');
        $room = new Room($viewer);
        $room->addPlayer(new RoomPlayer($room, $viewer));

        return [new Game($room, ['version' => 1, 'players' => [$viewer->id() => ['zones' => []]]]), $viewer];
    }

    private function entityManager(Game $game): EntityManagerInterface
    {
        $repository = $this->createMock(EntityRepository::class);
        $repository->expects(self::once())->method('find')->with($game->id())->willReturn($game);

        $entityManager = $this->createMock(EntityManagerInterface::class);
        $entityManager->method('getRepository')->with(Game::class)->willReturn($repository);

        return $entityManager;
    }

    private function debugHealth(): GameDebugHealthLiveStore
    {
        return new GameDebugHealthLiveStore(new GameDebugHealthAggregator());
    }

    private function controllerContainer(): ContainerInterface
    {
        return new class implements ContainerInterface {
            public function get(string $id): mixed
            {
                throw new \RuntimeException(sprintf('Service %s is not available in this test container.', $id));
            }

            public function has(string $id): bool
            {
                return false;
            }
        };
    }

    /**
     * @return array<string,mixed>
     */
    private function projectedSnapshot(User $viewer, array $overrides = []): array
    {
        return array_replace_recursive([
            'version' => 2,
            'ownerId' => $viewer->id(),
            'players' => [
                $viewer->id() => [
                    'user' => $viewer->toArray(),
                    'life' => 40,
                    'status' => 'active',
                    'handCount' => 0,
                    'zoneCounts' => [
                        'battlefield' => 1,
                    ],
                    'commanderDamage' => [],
                    'counters' => [],
                    'zones' => [
                        'battlefield' => [[
                            'instanceId' => 'battlefield-1',
                            'ownerId' => $viewer->id(),
                            'controllerId' => $viewer->id(),
                            'scryfallId' => '33333333-3333-3333-3333-333333333333',
                            'name' => 'Battlefield Card',
                            'tapped' => false,
                            'zone' => 'battlefield',
                        ]],
                    ],
                ],
            ],
            'turn' => ['activePlayerId' => $viewer->id(), 'phase' => 'main-1', 'number' => 1],
            'stack' => [],
            'arrows' => [],
            'attachments' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
            'updatedAt' => '2026-01-01T00:00:00+00:00',
        ], $overrides);
    }
}
