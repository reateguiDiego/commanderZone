<?php

namespace App\Application\Deck;

use App\Domain\Deck\Deck;

final readonly class DeckAdvancedAnalysisContext
{
    public function __construct(
        public Deck $deck,
        public string $deckHash,
        public string $analyzerVersion,
        public string $semanticDataVersion,
        public string $comboDataVersion,
        public string $rulesVersion,
        public string $monteCarloVersion,
        public int $monteCarloRuns,
        public string $monteCarloSeed,
    ) {
    }

    /**
     * @return array{
     *     deck_hash:string,
     *     analyzer_version:string,
     *     semantic_data_version:string,
     *     combo_data_version:string,
     *     rules_version:string,
     *     monte_carlo_version:string,
     *     monte_carlo_runs:int,
     *     monte_carlo_seed:string
     * }
     */
    public function snapshotColumns(): array
    {
        return [
            'deck_hash' => $this->deckHash,
            'analyzer_version' => $this->analyzerVersion,
            'semantic_data_version' => $this->semanticDataVersion,
            'combo_data_version' => $this->comboDataVersion,
            'rules_version' => $this->rulesVersion,
            'monte_carlo_version' => $this->monteCarloVersion,
            'monte_carlo_runs' => $this->monteCarloRuns,
            'monte_carlo_seed' => $this->monteCarloSeed,
        ];
    }
}
