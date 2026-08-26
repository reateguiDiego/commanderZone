<?php

namespace App\Application\Game;

use App\Domain\Game\Game;

/**
 * Compact, durable state that belongs to Symfony's control plane.
 *
 * It is intentionally independent from the Go-owned game_event version. The
 * same projection is used by HTTP acknowledgements, bootstrap and Mercure so
 * clients never need a gameplay snapshot to render lifecycle UI.
 */
final class GameControlPlaneProjection
{
    /**
     * @return array{
     *     controlPlaneRevision:int,
     *     status:string,
     *     winnerPlayerId:?string,
     *     finishedAt:?string,
     *     finishReason:?string,
     *     allDisconnectedSince:?string,
     *     nextLifecycleAt:?string,
     *     ownerId:?string,
     *     rematch:array{votes:array<string,array<string,mixed>>,deadlineAt:?string}
     * }
     */
    public function project(Game $game): array
    {
        return [
            'controlPlaneRevision' => $game->controlPlaneRevision(),
            'status' => $game->status(),
            'winnerPlayerId' => $game->winnerPlayerId(),
            'finishedAt' => $game->finishedAt()?->format(DATE_ATOM),
            'finishReason' => $game->finishReason(),
            'allDisconnectedSince' => $game->allDisconnectedSince()?->format(DATE_ATOM),
            'nextLifecycleAt' => $game->nextLifecycleAt()?->format(DATE_ATOM),
            'ownerId' => $game->room()->owner()->id(),
            'rematch' => $game->rematchState(),
        ];
    }
}
