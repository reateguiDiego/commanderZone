<?php

declare(strict_types=1);

namespace App\UI\Http;

use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

class LandingController extends ApiController
{
    #[Route('/landing/preview', methods: ['GET'])]
    public function preview(EntityManagerInterface $entityManager): JsonResponse
    {
        $connection = $entityManager->getConnection();
        $cardName = $connection->fetchOne("SELECT name FROM card WHERE name <> '' ORDER BY RANDOM() LIMIT 1");
        $displayName = $connection->fetchOne("SELECT display_name FROM app_user WHERE display_name <> '' ORDER BY RANDOM() LIMIT 1");

        return $this->json([
            'cardName' => is_string($cardName) && $cardName !== '' ? $cardName : 'Sol Ring',
            'displayName' => is_string($displayName) && $displayName !== '' ? $displayName : 'Guest player',
        ]);
    }
}
