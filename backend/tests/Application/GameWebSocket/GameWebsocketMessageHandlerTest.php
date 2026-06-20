<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\WebSocket\GameWebsocketMessageHandler;
use App\Application\Game\WebSocket\GameWebsocketMulliganService;
use App\Application\Game\WebSocket\GameWebsocketPeer;
use App\Application\Game\WebSocket\GameWebsocketCommandPatchService;
use App\Application\Game\WebSocket\GameWebsocketMessageFactory;
use App\Application\Game\WebSocket\GameWebsocketPatchBuilder;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameDisconnectVoteService;
use App\Application\Game\GameProjectionService;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use PHPUnit\Framework\TestCase;

class GameWebsocketMessageHandlerTest extends TestCase
{
    public function testRespondsToPingWithPong(): void
    {
        $reply = $this->handler()->handle([
            'kind' => 'ping',
            'messageId' => 'ping-1',
            'sentAt' => '2026-01-01T00:00:00+00:00',
        ], $this->peer('game-1'));

        self::assertSame('pong', $reply['kind']);
        self::assertSame('game-1', $reply['gameId']);
        self::assertSame('ping-1', $reply['messageId']);
        self::assertArrayHasKey('serverTime', $reply);
    }

    public function testRejectsMessagesForAnotherGame(): void
    {
        $reply = $this->handler()->handle([
            'kind' => 'ping',
            'gameId' => 'game-2',
            'messageId' => 'ping-1',
        ], $this->peer('game-1'));

        self::assertSame('error', $reply['kind']);
        self::assertSame('game-1', $reply['gameId']);
        self::assertSame('GAME_ID_MISMATCH', $reply['error']['code']);
    }

    public function testRejectsPingWithoutMessageId(): void
    {
        $reply = $this->handler()->handle([
            'kind' => 'ping',
            'gameId' => 'game-1',
        ], $this->peer());

        self::assertSame('error', $reply['kind']);
        self::assertSame('INVALID_MESSAGE', $reply['error']['code']);
    }

    public function testDelegatesSupportedCommandsAndReturnsGamePatch(): void
    {
        $actor = new User('actor@example.test', 'Actor');
        $game = $this->game($actor);

        $result = $this->handler($game, $actor)->handle([
            'kind' => 'command',
            'gameId' => $game->id(),
            'messageId' => 'message-1',
            'command' => [
                'type' => 'life.changed',
                'payload' => ['playerId' => $actor->id(), 'delta' => -1],
                'clientActionId' => 'action-1',
                'baseVersion' => 1,
            ],
        ], $this->peer($game->id(), $actor->id()));
        $reply = $result->messageForUserId($actor->id());

        self::assertSame('game_patch', $reply['kind']);
        self::assertSame('action-1', $reply['clientActionId']);
        self::assertSame(2, $reply['version']);
        self::assertSame('player.life.set', $reply['operations'][0]['op']);
    }

    public function testDelegatesV2CommandsAndReturnsPatchV2WhenEnabled(): void
    {
        $actor = new User('actor@example.test', 'Actor');
        $game = $this->game($actor);

        $result = $this->handler($game, $actor, flagsV2: new GameplayV2Flags(true, true, false, false))->handle([
            'kind' => 'command.v2',
            'gameId' => $game->id(),
            'messageId' => 'message-v2',
            'type' => 'life.changed',
            'payload' => ['playerId' => $actor->id(), 'delta' => -1],
            'clientActionId' => 'action-v2',
            'baseVersion' => 1,
            'sentAt' => '2026-01-01T00:00:00+00:00',
            'client' => ['platform' => 'web'],
        ], $this->peer($game->id(), $actor->id()));
        $reply = $result->messageForUserId($actor->id());

        self::assertSame('patch.v2', $reply['kind']);
        self::assertSame($game->id(), $reply['gameId']);
        self::assertSame(2, $reply['version']);
        self::assertSame('player:'.$actor->id(), $reply['visibility']);
        self::assertSame('action-v2', $reply['ackClientActionId']);
        self::assertSame('player.life.set', $reply['ops'][0]['op']);
    }

    public function testDelegatesBattlefieldPositionCommandsAndReturnsTypedPatch(): void
    {
        $actor = new User('actor@example.test', 'Actor');
        $game = $this->game($actor, [[
            'instanceId' => 'battlefield-1',
            'ownerId' => $actor->id(),
            'controllerId' => $actor->id(),
            'name' => 'Battlefield One',
            'tapped' => false,
            'position' => ['x' => 0.1, 'y' => 0.2, 'unit' => 'ratio'],
        ]]);

        $result = $this->handler($game, $actor)->handle([
            'kind' => 'command',
            'gameId' => $game->id(),
            'messageId' => 'message-1',
            'command' => [
                'type' => 'card.position.changed',
                'payload' => [
                    'playerId' => $actor->id(),
                    'zone' => 'battlefield',
                    'instanceId' => 'battlefield-1',
                    'position' => ['x' => 0.25, 'y' => 0.5, 'unit' => 'ratio'],
                ],
                'clientActionId' => 'action-position',
                'baseVersion' => 1,
            ],
        ], $this->peer($game->id(), $actor->id()));
        $reply = $result->messageForUserId($actor->id());

        self::assertSame('game_patch', $reply['kind']);
        self::assertSame('action-position', $reply['clientActionId']);
        self::assertSame('card.position.set', $reply['operations'][0]['op']);
        self::assertSame(['x' => 0.25, 'y' => 0.5, 'unit' => 'ratio'], $reply['operations'][0]['position']);
    }

