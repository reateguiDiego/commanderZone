<?php

namespace App\Application\Game;

final class GameMulliganEventTypes
{
    public const STARTED = 'mulligan.started';
    public const PLAYER_TOOK_MULLIGAN = 'mulligan.player_took_mulligan';
    public const HAND_DRAWN = 'mulligan.hand_drawn';
    public const PLAYER_KEPT = 'mulligan.player_kept';
    public const CARDS_BOTTOMED = 'mulligan.cards_bottomed';
    public const SCRY_AVAILABLE = 'mulligan.scry_available';
    public const SCRY_CONFIRMED = 'mulligan.scry_confirmed';
    public const PLAYER_READY = 'mulligan.player_ready';
    public const COMPLETED = 'mulligan.completed';
    public const GAME_PHASE_CHANGED = 'game.phase_changed';

    /**
     * @return list<string>
     */
    public static function all(): array
    {
        return [
            self::STARTED,
            self::PLAYER_TOOK_MULLIGAN,
            self::HAND_DRAWN,
            self::PLAYER_KEPT,
            self::CARDS_BOTTOMED,
            self::SCRY_AVAILABLE,
            self::SCRY_CONFIRMED,
            self::PLAYER_READY,
            self::COMPLETED,
            self::GAME_PHASE_CHANGED,
        ];
    }
}
