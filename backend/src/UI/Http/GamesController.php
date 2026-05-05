<?php

namespace App\UI\Http;

use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameProjectionService;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\User\User;
use App\Infrastructure\Realtime\GameEventPublisher;
use Doctrine\DBAL\Exception\DeadlockException;
use Doctrine\DBAL\Exception\LockWaitTimeoutException;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class GamesController extends ApiController
{
    #[Route('/games/{id}/snapshot', methods: ['GET'])]
    public function snapshot(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager, GameProjectionService $projection): JsonResponse
    {
        $game = $entityManager->getRepository(Game::class)->find($id);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
        }
        if (!$game->canBeAccessedBy($user)) {
            return $this->fail('Game access denied.', 403);
        }

        return $this->json([
            'game' => [
                ...$game->toArray(),
                'snapshot' => $projection->project($game, $user),
            ],
        ]);
    }

    #[Route('/games/{id}/commands', methods: ['POST'])]
    public function command(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, GameCommandHandler $handler, GameProjectionService $projection, GameEventPublisher $publisher): JsonResponse
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
        if (!GameCommandHandler::isSupportedCommand($type)) {
            return $this->fail(sprintf('Unknown game command: %s', $type));
        }
        if ($game->status() === Game::STATUS_FINISHED && !GameCommandHandler::isAllowedWhenFinished($type)) {
            return $this->fail(sprintf('Game is finished. Command not allowed: %s', $type), 409);
        }

        $clientActionId = isset($payload['clientActionId']) && is_string($payload['clientActionId']) && trim($payload['clientActionId']) !== ''
            ? trim($payload['clientActionId'])
            : null;
        if ($clientActionId !== null) {
            $existingEvent = $entityManager->getRepository(GameEvent::class)->findOneBy([
                'game' => $game,
                'clientActionId' => $clientActionId,
            ]);
            if ($existingEvent instanceof GameEvent) {
                return $this->existingEventResponse($existingEvent, $game, $user, $projection);
            }
        }

        $event = null;
        try {
            $entityManager->beginTransaction();
            $entityManager->lock($game, LockMode::PESSIMISTIC_WRITE);
            if ($game->status() === Game::STATUS_FINISHED && !GameCommandHandler::isAllowedWhenFinished($type)) {
                $entityManager->rollback();

                return $this->fail(sprintf('Game is finished. Command not allowed: %s', $type), 409);
            }
            if ($clientActionId !== null) {
                $existingEvent = $entityManager->getRepository(GameEvent::class)->findOneBy([
                    'game' => $game,
                    'clientActionId' => $clientActionId,
                ]);
                if ($existingEvent instanceof GameEvent) {
                    $entityManager->rollback();

                    return $this->existingEventResponse($existingEvent, $game, $user, $projection);
                }
            }

            $event = $handler->apply($game, $type, is_array($payload['payload'] ?? null) ? $payload['payload'] : [], $user, $clientActionId);
            $entityManager->persist($event);
            $entityManager->flush();
            $entityManager->commit();
        } catch (\InvalidArgumentException $exception) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }

            return $this->fail($exception->getMessage());
        } catch (UniqueConstraintViolationException) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }
            $existingEvent = $clientActionId === null
                ? null
                : $entityManager->getRepository(GameEvent::class)->findOneBy([
                    'game' => $game,
                    'clientActionId' => $clientActionId,
                ]);
            if ($existingEvent instanceof GameEvent) {
                return $this->existingEventResponse($existingEvent, $game, $user, $projection);
            }

            return $this->fail('Command conflict. Please retry.', 409);
        } catch (DeadlockException|LockWaitTimeoutException) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }

            return $this->fail('Game command conflict. Please retry.', 409);
        } catch (\Throwable $exception) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }

            throw $exception;
        }

        if (!$event instanceof GameEvent) {
            return $this->fail('Could not apply game command.', 500);
        }

        $publisher->publish($game, $event);

        return $this->json([
            'event' => $event->toArray(),
            'snapshot' => $projection->project($game, $user),
            'version' => $game->snapshot()['version'] ?? null,
            'applied' => true,
        ], 201);
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

    #[Route('/games/{id}/zones/{playerId}/{zone}', methods: ['GET'])]
    public function zone(string $id, string $playerId, string $zone, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, GameProjectionService $projection, GameCommandHandler $normalizer): JsonResponse
    {
        $game = $entityManager->getRepository(Game::class)->find($id);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
        }
        if (!$game->canBeAccessedBy($user)) {
            return $this->fail('Game access denied.', 403);
        }

        $snapshot = $normalizer->normalizeSnapshot($game->snapshot());
        if (!isset($snapshot['players'][$playerId]['zones'][$zone])) {
            return $this->fail('Zone not found.', 404);
        }

        $cards = $projection->projectZone($snapshot['players'][$playerId]['zones'][$zone], $playerId, $zone, $user);
        $type = mb_strtolower(trim((string) $request->query->get('type', '')));
        $search = mb_strtolower(trim((string) $request->query->get('search', '')));

        if ($type !== '') {
            $cards = array_values(array_filter($cards, static fn (array $card): bool => str_contains(mb_strtolower((string) ($card['typeLine'] ?? '')), $type)));
        }
        if ($search !== '') {
            $cards = array_values(array_filter($cards, static fn (array $card): bool => str_contains(mb_strtolower((string) ($card['name'] ?? '')), $search)));
        }

        $limit = max(1, min(200, (int) $request->query->get('limit', 100)));
        $offset = max(0, (int) $request->query->get('offset', 0));

        return $this->json([
            'gameId' => $game->id(),
            'playerId' => $playerId,
            'zone' => $zone,
            'total' => count($cards),
            'data' => array_slice($cards, $offset, $limit),
        ]);
    }

    private function existingEventResponse(GameEvent $event, Game $game, User $user, GameProjectionService $projection): JsonResponse
    {
        return $this->json([
            'event' => $event->toArray(),
            'snapshot' => $projection->project($game, $user),
            'version' => $game->snapshot()['version'] ?? null,
            'applied' => false,
        ]);
    }
}
