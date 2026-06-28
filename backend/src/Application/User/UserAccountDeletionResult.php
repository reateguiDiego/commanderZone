<?php

namespace App\Application\User;

use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;

final class UserAccountDeletionResult
{
    /**
     * @param list<array{game: Game, event: GameEvent}> $gameEvents
     * @param list<Room> $changedRooms
     * @param list<string> $deletedRoomIds
     */
    public function __construct(
        public readonly array $gameEvents,
        public readonly array $changedRooms,
        public readonly array $deletedRoomIds,
    ) {
    }
}
