<?php

namespace App\Application\Game\Runtime;

use Doctrine\DBAL\Connection;

/**
 * Durable outbox for low-frequency runtime lifecycle actions. It intentionally
 * has no FK to game: final disposal is enqueued in the transaction that
 * deletes the aggregate.
 */
final readonly class GameRuntimeStopQueue
{
    public function __construct(private Connection $connection)
    {
    }

    public function enqueueStop(string $gameId): void
    {
        $this->connection->executeStatement(<<<'SQL'
INSERT INTO game_runtime_stop_queue (game_id, action, queued_at, available_at)
VALUES (:gameId, 'stop', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (game_id) DO UPDATE
SET action = 'stop', attempts = 0, available_at = CURRENT_TIMESTAMP
WHERE game_runtime_stop_queue.action <> 'stop'
SQL, ['gameId' => $gameId]);
    }

    public function enqueueHibernate(string $gameId): void
    {
        $this->connection->executeStatement(<<<'SQL'
INSERT INTO game_runtime_stop_queue (game_id, action, queued_at, available_at)
VALUES (:gameId, 'hibernate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (game_id) DO NOTHING
SQL, ['gameId' => $gameId]);
    }
}
