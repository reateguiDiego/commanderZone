<?php

namespace App\UI\Http;

use App\Application\Game\GameCommandHandler;
use App\Domain\Game\Game;
use App\Domain\User\User;
use App\Infrastructure\Realtime\GameEventPublisher;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class GamesController extends ApiController
{
    #[Route('/games/{id}/snapshot', methods: ['GET'])]
    public function snapshot(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $game = $entityManager->getRepository(Game::class)->find($id);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
        }
        if (!$game->canBeAccessedBy($user)) {
            return $this->fail('Game access denied.', 403);
        }

        return $this->json(['game' => $game->toArray()]);
    }

    #[Route('/games/{id}/commands', methods: ['POST'])]
    public function command(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, GameCommandHandler $handler, GameEventPublisher $publisher): JsonResponse
    {
        $game = $entityManager->getRepository(Game::class)->find($id);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
        }
        if (!$game->canBeAccessedBy($user)) {
            return $this->fail('Game access denied.', 403);
        }

        $payload = $this->payload($request);
        $type = trim((string) ($payload['type'] ?? ''));
        if ($type === '') {
            return $this->fail('Command type is required.');
        }

        $event = $handler->apply($game, $type, is_array($payload['payload'] ?? null) ? $payload['payload'] : [], $user);
        $entityManager->persist($event);
        $entityManager->flush();
        $publisher->publish($game, $event);

        return $this->json(['event' => $event->toArray(), 'snapshot' => $game->snapshot()], 201);
    }

    #[Route('/games/{id}/events', methods: ['GET'])]
    public function events(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $game = $entityManager->getRepository(Game::class)->find($id);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
        }
        if (!$game->canBeAccessedBy($user)) {
            return $this->fail('Game access denied.', 403);
        }

        $limit = max(1, min(500, (int) $request->query->get('limit', 200)));
        $after = $request->query->get('after');
        $afterDate = null;
        if (is_string($after) && $after !== '') {
            try {
                $afterDate = new \DateTimeImmutable($after);
            } catch (\Exception) {
                return $this->fail('after must be a valid ISO-8601 date-time.');
            }
        }

        $queryBuilder = $entityManager->getRepository(\App\Domain\Game\GameEvent::class)->createQueryBuilder('event')
            ->where('event.game = :game')
            ->setParameter('game', $game)
            ->orderBy('event.createdAt', 'ASC')
            ->setMaxResults($limit);

        if ($afterDate instanceof \DateTimeImmutable) {
            $queryBuilder
                ->andWhere('event.createdAt > :after')
                ->setParameter('after', $afterDate);
        }

        return $this->json([
            'data' => array_map(
                static fn (\App\Domain\Game\GameEvent $event) => $event->toArray(),
                $queryBuilder->getQuery()->getResult(),
            ),
            'limit' => $limit,
        ]);
    }
}
