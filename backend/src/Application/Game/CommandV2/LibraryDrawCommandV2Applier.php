<?php

namespace App\Application\Game\CommandV2;

use App\Application\Game\GameCommandHandler;
use App\Domain\User\User;

final class LibraryDrawCommandV2Applier implements GameCommandV2ApplierInterface
{
    public function supports(string $type): bool
    {
        return $type === 'library.draw' || $type === 'library.draw_many';
    }

    public function apply(array &$snapshot, array $payload, User $actor, GameCommandHandler $helper): ?GameCommandV2Result
    {
        $helper->v2AssertActorOwnPlayer($snapshot, $payload, $actor);
        $count = isset($payload['count']) ? max(1, (int) $payload['count']) : 1;
        $data = $helper->v2LibraryDrawData($snapshot, $payload, $count);

        return new GameCommandV2Result(
            is_string($data['log'] ?? null) ? $data['log'] : null,
            is_array($data['eventPayload'] ?? null) ? $data['eventPayload'] : [],
            is_array($data['operations'] ?? null) ? array_values($data['operations']) : [],
            true,
            is_array($data['viewerPayloads'] ?? null) ? $data['viewerPayloads'] : [],
            false,
            is_array($data['groupPayloads'] ?? null) ? $data['groupPayloads'] : [],
            null,
            null,
            is_array($data['eventStorePayload'] ?? null) ? $data['eventStorePayload'] : null,
        );
    }
}
