<?php

namespace App\Application\Friendship;

use App\Domain\Room\Room;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;

class FriendPresenceService
{
    public const STATUS_ONLINE = 'online';
    public const STATUS_IN_GAME = 'in_game';
    public const STATUS_OFFLINE = 'offline';

    public function __construct(private readonly EntityManagerInterface $entityManager)
    {
    }

    public function statusFor(User $user): string
    {
        return $this->statusesFor([$user])[$user->id()] ?? self::STATUS_OFFLINE;
    }

    /**
     * @param list<User> $users
     * @return array<string, string>
     */
    public function statusesFor(array $users): array
    {
        if ($users === []) {
            return [];
        }

        $statusesByUserId = [];
        $activeUsers = [];
        $activeSince = new \DateTimeImmutable('-5 minutes');

        foreach ($users as $user) {
            $lastSeenAt = $user->lastSeenAt();
            if ($lastSeenAt === null || $lastSeenAt < $activeSince) {
                $statusesByUserId[$user->id()] = self::STATUS_OFFLINE;
                continue;
            }

            $statusesByUserId[$user->id()] = self::STATUS_ONLINE;
            $activeUsers[] = $user;
        }

        if ($activeUsers === []) {
            return $statusesByUserId;
        }

        $rows = $this->entityManager->getRepository(Room::class)->createQueryBuilder('room')
            ->select('IDENTITY(player.user) AS userId')
            ->innerJoin('room.players', 'player')
            ->where('room.status = :status')
            ->andWhere('player.user IN (:users)')
            ->setParameter('status', Room::STATUS_STARTED)
            ->setParameter('users', $activeUsers)
            ->groupBy('userId')
            ->getQuery()
            ->getArrayResult();

        foreach ($rows as $row) {
            $userId = $row['userId'] ?? null;
            if (is_string($userId) && isset($statusesByUserId[$userId])) {
                $statusesByUserId[$userId] = self::STATUS_IN_GAME;
            }
        }

        return $statusesByUserId;
    }
}
