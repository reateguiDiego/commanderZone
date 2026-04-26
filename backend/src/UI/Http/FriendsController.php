<?php

namespace App\UI\Http;

use App\Domain\Social\Friendship;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class FriendsController extends ApiController
{
    #[Route('/friends', methods: ['GET'])]
    public function list(#[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $friendships = $entityManager->createQueryBuilder()
            ->select('f')
            ->from(Friendship::class, 'f')
            ->where('f.status = :status')
            ->andWhere('f.requester = :user OR f.recipient = :user')
            ->setParameter('status', Friendship::STATUS_ACCEPTED)
            ->setParameter('user', $user)
            ->orderBy('f.updatedAt', 'DESC')
            ->getQuery()
            ->getResult();

        return $this->json(['data' => array_map(static fn (Friendship $friendship): array => $friendship->toArray($user), $friendships)]);
    }

    #[Route('/friends/requests', methods: ['POST'])]
    public function createRequest(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $email = mb_strtolower(trim((string) ($this->payload($request)['email'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return $this->fail('email is required.');
        }

        $recipient = $entityManager->getRepository(User::class)->findOneBy(['email' => $email]);
        if (!$recipient instanceof User) {
            return $this->fail('User not found.', 404);
        }
        if ($recipient->id() === $user->id()) {
            return $this->fail('You cannot send a friend request to yourself.');
        }

        $existing = $this->friendshipBetween($user, $recipient, $entityManager);
        if ($existing instanceof Friendship) {
            if ($existing->status() === Friendship::STATUS_DECLINED) {
                $existing->restart($user, $recipient);
                $entityManager->flush();

                return $this->json(['friendship' => $existing->toArray($user)], 201);
            }

            return $this->fail('A friend request or friendship already exists.', 409);
        }

        $friendship = new Friendship($user, $recipient);
        $entityManager->persist($friendship);
        $entityManager->flush();

        return $this->json(['friendship' => $friendship->toArray($user)], 201);
    }

    #[Route('/friends/requests/incoming', methods: ['GET'])]
    public function incoming(#[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $friendships = $entityManager->getRepository(Friendship::class)->findBy(
            ['recipient' => $user, 'status' => Friendship::STATUS_PENDING],
            ['id' => 'DESC'],
        );

        return $this->json(['data' => array_map(static fn (Friendship $friendship): array => $friendship->toArray($user), $friendships)]);
    }

    #[Route('/friends/requests/outgoing', methods: ['GET'])]
    public function outgoing(#[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $friendships = $entityManager->getRepository(Friendship::class)->findBy(
            ['requester' => $user, 'status' => Friendship::STATUS_PENDING],
            ['id' => 'DESC'],
        );

        return $this->json(['data' => array_map(static fn (Friendship $friendship): array => $friendship->toArray($user), $friendships)]);
    }

    #[Route('/friends/requests/{id}/accept', methods: ['POST'])]
    public function accept(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $friendship = $this->incomingPendingFriendship($id, $user, $entityManager);
        if (!$friendship) {
            return $this->fail('Friend request not found.', 404);
        }

        $friendship->accept();
        $entityManager->flush();

        return $this->json(['friendship' => $friendship->toArray($user)]);
    }

    #[Route('/friends/requests/{id}/decline', methods: ['POST'])]
    public function decline(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $friendship = $this->incomingPendingFriendship($id, $user, $entityManager);
        if (!$friendship) {
            return $this->fail('Friend request not found.', 404);
        }

        $friendship->decline();
        $entityManager->flush();

        return $this->json(['friendship' => $friendship->toArray($user)]);
    }

    #[Route('/friends/{userId}', methods: ['DELETE'])]
    public function delete(string $userId, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $friend = $entityManager->getRepository(User::class)->find($userId);
        if (!$friend instanceof User || $friend->id() === $user->id()) {
            return $this->fail('Friendship not found.', 404);
        }

        $friendship = $this->friendshipBetween($user, $friend, $entityManager);
        if (!$friendship instanceof Friendship || $friendship->status() !== Friendship::STATUS_ACCEPTED) {
            return $this->fail('Friendship not found.', 404);
        }

        $entityManager->remove($friendship);
        $entityManager->flush();

        return $this->json(null, 204);
    }

    private function incomingPendingFriendship(string $id, User $user, EntityManagerInterface $entityManager): ?Friendship
    {
        $friendship = $entityManager->getRepository(Friendship::class)->find($id);
        if (!$friendship instanceof Friendship) {
            return null;
        }
        if (!$friendship->isRecipient($user) || $friendship->status() !== Friendship::STATUS_PENDING) {
            return null;
        }

        return $friendship;
    }

    private function friendshipBetween(User $a, User $b, EntityManagerInterface $entityManager): ?Friendship
    {
        $friendship = $entityManager->getRepository(Friendship::class)->findOneBy([
            'relationKey' => Friendship::relationKeyFor($a, $b),
        ]);

        return $friendship instanceof Friendship ? $friendship : null;
    }
}
