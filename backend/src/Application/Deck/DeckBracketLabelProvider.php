<?php

namespace App\Application\Deck;

use App\Domain\Deck\Deck;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;

final class DeckBracketLabelProvider
{
    /**
     * @param list<string> $deckIds
     *
     * @return array<string,array{bracket:int,label:string}>
     */
    public function labelsByDeckIds(array $deckIds, bool $calculateMissing = false): array
    {
        $deckIds = array_values(array_unique(array_filter($deckIds, static fn (string $deckId): bool => trim($deckId) !== '')));
        if ($deckIds === []) {
            return [];
        }

        $rows = $this->connection->fetchAllAssociative(<<<'SQL'
SELECT DISTINCT ON (snapshot.deck_id)
    snapshot.deck_id,
    snapshot.result_json->'bracket' AS bracket_json
FROM deck_analysis_snapshot snapshot
INNER JOIN deck ON deck.id = snapshot.deck_id
WHERE snapshot.deck_id IN (:deckIds)
  AND jsonb_exists(snapshot.result_json, 'bracket')
  AND snapshot.updated_at >= deck.updated_at
ORDER BY snapshot.deck_id, snapshot.updated_at DESC
SQL,
            ['deckIds' => $deckIds],
            ['deckIds' => ArrayParameterType::STRING],
        );

        $labels = [];
        foreach ($rows as $row) {
            $deckId = trim((string) ($row['deck_id'] ?? ''));
            $bracket = $this->bracketLabel($row['bracket_json'] ?? null);
            if ($deckId !== '' && $bracket !== null) {
                $labels[$deckId] = $bracket;
            }
        }

        if ($calculateMissing) {
            $labels += $this->calculateMissingLabels(array_values(array_diff($deckIds, array_keys($labels))));
        }

        return $labels;
    }

    public function __construct(
        private readonly Connection $connection,
        private readonly EntityManagerInterface $entityManager,
        private readonly DeckAnalysisSnapshotService $snapshots,
        private readonly DeckBracketSignalProvider $bracketSignals,
    )
    {
    }

    /**
     * @return array{bracket:int,label:string}|null
     */
    private function bracketLabel(mixed $json): ?array
    {
        if (!is_string($json)) {
            return null;
        }

        $payload = json_decode($json, true);

        return is_array($payload) ? $this->bracketLabelFromPayload($payload) : null;
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @return array{bracket:int,label:string}|null
     */
    private function bracketLabelFromPayload(array $payload): ?array
    {
        $bracket = (int) ($payload['bracket'] ?? 0);
        $labels = [
            1 => 'Exhibition',
            2 => 'Core',
            3 => 'Upgraded',
            4 => 'Optimized',
            5 => 'cEDH',
        ];

        return isset($labels[$bracket]) ? ['bracket' => $bracket, 'label' => $labels[$bracket]] : null;
    }

    /**
     * @param list<string> $deckIds
     *
     * @return array<string,array{bracket:int,label:string}>
     */
    private function calculateMissingLabels(array $deckIds): array
    {
        if ($deckIds === []) {
            return [];
        }

        $decks = $this->entityManager->getRepository(Deck::class)->findBy(['id' => $deckIds]);
        $labels = [];
        foreach ($decks as $deck) {
            if (!$deck instanceof Deck) {
                continue;
            }

            $result = $this->snapshots->bracket($deck, $this->bracketSignals);
            $label = $this->bracketLabelFromPayload(is_array($result['bracket'] ?? null) ? $result['bracket'] : []);
            if ($label !== null) {
                $labels[$deck->id()] = $label;
            }
        }

        return $labels;
    }
}
