<?php

namespace App\Application\Room;

use App\Domain\Room\Room;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;

final class ActiveRoomMembershipService
{
    public function __construct(private readonly EntityManagerInterface $entityManager)
    {
    }

    public function currentRoomFor(User $user): ?Room
    {
        $rooms = $this->activeRoomsForUser($user);

        return $rooms[0] ?? null;
    }

    public function otherRoomFor(User $user, Room $targetRoom): ?Room
    {
        foreach ($this->activeRoomsForUser($user) as $room) {
            if ($room->id() !== $targetRoom->id()) {
                return $room;
            }
        }

        return null;
    }

    /**
     * @return list<Room>
     */
    public function activeRoomsForUser(User $user): array
    {
        return $this->entityManager->getRepository(Room::class)->createQueryBuilder('room')
            ->leftJoin('room.players', 'player')
            ->addSelect('player')
            ->where('room.status != :archived')
            ->andWhere('room.players IS NOT EMPTY')
            ->andWhere('player.user = :user')
            ->orderBy('room.createdAt', 'DESC')
            ->setParameter('archived', Room::STATUS_ARCHIVED)
            ->setParameter('user', $user)
            ->getQuery()
            ->getResult();
    }
}
