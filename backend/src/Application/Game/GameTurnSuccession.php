<?php

namespace App\Application\Game;

final class GameTurnSuccession
{
    /**
     * @param array<string,mixed> $snapshot
     */
    public static function eligiblePlayerId(array $snapshot, string $requestedPlayerId): string
    {
        $alivePlayerIds = array_values(array_filter(
            self::turnOrder($snapshot),
            static fn (string $playerId): bool => self::playerIsAliveForTurn($snapshot, $playerId),
        ));
		if (self::playerIsAliveForTurn($snapshot, $requestedPlayerId)) {
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
		$snapshot['turn']['number'] = $previousTurnNumber;
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    public static function playerIsAliveForTurn(array $snapshot, string $playerId): bool
    {
        return ($snapshot['players'][$playerId]['status'] ?? 'active') === 'active';
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    public static function playerIsDefeated(array $snapshot, string $playerId): bool
    {
        return ($snapshot['players'][$playerId]['status'] ?? 'active') === 'defeated';
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    private static function nextAlivePlayerId(array $snapshot, string $fromPlayerId): ?string
    {
        $playerIds = self::turnOrder($snapshot);

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
    public static function ensureTurnOrder(array &$snapshot): void
    {
        $snapshot['turnOrder'] = self::turnOrder($snapshot);
    }

    /** @return list<string> */
    public static function turnOrder(array $snapshot): array
    {
        $players = is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [];
        $order = is_array($snapshot['turnOrder'] ?? null) ? $snapshot['turnOrder'] : array_keys($players);
        $seen = [];
        $normalized = [];
        foreach ($order as $playerId) {
            if (is_string($playerId) && isset($players[$playerId]) && !isset($seen[$playerId])) {
                $seen[$playerId] = true;
                $normalized[] = $playerId;
            }
        }
        foreach (array_keys($players) as $playerId) {
            if (!isset($seen[$playerId])) {
                $normalized[] = $playerId;
            }
        }
        return $normalized;
    }
}