    public function testDelegatesPowerToughnessAndLoyaltyCommandsAndReturnsTypedPatch(): void
    {
        $actor = new User('actor@example.test', 'Actor');
        $game = $this->game($actor, [[
            'instanceId' => 'battlefield-1',
            'ownerId' => $actor->id(),
            'controllerId' => $actor->id(),
            'name' => 'Adept',
            'power' => 2,
            'toughness' => 3,
            'loyalty' => 4,
            'tapped' => false,
        ]]);

        $result = $this->handler($game, $actor)->handle([
            'kind' => 'command',
            'gameId' => $game->id(),
            'messageId' => 'message-1',
            'command' => [
                'type' => 'card.power_toughness.changed',
                'payload' => [
                    'playerId' => $actor->id(),
                    'zone' => 'battlefield',
                    'instanceId' => 'battlefield-1',
                    'power' => 5,
                    'toughness' => 6,
                    'loyalty' => 7,
                ],
                'clientActionId' => 'action-stats',
                'baseVersion' => 1,
            ],
        ], $this->peer($game->id(), $actor->id()));
        $reply = $result->messageForUserId($actor->id());

        self::assertSame('game_patch', $reply['kind']);
        self::assertSame('action-stats', $reply['clientActionId']);
        self::assertSame('card.stats.set', $reply['operations'][0]['op']);
        self::assertSame(5, $reply['operations'][0]['power']);
        self::assertSame(6, $reply['operations'][0]['toughness']);
        self::assertSame(7, $reply['operations'][0]['loyalty']);
    }

    public function testRejectsUnsupportedCommandsOverWebsocket(): void
    {
        $reply = $this->handler()->handle([
            'kind' => 'command',
            'gameId' => 'game-1',
            'messageId' => 'message-1',
            'command' => [
                'type' => 'not.migrated',
                'payload' => ['playerId' => 'player-1'],
                'clientActionId' => 'action-1',
                'baseVersion' => 14,
            ],
        ], $this->peer());

        self::assertSame('command_ack', $reply['kind']);
        self::assertSame('rejected', $reply['status']);
        self::assertSame('action-1', $reply['clientActionId']);
        self::assertSame(14, $reply['version']);
        self::assertSame('COMMAND_NOT_SUPPORTED_OVER_WEBSOCKET', $reply['error']['code']);
    }

    public function testRoutesMulliganEventsToMulliganService(): void
    {
        $manager = $this->createMock(EntityManagerInterface::class);
        $gameRepository = $this->createMock(EntityRepository::class);
        $gameRepository->expects(self::once())->method('find')->with('game-1')->willReturn(null);
        $userRepository = $this->createMock(EntityRepository::class);
        $userRepository->expects(self::once())->method('find')->with('user-1')->willReturn(null);
        $manager->method('getRepository')->willReturnMap([
            [Game::class, $gameRepository],
            [User::class, $userRepository],
        ]);
        $manager->expects(self::once())->method('clear');
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::once())->method('getManagerForClass')->with(Game::class)->willReturn($manager);

        $reply = $this->handler(mulligans: new GameWebsocketMulliganService(new GameCommandHandler(), $registry))->handle([
            'kind' => 'mulligan.take',
            'gameId' => 'game-1',
            'messageId' => 'message-mulligan',
        ], $this->peer('game-1', 'user-1'));

