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
        $playerId = $helper->v2RequiredPlayerId($snapshot, $payload);
        $zone = (string) ($payload['zone'] ?? '');
        if ($zone !== 'battlefield') {
            throw new \InvalidArgumentException('Only battlefield cards can be freely positioned.');
        }

        $positions = $payload['positions'] ?? null;
        if (!is_array($positions) || $positions === []) {
            throw new \InvalidArgumentException('positions must contain at least one card position.');
        }

        $validated = [];
        $seen = [];
        foreach ($positions as $index => $positionPayload) {
            if (!is_array($positionPayload)) {
                throw new \InvalidArgumentException('INVALID_POSITION: each position entry must be an object.');
            }

            $location = $helper->v2RequiredCardLocation($snapshot, [
                'playerId' => $playerId,
                'zone' => $zone,
                'instanceId' => $positionPayload['instanceId'] ?? null,
            ]);
            $helper->v2AssertActorControlsLocation($snapshot, $location, $actor);
            $instanceId = (string) ($positionPayload['instanceId'] ?? '');
            if (isset($seen[$instanceId])) {
                throw new \InvalidArgumentException(sprintf('DUPLICATE_INSTANCE: duplicate instance at index %d.', $index));
            }
            $seen[$instanceId] = true;
            $validated[] = [
                'location' => $location,
                'position' => $helper->v2CanonicalRatioPosition($positionPayload['position'] ?? null),
            ];
        }

        $moved = [];
        $previousPositions = [];
        foreach ($validated as $entry) {
            $location = $entry['location'];
            $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
            $previousPositions[] = [
                'instanceId' => (string) ($card['instanceId'] ?? ''),
                'position' => is_array($card['position'] ?? null) ? $card['position'] : null,
            ];
            $card['position'] = $helper->v2IsDayNightCard($card)
                ? $helper->v2DayNightFixedPosition()
                : $entry['position'];
            $moved[] = [
                'instanceId' => (string) ($card['instanceId'] ?? ''),
                'position' => $card['position'],
            ];
            unset($card);
        }

        $emitter = (new PatchEmitterV2())->emitPublic([
            'op' => 'cards.position.set',
            'playerId' => $playerId,
            'zone' => $zone,
            'positions' => $moved,
            'effectVersion' => 1,
        ]);

        return $emitter->toResult(
            sprintf('Moved %d cards on battlefield.', count($moved)),
            [
                'effectVersion' => 1,
                'playerId' => $playerId,
                'zone' => $zone,
                'previousPositions' => $previousPositions,
                'positions' => $moved,
                'actorPlayerId' => $actor->id(),
            ],
            false,
        );
    }
}
