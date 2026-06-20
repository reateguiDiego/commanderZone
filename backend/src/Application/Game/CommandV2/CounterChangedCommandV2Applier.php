<?php

namespace App\Application\Game\CommandV2;

use App\Application\Game\GameCommandHandler;
use App\Domain\User\User;

final class CounterChangedCommandV2Applier implements GameCommandV2ApplierInterface
{
    public function supports(string $type): bool
    {
        return $type === 'counter.changed';
    }

    public function apply(array &$snapshot, array $payload, User $actor, GameCommandHandler $helper): ?GameCommandV2Result
    {
        $scope = trim((string) ($payload['scope'] ?? 'global'));
        $key = trim((string) ($payload['key'] ?? ''));
        if ($key === '') {
            throw new \InvalidArgumentException('Counter key is required.');
        }

        $playerScope = $helper->v2CounterScopePlayerId($payload);
        if ($playerScope !== null) {
            $helper->v2AssertActorOwnPlayer($snapshot, ['playerId' => $playerScope], $actor);
            if (!array_key_exists('value', $payload) && !array_key_exists('delta', $payload)) {
                throw new \InvalidArgumentException('Counter value or delta must be numeric.');
            }
            if (array_key_exists('value', $payload) && !is_numeric($payload['value'])) {
                throw new \InvalidArgumentException('Counter value or delta must be numeric.');
            }
            if (array_key_exists('delta', $payload) && !is_numeric($payload['delta'])) {
                throw new \InvalidArgumentException('Counter value or delta must be numeric.');
            }

            $playerId = $helper->v2RequiredPlayerId($snapshot, ['playerId' => $playerScope]);
            $previousValue = (int) ($snapshot['players'][$playerId]['counters'][$key] ?? 0);
            $value = array_key_exists('value', $payload)
                ? max(0, (int) $payload['value'])
                : max(0, $previousValue + (int) $payload['delta']);
            $snapshot['players'][$playerId]['counters'][$key] = $value;

            return new GameCommandV2Result(
                $helper->v2PlayerCounterLog($helper->v2PlayerName($snapshot, $playerId), $key, $previousValue, $value),
                [
                    'scope' => 'player:'.$playerId,
                    'key' => $key,
                    'value' => $value,
                ],
                [[
                    'op' => 'player.counters.set',
                    'playerId' => $playerId,
                    'counters' => $snapshot['players'][$playerId]['counters'],
                ]],
            );
        }

        $commanderOwnerId = $helper->v2CommanderCounterOwnerId($snapshot, $payload);
        if ($commanderOwnerId !== null) {
            $helper->v2AssertActorOwnPlayer($snapshot, ['playerId' => $commanderOwnerId], $actor, 'playerId', 'You can only change your own commander cast count.');
        }

        if (!array_key_exists('value', $payload) || !is_numeric($payload['value'])) {
            throw new \InvalidArgumentException('Counter value must be numeric.');
        }

        $commander = null;
        if (str_starts_with($scope, 'commander:') && $key === 'casts') {
            [$scope, $commander] = $helper->v2ResolvedCommanderCounterScope($snapshot, $scope);
        }

        $previousValue = (int) ($snapshot['counters'][$scope][$key] ?? 0);
        $value = str_starts_with($scope, 'commander:') && $key === 'casts'
            ? max(0, (int) $payload['value'])
            : (int) $payload['value'];
        $snapshot['counters'][$scope][$key] = $value;

        return new GameCommandV2Result(
            str_starts_with($scope, 'commander:') && $key === 'casts'
                ? $helper->v2CommanderCastCounterLog($previousValue, $value, $commander ? $helper->v2CardLogName($commander) : null)
                : sprintf('Set %s counter %s to %d.', $scope, $key, $value),
            [
                'scope' => $scope,
                'key' => $key,
                'value' => $value,
            ],
            [[
                'op' => 'game.counters.set',
                'scope' => $scope,
                'counters' => $snapshot['counters'][$scope],
            ]],
        );
    }
}
