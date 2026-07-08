<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;
use Symfony\Component\Uid\Uuid;

final class CardSemanticDataRebuilder
{
    private const SOURCE_RULE = 'rule';
    private const SOURCE_TAG = 'scryfall_tag';

    /**
     * @var array<string,list<string>>
     */
    private const TAG_ROLE_MAP = [
        'ramp' => ['ramp'],
        'mana-rock' => ['ramp'],
        'mana-dork' => ['ramp'],
        'ritual' => ['burst_mana', 'ritual'],
        'cost-reduction' => ['cost_reducer'],
        'cost-reducer' => ['cost_reducer'],
        'card-draw' => ['draw'],
        'draw' => ['draw'],
        'card-advantage' => ['draw'],
        'card-selection' => ['card_selection'],
        'looting' => ['card_selection'],
        'loot' => ['card_selection'],
        'rummage' => ['card_selection'],
        'tutor' => ['tutor'],
        'removal' => ['spot_removal'],
        'creature-removal' => ['creature_removal', 'spot_removal'],
        'artifact-removal' => ['artifact_removal', 'spot_removal'],
        'enchantment-removal' => ['enchantment_removal', 'spot_removal'],
        'board-wipe' => ['board_wipe'],
        'counterspell' => ['counterspell'],
        'protection' => ['protection'],
        'graveyard-hate' => ['graveyard_hate'],
        'recursion' => ['recursion'],
        'reanimation' => ['reanimation'],
        'reanimate' => ['reanimation'],
        'token-maker' => ['token_maker'],
        'sacrifice-outlet' => ['sacrifice_outlet'],
        'aristocrats' => ['payoff'],
        'stax' => ['stax'],
        'tax' => ['tax'],
        'extra-turn' => ['extra_turn'],
        'extra-combat' => ['extra_combat'],
        'win-condition' => ['wincon'],
        'combo-piece' => ['combo_piece'],
    ];

    /**
     * Some public Scryfall Tagger slugs are not consistently available through the
     * card search API. Keep the intended queries here, but derive fallback roles
     * locally from oracle text so rebuilds do not depend on those tags existing.
     */

    public function __construct(
        private readonly Connection $connection,
        private readonly ?DeckAnalysisDataVersionProvider $versionProvider = null,
    ) {
    }

    /**
     * @return array{profiles:int,roles:int,qualities:int,conditions:int,archetypes:int,powerFlags:int}
     */
    public function rebuild(): array
    {
        $config = CardSemanticManualConfig::load();

        return $this->connection->transactional(function () use ($config): array {
            $this->clearGeneratedData();
            $tagsByOracleId = $this->activeTagsByOracleId();
            $comboRelevanceByOracleId = $this->comboRelevanceByOracleId();

            $result = [
                'profiles' => 0,
                'roles' => 0,
                'qualities' => 0,
                'conditions' => 0,
                'archetypes' => 0,
                'powerFlags' => 0,
            ];

            foreach ($this->profileRows() as $row) {
                ++$result['profiles'];
                $profile = $this->normalizeProfile($row);
                $tags = $tagsByOracleId[$profile['oracle_id']] ?? [];
                $roles = $this->rolesForProfile($profile, $tags, $config, $comboRelevanceByOracleId[$profile['oracle_id']] ?? null);
                $conditions = $this->conditionsForProfile($profile, $config);
                $qualities = $this->qualitiesForProfile($profile, $roles, $conditions, $config);
                $archetypes = $this->archetypesForProfile($profile, $roles);
                $powerFlags = $this->powerFlagsForProfile($profile, $roles, $config);

                foreach ($roles as $role) {
                    $result['roles'] += $this->upsertRole($profile['oracle_id'], $role);
                }
                foreach ($qualities as $quality) {
                    $result['qualities'] += $this->upsertRoleQuality($profile['oracle_id'], $quality);
                }
                foreach ($conditions as $condition) {
                    $result['conditions'] += $this->upsertCondition($profile['oracle_id'], $condition);
                }
                foreach ($archetypes as $archetype) {
                    $result['archetypes'] += $this->upsertArchetypeSignal($profile['oracle_id'], $archetype);
                }
                foreach ($powerFlags as $powerFlag) {
                    $result['powerFlags'] += $this->upsertPowerFlag($profile['oracle_id'], $powerFlag);
                }
            }

            $this->versionProvider?->touchSemantic();

            return $result;
        });
    }

    private function clearGeneratedData(): void
    {
        $this->connection->executeStatement("DELETE FROM card_role WHERE source IN ('rule', 'scryfall_tag')");
        $this->connection->executeStatement("DELETE FROM card_role_quality WHERE source IN ('rule', 'scryfall_tag')");
        $this->connection->executeStatement("DELETE FROM card_condition WHERE source <> 'manual'");
        $this->connection->executeStatement("DELETE FROM card_archetype_signal WHERE source IN ('rule', 'scryfall_tag')");
        $this->connection->executeStatement("DELETE FROM card_power_flag WHERE source IN ('rule', 'scryfall_tag')");
    }

    /**
     * @return array<string,list<string>>
     */
    private function activeTagsByOracleId(): array
    {
        $tags = [];
        $rows = $this->connection->executeQuery(
            "SELECT oracle_id, tag_slug FROM external_card_tag WHERE active = true AND source = 'scryfall_tagger' ORDER BY oracle_id, tag_slug",
        )->iterateAssociative();

        foreach ($rows as $row) {
            $oracleId = $this->stringOrNull($row['oracle_id'] ?? null);
            $tagSlug = $this->stringOrNull($row['tag_slug'] ?? null);
            if ($oracleId === null || $tagSlug === null) {
                continue;
            }

            $tags[$oracleId][] = $tagSlug;
        }

        return $tags;
    }

