<?php

namespace App\Application\Deck;

final class DeckArchetypeAnalyzer
{
    private const ARCHETYPES = [
        'combo',
        'aristocrats',
        'reanimator',
        'control',
        'stax',
        'blink',
        'tokens',
        'typal',
        'voltron_infect',
        'spellslinger',
        'artifact',
        'enchantress',
        'landfall',
        'theft',
        'discard',
        'mill',
        'lifegain',
    ];

    /**
     * @param array{roles:array<string,int>} $metrics
     * @param list<array{quantity:int,analysisProfile:array<string,mixed>}> $resolvedCards
     * @param array<string,mixed> $combos
     * @param array{detected:bool,primaryType:?string,confidence:string,creatureCount:int,supportCount:int,commanderMatches:bool} $typal
     * @return array{
     *     archetypes:array{primary:string,secondary:list<string>,confidence:string,scores:list<array{archetype:string,score:int,evidence:list<string>}>},
     *     issues:list<array{code:string,severity:string,title:string,message:string,evidence:array<string,mixed>,suggestedActionType:string}>
     * }
     */
    public function analyze(array $metrics, array $resolvedCards, array $combos, array $typal = []): array
    {
        $roles = $metrics['roles'];
        $profileSignals = $this->profileSignals($resolvedCards);
        $scores = [
            $this->comboScore($roles, $profileSignals, $combos),
            $this->aristocratsScore($roles),
            $this->reanimatorScore($roles, $profileSignals),
            $this->controlScore($roles),
            $this->staxScore($roles),
            $this->weightedScore('blink', $profileSignals, $roles),
            $this->tokensScore($roles),
            $this->typalScore($typal),
            $this->voltronInfectScore($roles, $profileSignals),
            $this->spellslingerScore($roles, $profileSignals),
            $this->weightedScore('artifact', $profileSignals, $roles),
            $this->weightedScore('enchantress', $profileSignals, $roles),
            $this->weightedScore('landfall', $profileSignals, $roles),
            $this->weightedScore('theft', $profileSignals, $roles),
            $this->weightedScore('discard', $profileSignals, $roles),
            $this->weightedScore('mill', $profileSignals, $roles),
            $this->weightedScore('lifegain', $profileSignals, $roles),
        ];

        usort($scores, static fn (array $left, array $right): int => [$right['score'], $left['archetype']] <=> [$left['score'], $right['archetype']]);

        $top = $scores[0] ?? ['archetype' => 'mixed', 'score' => 0, 'evidence' => []];
        $second = $scores[1] ?? ['score' => 0];
        $fragmented = $this->isFragmented($top, $second, $scores);
        $primary = $fragmented ? 'mixed' : $top['archetype'];
        $confidence = $this->confidence($top['score'], $second['score'], $fragmented);
        $secondary = $this->secondaryArchetypes($scores, $primary);

        $issues = [];
        if ($fragmented) {
            $issues[] = [
                'code' => 'fragmented_plan',
                'severity' => 'warning',
                'title' => 'Fragmented plan',
                'message' => 'The deck shows several competing archetype signals without a clearly dominant plan.',
                'evidence' => [
                    'topArchetype' => $top['archetype'],
                    'topScore' => $top['score'],
                    'secondScore' => $second['score'] ?? 0,
                ],
                'suggestedActionType' => 'review_package',
            ];
        }

        return [
            'archetypes' => [
                'primary' => $primary,
                'secondary' => $secondary,
                'confidence' => $confidence,
                'scores' => array_slice($scores, 0, 8),
            ],
            'issues' => $issues,
        ];
    }

