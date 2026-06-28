<?php

namespace App\Application\Game\CommandV2;

use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameTurnSuccession;
use App\Domain\User\User;

final class TurnChangedCommandV2Applier implements GameCommandV2ApplierInterface
{
    public function supports(string $type): bool
    {
        return $type === 'turn.changed';
    }

    public function apply(array &$snapshot, array $payload, User $actor, GameCommandHandler $helper): ?GameCommandV2Result
    {
        $helper->v2AssertActorIsActiveTurnPlayer($snapshot, $actor);
        if (!array_key_exists('activePlayerId', $payload)
            && !array_key_exists('phase', $payload)
            && !array_key_exists('number', $payload)) {
            throw new \InvalidArgumentException('turn.changed requires activePlayerId, phase, or number.');
        }

        $previousPhase = (string) ($snapshot['turn']['phase'] ?? '');
        $previousActivePlayerId = (string) ($snapshot['turn']['activePlayerId'] ?? '');
        $allowed = array_intersect_key($payload, array_flip(['activePlayerId', 'phase', 'number']));
        if (isset($allowed['activePlayerId'])) {
            $allowed['activePlayerId'] = $helper->v2RequiredPlayerId($snapshot, ['playerId' => $allowed['activePlayerId']]);
        }
        if (isset($allowed['phase']) && trim((string) $allowed['phase']) === '') {
            throw new \InvalidArgumentException('phase must not be empty.');
        }
        if (isset($allowed['number'])) {
            $allowed['number'] = max(1, (int) $allowed['number']);
        }

        $snapshot['turn'] = array_replace($snapshot['turn'] ?? [], $allowed);
        if (array_key_exists('activePlayerId', $allowed)) {
            $snapshot['turn']['activePlayerId'] = GameTurnSuccession::eligiblePlayerId(
                $snapshot,
                (string) $snapshot['turn']['activePlayerId'],
            );
        }

        $phase = (string) ($snapshot['turn']['phase'] ?? $previousPhase);
        $activePlayerId = (string) ($snapshot['turn']['activePlayerId'] ?? $previousActivePlayerId);
        $message = $activePlayerId !== $previousActivePlayerId
            ? sprintf(
                'Turno %d: empieza el turno de %s. Fase %s.',
                (int) ($snapshot['turn']['number'] ?? 1),
                $helper->v2PlayerName($snapshot, $activePlayerId),
                $phase,
            )
            : ((($phase !== $previousPhase) || array_key_exists('phase', $allowed))
                ? sprintf('Fase %s.', $phase)
                : sprintf('Turno %d.', (int) ($snapshot['turn']['number'] ?? 1)));

        $emitter = (new PatchEmitterV2())->emitPublic([
            'op' => 'turn.set',
            'turn' => $snapshot['turn'],
        ]);

        return $emitter->toResult(
            $message,
            ['turn' => $snapshot['turn']],
        );
    }
}
