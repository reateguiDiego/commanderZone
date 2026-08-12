<?php

namespace App\Tests\UI\Http;

use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\GameControlPlaneProjection;
use App\Application\Game\GameRematchService;
use App\Application\Game\Runtime\GameRuntimeCommandClientInterface;
use App\Application\Game\Runtime\GameRuntimeCommandResult;
use App\Application\Game\Runtime\GameRuntimeLifecycleCommandService;
use App\Application\Game\Runtime\GameRuntimeLifecycleControlClient;
use App\Application\Game\Runtime\GameplayRuntimeGateway;
use App\Application\Game\Runtime\GameplayRuntimePatchAdapter;
use App\Application\Game\Runtime\GameplayRuntimeRouter;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use App\Infrastructure\Realtime\GameEventPublisher;
use App\Infrastructure\Realtime\RoomEventPublisher;
use App\UI\Http\GamesController;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class GamesControllerLeaveLifecycleTest extends TestCase
{
    public function testActiveRematchLeaveRequiresDurableLifecycleProjectionBeforeMembershipMutation(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $leavingPlayer = new User('leaving@example.test', 'Leaving player');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $room->addPlayer(new RoomPlayer($room, $leavingPlayer));
        $game = new Game($room, [
            'version' => 7,
            'players' => [
                $owner->id() => ['status' => 'active', 'life' => 40],
                $leavingPlayer->id() => ['status' => 'active', 'life' => 40],
            ],
        ]);

        $repository = $this->createMock(EntityRepository::class);
        $repository->expects(self::once())->method('find')->with($game->id())->willReturn($game);
        $entityManager = $this->createMock(EntityManagerInterface::class);
        $entityManager->expects(self::once())->method('getRepository')->with(Game::class)->willReturn($repository);
        // Simulates a Go acknowledgement whose lifecycle POST could not yet be
        // persisted by Symfony: refresh leaves the durable Game unchanged.
        $entityManager->expects(self::once())->method('refresh')->with($game);
        $entityManager->expects(self::never())->method('beginTransaction');

        $runtimeClient = new class implements GameRuntimeCommandClientInterface {
            /** @var list<array{type:string,gameId:string,actorId:string,baseVersion:int,clientActionId:string,payload:array<string,mixed>}> */
            public array $calls = [];

            public function dispatch(
                string $type,
                string $gameId,
                string $actorId,
                int $baseVersion,
                string $clientActionId,
                array $payload,
                bool $shadow = false,
            ): GameRuntimeCommandResult {
                $this->calls[] = compact('type', 'gameId', 'actorId', 'baseVersion', 'clientActionId', 'payload');

                return new GameRuntimeCommandResult([
                    'gameId' => $gameId,
                    'version' => $baseVersion + 1,
                    'type' => $type,
                ], []);
            }
        };
        $runtimeLifecycle = new GameRuntimeLifecycleCommandService(new GameplayRuntimeGateway(
            new GameplayRuntimeRouter(new GameplayV2Flags(
                commandEnabled: true,
                patchEnabled: true,
                bootstrapEnabled: true,
                eventEnabled: true,
                visibilityEnabled: true,
                enabled: true,
                commandsAllowlist: 'game.concede',
                runtimeServiceEnabled: true,
            ), $runtimeClient),
            new GameplayRuntimePatchAdapter(),
        ));

        $gamePublisher = $this->createMock(GameEventPublisher::class);
        $gamePublisher->expects(self::never())->method('publishControlPlane');
        $roomPublisher = $this->createMock(RoomEventPublisher::class);
        $roomPublisher->expects(self::never())->method('publish');

        $controller = new GamesController();
        $controller->setContainer($this->controllerContainer());
        $response = $controller->rematchVote(
            $game->id(),
            Request::create('/games/'.$game->id().'/rematch-vote', 'POST', [], [], [], [], json_encode([
                'vote' => GameRematchService::VOTE_LEAVE,
                'clientActionId' => 'leave-while-active-1',
            ], JSON_THROW_ON_ERROR)),
            $leavingPlayer,
            $entityManager,
            new GameRematchService(),
            new GameControlPlaneProjection(),
            $gamePublisher,
            $roomPublisher,
            new GameRuntimeLifecycleControlClient($this->createStub(HttpClientInterface::class)),
            $runtimeLifecycle,
        );

        $payload = json_decode($response->getContent() ?: '[]', true, flags: JSON_THROW_ON_ERROR);
        self::assertSame(503, $response->getStatusCode());
        self::assertSame('LIFECYCLE_CONFIRMATION_PENDING', $payload['code']);
        self::assertTrue($room->hasPlayer($leavingPlayer));
        self::assertSame([], $game->rematchState()['votes']);
        self::assertCount(0, $game->events());
        self::assertCount(1, $runtimeClient->calls);
        self::assertSame('game.concede', $runtimeClient->calls[0]['type']);
        self::assertSame($game->id(), $runtimeClient->calls[0]['gameId']);
        self::assertSame($leavingPlayer->id(), $runtimeClient->calls[0]['actorId']);
        self::assertSame(7, $runtimeClient->calls[0]['baseVersion']);
        self::assertStringStartsWith('lifecycle:concede:room_leave:', $runtimeClient->calls[0]['clientActionId']);
        self::assertSame([
            'playerId' => $leavingPlayer->id(),
            'reason' => 'room_leave',
        ], $runtimeClient->calls[0]['payload']);
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
}
