<?php

namespace App\Application\Game;

final class GameTurnSuccession
{
    private const COMMANDER_DAMAGE_DEFEAT_THRESHOLD = 21;

    /**
     * @param array<string,mixed> $snapshot
     */
    public static function eligiblePlayerId(array $snapshot, string $requestedPlayerId): string
    {
        $players = is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [];
        $alivePlayerIds = array_values(array_filter(
            array_keys($players),
            static fn (string $playerId): bool => self::playerIsAliveForTurn($snapshot, $playerId),
        ));
        if (count($alivePlayerIds) < 2 || self::playerIsAliveForTurn($snapshot, $requestedPlayerId)) {
            return $requestedPlayerId;
        }

        return self::nextAlivePlayerId($snapshot, $requestedPlayerId) ?? $requestedPlayerId;
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    public static function advanceWhenActivePlayerLeaves(array &$snapshot, string $leavingPlayerId, string $previousActivePlayerId): void
    {
        if ($previousActivePlayerId === '' || $previousActivePlayerId !== $leavingPlayerId) {
            return;
        }

        $nextActivePlayerId = self::nextAlivePlayerId($snapshot, $leavingPlayerId);
        if ($nextActivePlayerId === null || $nextActivePlayerId === $leavingPlayerId) {
            return;
        }

        $previousTurnNumber = max(1, (int) ($snapshot['turn']['number'] ?? 1));
        $snapshot['turn']['activePlayerId'] = $nextActivePlayerId;
        $snapshot['turn']['phase'] = 'untap';
        $snapshot['turn']['number'] = self::nextTurnNumberAfterActivePlayerShift(
            $snapshot,
            $previousActivePlayerId,
            $nextActivePlayerId,
            $previousTurnNumber,
        );
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    public static function playerIsAliveForTurn(array $snapshot, string $playerId): bool
    {
        return ($snapshot['players'][$playerId]['status'] ?? 'active') === 'active'
            && !self::playerIsDefeated($snapshot, $playerId);
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    public static function playerIsDefeated(array $snapshot, string $playerId): bool
    {
        return self::playerLife($snapshot, $playerId) <= 0 || self::hasLethalCommanderDamage($snapshot, $playerId);
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    private static function nextAlivePlayerId(array $snapshot, string $fromPlayerId): ?string
    {
        $players = is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [];
        $playerIds = array_keys($players);
        if (count($playerIds) < 2) {
            return null;
        }

        $fromIndex = array_search($fromPlayerId, $playerIds, true);
        $startIndex = $fromIndex === false ? -1 : $fromIndex;
        $playerCount = count($playerIds);
        for ($offset = 1; $offset <= $playerCount; ++$offset) {
            $candidateId = $playerIds[($startIndex + $offset) % $playerCount] ?? null;
            if (is_string($candidateId) && self::playerIsAliveForTurn($snapshot, $candidateId)) {
                return $candidateId;
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    private static function playerLife(array $snapshot, string $playerId): int
    {
        return (int) ($snapshot['players'][$playerId]['life'] ?? 40);
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    private static function hasLethalCommanderDamage(array $snapshot, string $playerId): bool
    {
        $commanderDamage = $snapshot['players'][$playerId]['commanderDamage'] ?? [];
        if (!is_array($commanderDamage)) {
            return false;
        }

        foreach ($commanderDamage as $damage) {
            if ((int) $damage >= self::COMMANDER_DAMAGE_DEFEAT_THRESHOLD) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    private static function nextTurnNumberAfterActivePlayerShift(
        array $snapshot,
        string $previousActivePlayerId,
        string $nextActivePlayerId,
        int $currentTurnNumber,
    ): int {
        $players = is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [];
        $playerIds = array_keys($players);
        $previousIndex = array_search($previousActivePlayerId, $playerIds, true);
        $nextIndex = array_search($nextActivePlayerId, $playerIds, true);
        if (!is_int($previousIndex) || !is_int($nextIndex)) {
            return $currentTurnNumber;
        }

        return $nextIndex <= $previousIndex ? $currentTurnNumber + 1 : $currentTurnNumber;
    }
}
