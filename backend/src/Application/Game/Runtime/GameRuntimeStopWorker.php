<?php

namespace App\Application\Game\Runtime;

use Doctrine\DBAL\Connection;

/**
 * Independently drains runtime stops. Row locks are held while the idempotent
 * runtime request is in flight, so parallel workers never stop one game twice.
 */
final readonly class GameRuntimeStopWorker
{
    public function __construct(
        private Connection $connection,
        private GameRuntimeLifecycleControlInterface $runtimeControl,
    ) {
    }

    /** @return array{processed:int,retried:int} */
    public function drain(int $limit = 100): array
    {
        $processed = 0;
        $retried = 0;

        for ($index = 0; $index < max(1, $limit); ++$index) {
            $this->connection->beginTransaction();
            try {
                $gameId = $this->connection->fetchOne(<<<'SQL'
SELECT game_id
FROM game_runtime_stop_queue
WHERE available_at <= CURRENT_TIMESTAMP
ORDER BY available_at ASC, queued_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
SQL);
                if (!is_string($gameId)) {
                    $this->connection->commit();
                    break;
                }

                try {
                    $this->runtimeControl->stopByGameId($gameId);
                    $this->connection->executeStatement(
                        'DELETE FROM game_runtime_stop_queue WHERE game_id = :gameId',
                        ['gameId' => $gameId],
                    );
                    $this->connection->commit();
                    ++$processed;
                } catch (\Throwable) {
                    $this->connection->rollBack();
                    $this->defer($gameId);
                    ++$retried;
                }
            } catch (\Throwable $exception) {
                if ($this->connection->isTransactionActive()) {
                    $this->connection->rollBack();
                }

                throw $exception;
            }
        }

        return ['processed' => $processed, 'retried' => $retried];
    }

    private function defer(string $gameId): void
    {
        // A failing endpoint must not head-of-line block other games. The
        // capped delay makes retries bounded while keeping stop eventual.
        $this->connection->executeStatement(<<<'SQL'
UPDATE game_runtime_stop_queue
SET attempts = attempts + 1,
    available_at = CURRENT_TIMESTAMP + (LEAST(60, POWER(2, attempts + 1)) * INTERVAL '1 second')
WHERE game_id = :gameId
SQL, ['gameId' => $gameId]);
    }
}
