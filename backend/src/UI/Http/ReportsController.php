<?php

declare(strict_types=1);

namespace App\UI\Http;

use App\Application\Moderation\DuplicateOpenReportException;
use App\Application\Moderation\ModerationNotFoundException;
use App\Application\Moderation\ModerationValidationException;
use App\Application\Moderation\ReportSubmissionService;
use App\Domain\User\User;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class ReportsController extends ApiController
{
    #[Route('/reports', methods: ['POST'])]
    public function create(
        Request $request,
        #[CurrentUser] User $actor,
        ReportSubmissionService $submission,
    ): JsonResponse {
        try {
            $report = $submission->submit($actor, $this->payload($request));
        } catch (DuplicateOpenReportException $exception) {
            return $this->fail($exception->getMessage(), 409);
        } catch (ModerationNotFoundException $exception) {
            return $this->fail($exception->getMessage(), 404);
        } catch (ModerationValidationException|\InvalidArgumentException $exception) {
            return $this->fail($exception->getMessage());
        }

        return $this->json(['report' => $report->toSubmissionArray()], 201);
    }
}
