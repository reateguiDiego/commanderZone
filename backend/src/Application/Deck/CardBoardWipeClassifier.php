<?php

namespace App\Application\Deck;

final class CardBoardWipeClassifier
{
    private const PREMIUM_NAMES = [
        'cyclonic rift',
        'farewell',
        'toxic deluge',
    ];

    /**
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    public function classify(array $row): array
    {
        $profile = $this->normalize($row);
        $text = $profile['text'];
        $name = $profile['normalized_name'];

        $hasOverload = str_contains($text, 'overload');
        $isModal = $this->hasModes($text);
        $methods = $this->methods($profile, $hasOverload);
        $scopes = $this->scopes($profile, $hasOverload);
        $isMassRemoval = $this->isMassRemoval($profile, $methods, $scopes, $hasOverload);
        $isCombatOnly = $this->isCombatOnly($text, $scopes);
        $isPermanentActivated = !$profile['is_instant'] && !$profile['is_sorcery'] && str_contains($text, ':') && $isMassRemoval;
        $isTriggered = !$profile['is_instant'] && !$profile['is_sorcery'] && (str_contains($text, 'when ') || str_contains($text, 'whenever ')) && $isMassRemoval;
        $isPseudo = $isCombatOnly || $this->hasScope($scopes, ['selected_mana_value', 'selected_power', 'selected_toughness']);
        $isCreatureWipe = $this->hasScope($scopes, ['creatures', 'attacking_creatures', 'tapped_creatures', 'flying_creatures', 'nonflying_creatures', 'chosen_creature_type']);
        $isNonCreatureWipe = $this->hasScope($scopes, ['artifacts', 'enchantments', 'planeswalkers', 'battles', 'graveyards']);
        $isPermanentWipe = $this->hasScope($scopes, ['nonland_permanents', 'all_permanents', 'colored_permanents']);
        $isSpotWithMassMode = $hasOverload && preg_match('/\btarget\b/', $text) === 1 && $isMassRemoval;
        $isBoardWipe = $isMassRemoval;
        $boardWipeType = $isBoardWipe ? $this->boardWipeType($profile, $methods, $scopes, $isModal, $isPseudo, $isPermanentActivated) : 'other';
        $needsManualReview = !$isBoardWipe && $this->looksLikeUnclassifiedMassRemoval($text);
        $symmetry = $this->symmetryProfile($profile, $scopes);
        $alternativeCost = $hasOverload ? 'overload' : null;
        $massModeType = $this->massModeType($boardWipeType, $methods, $scopes);
        $baseModeType = $isSpotWithMassMode ? $this->baseModeType($methods, $scopes) : 'none';
        $answersIndestructible = $this->answersIndestructible($methods);
        $opponentCompensation = $this->opponentCompensation($profile);

        return [
            'oracle_id' => $profile['oracle_id'],
            'name' => $profile['name'],
            'type_line' => $profile['type_line'],
            'oracle_text' => $profile['oracle_text'],
            'mana_value' => $profile['mana_value'],
            'colors' => $profile['colors'],
            'color_identity' => $profile['color_identity'],
            'is_board_wipe' => $isBoardWipe,
            'is_creature_wipe' => $isCreatureWipe,
            'is_noncreature_wipe' => $isNonCreatureWipe,
            'is_permanent_wipe' => $isPermanentWipe,
            'is_pseudo_wipe' => $isPseudo,
            'is_mass_removal' => $isMassRemoval,
            'is_spot_removal_with_mass_mode' => $isSpotWithMassMode,
            'board_wipe_type' => $boardWipeType,
            'wipe_method' => $methods,
            'wipe_scope' => $scopes,
            'symmetry_profile' => $symmetry,
            'is_instant_speed' => $profile['is_instant'],
            'is_sorcery_speed' => $profile['is_sorcery'],
            'is_permanent_activated' => $isPermanentActivated,
            'is_triggered_wipe' => $isTriggered,
            'is_repeatable' => $isPermanentActivated && !$this->requiresSacrifice($text),
            'is_delayed' => $isPermanentActivated || str_contains($text, 'at the beginning of the next') || str_contains($text, 'fate counter'),
            'printed_mana_value' => $profile['mana_value'],
            'effective_cost_min' => $this->effectiveCostMin($profile, $name),
            'has_cost_reduction' => $this->hasCostReduction($profile, $name),
            'cost_reduction_condition' => $this->costReductionCondition($profile, $name),
            'is_scalable' => $this->isScalable($text, $name),
            'x_spell' => $this->isXSpell($text),
            'has_modes' => $isModal,
            'modal_choices_count' => $this->modalChoicesCount($text),
            'has_alternative_mass_mode' => $isSpotWithMassMode,
            'alternative_cost_type' => $alternativeCost,
            'alternative_mass_cost' => $this->alternativeMassCost($text, $alternativeCost),
            'base_mode_type' => $baseModeType,
            'mass_mode_type' => $massModeType,
            'answers_indestructible' => $answersIndestructible,
            'answers_regeneration' => $answersIndestructible || str_contains($text, "can't be regenerated"),
            'gets_around_hexproof_shroud' => $isBoardWipe && (!$this->hasOnlyTargetMode($text) || $isSpotWithMassMode),
            'gets_around_ward' => $isBoardWipe && (!$this->hasOnlyTargetMode($text) || $isSpotWithMassMode),
            'exiles_graveyards' => in_array('graveyard_exile', $methods, true) || in_array('graveyards', $scopes, true),
            'prevents_rebuild' => in_array('graveyard_exile', $methods, true) || $opponentCompensation === 'none' && in_array('exile', $methods, true),
            'prevents_graveyard_recursion' => in_array('graveyard_exile', $methods, true) || in_array('exile', $methods, true) && $isCreatureWipe,
            'leaves_own_board' => in_array($symmetry, ['one_sided', 'opponents_only'], true),
            'protects_own_board' => in_array($symmetry, ['one_sided', 'opponents_only'], true),
            'can_be_built_around' => $this->canBeBuiltAround($profile, $methods, $scopes, $symmetry),
            'harms_own_board' => $isBoardWipe && !in_array($symmetry, ['one_sided', 'opponents_only'], true),
            'rebuild_advantage' => $this->rebuildAdvantage($profile, $symmetry, $opponentCompensation),
            'opponent_compensation' => $opponentCompensation,
            'commander_playability_band' => $this->playabilityBand($profile, $boardWipeType, $symmetry),
            'high_power_viable' => $this->highPowerViable($profile, $boardWipeType),
            'cedh_viable' => in_array($name, ['cyclonic rift', 'toxic deluge', 'fire covenant'], true),
            'token_deck_risk' => $isCreatureWipe && !in_array($symmetry, ['one_sided', 'opponents_only'], true),
            'creature_deck_risk' => $isCreatureWipe && !in_array($symmetry, ['one_sided', 'opponents_only'], true),
            'artifact_deck_risk' => in_array('artifacts', $scopes, true) && !in_array($symmetry, ['one_sided', 'opponents_only'], true),
            'enchantment_deck_risk' => in_array('enchantments', $scopes, true) && !in_array($symmetry, ['one_sided', 'opponents_only'], true),
            'graveyard_deck_risk' => in_array('graveyards', $scopes, true),
            'needs_manual_review' => $needsManualReview,
        ];
    }

    /**
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function normalize(array $row): array
    {
        $oracleText = $this->stringOrNull($row['oracle_text'] ?? null);
        $typeLine = $this->stringOrNull($row['type_line'] ?? null);

        return [
            'oracle_id' => (string) ($row['oracle_id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'normalized_name' => mb_strtolower(trim((string) ($row['normalized_name'] ?? $row['name'] ?? ''))),
            'type_line' => $typeLine,
            'oracle_text' => $oracleText,
            'text' => mb_strtolower($oracleText ?? ''),
            'mana_value' => is_numeric($row['mana_value'] ?? null) ? (float) $row['mana_value'] : null,
            'colors' => $this->jsonArray($row['colors'] ?? []),
            'color_identity' => $this->jsonArray($row['color_identity'] ?? []),
            'is_instant' => $this->boolValue($row['is_instant'] ?? false),
            'is_sorcery' => $this->boolValue($row['is_sorcery'] ?? false),
        ];
    }

    /**
     * @param array<string,mixed> $profile
     * @return list<string>
     */
    private function methods(array $profile, bool $hasOverload): array
    {
        $text = $profile['text'];
        $methods = [];

        if (preg_match('/\b(destroy|destroyed|destroys)\b/', $text) === 1 || $hasOverload && str_contains($text, 'destroy target')) {
            $methods[] = 'destroy';
        }
        if (preg_match('/\b(exile|exiles|exiled)\b/', $text) === 1) {
            $methods[] = in_array($profile['normalized_name'], ['farewell', 'bojuka bog', 'rest in peace'], true) || str_contains($text, 'graveyard') ? 'graveyard_exile' : 'exile';
            if (str_contains($text, 'graveyard')) {
                $methods[] = 'exile';
            }
        }
        if (preg_match('/\b(each player|each opponent|target player|that player|players?) sacrifices? (all|the rest|a|an|each)\b/', $text) === 1
            || preg_match('/\bsacrifices? the rest\b/', $text) === 1
            || preg_match('/\bsacrifices? all (creatures|permanents|nonland permanents)\b/', $text) === 1
        ) {
            $methods[] = 'sacrifice';
        }
        if (preg_match('/\breturn (all|each|target)\b/', $text) === 1 || str_contains($text, "owner's hand")) {
            $methods[] = 'bounce';
        }
        if (str_contains($text, 'top or bottom of their library')) {
            $methods[] = 'tuck';
        }
        if (preg_match('/\b(shuffle|shuffles) (all|each|those|them|it).+into .+ librar/', $text) === 1) {
            $methods[] = 'shuffle';
        }
        if (preg_match('/\bdeals? (x|\d+|that much) damage\b/', $text) === 1) {
            $methods[] = 'damage';
        }
        if (preg_match('/\bgets? -x\/-x\b/', $text) === 1 || preg_match('/\bgets? -\d+\/-\d+\b/', $text) === 1) {
            $methods[] = 'minus_x_minus_x';
        }
        if (preg_match('/\bgets? [+-]?\d+\/-\d+\b/', $text) === 1) {
            $methods[] = 'reduce_power_toughness';
        }
        if (str_contains($text, 'phase out')) {
            $methods[] = 'phase_out';
        }
        if (str_contains($text, 'tap all') || str_contains($text, "don't untap")) {
            $methods[] = 'tap_freeze';
        }
        if (str_contains($text, 'chooses') && str_contains($text, 'destroy the rest') || str_contains($text, 'sacrifices the rest')) {
            $methods[] = 'choose_and_keep';
        }

        return $this->unique($methods);
    }

