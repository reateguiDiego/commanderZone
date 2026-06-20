<?php

namespace App\Domain\Localization;

final class LanguageCatalog
{
    public const DEFAULT_LANGUAGE = 'en';
    public const COMMON_PRINT_LANGUAGES = ['ph', 'qya', 'grc', 'he', 'sa', 'ar'];

    public const SUPPORTED_APP_LANGUAGES = [
        'en',
        'fr',
        'de',
        'it',
        'es',
        'ja',
        'zhs',
        'pt',
        'ru',
        'nl',
        'ca',
    ];

    public const SUPPORTED_CARD_LANGUAGES = [
        ...self::SUPPORTED_APP_LANGUAGES,
        'ko',
        'zht',
    ];

    /**
     * Cards and app language options supported by the platform.
     *
     * @deprecated Prefer isSupportedCardLanguage or isSupportedAppLanguage at write boundaries.
     */
    public const SUPPORTED_LANGUAGES = self::SUPPORTED_CARD_LANGUAGES;

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
        return self::isSupportedCardLanguage($value);
    }

    public static function isSupportedCardLanguage(?string $value): bool
    {
        return is_string($value) && in_array($value, self::SUPPORTED_CARD_LANGUAGES, true);
    }

    public static function isSupportedAppLanguage(?string $value): bool
    {
        return is_string($value) && in_array($value, self::SUPPORTED_APP_LANGUAGES, true);
    }

    public static function isCommonPrintLanguage(?string $value): bool
    {
        return is_string($value) && in_array($value, self::COMMON_PRINT_LANGUAGES, true);
    }

    /**
     * @return list<string>
     */
    public static function commonPrintLanguages(): array
    {
        return self::COMMON_PRINT_LANGUAGES;
    }
}