    /**
     * @param array<string,int> $roles
     * @param array<string,int|float> $signals
     * @param array<string,mixed> $combos
     * @return array{archetype:string,score:int,evidence:list<string>}
     */
    private function comboScore(array $roles, array $signals, array $combos): array
    {
        $score = 0;
        $evidence = [];
        $completeWinLike = (int) ($combos['winLikeCount'] ?? 0);
        $completeInfinite = (int) (($combos['infiniteManaCount'] ?? 0) + ($combos['infiniteDamageCount'] ?? 0) + ($combos['infiniteTokensCount'] ?? 0));
        $partialOneMissing = (int) ($combos['partialOneMissingCount'] ?? 0);

        $this->add($score, $evidence, min(40, $completeWinLike * 24), $completeWinLike.' complete win-like combos');
        $this->add($score, $evidence, min(24, $completeInfinite * 12), $completeInfinite.' complete infinite combos');
        $this->add($score, $evidence, min(16, $partialOneMissing * 4), $partialOneMissing.' one-card-away combo lines');
        $this->add($score, $evidence, min(12, $signals['compactWincons'] * 6), $signals['compactWincons'].' compact wincons');
        $this->add($score, $evidence, min(12, $signals['efficientTutors'] * 3), $signals['efficientTutors'].' efficient tutors');
        $this->add($score, $evidence, min(8, $signals['manaPositiveComboPieces'] * 4), $signals['manaPositiveComboPieces'].' mana-positive combo pieces');
        $this->add($score, $evidence, min(8, (($signals['freeInteraction'] ?? 0) + ($roles['protection'] ?? 0)) * 2), (($signals['freeInteraction'] ?? 0) + ($roles['protection'] ?? 0)).' protection/free interaction pieces');
        $this->add($score, $evidence, min(6, ($roles['comboPieces'] ?? 0)), ($roles['comboPieces'] ?? 0).' raw combo-piece cards');

        if (($roles['comboPieces'] ?? 0) >= 6 && $completeWinLike === 0 && $partialOneMissing <= 1) {
            $score = min($score, 39);
            $evidence[] = 'combo-piece density exists, but no complete win-like line was detected';
        }

        return $this->score('combo', $score, $evidence);
    }

    /**
     * @param array<string,int> $roles
     * @return array{archetype:string,score:int,evidence:list<string>}
     */
    private function aristocratsScore(array $roles): array
    {
        $realOutlets = $roles['sacrificeOutlets'] ?? 0;
        $payoffs = ($roles['sacrificePayoffs'] ?? 0) + min(4, $roles['payoffs'] ?? 0);
        $fodder = ($roles['tokenMakers'] ?? 0) + ($roles['recursion'] ?? 0);
        $score = min(30, $realOutlets * 8) + min(28, $payoffs * 6) + min(22, $fodder * 3);
        $evidence = [
            $realOutlets.' real sacrifice outlets',
            $payoffs.' sacrifice/payoff cards',
            $fodder.' token or recursion support cards',
        ];

        if ($realOutlets < 2 || $payoffs < 2 || $fodder < 2) {
            $score = min($score, 44);
            if (($roles['oneShotSacrifice'] ?? 0) + ($roles['selfSacrifice'] ?? 0) > $realOutlets) {
                $evidence[] = 'one-shot/self-sacrifice cards do not replace real outlets';
            }
        }

        return $this->score('aristocrats', $score, $evidence);
    }

    /**
     * @param array<string,int> $roles
     * @param array<string,int|float> $signals
     * @return array{archetype:string,score:int,evidence:list<string>}
     */
    private function reanimatorScore(array $roles, array $signals): array
    {
        $reanimation = $roles['reanimation'] ?? 0;
        $graveyard = ($roles['recursion'] ?? 0) + ($roles['discard'] ?? 0) + (int) ($signals['graveyard'] ?? 0);
        $largeThreats = (int) ($signals['largeThreats'] ?? 0);
        $score = min(36, $reanimation * 9) + min(22, $graveyard * 4) + min(16, $largeThreats * 4);
        $evidence = [$reanimation.' reanimation cards', $graveyard.' graveyard setup/support cards'];
        if ($largeThreats > 0) {
            $evidence[] = $largeThreats.' large threats';
        }
        if ($reanimation < 2 || $graveyard < 2) {
            $score = min($score, 42);
        }

        return $this->score('reanimator', $score, $evidence);
    }