    /**
     * @param array<string,mixed> $profile
     * @return list<string>
     */
    private function scopes(array $profile, bool $hasOverload): array
    {
        $text = $profile['text'];
        $scopes = [];

        if (str_contains($text, 'nonland permanent')) {
            $scopes[] = 'nonland_permanents';
        }
        if (str_contains($text, 'all permanents')
            || preg_match('/\b(destroy|exile|return|sacrifice|sacrifices) each permanent\b/', $text) === 1
        ) {
            $scopes[] = 'all_permanents';
        }
        if (str_contains($text, 'colored permanent') || str_contains($text, 'one or more colors')) {
            $scopes[] = 'colored_permanents';
        }
        if (preg_match('/\b(all|each|target|attacking|blocking|tapped) creatures?\b/', $text) === 1
            || preg_match('/\b(destroy|exile|return|sacrifice|sacrifices).{0,80}\bcreatures\b/', $text) === 1
            || str_contains($text, 'creatures you')
            || str_contains($text, 'creatures with')
            || str_contains($text, 'creatures without')
            || str_contains($text, 'creature cards')
            || str_contains($text, 'creature type')
            || str_contains($text, 'artifact, creature, and enchantment')
            || str_contains($text, 'dragon creatures')
            || str_contains($text, 'non-dragon creatures')
        ) {
            $scopes[] = 'creatures';
        }
        if (preg_match('/\b(all|each|target) artifacts?\b/', $text) === 1
            || str_contains($text, 'artifacts and enchantments')
            || str_contains($text, 'artifact, creature, and enchantment')
        ) {
            $scopes[] = 'artifacts';
        }
        if (preg_match('/\b(all|each|target) enchantments?\b/', $text) === 1
            || str_contains($text, 'artifacts and enchantments')
            || str_contains($text, 'artifact, creature, and enchantment')
        ) {
            $scopes[] = 'enchantments';
        }
        if (str_contains($text, 'planeswalker')) {
            $scopes[] = 'planeswalkers';
        }
        if (str_contains($text, 'battle')) {
            $scopes[] = 'battles';
        }
        if (str_contains($text, 'graveyard')) {
            $scopes[] = 'graveyards';
        }
        if (str_contains($text, 'token')) {
            $scopes[] = 'tokens';
        }
        if (str_contains($text, 'attacking creature')) {
            $scopes[] = 'attacking_creatures';
        }
        if (str_contains($text, 'tapped creature')) {
            $scopes[] = 'tapped_creatures';
        }
        if (str_contains($text, 'creatures with flying')) {
            $scopes[] = 'flying_creatures';
        }
        if (str_contains($text, 'creatures without flying') || str_contains($text, 'nonflying')) {
            $scopes[] = 'nonflying_creatures';
        }
        if (str_contains($text, 'creature type') || str_contains($text, 'dragon creatures') || str_contains($text, 'non-dragon creatures')) {
            $scopes[] = 'chosen_creature_type';
        }
        if (str_contains($text, 'mana value') || str_contains($text, 'mana cost')) {
            $scopes[] = 'selected_mana_value';
        }
        if (str_contains($text, 'power ') || str_contains($text, 'power greater') || str_contains($text, 'power less')) {
            $scopes[] = 'selected_power';
        }
        if (str_contains($text, 'toughness ') || str_contains($text, 'toughness greater') || str_contains($text, 'toughness less')) {
            $scopes[] = 'selected_toughness';
        }
        if (str_contains($text, "you don't control") || str_contains($text, 'opponents control') || str_contains($text, 'each opponent')) {
            $scopes[] = 'opponents_only';
        }
        if (str_contains($text, 'each opponent')) {
            $scopes[] = 'each_opponent';
        }
        if (str_contains($text, 'each player')) {
            $scopes[] = 'all_players';
        }
        if (str_contains($text, 'you choose') || str_contains($text, 'your choice')) {
            $scopes[] = 'controller_choice';
        }
        if (str_contains($text, 'each player chooses')) {
            $scopes[] = 'each_player_choice';
        }
        if ($hasOverload && str_contains($text, 'target') && str_contains($text, 'you don\'t control')) {
            $scopes[] = 'opponents_only';
        }

        return $this->unique($scopes);
    }