    /**
     * @return array<string,'strong'|'medium'>
     */
    private function comboRelevanceByOracleId(): array
    {
        $table = $this->connection->fetchOne("SELECT to_regclass('public.combo_analysis_profile')");
        if (!is_string($table) || $table === '') {
            return [];
        }

        $relevance = [];
        $rows = $this->connection->executeQuery(
            <<<'SQL'
SELECT
    oracle_id,
    bool_or(
        produces_win
        OR produces_infinite_mana
        OR produces_infinite_damage
        OR jsonb_exists(features, 'lethal_loop')
        OR COALESCE(combo_power_score, 0) >= 40
    ) AS strong
FROM combo_analysis_profile
CROSS JOIN LATERAL jsonb_array_elements_text(required_oracle_ids) AS required(oracle_id)
GROUP BY oracle_id
SQL,
        )->iterateAssociative();

        foreach ($rows as $row) {
            $oracleId = $this->stringOrNull($row['oracle_id'] ?? null);
            if ($oracleId === null) {
                continue;
            }

            $relevance[$oracleId] = $this->boolValue($row['strong'] ?? false) ? 'strong' : 'medium';
        }

        return $relevance;
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    private function profileRows(): iterable
    {
        return $this->connection->executeQuery(
            <<<'SQL'
SELECT
    oracle_id,
    name,
    normalized_name,
    mana_value,
    type_line,
    oracle_text,
    produced_mana,
    is_land,
    is_creature,
    is_artifact,
    is_enchantment,
    is_instant,
    is_sorcery,
    is_game_changer
FROM card_oracle_profile
ORDER BY oracle_id ASC
SQL,
        )->iterateAssociative();
    }

    /**
     * @param array<string,mixed> $row
     * @return array{
     *     oracle_id:string,
     *     name:string,
     *     normalized_name:string,
     *     mana_value:?float,
     *     type_line:?string,
     *     oracle_text:?string,
     *     text:string,
     *     produced_mana:list<mixed>,
     *     is_land:bool,
     *     is_creature:bool,
     *     is_artifact:bool,
     *     is_enchantment:bool,
     *     is_instant:bool,
     *     is_sorcery:bool,
     *     is_game_changer:bool
     * }
     */
    private function normalizeProfile(array $row): array
    {
        $oracleText = $this->stringOrNull($row['oracle_text'] ?? null);

        return [
            'oracle_id' => (string) $row['oracle_id'],
            'name' => (string) $row['name'],
            'normalized_name' => (string) $row['normalized_name'],
            'mana_value' => is_numeric($row['mana_value'] ?? null) ? (float) $row['mana_value'] : null,
            'type_line' => $this->stringOrNull($row['type_line'] ?? null),
            'oracle_text' => $oracleText,
            'text' => mb_strtolower($oracleText ?? ''),
            'produced_mana' => $this->jsonArray($row['produced_mana'] ?? []),
            'is_land' => $this->boolValue($row['is_land'] ?? false),
            'is_creature' => $this->boolValue($row['is_creature'] ?? false),
            'is_artifact' => $this->boolValue($row['is_artifact'] ?? false),
            'is_enchantment' => $this->boolValue($row['is_enchantment'] ?? false),
            'is_instant' => $this->boolValue($row['is_instant'] ?? false),
            'is_sorcery' => $this->boolValue($row['is_sorcery'] ?? false),
            'is_game_changer' => $this->boolValue($row['is_game_changer'] ?? false),
        ];
    }

    /**
     * @param array<string,mixed> $profile
     * @param list<string> $tags
     * @return array<string,array{role:string,subrole:?string,confidence:string,source:string}>
     */
    private function rolesForProfile(array $profile, array $tags, CardSemanticManualConfig $config, ?string $comboRelevance): array
    {
        $roles = [];

        foreach ($tags as $tag) {
            foreach (self::TAG_ROLE_MAP[$tag] ?? [] as $role) {
                if ($role === 'ramp' && $this->isOneShotMana($profile)) {
                    $this->addRole($roles, 'burst_mana', null, '0.85', self::SOURCE_RULE);
                    $this->addRole($roles, 'ritual', null, '0.85', self::SOURCE_RULE);
                    continue;
                }

                $this->addRole($roles, $role, null, '1.00', self::SOURCE_TAG);
            }

            if ($tag === 'mana-rock' && $this->manaFixes($profile)) {
                $this->addRole($roles, 'mana_fixing', null, '0.90', self::SOURCE_TAG);
            }
        }

        if ($profile['is_land']) {
            $this->addRole($roles, 'land', null, '1.00', self::SOURCE_RULE);
        }

        if ($profile['produced_mana'] !== [] && !$profile['is_land'] && !$this->isOneShotMana($profile)) {
            $this->addRole($roles, 'ramp', null, '0.75', self::SOURCE_RULE);
            if ($this->manaFixes($profile)) {
                $this->addRole($roles, 'mana_fixing', null, '0.75', self::SOURCE_RULE);
            }
        }

        if ($this->isOneShotMana($profile)) {
            $this->addRole($roles, 'burst_mana', null, '0.85', self::SOURCE_RULE);
            $this->addRole($roles, 'ritual', null, '0.85', self::SOURCE_RULE);
        }

        if (($profile['is_instant'] || $profile['is_sorcery']) && str_contains($profile['text'], 'counter target')) {
            $this->addRole($roles, 'counterspell', null, '0.80', self::SOURCE_RULE);
        }

        if (preg_match('/\b(destroy|exile) target creature\b/', $profile['text']) === 1
            && !str_contains($profile['text'], 'target creature you control')
            && !str_contains($profile['text'], 'target creature you own')
        ) {
            $this->addRole($roles, 'creature_removal', null, '0.80', self::SOURCE_RULE);
            $this->addRole($roles, 'spot_removal', null, '0.80', self::SOURCE_RULE);
        }

        if ($this->isBoardWipe($profile)) {
            $this->addRole($roles, 'board_wipe', null, '0.80', self::SOURCE_RULE);
        }

        if ($this->createsTokens($profile)) {
            $this->addRole($roles, 'token_maker', null, '0.80', self::SOURCE_RULE);
        }

        if ($this->isSacrificeOutlet($profile)) {
            $this->addRole($roles, 'sacrifice_outlet', null, '0.80', self::SOURCE_RULE);
        }

        if ($this->isAristocratsPayoff($profile)) {
            $this->addRole($roles, 'payoff', null, '0.80', self::SOURCE_RULE);
            $this->addRole($roles, 'payoff', 'aristocrats_payoff', '0.78', self::SOURCE_RULE);
        }

        if ($this->isSacrificePayoff($profile)) {
            $this->addRole($roles, 'payoff', null, '0.72', self::SOURCE_RULE);
            $this->addRole($roles, 'payoff', 'sacrifice_payoff', '0.72', self::SOURCE_RULE);
        }

        if ($this->isCostReducer($profile)) {
            $this->addRole($roles, 'cost_reducer', null, '0.80', self::SOURCE_RULE);
        }

        if ($this->drawsCards($profile)) {
            $drawRole = preg_match('/\b(draw|draws) (a|one) card\b/', $profile['text']) === 1 ? 'card_selection' : 'draw';
            $this->addRole($roles, $drawRole, null, '0.70', self::SOURCE_RULE);
        }

        if ($this->isTutor($profile)) {
            $this->addRole($roles, 'tutor', null, '0.80', self::SOURCE_RULE);
        }

        if ($this->reanimatesFromGraveyard($profile)) {
            $this->addRole($roles, 'reanimation', null, '0.85', self::SOURCE_RULE);
        } elseif ($this->recursFromGraveyard($profile)) {
            $this->addRole($roles, 'recursion', null, '0.80', self::SOURCE_RULE);
        }

        if (preg_match('/\b(target player|target opponent|each opponent|each player) discards?\b/', $profile['text']) === 1) {
            $this->addRole($roles, 'discard', null, '0.70', self::SOURCE_RULE);
        }

        if (preg_match('/\bwhenever (an|one or more) opponents? discards?\b/', $profile['text']) === 1) {
            $this->addRole($roles, 'payoff', null, '0.70', self::SOURCE_RULE);
            $this->addRole($roles, 'payoff', 'discard_payoff', '0.70', self::SOURCE_RULE);
        }

        if ($this->isGraveyardEnabler($profile)) {
            $this->addRole($roles, 'enabler', null, '0.70', self::SOURCE_RULE);
        }

        if ($this->isGraveyardHate($profile)) {
            $this->addRole($roles, 'graveyard_hate', null, '0.75', self::SOURCE_RULE);
        }

        if ($this->isTaxEffect($profile)) {
            $this->addRole($roles, 'tax', null, '0.75', self::SOURCE_RULE);
        }

        if ($this->isStaxEffect($profile)) {
            $this->addRole($roles, 'stax', null, '0.75', self::SOURCE_RULE);
            foreach ($this->staxSubroles($profile) as $subrole) {
                $this->addRole($roles, 'stax', $subrole, '0.72', self::SOURCE_RULE);
            }
        }

        if (str_contains($profile['text'], 'gain life') || str_contains($profile['text'], 'gains life') || preg_match('/\byou gain \d+ life\b/', $profile['text']) === 1) {
            $this->addRole($roles, 'lifegain', null, '0.65', self::SOURCE_RULE);
        }

        if ($this->protectsCards($profile) || $this->protectsStackOrTurn($profile)) {
            $this->addRole($roles, 'protection', null, '0.75', self::SOURCE_RULE);
        }

        if ($this->isBlinkEffect($profile)) {
            $this->addRole($roles, 'enabler', 'blink', '0.75', self::SOURCE_RULE);
            $this->addRole($roles, 'enabler', 'blink_enabler', '0.75', self::SOURCE_RULE);
        }

        if ($this->isEtbPayoff($profile)) {
            $this->addRole($roles, 'payoff', 'etb', '0.75', self::SOURCE_RULE);
        }

        if ($this->isWinCondition($profile)) {
            $this->addRole($roles, 'wincon', null, '0.80', self::SOURCE_RULE);
        }

        if ($this->isCombatFinisher($profile)) {
            $this->addRole($roles, 'combat_finisher', null, '0.80', self::SOURCE_RULE);
        }

        foreach ($this->combatSubroles($profile) as $subrole) {
            $this->addRole($roles, 'enabler', $subrole, $subrole === 'extra_combat_engine' ? '0.82' : '0.68', self::SOURCE_RULE);
        }

        if ($this->isExtraCombatEngine($profile)) {
            $this->addRole($roles, 'extra_combat', 'extra_combat_engine', '0.82', self::SOURCE_RULE);
            $this->addRole($roles, 'combo_piece', null, '0.75', self::SOURCE_RULE);
        }

        if ($config->hasPowerFlag('compact_wincon', $profile['name'])
            || $config->hasPowerFlag('mana_positive_combo_piece', $profile['name'])
            || $this->isCompactTutorByName($profile)
        ) {
            $this->addRole($roles, 'combo_piece', null, '0.90', self::SOURCE_RULE);
        }

        if ($comboRelevance !== null) {
            $this->addRole($roles, 'combo_piece', null, $comboRelevance === 'strong' ? '0.90' : '0.75', self::SOURCE_RULE);
        }

        if ($config->hasPowerFlag('fast_mana', $profile['name'])) {
            $this->addRole($roles, 'fast_mana', null, '1.00', self::SOURCE_RULE);
            $this->addRole($roles, 'ramp', null, '1.00', self::SOURCE_RULE);
        }

        if ($this->isCompactTutorByName($profile)) {
            $this->removeRoles($roles, ['draw', 'card_selection', 'board_wipe']);
        }

        $this->applyConservativeTaxonomy($profile, $roles);

        return $roles;
    }

    /**
     * @param array<string,array{role:string,subrole:?string,confidence:string,source:string}> $roles
     */
    private function addRole(array &$roles, string $role, ?string $subrole, string $confidence, string $source): void
    {
        $normalizedRole = CardAnalysisTaxonomy::assertRole($role);
        $key = $normalizedRole.'|'.($subrole ?? '');
        $existing = $roles[$key] ?? null;
        if ($existing !== null && (float) $existing['confidence'] >= (float) $confidence && $existing['source'] === self::SOURCE_TAG) {
            return;
        }

        $roles[$key] = [
            'role' => $normalizedRole,
            'subrole' => $subrole,
            'confidence' => $confidence,
            'source' => $source === self::SOURCE_TAG ? self::SOURCE_TAG : self::SOURCE_RULE,
        ];
    }

    /**
     * @param array<string,array{role:string,subrole:?string,confidence:string,source:string}> $roles
     * @param list<string> $roleNames
     */
    private function removeRoles(array &$roles, array $roleNames): void
    {
        $remove = array_fill_keys($roleNames, true);
        foreach ($roles as $key => $role) {
            if (isset($remove[$role['role']])) {
                unset($roles[$key]);
            }
        }
    }

    /**
     * @param array<string,mixed> $profile
     * @param array<string,array{role:string,subrole:?string,confidence:string,source:string}> $roles
     */
    private function applyConservativeTaxonomy(array $profile, array &$roles): void
    {
        if ($this->isOneShotSacrifice($profile)) {
            $this->removeRoles($roles, ['sacrifice_outlet']);
            $this->addRole($roles, 'enabler', 'one_shot_sacrifice', '0.70', self::SOURCE_RULE);
        } elseif ($this->isSelfSacrifice($profile)) {
            $this->removeRoles($roles, ['sacrifice_outlet']);
            $this->addRole($roles, 'enabler', 'self_sacrifice', '0.70', self::SOURCE_RULE);
        }

        $boardWipeKind = $this->boardWipeKind($profile);
        if ($boardWipeKind !== 'board_wipe') {
            $this->removeRoles($roles, ['board_wipe']);
            if ($boardWipeKind !== null) {
                $this->addRole($roles, 'enabler', $boardWipeKind, '0.68', self::SOURCE_RULE);
            }
        }

        $tutorKind = $this->tutorKind($profile);
        if ($tutorKind === 'true_tutor' || $tutorKind === 'typed_tutor') {
            if ($this->hasRoleEntry($roles, 'tutor')) {
                $this->addRole($roles, 'tutor', $tutorKind, '0.80', self::SOURCE_RULE);
            }
        } elseif ($tutorKind === 'land_tutor' || $tutorKind === 'opponent_tutor') {
            $this->removeRoles($roles, ['tutor']);
            $this->addRole($roles, 'enabler', $tutorKind, '0.70', self::SOURCE_RULE);
        } elseif ($tutorKind === 'ramp_search') {
            $this->removeRoles($roles, ['tutor']);
            $this->addRole($roles, 'ramp', 'ramp_search', '0.72', self::SOURCE_RULE);
        } else {
            $this->removeRoles($roles, ['tutor']);
        }

        if ($this->isSelfLibraryExile($profile) && !$this->hasActualExileRemoval($profile)) {
            $this->removeRoles($roles, ['spot_removal', 'creature_removal', 'artifact_removal', 'enchantment_removal', 'board_wipe']);
        }

        if ($this->hasRoleEntry($roles, 'wincon') && !$this->isWinCondition($profile)) {
            $this->removeRoles($roles, ['wincon']);
        }
        if ($this->hasRoleEntry($roles, 'combat_finisher') && !$this->isCombatFinisher($profile)) {
            $this->removeRoles($roles, ['combat_finisher']);
        }

        if ($this->isOneShotMana($profile)) {
            if ($this->hasRoleEntry($roles, 'burst_mana')) {
                $this->addRole($roles, 'burst_mana', 'one_shot', '0.85', self::SOURCE_RULE);
            }
            if ($this->hasRoleEntry($roles, 'ritual')) {
                $this->addRole($roles, 'ritual', 'one_shot', '0.85', self::SOURCE_RULE);
            }
            if ($this->hasRoleEntry($roles, 'ramp')) {
                $this->addRole($roles, 'ramp', 'one_shot', '0.70', self::SOURCE_RULE);
            }
        } elseif ($this->hasRoleEntry($roles, 'ramp') && !$profile['is_land']) {
            $this->addRole($roles, 'ramp', 'permanent_ramp', '0.72', self::SOURCE_RULE);
        }
    }

    /**
     * @param array<string,array{role:string,subrole:?string,confidence:string,source:string}> $roles
     */
    private function hasRoleEntry(array $roles, string $roleName): bool
    {
        foreach ($roles as $role) {
            if ($role['role'] === $roleName) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string,mixed> $profile
     * @return list<array{condition_key:string,required_role:?string,required_count:?int,risk_if_unmet:string,description:string,source:string}>
     */
    private function conditionsForProfile(array $profile, CardSemanticManualConfig $config): array
    {
        $conditions = [];
        foreach ($config->conditionsForName($profile['name']) as $conditionKey) {
            $conditionKey = CardAnalysisTaxonomy::assertCondition($conditionKey);
            $conditions[$conditionKey] = [
                'condition_key' => $conditionKey,
                'required_role' => $this->requiredRoleForCondition($conditionKey),
                'required_count' => $this->requiredCountForCondition($conditionKey),
                'risk_if_unmet' => 'medium',
                'description' => $this->conditionDescription($conditionKey),
                'source' => self::SOURCE_RULE,
            ];
        }

        if (str_contains($profile['text'], 'if you control your commander') || str_contains($profile['text'], 'if you control a commander')) {
            $this->addCondition($conditions, 'requires_commander_on_battlefield');
        }
        if (str_contains($profile['text'], 'metalcraft')) {
            $this->addCondition($conditions, 'requires_artifact_density');
        }
        if (str_contains($profile['text'], 'enchantment you control') || str_contains($profile['text'], 'enchantments you control')) {
            $this->addCondition($conditions, 'requires_enchantment_density');
        }
        if (str_contains($profile['text'], 'creatures you control') && str_contains($profile['text'], 'whenever')) {
            $this->addCondition($conditions, 'requires_creature_density');
        }
        if ($this->isAristocratsPayoff($profile)) {
            $this->addCondition($conditions, 'requires_sacrifice_outlets');
        }
        if (str_contains($profile['text'], 'whenever a creature enters') || str_contains($profile['text'], 'whenever one or more creatures enter')) {
            $this->addCondition($conditions, 'requires_token_makers');
        }
        if ($this->reanimatesFromGraveyard($profile)) {
            $this->addCondition($conditions, 'requires_discard_outlets');
        }
        if ($this->isGraveyardEnabler($profile)) {
            $this->addCondition($conditions, 'requires_graveyard_targets');
        }
        if (str_contains($profile['text'], 'discard a card') && !str_contains($profile['text'], 'opponent')) {
            $this->addCondition($conditions, 'requires_graveyard_targets');
        }
        if (str_contains($profile['text'], 'pay life') || str_contains($profile['text'], 'you lose life') || str_contains($profile['text'], 'life total')) {
            $this->addCondition($conditions, 'requires_life_total_support');
        }
        if (str_contains($profile['text'], 'magecraft') || str_contains($profile['text'], 'storm') || str_contains($profile['text'], 'instant and sorcery spells')) {
            $this->addCondition($conditions, 'requires_spell_density');
        }
        if (str_contains($profile['text'], 'whenever you cast an instant') || str_contains($profile['text'], 'instant card')) {
            $this->addCondition($conditions, 'requires_instant_density');
        }
        if (str_contains($profile['text'], 'equipped creature') || str_contains($profile['text'], 'enchanted creature') || str_contains($profile['text'], 'equipment you control') || str_contains($profile['text'], 'auras you control')) {
            $this->addCondition($conditions, 'requires_equipment_or_auras');
        }
        if ($this->hasSymmetricalStaxRisk($profile)) {
            $this->addCondition($conditions, 'symmetrical_stax_risk');
        }

        return array_values($conditions);
    }

    /**
     * @param array<string,mixed> $profile
     * @param array<string,array{role:string,subrole:?string,confidence:string,source:string}> $roles
     * @param list<array{condition_key:string,required_role:?string,required_count:?int,risk_if_unmet:string,description:string,source:string}> $conditions
     * @return list<array{role:string,quality:string,speed:string,repeatability:string,mana_efficiency:string,conditionality:string,score:int,source:string,notes:?string}>
     */
    private function qualitiesForProfile(array $profile, array $roles, array $conditions, CardSemanticManualConfig $config): array
    {
        $qualities = [];
        $roleNames = $this->roleNames($roles);
        $manaValue = $profile['mana_value'];
        $repeatability = $this->repeatability($profile);
        $conditionality = $conditions === [] ? 'low' : 'conditional';

        if (isset($roleNames['ramp']) || isset($roleNames['fast_mana']) || isset($roleNames['burst_mana'])) {
            $role = isset($roleNames['fast_mana']) ? 'fast_mana' : (isset($roleNames['burst_mana']) ? 'burst_mana' : 'ramp');
            $premium = isset($roleNames['fast_mana']) || $config->hasQualityName('premium_fast_mana', $profile['name']);
            $oneShot = isset($roleNames['ritual']) || $repeatability === 'one_shot';
            $manaQuality = [
                'role' => $role,
                'quality' => $premium ? 'premium' : ($manaValue !== null && $manaValue <= 2.0 && !$oneShot ? 'good' : ($manaValue !== null && $manaValue >= 3.0 ? 'slow' : 'medium')),
                'speed' => $premium ? 'fast' : ($manaValue !== null && $manaValue <= 2.0 ? 'fast' : 'slow'),
                'repeatability' => $oneShot ? 'one_shot' : $repeatability,
                'mana_efficiency' => $premium || ($manaValue !== null && $manaValue <= 2.0) ? 'high' : 'medium',
                'conditionality' => $conditionality,
                'score' => $premium ? 95 : (($manaValue !== null && $manaValue <= 2.0) ? 80 : 55),
                'source' => self::SOURCE_RULE,
                'notes' => $premium ? 'Known premium fast mana.' : null,
            ];
            $qualities[$role] = $manaQuality;
            if ($role === 'fast_mana' && isset($roleNames['ramp'])) {
                $qualities['ramp'] = [...$manaQuality, 'role' => 'ramp'];
            }
            if ($role !== 'burst_mana' && isset($roleNames['burst_mana'])) {
                $qualities['burst_mana'] = [
                    ...$manaQuality,
                    'role' => 'burst_mana',
                    'repeatability' => 'one_shot',
                    'notes' => 'One-shot burst mana.',
                ];
            }
            if (isset($roleNames['ritual'])) {
                $qualities['ritual'] = [
                    ...$manaQuality,
                    'role' => 'ritual',
                    'repeatability' => 'one_shot',
                    'notes' => 'One-shot ritual or burst-mana effect.',
                ];
            }
        }

        if (isset($roleNames['tutor'])) {
            $premium = $config->hasQualityName('premium_tutor', $profile['name']);
            $good = $premium || $config->hasQualityName('good_tutor', $profile['name']);
            $conditional = $this->isConditionalTutor($profile);
            $qualities['tutor'] = [
                'role' => 'tutor',
                'quality' => $premium ? 'premium' : ($good ? 'good' : ($conditional ? 'conditional' : (($manaValue !== null && $manaValue >= 3.0) ? 'medium' : 'good'))),
                'speed' => $manaValue !== null && $manaValue <= 2.0 ? 'fast' : (($manaValue !== null && $manaValue >= 4.0) ? 'slow' : 'medium'),
                'repeatability' => $repeatability,
                'mana_efficiency' => $premium || ($manaValue !== null && $manaValue <= 2.0) ? 'high' : 'medium',
                'conditionality' => $conditional ? 'conditional' : $conditionality,
                'score' => $premium ? 95 : ($good ? 84 : (($manaValue !== null && $manaValue >= 3.0) ? 65 : 76)),
                'source' => self::SOURCE_RULE,
                'notes' => $conditional ? 'Limited or conditional tutor.' : null,
            ];
        }

        if (isset($roleNames['draw'])) {
            $premium = $config->hasQualityName('premium_draw', $profile['name']);
            $qualities['draw'] = [
                'role' => 'draw',
                'quality' => $premium ? 'premium' : ($manaValue !== null && $manaValue <= 2.0 ? 'good' : ($manaValue !== null && $manaValue >= 4.0 ? 'slow' : 'medium')),
                'speed' => $manaValue !== null && $manaValue <= 2.0 ? 'fast' : ($manaValue !== null && $manaValue >= 4.0 ? 'slow' : 'medium'),
                'repeatability' => $repeatability,
                'mana_efficiency' => $premium || ($manaValue !== null && $manaValue <= 2.0) ? 'high' : 'medium',
                'conditionality' => $conditionality,
                'score' => $premium ? 95 : (($manaValue !== null && $manaValue <= 2.0) ? 78 : 58),
                'source' => self::SOURCE_RULE,
                'notes' => $premium ? 'Known premium draw engine.' : null,
            ];
        }

        if (isset($roleNames['counterspell'])) {
            $premium = $config->hasQualityName('premium_counterspell', $profile['name']);
            $good = $premium || $config->hasQualityName('good_counterspell', $profile['name']);
            $conditional = $this->isConditionalCounterspell($profile);
            $qualities['counterspell'] = [
                'role' => 'counterspell',
                'quality' => $premium ? 'premium' : ($good ? 'good' : ($conditional ? 'conditional' : (($manaValue !== null && $manaValue >= 3.0) ? 'medium' : 'good'))),
                'speed' => $manaValue !== null && $manaValue <= 2.0 ? 'fast' : (($manaValue !== null && $manaValue >= 3.0) ? 'medium' : 'fast'),
                'repeatability' => $repeatability,
                'mana_efficiency' => $premium || ($manaValue !== null && $manaValue <= 2.0) ? 'high' : 'medium',
                'conditionality' => $conditional ? 'conditional' : $conditionality,
                'score' => $premium ? 92 : ($good ? 82 : (($manaValue !== null && $manaValue >= 3.0) ? 62 : 74)),
                'source' => self::SOURCE_RULE,
                'notes' => $premium ? 'Known premium interaction.' : null,
            ];
        }

        if (isset($roleNames['protection'])) {
            $premium = $config->hasQualityName('premium_protection', $profile['name']);
            $good = $premium || $config->hasQualityName('good_protection', $profile['name']);
            $qualities['protection'] = [
                'role' => 'protection',
                'quality' => $premium ? 'premium' : ($good ? 'good' : (($manaValue !== null && $manaValue >= 4.0) ? 'slow' : 'medium')),
                'speed' => $manaValue !== null && $manaValue <= 2.0 ? 'fast' : 'medium',
                'repeatability' => $repeatability,
                'mana_efficiency' => $premium || ($manaValue !== null && $manaValue <= 2.0) ? 'high' : 'medium',
                'conditionality' => $conditionality,
                'score' => $premium ? 90 : ($good ? 78 : 62),
                'source' => self::SOURCE_RULE,
                'notes' => $conditionality === 'conditional' ? 'Requires supporting board state.' : null,
            ];
        }

        if (isset($roleNames['spot_removal']) || isset($roleNames['creature_removal']) || isset($roleNames['artifact_removal']) || isset($roleNames['enchantment_removal'])) {
            $flexible = isset($roleNames['spot_removal']) && (isset($roleNames['artifact_removal']) || isset($roleNames['enchantment_removal']));
            $qualities['spot_removal'] = [
                'role' => 'spot_removal',
                'quality' => $manaValue !== null && $manaValue <= 2.0 ? 'good' : ($manaValue === 3.0 ? 'medium' : ($manaValue !== null && $manaValue >= 4.0 ? 'slow' : 'medium')),
                'speed' => $manaValue !== null && $manaValue <= 2.0 ? 'fast' : ($manaValue !== null && $manaValue >= 4.0 ? 'slow' : 'medium'),
                'repeatability' => $repeatability,
                'mana_efficiency' => $manaValue !== null && $manaValue <= 2.0 ? 'high' : 'medium',
                'conditionality' => $conditionality,
                'score' => ($manaValue !== null && $manaValue <= 2.0 ? 78 : 58) + ($flexible ? 8 : 0),
                'source' => self::SOURCE_RULE,
                'notes' => $flexible ? 'Flexible removal coverage.' : null,
            ];
        }

        if (isset($roleNames['board_wipe'])) {
            $qualities['board_wipe'] = [
                'role' => 'board_wipe',
                'quality' => $manaValue !== null && $manaValue <= 4.0 ? 'good' : (($manaValue !== null && $manaValue >= 5.0) ? 'slow' : 'medium'),
                'speed' => $manaValue !== null && $manaValue <= 4.0 ? 'medium' : 'slow',
                'repeatability' => $repeatability,
                'mana_efficiency' => $manaValue !== null && $manaValue <= 4.0 ? 'high' : 'medium',
                'conditionality' => $conditionality,
                'score' => $manaValue !== null && $manaValue <= 4.0 ? 78 : 58,
                'source' => self::SOURCE_RULE,
                'notes' => null,
            ];
        }

        foreach (['combo_piece', 'wincon', 'token_maker', 'sacrifice_outlet', 'payoff', 'enabler', 'graveyard_hate', 'reanimation', 'recursion', 'cost_reducer', 'combat_finisher', 'extra_combat', 'stax', 'tax'] as $role) {
            if (!isset($roleNames[$role]) || isset($qualities[$role])) {
                continue;
            }

            $qualities[$role] = $this->genericRoleQuality($role, $manaValue, $repeatability, $conditionality, $config->hasPowerFlag('compact_wincon', $profile['name']));
        }

        return array_values($qualities);
    }

    /**
     * @param array<string,mixed> $profile
     * @param array<string,array{role:string,subrole:?string,confidence:string,source:string}> $roles
     * @return list<array{archetype:string,weight:int,source:string,evidence:?string}>
     */
    private function archetypesForProfile(array $profile, array $roles): array
    {
        $signals = [];
        $roleNames = $this->roleNames($roles);
        $subroleNames = $this->subroleNames($roles);

        if (isset($roleNames['reanimation']) || isset($roleNames['recursion']) || isset($roleNames['graveyard_hate'])) {
            $this->addSignal($signals, 'reanimator', 4, 'graveyard/reanimation role');
            $this->addSignal($signals, 'graveyard', 5, 'graveyard role');
        }
        if (isset($roleNames['enabler']) && str_contains($profile['text'], 'graveyard')) {
            $this->addSignal($signals, 'graveyard', 4, 'graveyard enabler');
        }
        if (isset($roleNames['sacrifice_outlet']) || isset($roleNames['payoff'])) {
            $this->addSignal($signals, 'aristocrats', 5, 'sacrifice/payoff role');
            $this->addSignal($signals, 'sacrifice', 5, 'sacrifice/payoff role');
        }
        if (isset($roleNames['token_maker'])) {
            $this->addSignal($signals, 'tokens', 5, 'token maker role');
        }
        if (isset($roleNames['counterspell']) || isset($roleNames['board_wipe']) || isset($roleNames['spot_removal'])) {
            $this->addSignal($signals, 'control', 3, 'interaction role');
        }
        if (isset($roleNames['combo_piece']) || isset($roleNames['wincon']) || isset($roleNames['tutor'])) {
            $this->addSignal($signals, 'combo', 4, 'combo/tutor/wincon role');
        }
        if (isset($roleNames['protection']) || isset($roleNames['combat_finisher']) || $this->hasTypeText($profile, 'Equipment') || $this->hasTypeText($profile, 'Aura')) {
            $this->addSignal($signals, 'voltron', 4, 'protection/equipment/aura signal');
        }
        if (isset($subroleNames['combat_support']) || isset($subroleNames['anthem']) || isset($subroleNames['pump_effect']) || isset($subroleNames['extra_combat_engine'])) {
            $this->addSignal($signals, 'voltron', 3, 'combat support signal');
        }
        if ($this->isSpellslingerSignal($profile, $roleNames)) {
            $this->addSignal($signals, 'spellslinger', 4, 'instant/sorcery utility role');
        }
        if ($this->isArtifactSignal($profile, $roleNames)) {
            $this->addSignal($signals, 'artifacts', 4, 'artifact card type');
        }
        if ($this->isEnchantressSignal($profile, $roleNames)) {
            $this->addSignal($signals, 'enchantress', 4, 'enchantment draw/payoff role');
        }
        if ($this->isTypalSignal($profile, $roleNames)) {
            $this->addSignal($signals, 'typal', 4, 'cost reducer for chosen creature type');
        }
        if (isset($roleNames['stax']) || isset($roleNames['tax'])) {
            $this->addSignal($signals, 'stax', 5, 'stax/tax role');
        }
        if (isset($roleNames['discard'])) {
            $this->addSignal($signals, 'discard', 4, 'discard role');
        }
        if ($this->isTheftSignal($profile)) {
            $this->addSignal($signals, 'theft', 4, 'theft text');
        }
        if (isset($roleNames['lifegain']) || $this->isLifegainSignal($profile)) {
            $this->addSignal($signals, 'lifegain', 4, 'lifegain role');
        }
        if (preg_match('/\bmills?\b/', $profile['text']) === 1 || str_contains($profile['text'], 'library into their graveyard')) {
            $this->addSignal($signals, 'mill', 4, 'mill text');
        }
        if (str_contains($profile['text'], 'landfall') || str_contains($profile['text'], 'whenever a land enters')) {
            $this->addSignal($signals, 'landfall', 5, 'landfall text');
        }
        if (str_contains($profile['text'], 'choose a creature type') || preg_match('/\b(creatures?|[a-z]+s) you control of the chosen type\b/', $profile['text']) === 1) {
            $this->addSignal($signals, 'typal', 4, 'creature type text');
        }
        if ($this->isBlinkEffect($profile) || $this->isEtbPayoff($profile)) {
            $this->addSignal($signals, 'blink', 5, 'exile and return effect');
        }

        return array_values($signals);
    }

    /**
     * @param array<string,array{archetype:string,weight:int,source:string,evidence:?string}> $signals
     */
    private function addSignal(array &$signals, string $archetype, int $weight, ?string $evidence): void
    {
        $signals[$archetype] = [
            'archetype' => $archetype,
            'weight' => $weight,
            'source' => self::SOURCE_RULE,
            'evidence' => $evidence,
        ];
    }

    /**
     * @param array<string,mixed> $profile
     * @param array<string,array{role:string,subrole:?string,confidence:string,source:string}> $roles
     * @return list<array{flag:string,source:string,weight:int}>
     */
    private function powerFlagsForProfile(array $profile, array $roles, CardSemanticManualConfig $config): array
    {
        $flags = [];
        $roleNames = $this->roleNames($roles);

        if ($profile['is_game_changer']) {
            $flags['game_changer'] = ['flag' => 'game_changer', 'source' => self::SOURCE_RULE, 'weight' => 10];
        }
        if (isset($roleNames['fast_mana']) || $config->hasPowerFlag('fast_mana', $profile['name'])) {
            $flags['fast_mana'] = ['flag' => 'fast_mana', 'source' => self::SOURCE_RULE, 'weight' => 8];
        }

        foreach (['free_interaction', 'efficient_tutor', 'compact_wincon', 'cedh_staple', 'high_power_staple', 'mana_positive_combo_piece', 'low_opportunity_cost'] as $flag) {
            if ($config->hasPowerFlag($flag, $profile['name'])) {
                $flags[$flag] = ['flag' => $flag, 'source' => self::SOURCE_RULE, 'weight' => $flag === 'cedh_staple' ? 7 : 8];
            }
        }

        return array_values($flags);
    }

    /**
     * @param array{role:string,subrole:?string,confidence:string,source:string} $role
     */
    private function upsertRole(string $oracleId, array $role): int
    {
        return $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO card_role (
    id,
    oracle_id,
    role,
    subrole,
    confidence,
    source,
    active,
    created_at,
    updated_at
) VALUES (
    :id,
    :oracle_id,
    :role,
    :subrole,
    :confidence,
    :source,
    true,
    NOW(),
    NOW()
)
ON CONFLICT (oracle_id, role, (COALESCE(subrole, ''))) WHERE active = true DO NOTHING
SQL,
            [
                'id' => Uuid::v7()->toRfc4122(),
                'oracle_id' => $oracleId,
                'role' => $role['role'],
                'subrole' => $role['subrole'],
                'confidence' => $role['confidence'],
                'source' => $role['source'],
            ],
        );
    }

    /**
     * @param array{role:string,quality:string,speed:string,repeatability:string,mana_efficiency:string,conditionality:string,score:int,source:string,notes:?string} $quality
     */
    private function upsertRoleQuality(string $oracleId, array $quality): int
    {
        return $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO card_role_quality (
    id,
    oracle_id,
    role,
    quality,
    speed,
    repeatability,
    mana_efficiency,
    conditionality,
    score,
    source,
    notes,
    updated_at
) VALUES (
    :id,
    :oracle_id,
    :role,
    :quality,
    :speed,
    :repeatability,
    :mana_efficiency,
    :conditionality,
    :score,
    :source,
    :notes,
    NOW()
)
ON CONFLICT (oracle_id, role) DO UPDATE SET
    quality = EXCLUDED.quality,
    speed = EXCLUDED.speed,
    repeatability = EXCLUDED.repeatability,
    mana_efficiency = EXCLUDED.mana_efficiency,
    conditionality = EXCLUDED.conditionality,
    score = EXCLUDED.score,
    source = EXCLUDED.source,
    notes = EXCLUDED.notes,
    updated_at = NOW()
WHERE card_role_quality.source <> 'manual'
SQL,
            [
                'id' => Uuid::v7()->toRfc4122(),
                'oracle_id' => $oracleId,
                'role' => $quality['role'],
                'quality' => $quality['quality'],
                'speed' => $quality['speed'],
                'repeatability' => $quality['repeatability'],
                'mana_efficiency' => $quality['mana_efficiency'],
                'conditionality' => $quality['conditionality'],
                'score' => $quality['score'],
                'source' => $quality['source'],
                'notes' => $quality['notes'],
            ],
        );
    }

    /**
     * @param array{condition_key:string,required_role:?string,required_count:?int,risk_if_unmet:string,description:string,source:string} $condition
     */
    private function upsertCondition(string $oracleId, array $condition): int
    {
        return $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO card_condition (
    id,
    oracle_id,
    condition_key,
    required_role,
    required_count,
    risk_if_unmet,
    description,
    source,
    updated_at
) VALUES (
    :id,
    :oracle_id,
    :condition_key,
    :required_role,
    :required_count,
    :risk_if_unmet,
    :description,
    :source,
    NOW()
)
ON CONFLICT (oracle_id, condition_key, source) DO UPDATE SET
    required_role = EXCLUDED.required_role,
    required_count = EXCLUDED.required_count,
    risk_if_unmet = EXCLUDED.risk_if_unmet,
    description = EXCLUDED.description,
    updated_at = NOW()
WHERE card_condition.source <> 'manual'
SQL,
            [
                'id' => Uuid::v7()->toRfc4122(),
                'oracle_id' => $oracleId,
                'condition_key' => $condition['condition_key'],
                'required_role' => $condition['required_role'],
                'required_count' => $condition['required_count'],
                'risk_if_unmet' => $condition['risk_if_unmet'],
                'description' => $condition['description'],
                'source' => $condition['source'],
            ],
        );
    }

