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
        $location = $helper->v2RequiredCardLocation($snapshot, $payload);
        if ($location['zone'] !== 'battlefield') {
            throw new \InvalidArgumentException('Only battlefield cards can be freely positioned.');
        }
        $helper->v2AssertActorControlsLocation($snapshot, $location, $actor);

        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $previousPosition = is_array($card['position'] ?? null) ? $card['position'] : null;
        $position = $helper->v2CanonicalRatioPosition($payload['position'] ?? null);
        $card['position'] = $helper->v2IsDayNightCard($card)
            ? $helper->v2DayNightFixedPosition()
            : $position;

        return (new PatchEmitterV2())
            ->emitPublic([
                'op' => 'card.position.set',
                'playerId' => $location['playerId'],
                'zone' => $location['zone'],
                'instanceId' => (string) ($card['instanceId'] ?? ''),
                'position' => $card['position'],
                'effectVersion' => 1,
            ])
            ->toResult(
            sprintf('Moved %s on battlefield.', $helper->v2CardLogName($card)),
            [
                'playerId' => $location['playerId'],
                'zone' => $location['zone'],
                'instanceId' => (string) ($card['instanceId'] ?? ''),
                'position' => $card['position'],
                'previousPosition' => $previousPosition,
                'actorPlayerId' => $actor->id(),
                'effectVersion' => 1,
            ],
            false,
        );
    }
}
