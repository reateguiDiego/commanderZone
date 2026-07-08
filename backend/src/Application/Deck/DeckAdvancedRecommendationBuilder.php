<?php

namespace App\Application\Deck;

final class DeckAdvancedRecommendationBuilder
{
    private const RECOMMENDATIONS = [
        'add_permanent_ramp' => [
            'priority' => 'high',
            'title' => 'Add permanent ramp',
            'message' => 'Increase repeatable permanent ramp rather than relying only on one-shot mana.',
            'targetRoles' => ['permanent_ramp'],
            'issues' => ['low_permanent_ramp', 'ramp_not_seen_early'],
        ],
        'review_one_shot_effects' => [
            'priority' => 'medium',
            'title' => 'Review one-shot mana effects',
            'message' => 'Separate burst mana from repeatable development and make sure the deck has enough permanent ramp.',
            'targetRoles' => ['burst_mana', 'ritual', 'one_shot_mana'],
            'issues' => ['ramp_is_mostly_one_shot'],
        ],
        'add_card_draw' => [
            'priority' => 'high',
            'title' => 'Add card draw',
            'message' => 'Add more repeatable or efficient card draw effects.',
            'targetRoles' => ['draw'],
            'issues' => ['low_draw'],
        ],
        'add_card_selection' => [
            'priority' => 'medium',
            'title' => 'Add card selection',
            'message' => 'Add filtering or selection effects to smooth card access.',
            'targetRoles' => ['card_selection'],
            'issues' => ['low_card_selection'],
        ],
        'add_true_tutor' => [
            'priority' => 'high',
            'title' => 'Add true tutors',
            'message' => 'If the plan depends on specific lines, add tutors that find the needed card types or any card.',
            'targetRoles' => ['true_tutor', 'typed_tutor'],
            'issues' => ['low_true_tutors_for_combo'],
        ],
        'add_hard_board_wipe' => [
            'priority' => 'medium',
            'title' => 'Add hard board wipes',
            'message' => 'Add hard reset effects instead of counting only bounce or conditional sweepers.',
            'targetRoles' => ['board_wipe'],
            'issues' => ['low_hard_board_wipes'],
        ],
        'review_pseudo_wipes' => [
            'priority' => 'medium',
            'title' => 'Review soft wipe package',
            'message' => 'Mass bounce and conditional wipes can be useful, but they should not replace hard board wipes.',
            'targetRoles' => ['mass_bounce', 'pseudo_wipe', 'conditional_wipe'],
            'issues' => ['wipes_are_mostly_bounce_or_conditional'],
        ],
        'add_repeatable_sacrifice_outlet' => [
            'priority' => 'high',
            'title' => 'Add repeatable sacrifice outlets',
            'message' => 'Add repeatable outlets if the plan depends on sacrifice payoffs.',
            'targetRoles' => ['sacrifice_outlet'],
            'issues' => ['low_real_sacrifice_outlets', 'sacrifice_is_mostly_one_shot'],
        ],
        'add_wincon' => [
            'priority' => 'high',
            'title' => 'Add closing power',
            'message' => 'Add clearer win conditions, combat finishers, or complete combo lines.',
            'targetRoles' => ['wincon', 'combat_finisher'],
            'issues' => ['low_wincons', 'value_without_closure'],
        ],
        'add_protection' => [
            'priority' => 'medium',
            'title' => 'Add protection',
            'message' => 'Add protection if the plan relies on assembling or keeping key pieces.',
            'targetRoles' => ['protection'],
            'issues' => ['low_combo_access'],
        ],
        'add_interaction' => [
            'priority' => 'medium',
            'title' => 'Add early interaction',
            'message' => 'Add early interaction if the deck needs to survive faster starts.',
            'targetRoles' => ['spot_removal', 'counterspell', 'graveyard_hate'],
            'issues' => ['low_early_interaction'],
        ],
        'review_symmetrical_stax' => [
            'priority' => 'medium',
            'title' => 'Review symmetrical stax effects',
            'message' => 'Check whether symmetrical stax pieces slow your own plan more than opponents.',
            'targetRoles' => ['stax', 'tax'],
            'issues' => ['symmetrical_stax_risk'],
        ],
        'review_combo_package' => [
            'priority' => 'medium',
            'title' => 'Review combo package',
            'message' => 'Clarify whether the deck is trying to complete known combo lines or just playing individually strong pieces.',
            'targetRoles' => ['combo_piece', 'compact_wincon', 'protection'],
            'issues' => ['combo_pieces_without_complete_combos', 'many_partial_combos', 'commander_required_combo_dependency'],
        ],
        'review_tribal_package' => [
            'priority' => 'medium',
            'title' => 'Review tribal package',
            'message' => 'Make sure the deck has enough matching creatures and payoffs for the main creature type.',
            'targetRoles' => ['typal_support', 'payoff', 'creature_density'],
            'issues' => ['typal_density_without_support', 'typal_support_without_density', 'typal_commander_mismatch'],
        ],
    ];

    /**
     * @param list<array{code:string}> $issues
     * @return list<array{code:string,priority:string,title:string,message:string,targetRoles:list<string>,reasonIssueCodes:list<string>}>
     */
    public function build(array $issues): array
    {
        $issueCodes = [];
        foreach ($issues as $issue) {
            $issueCodes[$issue['code']] = true;
        }

        $recommendations = [];
        foreach (self::RECOMMENDATIONS as $code => $definition) {
            $reasons = array_values(array_filter(
                $definition['issues'],
                static fn (string $issueCode): bool => isset($issueCodes[$issueCode]),
            ));
            if ($reasons === []) {
                continue;
            }
            $recommendations[] = [
                'code' => $code,
                'priority' => $definition['priority'],
                'title' => $definition['title'],
                'message' => $definition['message'],
                'targetRoles' => $definition['targetRoles'],
                'reasonIssueCodes' => $reasons,
            ];
        }

        usort($recommendations, static fn (array $left, array $right): int => self::priorityRank($left['priority']) <=> self::priorityRank($right['priority']));

        return $recommendations;
    }

    private static function priorityRank(string $priority): int
    {
        return match ($priority) {
            'high' => 0,
            'medium' => 1,
            default => 2,
        };
    }
}
