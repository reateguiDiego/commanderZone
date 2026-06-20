<?php

namespace App\Application\Game\Performance;

final class GameplayMetricsInspector
{
    /**
     * @param array<string,mixed> $snapshot
     */
    public function countPlayers(array $snapshot): int
    {
        $players = $snapshot['players'] ?? null;
        if (!is_array($players)) {
            return 0;
        }

        return count(array_filter(array_keys($players), static fn (mixed $playerId): bool => is_string($playerId)));
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    public function countInstances(array $snapshot): int
    {
        $instanceIds = [];

        foreach ($this->cardsFromSnapshot($snapshot) as $card) {
            $instanceId = trim((string) ($card['instanceId'] ?? ''));
            if ($instanceId !== '') {
                $instanceIds[$instanceId] = true;
            }
        }

        return count($instanceIds);
    }

    /**
     * Counts projected cards materialized for a single viewer snapshot.
     *
     * @param array<string,mixed> $snapshot
     */
    public function countVisibleCards(array $snapshot): int
    {
        return count($this->cardsFromSnapshot($snapshot));
    }

    /**
     * @param array<string,mixed> $message
     */
    public function patchBytes(array $message): int
    {
        return $this->jsonBytes($message);
    }

    /**
     * @param array<string,mixed>|list<array<string,mixed>> $messages
     */
    public function patchBytesForMessages(array $messages): int
    {
        if (array_is_list($messages)) {
            $bytes = 0;
            foreach ($messages as $message) {
                if (is_array($message)) {
                    $bytes += $this->jsonBytes($message);
                }
            }

            return $bytes;
        }

        return $this->jsonBytes($messages);
    }

    public function jsonBytes(mixed $value): int
    {
        try {
            return strlen(json_encode($value, JSON_THROW_ON_ERROR));
        } catch (\JsonException) {
            return 0;
        }
    }

    public function memoryPeakBytes(): int
    {
        return memory_get_peak_usage(true);
    }

    /**
     * @return array<string,int>|null
     */
    public function usageSnapshot(): ?array
    {
        $usage = getrusage();
        if (!is_array($usage)) {
            return null;
        }

        return [
            'user_utime.tv_sec' => (int) ($usage['ru_utime.tv_sec'] ?? 0),
            'user_utime.tv_usec' => (int) ($usage['ru_utime.tv_usec'] ?? 0),
            'system_stime.tv_sec' => (int) ($usage['ru_stime.tv_sec'] ?? 0),
            'system_stime.tv_usec' => (int) ($usage['ru_stime.tv_usec'] ?? 0),
        ];
    }

    /**
     * @param array<string,int>|null $startedUsage
     *
     * @return array{cpu_user_ms: float, cpu_system_ms: float}
     */
    public function cpuDiffMs(?array $startedUsage): array
    {
        if ($startedUsage === null) {
            return [
                'cpu_user_ms' => 0.0,
                'cpu_system_ms' => 0.0,
            ];
        }

        $endedUsage = $this->usageSnapshot();
        if ($endedUsage === null) {
            return [
                'cpu_user_ms' => 0.0,
                'cpu_system_ms' => 0.0,
            ];
        }

        return [
            'cpu_user_ms' => $this->elapsedCpuMs(
                $startedUsage['user_utime.tv_sec'] ?? 0,
                $startedUsage['user_utime.tv_usec'] ?? 0,
                $endedUsage['user_utime.tv_sec'] ?? 0,
                $endedUsage['user_utime.tv_usec'] ?? 0,
            ),
            'cpu_system_ms' => $this->elapsedCpuMs(
                $startedUsage['system_stime.tv_sec'] ?? 0,
                $startedUsage['system_stime.tv_usec'] ?? 0,
                $endedUsage['system_stime.tv_sec'] ?? 0,
                $endedUsage['system_stime.tv_usec'] ?? 0,
            ),
        ];
    }

    private function elapsedCpuMs(int $startSeconds, int $startMicroseconds, int $endSeconds, int $endMicroseconds): float
    {
        $start = ($startSeconds * 1_000_000) + $startMicroseconds;
        $end = ($endSeconds * 1_000_000) + $endMicroseconds;

        return round(max(0, ($end - $start) / 1000), 2);
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return list<array<string,mixed>>
     */
    private function cardsFromSnapshot(array $snapshot): array
    {
        $cards = [];
        $players = $snapshot['players'] ?? null;
        if (is_array($players)) {
            foreach ($players as $player) {
                if (!is_array($player) || !is_array($player['zones'] ?? null)) {
                    continue;
                }

                foreach ($player['zones'] as $zoneCards) {
                    if (!is_array($zoneCards)) {
                        continue;
                    }

                    foreach ($zoneCards as $card) {
                        if (is_array($card)) {
                            $cards[] = $card;
                        }
                    }
                }
            }
        }

        foreach ($snapshot['stack'] ?? [] as $item) {
            if (is_array($item) && is_array($item['card'] ?? null)) {
                $cards[] = $item['card'];
            }
        }

        foreach ($snapshot['specialEntities'] ?? [] as $entity) {
            if (is_array($entity) && is_array($entity['card'] ?? null)) {
                $cards[] = $entity['card'];
            }
        }

        return $cards;
    }
}
