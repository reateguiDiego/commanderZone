<?php

namespace App\Application\Deck;

use App\Domain\Deck\Deck;

final class DeckBracketSignalProvider
{
    public function __construct(
        private readonly DeckCardAnalysisResolver $resolver,
        private readonly CardRoleMetricsAggregator $metricsAggregator,
        private readonly DeckComboDetector $comboDetector,
        private readonly DeckArchetypeAnalyzer $archetypeAnalyzer,
        private readonly DeckManaSourceAnalyzer $manaSourceAnalyzer,
        private readonly DeckBracketSignalDetector $signalDetector,
        private readonly DeckBracketClassifier $classifier,
    ) {
    }

    /**
     * @return array<string,mixed>
     */
    public function signals(Deck $deck): array
    {
        return $this->analysis($deck)['signals'];
    }

    /**
     * @return array{signals:array<string,mixed>,bracket:array<string,mixed>}
     */
    public function analysis(Deck $deck): array
    {
        $resolution = $this->resolver->resolve($deck->id());
        $resolvedCards = $resolution['resolvedCards'];
        $bracketCards = $this->bracketEligibleCards($resolvedCards);
        $unmatchedCards = $resolution['unmatchedCards'];
        $metrics = $this->metricsAggregator->aggregate($bracketCards, $unmatchedCards);
        $mana = $this->manaSourceAnalyzer->analyze($deck->id(), $bracketCards);
        $combos = $this->comboDetector->detect(
            $this->oracleIds($bracketCards),
            $bracketCards,
            $this->commanderOracleIds($bracketCards),
            $this->deckColorIdentity($bracketCards),
        )['combos'];
        $archetypes = $this->archetypeAnalyzer->analyze($metrics, $bracketCards, $combos)['archetypes'];
        $signals = $this->signalDetector->detect($bracketCards, $metrics, $combos, $mana, $archetypes);

        return [
            'signals' => $signals,
            'bracket' => $this->classifier->classify($signals),
        ];
    }

    /**
     * @param list<array{oracleId:string}> $resolvedCards
     * @return list<string>
     */
    private function oracleIds(array $resolvedCards): array
    {
        $oracleIds = [];
        foreach ($resolvedCards as $card) {
            $oracleIds[$card['oracleId']] = true;
        }

        return array_keys($oracleIds);
    }

    /**
     * @param list<array{oracleId:string,section:string}> $resolvedCards
     * @return list<string>
     */
    private function commanderOracleIds(array $resolvedCards): array
    {
        $oracleIds = [];
        foreach ($resolvedCards as $card) {
            if ($card['section'] === 'commander') {
                $oracleIds[$card['oracleId']] = true;
            }
        }

        return array_keys($oracleIds);
    }

    /**
     * @param list<array{section:string,analysisProfile:array<string,mixed>}> $resolvedCards
     * @return list<string>
     */
    private function deckColorIdentity(array $resolvedCards): array
    {
        $commanderColors = [];
        $deckColors = [];
        foreach ($resolvedCards as $card) {
            foreach ($this->colorIdentityFromProfile($card['analysisProfile']) as $color) {
                $deckColors[$color] = true;
                if ($card['section'] === 'commander') {
                    $commanderColors[$color] = true;
                }
            }
        }

        $identity = $commanderColors !== [] ? array_keys($commanderColors) : array_keys($deckColors);
        sort($identity, SORT_STRING);

        return $identity;
    }

    /**
     * @param array<string,mixed> $profile
     * @return list<string>
     */
    private function colorIdentityFromProfile(array $profile): array
    {
        $colors = [];
        foreach (($profile['colorIdentity'] ?? []) as $color) {
            if (!is_scalar($color)) {
                continue;
            }
            $normalized = mb_strtoupper(trim((string) $color));
            if (in_array($normalized, ['W', 'U', 'B', 'R', 'G'], true)) {
                $colors[$normalized] = true;
            }
        }

        return array_keys($colors);
    }

    /**
     * @param list<array<string,mixed>> $resolvedCards
     * @return list<array<string,mixed>>
     */
    private function bracketEligibleCards(array $resolvedCards): array
    {
        return array_values(array_filter($resolvedCards, fn (array $card): bool => $this->isCommanderLegal($card)));
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isCommanderLegal(array $card): bool
    {
        $profile = is_array($card['analysisProfile'] ?? null) ? $card['analysisProfile'] : [];
        if (!array_key_exists('commanderLegal', $profile) && !array_key_exists('commanderBanned', $profile)) {
            return true;
        }

        return ($profile['commanderLegal'] ?? false) === true
            && ($profile['commanderBanned'] ?? false) !== true;
    }
}
