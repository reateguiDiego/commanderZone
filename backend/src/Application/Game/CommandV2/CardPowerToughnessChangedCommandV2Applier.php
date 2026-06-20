<?php

namespace App\Application\Game\CommandV2;

use App\Application\Game\GameCommandHandler;
use App\Domain\User\User;

final class CardPowerToughnessChangedCommandV2Applier implements GameCommandV2ApplierInterface
{
    public function supports(string $type): bool
    {
        return $type === 'card.power_toughness.changed';
    }

    public function apply(array &$snapshot, array $payload, User $actor, GameCommandHandler $helper): ?GameCommandV2Result
    {
        $helper->v2AssertActorOwnPlayer($snapshot, $payload, $actor);
        $location = $helper->v2RequiredCardLocation($snapshot, $payload);
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        if ($helper->v2IsSensitiveCardForDirectPatch($location['zone'], $card)) {
            return null;
        }

        $previousPower = $card['power'] ?? null;
        $previousToughness = $card['toughness'] ?? null;
        $previousLoyalty = $card['loyalty'] ?? null;
        $previousDefense = $card['defense'] ?? null;
        $previousSaga = $card['saga'] ?? null;
        if (array_key_exists('power', $payload)) {
            $card['power'] = $payload['power'] === null ? null : (int) $payload['power'];
        }
        if (array_key_exists('toughness', $payload)) {
            $card['toughness'] = $payload['toughness'] === null ? null : (int) $payload['toughness'];
        }
        if (array_key_exists('loyalty', $payload)) {
            $card['loyalty'] = $payload['loyalty'] === null ? null : (int) $payload['loyalty'];
        }
        if (array_key_exists('defense', $payload)) {
            $card['defense'] = $payload['defense'] === null ? null : max(-1, min(99, (int) $payload['defense']));
        }
        if (array_key_exists('saga', $payload)) {
            $card['saga'] = $payload['saga'] === null ? null : max(1, min(9, (int) $payload['saga']));
        }

        $eventPayload = [
            'playerId' => $location['playerId'],
            'zone' => $location['zone'],
            'instanceId' => (string) ($card['instanceId'] ?? ''),
        ];
        foreach (['power', 'toughness', 'loyalty', 'defense', 'saga'] as $key) {
            if (array_key_exists($key, $payload)) {
                $eventPayload[$key] = $card[$key] ?? null;
            }
        }

        return new GameCommandV2Result(
            $helper->v2PowerToughnessLog(
                $card,
                $payload,
                $previousPower,
                $previousToughness,
                $previousLoyalty,
                $previousDefense,
                $previousSaga,
            ),
            $eventPayload,
            array_filter([
                $helper->v2CardStatsOperation($location, $card, false),
            ]),
        );
    }
}