    /**
     * @param array<string,mixed> $profile
     * @param list<string> $methods
     * @param list<string> $scopes
     */
    private function isMassRemoval(array $profile, array $methods, array $scopes, bool $hasOverload): bool
    {
        $text = $profile['text'];
        $name = $profile['normalized_name'];

        if (in_array($name, [
            'wrath of god', 'damnation', 'day of judgment', 'supreme verdict', 'vanquish the horde',
            'farewell', 'austere command', 'toxic deluge', 'blasphemous act', 'living death',
            'all is dust', 'the meathook massacre', 'in garruk\'s wake', 'ruinous ultimatum',
            'kindred dominance', 'hour of revelation', 'nevinyrral\'s disk', 'bane of progress',
            'cleansing nova', 'merciless eviction', 'cyclonic rift', 'evacuation', 'aetherize',
            'aetherspouts', 'winds of abandon', 'damn', 'vandalblast', 'mizzium mortars',
            'crux of fate', 'plague wind', 'tragic arrogance', 'single combat', 'divine reckoning',
            'oblivion stone', 'pernicious deed', 'settle the wreckage', 'final judgment', 'sunfall',
            'black sun\'s zenith', 'chain reaction', 'starstorm', 'whelming wave', 'engineered explosives',
        ], true)) {
            return true;
        }

        if ($hasOverload && preg_match('/\btarget\b/', $text) === 1 && $this->hasScope($scopes, ['creatures', 'artifacts', 'nonland_permanents'])) {
            return true;
        }

        return preg_match('/\b(destroy|exile) all (creatures|artifacts|enchantments|nonland permanents|permanents)\b/', $text) === 1
            || preg_match('/\b(destroy|exile) each (creature|artifact|enchantment|nonland permanent|permanent)\b/', $text) === 1
            || preg_match('/\breturn (all|each) (creatures|nonland permanents|permanents)\b/', $text) === 1
            || preg_match('/\breturn (all|each) attacking creatures?\b/', $text) === 1
            || preg_match('/\bdeals? (x|\d+|that much) damage to each creature\b/', $text) === 1
            || preg_match('/\beach creature gets? -x\/-x\b/', $text) === 1
            || preg_match('/\beach player sacrifices all\b/', $text) === 1
            || preg_match('/\b(destroy|sacrifice|sacrifices) the rest\b/', $text) === 1
            || str_contains($text, 'destroy each nonland permanent without a fate counter')
            || str_contains($text, 'destroy each artifact, creature, and enchantment with mana value');
    }

