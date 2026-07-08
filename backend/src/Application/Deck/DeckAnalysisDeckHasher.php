<?php

namespace App\Application\Deck;

use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use Doctrine\DBAL\Connection;

final class DeckAnalysisDeckHasher
{
    public function __construct(private readonly Connection $connection)
    {
    }

    public function hash(Deck $deck): string
    {
        $items = [];
        foreach ($this->deckRows($deck->id()) as $row) {
            $oracleId = $this->stringOrNull($row['oracle_id'] ?? null);
            $cardId = $this->stringOrNull($row['card_id'] ?? null);
            $items[] = [
                'cardId' => $cardId ?? 'missing',
                'oracleId' => $oracleId,
                'quantity' => max(1, (int) ($row['quantity'] ?? 1)),
                'section' => $this->stringOrNull($row['section'] ?? null) ?? 'main',
                'status' => $oracleId !== null ? 'matched' : 'unmatched',
            ];
        }

        usort($items, static function (array $left, array $right): int {
            return [$left['section'], $left['status'], $left['oracleId'], $left['cardId'], $left['quantity']]
                <=> [$right['section'], $right['status'], $right['oracleId'], $right['cardId'], $right['quantity']];
        });

        return hash('sha256', json_encode($items, JSON_THROW_ON_ERROR));
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    private function deckRows(string $deckId): iterable
    {
        return $this->connection->executeQuery(
            <<<'SQL'
SELECT
    deck_card.id AS deck_card_id,
    deck_card.quantity,
    deck_card.section,
    card.id AS card_id,
    card.oracle_id
FROM deck_card
LEFT JOIN card ON card.id = deck_card.card_id
WHERE deck_card.deck_id = :deck_id
  AND deck_card.section IN (:main_section, :commander_section)
SQL,
            [
                'deck_id' => $deckId,
                'main_section' => DeckCard::SECTION_MAIN,
                'commander_section' => DeckCard::SECTION_COMMANDER,
            ],
        )->iterateAssociative();
    }

    private function stringOrNull(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = trim((string) $value);

        return $string !== '' ? $string : null;
    }
}
