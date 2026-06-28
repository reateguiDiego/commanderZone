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
    private const CHAT_LIMIT = 150;
    private const LOG_LIMIT = 250;
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
        $messages = $this->chatMessages($game, $limit, $cursor);

        return array_values(array_map(
            static fn (GameChatMessage $message): array => $message->toArray(),
            array_filter(
                $messages,
                fn (GameChatMessage $message): bool => $this->canViewChatMessage($message, $viewer->id()),
            ),
        ));
    }

    /**
     * @return list<array<string,mixed>>
     */
    public function logEntries(Game $game, int $limit = self::LOG_LIMIT, ?string $cursor = null): array
    {
        return array_values(array_map(
            static fn (GameLogEntry $entry): array => $entry->toArray(),
            $this->logRecords($game, $limit, $cursor),
        ));
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
        $queryBuilder = $this->logRepository()->createQueryBuilder('entry')
            ->where('entry.game = :game')
            ->setParameter('game', $game)
            ->orderBy('entry.createdAt', 'ASC')
            ->setMaxResults(max(1, min(500, $limit)));

        if (is_string($cursor) && trim($cursor) !== '') {
            $cursorRecord = $this->logRepository()->find($cursor);
            if ($cursorRecord instanceof GameLogEntry) {
                $queryBuilder
                    ->andWhere('entry.createdAt > :after')
                    ->setParameter('after', $cursorRecord->createdAt());
            }
        }

        return array_values(array_filter(
            $queryBuilder->getQuery()->getResult(),
            static fn (mixed $entry): bool => $entry instanceof GameLogEntry,
        ));
    }

    private function chatMessageRecord(Game $game, string $messageId): ?GameChatMessage
    {
        $message = $this->chatRepository()->findOneBy([
            'game' => $game,
            'messageId' => $messageId,
        ]);

        return $message instanceof GameChatMessage ? $message : null;
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