    /**
     * @param list<string> $methods
     * @param list<string> $scopes
     */
    private function boardWipeType(array $profile, array $methods, array $scopes, bool $isModal, bool $isPseudo, bool $isPermanentActivated): string
    {
        if ($this->isCombatOnly($profile['text'], $scopes)) {
            return 'combat_only_wipe';
        }
        if (str_contains($profile['text'], 'whenever') && str_contains($profile['text'], 'deals combat damage') && in_array('creatures', $scopes, true)) {
            return 'conditional_wipe';
        }
        if ($isPermanentActivated) {
            return 'repeatable_wipe';
        }
        if ($isModal) {
            return 'modal_wipe';
        }
        if ($this->hasScope($scopes, ['selected_mana_value', 'selected_power', 'selected_toughness'])) {
            return 'conditional_wipe';
        }
        if ($isPseudo) {
            return 'pseudo_wipe';
        }
        if (in_array('tuck', $methods, true) || in_array('shuffle', $methods, true)) {
            return 'tuck_wipe';
        }
        if (in_array('bounce', $methods, true)) {
            return 'bounce_wipe';
        }
        if (in_array('sacrifice', $methods, true)) {
            return 'sacrifice_wipe';
        }
        if (in_array('minus_x_minus_x', $methods, true)) {
            return 'minus_x_minus_x_wipe';
        }
        if (in_array('damage', $methods, true)) {
            return 'damage_wipe';
        }
        if (in_array('exile', $methods, true) && in_array('creatures', $scopes, true)) {
            return 'exile_creature_wipe';
        }
        if (in_array('all_permanents', $scopes, true)) {
            return 'destroy_all_permanents';
        }
        if (in_array('nonland_permanents', $scopes, true)) {
            return 'nonland_permanent_wipe';
        }
        if (in_array('graveyards', $scopes, true) && !$this->hasScope($scopes, ['creatures', 'artifacts', 'enchantments', 'nonland_permanents'])) {
            return 'graveyard_wipe';
        }
        if (in_array('artifacts', $scopes, true) && in_array('enchantments', $scopes, true) && !in_array('creatures', $scopes, true)) {
            return 'artifact_enchantment_wipe';
        }
        if (in_array('artifacts', $scopes, true) && !in_array('creatures', $scopes, true)) {
            return 'artifact_wipe';
        }
        if (in_array('enchantments', $scopes, true) && !in_array('creatures', $scopes, true)) {
            return 'enchantment_wipe';
        }
        if ($this->hasScope($scopes, ['chosen_creature_type'])) {
            return 'conditional_wipe';
        }
        if (in_array('destroy', $methods, true) && in_array('creatures', $scopes, true)) {
            return 'hard_creature_wipe';
        }

        return 'other';
    }

