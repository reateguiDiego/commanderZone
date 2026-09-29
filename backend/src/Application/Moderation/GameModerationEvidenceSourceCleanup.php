<?php

namespace App\Application\Moderation;

use App\Application\Game\Runtime\GameRuntimeClosingFence;
use App\Application\Game\Runtime\GameRuntimeStopQueue;
use App\Domain\Game\Game;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Finalizes an archived source only after its evidence transaction committed.
 * The snapshots deliberately keep no foreign key to Game, so this can perform
 * the same irreversible cleanup as normal terminal lifecycle disposal.
 */
final readonly class GameModerationEvidenceSourceCleanup
{
    public function __construct(
        private GameRuntimeClosingFence $closingFence,
        private GameRuntimeStopQueue $runtimeStopQueue,
    ) {
    }

    public function dispose(Game $game, EntityManagerInterface $entityManager): void
    {
        $gameId = $game->id();
        $room = $game->room();
        $connection = $entityManager->getConnection();

        // Claiming again is idempotent and protects against a stale runtime
        // actor even if a legacy terminal path did not claim it before archive.
        $this->closingFence->claim($gameId);
        $this->runtimeStopQueue->enqueueStop($gameId);
        $connection->executeStatement('DELETE FROM game_snapshot_compact WHERE game_id = :gameId', ['gameId' => $gameId]);
        $connection->executeStatement('DELETE FROM game_runtime_lifecycle_outbox WHERE game_id = :gameId', ['gameId' => $gameId]);

        // Room owns the nullable one-to-one FK. Persisting the detach first
        // preserves the ordering required by PostgreSQL's foreign key.
        if ($room->game()?->id() === $gameId) {
            $room->detachGame();
            $entityManager->flush();
        }

        $entityManager->remove($game);
        $entityManager->remove($room);
    }
}
