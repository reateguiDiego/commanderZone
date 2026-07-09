<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;

final class CardBoardWipeProfileRebuilder
{
    public function __construct(
        private readonly Connection $connection,
        private readonly CardBoardWipeClassifier $classifier,
    ) {
    }

    /**
     * @return array{totalProcessed:int,seen:int,inserted:int,updated:int,skipped:int,wipes:int,boardWipes:int,creatureWipes:int,artifactWipes:int,enchantmentWipes:int,graveyardWipes:int,modalWipes:int,asymmetricalWipes:int,overloadedMassModes:int,pseudoWipes:int,conditionalWipes:int,answersIndestructible:int,unknownNeedsReview:int,dataVersion:string}
     */
    public function rebuild(): array
    {
        return $this->connection->transactional(function (): array {
            $existingHashes = $this->existingHashes();
            $stats = [
                'totalProcessed' => 0,
                'seen' => 0,
                'inserted' => 0,
                'updated' => 0,
                'skipped' => 0,
                'wipes' => 0,
                'boardWipes' => 0,
                'creatureWipes' => 0,
                'artifactWipes' => 0,
                'enchantmentWipes' => 0,
                'graveyardWipes' => 0,
                'modalWipes' => 0,
                'asymmetricalWipes' => 0,
                'overloadedMassModes' => 0,
                'pseudoWipes' => 0,
                'conditionalWipes' => 0,
                'answersIndestructible' => 0,
                'unknownNeedsReview' => 0,
                'dataVersion' => '',
            ];
            $hash = hash_init('sha256');

            foreach ($this->profileRows() as $row) {
                ++$stats['totalProcessed'];
                ++$stats['seen'];
                $oracleId = trim((string) ($row['oracle_id'] ?? ''));
                if ($oracleId === '') {
                    ++$stats['skipped'];
                    continue;
                }

                $profile = $this->classifier->classify($row);
                $profile['analysis_hash'] = $this->analysisHash($profile);
                hash_update($hash, json_encode($profile, JSON_THROW_ON_ERROR));
                $this->collectStats($stats, $profile);

                $existingHash = $existingHashes[$oracleId] ?? null;
                if ($existingHash === null) {
                    $this->upsertProfile($profile);
                    ++$stats['inserted'];
                    continue;
                }

                if ($existingHash === $profile['analysis_hash']) {
                    ++$stats['skipped'];
                    continue;
                }

                $this->upsertProfile($profile);
                ++$stats['updated'];
            }

            $stats['dataVersion'] = 'sha256:'.hash_final($hash);
            (new DeckAnalysisDataVersionProvider($this->connection))->setBoardWipeVersion($stats['dataVersion']);

            return $stats;
        });
    }

