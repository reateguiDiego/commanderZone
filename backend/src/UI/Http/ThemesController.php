<?php

namespace App\UI\Http;

use App\Domain\User\User;
use App\Domain\User\UserThemeCatalog;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class ThemesController extends ApiController
{
    #[Route('/themes', methods: ['GET'])]
    public function get(#[CurrentUser] ?User $user): JsonResponse
    {
        if (!$user) {
            return $this->fail('Authentication required.', 401);
        }

        return $this->json(['themeId' => $user->themeId()]);
    }

    #[Route('/themes', methods: ['PUT'])]
    public function put(Request $request, #[CurrentUser] ?User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        if (!$user) {
            return $this->fail('Authentication required.', 401);
        }

        $payload = $this->payload($request);
        $themeId = UserThemeCatalog::normalize($payload['themeId'] ?? null);
        if (!UserThemeCatalog::isSupported($themeId)) {
            return $this->fail('themeId is invalid.');
        }

        $user->updateTheme((string) $themeId);
        $entityManager->flush();

        return $this->json(['themeId' => $user->themeId()]);
    }
}
