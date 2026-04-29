<?php

namespace App\UI\Http;

use App\Domain\Friendship\Friendship;
use App\Domain\Deck\Deck;
use App\Domain\Room\Room;
use App\Domain\Room\RoomInvite;
use App\Domain\Room\RoomPlayer;
use App\Domain\TableAssistant\TableAssistantRoom;
use App\Domain\User\User;
use App\Infrastructure\Realtime\TableAssistantEventPublisher;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class RoomInvitesController extends ApiController
{
    #[Route('/rooms/invites/incoming', methods: ['GET'])]
    public function incoming(#[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $invites = $entityManager->getRepository(RoomInvite::class)->findBy(
            ['recipient' => $user, 'status' => RoomInvite::STATUS_PENDING],
            ['createdAt' => 'DESC'],
        );

        return $this->json(['data' => array_map(static fn (RoomInvite $invite) => $invite->toArray(), $invites)]);
    }

    #[Route('/rooms/{id}/invites', methods: ['POST'])]
    public function invite(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, TableAssistantEventPublisher $publisher): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if ($room->status() !== Room::STATUS_WAITING) {
            return $this->fail('Only waiting rooms can receive invites.', 409);
        }
        if (!$room->hasPlayer($user)) {
            return $this->fail('Only room players can invite friends.', 403);
        }

        $recipientId = trim((string) ($this->payload($request)['userId'] ?? ''));
        $recipient = $entityManager->getRepository(User::class)->find($recipientId);
        if (!$recipient instanceof User) {
            return $this->fail('User not found.', 404);
        }
        if ($recipient->id() === $user->id()) {
            return $this->fail('You cannot invite yourself.');
        }
        if ($room->hasPlayer($recipient)) {
            return $this->fail('User is already in the room.', 409);
        }
        if (!$this->areAcceptedFriends($entityManager, $user, $recipient)) {
            return $this->fail('Only accepted friends can be invited.', 403);
        }

        $invite = $entityManager->getRepository(RoomInvite::class)->findOneBy([
            'room' => $room,
            'recipient' => $recipient,
            'status' => RoomInvite::STATUS_PENDING,
        ]);

        if (!$invite instanceof RoomInvite) {
            $invite = new RoomInvite($room, $user, $recipient);
            $entityManager->persist($invite);
        }

        $entityManager->flush();
        $this->publishTableAssistantInvitationEvent($entityManager, $publisher, $room, 'friend.invited', $invite);

        return $this->json(['invite' => $invite->toArray()], 201);
    }

    #[Route('/rooms/invites/{id}/accept', methods: ['POST'])]
    public function accept(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, TableAssistantEventPublisher $publisher): JsonResponse
    {
        $invite = $this->pendingInvite($entityManager, $id, $user);
        if (!$invite instanceof RoomInvite) {
            return $this->fail('Room invite not found.', 404);
        }
        if ($invite->room()->status() !== Room::STATUS_WAITING) {
            return $this->fail('Room has already started.', 409);
        }

        $deck = $this->deckFromPayload($this->payload($request), $user, $entityManager);
        $invite->room()->addPlayer(new RoomPlayer($invite->room(), $user, $deck));
        $invite->accept();
        $entityManager->flush();
        $this->publishTableAssistantInvitationEvent($entityManager, $publisher, $invite->room(), 'invitation.accepted', $invite);

        return $this->json(['invite' => $invite->toArray(), 'room' => $invite->room()->toArray()]);
    }

    #[Route('/rooms/invites/{id}/decline', methods: ['POST'])]
    public function decline(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager, TableAssistantEventPublisher $publisher): JsonResponse
    {
        $invite = $this->pendingInvite($entityManager, $id, $user);
        if (!$invite instanceof RoomInvite) {
            return $this->fail('Room invite not found.', 404);
        }

        $invite->decline();
        $entityManager->flush();
        $this->publishTableAssistantInvitationEvent($entityManager, $publisher, $invite->room(), 'invitation.declined', $invite);

        return $this->json(['invite' => $invite->toArray()]);
    }

    private function publishTableAssistantInvitationEvent(
        EntityManagerInterface $entityManager,
        TableAssistantEventPublisher $publisher,
        Room $room,
        string $type,
        RoomInvite $invite,
    ): void {
        $assistantRoom = $entityManager->getRepository(TableAssistantRoom::class)->findOneBy(['room' => $room]);
        if (!$assistantRoom instanceof TableAssistantRoom) {
            return;
        }

        $publisher->publish($assistantRoom, $type, [
            'inviteId' => $invite->id(),
            'status' => $invite->status(),
            'recipientId' => $invite->recipient()->id(),
        ]);
    }

    private function pendingInvite(EntityManagerInterface $entityManager, string $id, User $user): ?RoomInvite
    {
        return $entityManager->getRepository(RoomInvite::class)->findOneBy([
            'id' => $id,
            'recipient' => $user,
            'status' => RoomInvite::STATUS_PENDING,
        ]);
    }

    private function areAcceptedFriends(EntityManagerInterface $entityManager, User $first, User $second): bool
    {
        $count = $entityManager->getRepository(Friendship::class)->createQueryBuilder('friendship')
            ->select('COUNT(friendship.id)')
            ->where('friendship.status = :status')
            ->andWhere('(friendship.requester = :first AND friendship.recipient = :second) OR (friendship.requester = :second AND friendship.recipient = :first)')
            ->setParameter('status', Friendship::STATUS_ACCEPTED)
            ->setParameter('first', $first)
            ->setParameter('second', $second)
            ->getQuery()
            ->getSingleScalarResult();

        return (int) $count > 0;
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
