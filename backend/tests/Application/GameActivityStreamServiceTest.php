<?php

namespace App\Tests\Application;

use App\Application\Game\GameActivityStreamService;
use App\Application\Game\GameplayStreamsFlags;
use App\Domain\Game\Game;
use App\Domain\Game\GameChatMessage;
use App\Domain\Game\GameLogEntry;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use Doctrine\ORM\Query;
use Doctrine\ORM\QueryBuilder;
use Doctrine\Persistence\ManagerRegistry;
use PHPUnit\Framework\TestCase;

class GameActivityStreamServiceTest extends TestCase
{
    public function testDecorateSnapshotForViewerFiltersPrivateChatAndLoadsLogEntries(): void
    {
        [$game, $actor, $target, $spectator] = $this->gameWithPlayers();
        $publicMessage = new GameChatMessage($game, $actor, 'public');
        $privateMessage = new GameChatMessage($game, $actor, 'private', $target->id(), $target->displayName());
        $logEntry = new GameLogEntry($game, 3, 'life.changed', 'lost 2 life', [
            'actorId' => $actor->id(),
            'displayName' => $actor->displayName(),
        ]);

        $service = $this->service(
            chatResults: [$publicMessage, $privateMessage],
            logResults: [$logEntry],
        );

        $decorated = $service->decorateSnapshotForViewer($game, ['version' => 3], $spectator);

        self::assertCount(1, $decorated['chat']);
        self::assertSame('public', $decorated['chat'][0]['message']);
        self::assertCount(1, $decorated['eventLog']);
        self::assertSame('life.changed', $decorated['eventLog'][0]['type']);
    }

    public function testToggleReactionReplacesPreviousReactionAndCanClearIt(): void
    {
        [$game, $actor, $target] = $this->gameWithPlayers();
        $message = new GameChatMessage($game, $actor, 'hello');
        $chatRepository = $this->createMock(EntityRepository::class);
        $chatRepository->expects(self::exactly(3))
            ->method('findOneBy')
            ->with([
                'game' => $game,
                'messageId' => $message->messageId(),
            ])
            ->willReturn($message);

        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->expects(self::exactly(3))
            ->method('persist')
            ->with($message);
        $manager->method('getRepository')->willReturnMap([
            [GameChatMessage::class, $chatRepository],
        ]);

        $registry = $this->createMock(ManagerRegistry::class);
        $registry->method('getManagerForClass')->with(Game::class)->willReturn($manager);
        $service = new GameActivityStreamService($registry, new GameplayStreamsFlags(true));

        $service->toggleReaction($manager, $game, $target, $message->messageId(), 'like');
        self::assertSame($target->id(), $message->reactions()['like'][0]['userId'] ?? null);

        $service->toggleReaction($manager, $game, $target, $message->messageId(), 'love');
        self::assertArrayNotHasKey('like', $message->reactions());
        self::assertSame($target->id(), $message->reactions()['love'][0]['userId'] ?? null);

        $service->toggleReaction($manager, $game, $target, $message->messageId(), 'love');
        self::assertSame([], $message->reactions());
    }

    public function testActivityEntriesMergeLogsAndVisibleChatInCreatedAtOrder(): void
    {
        [$game, $actor, $target, $spectator] = $this->gameWithPlayers();
        $message = new GameChatMessage($game, $actor, 'public');
        $logEntry = new GameLogEntry($game, 5, 'turn.changed', 'next turn', [
            'actorId' => $actor->id(),
            'displayName' => $actor->displayName(),
        ], new \DateTimeImmutable('2026-01-01T00:00:00+00:00'));
        $this->setPrivateProperty($message, 'createdAt', new \DateTimeImmutable('2026-01-01T00:01:00+00:00'));

        $service = $this->service(
            chatResults: [$message],
            logResults: [$logEntry],
        );

        $entries = $service->activityEntries($game, $spectator);

        self::assertCount(2, $entries);
        self::assertSame('turn.changed', $entries[0]['type']);
        self::assertSame('chat.message', $entries[1]['type']);
    }

    /**
     * @param list<GameChatMessage> $chatResults
     * @param list<GameLogEntry> $logResults
     */
    private function service(array $chatResults = [], array $logResults = []): GameActivityStreamService
    {
        $chatRepository = $this->createMock(EntityRepository::class);
        $chatRepository->method('createQueryBuilder')->with('message')->willReturn($this->queryBuilderMock($chatResults));
        $chatRepository->method('findOneBy')->willReturn(null);

        $logRepository = $this->createMock(EntityRepository::class);
        $logRepository->method('createQueryBuilder')->with('entry')->willReturn($this->queryBuilderMock($logResults));
        $logRepository->method('find')->willReturn(null);

        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->method('getRepository')->willReturnMap([
            [GameChatMessage::class, $chatRepository],
            [GameLogEntry::class, $logRepository],
        ]);

        $registry = $this->createMock(ManagerRegistry::class);
        $registry->method('getManagerForClass')->with(Game::class)->willReturn($manager);

        return new GameActivityStreamService($registry, new GameplayStreamsFlags(true));
    }

    /**
     * @param list<object> $results
     */
    private function queryBuilderMock(array $results): QueryBuilder
    {
        $query = $this->getMockBuilder(Query::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['getResult'])
            ->getMock();
        $query->method('getResult')->willReturn($results);

        $queryBuilder = $this->getMockBuilder(QueryBuilder::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['where', 'setParameter', 'orderBy', 'setMaxResults', 'andWhere', 'getQuery'])
            ->getMock();
        $queryBuilder->method('where')->willReturnSelf();
        $queryBuilder->method('setParameter')->willReturnSelf();
        $queryBuilder->method('orderBy')->willReturnSelf();
        $queryBuilder->method('setMaxResults')->willReturnSelf();
        $queryBuilder->method('andWhere')->willReturnSelf();
        $queryBuilder->method('getQuery')->willReturn($query);

        return $queryBuilder;
    }

    /**
     * @return array{Game, User, User, User}
     */
    private function gameWithPlayers(): array
    {
        $actor = new User('actor@example.test', 'Actor');
        $target = new User('target@example.test', 'Target');
        $spectator = new User('spectator@example.test', 'Spectator');
        $room = new Room($actor);
        $room->addPlayer(new RoomPlayer($room, $actor));
        $room->addPlayer(new RoomPlayer($room, $target));
        $room->addPlayer(new RoomPlayer($room, $spectator));

        return [new Game($room, ['version' => 1, 'players' => []]), $actor, $target, $spectator];
    }

    private function setPrivateProperty(object $object, string $property, mixed $value): void
    {
        $reflection = new \ReflectionProperty($object, $property);
        $reflection->setAccessible(true);
        $reflection->setValue($object, $value);
    }
}
