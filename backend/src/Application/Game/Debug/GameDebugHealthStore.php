<?php

namespace App\Application\Game\Debug;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Exception\TableNotFoundException;
use Doctrine\DBAL\ParameterType;
use Doctrine\Persistence\ManagerRegistry;

final class GameDebugHealthStore
{
    private ?bool $storageAvailable = null;

    public function __construct(
        private readonly ManagerRegistry $registry,
        private readonly GameDebugHealthAggregator $aggregator,
    ) {
    }

    /**
     * @return array<string,mixed>
     */
    public function stateForGame(string $gameId): array
    {
        return $this->reportForGame($gameId)['health'];
    }

    /**
     * @return array{health: array<string,mixed>, updatedAt: ?string}
     */
    public function reportForGame(string $gameId): array
    {
        if (!$this->isStorageAvailable()) {
            return [
                'health' => $this->aggregator->normalize([]),
                'updatedAt' => null,
            ];
        }

        $connection = $this->connection();
        try {
            $row = $connection->fetchAssociative('SELECT payload, updated_at FROM game_debug_health WHERE game_id = :gameId', [
                'gameId' => $gameId,
            ]);
        } catch (TableNotFoundException) {
            $this->storageAvailable = false;

            return [
                'health' => $this->aggregator->normalize([]),
                'updatedAt' => null,
            ];
        }

        if (!is_array($row)) {
            return [
                'health' => $this->aggregator->normalize([]),
                'updatedAt' => null,
            ];
        }

        $raw = $row['payload'] ?? null;
        if (!is_string($raw) || trim($raw) === '') {
            return [
                'health' => $this->aggregator->normalize([]),
                'updatedAt' => $this->updatedAtToAtom($row['updated_at'] ?? null),
            ];
        }

        try {
            $decoded = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [
                'health' => $this->aggregator->normalize([]),
                'updatedAt' => $this->updatedAtToAtom($row['updated_at'] ?? null),
            ];
        }

        return [
            'health' => $this->aggregator->normalize(is_array($decoded) ? $decoded : []),
            'updatedAt' => $this->updatedAtToAtom($row['updated_at'] ?? null),
        ];
    }

    public function recordConnectionSnapshot(string $gameId, string $userId, string $displayName, string $status, int $totalConnections, int $userConnections, ?string $changedAt = null): void
    {
        $this->mutate($gameId, fn (array $state): array => $this->aggregator->recordConnectionSnapshot(
            $state,
            $userId,
            $displayName,
            $status,
            $totalConnections,
            $userConnections,
            $changedAt,
        ));
    }

    /**
     * @param array<string,mixed> $message
     */
    public function recordOutboundMessage(string $gameId, array $message, ?string $channel = null): void
    {
        $this->mutate($gameId, fn (array $state): array => $this->aggregator->recordOutboundMessage($state, $message, $channel));
    }

    /**
     * @param array<string,mixed>|null $meta
     */
    public function recordIncomingValidationError(string $gameId, string $code, string $message, ?array $meta = null): void
    {
        $this->mutate($gameId, fn (array $state): array => $this->aggregator->recordIncomingValidationError($state, $code, $message, $meta));
    }

    public function recordReplayResult(string $gameId, string $userId, int $lastSeenVersion, int $currentVersion, ?int $replayedCount, string $result): void
    {
        $this->mutate($gameId, fn (array $state): array => $this->aggregator->recordReplayResult(
            $state,
            $userId,
            $lastSeenVersion,
            $currentVersion,
            $replayedCount,
            $result,
        ));
    }

    /**
     * @param \Closure(array<string,mixed>):array<string,mixed> $mutator
     */
    private function mutate(string $gameId, \Closure $mutator): void
    {
        if (!$this->isStorageAvailable()) {
            return;
        }

        $connection = $this->connection();
        $startedTransaction = false;

        try {
            if (!$connection->isTransactionActive()) {
                $connection->beginTransaction();
                $startedTransaction = true;
            }

            $currentState = $this->stateForGameForUpdate($connection, $gameId);
            $nextState = $mutator($currentState);
            $payload = json_encode($this->aggregator->normalize($nextState), JSON_THROW_ON_ERROR);
            $now = (new \DateTimeImmutable())->format('Y-m-d H:i:s');

            $connection->executeStatement(
                "INSERT INTO game_debug_health (game_id, payload, created_at, updated_at)
                 VALUES (:gameId, CAST(:payload AS JSON), :createdAt, :updatedAt)
                 ON CONFLICT (game_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at",
                [
                    'gameId' => $gameId,
                    'payload' => $payload,
                    'createdAt' => $now,
                    'updatedAt' => $now,
                ],
                [
                    'gameId' => ParameterType::STRING,
                    'payload' => ParameterType::STRING,
                    'createdAt' => ParameterType::STRING,
                    'updatedAt' => ParameterType::STRING,
                ],
            );

            if ($startedTransaction) {
                $connection->commit();
            }
        } catch (\Throwable $exception) {
            if ($startedTransaction && $connection->isTransactionActive()) {
                $connection->rollBack();
            }

            if ($exception instanceof TableNotFoundException) {
                $this->storageAvailable = false;

                return;
            }

            throw $exception;
        }
    }

    /**
     * @return array<string,mixed>
     */
    private function stateForGameForUpdate(Connection $connection, string $gameId): array
    {
        $raw = $connection->fetchOne(
            'SELECT payload FROM game_debug_health WHERE game_id = :gameId FOR UPDATE',
            ['gameId' => $gameId],
            ['gameId' => ParameterType::STRING],
        );

        if (!is_string($raw) || trim($raw) === '') {
            return $this->aggregator->normalize([]);
        }

        try {
            $decoded = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return $this->aggregator->normalize([]);
        }

        return $this->aggregator->normalize(is_array($decoded) ? $decoded : []);
    }

    private function connection(): Connection
    {
        return $this->registry->getConnection();
    }

    private function isStorageAvailable(): bool
    {
        if (is_bool($this->storageAvailable)) {
            return $this->storageAvailable;
        }

        $this->storageAvailable = $this->connection()->createSchemaManager()->tablesExist(['game_debug_health']);

        return $this->storageAvailable;
    }

    private function updatedAtToAtom(mixed $value): ?string
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format(DATE_ATOM);
        }

        if (is_string($value) && trim($value) !== '') {
            try {
                return (new \DateTimeImmutable($value))->format(DATE_ATOM);
            } catch (\Throwable) {
                return null;
            }
        }

        return null;
    }
}
