<?php

declare(strict_types=1);

namespace App\Application\Moderation;

use App\Domain\Report\ReportState;
use App\Domain\Report\UserReport;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;

/** Cooperative worker; each claimed row remains locked until its snapshot commits. */
class ProfileModerationEvidenceWorker
{
    public function __construct(
        private readonly Connection $connection,
        private readonly EntityManagerInterface $entityManager,
        private readonly ProfileModerationEvidenceQueue $queue,
        private readonly ModerationProfileSnapshotFactory $snapshotFactory,
        private readonly ModerationSummaryPublisher $summaryPublisher,
    ) {
    }

    /** @return array{processed:int,retried:int} */
    public function drain(int $limit): array
    {
        $processed = 0;
        $retried = 0;
        for ($index = 0; $index < min(250, max(1, $limit)); ++$index) {
            $reportId = null;
            try {
                $this->connection->beginTransaction();
                $reportId = $this->queue->claimOne();
                if ($reportId === null) {
                    $this->connection->commit();
                    break;
                }

                $report = $this->entityManager->find(UserReport::class, $reportId);
                if (!$report instanceof UserReport || $report->status() !== ReportState::COLLECTING_EVIDENCE || !$report->requiresProfileEvidence() || $report->reportedUser() === null) {
                    $this->queue->remove($reportId);
                    $this->connection->commit();
                    ++$processed;
                    continue;
                }

                $wasPendingReview = $report->isPendingReview();
                $report->markProfileEvidenceCollected($this->snapshotFactory->create($report->reportedUser()));
                $this->entityManager->flush();
                $this->queue->remove($reportId);
                $this->connection->commit();
                if (!$wasPendingReview && $report->isPendingReview()) {
                    $this->invalidateSummaryBestEffort();
                }
                ++$processed;
            } catch (\Throwable) {
                if ($this->connection->isTransactionActive()) {
                    $this->connection->rollBack();
                }
                if ($reportId !== null) {
                    $this->queue->scheduleRetry($reportId);
                    ++$retried;
                }
                $this->entityManager->clear();
            }
        }

        return ['processed' => $processed, 'retried' => $retried];
    }

    private function invalidateSummaryBestEffort(): void
    {
        // The evidence row and report state are already committed. A
        // realtime outage must not schedule a retry for a completed job.
        try {
            $this->summaryPublisher->invalidate();
        } catch (\Throwable) {
        }
    }
}
