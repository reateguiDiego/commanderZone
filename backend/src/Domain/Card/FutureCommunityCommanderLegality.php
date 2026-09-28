<?php

namespace App\Domain\Card;

/**
 * Derives Commander legality when Scryfall marks a card as Future legal and it
 * is otherwise legal only in community formats.
 */
final class FutureCommunityCommanderLegality
{
    /**
     * @var list<string>
     */
    private const COMMUNITY_FORMATS = [
        'duel',
        'gladiator',
        'penny',
        'tlr',
        'paupercommander',
        'predh',
        'premodern',
        'oldschool',
    ];

    /**
     * @param array<string,mixed> $legalities
     *
     * @return array<string,mixed>
     */
    public static function normalize(array $legalities): array
    {
        if (self::applies($legalities)) {
            $legalities['commander'] = 'legal';
        }

        return $legalities;
    }

    /**
     * @param array<string,mixed> $legalities
     */
    public static function applies(array $legalities): bool
    {
        return self::isLegal($legalities, 'future')
            && self::hasLegalFormat($legalities, self::COMMUNITY_FORMATS)
            && self::hasOnlyCommunityLegalities($legalities);
    }

    /**
     * @return list<string>
     */
    public static function communityFormats(): array
    {
        return self::COMMUNITY_FORMATS;
    }

    /**
     * @param array<string,mixed> $legalities
     * @param list<string> $formats
     */
    private static function hasLegalFormat(array $legalities, array $formats): bool
    {
        foreach ($formats as $format) {
            if (self::isLegal($legalities, $format)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string,mixed> $legalities
     */
    private static function hasOnlyCommunityLegalities(array $legalities): bool
    {
        foreach ($legalities as $format => $status) {
            if ($format === 'future' || $status !== 'legal') {
                continue;
            }

            if (!in_array($format, self::COMMUNITY_FORMATS, true)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param array<string,mixed> $legalities
     */
    private static function isLegal(array $legalities, string $format): bool
    {
        return ($legalities[$format] ?? null) === 'legal';
    }
}
