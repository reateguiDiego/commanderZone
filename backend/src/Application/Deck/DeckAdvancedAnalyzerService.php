<?php

namespace App\Application\Deck;

final class DeckAdvancedAnalyzerService implements DeckAdvancedAnalysisCalculatorInterface
{
    public function __construct(
        private readonly DeckCardAnalysisResolver $resolver,
        private readonly CardRoleMetricsAggregator $metricsAggregator,
        private readonly DeckAdvancedAnalysisHealthEvaluator $healthEvaluator,
        private readonly DeckComboDetector $comboDetector,
        private readonly DeckTypalAnalyzer $typalAnalyzer,
        private readonly DeckArchetypeAnalyzer $archetypeAnalyzer,
        private readonly DeckPowerAnalyzer $powerAnalyzer,
        private readonly DeckManaSourceAnalyzer $manaSourceAnalyzer,
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
        $metrics['mana'] = $this->manaSourceAnalyzer->analyze($context->deck->id(), $resolvedCards);
        $comboResult = $this->comboDetector->detect(
            $this->oracleIds($resolvedCards),
            $resolvedCards,
            $this->commanderOracleIds($resolvedCards),
            $this->deckColorIdentity($resolvedCards),
        );
        $typal = $this->typalAnalyzer->analyze($resolvedCards);
        $archetypeResult = $this->archetypeAnalyzer->analyze($metrics, $resolvedCards, $comboResult['combos'], $typal);
        $power = $this->powerAnalyzer->analyze($metrics, $resolvedCards, $comboResult['combos']);
        $archetypes = $archetypeResult['archetypes'];
        $consistencyResult = $this->consistencySimulator->simulate($resolvedCards, $comboResult['combos'], [
            'runs' => $context->monteCarloRuns,
            'seed' => $context->monteCarloSeed,
            'monteCarloVersion' => $context->monteCarloVersion,
            'mana' => $metrics['mana'],
            'wantsEarlyInteraction' => $this->wantsEarlyInteraction($archetypes, $power),
            'comboDeckLikely' => $this->comboDeckLikely($archetypes, $comboResult['combos']),
        ]);
        $issues = [
            ...$this->issueDetector->detect($metrics, $comboResult['combos'], $archetypes, $power, $consistencyResult['consistency'], $unmatchedCards, $typal),
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
                'primaryTypalType' => $typal['primaryType'],
                'secondaryArchetypes' => $archetypes['secondary'],
                'archetypeConfidence' => $archetypes['confidence'],
                'archetypeExplanations' => $this->archetypeExplanations($archetypes),
                'mainStrengths' => $this->mainStrengths($metrics, $archetypes, $power, $comboResult['combos'], $consistencyResult['consistency'], $typal),
                'mainWarnings' => $this->mainWarnings($issues),
                'criticalIssues' => $this->criticalIssues($issues),
            ],
            'metrics' => $metrics,
            'health' => $this->healthEvaluator->evaluate($metrics, $comboResult['combos'], $consistencyResult['consistency'], $issues, $typal),
            'consistency' => $consistencyResult['consistency'],
            'combos' => $comboResult['combos'],
            'topComboCompleters' => $comboResult['topComboCompleters'],
            'archetypes' => $archetypes,
            'typal' => $typal,
            'power' => $this->publicPowerSignals($power),
            'issues' => $issues,
            'recommendations' => $recommendations,
            'unmatchedCards' => $unmatchedCards,
        ];
    }

    /**
     * @param array{primary:string,secondary:list<string>,confidence:string,scores:list<array{archetype:string,score:int,evidence:list<string>,cards?:list<array<string,mixed>>}>} $archetypes
     * @return list<array{archetype:string,reasonKey:string,score:int,cards:list<array<string,mixed>>}>
     */
    private function archetypeExplanations(array $archetypes): array
    {
        $scoresByArchetype = [];
        $cardsByArchetype = [];
        foreach ($archetypes['scores'] as $score) {
            $scoresByArchetype[$score['archetype']] = $score['score'];
            $cardsByArchetype[$score['archetype']] = is_array($score['cards'] ?? null) ? $score['cards'] : [];
        }

        $topScore = $archetypes['scores'][0]['score'] ?? 0;
        $topCards = is_array($archetypes['scores'][0]['cards'] ?? null) ? $archetypes['scores'][0]['cards'] : [];
        $items = [
            [
                'archetype' => $archetypes['primary'],
                'reasonKey' => $this->archetypeReasonKey($archetypes['primary']),
                'score' => $archetypes['primary'] === 'mixed' ? $topScore : ($scoresByArchetype[$archetypes['primary']] ?? 0),
                'cards' => $archetypes['primary'] === 'mixed' ? $topCards : ($cardsByArchetype[$archetypes['primary']] ?? []),
            ],
        ];

        foreach ($archetypes['secondary'] as $secondary) {
            $items[] = [
                'archetype' => $secondary,
                'reasonKey' => $this->archetypeReasonKey($secondary),
                'score' => $scoresByArchetype[$secondary] ?? 0,
                'cards' => $cardsByArchetype[$secondary] ?? [],
            ];
        }

        return $items;
    }

    private function archetypeReasonKey(string $archetype): string
    {
        return preg_match('/^[a-z0-9_]+$/', $archetype) === 1 ? $archetype : 'generic';
    }

    /**
     * @param array{band:string,confidence:string,signals:array<string,int>,signalCards:array<string,list<array<string,mixed>>>,evidence:list<string>,notes:list<string>} $power
     * @return array{signals:array<string,int>,signalCards:array<string,list<array<string,mixed>>>,evidence:list<string>,notes:list<string>}
     */
    private function publicPowerSignals(array $power): array
    {
        return [
            'signals' => $power['signals'],
            'signalCards' => $power['signalCards'],
            'evidence' => $power['evidence'],
            'notes' => $power['notes'],
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
     * @param list<array{section:string,analysisProfile:array<string,mixed>}> $resolvedCards
     * @return list<string>
     */
    private function deckColorIdentity(array $resolvedCards): array
    {
        $commanderColors = [];
        $deckColors = [];

        foreach ($resolvedCards as $card) {
            $colors = $this->colorIdentityFromProfile($card['analysisProfile']);
            foreach ($colors as $color) {
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
     * @param array{roles:array<string,int>} $metrics
     * @param array{primary:string,secondary:list<string>,confidence:string,scores:list<array{archetype:string,score:int,evidence:list<string>}>} $archetypes
     * @param array{band:string,confidence:string,evidence:list<string>} $power
     * @param array<string,mixed> $combos
     * @param array<string,mixed> $consistency
     * @param array{detected:bool,primaryType:?string,confidence:string,creatureCount:int,supportCount:int,commanderMatches:bool} $typal
     * @return list<string>
     */
    private function mainStrengths(array $metrics, array $archetypes, array $power, array $combos, array $consistency, array $typal): array
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
        if ($typal['detected'] && $typal['primaryType'] !== null) {
            $strengths[] = sprintf('%s tribal identity detected.', $typal['primaryType']);
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
        $manaWarnings = [];
        foreach ($issues as $issue) {
            if (!in_array($issue['severity'], ['warning', 'critical'], true)) {
                continue;
            }
            $title = $issue['title'] ?? $issue['message'];
            if ($this->isManaIssueCode((string) ($issue['code'] ?? ''))) {
                $manaWarnings[] = $title;

                continue;
            }
            $warnings[] = $title;
        }

        return array_slice(array_values(array_unique([...$manaWarnings, ...$warnings])), 0, 6);
    }

    private function isManaIssueCode(string $code): bool
    {
        return in_array($code, [
            'low_colored_sources',
            'weak_primary_color_sources',
            'low_early_color_access',
            'low_commander_castability',
            'commander_color_bottleneck',
            'too_many_tapped_lands',
            'too_many_slow_lands',
            'colorless_land_pressure',
            'fetchlands_without_targets',
            'fetchlands_mostly_tapped_targets',
            'typed_land_density_low_for_fetches',
            'typed_land_density_low_for_checklands',
            'checklands_not_supported',
            'filterlands_need_input_sources',
            'pathways_create_color_choice_pressure',
            'bounce_lands_tempo_risk',
            'painland_life_pressure',
            'ramp_does_not_fix_colors',
            'rituals_not_stable_ramp',
            'cost_reducers_not_mana_sources',
        ], true);
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
