<?php

namespace App\Application\Game\Lifecycle;

use App\Domain\Game\Game;

final class GameLifecycleProjector
{
    public const APPLIED = 'applied';
    public const DUPLICATE = 'duplicate';
    public const STALE = 'stale';

    private readonly AllDisconnectedGracePolicy $allDisconnectedGrace;

    public function __construct(?AllDisconnectedGracePolicy $allDisconnectedGrace = null)
    {
        $this->allDisconnectedGrace = $allDisconnectedGrace ?? new AllDisconnectedGracePolicy();
    }

    public function apply(Game $game, GameLifecycleHandoff $handoff): string
    {
        if ($handoff->gameId !== $game->id()) {
            throw new \InvalidArgumentException('Lifecycle handoff gameId does not match the game.');
        }

        $cursor = $game->lifecycleCursor();
        if ($cursor['eventId'] === $handoff->eventId) {
            return self::DUPLICATE;
        }
        if ($this->isStale($cursor, $handoff)) {
            return self::STALE;
        }

        if ($handoff->type === GameLifecycleHandoff::PLAYER_CONCEDED) {
            $game->projectConcededPlayer((string) $handoff->playerId, 'conceded', $handoff->occurredAt);
        } elseif ($handoff->type === GameLifecycleHandoff::PLAYER_EXPELLED) {
            $game->projectConcededPlayer((string) $handoff->playerId, 'expelled', $handoff->occurredAt);
        } elseif ($handoff->type === GameLifecycleHandoff::GAME_FINISHED) {
            if ($handoff->playerId !== null && in_array($handoff->playerReason, ['conceded', 'expelled'], true)) {
                $game->projectConcededPlayer($handoff->playerId, (string) $handoff->playerReason, $handoff->occurredAt);
            }
            $game->projectFinished($handoff->winnerPlayerId, $handoff->occurredAt, (string) $handoff->finishReason);
        } elseif ($handoff->type === GameLifecycleHandoff::ALL_PLAYERS_DISCONNECTED) {
            $game->markAllDisconnected($handoff->occurredAt, $this->allDisconnectedGrace->hibernateAt($handoff->occurredAt));
        } elseif ($handoff->type === GameLifecycleHandoff::ALL_DISCONNECTED_CANCELLED) {
            $game->cancelAllDisconnected();
        }

        $game->recordLifecycleCursor(
            $handoff->generation,
            $handoff->fencing,
            $handoff->version,
            $handoff->eventId,
            $handoff->occurredAt,
        );

        return self::APPLIED;
    }

    /**
     * @param array{generation:int,fencing:int,version:int,eventId:?string,occurredAt:?\DateTimeImmutable} $cursor
     */
    private function isStale(array $cursor, GameLifecycleHandoff $handoff): bool
    {
        if ($handoff->generation < $cursor['generation']) {
            return true;
        }
        if ($handoff->generation !== $cursor['generation']) {
            return false;
        }

        // Gameplay version is the durable ordering key. In single-node local
        // runtime mode, an in-memory fencing token starts again after a
        // process restart, so rejecting a higher persisted gameplay version
        // on its lower replacement token would permanently strand a finished
        // game in the active control plane.
        if ($handoff->version !== $cursor['version']) {
            return $handoff->version < $cursor['version'];
        }
        if ($handoff->fencing !== $cursor['fencing']) {
            return $handoff->fencing < $cursor['fencing'];
        }

        return $cursor['occurredAt'] instanceof \DateTimeImmutable && $handoff->occurredAt <= $cursor['occurredAt'];
    }
}
