<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameLibraryOps;
use App\Application\Game\GameMulliganRules;
use App\Application\Game\GameRandomizer;
use App\Application\Game\WebSocket\GameWebsocketMulliganService;
use App\Application\Game\WebSocket\GameWebsocketPeer;
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

class GameWebsocketMulliganServiceTest extends TestCase
{
    public function testTakeMulliganUpdatesPrivateAndPublicState(): void
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_LONDON, true, 0, [
            'hand' => $this->cards('hand', 7, 'hand'),
            'library' => $this->cards('library', 7, 'library'),
        ]);
        $service = $this->service($game, $actor, expectPersist: true);

        $result = $service->handle('mulligan.take', ['gameId' => $game->id()], $this->peer($game, $actor), 'message-take');
        $messages = $result->messagesForUserId($actor->id());

        self::assertSame(['mulligan.public_state', 'mulligan.private_state'], array_column($messages, 'kind'));
        $private = $this->messageOfKind($messages, 'mulligan.private_state');
        self::assertSame(1, $private['mulligan']['mulligansTaken']);
        self::assertSame('DECIDING', $private['mulligan']['status']);
        self::assertCount(7, $private['hand']);

        $public = $this->messageOfKind($messages, 'mulligan.public_state');
        self::assertSame(7, $public['players'][0]['handCount']);
        self::assertSame(1, $public['players'][0]['mulligansTaken']);
    }

    public function testPrivateStateIncludesCompactHandWithoutStaticPayloadAndPayloadMetrics(): void
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_LONDON, true, 0, [
            'hand' => [[
                ...$this->card('hand-1', 'Heavy Private Card', 'hand'),
                'cardKey' => 'heavy-card@1',
                'imageUris' => ['normal' => 'https://cards.example/heavy.jpg'],
                'oracleText' => 'Private oracle text',
                'cardFaces' => [['name' => 'Face A']],
                'typeLine' => 'Creature - Test',
            ]],
            'library' => $this->cards('library', 7, 'library'),
        ]);
        $service = $this->service($game, $actor, expectPersist: true);

        $result = $service->handle('mulligan.keep', ['gameId' => $game->id()], $this->peer($game, $actor), 'message-compact');
        $private = $this->messageOfKind($result->messagesForUserId($actor->id()), 'mulligan.private_state');
        $compactJson = json_encode($private['handCompact'], JSON_THROW_ON_ERROR);

        self::assertSame([['instanceId' => 'hand-1', 'cardKey' => null]], $private['handCompact']);
        self::assertStringNotContainsString('imageUris', $compactJson);
        self::assertStringNotContainsString('oracleText', $compactJson);
        self::assertStringNotContainsString('cardFaces', $compactJson);
        self::assertStringNotContainsString('typeLine', $compactJson);
        self::assertGreaterThan(0, $result->debugProfile()['mulligan.public_payload_bytes'] ?? 0);
        self::assertGreaterThan(0, $result->debugProfile()['mulligan.private_payload_bytes'] ?? 0);
    }

    public function testPrivateStateOnlyGoesToActingPlayer(): void
    {
        [$game, $actor, $opponent] = $this->mulliganGame(Room::MULLIGAN_LONDON, true, 0, [
            'hand' => $this->cards('hand', 7, 'hand'),
            'library' => $this->cards('library', 7, 'library'),
        ], [
            'hand' => [
                [...$this->card('opponent-secret-1', 'Opponent Secret', 'hand'), 'oracleText' => 'Hidden text'],
            ],
        ]);
        $service = $this->service($game, $actor, expectPersist: true);

        $result = $service->handle('mulligan.take', ['gameId' => $game->id()], $this->peer($game, $actor), 'message-private');

        self::assertSame(['mulligan.public_state', 'mulligan.private_state'], array_column($result->messagesForUserId($actor->id()), 'kind'));
        self::assertSame(['mulligan.public_state'], array_column($result->messagesForUserId($opponent->id()), 'kind'));
        self::assertStringNotContainsString('Opponent Secret', json_encode($result->messagesForUserId($actor->id()), JSON_THROW_ON_ERROR));
        self::assertStringNotContainsString('Opponent Secret', json_encode($result->messagesForUserId($opponent->id()), JSON_THROW_ON_ERROR));
        self::assertStringNotContainsString('Hidden text', json_encode($result->messagesForUserId($opponent->id()), JSON_THROW_ON_ERROR));
    }

    public function testKeepLondonWithValidBottomMovesPlayerToReady(): void
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_LONDON, false, 1, [
            'hand' => $this->cards('hand', 7, 'hand'),
            'library' => $this->cards('library', 1, 'library'),
        ]);
        $service = $this->service($game, $actor, expectPersist: true);

        $result = $service->handle('mulligan.keep', [
            'gameId' => $game->id(),
            'bottomCardInstanceIds' => ['hand-1'],
        ], $this->peer($game, $actor), 'message-keep');
        $messages = $result->messagesForUserId($actor->id());

        $private = $this->messageOfKind($messages, 'mulligan.private_state');
        $completed = $this->messageOfKind($messages, 'mulligan.completed');
        self::assertSame('READY', $private['mulligan']['status']);
        self::assertCount(6, $private['hand']);
        self::assertSame(['bottomCardCount' => 1], $completed['event']['payload']);
        self::assertArrayNotHasKey('bottomCardInstanceIds', $completed['event']['payload']);
        self::assertSame(['library-1', 'hand-1'], $this->libraryIds($game->snapshot(), $actor->id()));
    }

    public function testKeepGenerousRandomizesBottomServerSide(): void
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_GENEROUS, true, 0, [
            'hand' => $this->cards('hand', 10, 'hand'),
        ]);
        $service = $this->service($game, $actor, expectPersist: true, handler: new GameCommandHandler(null, new class() extends GameRandomizer {
            public function shuffle(array $items): array
            {
                return array_reverse($items);
            }
        }));

        $service->handle('mulligan.keep', [
            'gameId' => $game->id(),
            'bottomCardInstanceIds' => ['hand-1', 'hand-2', 'hand-3'],
        ], $this->peer($game, $actor), 'message-generous');

        self::assertSame(['hand-3', 'hand-2', 'hand-1'], $this->libraryIds($game->snapshot(), $actor->id()));
    }

    public function testRepeatedKeepWhileReadyReturnsNonDestructiveError(): void
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_LONDON, true, 0, [
            'hand' => $this->cards('hand', 7, 'hand'),
            'library' => $this->cards('library', 1, 'library'),
        ], [
            'hand' => $this->cards('opponent-hand', 7, 'hand'),
        ]);
        $this->service($game, $actor, expectPersist: true)
            ->handle('mulligan.keep', ['gameId' => $game->id()], $this->peer($game, $actor), 'message-keep');
        $snapshotAfterKeep = $game->snapshot();

        $message = $this->service($game, $actor, expectPersist: false)
            ->handle('mulligan.keep', ['gameId' => $game->id()], $this->peer($game, $actor), 'message-keep-repeat');

        self::assertSame('mulligan.error', $message['kind']);
        self::assertSame('ALREADY_READY', $message['error']['code']);
        self::assertSame($snapshotAfterKeep, $game->snapshot());
    }

    public function testTakeWhileReadyReturnsNonDestructiveError(): void
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_LONDON, true, 0, [
            'hand' => $this->cards('hand', 7, 'hand'),
            'library' => $this->cards('library', 1, 'library'),
        ], status: 'READY');
        $snapshotBeforeTake = $game->snapshot();
        $service = $this->service($game, $actor, expectPersist: false);

        $message = $service->handle('mulligan.take', ['gameId' => $game->id()], $this->peer($game, $actor), 'message-take-ready');

        self::assertSame('mulligan.error', $message['kind']);
        self::assertSame('ALREADY_READY', $message['error']['code']);
        self::assertSame($snapshotBeforeTake, $game->snapshot());
    }

    public function testDuplicateMulliganMessageIdIsRejectedWithoutMutatingState(): void
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_LONDON, true, 0, [
            'hand' => $this->cards('hand', 7, 'hand'),
            'library' => $this->cards('library', 1, 'library'),
        ]);
        $snapshotBeforeTake = $game->snapshot();
        $existingEvent = new GameEvent($game, 'mulligan.take', [], $actor, 'existing-action');
        $service = $this->service($game, $actor, expectPersist: false, existingEvent: $existingEvent);

        $message = $service->handle('mulligan.take', ['gameId' => $game->id()], $this->peer($game, $actor), 'message-duplicate');

        self::assertSame('mulligan.error', $message['kind']);
        self::assertSame('INVALID_MULLIGAN_STATE', $message['error']['code']);
        self::assertSame('Duplicate mulligan action ignored.', $message['error']['message']);
        self::assertSame($snapshotBeforeTake, $game->snapshot());
    }

    public function testKeepWithCardFromAnotherHandFails(): void
    {
        [$game, $actor, $opponent] = $this->mulliganGame(Room::MULLIGAN_LONDON, false, 1, [
            'hand' => $this->cards('hand', 7, 'hand'),
        ], [
            'hand' => $this->cards('opponent-hand', 7, 'hand'),
        ]);
        $service = $this->service($game, $actor, expectPersist: false);

        $message = $service->handle('mulligan.keep', [
            'gameId' => $game->id(),
            'bottomCardInstanceIds' => ['opponent-hand-1'],
        ], $this->peer($game, $actor), 'message-error');

        self::assertSame('mulligan.error', $message['kind']);
        self::assertSame('CARD_NOT_IN_HAND', $message['error']['code']);
        self::assertSame('DECIDING', $game->snapshot()['players'][$actor->id()]['mulligan']['status']);
        self::assertSame('DECIDING', $game->snapshot()['players'][$opponent->id()]['mulligan']['status']);
    }

    public function testKeepWithIncorrectBottomCountFails(): void
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_LONDON, false, 2, [
            'hand' => $this->cards('hand', 7, 'hand'),
        ]);
        $service = $this->service($game, $actor, expectPersist: false);

        $message = $service->handle('mulligan.keep', [
            'gameId' => $game->id(),
            'bottomCardInstanceIds' => ['hand-1'],
        ], $this->peer($game, $actor), 'message-error');

        self::assertSame('mulligan.error', $message['kind']);
        self::assertSame('INVALID_BOTTOM_COUNT', $message['error']['code']);
    }

    public function testVancouverKeepWithPenaltyEntersScrying(): void
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_VANCOUVER, false, 1, [
            'hand' => $this->cards('hand', 6, 'hand'),
            'library' => $this->cards('library', 2, 'library'),
        ]);
        $service = $this->service($game, $actor, expectPersist: true);

        $result = $service->handle('mulligan.keep', ['gameId' => $game->id()], $this->peer($game, $actor), 'message-vancouver');
        $private = $this->messageOfKind($result->messagesForUserId($actor->id()), 'mulligan.private_state');

        self::assertSame('SCRYING', $private['mulligan']['status']);
        self::assertSame('library-1', $private['scryCard']['instanceId']);
    }

    public function testScryConfirmTopMovesToReadyWithoutMovingTopCard(): void
    {
        [$game, $actor] = $this->scryingVancouverGame();
        $service = $this->service($game, $actor, expectPersist: true);

        $service->handle('mulligan.scry.confirm', [
            'gameId' => $game->id(),
            'destination' => 'TOP',
        ], $this->peer($game, $actor), 'message-scry');

        self::assertSame('READY', $game->snapshot()['players'][$actor->id()]['mulligan']['status']);
        self::assertSame('library-1', $this->libraryIds($game->snapshot(), $actor->id())[0] ?? null);
    }

    public function testScryConfirmBottomMovesTopCardToBottom(): void
    {
        [$game, $actor] = $this->scryingVancouverGame();
        $service = $this->service($game, $actor, expectPersist: true);

        $service->handle('mulligan.scry.confirm', [
            'gameId' => $game->id(),
            'destination' => 'BOTTOM',
        ], $this->peer($game, $actor), 'message-scry');

        self::assertSame('READY', $game->snapshot()['players'][$actor->id()]['mulligan']['status']);
        self::assertSame(['library-2', 'library-1'], $this->libraryIds($game->snapshot(), $actor->id()));
    }

    public function testSpectatorCannotSendMulliganActions(): void
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_LONDON, true, 0, [
            'hand' => $this->cards('hand', 7, 'hand'),
        ]);
        $spectator = new User('spectator@example.test', 'Spectator');
        $snapshot = $game->snapshot();
        $snapshot['players'][$spectator->id()] = $this->player($spectator, []);
        $game->replaceSnapshot($snapshot);
        $service = $this->service($game, $spectator, expectPersist: false, expectTransaction: false);

        $message = $service->handle('mulligan.take', ['gameId' => $game->id()], $this->peer($game, $spectator), 'message-spectator');

        self::assertSame('mulligan.error', $message['kind']);
        self::assertSame('SPECTATOR_NOT_ALLOWED', $message['error']['code']);
        self::assertSame(0, $game->snapshot()['players'][$actor->id()]['mulligan']['mulligansTaken']);
    }

    public function testPublicStateDoesNotLeakPrivateCards(): void
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_LONDON, true, 0, [
            'hand' => [
                [...$this->card('secret-hand-1', 'Secret Spell', 'hand'), 'oracleText' => 'Private text'],
            ],
            'library' => $this->cards('library', 7, 'library'),
        ]);
        $service = $this->service($game, $actor, expectPersist: true);

        $result = $service->handle('mulligan.take', ['gameId' => $game->id()], $this->peer($game, $actor), 'message-public');
        $public = $this->messageOfKind($result->messagesForUserId('spectator-user'), 'mulligan.public_state');
        $encoded = json_encode($public, JSON_THROW_ON_ERROR);

        self::assertStringNotContainsString('Secret Spell', $encoded);
        self::assertStringNotContainsString('secret-hand-1', $encoded);
        self::assertStringNotContainsString('Private text', $encoded);
    }

    public function testInitialStateForReconnectedDecidingPlayerIncludesCurrentPrivateHand(): void
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_LONDON, false, 2, [
            'hand' => $this->cards('hand', 7, 'hand'),
            'library' => $this->cards('library', 3, 'library'),
        ]);
        $service = $this->service($game, $actor, expectPersist: false, expectTransaction: false);

        $messages = $service->initialStateMessages($game->id(), $actor->id());
        $private = $this->messageOfKind($messages, 'mulligan.private_state');

        self::assertSame(['mulligan.public_state', 'mulligan.private_state'], array_column($messages, 'kind'));
        self::assertSame('DECIDING', $private['mulligan']['status']);
        self::assertSame(2, $private['mulligan']['mulligansTaken']);
        self::assertSame(2, $private['mulligan']['bottomSelectionCount']);
        self::assertSame('hand-1', $private['hand'][0]['instanceId']);
        self::assertSame('hand-7', $private['hand'][6]['instanceId']);
    }

    public function testInitialStateForReconnectedScryingPlayerKeepsSamePendingScryCard(): void
    {
        [$game, $actor] = $this->scryingVancouverGame();
        $service = $this->service($game, $actor, expectPersist: false, expectTransaction: false);

        $messages = $service->initialStateMessages($game->id(), $actor->id());
        $private = $this->messageOfKind($messages, 'mulligan.private_state');

        self::assertSame('SCRYING', $private['mulligan']['status']);
        self::assertSame('library-1', $private['scryCard']['instanceId']);
        self::assertSame('library-1', $game->snapshot()['players'][$actor->id()]['mulligan']['scryCardInstanceId']);
    }

    public function testInitialStateForReconnectedReadyPlayerKeepsReadyStatus(): void
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_LONDON, true, 0, [
            'hand' => $this->cards('hand', 7, 'hand'),
        ], status: 'READY');
        $service = $this->service($game, $actor, expectPersist: false, expectTransaction: false);

        $messages = $service->initialStateMessages($game->id(), $actor->id());
        $private = $this->messageOfKind($messages, 'mulligan.private_state');
        $public = $this->messageOfKind($messages, 'mulligan.public_state');

        self::assertSame('MULLIGAN', $public['gamePhase']);
        self::assertSame('READY', $private['mulligan']['status']);
        self::assertTrue($private['mulligan']['ready']);
    }

    public function testInitialStateForSpectatorOnlyContainsPublicState(): void
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_LONDON, true, 0, [
            'hand' => [
                [...$this->card('secret-hand-1', 'Secret Spell', 'hand'), 'oracleText' => 'Private text'],
            ],
        ]);
        $spectator = new User('spectator-'.uniqid('', true).'@example.test', 'Spectator');
        $snapshot = $game->snapshot();
        $snapshot['players'][$spectator->id()] = $this->player($spectator, []);
        $game->replaceSnapshot($snapshot);
        $service = $this->service($game, $spectator, expectPersist: false, expectTransaction: false);

        $messages = $service->initialStateMessages($game->id(), $spectator->id());
        $encoded = json_encode($messages, JSON_THROW_ON_ERROR);

        self::assertSame(['mulligan.public_state'], array_column($messages, 'kind'));
        self::assertStringNotContainsString('Secret Spell', $encoded);
        self::assertStringNotContainsString('secret-hand-1', $encoded);
        self::assertStringNotContainsString('Private text', $encoded);
    }

    /**
     * @param array<string,list<array<string,mixed>>>      $actorZones
     * @param array<string,list<array<string,mixed>>>|null $opponentZones
     *
     * @return array{0:Game,1:User,2?:User}
     */
    private function mulliganGame(
        string $rule,
        bool $firstMulliganFree,
        int $mulligansTaken,
        array $actorZones,
        ?array $opponentZones = null,
        string $status = 'DECIDING',
    ): array {
        $actor = new User('actor-'.uniqid('', true).'@example.test', 'Actor');
        $room = new Room($actor);
        $room->addPlayer(new RoomPlayer($room, $actor));
        $players = [
            $actor->id() => $this->player($actor, $actorZones, $this->mulliganState($rule, $firstMulliganFree, $mulligansTaken, $status)),
        ];

        $opponent = null;
        if ($opponentZones !== null) {
            $opponent = new User('opponent-'.uniqid('', true).'@example.test', 'Opponent');
            $room->addPlayer(new RoomPlayer($room, $opponent));
            $players[$opponent->id()] = $this->player($opponent, $opponentZones, $this->mulliganState($rule, $firstMulliganFree, 0, 'DECIDING'));
        }

        $snapshot = [
            'version' => 1,
            'ownerId' => $actor->id(),
            'gamePhase' => 'MULLIGAN',
            'mulligan' => ['rule' => $rule, 'firstMulliganFree' => $firstMulliganFree],
            'players' => $players,
            'turn' => ['activePlayerId' => $actor->id(), 'phase' => 'main', 'number' => 1],
            'stack' => [],
            'arrows' => [],
            'attachments' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
            'updatedAt' => '2026-01-01T00:00:00+00:00',
        ];

        $game = new Game($room, $snapshot);

        return $opponent instanceof User ? [$game, $actor, $opponent] : [$game, $actor];
    }

    /**
     * @return array{Game,User}
     */
    private function scryingVancouverGame(): array
    {
        [$game, $actor] = $this->mulliganGame(Room::MULLIGAN_VANCOUVER, false, 1, [
            'hand' => $this->cards('hand', 6, 'hand'),
            'library' => $this->cards('library', 2, 'library'),
        ], status: 'SCRYING');
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['mulligan']['scryCardInstanceId'] = 'library-1';
        $game->replaceSnapshot($snapshot);

        return [$game, $actor];
    }

    /**
     * @return array<string,mixed>
     */
    private function mulliganState(string $rule, bool $firstMulliganFree, int $mulligansTaken, string $status): array
    {
        return [
            ...GameMulliganRules::calculateMulliganState($rule, $firstMulliganFree, $mulligansTaken),
            'status' => $status,
            'ready' => $status === 'READY',
            'scryCardInstanceId' => null,
        ];
    }

    /**
     * @param array<string,list<array<string,mixed>>> $zones
     * @param array<string,mixed>                     $mulligan
     *
     * @return array<string,mixed>
     */
    private function player(User $user, array $zones, array $mulligan = []): array
    {
        return [
            'user' => $user->toArray(),
            'life' => 40,
            'zones' => [
                'library' => $zones['library'] ?? [],
                'hand' => $zones['hand'] ?? [],
                'battlefield' => $zones['battlefield'] ?? [],
                'graveyard' => $zones['graveyard'] ?? [],
                'exile' => $zones['exile'] ?? [],
                'command' => $zones['command'] ?? [],
            ],
            'mulligan' => $mulligan,
            'commanderDamage' => [],
            'counters' => [],
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

    /**
     * @return array<string,mixed>
     */
    private function card(string $instanceId, string $name, string $zone): array
    {
        return [
            'instanceId' => $instanceId,
            'name' => $name,
            'zone' => $zone,
            'ownerId' => null,
            'controllerId' => null,
            'tapped' => false,
            'revealedTo' => [],
        ];
    }

    private function service(
        Game $game,
        User $actor,
        bool $expectPersist,
        bool $expectTransaction = true,
        ?GameCommandHandler $handler = null,
        ?GameEvent $existingEvent = null,
    ): GameWebsocketMulliganService {
        $gameRepository = $this->createMock(EntityRepository::class);
        $gameRepository->expects(self::once())->method('find')->with($game->id())->willReturn($game);
        $userRepository = $this->createMock(EntityRepository::class);
        $userRepository->expects(self::once())->method('find')->with($actor->id())->willReturn($actor);
        $eventRepository = $this->createMock(EntityRepository::class);
        $eventRepository->method('findOneBy')->willReturn($existingEvent);

        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->method('getRepository')->willReturnMap([
            [Game::class, $gameRepository],
            [User::class, $userRepository],
            [GameEvent::class, $eventRepository],
        ]);
        $manager->expects($expectTransaction ? self::once() : self::never())->method('beginTransaction');
        $manager->expects($expectTransaction ? self::once() : self::never())->method('lock')->with($game, LockMode::PESSIMISTIC_WRITE);
        $manager->expects($expectPersist ? self::once() : self::never())->method('persist')->with(self::isInstanceOf(GameEvent::class));
        $manager->expects($expectPersist ? self::once() : self::never())->method('flush');
        $manager->expects($expectPersist ? self::once() : self::never())->method('commit');
        $manager->expects($expectTransaction && !$expectPersist ? self::once() : self::never())->method('rollback');
        $manager->expects(self::once())->method('clear');

        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::once())->method('getManagerForClass')->with(Game::class)->willReturn($manager);

        return new GameWebsocketMulliganService($handler ?? new GameCommandHandler(), $registry);
    }

    private function peer(Game $game, User $user): GameWebsocketPeer
    {
        return new GameWebsocketPeer(
            connectionId: 'connection-'.$user->id(),
            gameId: $game->id(),
            userId: $user->id(),
            displayName: $user->displayName(),
            connectedAt: new \DateTimeImmutable('2026-01-01T00:00:00+00:00'),
            send: static fn (array $message): null => null,
        );
    }

    /**
     * @param list<array<string,mixed>> $messages
     *
     * @return array<string,mixed>
     */
    private function messageOfKind(array $messages, string $kind): array
    {
        foreach ($messages as $message) {
            if (($message['kind'] ?? null) === $kind) {
                return $message;
            }
        }

        self::fail(sprintf('Message kind "%s" was not emitted.', $kind));
    }

    /**
     * @return list<string>
     */
    private function libraryIds(array $snapshot, string $playerId): array
    {
        return array_map(
            static fn (array $card): string => (string) ($card['instanceId'] ?? ''),
            (new GameLibraryOps())->projectionOrderCards($snapshot['players'][$playerId] ?? []),
        );
    }
}
