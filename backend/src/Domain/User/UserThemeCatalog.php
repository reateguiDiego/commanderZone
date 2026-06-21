<?php

namespace App\Domain\User;

final class UserThemeCatalog
{
    public const DEFAULT_THEME = 'sunrise';

    public const SUPPORTED_THEMES = [
        'sunrise',
        'arcade-neon-clash',
        'candy-summoners',
        'treasure-tavern',
        'cyber-duel-arena',
        'mystic-grove',
    ];

    public static function normalize(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $normalized = trim((string) $value);

        return $normalized === '' ? null : $normalized;
    }

    public static function isSupported(?string $value): bool
    {
        return is_string($value) && in_array($value, self::SUPPORTED_THEMES, true);
    }
}
