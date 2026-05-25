<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameDisconnectVoteService;
use App\Application\Game\GameProjectionService;
use App\Application\Game\WebSocket\GameWebsocketDisconnectVoteOrchestrator;
use App\Application\Game\WebSocket\GameWebsocketMessageFactory;
use App\Application\Game\WebSocket\GameWebsocketPatchBuilder;
use App\Application\Game\WebSocket\GameWebsocketRoomRegistry;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use PHPUnit\Framework\TestCase;

class GameWebsocketDisconnectVoteOrchestratorTest extends TestCase
{
    public function testMutateGameRollsBackAndRethrowsWhenFlushFails(): void
    {
        [$game, $owner] = $this->game();
        $event = new GameEvent($game, 'disconnect.vote.updated', [], $owner, 'action-1');
        $manager = $this->manager($game);
        $manager->expects(self::once())->method('beginTransaction');
        $manager->expects(self::once())->method('lock')->with($game, LockMode::PESSIMISTIC_WRITE);
        $manager->expects(self::once())->method('persist')->with($event);
        $manager->expects(self::once())->method('flush')->willThrowException(new \RuntimeException('flush failed'));
        $manager->expects(self::never())->method('commit');
        $manager->expects(self::once())->method('rollback');
        $manager->expects(self::once())->method('clear');

        $registry = $this->registry($manager);
        $orchestrator = $this->orchestrator($registry);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('flush failed');

        $this->invokeMutateGame(
            $orchestrator,
            $game->id(),
            static fn (): array => ['event' => $event, 'snapshot' => $game->snapshot()],
        );
    }

    public function testMutateGameRollsBackAndReturnsNullForInvalidArgumentExceptions(): void
    {
        [$game] = $this->game();
        $manager = $this->manager($game);
        $manager->expects(self::once())->method('beginTransaction');
        $manager->expects(self::once())->method('lock')->with($game, LockMode::PESSIMISTIC_WRITE);
        $manager->expects(self::never())->method('persist');
        $manager->expects(self::never())->method('flush');
        $manager->expects(self::never())->method('commit');
        $manager->expects(self::once())->method('rollback');
        $manager->expects(self::once())->method('clear');

        $registry = $this->registry($manager);
        $orchestrator = $this->orchestrator($registry);

        $result = $this->invokeMutateGame(
            $orchestrator,
            $game->id(),
            static function (): void {
                throw new \InvalidArgumentException('invalid');
            },
        );

        self::assertNull($result);
    }

    private function invokeMutateGame(
        GameWebsocketDisconnectVoteOrchestrator $orchestrator,
        string $gameId,
        callable $mutation,
    ): mixed {
        $method = new \ReflectionMethod($orchestrator, 'mutateGame');
        $method->setAccessible(true);

        return $method->invoke($orchestrator, $gameId, $mutation);
    }

    private function manager(Game $game): EntityManagerInterface
    {
        $gameRepository = $this->createMock(EntityRepository::class);
        $gameRepository->expects(self::once())->method('find')->with($game->id())->willReturn($game);

        $connection = $this->createMock(Connection::class);
        $connection->method('isTransactionActive')->willReturn(true);

        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->method('getRepository')->willReturnMap([
            [Game::class, $gameRepository],
        ]);
        $manager->method('getConnection')->willReturn($connection);

        return $manager;
    }

    private function registry(EntityManagerInterface $manager): ManagerRegistry
    {
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::once())->method('getManagerForClass')->with(Game::class)->willReturn($manager);

        return $registry;
    }

    private function orchestrator(ManagerRegistry $registry): GameWebsocketDisconnectVoteOrchestrator
    {
        $messages = new GameWebsocketMessageFactory();
        $handler = new GameCommandHandler();

        return new GameWebsocketDisconnectVoteOrchestrator(
            new GameDisconnectVoteService($handler),
            new GameWebsocketPatchBuilder($messages),
            $messages,
            new GameWebsocketRoomRegistry(),
            $registry,
            new GameProjectionService($handler),
        );
    }

    /**
     * @return array{Game, User}
     */
    private function game(): array
    {
        $owner = new User('owner@example.test', 'Owner');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));

        return [new Game($room, $this->snapshot($owner)), $owner];
    }

    /**
     * @return array<string,mixed>
     */
    private function snapshot(User $owner): array
    {
        return [
            'version' => 1,
            'ownerId' => $owner->id(),
            'players' => [
                $owner->id() => [
                    'user' => $owner->toArray(),
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
            'turn' => ['activePlayerId' => $owner->id(), 'phase' => 'main-1', 'number' => 1],
            'timer' => ['mode' => 'none', 'status' => 'idle', 'durationSeconds' => null, 'remainingSeconds' => null],
            'stack' => [],
            'arrows' => [],
            'attachments' => [],
            'chat' => [],
            'eventLog' => [],
            'disconnectVotes' => [
                'open' => false,
                'targetPlayerId' => null,
                'openedAt' => null,
                'expiresAt' => null,
                'votes' => [],
                'requiredVotes' => 0,
            ],
            'createdAt' => '2026-01-01T00:00:00+00:00',
            'updatedAt' => '2026-01-01T00:00:00+00:00',
        ];
    }
}
