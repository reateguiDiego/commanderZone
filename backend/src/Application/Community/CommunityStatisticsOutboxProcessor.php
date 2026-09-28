<?php

namespace App\Application\Community;

use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;

/**
 * Drains durable game-start statistic events outside the request path.
 *
 * A transaction-scoped advisory lock maximizes coalescing into one counter
 * upsert while SKIP LOCKED still makes a second worker harmless.
 */
final readonly class CommunityStatisticsOutboxProcessor
{
    private const ADVISORY_LOCK_KEY = 930071;

    public function __construct(
        private Connection $connection,
        private CommunityStatisticsService $statistics,
    ) {
    }

    public function drain(int $limit = 100): int
    {
        $this->connection->beginTransaction();
        try {
            $hasLock = (int) $this->connection->fetchOne(
                'SELECT CASE WHEN pg_try_advisory_xact_lock('.self::ADVISORY_LOCK_KEY.') THEN 1 ELSE 0 END',
            ) === 1;
            if (!$hasLock) {
                $this->connection->commit();

                return 0;
            }

            $rows = $this->connection->executeQuery(<<<'SQL'
SELECT id, payload_json
FROM community_statistics_outbox
ORDER BY id ASC
LIMIT :limit
FOR UPDATE SKIP LOCKED
SQL, ['limit' => max(1, $limit)], ['limit' => \Doctrine\DBAL\ParameterType::INTEGER])->fetchAllAssociative();
            if ($rows === []) {
                $this->connection->commit();

                return 0;
            }

            $ids = [];
            $payloads = [];
            foreach ($rows as $row) {
                $id = $row['id'] ?? null;
                $payload = $row['payload_json'] ?? null;
                if (!is_numeric($id) || !is_string($payload)) {
                    throw new \UnexpectedValueException('Invalid community statistics outbox row.');
                }
                $ids[] = (int) $id;
                $payloads[] = $payload;
            }

            $this->statistics->applyDeltas($this->statistics->deltasFromOutboxPayloads($payloads));
            $this->connection->executeStatement(
                'DELETE FROM community_statistics_outbox WHERE id IN (:ids)',
                ['ids' => $ids],
                ['ids' => ArrayParameterType::INTEGER],
            );
            $this->connection->commit();
        } catch (\Throwable $exception) {
            if ($this->connection->isTransactionActive()) {
                $this->connection->rollBack();
            }

            throw $exception;
        }

        $this->statistics->invalidateLeaderboards();

        return count($rows);
    }
}
