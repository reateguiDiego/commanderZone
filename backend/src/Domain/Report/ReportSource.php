<?php

declare(strict_types=1);

namespace App\Domain\Report;

enum ReportSource: string
{
    case PROFILE = 'profile';
    case GAME_PLAYER = 'game_player';
    case CHAT_MESSAGE = 'chat_message';
    /** Migration-only source for reports created before moderation evidence existed. */
    case LEGACY = 'legacy';

    public function requiresGameEvidence(): bool
    {
        return $this === self::GAME_PLAYER || $this === self::CHAT_MESSAGE;
    }

    public function canBeSubmitted(): bool
    {
        return $this !== self::LEGACY;
    }
}
