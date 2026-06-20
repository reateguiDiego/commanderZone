<?php

namespace App\Application\Game\CommandV2;

use App\Application\Game\GameCommandHandler;
use App\Domain\User\User;

final class CardsPositionChangedCommandV2Applier implements GameCommandV2ApplierInterface
{
    public function supports(string $type): bool
    {
        return $type === 'cards.position.changed';
    }

    public function apply(array &$snapshot, array $payload, User $actor, GameCommandHandler $helper): ?GameCommandV2Result
    {
        $helper->v2AssertActorOwnPlayer($snapshot, $payload, $actor);
        $playerId = $helper->v2RequiredPlayerId($snapshot, $payload);
        $zone = (string) ($payload['zone'] ?? '');
        if ($zone !== 'battlefield') {
            throw new \InvalidArgumentException('Only battlefield cards can be freely positioned.');
        }

        $positions = $payload['positions'] ?? null;
        if (!is_array($positions) || $positions === []) {
            throw new \InvalidArgumentException('positions must contain at least one card position.');
        }

        $moved = [];
        foreach ($positions as $positionPayload) {
            if (!is_array($positionPayload)) {
                throw new \InvalidArgumentException('Each position entry must be an object.');
            }

            $location = $helper->v2RequiredCardLocation($snapshot, [
                'playerId' => $playerId,
                'zone' => $zone,
                'instanceId' => $positionPayload['instanceId'] ?? null,
            ]);
            $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
            $card['position'] = $helper->v2IsDayNightCard($card)
                ? $helper->v2DayNightFixedPosition()
                : $helper->v2NormalizedPosition($positionPayload['position'] ?? null);
            $moved[] = [
                'instanceId' => (string) ($card['instanceId'] ?? ''),
                'position' => $card['position'],
            ];
            unset($card);
        }

        return new GameCommandV2Result(
            sprintf('Moved %d cards on battlefield.', count($moved)),
            ['playerId' => $playerId, 'zone' => $zone, 'positions' => $moved],
            [[
                'op' => 'cards.position.set',
                'playerId' => $playerId,
                'zone' => $zone,
                'positions' => $moved,
            ]],
            false,
        );
    }
}