    /**
     * @param array<string,int> $roles
     * @return array{archetype:string,score:int,evidence:list<string>}
     */
    private function controlScore(array $roles): array
    {
        $interaction = ($roles['spotRemoval'] ?? 0) + ($roles['creatureRemoval'] ?? 0) + ($roles['artifactRemoval'] ?? 0) + ($roles['enchantmentRemoval'] ?? 0);
        $counterspells = $roles['counterspells'] ?? 0;
        $wipes = $roles['boardWipes'] ?? 0;
        $draw = ($roles['draw'] ?? 0) + ($roles['cardSelection'] ?? 0);
        $score = min(26, $counterspells * 5) + min(26, $interaction * 3) + min(18, $wipes * 6) + min(18, $draw * 2) + min(8, (($roles['stax'] ?? 0) + ($roles['tax'] ?? 0)) * 2);

        return $this->score('control', $score, [$counterspells.' counterspells', $interaction.' removal cards', $wipes.' hard board wipes', $draw.' draw/selection cards']);
    }

    /**
     * @param array<string,int> $roles
     * @return array{archetype:string,score:int,evidence:list<string>}
     */
    private function staxScore(array $roles): array
    {
        $stax = $roles['stax'] ?? 0;
        $tax = $roles['tax'] ?? 0;
        $risk = $roles['symmetricalStaxRisk'] ?? 0;
        $score = min(46, $stax * 9) + min(24, $tax * 6) + min(10, $risk * 2);

        return $this->score('stax', $score, [$stax.' stax cards', $tax.' tax cards', $risk.' symmetrical stax-risk cards']);
    }

    /**
     * @param array<string,int> $roles
     * @return array{archetype:string,score:int,evidence:list<string>}
     */
    private function tokensScore(array $roles): array
    {
        $tokens = $roles['tokenMakers'] ?? 0;
        $payoffs = $roles['payoffs'] ?? 0;
        $finishers = $roles['combatFinishers'] ?? 0;
        $score = min(34, $tokens * 5) + min(24, $payoffs * 4) + min(18, $finishers * 6);

        return $this->score('tokens', $score, [$tokens.' token makers', $payoffs.' payoffs', $finishers.' combat finishers']);
    }

    /**
     * @param array{detected?:bool,primaryType?:?string,confidence?:string,creatureCount?:int,supportCount?:int,commanderMatches?:bool} $typal
     * @return array{archetype:string,score:int,evidence:list<string>}
     */
    private function typalScore(array $typal): array
    {
        if (($typal['detected'] ?? false) !== true) {
            return $this->score('typal', 0, []);
        }

        $creatures = (int) ($typal['creatureCount'] ?? 0);
        $support = (int) ($typal['supportCount'] ?? 0);
        $score = min(44, $creatures * 3) + min(24, $support * 6);
        if (($typal['commanderMatches'] ?? false) === true) {
            $score += 14;
        }
        if (($typal['confidence'] ?? 'low') === 'high') {
            $score += 10;
        }

        $type = is_string($typal['primaryType'] ?? null) ? $typal['primaryType'] : 'creature type';
        $evidence = [
            $creatures.' '.$type.' creature cards',
            $support.' tribal support cards',
        ];
        if (($typal['commanderMatches'] ?? false) === true) {
            $evidence[] = 'commander matches the primary creature type';
        }

        return $this->score('typal', $score, $evidence);
    }

    /**
     * @param array<string,int> $roles
     * @param array<string,int|float> $signals
     * @return array{archetype:string,score:int,evidence:list<string>}
     */
    private function voltronInfectScore(array $roles, array $signals): array
    {
        $protection = $roles['protection'] ?? 0;
        $infect = $roles['infectThreats'] ?? 0;
        $combatFinishers = $roles['combatFinishers'] ?? 0;
        $equipmentAura = (int) ($signals['equipmentAura'] ?? 0);
        $score = min(26, $protection * 4) + min(26, $infect * 10) + min(18, $combatFinishers * 5) + min(16, $equipmentAura * 4);

        return $this->score('voltron_infect', $score, [$protection.' protection cards', $infect.' infect threats', $equipmentAura.' equipment/aura signals']);
    }

