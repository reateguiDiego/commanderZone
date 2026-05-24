<?php

namespace App\UI\Http;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Mercure\Authorization;
use Symfony\Component\Mercure\Exception\RuntimeException as MercureRuntimeException;
use Symfony\Component\Routing\Attribute\Route;

class MercureController extends ApiController
{
    #[Route('/realtime/mercure-cookie', methods: ['POST'])]
    public function authorize(Request $request, Authorization $authorization): JsonResponse
    {
        try {
            $authorization->setCookie($request, ['*']);
        } catch (MercureRuntimeException $exception) {
            if (str_contains($exception->getMessage(), 'different second-level domain')) {
                // In local setups, localhost and 127.0.0.1 are treated as different domains.
                // Do not fail hard: Mercure can still work when the hub allows anonymous subscribers.
                return $this->json(null, 204);
            }

            throw $exception;
        }

        return $this->json(null, 204);
    }
}