    /**
     * @param list<string> $scopes
     */
    private function symmetryProfile(array $profile, array $scopes): string
    {
        $text = $profile['text'];
        if (in_array('each_player_choice', $scopes, true)) {
            return 'each_player_chooses';
        }
        if (in_array('controller_choice', $scopes, true)) {
            return 'controller_choice';
        }
        if (in_array('chosen_creature_type', $scopes, true)) {
            return 'creature_type_asymmetry';
        }
        if (str_contains($text, 'opponents control')) {
            return 'opponents_only';
        }
        if (str_contains($text, "you don't control")) {
            return 'one_sided';
        }
        if (str_contains($text, 'for each player')) {
            return 'semi_asymmetrical';
        }
        if (str_contains($text, 'choose') || str_contains($text, 'except')) {
            return 'asymmetrical';
        }

        return 'symmetrical';
    }

    private function hasModes(string $text): bool
    {
        return str_contains($text, 'choose one')
            || str_contains($text, 'choose two')
            || str_contains($text, 'choose one or more')
            || str_contains($text, '•');
    }

    private function modalChoicesCount(string $text): ?int
    {
        if (!$this->hasModes($text)) {
            return null;
        }

        if (str_contains($text, 'choose one or more')) {
            return substr_count($text, '•');
        }
        if (str_contains($text, 'choose two')) {
            return 2;
        }
        if (str_contains($text, 'choose one')) {
            return 1;
        }

        return null;
    }

