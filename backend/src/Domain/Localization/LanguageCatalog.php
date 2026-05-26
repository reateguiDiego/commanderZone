<?php

namespace App\Domain\Localization;

final class LanguageCatalog
{
    public const DEFAULT_LANGUAGE = 'en';

    /**
     * Cards and app language options supported by the platform.
     * Keeps the requested minimum list plus existing extras (nl, ca).
     */
    public const SUPPORTED_LANGUAGES = [
        'en',
        'fr',
        'de',
        'it',
        'es',
        'ja',
        'zhs',
        'pt',
        'ru',
        'ko',
        'zht',
        'nl',
        'ca',
    ];

    public static function normalize(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $normalized = mb_strtolower(trim((string) $value));

        return $normalized === '' ? null : $normalized;
    }

    public static function isSupported(?string $value): bool
    {
        return is_string($value) && in_array($value, self::SUPPORTED_LANGUAGES, true);
    }
}
