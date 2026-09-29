<?php

declare(strict_types=1);

namespace App\Application\Moderation;

use App\Domain\Game\Game;
use App\Domain\Report\GameModerationEvidenceSnapshot;
use App\Domain\Report\ReportState;
use App\Domain\Report\UserReport;
use App\Domain\Room\Room;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Removes incomplete cases before account deletion can cascade their source
 * rows. Resolved reports remain intact and use nullable user relations.
 */
class ModerationReportCancellationService
{
    public function __construct(
        private readonly ProfileModerationEvidenceQueue $profileQueue,
        private readonly GameModerationEvidenceQueueInterface $gameQueue,
    ) {
    }

    /**
     * Must run inside the account-deletion transaction, before the user and
     * any of their room memberships are removed.
     */
    public function cancelUnresolvedForAccount(User $user, EntityManagerInterface $entityManager): void
    {
        $rows = $entityManager->getRepository(UserReport::class)->createQueryBuilder('report')
            ->leftJoin('report.game', 'game')
            ->addSelect('game')
            ->leftJoin('game.room', 'room')
            ->addSelect('room')
            ->leftJoin('room.players', 'player')
            ->where('report.status IN (:statuses)')
            ->andWhere('(report.reporter = :user OR report.reportedUser = :user OR room.owner = :user OR player.user = :user)')
            ->setParameter('statuses', [ReportState::COLLECTING_EVIDENCE, ReportState::PENDING_REVIEW])
            ->setParameter('user', $user)
            ->getQuery()
            ->getResult();

        // PostgreSQL's json type has no equality operator, so SQL DISTINCT
        // cannot be used once evidence columns are selected. The room-player
        // join can legitimately repeat a report; normalize it by immutable
        // report ID after hydration instead.
        /** @var array<string,UserReport> $reportsById */
        $reportsById = [];
        foreach ($rows as $row) {
            if ($row instanceof UserReport) {
                $reportsById[$row->id()] = $row;
            }
        }
        $reports = array_values($reportsById);

        /** @var array<string,Game> $games */
        $games = [];
        /** @var array<string,GameModerationEvidenceSnapshot> $snapshots */
        $snapshots = [];
        foreach ($reports as $report) {
            if (!$report instanceof UserReport) {
                continue;
            }
            $this->profileQueue->remove($report->id());
            $game = $report->game();
            if ($game instanceof Game) {
                $games[$game->id()] = $game;
            }
            $snapshot = $report->gameEvidenceSnapshot();
            if ($snapshot instanceof GameModerationEvidenceSnapshot) {
                $snapshots[$snapshot->id()] = $snapshot;
            }
            $entityManager->remove($report);
        }
        $entityManager->flush();

        foreach ($snapshots as $snapshot) {
            if ($entityManager->getRepository(UserReport::class)->count(['gameEvidenceSnapshot' => $snapshot]) !== 0) {
                continue;
            }
            $entityManager->remove($snapshot);
        }

        foreach ($games as $game) {
            // A terminal archived source still needs its queue: the game
            // worker observes zero reports and disposes it safely.
            if ($game->room()->status() === Room::STATUS_ARCHIVED) {
                continue;
            }
            if ($this->hasUnresolvedGameReports($entityManager, $game)) {
                continue;
            }

            $game->releaseModerationReview();
            $this->gameQueue->cancel($game->id());
        }
        $entityManager->flush();
    }

    private function hasUnresolvedGameReports(EntityManagerInterface $entityManager, Game $game): bool
    {
        return (int) $entityManager->getRepository(UserReport::class)->createQueryBuilder('report')
            ->select('COUNT(report.id)')
            ->where('report.game = :game')
            ->andWhere('report.status IN (:statuses)')
            ->setParameter('game', $game)
            ->setParameter('statuses', [ReportState::COLLECTING_EVIDENCE, ReportState::PENDING_REVIEW])
            ->getQuery()
            ->getSingleScalarResult() > 0;
    }
}
