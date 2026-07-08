<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;

final class DeckAdvancedAnalysisHealthEvaluator
{
    private const SECTION_METRICS = [
        'ramp' => ['ruleMetric' => 'ramp', 'roleMetrics' => ['permanentRamp'], 'cardMetrics' => ['permanentRamp', 'fastMana', 'burstMana', 'rituals', 'manaFixing', 'oneShotMana']],
        'draw' => ['ruleMetric' => 'draw', 'roleMetrics' => ['draw'], 'cardMetrics' => ['draw', 'cardSelection']],
        'interaction' => ['ruleMetric' => 'spot_removal', 'roleMetrics' => ['spotRemoval', 'creatureRemoval', 'artifactRemoval', 'enchantmentRemoval', 'counterspells', 'graveyardHate'], 'cardMetrics' => ['spotRemoval', 'creatureRemoval', 'artifactRemoval', 'enchantmentRemoval', 'counterspells', 'graveyardHate']],
        'wipes' => ['ruleMetric' => 'board_wipe', 'roleMetrics' => ['boardWipes'], 'cardMetrics' => ['boardWipes', 'massBounce', 'pseudoWipes', 'conditionalWipes']],
        'tutors' => ['ruleMetric' => 'tutor', 'roleMetrics' => ['trueTutors', 'typedTutors'], 'cardMetrics' => ['trueTutors', 'typedTutors', 'landTutors', 'rampSearch', 'opponentTutors']],
        'sacrifice' => ['ruleMetric' => 'sacrifice_outlet', 'roleMetrics' => ['sacrificeOutlets'], 'cardMetrics' => ['sacrificeOutlets', 'oneShotSacrifice', 'selfSacrifice', 'sacrificePayoffs']],
        'wincons' => ['ruleMetric' => 'wincon', 'roleMetrics' => ['wincons', 'combatFinishers'], 'cardMetrics' => ['wincons', 'combatFinishers', 'infectThreats', 'extraCombatEngines']],
        'stax' => ['ruleMetric' => 'stax', 'roleMetrics' => ['stax', 'tax'], 'cardMetrics' => ['stax', 'tax', 'symmetricalStaxRisk']],
    ];

    private const FALLBACK_MINIMUMS = [
        'ramp' => 8,
        'draw' => 8,
        'spot_removal' => 6,
        'board_wipe' => 2,
        'tutor' => 0,
        'sacrifice_outlet' => 3,
        'wincon' => 2,
        'stax' => 0,
    ];

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @param array{roles:array<string,int>,roleCards?:array<string,list<array<string,mixed>>>} $metrics
     * @param array<string,mixed> $combos
     * @param array<string,mixed> $consistency
     * @param list<array{code:string,severity:string}> $issues
     * @param array{detected?:bool,primaryType?:?string,confidence?:string,creatureCount?:int,supportCount?:int,commanderMatches?:bool,types?:list<array{type:string,creatureCount:int,supportCount:int,commanderMatches:bool,creatureCards:list<array<string,mixed>>,supportCards:list<array<string,mixed>>}>} $typal
     * @return array<string,array<string,mixed>>
     */
    public function evaluate(array $metrics, array $combos = [], array $consistency = [], array $issues = [], array $typal = []): array
    {
        $rules = $this->genericRules();
        $health = [];
        $roles = $metrics['roles'];
        $roleCards = is_array($metrics['roleCards'] ?? null) ? $metrics['roleCards'] : [];

        foreach (self::SECTION_METRICS as $section => $config) {
            $ruleMetric = $config['ruleMetric'];
            $minimum = $rules[$ruleMetric] ?? self::FALLBACK_MINIMUMS[$ruleMetric] ?? null;
            $value = $this->metricValue($roles, $config['roleMetrics']);
            $status = $this->sectionStatus(
                $this->status($value, $minimum),
                $issues,
                $this->issueCodesForSection($section),
            );
            $health[$section] = [
                'status' => $status,
                'message' => $this->message($section, $status),
                'evidence' => $this->sectionEvidence($section, $roles, $value, $minimum),
                'cards' => $this->sectionCards($roleCards, $config['cardMetrics']),
                'value' => $value,
                'minRecommended' => $minimum,
                'source' => isset($rules[$ruleMetric]) ? 'analysis_rule' : 'fallback',
            ];
        }

        $health['combos'] = $this->comboHealth($combos, $issues);
        $health['consistency'] = $this->consistencyHealth($consistency, $issues, $roleCards);
        $health['mana'] = $this->manaHealth(is_array($metrics['mana'] ?? null) ? $metrics['mana'] : [], $consistency, $issues, $roleCards);
        if (($typal['detected'] ?? false) === true) {
            $health['typal'] = $this->typalHealth($typal, $issues);
        }

        return $health;
    }

