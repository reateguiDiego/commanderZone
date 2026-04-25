<?php

namespace App\UI\Http;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

abstract class ApiController extends AbstractController
{
    protected function payload(Request $request): array
    {
        if ($request->getContent() === '') {
            return [];
        }

        $decoded = json_decode($request->getContent(), true);

        return is_array($decoded) ? $decoded : [];
    }

    protected function fail(string $message, int $status = 400, array $extra = []): JsonResponse
    {
        return $this->json(['error' => $message, ...$extra], $status);
    }
}
