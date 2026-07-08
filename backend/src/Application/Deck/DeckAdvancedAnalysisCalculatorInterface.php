<?php

namespace App\Application\Deck;

interface DeckAdvancedAnalysisCalculatorInterface
{
    /**
     * @return array<string,mixed>
     */
    public function calculate(DeckAdvancedAnalysisContext $context): array;
}
