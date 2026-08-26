<?php

namespace App\Application\Game\Runtime;

use Doctrine\DBAL\Connection;

/**
 * Durable, one-way fence used only by terminal control-plane disposal.
 *
 * Go checks it inside ownership and fenced persistence SQL. It is intentionally
 * not a gameplay version and its claim never writes game_event.
 */
final readonly class GameRuntimeClosingFence
{
    public function __construct(private Connection $connection)
    {
    }

    public function claim(string $gameId): void
    {
        // The update takes the parent row lock. Fenced Go writes select that
        // same row with runtime_closing = false, so they cannot commit after
        // this claim has committed (including the empty-fence race).
        $this->connection->executeStatement(
            'UPDATE game SET runtime_closing = TRUE WHERE id = :gameId AND runtime_closing = FALSE',
            ['gameId' => $gameId],
        );
        $this->connection->executeStatement(
            'INSERT INTO game_runtime_closing (game_id, claimed_at) VALUES (:gameId, CURRENT_TIMESTAMP) ON CONFLICT (game_id) DO NOTHING',
            ['gameId' => $gameId],
        );
    }

    public function isClaimed(string $gameId): bool
    {
        return (bool) $this->connection->fetchOne(
            'SELECT EXISTS (SELECT 1 FROM game_runtime_closing WHERE game_id = :gameId)',
            ['gameId' => $gameId],
        );
    }
}