    /**
     * @return array<string,int>
     */
    private function genericRules(): array
    {
        $rules = [];
        foreach ($this->connection->executeQuery(
            <<<'SQL'
SELECT metric, min_recommended
FROM analysis_rule
WHERE format = 'commander'
  AND archetype IS NULL
  AND active = true
SQL,
        )->iterateAssociative() as $row) {
            $metric = is_scalar($row['metric'] ?? null) ? trim((string) $row['metric']) : '';
            $minimum = $row['min_recommended'] ?? null;
            if ($metric === '' || !is_numeric($minimum)) {
                continue;
            }

            $rules[$metric] = (int) $minimum;
        }

        return $rules;
    }

    /**
     * @param array<string,int> $roles
     * @param list<string> $metricNames
     */
    private function metricValue(array $roles, array $metricNames): int
    {
        $total = 0;
        foreach ($metricNames as $metricName) {
            $total += max(0, $roles[$metricName] ?? 0);
        }

        return $total;
    }

    private function status(int $value, ?int $minimum): string
    {
        if ($minimum === null) {
            return 'unknown';
        }

        if ($minimum <= 0) {
            return $value > 0 ? 'good' : 'unknown';
        }

        if ($value >= (int) ceil($minimum * 1.5)) {
            return 'excellent';
        }

        if ($value >= $minimum) {
            return 'good';
        }

        if ($value >= (int) ceil($minimum / 2)) {
            return 'warning';
        }

        return 'critical';
    }

    /**
     * @param list<array{code:string,severity:string}> $issues
     * @param list<string> $issueCodes
     */
    private function sectionStatus(string $baseStatus, array $issues, array $issueCodes): string
    {
        $severity = $this->highestSeverity($issues, $issueCodes);
        if ($severity === 'critical') {
            return 'critical';
        }
        if ($severity === 'warning') {
            return $baseStatus === 'critical' ? 'critical' : 'warning';
        }

        return $baseStatus;
    }

    /**
     * @param list<array{code:string,severity:string}> $issues
     * @param list<string> $issueCodes
     */
    private function highestSeverity(array $issues, array $issueCodes): ?string
    {
        $issueCodeMap = array_fill_keys($issueCodes, true);
        $highest = null;
        foreach ($issues as $issue) {
            if (!isset($issueCodeMap[$issue['code']])) {
                continue;
            }
            if ($issue['severity'] === 'critical') {
                return 'critical';
            }
            if ($issue['severity'] === 'warning') {
                $highest = 'warning';
            } elseif ($highest === null && $issue['severity'] === 'info') {
                $highest = 'info';
            }
        }

        return $highest;
    }

    /**
     * @return list<string>
     */
    private function issueCodesForSection(string $section): array
    {
        return match ($section) {
            'ramp' => ['low_permanent_ramp', 'ramp_is_mostly_one_shot', 'ramp_not_seen_early'],
            'draw' => ['low_draw', 'low_card_selection'],
            'tutors' => ['low_true_tutors_for_combo', 'tutor_count_inflated_by_ramp_search'],
            'interaction' => ['low_early_interaction'],
            'wipes' => ['low_hard_board_wipes', 'wipes_are_mostly_bounce_or_conditional'],
            'sacrifice' => ['low_real_sacrifice_outlets', 'sacrifice_is_mostly_one_shot'],
            'wincons' => ['low_wincons', 'value_without_closure'],
            'stax' => ['symmetrical_stax_risk'],
            default => [],
        };
    }