    /**
     * @param list<string> $scopes
     */
    private function isCombatOnly(string $text, array $scopes): bool
    {
        return in_array('attacking_creatures', $scopes, true)
            || str_contains($text, 'for each attacking creature');
    }

    /**
     * @param list<string> $methods
     */
    private function answersIndestructible(array $methods): bool
    {
        return count(array_intersect($methods, ['exile', 'graveyard_exile', 'sacrifice', 'minus_x_minus_x', 'bounce', 'tuck', 'shuffle'])) > 0;
    }

    private function isScalable(string $text, string $name): bool
    {
        return $this->isXSpell($text)
            || in_array($name, ['toxic deluge', 'vanquish the horde', 'blasphemous act', 'chain reaction'], true)
            || str_contains($text, 'for each')
            || str_contains($text, 'costs {1} less');
    }

    private function isXSpell(string $text): bool
    {
        return str_contains($text, '{x}') || preg_match('/\bx\b/', $text) === 1 && str_contains($text, '-x/-x');
    }

    private function hasCostReduction(array $profile, string $name): bool
    {
        return in_array($name, ['vanquish the horde', 'blasphemous act'], true)
            || str_contains($profile['text'], 'costs {1} less')
            || str_contains($profile['text'], 'costs 1 less');
    }

    private function costReductionCondition(array $profile, string $name): ?string
    {
        if (!$this->hasCostReduction($profile, $name)) {
            return null;
        }

        if (str_contains($profile['text'], 'for each creature')) {
            return 'for_each_creature';
        }

        return 'board_state';
    }

    private function effectiveCostMin(array $profile, string $name): ?float
    {
        if ($name === 'blasphemous act') {
            return 1.0;
        }
        if ($name === 'vanquish the horde') {
            return 2.0;
        }

        return $profile['mana_value'];
    }

    private function alternativeMassCost(string $text, ?string $alternativeCost): ?string
    {
        if ($alternativeCost !== 'overload') {
            return null;
        }

        if (preg_match('/overload ([^\\(]+)\\(/', $text, $matches) === 1) {
            return trim($matches[1]);
        }

        return null;
    }

    /**
     * @param list<string> $methods
     * @param list<string> $scopes
     */
    private function baseModeType(array $methods, array $scopes): string
    {
        if (in_array('bounce', $methods, true)) {
            return 'bounce';
        }
        if (in_array('damage', $methods, true)) {
            return 'damage';
        }
        if ($this->hasScope($scopes, ['creatures', 'artifacts', 'enchantments', 'nonland_permanents'])) {
            return 'spot_removal';
        }

        return 'none';
    }

    /**
     * @param list<string> $methods
     * @param list<string> $scopes
     */
    private function massModeType(string $boardWipeType, array $methods, array $scopes): string
    {
        if ($boardWipeType === 'bounce_wipe' || in_array('bounce', $methods, true)) {
            return 'mass_bounce';
        }
        if ($boardWipeType === 'damage_wipe' || in_array('damage', $methods, true)) {
            return 'damage_wipe';
        }
        if (in_array('artifacts', $scopes, true) && !in_array('creatures', $scopes, true)) {
            return 'artifact_wipe';
        }
        if (str_ends_with($boardWipeType, '_wipe') || str_contains($boardWipeType, 'permanent')) {
            return 'board_wipe';
        }

        return 'other';
    }

