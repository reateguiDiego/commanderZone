<?php

namespace App\UI\Http;

use App\Application\Community\CommunityService;
use App\Domain\Localization\LanguageCatalog;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

class CommunityController extends ApiController
{
    #[Route('/community', methods: ['GET'])]
    public function home(Request $request, CommunityService $community): JsonResponse
    {
        $requestedLanguage = $this->requestedLanguage($request);
        if ($requestedLanguage === false) {
            return $this->fail('lang filter is invalid.');
        }

        return $this->json($community->home($requestedLanguage));
    }

    #[Route('/community/decks', methods: ['GET'])]
    public function decks(Request $request, CommunityService $community): JsonResponse
    {
        $requestedLanguage = $this->requestedLanguage($request);
        if ($requestedLanguage === false) {
            return $this->fail('lang filter is invalid.');
        }

        return $this->json($community->decks([
            'q' => $request->query->get('q'),
            'commander' => $request->query->get('commander'),
            'format' => $request->query->get('format'),
            'colors' => $request->query->get('colors'),
        ], $requestedLanguage));
    }

    #[Route('/community/decks/{id}', methods: ['GET'])]
    public function detail(string $id, Request $request, CommunityService $community): JsonResponse
    {
        $requestedLanguage = $this->requestedLanguage($request);
        if ($requestedLanguage === false) {
            return $this->fail('lang filter is invalid.');
        }

        $payload = $community->deckDetail($id, $requestedLanguage);
        if ($payload === null) {
            return $this->fail('Deck not found.', 404);
        }

        return $this->json($payload);
    }

    #[Route('/community/top-commanders', methods: ['GET'])]
    public function topCommanders(Request $request, CommunityService $community): JsonResponse
    {
        $requestedLanguage = $this->requestedLanguage($request);
        if ($requestedLanguage === false) {
            return $this->fail('lang filter is invalid.');
        }

        return $this->json($community->topCommanders([
            'type' => $request->query->get('type'),
            'colors' => $request->query->get('colors'),
        ], $requestedLanguage));
    }

    #[Route('/community/top-cards', methods: ['GET'])]
    public function topCards(Request $request, CommunityService $community): JsonResponse
    {
        $requestedLanguage = $this->requestedLanguage($request);
        if ($requestedLanguage === false) {
            return $this->fail('lang filter is invalid.');
        }

        return $this->json($community->topCards([
            'type' => $request->query->get('type'),
            'colors' => $request->query->get('colors'),
        ], $requestedLanguage));
    }

    private function requestedLanguage(Request $request): string|false|null
    {
        if (!$request->query->has('lang')) {
            return null;
        }

        $requestedLanguage = LanguageCatalog::normalize($request->query->get('lang'));
        if (!LanguageCatalog::isSupported($requestedLanguage)) {
            return false;
        }

        return $requestedLanguage;
    }
}
