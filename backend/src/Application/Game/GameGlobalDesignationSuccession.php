<?php

namespace App\Application\Game;

final class GameGlobalDesignationSuccession
{
    /**
     * @param list<string> $templates
     * @param callable(string): bool $isEligiblePlayer
     */
    public static function reassignWhenPlayerLeaves(
        array &$snapshot,
        string $leavingPlayerId,
        string $previousActivePlayerId,
        array $templates,
        callable $isEligiblePlayer,
    ): void {
        $specialEntities = $snapshot['specialEntities'] ?? null;
        if (!is_array($specialEntities)) {
            return;
        }

        foreach ($templates as $template) {
            self::reassignTemplateWhenPlayerLeaves(
                $snapshot,
                $leavingPlayerId,
                $previousActivePlayerId,
                $template,
                $isEligiblePlayer,
            );
        }
    }

    /**
     * @param callable(string): bool $isEligiblePlayer
     */
    private static function reassignTemplateWhenPlayerLeaves(
        array &$snapshot,
        string $leavingPlayerId,
        string $previousActivePlayerId,
        string $template,
        callable $isEligiblePlayer,
    ): void {
        foreach (($snapshot['specialEntities'] ?? []) as $index => $entity) {
            if (!is_array($entity) || ($entity['template'] ?? null) !== $template) {
                continue;
            }

            $ownerPlayerId = is_scalar($entity['ownerPlayerId'] ?? null) ? trim((string) $entity['ownerPlayerId']) : '';
            if ($ownerPlayerId !== $leavingPlayerId) {
                return;
            }

            $successorPlayerId = self::successorPlayerId($snapshot, $leavingPlayerId, $previousActivePlayerId, $isEligiblePlayer);
            if ($successorPlayerId === null) {
                array_splice($snapshot['specialEntities'], $index, 1);
                return;
            }

            $snapshot['specialEntities'][$index]['ownerPlayerId'] = $successorPlayerId;
            return;
        }
    }

    /**
     * @param callable(string): bool $isEligiblePlayer
     */
    private static function successorPlayerId(
        array $snapshot,
        string $leavingPlayerId,
        string $previousActivePlayerId,
        callable $isEligiblePlayer,
    ): ?string {
        $currentActivePlayerId = is_scalar($snapshot['turn']['activePlayerId'] ?? null)
            ? trim((string) $snapshot['turn']['activePlayerId'])
            : '';
        if ($currentActivePlayerId !== '' && $currentActivePlayerId !== $leavingPlayerId && $isEligiblePlayer($currentActivePlayerId)) {
            return $currentActivePlayerId;
        }

        if ($previousActivePlayerId !== '' && $previousActivePlayerId !== $leavingPlayerId && $isEligiblePlayer($previousActivePlayerId)) {
            return $previousActivePlayerId;
        }

        $playerIds = array_keys(is_array($snapshot['players'] ?? null) ? $snapshot['players'] : []);
        $leavingIndex = array_search($leavingPlayerId, $playerIds, true);
        $startIndex = $leavingIndex === false ? -1 : $leavingIndex;
        $playerCount = count($playerIds);

        for ($offset = 1; $offset <= $playerCount; ++$offset) {
            $candidateId = $playerIds[($startIndex + $offset) % $playerCount] ?? null;
            if (is_string($candidateId) && $candidateId !== $leavingPlayerId && $isEligiblePlayer($candidateId)) {
                return $candidateId;
            }
        }

        return null;
    }
}