    private function opponentCompensation(array $profile): string
    {
        $text = $profile['text'];
        if (str_contains($text, 'searches their library for a basic land') || str_contains($text, 'onto the battlefield tapped')) {
            return 'ramps_opponents';
        }
        if (str_contains($text, 'draw') && (str_contains($text, 'opponent') || str_contains($text, 'player'))) {
            return 'gives_cards';
        }
        if (str_contains($text, 'create') && str_contains($text, 'token')) {
            return 'gives_tokens';
        }
        if (str_contains($text, 'return all creature cards') || str_contains($text, 'from their graveyard')) {
            return 'symmetrical_rebuild';
        }

        return 'none';
    }

    private function canBeBuiltAround(array $profile, array $methods, array $scopes, string $symmetry): bool
    {
        return $symmetry !== 'symmetrical'
            || in_array('chosen_creature_type', $scopes, true)
            || in_array('graveyard_exile', $methods, true)
            || str_contains($profile['text'], 'from their graveyard');
    }

    private function rebuildAdvantage(array $profile, string $symmetry, string $opponentCompensation): bool
    {
        return in_array($symmetry, ['one_sided', 'opponents_only', 'controller_choice'], true)
            || $opponentCompensation === 'symmetrical_rebuild'
            || str_contains($profile['text'], 'return all creature cards');
    }

    private function playabilityBand(array $profile, string $boardWipeType, string $symmetry): string
    {
        $name = $profile['normalized_name'];
        $manaValue = $profile['mana_value'];
        if (in_array($name, self::PREMIUM_NAMES, true)) {
            return 'premium';
        }
        if (in_array($symmetry, ['one_sided', 'opponents_only'], true) || $manaValue !== null && $manaValue <= 4.0) {
            return 'strong';
        }
        if (in_array($boardWipeType, ['combat_only_wipe', 'artifact_wipe', 'enchantment_wipe', 'graveyard_wipe'], true)) {
            return 'narrow';
        }
        if ($manaValue !== null && $manaValue >= 7.0) {
            return 'risky';
        }

        return $boardWipeType === 'other' ? 'unknown' : 'playable';
    }

    private function highPowerViable(array $profile, string $boardWipeType): bool
    {
        $name = $profile['normalized_name'];

        return in_array($name, ['cyclonic rift', 'toxic deluge', 'farewell', 'fire covenant', 'damn', 'winds of abandon'], true)
            || $profile['mana_value'] !== null && $profile['mana_value'] <= 4.0 && !in_array($boardWipeType, ['combat_only_wipe', 'graveyard_wipe'], true);
    }

    private function requiresSacrifice(string $text): bool
    {
        return str_contains($text, 'sacrifice this') || str_contains($text, 'sacrifice this artifact') || str_contains($text, 'sacrifice this enchantment');
    }

    private function looksLikeUnclassifiedMassRemoval(string $text): bool
    {
        return preg_match('/\b(all|each|the rest)\b/', $text) === 1
            && preg_match('/\b(destroy|exile|return|sacrifice|damage|gets? -|phase out|tap)\b/', $text) === 1
            && preg_match('/\b(creatures?|artifacts?|enchantments?|permanents?|planeswalkers?|graveyards?|tokens?)\b/', $text) === 1;
    }

    private function hasOnlyTargetMode(string $text): bool
    {
        return preg_match('/\btarget\b/', $text) === 1
            && preg_match('/\b(all|each|rest)\b/', $text) !== 1;
    }

    /**
     * @param list<string> $scopes
     * @param list<string> $needles
     */
    private function hasScope(array $scopes, array $needles): bool
    {
        return count(array_intersect($scopes, $needles)) > 0;
    }

    private function stringOrNull(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    /**
     * @return list<string>
     */
    private function jsonArray(mixed $value): array
    {
        if (is_string($value)) {
            try {
                $decoded = json_decode($value, true, flags: JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                return [];
            }

            return is_array($decoded) ? array_values(array_filter($decoded, 'is_scalar')) : [];
        }

        return is_array($value) ? array_values(array_filter($value, 'is_scalar')) : [];
    }

    private function boolValue(mixed $value): bool
    {
        return $value === true || $value === 1 || $value === '1' || $value === 't' || $value === 'true';
    }

    /**
     * @param list<string> $values
     * @return list<string>
     */
    private function unique(array $values): array
    {
        $unique = [];
        foreach ($values as $value) {
            $unique[$value] = true;
        }

        return array_keys($unique);
    }
}
