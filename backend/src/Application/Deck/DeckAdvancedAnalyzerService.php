<?php

namespace App\Application\Deck;

use App\Domain\Deck\Deck;

final class DeckAdvancedAnalyzerService implements DeckAdvancedAnalyzerInterface
{
    public function __construct(private readonly DeckAnalysisDeckCardResolver $deckCardResolver)
    {
    }

    public function analyze(Deck $deck, string $deckHash, int $monteCarloRuns, string $monteCarloSeed): array
    {
        $resolved = $this->deckCardResolver->resolve($deck->id());
        $mainCount = 0;
        $commanderCount = 0;

        foreach ($resolved['resolved'] as $card) {
            if ($card['section'] === 'main') {
                $mainCount += $card['quantity'];
            }
            if ($card['section'] === 'commander') {
                $commanderCount += $card['quantity'];
            }
        }

        return [
            'deckId' => $deck->id(),
            'deckHash' => $deckHash,
            'analyzerVersion' => DeckAdvancedAnalyzerVersion::CURRENT,
            'cards' => [
                'resolved' => $resolved['resolved'],
                'unmatched' => $resolved['unmatched'],
                'resolvedCount' => count($resolved['resolved']),
                'unmatchedCount' => count($resolved['unmatched']),
            ],
            'summary' => [
                'mainCount' => $mainCount,
                'commanderCount' => $commanderCount,
            ],
            'monteCarlo' => [
                'version' => DeckAdvancedAnalyzerVersion::MONTE_CARLO,
                'runs' => $monteCarloRuns,
                'seed' => $monteCarloSeed,
            ],
        ];
    }
}
