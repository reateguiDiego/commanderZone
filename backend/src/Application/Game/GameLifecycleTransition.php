<?php

namespace App\Application\Game;

final class GameLifecycleTransition
{
    /** @param array<string,mixed> $snapshot @param array<string,string> $context */
    public static function eliminate(array &$snapshot, string $targetPlayerId, string $reason, array $context = []): void
    {
        if (!isset($snapshot['players'][$targetPlayerId])) {
            throw new \InvalidArgumentException('Lifecycle target does not exist.');
        }
        if (($snapshot['players'][$targetPlayerId]['status'] ?? 'active') !== 'active') {
            throw new \InvalidArgumentException('Player already eliminated.');
        }
        GameTurnSuccession::ensureTurnOrder($snapshot);
        $previousActive = (string) ($snapshot['turn']['activePlayerId'] ?? '');
        $status = in_array($reason, ['concede', 'expelled'], true) ? 'conceded' : 'defeated';
        $snapshot['players'][$targetPlayerId]['status'] = $status;
        $snapshot['players'][$targetPlayerId]['eliminationReason'] = $reason;
        $snapshot['players'][$targetPlayerId]['eliminatedAtVersion'] = (int) ($snapshot['version'] ?? 0) + 1;
        foreach (['sourcePlayerId', 'commanderInstanceId'] as $field) {
            if (($context[$field] ?? '') !== '') {
                $snapshot['players'][$targetPlayerId][$field] = $context[$field];
            }
        }
        GameTurnSuccession::advanceWhenActivePlayerLeaves($snapshot, $targetPlayerId, $previousActive);
        GameGlobalDesignationSuccession::reassignWhenPlayerLeaves(
            $snapshot, $targetPlayerId, $previousActive, ['monarch', 'initiative'],
            static fn (string $playerId): bool => ($snapshot['players'][$playerId]['status'] ?? '') === 'active',
        );
        $active = array_values(array_filter(
            $snapshot['turnOrder'],
            static fn (string $playerId): bool => ($snapshot['players'][$playerId]['status'] ?? '') === 'active',
        ));
        if (count($active) === 1) {
            $snapshot['winnerPlayerId'] = $active[0];
            $snapshot['resultState'] = 'survivor';
            $snapshot['finishedReason'] = 'last_active';
            $snapshot['turn']['activePlayerId'] = $active[0];
        } elseif ($active === []) {
            $snapshot['winnerPlayerId'] = null;
            $snapshot['resultState'] = 'no_active_players';
            $snapshot['finishedReason'] = 'no_active_players';
            $snapshot['turn']['activePlayerId'] = null;
        } else {
            $snapshot['winnerPlayerId'] = null;
            $snapshot['resultState'] = null;
            $snapshot['finishedReason'] = null;
        }
    }
}
