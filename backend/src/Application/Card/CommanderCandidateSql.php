<?php

namespace App\Application\Card;

final class CommanderCandidateSql
{
    public static function condition(string $alias): string
    {
        $typeLine = sprintf("LOWER(COALESCE(%s.type_line, ''))", $alias);
        $oracleText = sprintf("LOWER(COALESCE(%s.oracle_text, ''))", $alias);
        $frontType = "LOWER(COALESCE($alias.card_faces->0->>'type_line', $alias.card_faces->0->>'typeLine', SPLIT_PART($alias.type_line, '//', 1), ''))";
        $power = "NULLIF(BTRIM(COALESCE($alias.card_faces->0->>'power', $alias.power)), '')";
        $toughness = "NULLIF(BTRIM(COALESCE($alias.card_faces->0->>'toughness', $alias.toughness)), '')";
        $artifact = "($frontType ~ '\\mlegendary\\M' AND ($frontType ~ '\\mvehicle\\M' OR ($frontType ~ '\\mspacecraft\\M' AND $power IS NOT NULL AND $toughness IS NOT NULL)))";

        return sprintf(
            "%s.commander_legal = true AND ((%s LIKE '%%legendary%%' AND %s LIKE '%%creature%%') OR %s LIKE '%%can be your commander%%' OR %s)",
            $alias,
            $typeLine,
            $typeLine,
            $oracleText,
            $artifact,
        );
    }
}
