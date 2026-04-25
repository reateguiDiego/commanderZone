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

        $where = [];
        $params = [];

        if ($query !== '') {
            $where[] = 'normalized_name LIKE :query';
            $params['query'] = '%'.$query.'%';
        }

        $commanderLegal = $request->query->get('commanderLegal');
        if ($commanderLegal !== null && $commanderLegal !== '') {
            $where[] = 'commander_legal = :commanderLegal';
            $params['commanderLegal'] = filter_var($commanderLegal, FILTER_VALIDATE_BOOLEAN);
        }

        $type = mb_strtolower(trim((string) $request->query->get('type', '')));
        if ($type !== '') {
            $allowedTypes = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land'];
            if (!in_array($type, $allowedTypes, true)) {
                return $this->fail('type filter is invalid.');
            }

            $where[] = 'LOWER(type_line) LIKE :type';
            $params['type'] = '%'.$type.'%';
        }

        $colorIdentity = trim((string) $request->query->get('colorIdentity', ''));
        if ($colorIdentity !== '') {
            foreach (array_filter(array_map('trim', explode(',', strtoupper($colorIdentity)))) as $index => $color) {
                if (!in_array($color, ['W', 'U', 'B', 'R', 'G'], true)) {
                    return $this->fail('colorIdentity filter is invalid.');
                }

                $where[] = sprintf('color_identity::text LIKE :colorIdentity%d', $index);
                $params[sprintf('colorIdentity%d', $index)] = '%"'.$color.'"%';
            }
        }

        $sql = 'SELECT id FROM card';
        if ($where !== []) {
            $sql .= ' WHERE '.implode(' AND ', $where);
        }
        $sql .= sprintf(' ORDER BY name ASC LIMIT %d OFFSET %d', $limit, ($page - 1) * $limit);

        $ids = $entityManager->getConnection()->fetchFirstColumn($sql, $params);
        if ($ids === []) {
            return $this->json(['data' => [], 'page' => $page, 'limit' => $limit]);
        }

        $cardsById = [];
        foreach ($entityManager->getRepository(Card::class)->findBy(['id' => $ids]) as $card) {
            if ($card instanceof Card) {
                $cardsById[$card->id()] = $card;
            }
        }

        $cards = [];
        foreach ($ids as $id) {
            if (isset($cardsById[$id])) {
                $cards[] = $cardsById[$id]->toArray();
            }
        }

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
