<?php

namespace App\UI\Http;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

final class HealthController
{
    #[Route('/healthz', methods: ['GET'])]
    public function healthz(): JsonResponse
    {
        return new JsonResponse(['status' => 'ok']);
    }

    #[Route('/readyz', methods: ['GET'])]
    public function readyz(): JsonResponse
    {
        return new JsonResponse(['status' => 'ready']);
    }
}
