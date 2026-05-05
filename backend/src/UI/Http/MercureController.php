<?php

namespace App\UI\Http;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Mercure\Authorization;
use Symfony\Component\Routing\Attribute\Route;

class MercureController extends ApiController
{
    #[Route('/realtime/mercure-cookie', methods: ['POST'])]
    public function authorize(Request $request, Authorization $authorization): JsonResponse
    {
        $authorization->setCookie($request, ['*']);

        return $this->json(null, 204);
    }
}
