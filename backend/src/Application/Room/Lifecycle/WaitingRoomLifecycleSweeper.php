<?php

namespace App\Application\Room\Lifecycle;

use App\Domain\Room\Room;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Treats room.waiting_expires_at as a small durable queue. It never scans
 * waiting rooms and never touches Table Assistant rooms.
 */
final readonly class WaitingRoomLifecycleSweeper
{
    private const ONLINE_WINDOW_MINUTES = 5;

    public function __construct(
        private EntityManagerInterface $entityManager,
        private WaitingRoomInactivityPolicy $inactivity,
    ) {
    }

    /** @return list<string> deleted room ids */
    public function sweep(\DateTimeImmutable $now, int $limit = 100): array
    {
        $deletedRoomIds = [];
        for ($index = 0; $index < max(1, $limit); ++$index) {
            $result = $this->sweepNextDueRoom($now);
            if ($result === null) {
                break;
            }
            if ($result !== '') {
                $deletedRoomIds[] = $result;
            }
        }

        return $deletedRoomIds;
    }

    /** Returns an empty string when the room was rescheduled. */
    private function sweepNextDueRoom(\DateTimeImmutable $now): ?string
    {
        $connection = $this->entityManager->getConnection();
        $this->entityManager->beginTransaction();
        try {
            $roomId = $connection->fetchOne(<<<'SQL'
SELECT room.id
FROM room
WHERE room.waiting_expires_at IS NOT NULL
  AND room.waiting_expires_at <= :now
  AND room.status = 'waiting'
  AND room.game_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM table_assistant_room assistant WHERE assistant.room_id = room.id)
ORDER BY room.waiting_expires_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
SQL, ['now' => $now->format('Y-m-d H:i:s')]);
            if (!is_string($roomId)) {
                $this->entityManager->commit();
                return null;
            }

            $room = $this->entityManager->find(Room::class, $roomId, LockMode::PESSIMISTIC_WRITE);
            if (!$room instanceof Room
                || $room->status() !== Room::STATUS_WAITING
                || $room->game() !== null
                || !($room->waitingExpiresAt() instanceof \DateTimeImmutable)
                || $room->waitingExpiresAt() > $now
            ) {
                $this->entityManager->commit();
                return '';
            }

            $latestSeenAt = $connection->fetchOne(<<<'SQL'
SELECT MAX(user_row.last_seen_at)
FROM room_player player
JOIN app_user user_row ON user_row.id = player.user_id
WHERE player.room_id = :roomId
  AND user_row.last_seen_at >= :onlineSince
SQL, [
                'roomId' => $roomId,
                'onlineSince' => $now->modify('-'.self::ONLINE_WINDOW_MINUTES.' minutes')->format('Y-m-d H:i:s'),
            ]);
            if (is_string($latestSeenAt) && $latestSeenAt !== '') {
                $room->scheduleWaitingExpiry($this->inactivity->expiresFrom(new \DateTimeImmutable($latestSeenAt)));
                $this->entityManager->flush();
                $this->entityManager->commit();
                $this->entityManager->clear();
                return '';
            }

            $this->entityManager->remove($room);
            $this->entityManager->flush();
            $this->entityManager->commit();
            $this->entityManager->clear();

            return $roomId;
        } catch (\Throwable $exception) {
            if ($connection->isTransactionActive()) {
                $this->entityManager->rollback();
            }
            throw $exception;
        }
    }
}
