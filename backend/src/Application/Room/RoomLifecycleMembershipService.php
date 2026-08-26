<?php

namespace App\Application\Room;

use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;

/**
 * Applies control-plane membership consequences of lifecycle facts already
 * decided and persisted by the Go gameplay actor.
 */
final class RoomLifecycleMembershipService
{
    public function removeExpelledPlayer(Game $game, string $playerId): ?User
    {
        $room = $game->room();
        $roomPlayer = $this->playerByUserId($room, $playerId);
        if (!$roomPlayer instanceof RoomPlayer) {
            return null;
        }

        $player = $roomPlayer->user();
        $wasOwner = $room->owner()->id() === $player->id();
        $room->removeUser($player);

        if ($room->players()->count() > 0 && $wasOwner) {
            $room->transferOwnershipToOldestRemainingPlayer();
        }
        if ($room->players()->count() > 0) {
            $room->appendWaitingLog(sprintf('%s left the room.', $this->displayName($player)));
        }

        return $player;
    }

    private function playerByUserId(Room $room, string $playerId): ?RoomPlayer
    {
        foreach ($room->players() as $player) {
            if ($player instanceof RoomPlayer && $player->user()->id() === $playerId) {
                return $player;
            }
        }

        return null;
    }

    private function displayName(User $user): string
    {
        $name = trim($user->displayName());

        return $name !== '' ? $name : 'A player';
    }
}