    /**
     * @param array<string,int> $roles
     * @return array<string,mixed>
     */
    private function sectionEvidence(string $section, array $roles, int $value, ?int $minimum): array
    {
        $base = [
            'value' => $value,
            'minRecommended' => $minimum,
        ];

        return match ($section) {
            'ramp' => $base + [
                'permanentRamp' => $roles['permanentRamp'] ?? 0,
                'fastMana' => $roles['fastMana'] ?? 0,
                'burstMana' => $roles['burstMana'] ?? 0,
                'rituals' => $roles['rituals'] ?? 0,
                'oneShotMana' => $roles['oneShotMana'] ?? 0,
            ],
            'draw' => $base + [
                'draw' => $roles['draw'] ?? 0,
                'cardSelection' => $roles['cardSelection'] ?? 0,
            ],
            'tutors' => $base + [
                'trueTutors' => $roles['trueTutors'] ?? 0,
                'typedTutors' => $roles['typedTutors'] ?? 0,
                'landTutors' => $roles['landTutors'] ?? 0,
                'rampSearch' => $roles['rampSearch'] ?? 0,
            ],
            'interaction' => $base + [
                'spotRemoval' => $roles['spotRemoval'] ?? 0,
                'counterspells' => $roles['counterspells'] ?? 0,
                'graveyardHate' => $roles['graveyardHate'] ?? 0,
            ],
            'wipes' => $base + [
                'boardWipes' => $roles['boardWipes'] ?? 0,
                'massBounce' => $roles['massBounce'] ?? 0,
                'pseudoWipes' => $roles['pseudoWipes'] ?? 0,
                'conditionalWipes' => $roles['conditionalWipes'] ?? 0,
            ],
            'sacrifice' => $base + [
                'sacrificeOutlets' => $roles['sacrificeOutlets'] ?? 0,
                'oneShotSacrifice' => $roles['oneShotSacrifice'] ?? 0,
                'selfSacrifice' => $roles['selfSacrifice'] ?? 0,
                'sacrificePayoffs' => $roles['sacrificePayoffs'] ?? 0,
            ],
            'wincons' => $base + [
                'wincons' => $roles['wincons'] ?? 0,
                'combatFinishers' => $roles['combatFinishers'] ?? 0,
                'infectThreats' => $roles['infectThreats'] ?? 0,
            ],
            'stax' => $base + [
                'stax' => $roles['stax'] ?? 0,
                'tax' => $roles['tax'] ?? 0,
                'symmetricalStaxRisk' => $roles['symmetricalStaxRisk'] ?? 0,
            ],
            default => $base,
        };
    }

    private function message(string $section, string $status): string
    {
        $label = match ($section) {
            'wincons' => 'Win conditions',
            'combos' => 'Combo package',
            default => ucfirst($section),
        };

        return match ($status) {
            'excellent' => $label.' looks strong.',
            'good' => $label.' looks functional.',
            'warning' => $label.' needs review.',
            'critical' => $label.' is likely under-supported.',
            default => $label.' cannot be evaluated confidently.',
        };
    }

    /**
     * @param array<string,mixed> $combos
     * @param list<array{code:string,severity:string}> $issues
     * @return array<string,mixed>
     */
    private function comboHealth(array $combos, array $issues): array
    {
        $status = 'good';
        if (($combos['completeCount'] ?? 0) > 0) {
            $status = ($combos['winLikeCount'] ?? 0) > 0 ? 'excellent' : 'good';
        }
        $status = $this->sectionStatus($status, $issues, [
            'combo_pieces_without_complete_combos',
            'many_partial_combos',
            'commander_required_combo_dependency',
            'low_combo_access',
        ]);

        return [
            'status' => $status,
            'message' => ($combos['completeCount'] ?? 0) === 0 && ($combos['partialOneMissingCount'] ?? 0) === 0
                ? 'No combo package detected.'
                : $this->message('combos', $status),
            'evidence' => [
                'completeCount' => $combos['completeCount'] ?? 0,
                'partialOneMissingCount' => $combos['partialOneMissingCount'] ?? 0,
                'winLikeCount' => $combos['winLikeCount'] ?? 0,
                'commanderRequiredCount' => $combos['commanderRequiredCount'] ?? 0,
            ],
            'cards' => $this->comboCards($combos),
        ];
    }