    /**
     * @param array{archetype:string,weight:int,source:string,evidence:?string} $signal
     */
    private function upsertArchetypeSignal(string $oracleId, array $signal): int
    {
        return $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO card_archetype_signal (
    id,
    oracle_id,
    archetype,
    weight,
    source,
    evidence,
    updated_at
) VALUES (
    :id,
    :oracle_id,
    :archetype,
    :weight,
    :source,
    :evidence,
    NOW()
)
ON CONFLICT (oracle_id, archetype) DO UPDATE SET
    weight = EXCLUDED.weight,
    source = EXCLUDED.source,
    evidence = EXCLUDED.evidence,
    updated_at = NOW()
WHERE card_archetype_signal.source <> 'manual'
SQL,
            [
                'id' => Uuid::v7()->toRfc4122(),
                'oracle_id' => $oracleId,
                'archetype' => $signal['archetype'],
                'weight' => $signal['weight'],
                'source' => $signal['source'],
                'evidence' => $signal['evidence'],
            ],
        );
    }

    /**
     * @param array{flag:string,source:string,weight:int} $flag
     */
    private function upsertPowerFlag(string $oracleId, array $flag): int
    {
        return $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO card_power_flag (
    id,
    oracle_id,
    flag,
    source,
    weight,
    updated_at
) VALUES (
    :id,
    :oracle_id,
    :flag,
    :source,
    :weight,
    NOW()
)
ON CONFLICT (oracle_id, flag) DO UPDATE SET
    source = EXCLUDED.source,
    weight = EXCLUDED.weight,
    updated_at = NOW()
WHERE card_power_flag.source <> 'manual'
SQL,
            [
                'id' => Uuid::v7()->toRfc4122(),
                'oracle_id' => $oracleId,
                'flag' => $flag['flag'],
                'source' => $flag['source'],
                'weight' => $flag['weight'],
            ],
        );
    }

    /**
     * @param array<string,array{role:string,subrole:?string,confidence:string,source:string}> $roles
     * @return array<string,bool>
     */
    private function roleNames(array $roles): array
    {
        $names = [];
        foreach ($roles as $role) {
            $names[$role['role']] = true;
        }

        return $names;
    }

    /**
     * @param array<string,array{role:string,subrole:?string,confidence:string,source:string}> $roles
     * @return array<string,bool>
     */
    private function subroleNames(array $roles): array
    {
        $names = [];
        foreach ($roles as $role) {
            if ($role['subrole'] !== null) {
                $names[$role['subrole']] = true;
            }
        }

        return $names;
    }

    /**
     * @param array<string,array{condition_key:string,required_role:?string,required_count:?int,risk_if_unmet:string,description:string,source:string}> $conditions
     */
    private function addCondition(array &$conditions, string $conditionKey): void
    {
        $conditionKey = CardAnalysisTaxonomy::assertCondition($conditionKey);
        $conditions[$conditionKey] = [
            'condition_key' => $conditionKey,
            'required_role' => $this->requiredRoleForCondition($conditionKey),
            'required_count' => $this->requiredCountForCondition($conditionKey),
            'risk_if_unmet' => 'medium',
            'description' => $this->conditionDescription($conditionKey),
            'source' => self::SOURCE_RULE,
        ];
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isOneShotMana(array $profile): bool
    {
        if (in_array($profile['normalized_name'], [
            'black lotus',
            'lion\'s eye diamond',
            'lotus petal',
            'turnabout',
            'high tide',
            'culling the weak',
            'dark ritual',
            'cabal ritual',
            'seething song',
            'rite of flame',
            'pyretic ritual',
            'desperate ritual',
            'mana geyser',
            'jeska\'s will',
        ], true)) {
            return true;
        }

        if (preg_match('/\bsacrifice this (artifact|creature|land): add\b/', $profile['text']) === 1
            || preg_match('/\bdiscard your hand, sacrifice this artifact: add\b/', $profile['text']) === 1
        ) {
            return true;
        }

        if (str_contains($profile['text'], 'untap all lands') || preg_match('/\buntap all tapped permanents\b.*\bland\b/', $profile['text']) === 1) {
            return true;
        }

        return ($profile['is_instant'] || $profile['is_sorcery'])
            && (
                $profile['produced_mana'] !== []
                || preg_match('/\badd(s)?\b.*\bmana\b/', $profile['text']) === 1
                || preg_match('/\badd\b.*\{[wubrgc]\}/i', $profile['text']) === 1
            );
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function manaFixes(array $profile): bool
    {
        return count($profile['produced_mana']) > 1
            || str_contains($profile['text'], 'mana of any color')
            || str_contains($profile['text'], 'one mana of any color')
            || str_contains($profile['text'], 'add one mana of any');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function createsTokens(array $profile): bool
    {
        return preg_match('/\b(create|creates|created)\b.*\btokens?\b/', $profile['text']) === 1
            || str_contains($profile['text'], 'populate')
            || in_array($profile['normalized_name'], [
                'bitterblossom',
                'ophiomancer',
                'krenko, mob boss',
                'avenger of zendikar',
                'scute swarm',
                'chatterfang, squirrel general',
            ], true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isSacrificeOutlet(array $profile): bool
    {
        if ($this->isOneShotSacrifice($profile) || $this->isSelfSacrifice($profile)) {
            return false;
        }

        return preg_match('/(^|[,{]\s*|\bpay [^.:]+,\s*)sacrifice (a|another|an|one or more|any number of) (creature|artifact|permanent|token|creatures|artifacts|permanents)(?:[^.:]*)?:/', $profile['text']) === 1
            || in_array($profile['normalized_name'], [
                'goblin bombardment',
                'viscera seer',
                'carrion feeder',
                'yawgmoth, thran physician',
                'ashnod\'s altar',
                'phyrexian altar',
                'altar of dementia',
            ], true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isOneShotSacrifice(array $profile): bool
    {
        if (in_array($profile['normalized_name'], [
            'altar\'s reap',
            'village rites',
            'corrupted conviction',
            'bone splinters',
            'bone shards',
            'burnt offering',
            'culling the weak',
        ], true)) {
            return true;
        }

        if (str_contains($profile['text'], 'as an additional cost to cast this spell, sacrifice')
            || preg_match('/\bto cast this spell, sacrifice\b/', $profile['text']) === 1
        ) {
            return true;
        }

        return ($profile['is_instant'] || $profile['is_sorcery'])
            && preg_match('/\bsacrifice (a|another|an) (creature|artifact|permanent|token)\b/', $profile['text']) === 1;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isSelfSacrifice(array $profile): bool
    {
        if (in_array($profile['normalized_name'], [
            'abzan banner',
            'aether spellbomb',
            'armillary sphere',
            'alseid of life\'s bounty',
            'wayfarer\'s bauble',
            'nihil spellbomb',
            'tormod\'s crypt',
            'lotus petal',
            'lion\'s eye diamond',
            'black lotus',
        ], true)) {
            return true;
        }

        if (preg_match('/\bsacrifice this (artifact|creature|enchantment|land):/', $profile['text']) === 1) {
            return true;
        }

        $frontName = preg_quote($this->frontName($profile), '/');

        return $frontName !== ''
            && preg_match('/\bsacrifice '.$frontName.':/i', $profile['oracle_text'] ?? '') === 1;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function frontName(array $profile): string
    {
        $name = mb_strtolower((string) $profile['name']);
        $parts = explode('//', $name, 2);

        return trim($parts[0]);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isAristocratsPayoff(array $profile): bool
    {
        if (in_array($profile['normalized_name'], [
            'blood artist',
            'zulaport cutthroat',
            'bastion of remembrance',
            'cruel celebrant',
            'mayhem devil',
            'mirkwood bats',
            'pitiless plunderer',
        ], true)) {
            return true;
        }

        if (str_contains($profile['text'], 'whenever you create or sacrifice a token')
            || str_contains($profile['text'], 'whenever you sacrifice')
            || str_contains($profile['text'], 'whenever a player sacrifices')
        ) {
            return str_contains($profile['text'], 'loses')
                || str_contains($profile['text'], 'deals')
                || str_contains($profile['text'], 'create')
                || str_contains($profile['text'], 'draw');
        }

        if (preg_match('/\b(whenever|whenever one or more)\b.*\b(creature|creatures)\b.*\bdies\b/', $profile['text']) !== 1
            && !str_contains($profile['text'], 'whenever another creature dies')
        ) {
            return false;
        }

        return str_contains($profile['text'], 'loses')
            || str_contains($profile['text'], 'lose life')
            || str_contains($profile['text'], 'gain life')
            || str_contains($profile['text'], 'draw')
            || $this->createsTokens($profile);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isSacrificePayoff(array $profile): bool
    {
        if (!str_contains($profile['text'], 'whenever you sacrifice')
            && !str_contains($profile['text'], 'whenever a player sacrifices')
            && !(str_contains($profile['text'], 'whenever one or more') && str_contains($profile['text'], 'sacrific'))
        ) {
            return false;
        }

        return str_contains($profile['text'], 'put a +1/+1 counter')
            || str_contains($profile['text'], 'loses')
            || str_contains($profile['text'], 'deals')
            || str_contains($profile['text'], 'draw')
            || str_contains($profile['text'], 'create')
            || preg_match('/\bgets? \+[0-9x]+\/\+[0-9x]+/', $profile['text']) === 1
            || preg_match('/\byou gain \d+ life\b/', $profile['text']) === 1
            || str_contains($profile['text'], 'add ');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function reanimatesFromGraveyard(array $profile): bool
    {
        return str_contains($profile['text'], 'from your graveyard to the battlefield')
            || str_contains($profile['text'], 'from a graveyard to the battlefield')
            || str_contains($profile['text'], 'from any graveyard to the battlefield')
            || str_contains($profile['text'], 'from a graveyard onto the battlefield')
            || str_contains($profile['text'], 'from your graveyard onto the battlefield')
            || str_contains($profile['text'], 'enchant creature card in a graveyard')
            || str_contains($profile['text'], 'return enchanted creature card to the battlefield');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function drawsCards(array $profile): bool
    {
        if ($this->isCompactTutorByName($profile)) {
            return false;
        }

        return preg_match('/\b(draw|draws|drew|drawn)\b/', $profile['text']) === 1
            || str_contains($profile['text'], 'put that card into your hand')
            && str_contains($profile['text'], 'look at the top');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isTutor(array $profile): bool
    {
        $tutorKind = $this->tutorKind($profile);

        return $tutorKind === 'true_tutor' || $tutorKind === 'typed_tutor';
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function tutorKind(array $profile): ?string
    {
        if ($this->isCompactTutorByName($profile)) {
            return 'true_tutor';
        }

        if ($profile['is_land'] && str_contains($profile['text'], 'search your library')) {
            return null;
        }

        if (preg_match('/\b(search|look through) target opponents?\'?s? library\b/', $profile['text']) === 1
            || str_contains($profile['text'], 'search target opponent\'s library')
            || str_contains($profile['text'], 'search an opponent\'s library')
        ) {
            return 'opponent_tutor';
        }

        if (preg_match('/\btarget opponents? searches? (their|his or her) library\b/', $profile['text']) === 1) {
            return null;
        }

        if (in_array($profile['normalized_name'], [
            'demonic tutor',
            'vampiric tutor',
            'imperial seal',
            'gamble',
            'diabolic intent',
            'grim tutor',
            'personal tutor',
        ], true)) {
            return 'true_tutor';
        }

        if (in_array($profile['normalized_name'], [
            'enlightened tutor',
            'mystical tutor',
            'worldly tutor',
            'stoneforge mystic',
            'fabricate',
            'spellseeker',
            'recruiter of the guard',
            'eladamri\'s call',
        ], true)) {
            return 'typed_tutor';
        }

        if (in_array($profile['normalized_name'], [
            'crop rotation',
            'sylvan scrying',
            'expedition map',
            'tolaria west',
        ], true)) {
            return 'land_tutor';
        }

        if (in_array($profile['normalized_name'], [
            'rampant growth',
            'cultivate',
            'kodama\'s reach',
            'farseek',
            'nature\'s lore',
            'three visits',
            'cleansing wildfire',
            'explosive vegetation',
            'skyshroud claim',
        ], true)) {
            return 'ramp_search';
        }

        if (in_array($profile['normalized_name'], [
            'bribery',
            'acquire',
            'praetor\'s grasp',
        ], true)) {
            return 'opponent_tutor';
        }

        if (str_contains($profile['text'], 'transmute')) {
            return 'typed_tutor';
        }

        if (!str_contains($profile['text'], 'search your library')) {
            return null;
        }

        if (preg_match('/search your library for (a|an|up to one|up to two|any number of)? ?(basic land|basic [a-z ]*land|land) cards?/', $profile['text']) === 1) {
            return preg_match('/\bput (it|that card|them|one) onto the battlefield\b/', $profile['text']) === 1
                || str_contains($profile['text'], 'onto the battlefield tapped')
                ? 'ramp_search'
                : 'land_tutor';
        }

        if (preg_match('/search your library for (a|an|up to one|any number of)? ?(artifact|creature|enchantment|instant|sorcery|equipment|aura|legendary|planeswalker|battle) cards?/', $profile['text']) === 1) {
            return 'typed_tutor';
        }

        return 'true_tutor';
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isCompactTutorByName(array $profile): bool
    {
        return in_array($profile['normalized_name'], [
            'demonic consultation',
            'tainted pact',
            'doomsday',
        ], true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isBoardWipe(array $profile): bool
    {
        return $this->boardWipeKind($profile) === 'board_wipe';
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function boardWipeKind(array $profile): ?string
    {
        if (str_contains($profile['text'], 'exile all other cards revealed this way')
            || str_contains($profile['text'], 'exile the rest')
            || $this->isSelfLibraryExile($profile)
        ) {
            return null;
        }

        if (in_array($profile['normalized_name'], [
            'cyclonic rift',
            'evacuation',
            'aetherize',
            'aetherspouts',
        ], true)
            || preg_match('/\breturn all (creatures|nonland permanents|permanents)\b/', $profile['text']) === 1
            || preg_match('/\breturn (all|each) attacking creatures?\b/', $profile['text']) === 1
        ) {
            return 'mass_bounce';
        }

        if (in_array($profile['normalized_name'], [
            'angel of the dire hour',
            'balefire dragon',
            'blast zone',
            'arcbond',
        ], true)
            || str_contains($profile['text'], 'whenever') && str_contains($profile['text'], 'deals combat damage') && str_contains($profile['text'], 'each creature')
            || str_contains($profile['text'], 'deals combat damage') && str_contains($profile['text'], 'destroy all permanents')
            || preg_match('/\bdestroy each creature with\b/', $profile['text']) === 1
        ) {
            return 'conditional_wipe';
        }

        if (preg_match('/\b(destroy|exile) all (creatures|artifacts|enchantments|nonland permanents|permanents)\b/', $profile['text']) === 1
            || preg_match('/\bdeals? \d+ damage to each creature\b/', $profile['text']) === 1
            || in_array($profile['normalized_name'], [
                'toxic deluge',
                'damnation',
                'wrath of god',
                'farewell',
                'austere command',
                'blasphemous act',
                'vanquish the horde',
                'vandalblast',
                'bane of progress',
                'fire covenant',
                'living death',
                'patriarch\'s bidding',
            ], true)
        ) {
            return 'board_wipe';
        }

        if (preg_match('/\b(exile|destroy) (all|each) (attacking|blocking|tapped) creatures?\b/', $profile['text']) === 1) {
            return 'pseudo_wipe';
        }

        return null;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function recursFromGraveyard(array $profile): bool
    {
        return str_contains($profile['text'], 'from your graveyard to your hand')
            || str_contains($profile['text'], 'from a graveyard to its owner\'s hand')
            || str_contains($profile['text'], 'return target creature card from your graveyard');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isGraveyardEnabler(array $profile): bool
    {
        return str_contains($profile['text'], 'discard a card')
            || str_contains($profile['text'], 'surveil')
            || str_contains($profile['text'], 'mill yourself')
            || str_contains($profile['text'], 'put the top')
            && str_contains($profile['text'], 'into your graveyard');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isGraveyardHate(array $profile): bool
    {
        return str_contains($profile['text'], 'exile target card from a graveyard')
            || str_contains($profile['text'], 'exile all cards from')
            && str_contains($profile['text'], 'graveyard')
            || str_contains($profile['text'], 'cards in graveyards can\'t')
            || str_contains($profile['text'], 'graveyards can\'t')
            || in_array($profile['normalized_name'], [
                'rest in peace',
                'grafdigger\'s cage',
                'leyline of the void',
                'dauthi voidwalker',
            ], true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isSelfLibraryExile(array $profile): bool
    {
        return str_contains($profile['text'], 'exile the top card of your library')
            || str_contains($profile['text'], 'exile the top cards of your library')
            || preg_match('/\bexile the top ([a-z]+|\d+) cards? of your library\b/', $profile['text']) === 1
            || str_contains($profile['text'], 'exile the top six cards of your library')
            || str_contains($profile['text'], 'exile your library')
            || str_contains($profile['text'], 'exile all cards from your library')
            || str_contains($profile['text'], 'exile cards from your library');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function hasActualExileRemoval(array $profile): bool
    {
        return preg_match('/\bexile target (creature|artifact|enchantment|permanent|spell|planeswalker|battle)\b/', $profile['text']) === 1
            || preg_match('/\bexile all (creatures|artifacts|enchantments|permanents|nonland permanents)\b/', $profile['text']) === 1
            || str_contains($profile['text'], 'exile target card from a graveyard');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function hasSymmetricalStaxRisk(array $profile): bool
    {
        if (!$this->isStaxEffect($profile) && !$this->isTaxEffect($profile) && !$this->isGraveyardHate($profile)) {
            return false;
        }

        if (in_array($profile['normalized_name'], [
            'arcane laboratory',
            'archon of emeria',
            'back to basics',
            'blood moon',
            'collector ouphe',
            'deafening silence',
            'eidolon of rhetoric',
            'rule of law',
            'stasis',
            'static orb',
            'trinisphere',
            'winter orb',
            'null rod',
            'stony silence',
            'cursed totem',
            'rest in peace',
            'grafdigger\'s cage',
        ], true)) {
            return true;
        }

        return str_contains($profile['text'], 'each player can\'t cast more than one spell')
            || str_contains($profile['text'], 'each player can cast no more than one spell')
            || str_contains($profile['text'], 'activated abilities of artifacts can\'t be activated')
            || str_contains($profile['text'], 'activated abilities of creatures can\'t be activated')
            || str_contains($profile['text'], 'nonbasic lands are mountains')
            || str_contains($profile['text'], 'nonbasic lands don\'t untap')
            || str_contains($profile['text'], 'players can\'t untap more than one')
            || str_contains($profile['text'], 'graveyards can\'t')
            || str_contains($profile['text'], 'cards in graveyards can\'t');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function protectsCards(array $profile): bool
    {
        foreach (['hexproof', 'indestructible', 'phase out', 'phases out', 'regenerate', 'protection from', 'return it to the battlefield'] as $needle) {
            if (str_contains($profile['text'], $needle)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function protectsStackOrTurn(array $profile): bool
    {
        return str_contains($profile['text'], 'choose new targets')
            || str_contains($profile['text'], 'spells your opponents cast')
            || str_contains($profile['text'], 'can\'t cast spells this turn')
            || str_contains($profile['text'], 'can\'t be countered')
            || str_contains($profile['text'], 'counter target spell that targets')
            || in_array($profile['normalized_name'], [
                'deflecting swat',
                'fierce guardianship',
                'force of will',
                'force of negation',
                'flawless maneuver',
                'deadly rollick',
                'silence',
                'orim\'s chant',
                'grand abolisher',
                'ranger-captain of eos',
                'autumn\'s veil',
                'veil of summer',
                'misdirection',
                'commandeer',
            ], true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isWinCondition(array $profile): bool
    {
        return str_contains($profile['text'], 'you win the game')
            || str_contains($profile['text'], 'each opponent loses the game')
            || in_array($profile['normalized_name'], [
                'exsanguinate',
                'torment of hailfire',
                'debt to the deathless',
            ], true)
            || $this->isKnownCombatFinisher($profile);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isCombatFinisher(array $profile): bool
    {
        if ($this->isKnownCombatFinisher($profile)) {
            return true;
        }

        return $this->isCreatureExtraCombatFinisher($profile);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isKnownCombatFinisher(array $profile): bool
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
        ], true);
    }

    /**
     * @param array<string,mixed> $profile
     * @return list<string>
     */
    private function combatSubroles(array $profile): array
    {
        $subroles = [];

        if ($this->isCombatAnthem($profile)) {
            $subroles['anthem'] = true;
            $subroles['combat_support'] = true;
        }
        if ($this->isLordEffect($profile)) {
            $subroles['lord_effect'] = true;
            $subroles['combat_support'] = true;
        }
        if ($this->isPumpEffect($profile)) {
            $subroles['pump_effect'] = true;
            $subroles['combat_support'] = true;
        }
        if ($this->isCombatTrick($profile)) {
            $subroles['combat_trick'] = true;
        }
        if ($this->isEvasionSupport($profile)) {
            $subroles['evasion_support'] = true;
            $subroles['combat_support'] = true;
        }
        if ($this->isInfectThreat($profile)) {
            $subroles['infect_threat'] = true;
            $subroles['combat_support'] = true;
        }
        if ($this->isExtraCombatEngine($profile)) {
            $subroles['extra_combat_engine'] = true;
        }
        if ($this->hasTypeText($profile, 'Equipment') || $this->hasTypeText($profile, 'Aura')) {
            $subroles['voltron_support'] = true;
        }

        return array_keys($subroles);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isCombatAnthem(array $profile): bool
    {
        return preg_match('/\b(?:non)?token creatures you control get \\+/', $profile['text']) === 1
            || preg_match('/\bcreatures you control get \\+/', $profile['text']) === 1
            || preg_match('/\bother creatures you control get \\+/', $profile['text']) === 1
            || preg_match('/\b[a-z]+s you control get \\+/', $profile['text']) === 1;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isLordEffect(array $profile): bool
    {
        return preg_match('/\bother [a-z]+s you control get \\+/', $profile['text']) === 1
            || preg_match('/\b[a-z]+ creatures you control get \\+/', $profile['text']) === 1
            || str_contains($profile['text'], 'creatures of the chosen type get +');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isPumpEffect(array $profile): bool
    {
        return preg_match('/\b(target|equipped|enchanted) creatures? (?:you control )?gets? \\+/', $profile['text']) === 1
            || preg_match('/\bcreatures you control get \\+/', $profile['text']) === 1
            || preg_match('/\bup to [a-z ]*target creatures?.*gets? \\+/', $profile['text']) === 1;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isCombatTrick(array $profile): bool
    {
        return ($profile['is_instant'] || $profile['is_sorcery'])
            && (
                preg_match('/\btarget creatures?.*gets? \\+/', $profile['text']) === 1
                || preg_match('/\bcreatures you control get \\+/', $profile['text']) === 1
            )
            && str_contains($profile['text'], 'until end of turn');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isEvasionSupport(array $profile): bool
    {
        return preg_match('/\bcreatures you control gain (flying|trample|menace|vigilance|first strike|double strike|lifelink|haste)/', $profile['text']) === 1
            || preg_match('/\b(target|equipped|enchanted) creatures?.*gains? (flying|trample|menace|vigilance|first strike|double strike|lifelink|haste)/', $profile['text']) === 1
            || (
                preg_match('/\bchoose (first strike|vigilance|lifelink|flying|trample|menace|haste|double strike)/', $profile['text']) === 1
                && str_contains($profile['text'], 'creatures you control gain that ability')
            )
            || str_contains($profile['text'], 'can\'t be blocked');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isInfectThreat(array $profile): bool
    {
        return preg_match('/\binfect\b/', $profile['text']) === 1
            || str_contains($profile['text'], 'poison counters');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isExtraCombatEngine(array $profile): bool
    {
        return str_contains($profile['text'], 'additional combat phase')
            || str_contains($profile['text'], 'extra combat phase')
            || str_contains($profile['text'], 'attacks an additional combat');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isCreatureExtraCombatFinisher(array $profile): bool
    {
        return $profile['is_creature']
            && $this->isExtraCombatEngine($profile)
            && (
                str_contains($profile['text'], 'whenever')
                || str_contains($profile['text'], 'deals combat damage')
            );
    }

    /**
     * @param array<string,mixed> $profile
     * @return list<string>
     */
    private function staxSubroles(array $profile): array
    {
        $subroles = [];
        if ($profile['is_creature']) {
            $subroles['hatebear'] = true;
        }
        if (str_contains($profile['text'], 'activated abilities of artifacts can\'t be activated') || str_contains($profile['text'], 'artifacts can\'t')) {
            $subroles['artifact_hate'] = true;
        }
        if (str_contains($profile['text'], 'can\'t draw more than one card')) {
            $subroles['draw_hate'] = true;
        }
        if (str_contains($profile['text'], 'search') && (str_contains($profile['text'], 'library') || str_contains($profile['text'], 'libraries'))) {
            $subroles['search_hate'] = true;
        }
        if (str_contains($profile['text'], 'entering') && str_contains($profile['text'], 'don\'t cause abilities to trigger')) {
            $subroles['etb_hate'] = true;
        }

        return array_keys($subroles);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isCostReducer(array $profile): bool
    {
        foreach ([
            'costs less to cast',
            'cost less to cast',
            'spells you cast cost',
            'creature spells you cast cost',
            'artifact spells you cast cost',
            'instant and sorcery spells you cast cost',
            'activated abilities',
        ] as $needle) {
            if (str_contains($profile['text'], $needle) && preg_match('/costs?\\b[^.]*\\bless/', $profile['text']) === 1) {
                return true;
            }
        }

        return in_array($profile['normalized_name'], [
            'goblin electromancer',
            'baral, chief of compliance',
            'etherium sculptor',
            'foundry inspector',
            'herald\'s horn',
            'urza\'s incubator',
            'cloud key',
            'semblance anvil',
            'jhoira\'s familiar',
            'enthusiastic mechanaut',
            'mizzix of the izmagnus',
        ], true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isTaxEffect(array $profile): bool
    {
        return str_contains($profile['text'], 'costs {1} more to cast')
            || str_contains($profile['text'], 'cost {1} more to cast')
            || str_contains($profile['text'], 'cost less than three mana to cast costs three mana')
            || str_contains($profile['text'], 'attacks you or a planeswalker you control, pay')
            || str_contains($profile['text'], 'unless its controller pays')
            || in_array($profile['normalized_name'], [
                'thalia, guardian of thraben',
                'grand arbiter augustin iv',
                'sphere of resistance',
                'thorn of amethyst',
                'trinisphere',
                'vryn wingmare',
                'damping sphere',
            ], true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isStaxEffect(array $profile): bool
    {
        return str_contains($profile['text'], 'players can\'t cast spells from anywhere other than their hands')
            || str_contains($profile['text'], 'opponents can\'t cast spells from anywhere other than their hands')
            || str_contains($profile['text'], 'each player can\'t cast more than one spell each turn')
            || str_contains($profile['text'], 'can\'t cast more than one noncreature spell each turn')
            || str_contains($profile['text'], 'can\'t cast additional nonartifact spells')
            || str_contains($profile['text'], 'each player can cast no more than one spell each turn')
            || str_contains($profile['text'], 'activated abilities of artifacts can\'t be activated')
            || str_contains($profile['text'], 'activated abilities of creatures can\'t be activated')
            || str_contains($profile['text'], 'activated abilities of creatures your opponents control can\'t be activated')
            || str_contains($profile['text'], 'can\'t draw more than one card')
            || str_contains($profile['text'], 'if an opponent would search')
            || str_contains($profile['text'], 'creatures entering')
            && str_contains($profile['text'], 'don\'t cause abilities to trigger')
            || str_contains($profile['text'], 'nonbasic lands are mountains')
            || str_contains($profile['text'], 'nonbasic lands don\'t untap')
            || str_contains($profile['text'], 'players can\'t untap more than one')
            || in_array($profile['normalized_name'], [
                'drannith magistrate',
                'rule of law',
                'archon of emeria',
                'eidolon of rhetoric',
                'deafening silence',
                'ethersworn canonist',
                'winter orb',
                'static orb',
                'tangle wire',
                'smokestack',
                'stasis',
                'back to basics',
                'blood moon',
                'magus of the moon',
                'collector ouphe',
                'linvala, keeper of silence',
                'null rod',
                'stony silence',
                'cursed totem',
                'aven mindcensor',
                'opposition agent',
                'hushbringer',
                'hushwing gryff',
                'tocatli honor guard',
                'containment priest',
                'grafdigger\'s cage',
                'rest in peace',
                'leyline of the void',
                'dauthi voidwalker',
                'notion thief',
                'narset, parter of veils',
                'spirit of the labyrinth',
                'stranglehold',
                'root maze',
                'blind obedience',
                'lavinia, azorius renegade',
                'gaddock teeg',
                'torpor orb',
            ], true);
    }

    /**
     * @param array<string,mixed> $profile
     * @param array<string,bool> $roleNames
     */
    private function isArtifactSignal(array $profile, array $roleNames): bool
    {
        return $profile['is_artifact']
            || str_contains($profile['text'], 'artifact spells')
            || str_contains($profile['text'], 'whenever you cast an artifact')
            || str_contains($profile['text'], 'artifacts you control')
            || isset($roleNames['cost_reducer']) && str_contains($profile['text'], 'artifact');
    }

    /**
     * @param array<string,mixed> $profile
     * @param array<string,bool> $roleNames
     */
    private function isEnchantressSignal(array $profile, array $roleNames): bool
    {
        return $profile['is_enchantment'] && (isset($roleNames['draw']) || isset($roleNames['payoff']) || isset($roleNames['cost_reducer']))
            || str_contains($profile['text'], 'whenever you cast an enchantment')
            || str_contains($profile['text'], 'whenever an enchantment enters')
            || str_contains($profile['text'], 'enchantments you control');
    }

    /**
     * @param array<string,mixed> $profile
     * @param array<string,bool> $roleNames
     */
    private function isSpellslingerSignal(array $profile, array $roleNames): bool
    {
        if (str_contains($profile['text'], 'whenever you cast an instant or sorcery')
            || str_contains($profile['text'], 'whenever you cast or copy an instant or sorcery')
            || str_contains($profile['text'], 'magecraft')
            || str_contains($profile['text'], 'instant and sorcery spells you cast')
            || str_contains($profile['text'], 'instant or sorcery spells you cast')
        ) {
            return true;
        }

        return (($profile['is_instant'] || $profile['is_sorcery'] || str_contains($profile['text'], 'instant or sorcery') || str_contains($profile['text'], 'instant and sorcery') || str_contains($profile['text'], 'magecraft') || str_contains($profile['text'], 'storm'))
            && (isset($roleNames['draw']) || isset($roleNames['card_selection']) || isset($roleNames['counterspell']) || isset($roleNames['cost_reducer']) || isset($roleNames['ritual']) || isset($roleNames['token_maker']) || isset($roleNames['payoff'])));
    }

    /**
     * @param array<string,mixed> $profile
     * @param array<string,bool> $roleNames
     */
    private function isTypalSignal(array $profile, array $roleNames): bool
    {
        return str_contains($profile['text'], 'choose a creature type')
            || str_contains($profile['text'], 'creatures of the chosen type')
            || str_contains($profile['text'], 'creature type')
            && isset($roleNames['cost_reducer'])
            || preg_match('/\bother [a-z]+s you control\b/', $profile['text']) === 1
            || preg_match('/\bwhenever you cast an? [a-z]+ spell\b/', $profile['text']) === 1;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isTheftSignal(array $profile): bool
    {
        return str_contains($profile['text'], 'gain control')
            || str_contains($profile['text'], 'cast spells from opponents')
            || str_contains($profile['text'], 'you may play')
            && str_contains($profile['text'], 'exile')
            && str_contains($profile['text'], 'opponent');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isLifegainSignal(array $profile): bool
    {
        return str_contains($profile['text'], 'whenever you gain life')
            || str_contains($profile['text'], 'you gain that much life')
            || str_contains($profile['text'], 'you gain life, each opponent loses')
            || preg_match('/\byou gain \d+ life\b/', $profile['text']) === 1;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isEtbPayoff(array $profile): bool
    {
        return str_contains($profile['text'], 'if a triggered ability')
            && str_contains($profile['text'], 'entering')
            || str_contains($profile['text'], 'triggers an additional time')
            || in_array($profile['normalized_name'], [
                'panharmonicon',
                'yarok, the desecrated',
                'roaming throne',
                'soulherder',
                'brago, king eternal',
                'displacer kitten',
            ], true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isConditionalTutor(array $profile): bool
    {
        return preg_match('/search your library for (an?|up to one) (artifact|creature|enchantment|instant|sorcery|land|basic|legendary)/', $profile['text']) === 1;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isConditionalCounterspell(array $profile): bool
    {
        return str_contains($profile['text'], 'unless its controller pays')
            || str_contains($profile['text'], 'noncreature spell')
            || str_contains($profile['text'], 'activated or triggered ability');
    }

    /**
     * @return array{role:string,quality:string,speed:string,repeatability:string,mana_efficiency:string,conditionality:string,score:int,source:string,notes:?string}
     */
    private function genericRoleQuality(string $role, ?float $manaValue, string $repeatability, string $conditionality, bool $compactWincon): array
    {
        $lowCost = $manaValue !== null && $manaValue <= 2.0;
        $expensive = $manaValue !== null && $manaValue >= 5.0;
        $score = $compactWincon ? 88 : ($lowCost ? 76 : ($expensive ? 55 : 66));

        return [
            'role' => $role,
            'quality' => $compactWincon ? 'premium' : ($lowCost ? 'good' : ($expensive ? 'slow' : 'medium')),
            'speed' => $lowCost ? 'fast' : ($expensive ? 'slow' : 'medium'),
            'repeatability' => $repeatability,
            'mana_efficiency' => $lowCost || $compactWincon ? 'high' : 'medium',
            'conditionality' => $conditionality,
            'score' => $score,
            'source' => self::SOURCE_RULE,
            'notes' => $compactWincon ? 'Known compact win condition or combo piece.' : null,
        ];
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isBlinkEffect(array $profile): bool
    {
        return str_contains($profile['text'], 'exile')
            && (
                str_contains($profile['text'], 'return it to the battlefield')
                || str_contains($profile['text'], 'return that card to the battlefield')
                || str_contains($profile['text'], 'return those cards to the battlefield')
                || str_contains($profile['text'], 'return them to the battlefield')
            );
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function repeatability(array $profile): string
    {
        return ($profile['is_instant'] || $profile['is_sorcery']) ? 'one_shot' : 'permanent';
    }

    private function requiredRoleForCondition(string $conditionKey): ?string
    {
        return match ($conditionKey) {
            'requires_artifact_density' => 'artifact',
            'requires_enchantment_density' => 'enchantment',
            'requires_creature_density', 'requires_small_creatures_or_tokens' => 'creature',
            'requires_token_makers' => 'token_maker',
            'requires_graveyard_targets' => 'reanimation',
            'requires_discard_outlets' => 'discard',
            'requires_sacrifice_outlets' => 'sacrifice_outlet',
            'requires_spell_density' => 'instant',
            'requires_instant_density' => 'instant',
            'requires_combo_plan' => 'combo_piece',
            'symmetrical_stax_risk' => null,
            default => null,
        };
    }

    private function requiredCountForCondition(string $conditionKey): ?int
    {
        return match ($conditionKey) {
            'requires_artifact_density', 'requires_enchantment_density', 'requires_creature_density' => 10,
            'requires_small_creatures_or_tokens', 'requires_token_makers', 'requires_graveyard_targets' => 8,
            'requires_swamp_density' => 8,
            'requires_spell_density' => 18,
            'requires_instant_density' => 10,
            'requires_legendary_permanents' => 8,
            'requires_combo_plan' => 1,
            'symmetrical_stax_risk' => null,
            default => null,
        };
    }

    private function conditionDescription(string $conditionKey): string
    {
        return match ($conditionKey) {
            'requires_commander_on_battlefield' => 'Works best when the commander is on the battlefield.',
            'requires_low_curve' => 'Needs a low average mana value to reduce self-damage risk.',
            'requires_artifact_density' => 'Needs enough artifacts to be reliable.',
            'requires_enchantment_density' => 'Needs enough enchantments to be reliable.',
            'requires_creature_density' => 'Needs enough creatures to be reliable.',
            'requires_small_creatures_or_tokens' => 'Needs small creatures or tokens to convert into value.',
            'requires_token_makers' => 'Needs enough token makers to be reliable.',
            'requires_graveyard_targets' => 'Needs meaningful graveyard targets.',
            'requires_discard_outlets' => 'Needs discard outlets to set up graveyard lines.',
            'requires_sacrifice_outlets' => 'Needs sacrifice outlets to convert board state into value.',
            'requires_life_total_support' => 'Needs life total support.',
            'requires_spell_density' => 'Needs enough instants and sorceries.',
            'requires_instant_density' => 'Needs enough instant-speed cards.',
            'requires_equipment_or_auras' => 'Needs enough equipment or auras.',
            'requires_swamp_density' => 'Needs enough Swamps or swamp-type lands.',
            'requires_legendary_permanents' => 'Needs enough legendary permanents.',
            'requires_combo_plan' => 'Needs a clear combo plan to justify the slot.',
            'symmetrical_stax_risk' => 'May also restrict the pilot deck and needs deck construction support.',
            default => 'Needs supporting deck structure.',
        };
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function hasTypeText(array $profile, string $type): bool
    {
        return preg_match('/\b'.preg_quote($type, '/').'\b/i', (string) $profile['type_line']) === 1;
    }

    /**
     * @return list<mixed>
     */
    private function jsonArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (!is_string($value) || trim($value) === '') {
            return [];
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : [];
    }

    private function stringOrNull(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = trim((string) $value);

        return $string !== '' ? $string : null;
    }

    private function boolValue(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if (is_int($value)) {
            return $value === 1;
        }

        if (!is_string($value)) {
            return false;
        }

        return in_array(mb_strtolower(trim($value)), ['1', 'true', 't', 'yes', 'y'], true);
    }
}
