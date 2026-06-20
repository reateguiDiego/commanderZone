<?php

namespace App\Application\Game\CommandV2;

use App\Application\Game\GameCommandHandler;
use App\Domain\User\User;

final class CardTappedCommandV2Applier implements GameCommandV2ApplierInterface
{
    public function supports(string $type): bool
    {
        return $type === 'card.tapped';
    }

    public function apply(array &$snapshot, array $payload, User $actor, GameCommandHandler $helper): ?GameCommandV2Result
    {
        $helper->v2AssertActorOwnPlayer($snapshot, $payload, $actor);
        $location = $helper->v2RequiredCardLocation($snapshot, $payload);
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $card['tapped'] = (bool) ($payload['tapped'] ?? !($card['tapped'] ?? false));
        $card['rotation'] = $card['tapped'] ? 90 : 0;

        return new GameCommandV2Result(
            sprintf('%s %s.', $card['tapped'] ? 'Tapped' : 'Untapped', $helper->v2CardLogName($card)),
            [
                'playerId' => $location['playerId'],
                'zone' => $location['zone'],
                'instanceId' => (string) ($card['instanceId'] ?? ''),
                'tapped' => (bool) $card['tapped'],
            ],
            [[
                'op' => 'card.state.set',
                'playerId' => $location['playerId'],
                'zone' => $location['zone'],
                'instanceId' => (string) ($card['instanceId'] ?? ''),
                'tapped' => (bool) $card['tapped'],
            ]],
        );
    }
}