    /**
     * @param array<string,list<array<string,mixed>>> $roleCards
     * @param list<string> $metrics
     * @return list<array<string,mixed>>
     */
    private function sectionCards(array $roleCards, array $metrics): array
    {
        $cards = [];
        foreach ($metrics as $metric) {
            foreach ($roleCards[$metric] ?? [] as $card) {
                $key = $this->cardReferenceKey($card);
                if ($key === '') {
                    continue;
                }

                $cards[$key] ??= $card + ['matchedMetrics' => []];
                $matchedMetrics = is_array($cards[$key]['matchedMetrics'] ?? null) ? $cards[$key]['matchedMetrics'] : [];
                if (!in_array($metric, $matchedMetrics, true)) {
                    $matchedMetrics[] = $metric;
                }
                $cards[$key]['matchedMetrics'] = $matchedMetrics;
            }
        }

        return array_values($cards);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function cardReferenceKey(array $card): string
    {
        foreach (['deckCardId', 'cardId', 'oracleId', 'name'] as $key) {
            $value = $card[$key] ?? null;
            if (is_scalar($value) && trim((string) $value) !== '') {
                return (string) $value;
            }
        }

        return '';
    }

    /**
     * @param array<string,mixed> $consistency
     * @param list<array{code:string,severity:string}> $issues
     * @return array<string,mixed>
     */
    private function consistencyHealth(array $consistency, array $issues, array $roleCards): array
    {
        $opening = is_array($consistency['openingHand'] ?? null) ? $consistency['openingHand'] : [];
        $keepable = is_numeric($opening['keepableHandRate'] ?? null) ? (float) $opening['keepableHandRate'] : null;
        $status = 'unknown';
        if ($keepable !== null) {
            $status = $keepable >= 0.75 ? 'good' : ($keepable >= 0.60 ? 'warning' : 'critical');
        }
        $status = $this->sectionStatus($status, $issues, [
            'low_keepable_hand_rate',
            'high_mulligan_pressure',
            'too_many_low_land_openers',
            'too_many_flooded_openers',
            'low_early_development',
            'low_early_interaction',
            'ramp_not_seen_early',
            'low_combo_access',
        ]);

        return [
            'status' => $status,
            'message' => $this->message('consistency', $status),
            'evidence' => [
                'keepableHandRate' => $opening['keepableHandRate'] ?? null,
                'zeroOrOneLandRate' => $opening['zeroOrOneLandRate'] ?? null,
                'fivePlusLandsRate' => $opening['fivePlusLandsRate'] ?? null,
                'earlyPlayInOpeningRate' => $opening['earlyPlayInOpeningRate'] ?? null,
            ],
            'cards' => $this->sectionCards($roleCards, [
                'lands',
                'permanentRamp',
                'draw',
                'cardSelection',
                'spotRemoval',
                'counterspells',
                'trueTutors',
                'wincons',
                'comboPieces',
            ]),
        ];
    }

    /**
     * @param array<string,mixed> $mana
     * @param array<string,mixed> $consistency
     * @param list<array{code:string,severity:string}> $issues
     * @return array<string,mixed>
     */
    private function manaHealth(array $mana, array $consistency, array $issues, array $roleCards): array
    {
        if ($mana === []) {
            return [
                'status' => 'unknown',
                'message' => 'Mana base cannot be evaluated confidently.',
                'evidence' => [
                    'lands' => null,
                    'coloredSources' => [],
                    'tappedLands' => null,
                    'deadFetchlands' => null,
                    'commanderCastability' => 'unknown',
                    'landCycleRisks' => [],
                ],
                'cards' => [],
            ];
        }

        $manaIssueCodes = [
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
        ];

        $status = $this->sectionStatus('good', $issues, $manaIssueCodes);
        if ($status === 'excellent') {
            $status = 'good';
        }

        $lands = is_array($mana['lands'] ?? null) ? $mana['lands'] : [];
        $sources = is_array($mana['sources'] ?? null) ? $mana['sources'] : [];
        $fetchlands = is_array($mana['fetchlands'] ?? null) ? $mana['fetchlands'] : [];
        $requirements = is_array($mana['requirements'] ?? null) ? $mana['requirements'] : [];
        $cycle = is_array($mana['landCycleAnalysis'] ?? null) ? $mana['landCycleAnalysis'] : [];
        $opening = is_array($consistency['openingHand'] ?? null) ? $consistency['openingHand'] : [];

        return [
            'status' => $status,
            'message' => match ($status) {
                'good' => 'Mana base looks functional.',
                'warning' => 'Mana base needs review.',
                'critical' => 'Mana base has serious color or speed pressure.',
                default => 'Mana base cannot be evaluated confidently.',
            },
            'evidence' => [
                'lands' => $lands['total'] ?? null,
                'coloredSources' => array_intersect_key($sources, array_flip(['white', 'blue', 'black', 'red', 'green'])),
                'tappedLands' => $lands['tappedLands'] ?? null,
                'deadFetchlands' => $fetchlands['deadFetchlands'] ?? null,
                'commanderCastability' => $this->commanderCastabilityStatus(is_array($requirements['commanderCastability'] ?? null) ? $requirements['commanderCastability'] : []),
                'landCycleRisks' => array_filter([
                    'fetchSynergyScore' => $cycle['fetchSynergyScore'] ?? null,
                    'checklandSupport' => $cycle['checklandSupport'] ?? null,
                    'tappedLandPressure' => $cycle['tappedLandPressure'] ?? null,
                    'colorlessUtilityPressure' => $cycle['colorlessUtilityPressure'] ?? null,
                    'pathwayColorChoicePressure' => $cycle['pathwayColorChoicePressure'] ?? null,
                    'filterlandInputPressure' => $cycle['filterlandInputPressure'] ?? null,
                    'bounceLandTempoPressure' => $cycle['bounceLandTempoPressure'] ?? null,
                ], static fn (mixed $value): bool => $value !== null && $value !== 'unknown'),
                'keepableManaRate' => $opening['keepableManaRate'] ?? null,
                'hasAllEarlyColorsRate' => $opening['hasAllEarlyColorsRate'] ?? null,
            ],
            'cards' => $this->sectionCards($roleCards, [
                'lands',
                'manaFixing',
                'colorFixing',
                'fetchlands',
                'landRamp',
                'manaRocks',
                'manaDorks',
                'permanentRamp',
            ]),
        ];
    }

    /**
     * @param array<string,mixed> $combos
     * @return list<array<string,mixed>>
     */
    private function comboCards(array $combos): array
    {
        $cards = [];
        foreach ([
            'complete' => 'completeCombos',
            'partialOneMissing' => 'partialOneMissing',
            'partialTwoMissing' => 'partialTwoMissing',
        ] as $group => $matchedMetric) {
            foreach (($combos[$group] ?? []) as $combo) {
                if (!is_array($combo)) {
                    continue;
                }

                foreach ([...($combo['cards'] ?? []), ...($combo['missingCards'] ?? [])] as $card) {
                    if (!is_array($card)) {
                        continue;
                    }

                    $key = $this->cardReferenceKey($card);
                    if ($key === '') {
                        continue;
                    }

                    $cards[$key] ??= $card + ['matchedMetrics' => []];
                    $matchedMetrics = is_array($cards[$key]['matchedMetrics'] ?? null) ? $cards[$key]['matchedMetrics'] : [];
                    if (!in_array($matchedMetric, $matchedMetrics, true)) {
                        $matchedMetrics[] = $matchedMetric;
                    }
                    $cards[$key]['matchedMetrics'] = $matchedMetrics;
                }
            }
        }

        return array_values($cards);
    }

    /**
     * @param array<string,array<string,mixed>> $commanderCastability
     */
    private function commanderCastabilityStatus(array $commanderCastability): string
    {
        $status = 'unknown';
        foreach ($commanderCastability as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $entryStatus = (string) ($entry['status'] ?? 'unknown');
            if ($entryStatus === 'critical') {
                return 'critical';
            }
            if ($entryStatus === 'warning') {
                $status = 'warning';
            } elseif ($status === 'unknown' && $entryStatus === 'good') {
                $status = 'good';
            }
        }

        return $status;
    }

    /**
     * @param array{primaryType?:?string,confidence?:string,creatureCount?:int,supportCount?:int,commanderMatches?:bool,types?:list<array{type:string,creatureCount:int,supportCount:int,commanderMatches:bool,creatureCards:list<array<string,mixed>>,supportCards:list<array<string,mixed>>}>} $typal
     * @param list<array{code:string,severity:string}> $issues
     * @return array<string,mixed>
     */
    private function typalHealth(array $typal, array $issues): array
    {
        $primaryType = is_string($typal['primaryType'] ?? null) ? $typal['primaryType'] : 'Tribal';
        $primary = null;
        foreach ($typal['types'] ?? [] as $type) {
            if (($type['type'] ?? null) === $primaryType) {
                $primary = $type;
                break;
            }
        }
        $primary ??= $typal['types'][0] ?? null;
        $creatureCards = is_array($primary['creatureCards'] ?? null) ? $primary['creatureCards'] : [];
        $supportCards = is_array($primary['supportCards'] ?? null) ? $primary['supportCards'] : [];
        $status = match ($typal['confidence'] ?? 'low') {
            'high' => 'excellent',
            'medium' => 'good',
            default => 'warning',
        };
        $status = $this->sectionStatus($status, $issues, [
            'typal_density_without_support',
            'typal_support_without_density',
            'typal_commander_mismatch',
        ]);

        return [
            'status' => $status,
            'message' => sprintf('%s tribal identity detected.', $primaryType),
            'evidence' => [
                'primaryType' => $primaryType,
                'creatureCount' => $typal['creatureCount'] ?? 0,
                'supportCount' => $typal['supportCount'] ?? 0,
                'commanderMatches' => $typal['commanderMatches'] ?? false,
            ],
            'cards' => $this->uniqueCardReferences([...$creatureCards, ...$supportCards]),
            'value' => $typal['creatureCount'] ?? 0,
            'minRecommended' => null,
            'source' => 'typal_analysis',
        ];
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @return list<array<string,mixed>>
     */
    private function uniqueCardReferences(array $cards): array
    {
        $unique = [];
        foreach ($cards as $card) {
            $key = $this->cardReferenceKey($card);
            if ($key === '') {
                continue;
            }
            $unique[$key] = $card;
        }

        return array_values($unique);
    }
}
