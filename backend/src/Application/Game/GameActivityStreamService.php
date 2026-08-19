<?php

namespace App\Application\Game;

use App\Domain\Game\Game;
use App\Domain\Game\GameChatMessage;
use App\Domain\Game\GameLogEntry;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use Doctrine\Persistence\ManagerRegistry;

final readonly class GameActivityStreamService
{
    private const CHAT_LIMIT = 50;
    private const LOG_LIMIT = 50;
    private const CHAT_REACTIONS = ['like', 'dislike', 'love', 'laugh', 'angry', 'vomit', 'cry'];

    public function __construct(
        private ManagerRegistry $managerRegistry,
        private ?GameplayStreamsFlags $flags = null,
    ) {
    }

    public function enabled(): bool
    {
        return $this->flags?->enabled() ?? false;
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    public function decorateSnapshotForViewer(Game $game, array $snapshot, User $viewer): array
    {
        if (!$this->enabled()) {
            return $snapshot;
        }

        $snapshot['chat'] = $this->chatMessagesForViewer($game, $viewer);
        $snapshot['eventLog'] = $this->logEntries($game);

        return $snapshot;
    }

    /**
     * @return list<array<string,mixed>>
     */
    public function chatMessagesForViewer(Game $game, User $viewer, int $limit = self::CHAT_LIMIT, ?string $cursor = null): array
    {
        $messages = is_string($cursor) && trim($cursor) !== ''
            ? $this->forwardChatRecordsForViewer($game, $viewer, $limit, trim($cursor))
            : array_reverse($this->latestChatRecordsForViewer($game, $viewer, $limit));

        return array_values(array_map(
            static fn (GameChatMessage $message): array => $message->toArray(),
            array_filter(
                $messages,
                fn (GameChatMessage $message): bool => $this->canViewChatMessage($message, $viewer->id()),
            ),
        ));
    }

    /**
     * @return array{entries:list<array<string,mixed>>,hasMore:bool,nextBefore:?string}
     */
    public function chatHistoryPage(Game $game, User $viewer, int $limit, string $before): array
    {
        $records = $this->latestChatRecordsForViewer($game, $viewer, $limit, $before, true);
        $hasMore = count($records) > $limit;
        if ($hasMore) {
            array_pop($records);
        }

        $orderedRecords = array_values(array_reverse($records));

        return [
            'entries' => $this->chatMessageArraysForViewer($orderedRecords, $viewer),
            'hasMore' => $hasMore,
            'nextBefore' => ($orderedRecords[0] ?? null)?->messageId(),
        ];
    }

    /**
     * @return array{entries:list<array<string,mixed>>,hasMore:bool,nextAfter:?string}
     */
    public function chatForwardPage(Game $game, User $viewer, int $limit, string $after): array
    {
        $records = $this->forwardChatRecordsForViewer($game, $viewer, $limit, $after, true);
        $hasMore = count($records) > $limit;
        if ($hasMore) {
            array_pop($records);
        }

        return [
            'entries' => $this->chatMessageArraysForViewer($records, $viewer),
            'hasMore' => $hasMore,
            'nextAfter' => ($records !== [] ? $records[array_key_last($records)] : null)?->messageId(),
        ];
    }

    /**
     * @return list<array<string,mixed>>
     */
    public function logEntries(Game $game, int $limit = self::LOG_LIMIT, ?string $cursor = null): array
    {
        $records = $this->logRecords($game, $limit, $cursor);
        if (!is_string($cursor) || trim($cursor) === '') {
            $records = array_values(array_reverse($records));
        }

        return array_values(array_map(
            static fn (GameLogEntry $entry): array => $entry->toArray(),
            $records,
        ));
    }

    /**
     * @return array{entries:list<array<string,mixed>>,hasMore:bool,nextBefore:?string}
     */
    public function logHistoryPage(Game $game, int $limit, ?string $before): array
    {
        $records = $this->latestLogRecords($game, $limit, $before, true);
        $hasMore = count($records) > $limit;
        if ($hasMore) {
            array_pop($records);
        }

        $orderedRecords = array_values(array_reverse($records));

        return [
            'entries' => array_values(array_map(static fn (GameLogEntry $entry): array => $entry->toArray(), $orderedRecords)),
            'hasMore' => $hasMore,
            'nextBefore' => ($orderedRecords[0] ?? null)?->id() ?? null,
        ];
    }

    /**
     * @return array{entries:list<array<string,mixed>>,hasMore:bool,nextAfter:?string}
     */
    public function logForwardPage(Game $game, int $limit, string $after): array
    {
        $records = $this->forwardLogRecords($game, $limit, $after, true);
        $hasMore = count($records) > $limit;
        if ($hasMore) {
            array_pop($records);
        }

        return [
            'entries' => array_values(array_map(static fn (GameLogEntry $entry): array => $entry->toArray(), $records)),
            'hasMore' => $hasMore,
            'nextAfter' => ($records !== [] ? $records[array_key_last($records)] : null)?->id() ?? null,
        ];
    }

    public function appendChatMessage(
        EntityManagerInterface $entityManager,
        Game $game,
        User $actor,
        string $body,
        ?string $targetPlayerId = null,
        ?string $targetDisplayName = null,
    ): GameChatMessage {
        $message = new GameChatMessage($game, $actor, $body, $targetPlayerId, $targetDisplayName);
        $entityManager->persist($message);

        return $message;
    }

    public function toggleReaction(
        EntityManagerInterface $entityManager,
        Game $game,
        User $actor,
        string $messageId,
        string $reaction,
    ): GameChatMessage {
        if (!in_array($reaction, self::CHAT_REACTIONS, true)) {
            throw new \InvalidArgumentException('chat.reaction.toggled requires a valid messageId and reaction.');
        }

        $message = $this->chatMessageRecord($game, $messageId);
        if (!$message instanceof GameChatMessage) {
            throw new \InvalidArgumentException('Chat message not found.');
        }
        if (!$this->canReactToChatMessage($message, $actor->id())) {
            throw new \InvalidArgumentException('You cannot react to this chat message.');
        }

        $message->replaceReactions($this->toggleChatReaction($message->reactions(), $reaction, $actor));
        $entityManager->persist($message);

        return $message;
    }

    /**
     * @param list<array<string,mixed>> $entries
     *
     * @return list<GameLogEntry>
     */
    public function appendLogEntries(EntityManagerInterface $entityManager, Game $game, int $version, array $entries): array
    {
        $records = [];
        foreach ($entries as $entry) {
            if (!is_array($entry)) {
                continue;
            }

            $type = trim((string) ($entry['type'] ?? ''));
            $message = trim((string) ($entry['message'] ?? ''));
            if ($type === '' || $message === '') {
                continue;
            }

            $createdAt = null;
            if (is_string($entry['createdAt'] ?? null) && trim((string) $entry['createdAt']) !== '') {
                try {
                    $createdAt = new \DateTimeImmutable((string) $entry['createdAt']);
                } catch (\Throwable) {
                    $createdAt = null;
                }
            }

            $metadata = $entry;
            unset($metadata['id'], $metadata['type'], $metadata['message'], $metadata['createdAt']);
            $record = new GameLogEntry($game, $version, $type, $message, $metadata, $createdAt);
            $entityManager->persist($record);
            $records[] = $record;
        }

        return $records;
    }

    /**
     * @return list<array<string,mixed>>
     */
    public function activityEntries(Game $game, User $viewer, int $limit = 200, ?string $cursor = null): array
    {
        $activity = [
            ...array_map(static fn (GameLogEntry $entry): array => $entry->toEventArray(), $this->logRecords($game, $limit, $cursor)),
            ...array_map(static fn (GameChatMessage $message): array => $message->toEventArray(), array_filter(
                $this->chatMessages($game, $limit, $cursor),
                fn (GameChatMessage $message): bool => $this->canViewChatMessage($message, $viewer->id()),
            )),
        ];

        usort($activity, static function (array $left, array $right): int {
            $leftCreatedAt = (string) ($left['createdAt'] ?? '');
            $rightCreatedAt = (string) ($right['createdAt'] ?? '');

            return $leftCreatedAt <=> $rightCreatedAt;
        });

        if (count($activity) > $limit) {
            $activity = array_slice($activity, -$limit);
        }

        return array_values($activity);
    }

    /**
     * @return list<GameChatMessage>
     */
    private function chatMessages(Game $game, int $limit, ?string $cursor): array
    {
        $queryBuilder = $this->chatRepository()->createQueryBuilder('message')
            ->where('message.game = :game')
            ->setParameter('game', $game)
            ->orderBy('message.createdAt', 'ASC')
            ->setMaxResults(max(1, min(500, $limit)));

        if (is_string($cursor) && trim($cursor) !== '') {
            $cursorMessage = $this->chatMessageRecord($game, trim($cursor));
            if ($cursorMessage instanceof GameChatMessage) {
                $queryBuilder
                    ->andWhere('message.createdAt > :after')
                    ->setParameter('after', $cursorMessage->createdAt());
            }
        }

        return array_values(array_filter(
            $queryBuilder->getQuery()->getResult(),
            static fn (mixed $message): bool => $message instanceof GameChatMessage,
        ));
    }

    /**
     * @return list<GameLogEntry>
     */
    private function logRecords(Game $game, int $limit, ?string $cursor): array
    {
        $isIncrementalRequest = is_string($cursor) && trim($cursor) !== '';
        if (!$isIncrementalRequest) {
            return $this->latestLogRecords($game, $limit);
        }

        return $this->forwardLogRecords($game, $limit, $cursor);
    }

    /**
     * @return list<GameChatMessage>
     */
    private function latestChatRecordsForViewer(Game $game, User $viewer, int $limit, ?string $before = null, bool $probeHasMore = false): array
    {
        $beforeRecord = is_string($before) && trim($before) !== ''
            ? $this->visibleChatMessageRecord($game, $viewer, trim($before))
            : null;
        if (is_string($before) && trim($before) !== '' && !($beforeRecord instanceof GameChatMessage)) {
            return [];
        }

        $queryBuilder = $this->visibleChatQuery($game, $viewer)
            ->orderBy('message.createdAt', 'DESC')
            ->addOrderBy('message.messageId', 'DESC')
            ->setMaxResults(max(1, min(500, $limit)) + ($probeHasMore ? 1 : 0));

        if ($beforeRecord instanceof GameChatMessage) {
            $queryBuilder
                ->andWhere('(message.createdAt < :beforeCreatedAt OR (message.createdAt = :beforeCreatedAt AND message.messageId < :beforeId))')
                ->setParameter('beforeCreatedAt', $beforeRecord->createdAt())
                ->setParameter('beforeId', $beforeRecord->messageId());
        }

        return $this->chatRecordsFromQuery($queryBuilder);
    }

    /**
     * @return list<GameChatMessage>
     */
    private function forwardChatRecordsForViewer(Game $game, User $viewer, int $limit, string $after, bool $probeHasMore = false): array
    {
        $afterRecord = $this->visibleChatMessageRecord($game, $viewer, $after);
        if (!($afterRecord instanceof GameChatMessage)) {
            return [];
        }

        $queryBuilder = $this->visibleChatQuery($game, $viewer)
            ->andWhere('(message.createdAt > :afterCreatedAt OR (message.createdAt = :afterCreatedAt AND message.messageId > :afterId))')
            ->setParameter('afterCreatedAt', $afterRecord->createdAt())
            ->setParameter('afterId', $afterRecord->messageId())
            ->orderBy('message.createdAt', 'ASC')
            ->addOrderBy('message.messageId', 'ASC')
            ->setMaxResults(max(1, min(500, $limit)) + ($probeHasMore ? 1 : 0));

        return $this->chatRecordsFromQuery($queryBuilder);
    }

    private function visibleChatQuery(Game $game, User $viewer): \Doctrine\ORM\QueryBuilder
    {
        return $this->chatRepository()->createQueryBuilder('message')
            ->where('message.game = :game')
            ->andWhere('(message.targetPlayerId IS NULL OR message.targetPlayerId = :viewerId OR IDENTITY(message.actor) = :viewerId)')
            ->setParameter('game', $game)
            ->setParameter('viewerId', $viewer->id());
    }

    /**
     * @return list<GameChatMessage>
     */
    private function chatRecordsFromQuery(\Doctrine\ORM\QueryBuilder $queryBuilder): array
    {
        return array_values(array_filter(
            $queryBuilder->getQuery()->getResult(),
            static fn (mixed $message): bool => $message instanceof GameChatMessage,
        ));
    }

    /**
     * @param list<GameChatMessage> $messages
     *
     * @return list<array<string,mixed>>
     */
    private function chatMessageArraysForViewer(array $messages, User $viewer): array
    {
        return array_values(array_map(
            static fn (GameChatMessage $message): array => $message->toArray(),
            array_filter(
                $messages,
                fn (GameChatMessage $message): bool => $this->canViewChatMessage($message, $viewer->id()),
            ),
        ));
    }

    /**
     * @return list<GameLogEntry>
     */
    private function forwardLogRecords(Game $game, int $limit, string $after, bool $probeHasMore = false): array
    {
        $queryBuilder = $this->logRepository()->createQueryBuilder('entry')
            ->where('entry.game = :game')
            ->setParameter('game', $game);

        $queryBuilder
            ->orderBy('entry.createdAt', 'ASC')
            ->addOrderBy('entry.id', 'ASC')
            ->setMaxResults(max(1, min(500, $limit)) + ($probeHasMore ? 1 : 0));

        $cursorRecord = $this->logRecordForGame($game, $after);
        if ($cursorRecord instanceof GameLogEntry) {
            $queryBuilder
                ->andWhere('entry.createdAt >= :afterCreatedAt')
                ->andWhere('(entry.createdAt > :afterCreatedAt OR (entry.createdAt = :afterCreatedAt AND entry.id > :afterId))')
                ->setParameter('afterCreatedAt', $cursorRecord->createdAt())
                ->setParameter('afterId', $cursorRecord->id());
        }

        return array_values(array_filter(
            $queryBuilder->getQuery()->getResult(),
            static fn (mixed $entry): bool => $entry instanceof GameLogEntry,
        ));
    }

    /**
     * @return list<GameLogEntry>
     */
    private function latestLogRecords(Game $game, int $limit, ?string $before = null, bool $probeHasMore = false): array
    {
        $queryBuilder = $this->logRepository()->createQueryBuilder('entry')
            ->where('entry.game = :game')
            ->setParameter('game', $game)
            ->orderBy('entry.createdAt', 'DESC')
            ->addOrderBy('entry.id', 'DESC')
            ->setMaxResults(max(1, min(500, $limit)) + ($probeHasMore ? 1 : 0));

        $beforeRecord = is_string($before) && trim($before) !== ''
            ? $this->logRecordForGame($game, trim($before))
            : null;
        if ($beforeRecord instanceof GameLogEntry) {
            $queryBuilder
                ->andWhere('entry.createdAt <= :beforeCreatedAt')
                ->andWhere('(entry.createdAt < :beforeCreatedAt OR (entry.createdAt = :beforeCreatedAt AND entry.id < :beforeId))')
                ->setParameter('beforeCreatedAt', $beforeRecord->createdAt())
                ->setParameter('beforeId', $beforeRecord->id());
        }

        return array_values(array_filter(
            $queryBuilder->getQuery()->getResult(),
            static fn (mixed $entry): bool => $entry instanceof GameLogEntry,
        ));
    }

    private function logRecordForGame(Game $game, string $id): ?GameLogEntry
    {
        $record = $this->logRepository()->findOneBy([
            'game' => $game,
            'id' => $id,
        ]);

        return $record instanceof GameLogEntry ? $record : null;
    }

    private function chatMessageRecord(Game $game, string $messageId): ?GameChatMessage
    {
        $message = $this->chatRepository()->findOneBy([
            'game' => $game,
            'messageId' => $messageId,
        ]);

        return $message instanceof GameChatMessage ? $message : null;
    }

    private function visibleChatMessageRecord(Game $game, User $viewer, string $messageId): ?GameChatMessage
    {
        $message = $this->chatMessageRecord($game, $messageId);

        return $message instanceof GameChatMessage && $this->canViewChatMessage($message, $viewer->id()) ? $message : null;
    }

    /**
     * @param array<string,list<array{userId:string,displayName:string,createdAt:string}>> $reactions
     *
     * @return array<string,list<array{userId:string,displayName:string,createdAt:string}>>
     */
    private function toggleChatReaction(array $reactions, string $reaction, User $actor): array
    {
        $normalized = $reactions;
        $wasSelected = false;
        foreach ($normalized as $type => $entries) {
            $nextEntries = [];
            foreach ($entries as $entry) {
                if (($entry['userId'] ?? null) === $actor->id()) {
                    $wasSelected = $wasSelected || $type === $reaction;
                    continue;
                }

                $nextEntries[] = $entry;
            }

            $normalized[$type] = $nextEntries;
        }

        if (!$wasSelected) {
            $normalized[$reaction][] = [
                'userId' => $actor->id(),
                'displayName' => $actor->displayName(),
                'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
            ];
        }

        return array_filter($normalized, static fn (array $entries): bool => $entries !== []);
    }

    private function canViewChatMessage(GameChatMessage $message, string $viewerId): bool
    {
        $targetPlayerId = $message->targetPlayerId();
        if ($targetPlayerId === null || $targetPlayerId === '') {
            return true;
        }

        return $targetPlayerId === $viewerId || $message->actor()->id() === $viewerId;
    }

    private function canReactToChatMessage(GameChatMessage $message, string $actorId): bool
    {
        if ($message->actor()->id() === $actorId) {
            return false;
        }

        $targetPlayerId = $message->targetPlayerId();
        if ($targetPlayerId === null || $targetPlayerId === '') {
            return true;
        }

        return $targetPlayerId === $actorId || $message->actor()->id() === $actorId;
    }

    /**
     * @return EntityRepository<GameChatMessage>
     */
    private function chatRepository(): EntityRepository
    {
        /** @var EntityRepository<GameChatMessage> $repository */
        $repository = $this->manager()->getRepository(GameChatMessage::class);

        return $repository;
    }

    /**
     * @return EntityRepository<GameLogEntry>
     */
    private function logRepository(): EntityRepository
    {
        /** @var EntityRepository<GameLogEntry> $repository */
        $repository = $this->manager()->getRepository(GameLogEntry::class);

        return $repository;
    }

    private function manager(): EntityManagerInterface
    {
        $manager = $this->managerRegistry->getManagerForClass(Game::class)
            ?? $this->managerRegistry->getManager();
        \assert($manager instanceof EntityManagerInterface);

        return $manager;
    }
}
