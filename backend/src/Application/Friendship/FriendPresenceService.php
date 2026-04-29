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
        $lastSeenAt = $user->lastSeenAt();
        if ($lastSeenAt === null || $lastSeenAt < new \DateTimeImmutable('-5 minutes')) {
            return self::STATUS_OFFLINE;
        }

        if ($this->isInStartedRoom($user)) {
            return self::STATUS_IN_GAME;
        }

        return self::STATUS_ONLINE;
    }

    private function isInStartedRoom(User $user): bool
    {
        $count = $this->entityManager->getRepository(Room::class)->createQueryBuilder('room')
            ->select('COUNT(room.id)')
            ->innerJoin('room.players', 'player')
            ->where('room.status = :status')
            ->andWhere('player.user = :user')
            ->setParameter('status', Room::STATUS_STARTED)
            ->setParameter('user', $user)
            ->getQuery()
            ->getSingleScalarResult();

        return (int) $count > 0;
    }
}
