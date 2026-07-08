<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;

final class CardAnalysisProfileRebuilder
{
    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @return array{seen:int,inserted:int,updated:int,skipped:int}
     */
    public function rebuild(): array
    {
        return $this->connection->transactional(function (): array {
            $existingHashes = $this->existingHashes();
            $rolesByOracleId = $this->rolesByOracleId();
            $roleScoresByOracleId = $this->roleScoresByOracleId();
            $conditionKeysByOracleId = $this->conditionKeysByOracleId();
            $archetypeWeightsByOracleId = $this->archetypeWeightsByOracleId();
            $powerFlagsByOracleId = $this->powerFlagsByOracleId();

            $result = [
                'seen' => 0,
                'inserted' => 0,
                'updated' => 0,
                'skipped' => 0,
            ];

            foreach ($this->profileRows() as $row) {
                ++$result['seen'];
                $oracleId = (string) $row['oracle_id'];
                $roleData = $rolesByOracleId[$oracleId] ?? ['roles' => [], 'subroles' => []];
                $powerFlags = $powerFlagsByOracleId[$oracleId] ?? [];
                $profile = $this->analysisProfile(
                    $row,
                    $roleData['roles'],
                    $roleData['subroles'],
                    $roleScoresByOracleId[$oracleId] ?? [],
                    $conditionKeysByOracleId[$oracleId] ?? [],
                    $archetypeWeightsByOracleId[$oracleId] ?? [],
                    $powerFlags,
                );

                $existingHash = $existingHashes[$oracleId] ?? null;
                if ($existingHash === null) {
                    $this->insertProfile($profile);
                    ++$result['inserted'];
                    continue;
                }

                if ($existingHash === $profile['analysis_hash']) {
                    ++$result['skipped'];
                    continue;
                }

                $this->updateProfile($profile);
                ++$result['updated'];
            }

            return $result;
        });
    }

    /**
     * @return array<string,string>
     */
    private function existingHashes(): array
    {
        $hashes = [];
        foreach ($this->connection->executeQuery('SELECT oracle_id, analysis_hash FROM card_analysis_profile')->iterateAssociative() as $row) {
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
    mana_cost,
    mana_value,
    type_line,
    colors,
    color_identity,
    produced_mana,
    keywords,
    commander_legal,
    commander_banned,
    can_be_commander,
    is_land,
    is_creature,
    is_artifact,
    is_enchantment,
    is_instant,
    is_sorcery,
    is_planeswalker,
    is_battle,
    is_legendary,
    edhrec_rank,
    is_game_changer
FROM card_oracle_profile
ORDER BY oracle_id ASC
SQL,
        )->iterateAssociative();
    }

    /**
     * @return array<string,array{roles:list<string>,subroles:list<string>}>
     */
    private function rolesByOracleId(): array
    {
        $roles = [];
        foreach ($this->connection->executeQuery(
            "SELECT oracle_id, role, subrole FROM card_role WHERE active = true ORDER BY oracle_id, role, subrole",
        )->iterateAssociative() as $row) {
            $oracleId = (string) $row['oracle_id'];
            $role = $this->stringOrNull($row['role'] ?? null);
            if ($role !== null) {
                $roles[$oracleId]['roles'][$role] = true;
            }

            $subrole = $this->stringOrNull($row['subrole'] ?? null);
            if ($subrole !== null) {
                $roles[$oracleId]['subroles'][$subrole] = true;
            }
        }

        $normalized = [];
        foreach ($roles as $oracleId => $data) {
            $normalized[$oracleId] = [
                'roles' => $this->sortedKeys($data['roles'] ?? []),
                'subroles' => $this->sortedKeys($data['subroles'] ?? []),
            ];
        }

        return $normalized;
    }

