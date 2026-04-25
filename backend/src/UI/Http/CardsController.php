<?php

namespace App\UI\Http;

use App\Domain\Card\Card;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

class CardsController extends ApiController
{
    #[Route('/cards/search', methods: ['GET'])]
    public function search(Request $request, EntityManagerInterface $entityManager): JsonResponse
    {
        $query = Card::normalizeName((string) $request->query->get('q', ''));
        $page = max(1, (int) $request->query->get('page', 1));
        $limit = min(50, max(1, (int) $request->query->get('limit', 25)));

        $qb = $entityManager->createQueryBuilder()
            ->select('card')
            ->from(Card::class, 'card')
            ->orderBy('card.name', 'ASC')
            ->setFirstResult(($page - 1) * $limit)
            ->setMaxResults($limit);

        if ($query !== '') {
            $qb->where('card.normalizedName LIKE :query')
                ->setParameter('query', '%'.$query.'%');
        }

        $cards = array_map(static fn (Card $card) => $card->toArray(), $qb->getQuery()->getResult());

        return $this->json(['data' => $cards, 'page' => $page, 'limit' => $limit]);
    }

    #[Route('/cards/{scryfallId}', methods: ['GET'])]
    public function show(string $scryfallId, EntityManagerInterface $entityManager): JsonResponse
    {
        $card = $entityManager->getRepository(Card::class)->findOneBy(['scryfallId' => $scryfallId]);
        if (!$card instanceof Card) {
            return $this->fail('Card not found.', 404);
        }

        return $this->json(['card' => $card->toArray()]);
    }
}
