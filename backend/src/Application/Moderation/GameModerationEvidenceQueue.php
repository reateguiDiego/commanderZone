<?php

namespace App\Application\Moderation;

use Doctrine\DBAL\Connection;

/**
 * PostgreSQL-backed outbox for game evidence. One game has at most one active
 * capture job, even when several reports reference that game.
 */
final readonly class GameModerationEvidenceQueue implements GameModerationEvidenceQueueInterface
{
    public function __construct(private Connection $connection)
    {
    }

    public function enqueue(string $gameId): void
    {
        $this->connection->executeStatement(<<<'SQL'
INSERT INTO game_moderation_evidence_queue (game_id, queued_at, available_at)
VALUES (:gameId, CURRENT_TIMESTAMP, date_trunc('second', CURRENT_TIMESTAMP))
ON CONFLICT (game_id) DO UPDATE
SET available_at = LEAST(
    game_moderation_evidence_queue.available_at,
    date_trunc('second', CURRENT_TIMESTAMP)
)
SQL, ['gameId' => $gameId]);
    }

    public function cancel(string $gameId): void
    {
        $this->connection->executeStatement(
            'DELETE FROM game_moderation_evidence_queue WHERE game_id = :gameId',
            ['gameId' => $gameId],
        );
    }

    public function hasPendingForGame(string $gameId): bool
    {
        return (bool) $this->connection->fetchOne(
            'SELECT 1 FROM game_moderation_evidence_queue WHERE game_id = :gameId',
            ['gameId' => $gameId],
        );
    }
}
