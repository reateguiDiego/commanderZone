<?php

namespace App\Application\Game\WebSocket;

use App\Domain\Game\Game;
use App\Domain\User\User;

final readonly class GameWebsocketAccessService
{
    public function canConnect(Game $game, User $user): bool
    {
        return $game->canBeViewedBy($user);
    }
}
