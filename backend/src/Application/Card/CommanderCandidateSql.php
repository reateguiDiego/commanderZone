<?php

namespace App\Application\Card;

final class CommanderCandidateSql
{
    public static function condition(string $alias): string
    {
        $typeLine = sprintf("LOWER(COALESCE(%s.type_line, ''))", $alias);
        $oracleText = sprintf("LOWER(COALESCE(%s.oracle_text, ''))", $alias);

        return sprintf(
            "%s.commander_legal = true AND ((%s LIKE '%%legendary%%' AND %s LIKE '%%creature%%') OR %s LIKE '%%can be your commander%%')",
            $alias,
            $typeLine,
            $typeLine,
            $oracleText,
        );
    }
}
