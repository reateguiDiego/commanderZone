<?php

declare(strict_types=1);

namespace App\Application\Moderation;

use App\Domain\Report\GameModerationEvidenceSnapshot;
use App\Domain\Report\ReportResolutionOutcome;
use App\Domain\Report\ReportState;
use App\Domain\Report\UserReport;
use App\Domain\Report\UserStrike;
use App\Domain\User\Role;
use App\Domain\User\User;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;

class ModerationReportResolutionService
{
    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        private readonly ModerationPermissionPolicy $permissions,
    ) {
    }

    public function resolve(
        UserReport $report,
        User $actor,
        ReportResolutionOutcome $outcome,
        ?string $resolutionNote,
        ?string $strikeDescription,
    ): ?UserStrike {
        if ($resolutionNote !== null && mb_strlen(trim($resolutionNote)) > 2000) {
            throw new ModerationValidationException('Resolution note cannot exceed 2000 characters.');
        }

        $this->entityManager->beginTransaction();
        try {
            $this->entityManager->lock($report, LockMode::PESSIMISTIC_WRITE);
            $this->entityManager->refresh($report);
            $target = $report->reportedUser();
            if (!$target instanceof User) {
                throw new ModerationValidationException('You cannot resolve this report.');
            }
            $this->entityManager->lock($target, LockMode::PESSIMISTIC_WRITE);
            $this->entityManager->refresh($target);
            $this->entityManager->refresh($actor);
            if (!$this->permissions->canReviewTarget($actor, $target)) {
                throw new ModerationValidationException('You cannot resolve this report.');
            }
            if ($report->status() !== ReportState::PENDING_REVIEW) {
                throw new ModerationValidationException('Only pending reports can be resolved.');
            }
            $strike = null;
            if ($outcome === ReportResolutionOutcome::STRIKE) {
                $description = is_string($strikeDescription) ? trim($strikeDescription) : '';
                if ($description === '') {
                    throw new ModerationValidationException('A strike description is required when resolving with a strike.');
                }
                if (mb_strlen($description) > 2000) {
                    throw new ModerationValidationException('Strike description cannot exceed 2000 characters.');
                }

                $strike = new UserStrike($target, $actor, $description);
                $target->addStrike();
                $this->entityManager->persist($strike);
            }
            $report->resolve($outcome, $resolutionNote, $actor);
            $this->entityManager->flush();
            $this->entityManager->commit();

            return $strike;
        } catch (\Throwable $exception) {
            $this->rollback();

            throw $exception;
        }
    }

    public function purge(UserReport $report, User $actor): void
    {
        $this->entityManager->beginTransaction();
        try {
            $this->entityManager->lock($report, LockMode::PESSIMISTIC_WRITE);
            $this->entityManager->refresh($report);
            $this->entityManager->refresh($actor);
            $target = $report->reportedUser();
            $canPurgeDeletedTarget = $target === null && $actor->hasRole(Role::OWNER);
            if ((!$target instanceof User || !$this->permissions->canReviewTarget($actor, $target)) && !$canPurgeDeletedTarget) {
                throw new ModerationValidationException('You cannot purge this report.');
            }
            if ($report->status() !== ReportState::RESOLVED) {
                throw new ModerationValidationException('Only resolved reports can be purged.');
            }
            $snapshot = $report->gameEvidenceSnapshot();
            if ($snapshot instanceof GameModerationEvidenceSnapshot) {
                // Serializes purges of several reports sharing this immutable
                // source, so the last purge alone may remove it.
                $this->entityManager->lock($snapshot, LockMode::PESSIMISTIC_WRITE);
                $this->entityManager->refresh($snapshot);
            }
            $this->entityManager->remove($report);
            $this->entityManager->flush();
            if ($snapshot instanceof GameModerationEvidenceSnapshot && $this->entityManager->getRepository(UserReport::class)->count(['gameEvidenceSnapshot' => $snapshot]) === 0) {
                $this->entityManager->remove($snapshot);
                $this->entityManager->flush();
            }
            $this->entityManager->commit();
        } catch (\Throwable $exception) {
            $this->rollback();

            throw $exception;
        }
    }

    private function rollback(): void
    {
        if ($this->entityManager->getConnection()->isTransactionActive()) {
            $this->entityManager->rollback();
        }
    }
}
