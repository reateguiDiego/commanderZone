<?php

namespace App\UI\Http;

use App\Application\Game\GameSnapshotFactory;
use App\Domain\Deck\Deck;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomInvite;
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
    public function list(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $status = (string) $request->query->get('status', 'active');
        $queryBuilder = $entityManager->getRepository(Room::class)->createQueryBuilder('room')
            ->distinct()
            ->leftJoin('room.players', 'player')
            ->addSelect('player')
            ->leftJoin(
                RoomInvite::class,
                'invite',
                'WITH',
                'invite.room = room AND invite.recipient = :user AND invite.status = :pendingInvite',
            )
            ->where('((room.status = :waiting AND room.visibility = :public)')
            ->orWhere('room.owner = :user')
            ->orWhere('player.user = :user')
            ->orWhere('invite.id IS NOT NULL)')
            ->setParameter('waiting', Room::STATUS_WAITING)
            ->setParameter('public', Room::VISIBILITY_PUBLIC)
            ->setParameter('pendingInvite', RoomInvite::STATUS_PENDING)
            ->setParameter('user', $user);

        if ($status === 'archived') {
            $queryBuilder
                ->andWhere('room.status = :archived')
                ->setParameter('archived', Room::STATUS_ARCHIVED);
        } elseif ($status !== 'all') {
            $queryBuilder
                ->andWhere('room.status != :archived')
                ->setParameter('archived', Room::STATUS_ARCHIVED);
        }

        $rooms = $queryBuilder
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
        if (!$deck instanceof Deck) {
            return $this->fail('A valid deck is required to create a room.');
        }

        $this->closeOwnerActiveRooms($entityManager, $user);

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
        $isInvited = $this->isInvitedToRoom($room, $user, $entityManager);
        if (!$room->canBeViewedBy($user, $isInvited)) {
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
        if ($room->visibility() === Room::VISIBILITY_PRIVATE
            && !$room->hasPlayer($user)
            && !$this->isInvitedToRoom($room, $user, $entityManager)) {
            return $this->fail('Private room access denied.', 403);
        }

        $deck = $this->deckFromPayload($this->payload($request), $user, $entityManager);
        if (!$deck instanceof Deck) {
            return $this->fail('A valid deck is required to join a room.');
        }

        $room->addPlayer(new RoomPlayer($room, $user, $deck));
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
        if (!$room->hasPlayer($user)) {
            return $this->fail('Only room players can leave the room.', 403);
        }

        $room->removeUser($user);
        $entityManager->flush();

        return $this->json(['room' => $room->toArray()]);
    }

    #[Route('/rooms/{id}', methods: ['DELETE'])]
    public function delete(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if ($room->owner()->id() !== $user->id()) {
            return $this->fail('Only the room owner can delete the room.', 403);
        }
        if ($room->status() !== Room::STATUS_WAITING) {
            return $this->fail('Started rooms cannot be deleted.', 409);
        }

        $entityManager->remove($room);
        $entityManager->flush();

        return $this->json(null, 204);
    }

    #[Route('/rooms/{id}/archive', methods: ['POST'])]
    public function archive(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if ($room->owner()->id() !== $user->id()) {
            return $this->fail('Only the room owner can archive the room.', 403);
        }
        if ($room->status() === Room::STATUS_ARCHIVED) {
            return $this->json(['room' => $room->toArray()]);
        }
        if ($room->status() !== Room::STATUS_STARTED && !$room->game() instanceof Game) {
            return $this->fail('Only started rooms can be archived.', 409);
        }

        $room->archive();
        $room->game()?->finish();
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
        foreach ($room->players() as $player) {
            if (!$player instanceof RoomPlayer || !$player->deck() instanceof Deck) {
                return $this->fail('Every player needs a deck before starting the game.');
            }
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

    private function closeOwnerActiveRooms(EntityManagerInterface $entityManager, User $owner): void
    {
        $activeRooms = $entityManager->getRepository(Room::class)->createQueryBuilder('room')
            ->where('room.owner = :owner')
            ->andWhere('room.status != :archived')
            ->setParameter('owner', $owner)
            ->setParameter('archived', Room::STATUS_ARCHIVED)
            ->getQuery()
            ->getResult();

        foreach ($activeRooms as $activeRoom) {
            if (!$activeRoom instanceof Room) {
                continue;
            }

            if ($activeRoom->status() === Room::STATUS_WAITING) {
                $entityManager->remove($activeRoom);
                continue;
            }

            $activeRoom->archive();
            $activeRoom->game()?->finish();
        }
    }

    private function isInvitedToRoom(Room $room, User $user, EntityManagerInterface $entityManager): bool
    {
        $invite = $entityManager->getRepository(RoomInvite::class)->findOneBy([
            'room' => $room,
            'recipient' => $user,
            'status' => RoomInvite::STATUS_PENDING,
        ]);

        return $invite instanceof RoomInvite;
    }
}
