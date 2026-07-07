<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;

final class DeckAnalysisDeckCardResolver
{
    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @return array{
     *   deck_id:string,
     *   resolved:list<array{deck_card_id:string,oracle_id:string,name:string,quantity:int,section:string}>,
     *   unmatched:list<array{deck_card_id:string,name:?string,quantity:int,section:string,reason:string}>
     * }
     */
    public function resolve(string $deckId): array
    {
        $resolved = [];
        $unmatched = [];

        foreach ($this->deckCardRows($deckId) as $row) {
            $deckCardId = (string) $row['deck_card_id'];
            $name = $this->stringOrNull($row['name'] ?? null);
            $quantity = max(1, (int) ($row['quantity'] ?? 1));
            $section = $this->stringOrNull($row['section'] ?? null) ?? 'main';
            $oracleId = $this->stringOrNull($row['oracle_id'] ?? null);

            if ($this->stringOrNull($row['card_id'] ?? null) === null) {
                $unmatched[] = $this->unmatched($deckCardId, $name, $quantity, $section, 'card_missing');
                continue;
            }

            if ($oracleId === null) {
                $unmatched[] = $this->unmatched($deckCardId, $name, $quantity, $section, 'missing_oracle_id');
                continue;
            }

            if (!$this->boolValue($row['has_analysis_profile'] ?? false)) {
                $unmatched[] = $this->unmatched($deckCardId, $name, $quantity, $section, 'missing_card_analysis_profile');
                continue;
            }

            $resolved[] = [
                'deck_card_id' => $deckCardId,
                'oracle_id' => $oracleId,
                'name' => $name ?? 'Unknown card',
                'quantity' => $quantity,
                'section' => $section,
            ];
        }

        return [
            'deck_id' => $deckId,
            'resolved' => $resolved,
            'unmatched' => $unmatched,
        ];
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    private function deckCardRows(string $deckId): iterable
    {
        return $this->connection->executeQuery(
            <<<'SQL'
SELECT
    deck_card.id AS deck_card_id,
    deck_card.quantity,
    deck_card.section,
    card.id AS card_id,
    card.name,
    card.oracle_id,
    CASE WHEN card_analysis_profile.oracle_id IS NULL THEN false ELSE true END AS has_analysis_profile
FROM deck_card
LEFT JOIN card ON card.id = deck_card.card_id
LEFT JOIN card_analysis_profile ON card_analysis_profile.oracle_id = card.oracle_id
WHERE deck_card.deck_id = :deck_id
ORDER BY deck_card.section, card.name, deck_card.id
SQL,
            ['deck_id' => $deckId],
        )->iterateAssociative();
    }

    /**
     * @return array{deck_card_id:string,name:?string,quantity:int,section:string,reason:string}
     */
    private function unmatched(string $deckCardId, ?string $name, int $quantity, string $section, string $reason): array
    {
        return [
            'deck_card_id' => $deckCardId,
            'name' => $name,
            'quantity' => $quantity,
            'section' => $section,
            'reason' => $reason,
        ];
    }

    private function stringOrNull(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = trim((string) $value);

        return $string !== '' ? $string : null;
    }

    private function boolValue(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if (is_int($value)) {
            return $value === 1;
        }

        if (!is_string($value)) {
            return false;
        }

        return in_array(mb_strtolower(trim($value)), ['1', 'true', 't', 'yes', 'y'], true);
    }
}
