<?php

namespace App\Application\Game\CommandV2;

use App\Application\Game\GameCommandHandler;
use App\Domain\User\User;

final class CardPositionChangedCommandV2Applier implements GameCommandV2ApplierInterface
{
    public function supports(string $type): bool
    {
        return $type === 'card.position.changed';
    }

    public function apply(array &$snapshot, array $payload, User $actor, GameCommandHandler $helper): ?GameCommandV2Result
    {
        $helper->v2AssertActorOwnPlayer($snapshot, $payload, $actor);
        $location = $helper->v2RequiredCardLocation($snapshot, $payload);
        if ($location['zone'] !== 'battlefield') {
            throw new \InvalidArgumentException('Only battlefield cards can be freely positioned.');
        }

        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $card['position'] = $helper->v2IsDayNightCard($card)
            ? $helper->v2DayNightFixedPosition()
            : $helper->v2NormalizedPosition($payload['position'] ?? null);

        return (new PatchEmitterV2())
            ->emitPublic([
                'op' => 'card.field.set',
                'playerId' => $location['playerId'],
                'zone' => $location['zone'],
                'instanceId' => (string) ($card['instanceId'] ?? ''),
                'position' => $card['position'],
            ])
            ->toResult(
            sprintf('Moved %s on battlefield.', $helper->v2CardLogName($card)),
            [
                'playerId' => $location['playerId'],
                'zone' => $location['zone'],
                'instanceId' => (string) ($card['instanceId'] ?? ''),
                'position' => $card['position'],
            ],
            false,
        );
    }
}
