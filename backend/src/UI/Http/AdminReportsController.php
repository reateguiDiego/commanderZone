<?php

namespace App\UI\Http;

use App\Domain\Report\UserReport;
use App\Domain\User\Role;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class AdminReportsController extends ApiController
{
    #[Route('/admin/reports', methods: ['GET'])]
    public function list(#[CurrentUser] User $actor, EntityManagerInterface $entityManager): JsonResponse
    {
        if (!$actor->hasRole(Role::ADMIN) && !$actor->hasRole(Role::OWNER)) {
            return $this->fail('Admin access is required.', 403);
        }

        $reports = $entityManager->getRepository(UserReport::class)->createQueryBuilder('report')
            ->innerJoin('report.reporter', 'reporter')
            ->addSelect('reporter')
            ->innerJoin('report.reportedUser', 'reportedUser')
            ->addSelect('reportedUser')
            ->orderBy('report.createdAt', 'DESC')
            ->setMaxResults(500)
            ->getQuery()
            ->getResult();

        return $this->json([
            'reports' => array_map(
                static fn (UserReport $report): array => $report->toAdminArray(),
                array_values(array_filter($reports, static fn (mixed $report): bool => $report instanceof UserReport)),
            ),
        ]);
    }
}
