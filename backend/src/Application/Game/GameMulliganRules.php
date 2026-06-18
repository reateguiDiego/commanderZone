<?php

namespace App\Application\Game;

use App\Domain\Room\Room;

final class GameMulliganRules
{
    public const BOTTOM_ORDER_NONE = 'NONE';
    public const BOTTOM_ORDER_PLAYER_CHOSEN = 'PLAYER_CHOSEN_ORDER';
    public const BOTTOM_ORDER_RANDOM_SERVER_SIDE = 'RANDOM_SERVER_SIDE';

    /**
     * @return array{
     *     rule:string,
     *     mulligansTaken:int,
     *     effectiveMulligans:int,
     *     drawCount:int,
     *     bottomSelectionCount:int,
     *     finalHandSize:int,
     *     needsBottomSelection:bool,
     *     bottomOrderMode:string,
     *     needsScryAfterKeep:bool,
     *     canTakeAnotherMulligan:bool
     * }
     */
    public static function calculateMulliganState(string $rule, bool $firstMulliganFree, int $mulligansTaken): array
    {
        $rule = self::normalizedRule($rule);
        $mulligansTaken = max(0, $mulligansTaken);
        $effectiveMulligans = self::effectiveMulligans($mulligansTaken, $firstMulliganFree);
        $state = self::baseState($rule, $mulligansTaken, $effectiveMulligans);

        return [
            ...$state,
            'canTakeAnotherMulligan' => self::canTakeAnotherMulligan($rule, $firstMulliganFree, $mulligansTaken),
        ];
    }

    public static function effectiveMulligans(int $mulligansTaken, bool $firstMulliganFree): int
    {
        return max(0, $mulligansTaken - ($firstMulliganFree ? 1 : 0));
    }

    private static function normalizedRule(string $rule): string
    {
        return in_array($rule, Room::MULLIGAN_RULES, true) ? $rule : Room::DEFAULT_MULLIGAN_RULE;
    }

    /**
     * @return array{
     *     rule:string,
     *     mulligansTaken:int,
     *     effectiveMulligans:int,
     *     drawCount:int,
     *     bottomSelectionCount:int,
     *     finalHandSize:int,
     *     needsBottomSelection:bool,
     *     bottomOrderMode:string,
     *     needsScryAfterKeep:bool
     * }
     */
    private static function baseState(string $rule, int $mulligansTaken, int $effectiveMulligans): array
    {
        $drawCount = match ($rule) {
            Room::MULLIGAN_LONDON => 7,
            Room::MULLIGAN_GENEROUS => max(0, 10 - $effectiveMulligans),
            default => max(0, 7 - $effectiveMulligans),
        };
        $bottomSelectionCount = match ($rule) {
            Room::MULLIGAN_LONDON => $effectiveMulligans,
            Room::MULLIGAN_GENEROUS => max(0, $drawCount - 7),
            default => 0,
        };
        $bottomOrderMode = match ($rule) {
            Room::MULLIGAN_LONDON => self::BOTTOM_ORDER_PLAYER_CHOSEN,
            Room::MULLIGAN_GENEROUS => $bottomSelectionCount > 0 ? self::BOTTOM_ORDER_RANDOM_SERVER_SIDE : self::BOTTOM_ORDER_NONE,
            default => self::BOTTOM_ORDER_NONE,
        };
        $needsScryAfterKeep = $rule === Room::MULLIGAN_VANCOUVER && $effectiveMulligans > 0;

        return [
            'rule' => $rule,
            'mulligansTaken' => $mulligansTaken,
            'effectiveMulligans' => $effectiveMulligans,
            'drawCount' => $drawCount,
            'bottomSelectionCount' => $bottomSelectionCount,
            'finalHandSize' => $drawCount - $bottomSelectionCount,
            'needsBottomSelection' => $bottomSelectionCount > 0,
            'bottomOrderMode' => $bottomOrderMode,
            'needsScryAfterKeep' => $needsScryAfterKeep,
        ];
    }

    private static function canTakeAnotherMulligan(string $rule, bool $firstMulliganFree, int $mulligansTaken): bool
    {
        $nextMulligansTaken = max(0, $mulligansTaken) + 1;
        $nextEffectiveMulligans = self::effectiveMulligans($nextMulligansTaken, $firstMulliganFree);

        return match ($rule) {
            Room::MULLIGAN_LONDON => $nextEffectiveMulligans <= 7,
            Room::MULLIGAN_GENEROUS => $nextEffectiveMulligans <= 10,
            default => $nextEffectiveMulligans <= 7,
        };
    }
}
