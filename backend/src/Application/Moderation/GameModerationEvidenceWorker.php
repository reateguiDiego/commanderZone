<?php

namespace App\Application\Moderation;

use App\Domain\Game\Game;
use App\Domain\Game\GameChatMessage;
use App\Domain\Game\GameLogEntry;
use App\Domain\Report\GameModerationEvidenceChatMessage;
use App\Domain\Report\GameModerationEvidenceLogEntry;
use App\Domain\Report\GameModerationEvidenceSnapshot;
use App\Domain\Report\ReportState;
use App\Domain\Report\UserReport;
use App\Domain\Room\Room;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\Persistence\ManagerRegistry;

/**
 * Captures all server-side chat (including private chat) and relevant game
 * log entries only after a terminal source has been archived. Queue locks make
 * it safe to run multiple worker containers without duplicate snapshots.
 */
final readonly class GameModerationEvidenceWorker
{
    private const SOURCE_BATCH_SIZE = 250;

    public function __construct(
        private ManagerRegistry $registry,
        private GameModerationEvidenceSourceCleanup $sourceCleanup,
        private ModerationSummaryPublisher $summaryPublisher,
    ) {
    }

    /**
     * @return array{processed:int,retried:int,deferred:int}
     */
    public function drain(int $limit = 100): array
    {
        $processed = 0;
        $retried = 0;
        $deferred = 0;

        for ($index = 0; $index < min(250, max(1, $limit)); ++$index) {
            $entityManager = $this->entityManager();
            $connection = $entityManager->getConnection();
            $gameId = null;

            try {
                $connection->beginTransaction();
                $job = $connection->fetchAssociative(<<<'SQL'
SELECT game_id
FROM game_moderation_evidence_queue
WHERE available_at <= CURRENT_TIMESTAMP
ORDER BY available_at ASC, queued_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
SQL);
                $gameId = is_array($job) ? ($job['game_id'] ?? null) : null;
                if (!is_string($gameId) || $gameId === '') {
                    $connection->commit();
                    break;
                }

                $game = $entityManager->find(Game::class, $gameId, LockMode::PESSIMISTIC_WRITE);
                if (!$game instanceof Game) {
                    $this->deleteJob($connection, $gameId);
                    $connection->commit();
                    $entityManager->clear();
                    ++$processed;
                    continue;
                }

                $room = $game->room();
                $entityManager->lock($room, LockMode::PESSIMISTIC_WRITE);
                if ($game->status() !== Game::STATUS_FINISHED || $room->status() !== Room::STATUS_ARCHIVED) {
                    // Reports may arrive while a table is playable. Evidence
                    // is deliberately taken only after lifecycle made the game
                    // terminal and archived its room. This ensures late chat
                    // and log rows are not silently omitted from evidence.
                    $this->deferUntilTerminal($connection, $gameId);
                    $connection->commit();
                    $entityManager->clear();
                    ++$deferred;
                    continue;
                }

                $reports = $this->collectingGameReports($entityManager, $game);
                $summaryInvalidated = false;
                if ($reports !== []) {
                    $snapshot = $this->snapshotFor($entityManager, $game);
                    $captureComplete = $snapshot->isComplete()
                        || $this->captureSourceBatch($entityManager, $game, $snapshot, $reports);
                    if (!$captureComplete) {
                        // Leave all reports collecting and retain the archived
                        // source until every source row has been copied.
                        $entityManager->flush();
                        $this->requeueNextBatch($connection, $gameId);
                        $connection->commit();
                        $entityManager->clear();
                        ++$processed;
                        continue;
                    }
                    foreach ($reports as $report) {
                        $wasPendingReview = $report->isPendingReview();
                        $report->markEvidenceCollected($snapshot);
                        $summaryInvalidated = $summaryInvalidated || (!$wasPendingReview && $report->isPendingReview());
                    }
                    $entityManager->persist($snapshot);
                }

                $this->deleteJob($connection, $gameId);
                $this->sourceCleanup->dispose($game, $entityManager);
                $entityManager->flush();
                $connection->commit();
                $entityManager->clear();
                if ($summaryInvalidated) {
                    $this->invalidateSummaryBestEffort();
                }
                ++$processed;
            } catch (\Throwable $exception) {
                if ($connection->isTransactionActive()) {
                    $connection->rollBack();
                }
                // Flush failures close Doctrine's manager. Reset it before
                // scheduling a retry so this long-running worker recovers.
                $this->registry->resetManager();
                if (!is_string($gameId) || $gameId === '') {
                    throw $exception;
                }

                $this->deferAfterFailure($this->entityManager()->getConnection(), $gameId);
                ++$retried;
            }
        }

        return ['processed' => $processed, 'retried' => $retried, 'deferred' => $deferred];
    }

    private function entityManager(): EntityManagerInterface
    {
        $manager = $this->registry->getManager();
        if (!$manager instanceof EntityManagerInterface) {
            throw new \LogicException('The default Doctrine manager must be an entity manager.');
        }

        return $manager;
    }

    /**
     * @return list<UserReport>
     */
    private function collectingGameReports(EntityManagerInterface $entityManager, Game $game): array
    {
        $reports = $entityManager->getRepository(UserReport::class)->createQueryBuilder('report')
            ->where('report.game = :game')
            ->andWhere('report.status = :status')
            ->orderBy('report.createdAt', 'ASC')
            ->addOrderBy('report.id', 'ASC')
            ->setParameter('game', $game)
            ->setParameter('status', ReportState::COLLECTING_EVIDENCE)
            ->getQuery()
            ->getResult();

        return array_values(array_filter(
            $reports,
            static fn (mixed $report): bool => $report instanceof UserReport && $report->requiresGameEvidence(),
        ));
    }

    private function snapshotFor(EntityManagerInterface $entityManager, Game $game): GameModerationEvidenceSnapshot
    {
        $existing = $entityManager->getRepository(GameModerationEvidenceSnapshot::class)->findOneBy(['gameId' => $game->id()]);
        if ($existing instanceof GameModerationEvidenceSnapshot) {
            return $existing;
        }

        return new GameModerationEvidenceSnapshot($game->id());
    }

    /**
     * @param list<UserReport> $reports
     */
    private function captureSourceBatch(
        EntityManagerInterface $entityManager,
        Game $game,
        GameModerationEvidenceSnapshot $snapshot,
        array $reports,
    ): bool {
        // A new snapshot must be in storage before a correlated NOT EXISTS
        // query can safely claim source rows for it.
        $entityManager->persist($snapshot);
        $entityManager->flush();

        $captured = 0;
        $messages = $this->uncapturedChatMessages($entityManager, $game, $snapshot, self::SOURCE_BATCH_SIZE);
        foreach ($messages as $message) {
            $entityManager->persist($snapshot->captureChatMessage($message));
            ++$captured;
        }
        if ($captured > 0) {
            $entityManager->flush();
        }

        if ($this->hasUncapturedChatMessages($entityManager, $game, $snapshot)) {
            return false;
        }

        $requiresLog = array_any($reports, static fn (UserReport $report): bool => $report->requiresGameLog());
        if (!$requiresLog) {
            $snapshot->complete();

            return true;
        }

        $remaining = self::SOURCE_BATCH_SIZE - $captured;
        if ($remaining > 0) {
            $entries = $this->uncapturedLogEntries($entityManager, $game, $snapshot, $remaining);
            foreach ($entries as $entry) {
                $entityManager->persist($snapshot->captureLogEntry($entry));
            }
            if ($entries !== []) {
                $entityManager->flush();
            }
        }

        if ($this->hasUncapturedLogEntries($entityManager, $game, $snapshot)) {
            return false;
        }

        $snapshot->complete();

        return true;
    }

    /** @return list<GameChatMessage> */
    private function uncapturedChatMessages(
        EntityManagerInterface $entityManager,
        Game $game,
        GameModerationEvidenceSnapshot $snapshot,
        int $limit,
    ): array {
        if ($limit < 1) {
            return [];
        }

        $captured = $entityManager->getRepository(GameModerationEvidenceChatMessage::class)->createQueryBuilder('captured')
            ->select('captured.id')
            ->where('captured.snapshot = :snapshot')
            ->andWhere('captured.sourceMessageId = message.messageId');
        $messages = $entityManager->getRepository(GameChatMessage::class)->createQueryBuilder('message')
            ->where('message.game = :game')
            ->andWhere(sprintf('NOT EXISTS (%s)', $captured->getDQL()))
            ->setParameter('game', $game)
            ->setParameter('snapshot', $snapshot)
            ->orderBy('message.createdAt', 'ASC')
            ->addOrderBy('message.messageId', 'ASC')
            ->setMaxResults($limit)
            ->getQuery()
            ->getResult();

        return array_values(array_filter($messages, static fn (mixed $message): bool => $message instanceof GameChatMessage));
    }

    private function hasUncapturedChatMessages(
        EntityManagerInterface $entityManager,
        Game $game,
        GameModerationEvidenceSnapshot $snapshot,
    ): bool {
        $captured = $entityManager->getRepository(GameModerationEvidenceChatMessage::class)->createQueryBuilder('captured')
            ->select('captured.id')
            ->where('captured.snapshot = :snapshot')
            ->andWhere('captured.sourceMessageId = message.messageId');

        return $entityManager->getRepository(GameChatMessage::class)->createQueryBuilder('message')
            ->select('message.messageId')
            ->where('message.game = :game')
            ->andWhere(sprintf('NOT EXISTS (%s)', $captured->getDQL()))
            ->setParameter('game', $game)
            ->setParameter('snapshot', $snapshot)
            ->setMaxResults(1)
            ->getQuery()
            ->getOneOrNullResult() !== null;
    }

    /** @return list<GameLogEntry> */
    private function uncapturedLogEntries(
        EntityManagerInterface $entityManager,
        Game $game,
        GameModerationEvidenceSnapshot $snapshot,
        int $limit,
    ): array {
        if ($limit < 1) {
            return [];
        }

        $captured = $entityManager->getRepository(GameModerationEvidenceLogEntry::class)->createQueryBuilder('captured')
            ->select('captured.id')
            ->where('captured.snapshot = :snapshot')
            ->andWhere('captured.sourceLogEntryId = entry.id');
        $entries = $entityManager->getRepository(GameLogEntry::class)->createQueryBuilder('entry')
            ->where('entry.game = :game')
            ->andWhere(sprintf('NOT EXISTS (%s)', $captured->getDQL()))
            ->setParameter('game', $game)
            ->setParameter('snapshot', $snapshot)
            ->orderBy('entry.version', 'ASC')
            ->addOrderBy('entry.createdAt', 'ASC')
            ->addOrderBy('entry.id', 'ASC')
            ->setMaxResults($limit)
            ->getQuery()
            ->getResult();

        return array_values(array_filter($entries, static fn (mixed $entry): bool => $entry instanceof GameLogEntry));
    }

    private function hasUncapturedLogEntries(
        EntityManagerInterface $entityManager,
        Game $game,
        GameModerationEvidenceSnapshot $snapshot,
    ): bool {
        $captured = $entityManager->getRepository(GameModerationEvidenceLogEntry::class)->createQueryBuilder('captured')
            ->select('captured.id')
            ->where('captured.snapshot = :snapshot')
            ->andWhere('captured.sourceLogEntryId = entry.id');

        return $entityManager->getRepository(GameLogEntry::class)->createQueryBuilder('entry')
            ->select('entry.id')
            ->where('entry.game = :game')
            ->andWhere(sprintf('NOT EXISTS (%s)', $captured->getDQL()))
            ->setParameter('game', $game)
            ->setParameter('snapshot', $snapshot)
            ->setMaxResults(1)
            ->getQuery()
            ->getOneOrNullResult() !== null;
    }

    private function deleteJob(Connection $connection, string $gameId): void
    {
        $connection->executeStatement(
            'DELETE FROM game_moderation_evidence_queue WHERE game_id = :gameId',
            ['gameId' => $gameId],
        );
    }

    private function requeueNextBatch(Connection $connection, string $gameId): void
    {
        // Make another batch immediately eligible, but place it behind other
        // ready games so a large transcript cannot monopolise the worker.
        $connection->executeStatement(<<<'SQL'
UPDATE game_moderation_evidence_queue
SET available_at = CURRENT_TIMESTAMP,
    queued_at = CURRENT_TIMESTAMP
WHERE game_id = :gameId
SQL, ['gameId' => $gameId]);
    }

    private function invalidateSummaryBestEffort(): void
    {
        // Evidence and source cleanup already committed. A transient Mercure
        // outage must not turn that completed job into a spurious retry.
        try {
            $this->summaryPublisher->invalidate();
        } catch (\Throwable) {
        }
    }

    private function deferUntilTerminal(Connection $connection, string $gameId): void
    {
        $connection->executeStatement(<<<'SQL'
UPDATE game_moderation_evidence_queue
SET available_at = CURRENT_TIMESTAMP + INTERVAL '30 seconds'
WHERE game_id = :gameId
SQL, ['gameId' => $gameId]);
    }

    private function deferAfterFailure(Connection $connection, string $gameId): void
    {
        // A bad source must not head-of-line block every other reported game.
        $connection->executeStatement(<<<'SQL'
UPDATE game_moderation_evidence_queue
SET attempts = attempts + 1,
    available_at = CURRENT_TIMESTAMP + (LEAST(60, POWER(2, attempts + 1)) * INTERVAL '1 second')
WHERE game_id = :gameId
SQL, ['gameId' => $gameId]);
    }
}
