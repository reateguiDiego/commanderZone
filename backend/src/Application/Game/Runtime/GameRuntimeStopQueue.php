<?php

namespace App\Application\Game\Runtime;

use Doctrine\DBAL\Connection;

/**
 * Durable outbox for runtime disposal. It intentionally has no FK to game:
 * the lifecycle transaction deletes the game before the asynchronous stop.
 */
final readonly class GameRuntimeStopQueue
{
    public function __construct(private Connection $connection)
    {
    }

    public function enqueue(string $gameId): void
    {
        $this->connection->executeStatement(<<<'SQL'
INSERT INTO game_runtime_stop_queue (game_id, queued_at, available_at)
VALUES (:gameId, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (game_id) DO NOTHING
SQL, ['gameId' => $gameId]);
    }
}