    /**
     * @return array<string,array<string,array{quality:string,speed:string,repeatability:string,mana_efficiency:string,conditionality:string,score:int}>>
     */
    private function roleScoresByOracleId(): array
    {
        $scores = [];
        foreach ($this->connection->executeQuery(
            <<<'SQL'
SELECT
    oracle_id,
    role,
    quality,
    speed,
    repeatability,
    mana_efficiency,
    conditionality,
    score
FROM card_role_quality
ORDER BY oracle_id, role
SQL,
        )->iterateAssociative() as $row) {
            $oracleId = (string) $row['oracle_id'];
            $role = (string) $row['role'];
            $scores[$oracleId][$role] = [
                'quality' => (string) $row['quality'],
                'speed' => (string) $row['speed'],
                'repeatability' => (string) $row['repeatability'],
                'mana_efficiency' => (string) $row['mana_efficiency'],
                'conditionality' => (string) $row['conditionality'],
                'score' => (int) $row['score'],
            ];
        }

        foreach ($scores as &$roleScores) {
            ksort($roleScores);
        }
        unset($roleScores);

        return $scores;
    }

    /**
     * @return array<string,list<string>>
     */
    private function conditionKeysByOracleId(): array
    {
        $conditions = [];
        foreach ($this->connection->executeQuery(
            'SELECT oracle_id, condition_key FROM card_condition ORDER BY oracle_id, condition_key',
        )->iterateAssociative() as $row) {
            $oracleId = (string) $row['oracle_id'];
            $conditionKey = $this->stringOrNull($row['condition_key'] ?? null);
            if ($conditionKey !== null) {
                $conditions[$oracleId][$conditionKey] = true;
            }
        }

        return $this->sortedKeyListsByOracleId($conditions);
    }

    /**
     * @return array<string,array<string,int>>
     */
    private function archetypeWeightsByOracleId(): array
    {
        $weights = [];
        foreach ($this->connection->executeQuery(
            'SELECT oracle_id, archetype, weight FROM card_archetype_signal ORDER BY oracle_id, archetype',
        )->iterateAssociative() as $row) {
            $oracleId = (string) $row['oracle_id'];
            $archetype = $this->stringOrNull($row['archetype'] ?? null);
            if ($archetype === null) {
                continue;
            }

            $weights[$oracleId][$archetype] = ($weights[$oracleId][$archetype] ?? 0) + (int) $row['weight'];
        }

        foreach ($weights as &$oracleWeights) {
            ksort($oracleWeights);
        }
        unset($oracleWeights);

        return $weights;
    }

    /**
     * @return array<string,list<string>>
     */
    private function powerFlagsByOracleId(): array
    {
        $flags = [];
        foreach ($this->connection->executeQuery(
            'SELECT oracle_id, flag FROM card_power_flag ORDER BY oracle_id, flag',
        )->iterateAssociative() as $row) {
            $oracleId = (string) $row['oracle_id'];
            $flag = $this->stringOrNull($row['flag'] ?? null);
            if ($flag !== null) {
                $flags[$oracleId][$flag] = true;
            }
        }

        return $this->sortedKeyListsByOracleId($flags);
    }

