<?php

namespace App\Application\Card;

use Doctrine\DBAL\ArrayParameterType;

final class PlayableCardCatalogSql
{
    /**
     * @return array<string,mixed>
     */
    public static function parameters(): array
    {
        return [
            'excludedExactTypeLines' => ['other', 'otros'],
            'excludedTokenTypeLine' => '%token%',
            'excludedEmblemTypeLine' => '%emblem%',
            'excludedDungeonTypeLine' => '%dungeon%',
            'excludedLayouts' => [
                'art_series',
                'double_faced_token',
                'dungeon',
                'emblem',
                'phenomenon',
                'planar',
                'scheme',
                'token',
                'vanguard',
            ],
        ];
    }

    /**
     * @return array<string,ArrayParameterType::*>
     */
    public static function parameterTypes(): array
    {
        return [
            'excludedExactTypeLines' => ArrayParameterType::STRING,
            'excludedLayouts' => ArrayParameterType::STRING,
        ];
    }

    /**
     * @param list<string>        $filters
     * @param array<string,mixed> $params
     * @param array<string,mixed> $types
     */
    public static function append(string $alias, array &$filters, array &$params, array &$types, bool $requireAnyNonAlchemyLegalFormat = true): void
    {
        $filters[] = self::condition($alias, $requireAnyNonAlchemyLegalFormat);
        $params = array_replace($params, self::parameters());
        $types = array_replace($types, self::parameterTypes());
    }

    public static function condition(string $alias, bool $requireAnyNonAlchemyLegalFormat = true): string
    {
        $condition = <<<SQL
{$alias}.type_line IS NOT NULL
AND {$alias}.type_line <> ''
AND LOWER(COALESCE({$alias}.name, '')) NOT LIKE 'a-%'
AND LOWER({$alias}.type_line) NOT IN (:excludedExactTypeLines)
AND LOWER({$alias}.type_line) !~ '(^|[[:space:]])card([[:space:]]|$)'
AND LOWER({$alias}.type_line) NOT LIKE :excludedTokenTypeLine
AND LOWER({$alias}.type_line) NOT LIKE :excludedEmblemTypeLine
AND LOWER({$alias}.type_line) NOT LIKE :excludedDungeonTypeLine
AND LOWER(COALESCE({$alias}.layout, '')) NOT IN (:excludedLayouts)
SQL;

        if (!$requireAnyNonAlchemyLegalFormat) {
            return $condition;
        }

        return $condition.<<<SQL

AND EXISTS (
    SELECT 1
    FROM jsonb_each_text(COALESCE({$alias}.legalities::jsonb, '{}'::jsonb)) AS card_legality(format, status)
    WHERE card_legality.format <> 'alchemy'
      AND card_legality.status = 'legal'
)
SQL;
    }
}