    /**
     * @return array<string,string>
     */
    private function existingHashes(): array
    {
        $hashes = [];
        foreach ($this->connection->executeQuery('SELECT oracle_id, analysis_hash FROM card_board_wipe_profile')->iterateAssociative() as $row) {
            $hashes[(string) $row['oracle_id']] = (string) $row['analysis_hash'];
        }

        return $hashes;
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
    colors,
    color_identity,
    is_instant,
    is_sorcery
FROM card_oracle_profile
ORDER BY oracle_id ASC
SQL,
        )->iterateAssociative();
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function upsertProfile(array $profile): void
    {
        $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO card_board_wipe_profile (
    oracle_id,
    name,
    type_line,
    oracle_text,
    mana_value,
    colors,
    color_identity,
    is_board_wipe,
    is_creature_wipe,
    is_noncreature_wipe,
    is_permanent_wipe,
    is_pseudo_wipe,
    is_mass_removal,
    is_spot_removal_with_mass_mode,
    board_wipe_type,
    wipe_method,
    wipe_scope,
    symmetry_profile,
    is_instant_speed,
    is_sorcery_speed,
    is_permanent_activated,
    is_triggered_wipe,
    is_repeatable,
    is_delayed,
    printed_mana_value,
    effective_cost_min,
    has_cost_reduction,
    cost_reduction_condition,
    is_scalable,
    x_spell,
    has_modes,
    modal_choices_count,
    has_alternative_mass_mode,
    alternative_cost_type,
    alternative_mass_cost,
    base_mode_type,
    mass_mode_type,
    answers_indestructible,
    answers_regeneration,
    gets_around_hexproof_shroud,
    gets_around_ward,
    exiles_graveyards,
    prevents_rebuild,
    prevents_graveyard_recursion,
    leaves_own_board,
    protects_own_board,
    can_be_built_around,
    harms_own_board,
    rebuild_advantage,
    opponent_compensation,
    commander_playability_band,
    high_power_viable,
    cedh_viable,
    token_deck_risk,
    creature_deck_risk,
    artifact_deck_risk,
    enchantment_deck_risk,
    graveyard_deck_risk,
    needs_manual_review,
    analysis_hash,
    updated_at
) VALUES (
    :oracle_id,
    :name,
    :type_line,
    :oracle_text,
    :mana_value,
    :colors::jsonb,
    :color_identity::jsonb,
    :is_board_wipe,
    :is_creature_wipe,
    :is_noncreature_wipe,
    :is_permanent_wipe,
    :is_pseudo_wipe,
    :is_mass_removal,
    :is_spot_removal_with_mass_mode,
    :board_wipe_type,
    :wipe_method::jsonb,
    :wipe_scope::jsonb,
    :symmetry_profile,
    :is_instant_speed,
    :is_sorcery_speed,
    :is_permanent_activated,
    :is_triggered_wipe,
    :is_repeatable,
    :is_delayed,
    :printed_mana_value,
    :effective_cost_min,
    :has_cost_reduction,
    :cost_reduction_condition,
    :is_scalable,
    :x_spell,
    :has_modes,
    :modal_choices_count,
    :has_alternative_mass_mode,
    :alternative_cost_type,
    :alternative_mass_cost,
    :base_mode_type,
    :mass_mode_type,
    :answers_indestructible,
    :answers_regeneration,
    :gets_around_hexproof_shroud,
    :gets_around_ward,
    :exiles_graveyards,
    :prevents_rebuild,
    :prevents_graveyard_recursion,
    :leaves_own_board,
    :protects_own_board,
    :can_be_built_around,
    :harms_own_board,
    :rebuild_advantage,
    :opponent_compensation,
    :commander_playability_band,
    :high_power_viable,
    :cedh_viable,
    :token_deck_risk,
    :creature_deck_risk,
    :artifact_deck_risk,
    :enchantment_deck_risk,
    :graveyard_deck_risk,
    :needs_manual_review,
    :analysis_hash,
    NOW()
)
ON CONFLICT (oracle_id) DO UPDATE SET
    name = EXCLUDED.name,
    type_line = EXCLUDED.type_line,
    oracle_text = EXCLUDED.oracle_text,
    mana_value = EXCLUDED.mana_value,
    colors = EXCLUDED.colors,
    color_identity = EXCLUDED.color_identity,
    is_board_wipe = EXCLUDED.is_board_wipe,
    is_creature_wipe = EXCLUDED.is_creature_wipe,
    is_noncreature_wipe = EXCLUDED.is_noncreature_wipe,
    is_permanent_wipe = EXCLUDED.is_permanent_wipe,
    is_pseudo_wipe = EXCLUDED.is_pseudo_wipe,
    is_mass_removal = EXCLUDED.is_mass_removal,
    is_spot_removal_with_mass_mode = EXCLUDED.is_spot_removal_with_mass_mode,
    board_wipe_type = EXCLUDED.board_wipe_type,
    wipe_method = EXCLUDED.wipe_method,
    wipe_scope = EXCLUDED.wipe_scope,
    symmetry_profile = EXCLUDED.symmetry_profile,
    is_instant_speed = EXCLUDED.is_instant_speed,
    is_sorcery_speed = EXCLUDED.is_sorcery_speed,
    is_permanent_activated = EXCLUDED.is_permanent_activated,
    is_triggered_wipe = EXCLUDED.is_triggered_wipe,
    is_repeatable = EXCLUDED.is_repeatable,
    is_delayed = EXCLUDED.is_delayed,
    printed_mana_value = EXCLUDED.printed_mana_value,
    effective_cost_min = EXCLUDED.effective_cost_min,
    has_cost_reduction = EXCLUDED.has_cost_reduction,
    cost_reduction_condition = EXCLUDED.cost_reduction_condition,
    is_scalable = EXCLUDED.is_scalable,
    x_spell = EXCLUDED.x_spell,
    has_modes = EXCLUDED.has_modes,
    modal_choices_count = EXCLUDED.modal_choices_count,
    has_alternative_mass_mode = EXCLUDED.has_alternative_mass_mode,
    alternative_cost_type = EXCLUDED.alternative_cost_type,
    alternative_mass_cost = EXCLUDED.alternative_mass_cost,
    base_mode_type = EXCLUDED.base_mode_type,
    mass_mode_type = EXCLUDED.mass_mode_type,
    answers_indestructible = EXCLUDED.answers_indestructible,
    answers_regeneration = EXCLUDED.answers_regeneration,
    gets_around_hexproof_shroud = EXCLUDED.gets_around_hexproof_shroud,
    gets_around_ward = EXCLUDED.gets_around_ward,
    exiles_graveyards = EXCLUDED.exiles_graveyards,
    prevents_rebuild = EXCLUDED.prevents_rebuild,
    prevents_graveyard_recursion = EXCLUDED.prevents_graveyard_recursion,
    leaves_own_board = EXCLUDED.leaves_own_board,
    protects_own_board = EXCLUDED.protects_own_board,
    can_be_built_around = EXCLUDED.can_be_built_around,
    harms_own_board = EXCLUDED.harms_own_board,
    rebuild_advantage = EXCLUDED.rebuild_advantage,
    opponent_compensation = EXCLUDED.opponent_compensation,
    commander_playability_band = EXCLUDED.commander_playability_band,
    high_power_viable = EXCLUDED.high_power_viable,
    cedh_viable = EXCLUDED.cedh_viable,
    token_deck_risk = EXCLUDED.token_deck_risk,
    creature_deck_risk = EXCLUDED.creature_deck_risk,
    artifact_deck_risk = EXCLUDED.artifact_deck_risk,
    enchantment_deck_risk = EXCLUDED.enchantment_deck_risk,
    graveyard_deck_risk = EXCLUDED.graveyard_deck_risk,
    needs_manual_review = EXCLUDED.needs_manual_review,
    analysis_hash = EXCLUDED.analysis_hash,
    updated_at = NOW()
SQL,
            $this->dbParameters($profile),
            $this->dbTypes(),
        );
    }

    /**
     * @param array<string,mixed> $profile
     * @return array<string,mixed>
     */
    private function dbParameters(array $profile): array
    {
        return [
            ...$profile,
            'colors' => json_encode($profile['colors'], JSON_THROW_ON_ERROR),
            'color_identity' => json_encode($profile['color_identity'], JSON_THROW_ON_ERROR),
            'wipe_method' => json_encode($profile['wipe_method'], JSON_THROW_ON_ERROR),
            'wipe_scope' => json_encode($profile['wipe_scope'], JSON_THROW_ON_ERROR),
        ];
    }

    /**
     * @return array<string,int>
     */
    private function dbTypes(): array
    {
        return [
            'is_board_wipe' => ParameterType::BOOLEAN,
            'is_creature_wipe' => ParameterType::BOOLEAN,
            'is_noncreature_wipe' => ParameterType::BOOLEAN,
            'is_permanent_wipe' => ParameterType::BOOLEAN,
            'is_pseudo_wipe' => ParameterType::BOOLEAN,
            'is_mass_removal' => ParameterType::BOOLEAN,
            'is_spot_removal_with_mass_mode' => ParameterType::BOOLEAN,
            'is_instant_speed' => ParameterType::BOOLEAN,
            'is_sorcery_speed' => ParameterType::BOOLEAN,
            'is_permanent_activated' => ParameterType::BOOLEAN,
            'is_triggered_wipe' => ParameterType::BOOLEAN,
            'is_repeatable' => ParameterType::BOOLEAN,
            'is_delayed' => ParameterType::BOOLEAN,
            'has_cost_reduction' => ParameterType::BOOLEAN,
            'is_scalable' => ParameterType::BOOLEAN,
            'x_spell' => ParameterType::BOOLEAN,
            'has_modes' => ParameterType::BOOLEAN,
            'has_alternative_mass_mode' => ParameterType::BOOLEAN,
            'answers_indestructible' => ParameterType::BOOLEAN,
            'answers_regeneration' => ParameterType::BOOLEAN,
            'gets_around_hexproof_shroud' => ParameterType::BOOLEAN,
            'gets_around_ward' => ParameterType::BOOLEAN,
            'exiles_graveyards' => ParameterType::BOOLEAN,
            'prevents_rebuild' => ParameterType::BOOLEAN,
            'prevents_graveyard_recursion' => ParameterType::BOOLEAN,
            'leaves_own_board' => ParameterType::BOOLEAN,
            'protects_own_board' => ParameterType::BOOLEAN,
            'can_be_built_around' => ParameterType::BOOLEAN,
            'harms_own_board' => ParameterType::BOOLEAN,
            'rebuild_advantage' => ParameterType::BOOLEAN,
            'high_power_viable' => ParameterType::BOOLEAN,
            'cedh_viable' => ParameterType::BOOLEAN,
            'token_deck_risk' => ParameterType::BOOLEAN,
            'creature_deck_risk' => ParameterType::BOOLEAN,
            'artifact_deck_risk' => ParameterType::BOOLEAN,
            'enchantment_deck_risk' => ParameterType::BOOLEAN,
            'graveyard_deck_risk' => ParameterType::BOOLEAN,
            'needs_manual_review' => ParameterType::BOOLEAN,
        ];
    }

    /**
     * @param array<string,int|string> $stats
     * @param array<string,mixed> $profile
     */
    private function collectStats(array &$stats, array $profile): void
    {
        $type = (string) ($profile['board_wipe_type'] ?? 'other');
        $symmetry = (string) ($profile['symmetry_profile'] ?? 'unknown');
        $scopes = is_array($profile['wipe_scope'] ?? null) ? $profile['wipe_scope'] : [];
        $isBoardWipe = (bool) ($profile['is_board_wipe'] ?? false);

        if (!$isBoardWipe) {
            if ($profile['needs_manual_review']) {
                ++$stats['unknownNeedsReview'];
            }

            return;
        }

        if ($isBoardWipe) {
            ++$stats['wipes'];
            ++$stats['boardWipes'];
        }
        if ($profile['is_creature_wipe']) {
            ++$stats['creatureWipes'];
        }
        if (in_array('artifacts', $scopes, true)) {
            ++$stats['artifactWipes'];
        }
        if (in_array('enchantments', $scopes, true)) {
            ++$stats['enchantmentWipes'];
        }
        if (in_array('graveyards', $scopes, true)) {
            ++$stats['graveyardWipes'];
        }
        if ($profile['has_modes']) {
            ++$stats['modalWipes'];
        }
        if (in_array($symmetry, ['asymmetrical', 'one_sided', 'opponents_only', 'controller_choice', 'creature_type_asymmetry'], true)) {
            ++$stats['asymmetricalWipes'];
        }
        if ($profile['has_alternative_mass_mode']) {
            ++$stats['overloadedMassModes'];
        }
        if ($profile['is_pseudo_wipe']) {
            ++$stats['pseudoWipes'];
        }
        if ($type === 'conditional_wipe') {
            ++$stats['conditionalWipes'];
        }
        if ($profile['answers_indestructible']) {
            ++$stats['answersIndestructible'];
        }
        if ($profile['needs_manual_review']) {
            ++$stats['unknownNeedsReview'];
        }
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function analysisHash(array $profile): string
    {
        $hashData = $profile;
        unset($hashData['analysis_hash']);
        ksort($hashData);

        return hash('sha256', json_encode($hashData, JSON_THROW_ON_ERROR));
    }
}
