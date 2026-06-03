<?php

declare(strict_types=1);

namespace App\UI\Http;

use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

class LandingController extends ApiController
{
    #[Route('/landing/preview', methods: ['GET'])]
    public function preview(EntityManagerInterface $entityManager): JsonResponse
    {
        $connection = $entityManager->getConnection();
        $cardName = $this->randomStoredValue($connection, 'card', 'id', 'name');
        $displayName = $this->randomStoredValue($connection, 'app_user', 'id', 'display_name');

        return $this->json([
            'cardName' => is_string($cardName) && $cardName !== '' ? $cardName : 'Sol Ring',
            'displayName' => is_string($displayName) && $displayName !== '' ? $displayName : 'Guest player',
        ]);
    }

    private function randomStoredValue(Connection $connection, string $table, string $orderColumn, string $valueColumn): ?string
    {
        $count = (int) $connection->fetchOne(sprintf(
            "SELECT COUNT(*) FROM %s WHERE COALESCE(%s, '') <> ''",
            $table,
            $valueColumn,
        ));
        if ($count <= 0) {
            return null;
        }

        $offset = random_int(0, $count - 1);
        $value = $connection->fetchOne(sprintf(
            "SELECT %s FROM %s WHERE COALESCE(%s, '') <> '' ORDER BY %s ASC LIMIT 1 OFFSET %d",
            $valueColumn,
            $table,
            $valueColumn,
            $orderColumn,
            $offset,
        ));

        return is_string($value) && $value !== '' ? $value : null;
    }
}
