<?php

namespace App\Application\Game;

final class GameSpatialPositionContract
{
    private const UNIT_RATIO = 'ratio';

    /**
     * @return array{x:float,y:float,unit:'ratio'}
     */
    public function canonicalRatioPosition(mixed $position): array
    {
        if (!is_array($position) || !array_key_exists('x', $position) || !array_key_exists('y', $position)) {
            throw new \InvalidArgumentException('INVALID_POSITION: position requires x, y and unit ratio.');
        }
        if (($position['unit'] ?? null) !== self::UNIT_RATIO) {
            throw new \InvalidArgumentException('UNSUPPORTED_POSITION_UNIT: position unit must be ratio.');
        }
        if (!(is_int($position['x']) || is_float($position['x'])) || !(is_int($position['y']) || is_float($position['y']))) {
            throw new \InvalidArgumentException('INVALID_POSITION: x and y must be numbers.');
        }
        $x = (float) $position['x'];
        $y = (float) $position['y'];
        if (!is_finite($x) || !is_finite($y)) {
            throw new \InvalidArgumentException('POSITION_NOT_FINITE: x and y must be finite.');
        }
        if ($x < 0.0 || $x > 1.0 || $y < 0.0 || $y > 1.0) {
            throw new \InvalidArgumentException('POSITION_OUT_OF_RANGE: x and y must be between zero and one.');
        }
        if (array_diff(array_keys($position), ['x', 'y', 'unit']) !== []) {
            throw new \InvalidArgumentException('INVALID_POSITION: viewport and render fields are not accepted.');
        }

        return ['x' => $x, 'y' => $y, 'unit' => self::UNIT_RATIO];
    }

    /**
     * @param array{zone?:string} $location
     */
    public function assertControlledBattlefield(
        array $location,
        ?string $actorPlayerId,
        ?string $controllerPlayerId,
    ): void {
        if (($location['zone'] ?? null) !== 'battlefield') {
            throw new \InvalidArgumentException('INSTANCE_NOT_ON_BATTLEFIELD: card is not on battlefield.');
        }
        if ($actorPlayerId === null || $controllerPlayerId === null || $actorPlayerId !== $controllerPlayerId) {
            throw new \InvalidArgumentException('INSTANCE_NOT_CONTROLLED: actor is not the current controller.');
        }
    }
}