        self::assertSame('mulligan.error', $reply['kind']);
        self::assertSame('NOT_IN_GAME', $reply['error']['code']);
        self::assertSame('message-mulligan', $reply['messageId']);
    }

    public function testRejectsCommandWithoutClientActionId(): void
    {
        $reply = $this->handler()->handle([
            'kind' => 'command',
            'gameId' => 'game-1',
            'messageId' => 'message-1',
            'command' => [
                'type' => 'life.changed',
                'payload' => ['playerId' => 'player-1', 'delta' => -1],
                'baseVersion' => 14,
            ],
        ], $this->peer());

        self::assertSame('error', $reply['kind']);
        self::assertSame('INVALID_COMMAND_MESSAGE', $reply['error']['code']);
    }

    public function testRejectsCommandWithoutMessageId(): void
    {
        $reply = $this->handler()->handle([
            'kind' => 'command',
            'gameId' => 'game-1',
            'command' => [
                'type' => 'life.changed',
                'payload' => ['playerId' => 'player-1', 'delta' => -1],
                'clientActionId' => 'action-1',
                'baseVersion' => 14,
            ],
        ], $this->peer());

        self::assertSame('error', $reply['kind']);
        self::assertSame('INVALID_COMMAND_MESSAGE', $reply['error']['code']);
    }

    public function testRejectsCommandWithoutValidBaseVersion(): void
    {
        $reply = $this->handler()->handle([
            'kind' => 'command',
            'gameId' => 'game-1',
            'messageId' => 'message-1',
            'command' => [
                'type' => 'life.changed',
                'payload' => ['playerId' => 'player-1', 'delta' => -1],
                'clientActionId' => 'action-1',
                'baseVersion' => 0,
            ],
        ], $this->peer());

        self::assertSame('error', $reply['kind']);
        self::assertSame('INVALID_COMMAND_MESSAGE', $reply['error']['code']);
    }

    public function testRejectsUnknownMessageKind(): void
    {
        $reply = $this->handler()->handle([
            'kind' => 'unknown',
            'gameId' => 'game-1',
            'messageId' => 'message-1',
        ], $this->peer());

        self::assertSame('error', $reply['kind']);
        self::assertSame('UNKNOWN_MESSAGE_KIND', $reply['error']['code']);
    }

    private function handler(
        ?Game $game = null,
        ?User $actor = null,
        ?GameWebsocketMulliganService $mulligans = null,
        ?GameplayV2Flags $flagsV2 = null,
    ): GameWebsocketMessageHandler
    {
        $messages = new GameWebsocketMessageFactory();
        $contractsV2 = new GameplayV2ContractFactory();

        return new GameWebsocketMessageHandler(new GameWebsocketCommandPatchService(
            new GameCommandHandler(),
            new GameDisconnectVoteService(new GameCommandHandler()),
            new GameWebsocketPatchBuilder($messages),
            $messages,
            new \App\Application\Game\WebSocket\GameWebsocketRoomRegistry(),
            $this->registry($game, $actor),
            new GameProjectionService(new GameCommandHandler()),
            null,
            null,
            null,
            $contractsV2,
            $flagsV2,
        ), $mulligans, $contractsV2, $flagsV2);
    }

    private function registry(?Game $game, ?User $actor): ManagerRegistry
    {
        $registry = $this->createMock(ManagerRegistry::class);
        if (!$game instanceof Game || !$actor instanceof User) {
            $registry->expects(self::never())->method('getManagerForClass');

            return $registry;
        }

        $gameRepository = $this->createMock(EntityRepository::class);
        $gameRepository->expects(self::once())->method('find')->with($game->id())->willReturn($game);
        $userRepository = $this->createMock(EntityRepository::class);
        $userRepository->expects(self::once())->method('find')->with($actor->id())->willReturn($actor);
        $eventRepository = $this->createMock(EntityRepository::class);
        $eventRepository->expects(self::once())->method('findOneBy')->willReturn(null);

        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->method('getRepository')->willReturnMap([
            [Game::class, $gameRepository],
            [User::class, $userRepository],
            [\App\Domain\Game\GameEvent::class, $eventRepository],
        ]);
        $manager->expects(self::once())->method('beginTransaction');
        $manager->expects(self::once())->method('lock')->with($game, \Doctrine\DBAL\LockMode::PESSIMISTIC_WRITE);
        $manager->expects(self::once())->method('persist')->with(self::isInstanceOf(\App\Domain\Game\GameEvent::class));
        $manager->expects(self::once())->method('flush');
        $manager->expects(self::once())->method('commit');
        $manager->expects(self::once())->method('clear');

        $registry->expects(self::once())->method('getManagerForClass')->with(Game::class)->willReturn($manager);

        return $registry;
    }

    /**
     * @param list<array<string,mixed>> $battlefield
     */
    private function game(User $actor, array $battlefield = []): Game
    {
        $room = new Room($actor);
        $room->addPlayer(new RoomPlayer($room, $actor));

        return new Game($room, [
            'version' => 1,
            'ownerId' => $actor->id(),
            'players' => [
                $actor->id() => [
                    'user' => $actor->toArray(),
                    'life' => 40,
                    'zones' => [
                        'library' => [],
                        'hand' => [],
                        'battlefield' => $battlefield,
                        'graveyard' => [],
                        'exile' => [],
                        'command' => [],
                    ],
                    'zoneCounts' => [
                        'library' => 0,
                        'hand' => 0,
                        'battlefield' => count($battlefield),
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
        ]);
    }

    private function peer(string $gameId = 'game-1', string $userId = 'user-1'): GameWebsocketPeer
    {
        return new GameWebsocketPeer(
            connectionId: 'connection-1',
            gameId: $gameId,
            userId: $userId,
            displayName: 'Player',
            connectedAt: new \DateTimeImmutable('2026-01-01T00:00:00+00:00'),
            send: static fn (array $message): null => null,
        );
    }
}
