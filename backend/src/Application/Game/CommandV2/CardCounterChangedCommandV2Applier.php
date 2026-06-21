<?php

namespace App\Application\Game\CommandV2;

use App\Application\Game\GameCommandHandler;
use App\Domain\User\User;

final class CardCounterChangedCommandV2Applier implements GameCommandV2ApplierInterface
{
    public function supports(string $type): bool
    {
        return $type === 'card.counter.changed';
    }

    public function apply(array &$snapshot, array $payload, User $actor, GameCommandHandler $helper): ?GameCommandV2Result
    {
        $helper->v2AssertActorOwnPlayer($snapshot, $payload, $actor);
        $location = $helper->v2RequiredCardLocation($snapshot, $payload);
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        if ($helper->v2IsSensitiveCardForDirectPatch($location['zone'], $card)) {
            return null;
        }

        $key = trim((string) ($payload['key'] ?? '+1/+1'));
        if ($key === '') {
            throw new \InvalidArgumentException('Counter key is required.');
        }

        if (($payload['remove'] ?? false) === true) {
            if (!array_key_exists($key, $card['counters'] ?? [])) {
                return (new PatchEmitterV2())
                    ->emitPublic([
                        'op' => 'card.counters.patch',
                        'playerId' => $location['playerId'],
                        'zone' => $location['zone'],
                        'instanceId' => (string) ($card['instanceId'] ?? ''),
                        'counters' => is_array($card['counters'] ?? null) ? $card['counters'] : [],
                    ])
                    ->toResult('', [
                        'playerId' => $location['playerId'],
                        'zone' => $location['zone'],
                        'instanceId' => (string) ($card['instanceId'] ?? ''),
                        'key' => $key,
                        'counters' => is_array($card['counters'] ?? null) ? $card['counters'] : [],
                    ]);
            }

            $previousValue = (int) ($card['counters'][$key] ?? 0);
            if ($helper->v2IsTheRingLevelCounter($card, $key)) {
                $card['counters'][$key] = 1;
                $message = sprintf('Set %s %s counters to 1.', $helper->v2CardLogName($card), $key);
            } else {
                unset($card['counters'][$key]);
                $helper->v2ApplyStatCounterDelta($card, $key, -$previousValue);
                $message = sprintf('Removed %s counter from %s.', $key, $helper->v2CardLogName($card));
            }
        } else {
            if (!array_key_exists($key, $card['counters'] ?? []) && count($card['counters'] ?? []) >= 5) {
                throw new \InvalidArgumentException('Maximum 5 different counters per card.');
            }

            $value = array_key_exists('value', $payload)
                ? (int) $payload['value']
                : (int) ($card['counters'][$key] ?? 0) + (int) ($payload['delta'] ?? 0);
            $previousValue = (int) ($card['counters'][$key] ?? 0);
            $nextValue = $helper->v2IsTheRingLevelCounter($card, $key)
                ? max(1, min(4, $value))
                : max(0, $value);
            $card['counters'][$key] = $nextValue;
            $helper->v2ApplyStatCounterDelta($card, $key, $nextValue - $previousValue);
            $message = sprintf('Set %s %s counters to %d.', $helper->v2CardLogName($card), $key, $nextValue);
        }

        $emitter = (new PatchEmitterV2())->emitPublic([
            'op' => 'card.counters.patch',
            'playerId' => $location['playerId'],
            'zone' => $location['zone'],
            'instanceId' => (string) ($card['instanceId'] ?? ''),
            'counters' => is_array($card['counters'] ?? null) ? $card['counters'] : [],
        ]);
        $statsOperation = $helper->v2CardStatsOperation($location, $card);
        if ($statsOperation !== null) {
            $emitter->emitPublic($statsOperation);
        }

        return $emitter->toResult(
            $message,
            [
                'playerId' => $location['playerId'],
                'zone' => $location['zone'],
                'instanceId' => (string) ($card['instanceId'] ?? ''),
                'key' => $key,
                'counters' => is_array($card['counters'] ?? null) ? $card['counters'] : [],
            ],
        );
    }
}
