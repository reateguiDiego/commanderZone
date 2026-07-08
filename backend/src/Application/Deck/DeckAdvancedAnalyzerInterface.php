<?php

namespace App\Application\Deck;

use App\Domain\Deck\Deck;

interface DeckAdvancedAnalyzerInterface
{
    /**
     * @return array<string,mixed>
     */
    public function analyze(Deck $deck, string $deckHash, int $monteCarloRuns, string $monteCarloSeed): array;
}
