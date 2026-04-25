<?php

namespace App\UI\Http;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

class DeckFormatsController extends ApiController
{
    #[Route('/deck-formats', methods: ['GET'])]
    public function list(): JsonResponse
    {
        return $this->json([
            'data' => [
                [
                    'id' => 'commander',
                    'name' => 'Commander',
                    'minCards' => 100,
                    'maxCards' => 100,
                    'hasCommander' => true,
                ],
            ],
        ]);
    }
}
