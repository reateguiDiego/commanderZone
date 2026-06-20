<?php

namespace App\Tests\UI\Http;

use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\Debug\GameDebugHealthAggregator;
use App\Application\Game\Debug\GameDebugHealthLiveStore;
use App\Application\Game\GameProjectionService;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use App\UI\Http\GamesController;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;

class GamesControllerV2Test extends TestCase
{
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
    private function projectedSnapshot(User $viewer): array
    {
        return [
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
        ];
    }
}
