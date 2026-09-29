<?php

declare(strict_types=1);

namespace App\Application\Moderation;

use App\Domain\Report\ReportState;
use App\Domain\Report\UserReport;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;

class ModerationReportQueryService
{
    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        private readonly ModerationPermissionPolicy $permissions,
    ) {
    }

    /** @return array{reports:list<array<string,mixed>>,page:int,limit:int,total:int,totalPages:int} */
    public function pendingReports(User $actor, int $requestedPage, int $requestedLimit): array
    {
        $visibleReports = $this->visiblePendingReports($actor);
        $limit = min(100, max(1, $requestedLimit));
        $total = count($visibleReports);
        $totalPages = max(1, (int) ceil($total / $limit));
        $page = min(max(1, $requestedPage), $totalPages);
        $pageReports = array_slice($visibleReports, ($page - 1) * $limit, $limit);

        return [
            'reports' => array_map(static fn (UserReport $report): array => $report->toAdminListArray(), $pageReports),
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'totalPages' => $totalPages,
        ];
    }

    public function pendingReviewCount(User $actor): int
    {
        return count($this->visiblePendingReports($actor));
    }

    public function detail(User $actor, string $id): UserReport
    {
        $report = $this->entityManager->getRepository(UserReport::class)->createQueryBuilder('report')
            ->leftJoin('report.reporter', 'reporter')
            ->addSelect('reporter')
            ->leftJoin('report.reportedUser', 'reportedUser')
            ->addSelect('reportedUser')
            ->leftJoin('report.resolvedBy', 'resolvedBy')
            ->addSelect('resolvedBy')
            ->leftJoin('report.gameEvidenceSnapshot', 'snapshot')
            ->addSelect('snapshot')
            ->where('report.id = :id')
            ->setParameter('id', $id)
            ->getQuery()
            ->getOneOrNullResult();
        if (!$report instanceof UserReport) {
            throw new ModerationNotFoundException('Report not found.');
        }
        if (!$this->canAccessReport($actor, $report)) {
            throw new ModerationValidationException('You cannot access this report.');
        }

        return $report;
    }

    /** @return list<UserReport> */
    private function visiblePendingReports(User $actor): array
    {
        if (!$this->permissions->canAccessModeration($actor)) {
            return [];
        }

        $reports = $this->entityManager->getRepository(UserReport::class)->createQueryBuilder('report')
            ->leftJoin('report.reporter', 'reporter')
            ->addSelect('reporter')
            ->innerJoin('report.reportedUser', 'reportedUser')
            ->addSelect('reportedUser')
            ->where('report.status = :status')
            ->setParameter('status', ReportState::PENDING_REVIEW)
            ->orderBy('report.createdAt', 'ASC')
            ->addOrderBy('report.id', 'ASC')
            ->getQuery()
            ->getResult();

        return array_values(array_filter(
            $reports,
            fn (mixed $report): bool => $report instanceof UserReport && $this->permissions->canReviewReport($actor, $report),
        ));
    }

    private function canAccessReport(User $actor, UserReport $report): bool
    {
        if ($this->permissions->canReviewReport($actor, $report)) {
            return true;
        }

        // Resolved records may intentionally outlive the reported account.
        return $report->status() === ReportState::RESOLVED && $report->reportedUser() === null && $actor->hasRole(\App\Domain\User\Role::OWNER);
    }
}
