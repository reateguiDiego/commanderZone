<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\WebSocket\GameWebsocketAccessService;
use App\Application\Game\WebSocket\GameWebsocketConnectionAuthorizer;
use App\Application\Game\WebSocket\GameWebsocketTicketManager;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Doctrine\Persistence\ManagerRegistry;
use Doctrine\Persistence\ObjectManager;
use Doctrine\Persistence\ObjectRepository;
use PHPUnit\Framework\TestCase;

class GameWebsocketConnectionAuthorizerTest extends TestCase
{
    public function testAuthorizesAccessibleGameAndClearsManager(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $game = new Game($room, ['players' => []]);
        $ticketManager = new GameWebsocketTicketManager('test-secret');
        $ticket = $ticketManager->issue($game->id(), $owner->id())->ticket;

        $authorizer = new GameWebsocketConnectionAuthorizer(
            $ticketManager,
            new GameWebsocketAccessService(),
            $this->registry($game, $owner, expectClear: true),
        );

        $context = $authorizer->authorize($game->id(), $ticket);

        self::assertSame($game->id(), $context->gameId);
        self::assertSame($owner->id(), $context->userId);
        self::assertSame('Owner', $context->displayName);
    }

    public function testAuthorizesRoomPlayerAndClearsManager(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $player = new User('player@example.test', 'Player');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $room->addPlayer(new RoomPlayer($room, $player));
        $game = new Game($room, ['players' => []]);
        $ticketManager = new GameWebsocketTicketManager('test-secret');
        $ticket = $ticketManager->issue($game->id(), $player->id())->ticket;

        $authorizer = new GameWebsocketConnectionAuthorizer(
            $ticketManager,
            new GameWebsocketAccessService(),
            $this->registry($game, $player, expectClear: true),
        );

        $context = $authorizer->authorize($game->id(), $ticket);

        self::assertSame($game->id(), $context->gameId);
        self::assertSame($player->id(), $context->userId);
        self::assertSame('Player', $context->displayName);
    }

    public function testAuthorizesSnapshotViewerAndClearsManager(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $game = new Game($room, ['players' => [$viewer->id() => ['zones' => []]]]);
        $ticketManager = new GameWebsocketTicketManager('test-secret');
        $ticket = $ticketManager->issue($game->id(), $viewer->id())->ticket;

        $authorizer = new GameWebsocketConnectionAuthorizer(
            $ticketManager,
            new GameWebsocketAccessService(),
            $this->registry($game, $viewer, expectClear: true),
        );

        $context = $authorizer->authorize($game->id(), $ticket);

        self::assertSame($game->id(), $context->gameId);
        self::assertSame($viewer->id(), $context->userId);
        self::assertSame('Viewer', $context->displayName);
    }

    public function testRejectsOutsiderAndClearsManager(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $outsider = new User('outsider@example.test', 'Outsider');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $game = new Game($room, ['players' => []]);
        $ticketManager = new GameWebsocketTicketManager('test-secret');
        $ticket = $ticketManager->issue($game->id(), $outsider->id())->ticket;
        $authorizer = new GameWebsocketConnectionAuthorizer(
            $ticketManager,
            new GameWebsocketAccessService(),
            $this->registry($game, $outsider, expectClear: true),
        );

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Game access denied.');

        $authorizer->authorize($game->id(), $ticket);
    }

    public function testRejectsInvalidTicketBeforeLoadingFromDatabase(): void
    {
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::never())->method('getManagerForClass');
        $authorizer = new GameWebsocketConnectionAuthorizer(
            new GameWebsocketTicketManager('test-secret'),
            new GameWebsocketAccessService(),
            $registry,
        );

        $this->expectException(\InvalidArgumentException::class);

        $authorizer->authorize('game-1', 'not-a-ticket');
    }

    public function testRejectsExpiredTicketBeforeLoadingFromDatabase(): void
    {
        $ticketManager = new GameWebsocketTicketManager('test-secret');
        $ticket = $ticketManager->issue('game-1', 'user-1', new \DateTimeImmutable('-2 minutes'))->ticket;
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::never())->method('getManagerForClass');
        $authorizer = new GameWebsocketConnectionAuthorizer($ticketManager, new GameWebsocketAccessService(), $registry);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('expired');

        $authorizer->authorize('game-1', $ticket);
    }

    private function registry(Game $game, User $user, bool $expectClear): ManagerRegistry
    {
        $gameRepository = $this->createMock(ObjectRepository::class);
        $gameRepository->expects(self::once())->method('find')->with($game->id())->willReturn($game);
        $userRepository = $this->createMock(ObjectRepository::class);
        $userRepository->expects(self::once())->method('find')->with($user->id())->willReturn($user);
        $manager = $this->createMock(ObjectManager::class);
        $manager->method('getRepository')->willReturnMap([
            [Game::class, $gameRepository],
            [User::class, $userRepository],
        ]);
        $manager->expects($expectClear ? self::once() : self::never())->method('clear');
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::once())->method('getManagerForClass')->with(Game::class)->willReturn($manager);

        return $registry;
    }
}
