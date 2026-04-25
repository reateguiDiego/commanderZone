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
    public function snapshot(string $id, EntityManagerInterface $entityManager): JsonResponse
    {
        $game = $entityManager->getRepository(Game::class)->find($id);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
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
}
