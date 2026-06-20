<?php

namespace App\Application\Game\CommandV2;

use App\Application\Game\GameCommandHandler;
use App\Domain\User\User;

final class BattlefieldUntapAllCommandV2Applier implements GameCommandV2ApplierInterface
{
    public function supports(string $type): bool
    {
        return $type === 'battlefield.untap_all';
    }

    public function apply(array &$snapshot, array $payload, User $actor, GameCommandHandler $helper): ?GameCommandV2Result
    {
        $helper->v2AssertActorOwnPlayer($snapshot, $payload, $actor);
        $playerId = $helper->v2RequiredPlayerId($snapshot, $payload);
        $battlefield =& $snapshot['players'][$playerId]['zones']['battlefield'];
        $states = [];
        $untapped = 0;
        foreach ($battlefield as &$card) {
            if (!is_array($card) || (($card['tapped'] ?? false) !== true)) {
                continue;
            }

            $card['tapped'] = false;
            $states[] = [
                'instanceId' => (string) ($card['instanceId'] ?? ''),
                'tapped' => false,
                'rotation' => (int) ($card['rotation'] ?? 0),
            ];
            ++$untapped;
        }
        unset($card);

        return new GameCommandV2Result(
            $untapped === 0 ? '' : sprintf('Untapped %d battlefield card%s.', $untapped, $untapped === 1 ? '' : 's'),
            ['playerId' => $playerId],
            $states === [] ? [] : [[
                'op' => 'cards.state.set',
                'playerId' => $playerId,
                'zone' => 'battlefield',
                'cards' => $states,
            ]],
        );
    }
}
