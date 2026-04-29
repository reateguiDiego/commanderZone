<?php

namespace App\UI\Http;

use App\Application\Friendship\FriendPresenceService;
use App\Domain\Friendship\Friendship;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class FriendsController extends ApiController
{
    #[Route('/friends/search', methods: ['GET'])]
    public function search(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $query = trim((string) $request->query->get('q', ''));
        if (mb_strlen($query) < 2) {
            return $this->json(['data' => []]);
        }

        $users = $entityManager->getRepository(User::class)->createQueryBuilder('user')
            ->where('LOWER(user.email) LIKE :query OR LOWER(user.displayName) LIKE :query')
            ->andWhere('user != :viewer')
            ->setParameter('query', '%'.mb_strtolower($query).'%')
            ->setParameter('viewer', $user)
            ->orderBy('user.displayName', 'ASC')
            ->setMaxResults(8)
            ->getQuery()
            ->getResult();

        return $this->json(['data' => array_map(fn (User $match) => [
            'id' => $match->id(),
            'email' => $match->email(),
            'displayName' => $match->displayName(),
            'friendshipStatus' => $this->friendshipStatusBetween($entityManager, $user, $match),
        ], $users)]);
    }

    #[Route('/friends', methods: ['GET'])]
    public function list(#[CurrentUser] User $user, EntityManagerInterface $entityManager, FriendPresenceService $presence): JsonResponse
    {
        $friendships = $entityManager->getRepository(Friendship::class)->createQueryBuilder('friendship')
            ->where('friendship.status = :status')
            ->andWhere('friendship.requester = :user OR friendship.recipient = :user')
            ->setParameter('status', Friendship::STATUS_ACCEPTED)
            ->setParameter('user', $user)
            ->orderBy('friendship.updatedAt', 'DESC')
            ->getQuery()
            ->getResult();

        return $this->json([
            'data' => array_map(
                static fn (Friendship $friendship) => $friendship->toArray($user, $presence->statusFor($friendship->friendFor($user))),
                $friendships,
            ),
        ]);
    }

    #[Route('/friends/requests', methods: ['POST'])]
    public function request(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $payload = $this->payload($request);
        $email = mb_strtolower(trim((string) ($payload['email'] ?? '')));
        $userId = trim((string) ($payload['userId'] ?? ''));

        if ($email === '' && $userId === '') {
            return $this->fail('email or userId is required.');
        }

        $recipient = $userId !== ''
            ? $entityManager->getRepository(User::class)->find($userId)
            : $entityManager->getRepository(User::class)->findOneBy(['email' => $email]);

        if (!$recipient instanceof User) {
            return $this->fail('User not found.', 404);
        }

        if ($recipient->id() === $user->id()) {
            return $this->fail('You cannot send a friend request to yourself.');
        }

        $friendship = $this->findBetween($entityManager, $user, $recipient);
        if ($friendship instanceof Friendship && in_array($friendship->status(), [Friendship::STATUS_PENDING, Friendship::STATUS_ACCEPTED, Friendship::STATUS_BLOCKED], true)) {
            return $this->fail('Friendship already exists.', 409);
        }

        if ($friendship instanceof Friendship) {
            $friendship->resendFrom($user, $recipient);
        } else {
            $friendship = new Friendship($user, $recipient);
            $entityManager->persist($friendship);
        }

        $entityManager->flush();

        return $this->json(['friendship' => $friendship->toArray($user)], 201);
    }

    #[Route('/friends/requests/{id}', methods: ['DELETE'])]
    public function cancel(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $friendship = $entityManager->getRepository(Friendship::class)->findOneBy([
            'id' => $id,
            'requester' => $user,
            'status' => Friendship::STATUS_PENDING,
        ]);

        if (!$friendship instanceof Friendship) {
            return $this->fail('Friend request not found.', 404);
        }

        $entityManager->remove($friendship);
        $entityManager->flush();

        return $this->json(null, 204);
    }

    #[Route('/friends/requests/incoming', methods: ['GET'])]
    public function incoming(#[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        return $this->json(['data' => array_map(
            static fn (Friendship $friendship) => $friendship->toArray($user),
            $this->pendingFor($entityManager, 'recipient', $user),
        )]);
    }

    #[Route('/friends/requests/outgoing', methods: ['GET'])]
    public function outgoing(#[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        return $this->json(['data' => array_map(
            static fn (Friendship $friendship) => $friendship->toArray($user),
            $this->pendingFor($entityManager, 'requester', $user),
        )]);
    }

    #[Route('/friends/requests/{id}/accept', methods: ['POST'])]
    public function accept(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager, FriendPresenceService $presence): JsonResponse
    {
        $friendship = $this->pendingIncoming($entityManager, $id, $user);
        if (!$friendship instanceof Friendship) {
            return $this->fail('Friend request not found.', 404);
        }

        $friendship->accept();
        $entityManager->flush();

        return $this->json(['friendship' => $friendship->toArray($user, $presence->statusFor($friendship->friendFor($user)))]);
    }

    #[Route('/friends/requests/{id}/decline', methods: ['POST'])]
    public function decline(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $friendship = $this->pendingIncoming($entityManager, $id, $user);
        if (!$friendship instanceof Friendship) {
            return $this->fail('Friend request not found.', 404);
        }

        $entityManager->remove($friendship);
        $entityManager->flush();

        return $this->json(null, 204);
    }

    #[Route('/friends/{userId}', methods: ['DELETE'])]
    public function remove(string $userId, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $friend = $entityManager->getRepository(User::class)->find($userId);
        if (!$friend instanceof User) {
            return $this->fail('User not found.', 404);
        }

        $friendship = $this->findBetween($entityManager, $user, $friend);
        if (!$friendship instanceof Friendship || $friendship->status() !== Friendship::STATUS_ACCEPTED) {
            return $this->fail('Friendship not found.', 404);
        }

        $entityManager->remove($friendship);
        $entityManager->flush();

        return $this->json(null, 204);
    }

    private function findBetween(EntityManagerInterface $entityManager, User $first, User $second): ?Friendship
    {
        return $entityManager->getRepository(Friendship::class)->createQueryBuilder('friendship')
            ->where('(friendship.requester = :first AND friendship.recipient = :second)')
            ->orWhere('(friendship.requester = :second AND friendship.recipient = :first)')
            ->setParameter('first', $first)
            ->setParameter('second', $second)
            ->getQuery()
            ->getOneOrNullResult();
    }

    /**
     * @return Friendship[]
     */
    private function pendingFor(EntityManagerInterface $entityManager, string $side, User $user): array
    {
        return $entityManager->getRepository(Friendship::class)->createQueryBuilder('friendship')
            ->where("friendship.$side = :user")
            ->andWhere('friendship.status = :status')
            ->setParameter('user', $user)
            ->setParameter('status', Friendship::STATUS_PENDING)
            ->orderBy('friendship.createdAt', 'DESC')
            ->getQuery()
            ->getResult();
    }

    private function pendingIncoming(EntityManagerInterface $entityManager, string $id, User $user): ?Friendship
    {
        return $entityManager->getRepository(Friendship::class)->findOneBy([
            'id' => $id,
            'recipient' => $user,
            'status' => Friendship::STATUS_PENDING,
        ]);
    }

    private function friendshipStatusBetween(EntityManagerInterface $entityManager, User $first, User $second): ?string
    {
        return $this->findBetween($entityManager, $first, $second)?->status();
    }
}
