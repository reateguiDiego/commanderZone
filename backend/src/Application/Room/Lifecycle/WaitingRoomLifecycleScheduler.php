<?php

namespace App\Application\Room\Lifecycle;

use App\Domain\Room\Room;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Keeps the policy scoped to normal game waiting rooms. Table Assistant
 * deliberately shares Room but never receives a durable expiry.
 */
final readonly class WaitingRoomLifecycleScheduler
{
    public function __construct(
        private EntityManagerInterface $entityManager,
        private WaitingRoomInactivityPolicy $inactivity,
    ) {
    }

    public function renew(Room $room): void
    {
        if ($room->status() !== Room::STATUS_WAITING || $room->game() !== null) {
            return;
        }
        $isAssistantRoom = $this->entityManager->getConnection()->fetchOne(
            'SELECT 1 FROM table_assistant_room WHERE room_id = :roomId',
            ['roomId' => $room->id()],
        );
        if ($isAssistantRoom !== false) {
            return;
        }

        $room->scheduleWaitingExpiry($this->inactivity->expiresFromNow());
    }
}
