<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;

final class DeckAdvancedAnalysisHealthEvaluator
{
    private const SECTION_METRICS = [
        'ramp' => ['ruleMetric' => 'ramp', 'roleMetrics' => ['permanentRamp']],
        'draw' => ['ruleMetric' => 'draw', 'roleMetrics' => ['draw']],
        'interaction' => ['ruleMetric' => 'spot_removal', 'roleMetrics' => ['spotRemoval', 'creatureRemoval', 'artifactRemoval', 'enchantmentRemoval', 'counterspells', 'graveyardHate']],
        'wipes' => ['ruleMetric' => 'board_wipe', 'roleMetrics' => ['boardWipes']],
        'tutors' => ['ruleMetric' => 'tutor', 'roleMetrics' => ['trueTutors', 'typedTutors']],
        'sacrifice' => ['ruleMetric' => 'sacrifice_outlet', 'roleMetrics' => ['sacrificeOutlets']],
        'wincons' => ['ruleMetric' => 'wincon', 'roleMetrics' => ['wincons', 'combatFinishers']],
        'stax' => ['ruleMetric' => 'stax', 'roleMetrics' => ['stax', 'tax']],
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
     * @param array{roles:array<string,int>} $metrics
     * @param array<string,mixed> $combos
     * @param array<string,mixed> $consistency
     * @param list<array{code:string,severity:string}> $issues
     * @return array<string,array<string,mixed>>
     */
    public function evaluate(array $metrics, array $combos = [], array $consistency = [], array $issues = []): array
    {
        $rules = $this->genericRules();
        $health = [];
        $roles = $metrics['roles'];

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
                'value' => $value,
                'minRecommended' => $minimum,
                'source' => isset($rules[$ruleMetric]) ? 'analysis_rule' : 'fallback',
            ];
        }

        $health['combos'] = $this->comboHealth($combos, $issues);
        $health['consistency'] = $this->consistencyHealth($consistency, $issues);

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
        $status = 'unknown';
        if (($combos['completeCount'] ?? 0) > 0) {
            $status = ($combos['winLikeCount'] ?? 0) > 0 ? 'excellent' : 'good';
        } elseif (($combos['partialOneMissingCount'] ?? 0) > 0) {
            $status = 'warning';
        }
        $status = $this->sectionStatus($status, $issues, [
            'combo_pieces_without_complete_combos',
            'many_partial_combos',
            'commander_required_combo_dependency',
            'low_combo_access',
        ]);

        return [
            'status' => $status,
            'message' => $this->message('combos', $status),
            'evidence' => [
                'completeCount' => $combos['completeCount'] ?? 0,
                'partialOneMissingCount' => $combos['partialOneMissingCount'] ?? 0,
                'winLikeCount' => $combos['winLikeCount'] ?? 0,
                'commanderRequiredCount' => $combos['commanderRequiredCount'] ?? 0,
            ],
        ];
    }

    /**
     * @param array<string,mixed> $consistency
     * @param list<array{code:string,severity:string}> $issues
     * @return array<string,mixed>
     */
    private function consistencyHealth(array $consistency, array $issues): array
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
        ];
    }
}
