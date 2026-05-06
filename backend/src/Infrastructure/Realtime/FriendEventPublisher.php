<?php

namespace App\Infrastructure\Realtime;

use App\Application\Friendship\FriendPresenceService;
use App\Domain\Friendship\Friendship;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Mercure\HubInterface;
use Symfony\Component\Mercure\Update;

class FriendEventPublisher
{
    public function __construct(
        private readonly HubInterface $hub,
        private readonly EntityManagerInterface $entityManager,
        private readonly FriendPresenceService $presence,
    ) {
    }

    public function publishPresenceChanged(User $user): void
    {
        $this->publishToAcceptedFriends($user, [
            'type' => 'friend.presence.changed',
            'user' => [
                'id' => $user->id(),
                'displayName' => $user->displayName(),
                'presence' => $this->presence->statusFor($user),
            ],
        ]);
    }

    public function publishListChanged(User ...$users): void
    {
        $publishedIds = [];
        foreach ($users as $user) {
            $userId = $user->id();
            if (isset($publishedIds[$userId])) {
                continue;
            }

            $publishedIds[$userId] = true;
            $this->hub->publish(new Update(
                $this->topic($userId),
                json_encode([
                    'type' => 'friend.list.changed',
                    'userId' => $userId,
                ], JSON_THROW_ON_ERROR),
            ));
        }
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function publishToAcceptedFriends(User $user, array $payload): void
    {
        $friendships = $this->entityManager->getRepository(Friendship::class)->createQueryBuilder('friendship')
            ->where('friendship.status = :status')
            ->andWhere('friendship.requester = :user OR friendship.recipient = :user')
            ->setParameter('status', Friendship::STATUS_ACCEPTED)
            ->setParameter('user', $user)
            ->getQuery()
            ->getResult();

        foreach ($friendships as $friendship) {
            if (!$friendship instanceof Friendship) {
                continue;
            }

            $friend = $friendship->friendFor($user);
            $this->hub->publish(new Update(
                $this->topic($friend->id()),
                json_encode($payload, JSON_THROW_ON_ERROR),
            ));
        }
    }

    private function topic(string $userId): string
    {
        return sprintf('friends/users/%s', $userId);
    }
}