    /**
     * @param array<string,int> $roles
     * @param array<string,int|float> $signals
     * @return array{archetype:string,score:int,evidence:list<string>}
     */
    private function spellslingerScore(array $roles, array $signals): array
    {
        $spells = (int) ($signals['instantSorcery'] ?? 0);
        $reducers = $roles['costReducers'] ?? 0;
        $selection = ($roles['draw'] ?? 0) + ($roles['cardSelection'] ?? 0);
        $burst = ($roles['rituals'] ?? 0) + ($roles['burstMana'] ?? 0);
        $storm = (int) ($signals['storm'] ?? 0);
        $score = min(24, $spells * 2) + min(18, $reducers * 5) + min(16, $selection * 2) + min(16, $burst * 4) + min(14, $storm * 7);

        return $this->score('spellslinger', $score, [$spells.' instant/sorcery cards', $reducers.' cost reducers', $burst.' ritual/burst mana cards']);
    }

    /**
     * @param array<string,int|float> $signals
     * @param array<string,int> $roles
     * @return array{archetype:string,score:int,evidence:list<string>}
     */
    private function weightedScore(string $archetype, array $signals, array $roles): array
    {
        $weight = (float) ($signals['archetypeWeights'][$archetype] ?? 0);
        $sanity = match ($archetype) {
            'blink' => ($signals['blink'] ?? 0) + ($roles['enablers'] ?? 0) + ($roles['payoffs'] ?? 0),
            'artifact' => $signals['artifact'] ?? 0,
            'enchantress' => $signals['enchantment'] ?? 0,
            'landfall' => ($signals['landfall'] ?? 0) + ($roles['rampSearch'] ?? 0),
            'theft' => $signals['theft'] ?? 0,
            'discard' => ($roles['discard'] ?? 0) + ($signals['discard'] ?? 0),
            'mill' => $signals['mill'] ?? 0,
            'lifegain' => $roles['lifegain'] ?? 0,
            default => 0,
        };

        $score = min(58, (int) round($weight * 3)) + min(24, (int) $sanity * 4);
        if ($weight > 0 && $sanity < 2) {
            $score = min($score, 38);
        }

        return $this->score($archetype, $score, [sprintf('%.1f aggregated archetype weight', $weight), (int) $sanity.' supporting role/type signals']);
    }

    /**
     * @param list<array{quantity:int,analysisProfile:array<string,mixed>}> $resolvedCards
     * @return array<string,mixed>
     */
    private function profileSignals(array $resolvedCards): array
    {
        $signals = [
            'archetypeWeights' => [],
            'compactWincons' => 0,
            'efficientTutors' => 0,
            'manaPositiveComboPieces' => 0,
            'freeInteraction' => 0,
            'largeThreats' => 0,
            'graveyard' => 0,
            'equipmentAura' => 0,
            'instantSorcery' => 0,
            'storm' => 0,
            'artifact' => 0,
            'enchantment' => 0,
            'landfall' => 0,
            'theft' => 0,
            'discard' => 0,
            'mill' => 0,
            'blink' => 0,
        ];

        foreach ($resolvedCards as $card) {
            $quantity = max(1, $card['quantity']);
            $profile = $card['analysisProfile'];
            foreach ($this->map($profile['archetypeWeights'] ?? []) as $archetype => $weight) {
                $signals['archetypeWeights'][$archetype] = ($signals['archetypeWeights'][$archetype] ?? 0) + ($weight * $quantity);
            }

            $flags = $this->stringSet($profile['powerFlags'] ?? []);
            $roles = $this->stringSet($profile['roles'] ?? []);
            $subroles = $this->stringSet($profile['subroles'] ?? []);
            $conditions = $this->stringSet($profile['conditionKeys'] ?? []);
            $types = is_array($profile['types'] ?? null) ? $profile['types'] : [];
            $typeLine = mb_strtolower((string) ($profile['typeLine'] ?? ''));

            $signals['compactWincons'] += isset($flags['compact_wincon']) ? $quantity : 0;
            $signals['efficientTutors'] += ($this->boolPath($profile, ['flags', 'efficientTutor']) || isset($flags['efficient_tutor'])) ? $quantity : 0;
            $signals['manaPositiveComboPieces'] += isset($flags['mana_positive_combo_piece']) ? $quantity : 0;
            $signals['freeInteraction'] += ($this->boolPath($profile, ['flags', 'freeInteraction']) || isset($flags['free_interaction'])) ? $quantity : 0;
            $signals['largeThreats'] += (($profile['manaValue'] ?? 0) >= 6 && !$this->boolPath($profile, ['types', 'land'])) ? $quantity : 0;
            $signals['graveyard'] += isset($conditions['requires_discard_outlets']) || isset($roles['recursion']) || isset($roles['reanimation']) ? $quantity : 0;
            $signals['equipmentAura'] += str_contains($typeLine, 'equipment') || str_contains($typeLine, 'aura') ? $quantity : 0;
            $signals['instantSorcery'] += (($types['instant'] ?? false) === true || ($types['sorcery'] ?? false) === true) ? $quantity : 0;
            $signals['storm'] += isset($subroles['storm']) || isset($conditions['storm_like']) ? $quantity : 0;
            $signals['artifact'] += (($types['artifact'] ?? false) === true) ? $quantity : 0;
            $signals['enchantment'] += (($types['enchantment'] ?? false) === true) ? $quantity : 0;
            $signals['landfall'] += isset($subroles['landfall']) ? $quantity : 0;
            $signals['theft'] += isset($subroles['theft']) ? $quantity : 0;
            $signals['discard'] += isset($subroles['discard_payoff']) ? $quantity : 0;
            $signals['mill'] += isset($subroles['mill']) ? $quantity : 0;
            $signals['blink'] += (isset($subroles['blink']) || isset($subroles['blink_enabler'])) ? $quantity : 0;
        }

        return $signals;
    }

