<?php

declare(strict_types=1);

namespace App\Application\Moderation;

use Doctrine\DBAL\Connection;

/** Durable, per-report queue for asynchronous profile snapshots. */
class ProfileModerationEvidenceQueue
{
    public function __construct(private readonly Connection $connection)
    {
    }

    public function enqueue(string $reportId): void
    {
        $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO report_profile_evidence_queue (report_id, queued_at, available_at, attempts)
VALUES (:reportId, CURRENT_TIMESTAMP, date_trunc('second', CURRENT_TIMESTAMP), 0)
ON CONFLICT (report_id) DO NOTHING
SQL,
            ['reportId' => $reportId],
        );
    }

    public function remove(string $reportId): void
    {
        $this->connection->executeStatement(
            'DELETE FROM report_profile_evidence_queue WHERE report_id = :reportId',
            ['reportId' => $reportId],
        );
    }

    public function hasPendingForUser(string $userId): bool
    {
        return (bool) $this->connection->fetchOne(
            <<<'SQL'
SELECT EXISTS(
    SELECT 1
    FROM report_profile_evidence_queue queue
    INNER JOIN user_report report ON report.id = queue.report_id
    WHERE report.reporter_id = :userId OR report.reported_user_id = :userId
)
SQL,
            ['userId' => $userId],
        );
    }

    /**
     * Claims one row inside the caller's current transaction.
     *
     * @return string|null report ID
     */
    public function claimOne(): ?string
    {
        $value = $this->connection->fetchOne(
            <<<'SQL'
SELECT report_id
FROM report_profile_evidence_queue
WHERE available_at <= CURRENT_TIMESTAMP
ORDER BY queued_at ASC
FOR UPDATE SKIP LOCKED
LIMIT 1
SQL,
        );

        return is_string($value) ? $value : null;
    }

    public function scheduleRetry(string $reportId): void
    {
        $this->connection->executeStatement(
            <<<'SQL'
UPDATE report_profile_evidence_queue
SET attempts = attempts + 1,
    available_at = CURRENT_TIMESTAMP + (LEAST(60, POWER(2, attempts + 1)::int) * INTERVAL '1 second')
WHERE report_id = :reportId
SQL,
            ['reportId' => $reportId],
        );
    }
}
