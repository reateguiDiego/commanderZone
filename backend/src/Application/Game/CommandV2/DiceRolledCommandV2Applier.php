<?php

namespace App\Application\Game\CommandV2;

use App\Application\Game\GameCommandHandler;
use App\Domain\User\User;

final class DiceRolledCommandV2Applier implements GameCommandV2ApplierInterface
{
    public function supports(string $type): bool
    {
        return $type === 'dice.rolled';
    }

    public function apply(array &$snapshot, array $payload, User $actor, GameCommandHandler $helper): ?GameCommandV2Result
    {
        unset($snapshot, $actor);

        $kind = trim((string) ($payload['kind'] ?? ''));
        $finalResult = $helper->v2RollDice($kind);

        if ($kind === 'coin') {
            $result = match (strtolower((string) $finalResult)) {
                'cara' => 'Cara',
                'cruz' => 'Cruz',
                default => throw new \InvalidArgumentException('Invalid coin result.'),
            };

            return new GameCommandV2Result(
                sprintf('ha tirado una moneda, ha salido %s.', $result),
                [
                    'kind' => $kind,
                    'finalResult' => (string) $finalResult,
                ],
                [],
            );
        }

        if (!is_int($finalResult)) {
            throw new \InvalidArgumentException('Invalid dice result.');
        }

        $sides = (int) substr($kind, 1);
        if ($finalResult < 1 || $finalResult > $sides) {
            throw new \InvalidArgumentException('Invalid dice result.');
        }

        return new GameCommandV2Result(
            sprintf('ha tirado un %s, ha salido un %d.', $kind, $finalResult),
            [
                'kind' => $kind,
                'finalResult' => (string) $finalResult,
            ],
            [],
        );
    }
}
