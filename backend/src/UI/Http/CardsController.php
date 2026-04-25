<?php

namespace App\UI\Http;

use App\Application\Card\CardResolver;
use App\Domain\Card\Card;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\HttpClient\HttpClientInterface;

class CardsController extends ApiController
{
    private const IMAGE_FORMATS = ['small', 'normal', 'large', 'png', 'art_crop', 'border_crop'];
    private const IMAGE_MODES = ['uri', 'redirect', 'binary'];

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

    #[Route('/cards/resolve', methods: ['GET'])]
    public function resolve(Request $request, CardResolver $resolver): JsonResponse
    {
        $matches = $resolver->resolveCandidates([
            'scryfallId' => $request->query->get('scryfallId'),
            'name' => $request->query->get('name'),
            'setCode' => $request->query->get('setCode'),
            'collectorNumber' => $request->query->get('collectorNumber'),
            'flavorName' => $request->query->get('flavorName'),
        ]);

        if ($matches === []) {
            return $this->fail('Card not found.', 404);
        }

        if (count($matches) > 1) {
            return $this->fail('Card resolution is ambiguous.', 409, [
                'matches' => array_map(static fn (Card $card) => $card->toArray(), $matches),
            ]);
        }

        return $this->json(['card' => $matches[0]->toArray()]);
    }

    #[Route('/cards/{scryfallId}/image', methods: ['GET'])]
    public function image(string $scryfallId, Request $request, EntityManagerInterface $entityManager, HttpClientInterface $httpClient): JsonResponse|RedirectResponse|Response
    {
        $card = $entityManager->getRepository(Card::class)->findOneBy(['scryfallId' => $scryfallId]);
        if (!$card instanceof Card) {
            return $this->fail('Card not found.', 404);
        }

        $format = (string) $request->query->get('format', 'normal');
        if (!in_array($format, self::IMAGE_FORMATS, true)) {
            return $this->fail('Image format is invalid.');
        }

        $mode = (string) $request->query->get('mode', 'uri');
        if (!in_array($mode, self::IMAGE_MODES, true)) {
            return $this->fail('Image mode is invalid.');
        }

        $uri = $card->imageUri($format);
        if ($uri === null) {
            return $this->fail('Image format not found for card.', 404);
        }

        if ($mode === 'uri') {
            return $this->json([
                'scryfallId' => $card->scryfallId(),
                'format' => $format,
                'uri' => $uri,
            ]);
        }

        if ($mode === 'redirect') {
            return $this->redirect($uri);
        }

        if (!$this->isAllowedImageUri($uri)) {
            return $this->fail('Image URI host is not allowed.', 502);
        }

        $response = $httpClient->request('GET', $uri, [
            'headers' => ['Accept' => 'image/*'],
        ]);

        return new Response(
            $response->getContent(),
            200,
            [
                'Content-Type' => $response->getHeaders(false)['content-type'][0] ?? 'application/octet-stream',
                'Cache-Control' => 'public, max-age=86400',
            ],
        );
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

    private function isAllowedImageUri(string $uri): bool
    {
        $host = parse_url($uri, PHP_URL_HOST);

        return is_string($host) && (str_ends_with($host, '.scryfall.io') || $host === 'scryfall.io');
    }
}
