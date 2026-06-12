<?php

namespace App\UI\Http;

use App\Application\Deck\DeckFormatCatalog;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

class DeckFormatsController extends ApiController
{
    #[Route('/deck-formats', methods: ['GET'])]
    public function list(): JsonResponse
    {
        return $this->json([
            'data' => DeckFormatCatalog::all(),
        ]);
    }
}
