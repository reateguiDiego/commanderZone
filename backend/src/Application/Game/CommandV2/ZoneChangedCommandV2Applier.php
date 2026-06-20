<?php

namespace App\Application\Game\CommandV2;

use App\Application\Game\GameCommandHandler;
use App\Domain\User\User;

final class ZoneChangedCommandV2Applier implements GameCommandV2ApplierInterface
{
    public function supports(string $type): bool
    {
        return $type === 'zone.changed';
    }

    public function apply(array &$snapshot, array $payload, User $actor, GameCommandHandler $helper): ?GameCommandV2Result
    {
        $helper->v2AssertActorOwnPlayer($snapshot, $payload, $actor);
        $data = $helper->v2ZoneReorderByIdsData($snapshot, $payload);

        return new GameCommandV2Result(
            is_string($data['log'] ?? null) ? $data['log'] : null,
            is_array($data['eventPayload'] ?? null) ? $data['eventPayload'] : [],
            is_array($data['operations'] ?? null) ? array_values($data['operations']) : [],
            true,
            is_array($data['viewerPayloads'] ?? null) ? $data['viewerPayloads'] : [],
        );
    }
}
