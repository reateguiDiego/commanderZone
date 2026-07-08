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
        'review_mana_base' => [
            'priority' => 'medium',
            'title' => 'Review mana base',
            'message' => 'Review fetch targets, tapped lands, and colorless utility lands against the deck color requirements.',
            'targetRoles' => ['mana_fixing', 'land', 'fetchland'],
            'issues' => ['low_colored_sources', 'low_early_color_access', 'weak_primary_color_sources', 'low_commander_castability', 'commander_color_bottleneck', 'ramp_does_not_fix_colors', 'fetchlands_without_targets', 'fetchlands_mostly_tapped_targets', 'typed_land_density_low_for_fetches', 'typed_land_density_low_for_checklands', 'too_many_tapped_lands', 'too_many_slow_lands', 'colorless_land_pressure', 'checklands_not_supported', 'filterlands_need_input_sources', 'pathways_create_color_choice_pressure', 'bounce_lands_tempo_risk', 'painland_life_pressure'],
        ],
        'add_colored_sources' => [
            'priority' => 'high',
            'title' => 'Add colored sources',
            'message' => 'Increase colored source density for colors with high pip demand.',
            'targetRoles' => ['mana_fixing', 'land'],
            'issues' => ['low_colored_sources', 'weak_primary_color_sources'],
        ],
        'add_untapped_sources' => [
            'priority' => 'high',
            'title' => 'Add untapped early sources',
            'message' => 'Improve early access with sources that can provide required colors without entering tapped.',
            'targetRoles' => ['untapped_source', 'mana_fixing'],
            'issues' => ['low_early_color_access'],
        ],
        'reduce_tapped_lands' => [
            'priority' => 'medium',
            'title' => 'Reduce tapped lands',
            'message' => 'Lower tapped-land density when early color access or development is pressured.',
            'targetRoles' => ['land'],
            'issues' => ['too_many_tapped_lands'],
        ],
        'reduce_slow_lands' => [
            'priority' => 'medium',
            'title' => 'Reduce slow lands',
            'message' => 'Reduce slowlands or taplands if they delay early turns too often.',
            'targetRoles' => ['land'],
            'issues' => ['too_many_slow_lands'],
        ],
        'reduce_colorless_utility_lands' => [
            'priority' => 'medium',
            'title' => 'Reduce colorless utility lands',
            'message' => 'Trim colorless utility lands when colored source counts are pressured.',
            'targetRoles' => ['utility_land', 'colored_source'],
            'issues' => ['colorless_land_pressure'],
        ],
        'add_fetchable_targets' => [
            'priority' => 'high',
            'title' => 'Add fetchable targets',
            'message' => 'Make sure fetchlands have enough valid typed targets in the deck.',
            'targetRoles' => ['fetchland', 'typed_land'],
            'issues' => ['fetchlands_without_targets', 'typed_land_density_low_for_fetches'],
        ],
        'improve_fetch_targets' => [
            'priority' => 'medium',
            'title' => 'Improve fetch targets',
            'message' => 'Improve fetch targets so fetchlands can access important colors without only finding tapped lands.',
            'targetRoles' => ['fetchland', 'typed_land'],
            'issues' => ['fetchlands_mostly_tapped_targets'],
        ],
        'add_rainbow_sources' => [
            'priority' => 'medium',
            'title' => 'Add flexible color fixing',
            'message' => 'Add flexible color fixing when several colors have source pressure.',
            'targetRoles' => ['rainbow_source', 'mana_fixing'],
            'issues' => ['low_colored_sources', 'low_early_color_access'],
        ],
        'add_land_ramp_that_fixes' => [
            'priority' => 'medium',
            'title' => 'Add ramp that fixes colors',
            'message' => 'Prefer ramp that improves access to required colors when ramp count is high but fixing is low.',
            'targetRoles' => ['land_ramp', 'mana_fixing'],
            'issues' => ['ramp_does_not_fix_colors'],
        ],
        'replace_rituals_with_permanent_ramp' => [
            'priority' => 'medium',
            'title' => 'Replace rituals with permanent ramp',
            'message' => 'Shift some burst mana into repeatable permanent ramp if the deck needs stable development.',
            'targetRoles' => ['permanent_ramp'],
            'issues' => ['rituals_not_stable_ramp', 'ramp_is_mostly_one_shot'],
        ],
        'add_commander_color_sources' => [
            'priority' => 'high',
            'title' => 'Add commander color sources',
            'message' => 'Increase sources for colors that bottleneck commander castability.',
            'targetRoles' => ['colored_source', 'mana_fixing'],
            'issues' => ['low_commander_castability', 'commander_color_bottleneck'],
        ],
        'review_mana_base_speed' => [
            'priority' => 'medium',
            'title' => 'Review mana base speed',
            'message' => 'Review whether the mana base can support the deck early enough.',
            'targetRoles' => ['untapped_source', 'land'],
            'issues' => ['too_many_tapped_lands', 'too_many_slow_lands', 'low_early_color_access'],
        ],
        'improve_checkland_support' => [
            'priority' => 'medium',
            'title' => 'Improve checkland support',
            'message' => 'Increase typed/basic land support or reduce unsupported checklands.',
            'targetRoles' => ['typed_land', 'checkland'],
            'issues' => ['typed_land_density_low_for_checklands', 'checklands_not_supported'],
        ],
        'reduce_unsupported_filterlands' => [
            'priority' => 'medium',
            'title' => 'Reduce unsupported filterlands',
            'message' => 'Reduce filterland pressure or add independent input sources.',
            'targetRoles' => ['filterland', 'untapped_source'],
            'issues' => ['filterlands_need_input_sources'],
        ],
        'reduce_pathway_color_pressure' => [
            'priority' => 'medium',
            'title' => 'Reduce pathway color pressure',
            'message' => 'Reduce pathway dependence when early color demands conflict.',
            'targetRoles' => ['pathway', 'colored_source'],
            'issues' => ['pathways_create_color_choice_pressure'],
        ],
        'reduce_bounce_lands' => [
            'priority' => 'medium',
            'title' => 'Reduce bounce lands',
            'message' => 'Reduce bounce land count when early tempo is important.',
            'targetRoles' => ['bounce_land', 'land'],
            'issues' => ['bounce_lands_tempo_risk'],
        ],
        'review_painland_life_pressure' => [
            'priority' => 'low',
            'title' => 'Review painland life pressure',
            'message' => 'Review painland density alongside other life costs.',
            'targetRoles' => ['painland', 'land'],
            'issues' => ['painland_life_pressure'],
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
