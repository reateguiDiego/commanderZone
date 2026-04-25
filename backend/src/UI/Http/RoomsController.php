<?php

namespace App\UI\Http;

use App\Application\Game\GameSnapshotFactory;
use App\Domain\Deck\Deck;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class RoomsController extends ApiController
{
    #[Route('/rooms', methods: ['GET'])]
    public function list(#[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $rooms = $entityManager->getRepository(Room::class)->createQueryBuilder('room')
            ->distinct()
            ->leftJoin('room.players', 'player')
            ->addSelect('player')
            ->where('(room.status = :waiting AND room.visibility = :public)')
            ->orWhere('room.owner = :user')
            ->orWhere('player.user = :user')
            ->setParameter('waiting', Room::STATUS_WAITING)
            ->setParameter('public', Room::VISIBILITY_PUBLIC)
            ->setParameter('user', $user)
            ->orderBy('room.createdAt', 'DESC')
            ->getQuery()
            ->getResult();

        return $this->json(['data' => array_map(static fn (Room $room) => $room->toArray(), $rooms)]);
    }

    #[Route('/rooms', methods: ['POST'])]
    public function create(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $payload = $this->payload($request);
        $deck = $this->deckFromPayload($payload, $user, $entityManager);

        $room = new Room($user);
        $room->setVisibility((string) ($payload['visibility'] ?? Room::VISIBILITY_PRIVATE));
        $room->addPlayer(new RoomPlayer($room, $user, $deck));

        $entityManager->persist($room);
        $entityManager->flush();

        return $this->json(['room' => $room->toArray()], 201);
    }

    #[Route('/rooms/{id}', methods: ['GET'])]
    public function show(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if (!$room->canBeViewedBy($user)) {
            return $this->fail('Room access denied.', 403);
        }

        return $this->json(['room' => $room->toArray()]);
    }

    #[Route('/rooms/{id}/join', methods: ['POST'])]
    public function join(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if ($room->status() !== Room::STATUS_WAITING) {
            return $this->fail('Room has already started.', 409);
        }

        $room->addPlayer(new RoomPlayer($room, $user, $this->deckFromPayload($this->payload($request), $user, $entityManager)));
        $entityManager->flush();

        return $this->json(['room' => $room->toArray()]);
    }

    #[Route('/rooms/{id}/leave', methods: ['POST'])]
    public function leave(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if ($room->status() !== Room::STATUS_WAITING) {
            return $this->fail('Started rooms cannot be left.', 409);
        }

        $room->removeUser($user);
        $entityManager->flush();

        return $this->json(['room' => $room->toArray()]);
    }

    #[Route('/rooms/{id}/start', methods: ['POST'])]
    public function start(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager, GameSnapshotFactory $snapshotFactory): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if ($room->owner()->id() !== $user->id()) {
            return $this->fail('Only the room owner can start the game.', 403);
        }
        if ($room->status() !== Room::STATUS_WAITING) {
            return $this->fail('Room has already started.', 409);
        }
        if ($room->players()->count() < 2) {
            return $this->fail('At least two players are required.');
        }

        $game = new Game($room, $snapshotFactory->fromRoom($room));
        $room->start($game);
        $entityManager->persist($game);
        $entityManager->flush();

        return $this->json(['room' => $room->toArray(), 'game' => $game->toArray()], 201);
    }

    private function deckFromPayload(array $payload, User $user, EntityManagerInterface $entityManager): ?Deck
    {
        $deckId = $payload['deckId'] ?? null;
        if (!is_string($deckId) || $deckId === '') {
            return null;
        }

        $deck = $entityManager->getRepository(Deck::class)->find($deckId);

        return $deck instanceof Deck && $deck->owner()->id() === $user->id() ? $deck : null;
    }
}
