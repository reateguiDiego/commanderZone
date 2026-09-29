<?php

declare(strict_types=1);

namespace App\Application\Moderation;

use App\Domain\Game\Game;
use App\Domain\Game\GameChatMessage;
use App\Domain\Report\ReportCategory;
use App\Domain\Report\ReportSource;
use App\Domain\Report\ReportState;
use App\Domain\Report\UserReport;
use App\Domain\User\User;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;

class ReportSubmissionService
{
    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        private readonly ModerationPermissionPolicy $permissions,
        private readonly ProfileModerationEvidenceQueue $profileEvidenceQueue,
        private readonly ModerationSummaryPublisher $summaryPublisher,
    ) {
    }

    /**
     * @param array{source?:mixed,category?:mixed,comment?:mixed,reportedUserId?:mixed,gameId?:mixed,messageId?:mixed} $payload
     */
    public function submit(User $reporter, array $payload): UserReport
    {
        $source = $this->source($payload['source'] ?? null);
        $category = $this->category($payload['category'] ?? null);
        $reportedUserId = $this->optionalId($payload['reportedUserId'] ?? null);
        $gameId = $this->optionalId($payload['gameId'] ?? null);
        $messageId = $this->optionalId($payload['messageId'] ?? null);
        $comment = $this->optionalComment($payload['comment'] ?? null);
        $this->validateReferenceCombination($source, $reportedUserId, $gameId, $messageId);

        $this->entityManager->beginTransaction();
        try {
            [$target, $game] = $this->resolveTargetAndGame($reporter, $source, $reportedUserId, $gameId, $messageId);
            if (!$this->permissions->canSubmitAgainst($reporter, $target)) {
                throw new ModerationValidationException('This user cannot be reported.');
            }
            if ($this->hasOpenReport($reporter, $target)) {
                throw new DuplicateOpenReportException('You already have an open report for this user.');
            }

            $report = new UserReport($reporter, $target, $source, $category, $comment, $game, $messageId);
            $reporter->recordReportMade();
            $target->recordReportReceived();
            if ($game instanceof Game) {
                $game->requireModerationReview();
            }
            $this->entityManager->persist($report);
            // Persist report/counters before FK-backed durable queue entries.
            $this->entityManager->flush();
            if ($report->requiresProfileEvidence()) {
                $this->profileEvidenceQueue->enqueue($report->id());
            }
            $this->entityManager->commit();
            // This is an invalidation, not a queue payload. The terminal
            // lifecycle alone schedules game capture after the table ends.
            $this->summaryPublisher->invalidate();

            return $report;
        } catch (UniqueConstraintViolationException $exception) {
            $this->rollback();

            throw new DuplicateOpenReportException('You already have an open report for this user.', previous: $exception);
        } catch (\Throwable $exception) {
            $this->rollback();

            throw $exception;
        }
    }

    private function source(mixed $value): ReportSource
    {
        $source = is_string($value) ? ReportSource::tryFrom(trim($value)) : null;
        if (!$source instanceof ReportSource || !$source->canBeSubmitted()) {
            throw new ModerationValidationException('Unsupported report source.');
        }

        return $source;
    }

    private function category(mixed $value): ReportCategory
    {
        $category = is_string($value) ? ReportCategory::tryFrom(trim($value)) : null;
        if (!$category instanceof ReportCategory) {
            throw new ModerationValidationException('Unsupported report category.');
        }

        return $category;
    }

    private function optionalId(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (!is_string($value) || trim($value) === '') {
            throw new ModerationValidationException('Report references must be non-empty strings.');
        }

        return trim($value);
    }

    private function optionalComment(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (!is_string($value)) {
            throw new ModerationValidationException('Report comment must be a string.');
        }

        $comment = trim($value);
        if (mb_strlen($comment) > 2000) {
            throw new ModerationValidationException('Report comment cannot exceed 2000 characters.');
        }

        return $comment === '' ? null : $comment;
    }

    private function validateReferenceCombination(ReportSource $source, ?string $reportedUserId, ?string $gameId, ?string $messageId): void
    {
        $valid = match ($source) {
            ReportSource::PROFILE => $reportedUserId !== null && $gameId === null && $messageId === null,
            ReportSource::GAME_PLAYER => $reportedUserId !== null && $gameId !== null && $messageId === null,
            ReportSource::CHAT_MESSAGE => $reportedUserId === null && $gameId !== null && $messageId !== null,
            ReportSource::LEGACY => false,
        };
        if (!$valid) {
            throw new ModerationValidationException('Invalid report source and reference combination.');
        }
    }

    /** @return array{0:User,1:Game|null} */
    private function resolveTargetAndGame(
        User $reporter,
        ReportSource $source,
        ?string $reportedUserId,
        ?string $gameId,
        ?string $messageId,
    ): array {
        if ($source === ReportSource::PROFILE) {
            $target = $this->entityManager->find(User::class, $reportedUserId);
            if (!$target instanceof User) {
                throw new ModerationNotFoundException('Reported user not found.');
            }

            return [$target, null];
        }

        // Serialize against terminal lifecycle retention. A report cannot set
        // the flag after the sweeper has already decided ordinary cleanup.
        $game = $this->entityManager->find(Game::class, $gameId, LockMode::PESSIMISTIC_WRITE);
        if (!$game instanceof Game) {
            throw new ModerationNotFoundException('Game not found.');
        }
        if ($game->status() !== Game::STATUS_ACTIVE || !$game->room()->hasPlayer($reporter)) {
            throw new ModerationValidationException('Only active game participants can report this game.');
        }

        if ($source === ReportSource::GAME_PLAYER) {
            $target = $this->entityManager->find(User::class, $reportedUserId);
            if (!$target instanceof User) {
                throw new ModerationNotFoundException('Reported user not found.');
            }
            if (!$game->room()->hasPlayer($target)) {
                throw new ModerationValidationException('Reported user is not an active participant in this game.');
            }

            return [$target, $game];
        }

        $message = $this->entityManager->find(GameChatMessage::class, $messageId);
        if (!$message instanceof GameChatMessage || $message->game()->id() !== $game->id()) {
            throw new ModerationNotFoundException('Chat message not found in this game.');
        }

        return [$message->actor(), $game];
    }

    private function hasOpenReport(User $reporter, User $target): bool
    {
        return (int) $this->entityManager->getRepository(UserReport::class)->createQueryBuilder('report')
            ->select('COUNT(report.id)')
            ->where('report.reporter = :reporter')
            ->andWhere('report.reportedUser = :target')
            ->andWhere('report.status IN (:statuses)')
            ->setParameter('reporter', $reporter)
            ->setParameter('target', $target)
            ->setParameter('statuses', [ReportState::COLLECTING_EVIDENCE, ReportState::PENDING_REVIEW])
            ->getQuery()
            ->getSingleScalarResult() > 0;
    }

    private function rollback(): void
    {
        if ($this->entityManager->getConnection()->isTransactionActive()) {
            $this->entityManager->rollback();
        }
    }
}
