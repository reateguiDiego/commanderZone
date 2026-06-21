<?php

namespace App\Application\Game\CommandV2;

use App\Application\Game\GameCommandHandler;
use App\Domain\User\User;

final class LifeChangedCommandV2Applier implements GameCommandV2ApplierInterface
{
    public function supports(string $type): bool
    {
        return $type === 'life.changed';
    }

    public function apply(array &$snapshot, array $payload, User $actor, GameCommandHandler $helper): ?GameCommandV2Result
    {
        $helper->v2AssertActorOwnPlayer($snapshot, $payload, $actor, 'playerId', 'You can only change your own life total.');
        if (!array_key_exists('life', $payload) && !array_key_exists('delta', $payload)) {
            throw new \InvalidArgumentException('life.changed requires life or delta.');
        }

        $playerId = $helper->v2RequiredPlayerId($snapshot, $payload);
        $oldLife = (int) ($snapshot['players'][$playerId]['life'] ?? 40);
        $newLife = array_key_exists('life', $payload)
            ? (int) $payload['life']
            : $oldLife + (int) ($payload['delta'] ?? 0);
        $snapshot['players'][$playerId]['life'] = $newLife;

        if ($oldLife <= 0 && !$helper->v2HasPlayerDefeatedLog($snapshot, $playerId)) {
            $helper->v2MarkPendingDefeatedPlayer($playerId, true);
        } elseif ($oldLife > 0 && $newLife <= 0 && !$helper->v2HasPlayerDefeatedLog($snapshot, $playerId)) {
            $helper->v2MarkPendingDefeatedPlayer($playerId);
        }

        $emitter = (new PatchEmitterV2())->emitPublic([
            'op' => 'player.life.set',
            'playerId' => $playerId,
            'value' => $newLife,
        ]);

        return $emitter->toResult(
            $helper->v2LifeChangeLog($oldLife, $newLife),
            [
                'playerId' => $playerId,
                'life' => $newLife,
            ],
        );
    }
}
