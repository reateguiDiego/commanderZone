<?php

namespace App\UI\Http;

use App\Application\Community\CommunityService;
use App\Domain\Localization\LanguageCatalog;
use App\Domain\User\User;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

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
            'page' => $request->query->get('page'),
        ], $requestedLanguage));
    }

    #[Route('/community/decks/{id}', methods: ['GET'])]
    public function detail(string $id, Request $request, CommunityService $community, #[CurrentUser] ?User $user): JsonResponse
    {
        $requestedLanguage = $this->requestedLanguage($request);
        if ($requestedLanguage === false) {
            return $this->fail('lang filter is invalid.');
        }

        $payload = $community->deckDetail($id, $requestedLanguage, $user);
        if ($payload === null) {
            return $this->fail('Deck not found.', 404);
        }

        return $this->json($payload);
    }

    #[Route('/community/decks/{id}/like', methods: ['POST'])]
    public function likeDeck(string $id, CommunityService $community, #[CurrentUser] ?User $user): JsonResponse
    {
        if (!$user instanceof User) {
            return $this->fail('Authentication required.', 401);
        }

        try {
            $payload = $community->likeDeck($id, $user);
        } catch (\DomainException $error) {
            return $this->fail($error->getMessage(), 409);
        }
        if ($payload === null) {
            return $this->fail('Deck not found.', 404);
        }

        return $this->json($payload);
    }

    #[Route('/community/decks/{id}/copy', methods: ['POST'])]
    public function copyDeck(string $id, Request $request, CommunityService $community, #[CurrentUser] ?User $user): JsonResponse
    {
        if (!$user instanceof User) {
            return $this->fail('Authentication required.', 401);
        }

        $requestedLanguage = $this->requestedLanguage($request);
        if ($requestedLanguage === false) {
            return $this->fail('lang filter is invalid.');
        }

        try {
            $payload = $community->copyDeck($id, $user, $requestedLanguage);
        } catch (\DomainException $error) {
            return $this->fail($error->getMessage(), 409);
        }
        if ($payload === null) {
            return $this->fail('Deck not found.', 404);
        }

        return $this->json($payload, 201);
    }

    #[Route('/community/indexable', methods: ['GET'])]
    public function indexable(CommunityService $community): JsonResponse
    {
        return $this->json($community->indexable());
    }

    #[Route('/community/users/{username}', methods: ['GET'])]
    public function user(string $username, Request $request, CommunityService $community): JsonResponse
    {
        $requestedLanguage = $this->requestedLanguage($request);
        if ($requestedLanguage === false) {
            return $this->fail('lang filter is invalid.');
        }

        $payload = $community->user($username, [
            'q' => $request->query->get('q'),
            'commander' => $request->query->get('commander'),
            'format' => $request->query->get('format'),
            'colors' => $request->query->get('colors'),
            'page' => $request->query->get('page'),
        ], $requestedLanguage);
        if ($payload === null) {
            return $this->fail('User not found.', 404);
        }

        return $this->json($payload);
    }

    #[Route('/community/commanders/{slug}', methods: ['GET'])]
    public function commander(string $slug, Request $request, CommunityService $community): JsonResponse
    {
        $requestedLanguage = $this->requestedLanguage($request);
        if ($requestedLanguage === false) {
            return $this->fail('lang filter is invalid.');
        }

        $payload = $community->commanderDetail($slug, $requestedLanguage);
        if ($payload === null) {
            return $this->fail('Commander not found.', 404);
        }

        return $this->json($payload);
    }

    #[Route('/community/cards/{slug}', methods: ['GET'])]
    public function card(string $slug, Request $request, CommunityService $community): JsonResponse
    {
        $requestedLanguage = $this->requestedLanguage($request);
        if ($requestedLanguage === false) {
            return $this->fail('lang filter is invalid.');
        }

        $payload = $community->cardDetail($slug, $requestedLanguage);
        if ($payload === null) {
            return $this->fail('Card not found.', 404);
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
