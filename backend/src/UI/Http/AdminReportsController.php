<?php

declare(strict_types=1);

namespace App\UI\Http;

use App\Application\Moderation\ModerationPermissionPolicy;
use App\Application\Moderation\ModerationReportQueryService;
use App\Application\Moderation\ModerationReportResolutionService;
use App\Application\Moderation\ModerationSummaryPublisher;
use App\Application\Moderation\ModerationNotFoundException;
use App\Application\Moderation\ModerationValidationException;
use App\Domain\Report\ReportResolutionOutcome;
use App\Domain\User\User;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class AdminReportsController extends ApiController
{
    #[Route('/admin/reports/summary', methods: ['GET'])]
    public function summary(
        #[CurrentUser] User $actor,
        ModerationPermissionPolicy $permissions,
        ModerationReportQueryService $reports,
    ): JsonResponse {
        if (!$permissions->canAccessModeration($actor)) {
            return $this->fail('Admin access is required.', 403);
        }

        return $this->json(['pendingReviewCount' => $reports->pendingReviewCount($actor)]);
    }

    #[Route('/admin/reports', methods: ['GET'])]
    public function list(
        Request $request,
        #[CurrentUser] User $actor,
        ModerationPermissionPolicy $permissions,
        ModerationReportQueryService $reports,
    ): JsonResponse {
        if (!$permissions->canAccessModeration($actor)) {
            return $this->fail('Admin access is required.', 403);
        }

        return $this->json($reports->pendingReports(
            $actor,
            $this->positiveInteger($request->query->get('page'), 1),
            $this->positiveInteger($request->query->get('limit'), 30),
        ));
    }

    #[Route('/admin/reports/{id}', methods: ['GET'])]
    public function detail(
        string $id,
        #[CurrentUser] User $actor,
        ModerationPermissionPolicy $permissions,
        ModerationReportQueryService $reports,
    ): JsonResponse {
        if (!$permissions->canAccessModeration($actor)) {
            return $this->fail('Admin access is required.', 403);
        }

        try {
            $report = $reports->detail($actor, $id);
        } catch (ModerationNotFoundException $exception) {
            return $this->fail($exception->getMessage(), 404);
        } catch (ModerationValidationException $exception) {
            return $this->fail($exception->getMessage(), 403);
        }

        return $this->json(['report' => $report->toAdminDetailArray()]);
    }

    #[Route('/admin/reports/{id}/resolution', methods: ['PATCH'])]
    public function resolve(
        string $id,
        Request $request,
        #[CurrentUser] User $actor,
        ModerationPermissionPolicy $permissions,
        ModerationReportQueryService $reports,
        ModerationReportResolutionService $resolution,
        ModerationSummaryPublisher $publisher,
    ): JsonResponse {
        if (!$permissions->canAccessModeration($actor)) {
            return $this->fail('Admin access is required.', 403);
        }

        $payload = $this->payload($request);
        $outcome = is_string($payload['outcome'] ?? null) ? ReportResolutionOutcome::tryFrom($payload['outcome']) : null;
        if (!$outcome instanceof ReportResolutionOutcome) {
            return $this->fail('Unsupported resolution outcome.');
        }
        $note = $payload['resolutionNote'] ?? null;
        $strikeDescription = $payload['strikeDescription'] ?? null;
        if (($note !== null && !is_string($note)) || ($strikeDescription !== null && !is_string($strikeDescription))) {
            return $this->fail('Resolution fields must be strings.');
        }

        try {
            $report = $reports->detail($actor, $id);
            $strike = $resolution->resolve($report, $actor, $outcome, $note, $strikeDescription);
        } catch (ModerationNotFoundException $exception) {
            return $this->fail($exception->getMessage(), 404);
        } catch (ModerationValidationException|\LogicException|\InvalidArgumentException $exception) {
            // The actor was authorized for moderation before attempting the
            // state transition; malformed/obsolete resolution state is a
            // request conflict, not a loss of endpoint authorization.
            return $this->fail($exception->getMessage());
        }
        $this->invalidateSummaryBestEffort($publisher);

        return $this->json([
            'report' => $report->toAdminDetailArray(),
            'strike' => $strike?->toAdminArray(),
        ]);
    }

    #[Route('/admin/reports/{id}', methods: ['DELETE'])]
    public function purge(
        string $id,
        #[CurrentUser] User $actor,
        ModerationPermissionPolicy $permissions,
        ModerationReportQueryService $reports,
        ModerationReportResolutionService $resolution,
        ModerationSummaryPublisher $publisher,
    ): JsonResponse {
        if (!$permissions->canAccessModeration($actor)) {
            return $this->fail('Admin access is required.', 403);
        }

        try {
            $report = $reports->detail($actor, $id);
            $resolution->purge($report, $actor);
        } catch (ModerationNotFoundException $exception) {
            return $this->fail($exception->getMessage(), 404);
        } catch (ModerationValidationException $exception) {
            return $this->fail($exception->getMessage());
        }
        $this->invalidateSummaryBestEffort($publisher);

        return $this->json(null, 204);
    }

    private function positiveInteger(mixed $value, int $default): int
    {
        if (!is_string($value) && !is_int($value)) {
            return $default;
        }

        $parsed = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return is_int($parsed) ? $parsed : $default;
    }

    private function invalidateSummaryBestEffort(ModerationSummaryPublisher $publisher): void
    {
        // Resolution/purge is committed by the application service. Mercure
        // is an advisory invalidation channel, never part of its outcome.
        try {
            $publisher->invalidate();
        } catch (\Throwable) {
        }
    }
}
