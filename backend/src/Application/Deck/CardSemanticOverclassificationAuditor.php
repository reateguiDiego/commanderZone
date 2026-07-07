<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;

final class CardSemanticOverclassificationAuditor
{
    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @return array{scope:int,metrics:array<string,int>,top:list<array<string,mixed>>}
     */
    public function audit(int $topLimit = 30): array
    {
        $rows = $this->connection->fetchAllAssociative(
            <<<'SQL'
SELECT
    cap.oracle_id,
    cap.name,
    cap.roles,
    cap.subroles,
    cap.role_scores,
    cap.condition_keys,
    cap.power_flags,
    cap.archetype_weights,
    cop.oracle_text,
    cop.type_line,
    cop.layout
FROM card_analysis_profile cap
INNER JOIN card_oracle_profile cop ON cop.oracle_id = cap.oracle_id
WHERE cap.commander_legal = true
  AND cap.name NOT LIKE 'A-%'
  AND (cop.layout IS NULL OR cop.layout NOT IN ('alchemy', 'rebalanced', 'prepare'))
ORDER BY cap.name ASC
SQL,
        );

        $metrics = [
            'wincon_suspicious' => 0,
            'combat_finisher_suspicious' => 0,
            'blink_suspicious' => 0,
            'sacrifice_outlet_self_only' => 0,
            'sacrifice_outlet_one_shot' => 0,
            'tutor_suspicious' => 0,
            'tutor_draw_overlap' => 0,
            'board_wipe_questionable' => 0,
            'removal_self_library_exile' => 0,
            'ramp_permanent_suspicious' => 0,
            'stax_tax_without_risk' => 0,
        ];
        $top = [];

        foreach ($rows as $row) {
            $profile = $this->profile($row);
            foreach ($this->reasons($profile) as $metric => $severity) {
                ++$metrics[$metric];
                if (count($top) < $topLimit) {
                    $top[] = [
                        'metric' => $metric,
                        'severity' => $severity,
                        'name' => $profile['name'],
                        'oracle_id' => $profile['oracle_id'],
                        'roles' => $profile['roles'],
                        'subroles' => $profile['subroles'],
                        'role_scores' => $profile['role_scores'],
                        'condition_keys' => $profile['condition_keys'],
                        'power_flags' => $profile['power_flags'],
                        'archetype_weights' => $profile['archetype_weights'],
                        'suggested_fix' => $this->suggestedFix($metric),
                    ];
                }
            }
        }

        return [
            'scope' => count($rows),
            'metrics' => $metrics,
            'top' => $top,
        ];
    }