    /**
     * @param array<string,mixed> $source
     * @return array<string,float>
     */
    private function map(array $source): array
    {
        $map = [];
        foreach ($source as $key => $value) {
            if (is_string($key) && is_numeric($value)) {
                $map[$key] = (float) $value;
            }
        }

        return $map;
    }

    /**
     * @param list<array{archetype:string,score:int,evidence:list<string>}> $scores
     * @return list<string>
     */
    private function secondaryArchetypes(array $scores, string $primary): array
    {
        $secondary = [];
        foreach ($scores as $score) {
            if ($score['archetype'] === $primary || $score['score'] < 35) {
                continue;
            }
            $secondary[] = $score['archetype'];
            if (count($secondary) >= 3) {
                break;
            }
        }

        return $secondary;
    }

    /**
     * @param list<array{archetype:string,score:int,evidence:list<string>}> $scores
     */
    private function isFragmented(array $top, array $second, array $scores): bool
    {
        if ($top['score'] < 45) {
            return true;
        }
        if (($top['score'] - ($second['score'] ?? 0)) < 8 && $top['score'] < 70) {
            return true;
        }

        $competitive = 0;
        foreach ($scores as $score) {
            if ($score['score'] >= max(35, $top['score'] - 10)) {
                ++$competitive;
            }
        }

        return $competitive >= 4;
    }

    private function confidence(int $topScore, int $secondScore, bool $fragmented): string
    {
        if ($fragmented) {
            return $topScore < 45 ? 'low' : 'fragmented';
        }
        if ($topScore >= 75 && $topScore - $secondScore >= 15) {
            return 'high';
        }
        if ($topScore >= 55 && $topScore - $secondScore >= 8) {
            return 'medium';
        }

        return 'low';
    }

    /**
     * @return array{archetype:string,score:int,evidence:list<string>}
     */
    private function score(string $archetype, int $score, array $evidence): array
    {
        return [
            'archetype' => $archetype,
            'score' => max(0, min(100, $score)),
            'evidence' => array_values(array_filter($evidence, static fn (string $item): bool => $item !== '')),
        ];
    }

    private function add(int &$score, array &$evidence, int|float $points, string $message): void
    {
        if ($points <= 0) {
            return;
        }
        $score += (int) round($points);
        $evidence[] = $message;
    }

    /**
     * @return array<string,true>
     */
    private function stringSet(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $set = [];
        foreach ($value as $item) {
            if (!is_scalar($item)) {
                continue;
            }
            $string = mb_strtolower(trim((string) $item));
            if ($string !== '') {
                $set[$string] = true;
            }
        }

        return $set;
    }

    /**
     * @param array<string,mixed> $source
     * @param list<string> $path
     */
    private function boolPath(array $source, array $path): bool
    {
        $value = $source;
        foreach ($path as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) {
                return false;
            }
            $value = $value[$segment];
        }

        return $value === true;
    }
}
