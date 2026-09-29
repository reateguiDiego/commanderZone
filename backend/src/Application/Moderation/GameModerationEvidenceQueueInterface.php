<?php

namespace App\Application\Moderation;

/**
 * Durable trigger for terminal game-evidence capture. It deliberately stores
 * only the game id: the worker must still be able to delete the source Game
 * after evidence has become immutable.
 */
interface GameModerationEvidenceQueueInterface
{
    public function enqueue(string $gameId): void;

    public function cancel(string $gameId): void;

    public function hasPendingForGame(string $gameId): bool;
}
