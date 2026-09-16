<?php

namespace App\Application\Community;

final class CommunityCardPreviewSql
{
    /** $whereSql must be an internal predicate; user filters must use bound parameters. */
    public static function select(string $whereSql, int $limit): string
    {
        // Materialize only the selected IDs so PostgreSQL can sample a narrow index
        // without reading image/face payloads for every eligible printing.
        return sprintf(<<<'SQL'
WITH selected AS MATERIALIZED (
    SELECT card.id, RANDOM() AS position
    FROM card
    WHERE %s
    ORDER BY position
    LIMIT %d
)
SELECT card.id, card.scryfall_id, card.name, card.printed_name, card.colors,
       card.image_uris, card.card_faces, card.type_line
FROM selected
JOIN card ON card.id = selected.id
ORDER BY selected.position
SQL, $whereSql, max(1, $limit));
    }
}