    /**
     * @param array<string,mixed> $row
     * @param list<string> $roles
     * @param list<string> $subroles
     * @param array<string,array{quality:string,speed:string,repeatability:string,mana_efficiency:string,conditionality:string,score:int}> $roleScores
     * @param list<string> $conditionKeys
     * @param array<string,int> $archetypeWeights
     * @param list<string> $powerFlags
     * @return array<string,mixed>
     */
    private function analysisProfile(
        array $row,
        array $roles,
        array $subroles,
        array $roleScores,
        array $conditionKeys,
        array $archetypeWeights,
        array $powerFlags,
    ): array {
        $roleSet = array_fill_keys($roles, true);
        $powerFlagSet = array_fill_keys($powerFlags, true);

        $profile = [
            'oracle_id' => (string) $row['oracle_id'],
            'name' => (string) $row['name'],
            'normalized_name' => (string) $row['normalized_name'],
            'mana_cost' => $this->stringOrNull($row['mana_cost'] ?? null),
            'mana_value' => is_numeric($row['mana_value'] ?? null) ? (float) $row['mana_value'] : null,
            'type_line' => $this->stringOrNull($row['type_line'] ?? null),
            'colors' => $this->jsonArray($row['colors'] ?? []),
            'color_identity' => $this->jsonArray($row['color_identity'] ?? []),
            'produced_mana' => $this->jsonArray($row['produced_mana'] ?? []),
            'keywords' => $this->jsonArray($row['keywords'] ?? []),
            'commander_legal' => $this->boolValue($row['commander_legal'] ?? false),
            'commander_banned' => $this->boolValue($row['commander_banned'] ?? false),
            'can_be_commander' => $this->boolValue($row['can_be_commander'] ?? false),
            'is_land' => $this->boolValue($row['is_land'] ?? false),
            'is_creature' => $this->boolValue($row['is_creature'] ?? false),
            'is_artifact' => $this->boolValue($row['is_artifact'] ?? false),
            'is_enchantment' => $this->boolValue($row['is_enchantment'] ?? false),
            'is_instant' => $this->boolValue($row['is_instant'] ?? false),
            'is_sorcery' => $this->boolValue($row['is_sorcery'] ?? false),
            'is_planeswalker' => $this->boolValue($row['is_planeswalker'] ?? false),
            'is_battle' => $this->boolValue($row['is_battle'] ?? false),
            'is_legendary' => $this->boolValue($row['is_legendary'] ?? false),
            'edhrec_rank' => is_numeric($row['edhrec_rank'] ?? null) ? (int) $row['edhrec_rank'] : null,
            'is_game_changer' => $this->boolValue($row['is_game_changer'] ?? false),
            'roles' => $roles,
            'subroles' => $subroles,
            'role_scores' => $roleScores,
            'condition_keys' => $conditionKeys,
            'archetype_weights' => $archetypeWeights,
            'power_flags' => $powerFlags,
            'is_fast_mana' => isset($powerFlagSet['fast_mana']) || isset($roleSet['fast_mana']),
            'is_free_interaction' => isset($powerFlagSet['free_interaction']),
            'is_efficient_tutor' => isset($powerFlagSet['efficient_tutor']),
            'is_cedh_staple' => isset($powerFlagSet['cedh_staple']),
        ];
        $profile['analysis_hash'] = $this->analysisHash($profile);

        return $profile;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function insertProfile(array $profile): void
    {
        $this->connection->executeStatement(
            $this->insertSql(),
            $this->dbParameters($profile),
            $this->dbTypes(),
        );
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function updateProfile(array $profile): void
    {
        $this->connection->executeStatement(
            <<<'SQL'
UPDATE card_analysis_profile SET
    name = :name,
    normalized_name = :normalized_name,
    mana_cost = :mana_cost,
    mana_value = :mana_value,
    type_line = :type_line,
    colors = :colors,
    color_identity = :color_identity,
    produced_mana = :produced_mana,
    keywords = :keywords,
    commander_legal = :commander_legal,
    commander_banned = :commander_banned,
    can_be_commander = :can_be_commander,
    is_land = :is_land,
    is_creature = :is_creature,
    is_artifact = :is_artifact,
    is_enchantment = :is_enchantment,
    is_instant = :is_instant,
    is_sorcery = :is_sorcery,
    is_planeswalker = :is_planeswalker,
    is_battle = :is_battle,
    is_legendary = :is_legendary,
    edhrec_rank = :edhrec_rank,
    is_game_changer = :is_game_changer,
    roles = :roles,
    subroles = :subroles,
    role_scores = :role_scores,
    condition_keys = :condition_keys,
    archetype_weights = :archetype_weights,
    power_flags = :power_flags,
    is_fast_mana = :is_fast_mana,
    is_free_interaction = :is_free_interaction,
    is_efficient_tutor = :is_efficient_tutor,
    is_cedh_staple = :is_cedh_staple,
    analysis_hash = :analysis_hash,
    updated_at = NOW()
WHERE oracle_id = :oracle_id
SQL,
            $this->dbParameters($profile),
            $this->dbTypes(),
        );
    }

    private function insertSql(): string
    {
        return <<<'SQL'
INSERT INTO card_analysis_profile (
    oracle_id,
    name,
    normalized_name,
    mana_cost,
    mana_value,
    type_line,
    colors,
    color_identity,
    produced_mana,
    keywords,
    commander_legal,
    commander_banned,
    can_be_commander,
    is_land,
    is_creature,
    is_artifact,
    is_enchantment,
    is_instant,
    is_sorcery,
    is_planeswalker,
    is_battle,
    is_legendary,
    edhrec_rank,
    is_game_changer,
    roles,
    subroles,
    role_scores,
    condition_keys,
    archetype_weights,
    power_flags,
    is_fast_mana,
    is_free_interaction,
    is_efficient_tutor,
    is_cedh_staple,
    analysis_hash,
    updated_at
) VALUES (
    :oracle_id,
    :name,
    :normalized_name,
    :mana_cost,
    :mana_value,
    :type_line,
    :colors,
    :color_identity,
    :produced_mana,
    :keywords,
    :commander_legal,
    :commander_banned,
    :can_be_commander,
    :is_land,
    :is_creature,
    :is_artifact,
    :is_enchantment,
    :is_instant,
    :is_sorcery,
    :is_planeswalker,
    :is_battle,
    :is_legendary,
    :edhrec_rank,
    :is_game_changer,
    :roles,
    :subroles,
    :role_scores,
    :condition_keys,
    :archetype_weights,
    :power_flags,
    :is_fast_mana,
    :is_free_interaction,
    :is_efficient_tutor,
    :is_cedh_staple,
    :analysis_hash,
    NOW()
)
SQL;
    }

    /**
     * @param array<string,mixed> $profile
     * @return array<string,mixed>
     */
    private function dbParameters(array $profile): array
    {
        return [
            ...$profile,
            'colors' => $this->json($profile['colors']),
            'color_identity' => $this->json($profile['color_identity']),
            'produced_mana' => $this->json($profile['produced_mana']),
            'keywords' => $this->json($profile['keywords']),
            'roles' => $this->json($profile['roles']),
            'subroles' => $this->json($profile['subroles']),
            'role_scores' => $this->json($profile['role_scores']),
            'condition_keys' => $this->json($profile['condition_keys']),
            'archetype_weights' => $this->json($profile['archetype_weights']),
            'power_flags' => $this->json($profile['power_flags']),
        ];
    }

    /**
     * @return array<string,int>
     */
    private function dbTypes(): array
    {
        return [
            'commander_legal' => ParameterType::BOOLEAN,
            'commander_banned' => ParameterType::BOOLEAN,
            'can_be_commander' => ParameterType::BOOLEAN,
            'is_land' => ParameterType::BOOLEAN,
            'is_creature' => ParameterType::BOOLEAN,
            'is_artifact' => ParameterType::BOOLEAN,
            'is_enchantment' => ParameterType::BOOLEAN,
            'is_instant' => ParameterType::BOOLEAN,
            'is_sorcery' => ParameterType::BOOLEAN,
            'is_planeswalker' => ParameterType::BOOLEAN,
            'is_battle' => ParameterType::BOOLEAN,
            'is_legendary' => ParameterType::BOOLEAN,
            'is_game_changer' => ParameterType::BOOLEAN,
            'is_fast_mana' => ParameterType::BOOLEAN,
            'is_free_interaction' => ParameterType::BOOLEAN,
            'is_efficient_tutor' => ParameterType::BOOLEAN,
            'is_cedh_staple' => ParameterType::BOOLEAN,
        ];
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function analysisHash(array $profile): string
    {
        $hashData = $profile;
        unset($hashData['analysis_hash']);

        return hash('sha256', json_encode($this->normalizeForHash($hashData), JSON_THROW_ON_ERROR));
    }

    private function normalizeForHash(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }

        if (!array_is_list($value)) {
            ksort($value);
        }

        foreach ($value as $key => $item) {
            $value[$key] = $this->normalizeForHash($item);
        }

        return $value;
    }

    /**
     * @param array<string,bool> $values
     * @return list<string>
     */
    private function sortedKeys(array $values): array
    {
        $keys = array_keys($values);
        sort($keys, SORT_STRING);

        return array_values($keys);
    }

    /**
     * @param array<string,array<string,bool>> $values
     * @return array<string,list<string>>
     */
    private function sortedKeyListsByOracleId(array $values): array
    {
        $lists = [];
        foreach ($values as $oracleId => $items) {
            $lists[$oracleId] = $this->sortedKeys($items);
        }

        return $lists;
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

    private function json(mixed $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR);
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