    /**
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function profile(array $row): array
    {
        return [
            'oracle_id' => (string) $row['oracle_id'],
            'name' => (string) $row['name'],
            'normalized_name' => mb_strtolower((string) $row['name']),
            'text' => mb_strtolower((string) ($row['oracle_text'] ?? '')),
            'type_line' => mb_strtolower((string) ($row['type_line'] ?? '')),
            'roles' => $this->jsonList($row['roles'] ?? []),
            'subroles' => $this->jsonList($row['subroles'] ?? []),
            'role_scores' => $this->jsonMap($row['role_scores'] ?? []),
            'condition_keys' => $this->jsonList($row['condition_keys'] ?? []),
            'power_flags' => $this->jsonList($row['power_flags'] ?? []),
            'archetype_weights' => $this->jsonMap($row['archetype_weights'] ?? []),
        ];
    }

    /**
     * @param array<string,mixed> $profile
     * @return array<string,string>
     */
    private function reasons(array $profile): array
    {
        $reasons = [];
        $roles = array_fill_keys($profile['roles'], true);
        $subroles = array_fill_keys($profile['subroles'], true);
        $conditions = array_fill_keys($profile['condition_keys'], true);
        $text = $profile['text'];

        if (isset($roles['wincon']) && !$this->isClearWincon($profile)) {
            $reasons['wincon_suspicious'] = 'high';
        }
        if (isset($roles['combat_finisher']) && !$this->isClearCombatFinisher($profile)) {
            $reasons['combat_finisher_suspicious'] = 'high';
        }
        if ((isset($subroles['blink']) || isset($subroles['blink_enabler'])) && !$this->isRealBlink($text)) {
            $reasons['blink_suspicious'] = 'medium';
        }
        if (isset($roles['sacrifice_outlet']) && $this->isSelfSacrifice($profile)) {
            $reasons['sacrifice_outlet_self_only'] = 'high';
        }
        if (isset($roles['sacrifice_outlet']) && $this->isOneShotSacrifice($profile)) {
            $reasons['sacrifice_outlet_one_shot'] = 'high';
        }
        if (isset($roles['tutor']) && !isset($subroles['true_tutor']) && !isset($subroles['typed_tutor'])) {
            $reasons['tutor_suspicious'] = 'high';
        }
        if (isset($roles['tutor']) && (isset($roles['draw']) || isset($roles['card_selection'])) && !isset($subroles['true_tutor']) && !isset($subroles['typed_tutor'])) {
            $reasons['tutor_draw_overlap'] = 'medium';
        }
        if (isset($roles['board_wipe']) && $this->isQuestionableBoardWipe($profile)) {
            $reasons['board_wipe_questionable'] = 'high';
        }
        if ((isset($roles['spot_removal']) || isset($roles['creature_removal'])) && $this->isSelfLibraryExile($text)) {
            $reasons['removal_self_library_exile'] = 'high';
        }
        if (isset($roles['ramp']) && isset($subroles['permanent_ramp']) && (isset($roles['burst_mana']) || isset($roles['ritual']))) {
            $reasons['ramp_permanent_suspicious'] = 'medium';
        }
        if ((isset($roles['stax']) || isset($roles['tax']) || isset($roles['graveyard_hate'])) && $this->isSymmetricalStax($profile) && !isset($conditions['symmetrical_stax_risk'])) {
            $reasons['stax_tax_without_risk'] = 'medium';
        }

        return $reasons;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isClearWincon(array $profile): bool
    {
        return str_contains($profile['text'], 'you win the game')
            || str_contains($profile['text'], 'each opponent loses the game')
            || in_array($profile['normalized_name'], [
                'craterhoof behemoth',
                'finale of devastation',
                'triumph of the hordes',
                'overwhelming stampede',
                'moonshaker cavalry',
                'akroma\'s will',
                'beastmaster ascension',
                'shared animosity',
                'kamahl, heart of krosa',
                'pathbreaker ibex',
                'blightsteel colossus',
                'exsanguinate',
                'torment of hailfire',
                'debt to the deathless',
            ], true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isClearCombatFinisher(array $profile): bool
    {
        return in_array($profile['normalized_name'], [
            'craterhoof behemoth',
            'finale of devastation',
            'triumph of the hordes',
            'overwhelming stampede',
            'moonshaker cavalry',
            'akroma\'s will',
            'beastmaster ascension',
            'shared animosity',
            'kamahl, heart of krosa',
            'pathbreaker ibex',
            'blightsteel colossus',
        ], true)
            || (str_contains($profile['text'], 'additional combat phase') && str_contains($profile['type_line'], 'creature'));
    }

    private function isRealBlink(string $text): bool
    {
        return str_contains($text, 'exile')
            && (
                str_contains($text, 'return it to the battlefield')
                || str_contains($text, 'return that card to the battlefield')
                || str_contains($text, 'return those cards to the battlefield')
                || str_contains($text, 'return them to the battlefield')
            );
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isSelfSacrifice(array $profile): bool
    {
        return str_contains($profile['text'], 'sacrifice this artifact:')
            || str_contains($profile['text'], 'sacrifice this creature:')
            || str_contains($profile['text'], 'sacrifice '.$this->frontName($profile).':');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isOneShotSacrifice(array $profile): bool
    {
        return str_contains($profile['text'], 'as an additional cost to cast this spell, sacrifice')
            || in_array($profile['normalized_name'], [
                'altar\'s reap',
                'village rites',
                'corrupted conviction',
                'bone splinters',
                'bone shards',
                'burnt offering',
                'culling the weak',
            ], true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isQuestionableBoardWipe(array $profile): bool
    {
        if (preg_match('/\b(destroy|exile) all (creatures|artifacts|enchantments|nonland permanents|permanents)\b/', $profile['text']) === 1
        ) {
            return false;
        }

        return str_contains($profile['text'], 'return all attacking creatures')
            || str_contains($profile['text'], 'return each nonland permanent')
            || str_contains($profile['text'], 'return all creatures')
            || str_contains($profile['text'], 'deals combat damage')
            || str_contains($profile['text'], 'destroy each creature with');
    }

    private function isSelfLibraryExile(string $text): bool
    {
        return str_contains($text, 'exile the top card of your library')
            || str_contains($text, 'exile the top cards of your library')
            || preg_match('/\bexile the top ([a-z]+|\d+) cards? of your library\b/', $text) === 1
            || str_contains($text, 'exile cards from your library')
            || str_contains($text, 'exile your library');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isSymmetricalStax(array $profile): bool
    {
        return str_contains($profile['text'], 'each player can\'t cast more than one spell')
            || str_contains($profile['text'], 'activated abilities of artifacts can\'t be activated')
            || str_contains($profile['text'], 'activated abilities of creatures can\'t be activated')
            || str_contains($profile['text'], 'nonbasic lands are mountains')
            || str_contains($profile['text'], 'players can\'t untap more than one')
            || in_array($profile['normalized_name'], [
                'collector ouphe',
                'blood moon',
                'rule of law',
                'winter orb',
                'rest in peace',
                'grafdigger\'s cage',
            ], true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function frontName(array $profile): string
    {
        $parts = explode('//', $profile['normalized_name'], 2);

        return trim($parts[0]);
    }

    private function suggestedFix(string $metric): string
    {
        return match ($metric) {
            'wincon_suspicious' => 'manual_review: keep wincon only for explicit wins, clear combat finishers, compact combos, or Commander-scale drain finishers.',
            'combat_finisher_suspicious' => 'manual_review: downgrade small combat support to combat_support/infect_threat/extra_combat_engine.',
            'blink_suspicious' => 'Remove blink subrole unless text has exile plus return to battlefield.',
            'sacrifice_outlet_self_only' => 'Downgrade to self_sacrifice.',
            'sacrifice_outlet_one_shot' => 'Downgrade to one_shot_sacrifice.',
            'tutor_suspicious' => 'Downgrade to land_tutor, ramp_search, opponent_tutor, or manual_review.',
            'tutor_draw_overlap' => 'Confirm whether this is true tutor or card selection/value only.',
            'board_wipe_questionable' => 'Downgrade to mass_bounce, pseudo_wipe, or conditional_wipe.',
            'removal_self_library_exile' => 'Remove removal role when exile affects only own library.',
            'ramp_permanent_suspicious' => 'Keep one_shot repeatability and do not set permanent_ramp.',
            'stax_tax_without_risk' => 'Add symmetrical_stax_risk condition when the effect can hurt the pilot.',
            default => 'manual_review',
        };
    }

    /**
     * @return list<string>
     */
    private function jsonList(mixed $value): array
    {
        $decoded = is_string($value) ? json_decode($value, true) : $value;
        if (!is_array($decoded)) {
            return [];
        }

        return array_values(array_filter($decoded, is_string(...)));
    }

    /**
     * @return array<string,mixed>
     */
    private function jsonMap(mixed $value): array
    {
        $decoded = is_string($value) ? json_decode($value, true) : $value;

        return is_array($decoded) ? $decoded : [];
    }
}
