<?php

namespace App\UI\Http;

use App\Application\Deck\DecklistParser;
use App\Application\Deck\DecklistPreviewer;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

class DecklistsController extends ApiController
{
    #[Route('/decklists/parse', methods: ['POST'])]
    public function parse(Request $request, DecklistParser $parser, DecklistPreviewer $previewer): JsonResponse
    {
        $payload = $this->payload($request);
        $decklist = (string) ($payload['decklist'] ?? '');
        $format = $parser->resolveFormat($payload['format'] ?? null, $decklist);
        if ($format === null) {
            return $this->fail('Decklist format is invalid.');
        }

        $entries = $parser->parse($decklist, $format);

        return $this->json($previewer->toArray($previewer->preview($entries, $format)));
    }
}
