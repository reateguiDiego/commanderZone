<?php

namespace App\Application\Deck;

final class DeckAdvancedAnalyzerService implements DeckAdvancedAnalysisCalculatorInterface
{
    public function __construct(
        private readonly DeckCardAnalysisResolver $resolver,
        private readonly CardRoleMetricsAggregator $metricsAggregator,
        private readonly DeckAdvancedAnalysisHealthEvaluator $healthEvaluator,
        private readonly DeckComboDetector $comboDetector,
        private readonly DeckArchetypeAnalyzer $archetypeAnalyzer,
        private readonly DeckPowerAnalyzer $powerAnalyzer,
        private readonly DeckConsistencySimulator $consistencySimulator,
        private readonly DeckAdvancedIssueDetector $issueDetector,
        private readonly DeckAdvancedRecommendationBuilder $recommendationBuilder,
    ) {
    }

    /**
     * @return array<string,mixed>
     */
    public function calculate(DeckAdvancedAnalysisContext $context): array
    {
        $cards = $this->resolver->resolve($context->deck->id());
        $resolvedCards = $cards['resolvedCards'];
        $unmatchedCards = $cards['unmatchedCards'];
        $metrics = $this->metricsAggregator->aggregate($resolvedCards, $unmatchedCards);
        $comboResult = $this->comboDetector->detect(
            $this->oracleIds($resolvedCards),
            $resolvedCards,
            $this->commanderOracleIds($resolvedCards),
        );
        $archetypeResult = $this->archetypeAnalyzer->analyze($metrics, $resolvedCards, $comboResult['combos']);
        $power = $this->powerAnalyzer->analyze($metrics, $resolvedCards, $comboResult['combos']);
        $archetypes = $archetypeResult['archetypes'];
        $consistencyResult = $this->consistencySimulator->simulate($resolvedCards, $comboResult['combos'], [
            'runs' => $context->monteCarloRuns,
            'seed' => $context->monteCarloSeed,
            'monteCarloVersion' => $context->monteCarloVersion,
            'wantsEarlyInteraction' => $this->wantsEarlyInteraction($archetypes, $power),
            'comboDeckLikely' => $this->comboDeckLikely($archetypes, $comboResult['combos']),
        ]);
        $issues = [
            ...$this->issueDetector->detect($metrics, $comboResult['combos'], $archetypes, $power, $consistencyResult['consistency'], $unmatchedCards),
            ...$archetypeResult['issues'],
        ];
        $recommendations = $this->recommendationBuilder->build($issues);

        return [
            'deckId' => $context->deck->id(),
            'analyzerVersion' => $context->analyzerVersion,
            'analyzedAt' => (new \DateTimeImmutable())->format(\DateTimeInterface::ATOM),
            'summary' => [
                'status' => 'completed',
                'primaryArchetype' => $archetypes['primary'],
                'secondaryArchetypes' => $archetypes['secondary'],
                'archetypeConfidence' => $archetypes['confidence'],
                'powerBand' => $power['band'],
                'powerConfidence' => $power['confidence'],
                'mainStrengths' => $this->mainStrengths($metrics, $archetypes, $power, $comboResult['combos'], $consistencyResult['consistency']),
                'mainWarnings' => $this->mainWarnings($issues),
                'criticalIssues' => $this->criticalIssues($issues),
            ],
            'metrics' => $metrics,
            'health' => $this->healthEvaluator->evaluate($metrics, $comboResult['combos'], $consistencyResult['consistency'], $issues),
            'consistency' => $consistencyResult['consistency'],
            'combos' => $comboResult['combos'],
            'topComboCompleters' => $comboResult['topComboCompleters'],
            'archetypes' => $archetypes,
            'power' => $power,
            'issues' => $issues,
            'recommendations' => $recommendations,
            'unmatchedCards' => $unmatchedCards,
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
            if ($card['section'] !== 'commander') {
                continue;
            }
            $oracleIds[$card['oracleId']] = true;
        }

        return array_keys($oracleIds);
    }

    /**
     * @param array{roles:array<string,int>} $metrics
     * @param array{primary:string,secondary:list<string>,confidence:string,scores:list<array{archetype:string,score:int,evidence:list<string>}>} $archetypes
     * @param array{band:string,confidence:string,evidence:list<string>} $power
     * @param array<string,mixed> $combos
     * @param array<string,mixed> $consistency
     * @return list<string>
     */
    private function mainStrengths(array $metrics, array $archetypes, array $power, array $combos, array $consistency): array
    {
        $roles = $metrics['roles'];
        $strengths = [];
        if (($roles['permanentRamp'] ?? 0) >= 10) {
            $strengths[] = 'Strong permanent ramp package.';
        }
        if (($roles['draw'] ?? 0) >= 10) {
            $strengths[] = 'Strong card draw density.';
        }
        if (($roles['spotRemoval'] ?? 0) + ($roles['counterspells'] ?? 0) + ($roles['graveyardHate'] ?? 0) >= 10) {
            $strengths[] = 'Good interaction coverage.';
        }
        $topScore = $archetypes['scores'][0] ?? null;
        if (is_array($topScore) && $archetypes['primary'] !== 'mixed' && in_array($archetypes['confidence'], ['high', 'medium'], true)) {
            $strengths[] = sprintf('%s plan detected with %s confidence.', str_replace('_', ' ', $archetypes['primary']), $archetypes['confidence']);
        }
        if (($combos['winLikeCount'] ?? 0) > 0) {
            $strengths[] = ($combos['winLikeCount']).' complete win-like combo lines detected.';
        }
        $opening = is_array($consistency['openingHand'] ?? null) ? $consistency['openingHand'] : [];
        if (($opening['keepableHandRate'] ?? 0.0) >= 0.75) {
            $strengths[] = 'Good keepable hand rate.';
        }
        if ($power['evidence'] !== []) {
            $strengths[] = $power['evidence'][0];
        }

        return array_slice($strengths, 0, 4);
    }

    /**
     * @param list<array{severity:string,title?:string,message:string}> $issues
     * @return list<string>
     */
    private function mainWarnings(array $issues): array
    {
        $warnings = [];
        foreach ($issues as $issue) {
            if ($issue['severity'] !== 'warning') {
                continue;
            }
            $warnings[] = $issue['title'] ?? $issue['message'];
        }

        return array_slice(array_values(array_unique($warnings)), 0, 6);
    }

    /**
     * @param list<array{severity:string,title?:string,message:string}> $issues
     * @return list<string>
     */
    private function criticalIssues(array $issues): array
    {
        $critical = [];
        foreach ($issues as $issue) {
            if ($issue['severity'] !== 'critical') {
                continue;
            }
            $critical[] = $issue['title'] ?? $issue['message'];
        }

        return array_values(array_unique($critical));
    }

    /**
     * @param array{primary:string,secondary:list<string>} $archetypes
     * @param array{band:string} $power
     */
    private function wantsEarlyInteraction(array $archetypes, array $power): bool
    {
        return in_array($archetypes['primary'], ['control', 'stax'], true)
            || in_array($power['band'], ['high_power', 'cedh_like'], true);
    }

    /**
     * @param array{primary:string,secondary:list<string>} $archetypes
     * @param array<string,mixed> $combos
     */
    private function comboDeckLikely(array $archetypes, array $combos): bool
    {
        return $archetypes['primary'] === 'combo'
            || in_array('combo', $archetypes['secondary'], true)
            || ($combos['winLikeCount'] ?? 0) > 0
            || ($combos['partialOneMissingCount'] ?? 0) >= 3;
    }
}
