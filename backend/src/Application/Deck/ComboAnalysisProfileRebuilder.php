<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;

final class ComboAnalysisProfileRebuilder
{
    public function __construct(
        private readonly Connection $connection,
        private readonly ?DeckAnalysisDataVersionProvider $versionProvider = null,
    ) {
    }

    /**
     * @return array{seen:int,inserted:int,updated:int,skipped:int}
     */
    public function rebuild(): array
    {
        return $this->connection->transactional(function (): array {
            $existingHashes = $this->existingHashes();
            $cards = $this->cardsByComboVariantId();
            $features = $this->featuresByComboVariantId();
            $requirements = $this->requirementsByComboVariantId();
            $result = [
                'seen' => 0,
                'inserted' => 0,
                'updated' => 0,
                'skipped' => 0,
            ];

            foreach ($this->variantRows() as $variant) {
                ++$result['seen'];
                $comboVariantId = (string) $variant['id'];
                $profile = $this->profileFromVariant(
                    $variant,
                    $cards[$comboVariantId] ?? $this->emptyCards(),
                    $features[$comboVariantId] ?? [],
                    $requirements[$comboVariantId] ?? $this->emptyRequirements(),
                );
                $existingHash = $existingHashes[$comboVariantId] ?? null;

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

            if ($result['inserted'] > 0 || $result['updated'] > 0) {
                $this->versionProvider?->touchCombo();
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
        foreach ($this->connection->executeQuery('SELECT combo_variant_id, analysis_hash FROM combo_analysis_profile')->iterateAssociative() as $row) {
            $hashes[(string) $row['combo_variant_id']] = (string) $row['analysis_hash'];
        }

        return $hashes;
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    private function variantRows(): iterable
    {
        return $this->connection->executeQuery(
            <<<'SQL'
SELECT
    id,
    external_id,
    identity,
    popularity,
    bracket_tag
FROM spellbook_combo_variant
ORDER BY id ASC
SQL,
        )->iterateAssociative();
    }

    /**
     * @return array<string,array{oracleIds:array<string,bool>,cardNames:array<string,bool>,requiredCount:int,requiresCommander:bool,requiresGraveyard:bool,requiresBattlefield:bool}>
     */
    private function cardsByComboVariantId(): array
    {
        $cards = [];
        foreach ($this->connection->executeQuery(
            <<<'SQL'
SELECT
    combo_variant_id,
    oracle_id,
    name,
    quantity,
    zone_locations,
    must_be_commander,
    battlefield_card_state,
    graveyard_card_state
FROM spellbook_combo_card
ORDER BY combo_variant_id, oracle_id
SQL,
        )->iterateAssociative() as $row) {
            $comboVariantId = (string) $row['combo_variant_id'];
            $cards[$comboVariantId] ??= $this->emptyCards();
            $oracleId = $this->stringOrNull($row['oracle_id'] ?? null);
            if ($oracleId !== null) {
                $cards[$comboVariantId]['oracleIds'][$oracleId] = true;
            }
            $name = $this->normalizedName($row['name'] ?? null);
            if ($name !== null) {
                $cards[$comboVariantId]['cardNames'][$name] = true;
            }
            $cards[$comboVariantId]['requiredCount'] += max(1, (int) ($row['quantity'] ?? 1));
            $cards[$comboVariantId]['requiresCommander'] = $cards[$comboVariantId]['requiresCommander'] || $this->boolValue($row['must_be_commander'] ?? false);
            $cards[$comboVariantId]['requiresGraveyard'] = $cards[$comboVariantId]['requiresGraveyard'] || $this->requiresGraveyard($row);
            $cards[$comboVariantId]['requiresBattlefield'] = $cards[$comboVariantId]['requiresBattlefield'] || $this->requiresBattlefield($row);
        }

        return $cards;
    }

    /**
     * @return array{oracleIds:array<string,bool>,cardNames:array<string,bool>,requiredCount:int,requiresCommander:bool,requiresGraveyard:bool,requiresBattlefield:bool}
     */
    private function emptyCards(): array
    {
        return [
            'oracleIds' => [],
            'cardNames' => [],
            'requiredCount' => 0,
            'requiresCommander' => false,
            'requiresGraveyard' => false,
            'requiresBattlefield' => false,
        ];
    }

    /**
     * @return array<string,array<string,bool>>
     */
    private function featuresByComboVariantId(): array
    {
        $features = [];
        foreach ($this->connection->executeQuery(
            <<<'SQL'
SELECT
    combo_feature.combo_variant_id,
    feature.feature_type
FROM spellbook_combo_feature combo_feature
INNER JOIN spellbook_feature feature ON feature.id = combo_feature.feature_id
ORDER BY combo_feature.combo_variant_id, feature.feature_type
SQL,
        )->iterateAssociative() as $row) {
            $comboVariantId = (string) $row['combo_variant_id'];
            $featureType = $this->stringOrNull($row['feature_type'] ?? null) ?? 'other';
            $features[$comboVariantId][$featureType] = true;
        }

        return $features;
    }

    /**
     * @return array<string,array{requirementCount:int,requiresCommander:bool,requiresGraveyard:bool,requiresBattlefield:bool,requiresTemplate:bool}>
     */
    private function requirementsByComboVariantId(): array
    {
        $requirements = [];
        foreach ($this->connection->executeQuery(
            <<<'SQL'
SELECT
    combo_variant_id,
    template_id,
    quantity,
    zone_locations,
    must_be_commander,
    battlefield_card_state,
    graveyard_card_state
FROM spellbook_combo_requirement
ORDER BY combo_variant_id
SQL,
        )->iterateAssociative() as $row) {
            $comboVariantId = (string) $row['combo_variant_id'];
            $requirements[$comboVariantId] ??= $this->emptyRequirements();
            $requirements[$comboVariantId]['requirementCount'] += max(1, (int) ($row['quantity'] ?? 1));
            $requirements[$comboVariantId]['requiresCommander'] = $requirements[$comboVariantId]['requiresCommander'] || $this->boolValue($row['must_be_commander'] ?? false);
            $requirements[$comboVariantId]['requiresGraveyard'] = $requirements[$comboVariantId]['requiresGraveyard'] || $this->requiresGraveyard($row);
            $requirements[$comboVariantId]['requiresBattlefield'] = $requirements[$comboVariantId]['requiresBattlefield'] || $this->requiresBattlefield($row);
            $requirements[$comboVariantId]['requiresTemplate'] = $requirements[$comboVariantId]['requiresTemplate'] || $this->stringOrNull($row['template_id'] ?? null) !== null;
        }

        return $requirements;
    }

    /**
     * @return array{requirementCount:int,requiresCommander:bool,requiresGraveyard:bool,requiresBattlefield:bool,requiresTemplate:bool}
     */
    private function emptyRequirements(): array
    {
        return [
            'requirementCount' => 0,
            'requiresCommander' => false,
            'requiresGraveyard' => false,
            'requiresBattlefield' => false,
            'requiresTemplate' => false,
        ];
    }

    /**
     * @param array<string,mixed> $variant
     * @param array{oracleIds:array<string,bool>,cardNames:array<string,bool>,requiredCount:int,requiresCommander:bool,requiresGraveyard:bool,requiresBattlefield:bool} $cards
     * @param array<string,bool> $featureSet
     * @param array{requirementCount:int,requiresCommander:bool,requiresGraveyard:bool,requiresBattlefield:bool,requiresTemplate:bool} $requirements
     * @return array<string,mixed>
     */
    private function profileFromVariant(array $variant, array $cards, array $featureSet, array $requirements): array
    {
        if ($this->isLethalLoop($cards['cardNames'])) {
            $featureSet['lethal_loop'] = true;
        }

        $requiredOracleIds = array_keys($cards['oracleIds']);
        sort($requiredOracleIds, SORT_STRING);
        $features = array_keys($featureSet);
        sort($features, SORT_STRING);
        $featureMap = array_fill_keys($features, true);
        $requiredCount = min(32767, $cards['requiredCount']);
        $comboSize = min(32767, $cards['requiredCount'] + $requirements['requirementCount']);
        $requiresCommander = $cards['requiresCommander'] || $requirements['requiresCommander'];
        $requiresGraveyard = $cards['requiresGraveyard'] || $requirements['requiresGraveyard'];
        $requiresBattlefield = $cards['requiresBattlefield'] || $requirements['requiresBattlefield'];

        $profile = [
            'combo_variant_id' => (string) $variant['id'],
            'external_id' => (string) $variant['external_id'],
            'required_oracle_ids' => $requiredOracleIds,
            'required_count' => $requiredCount,
            'combo_size' => $comboSize,
            'identity' => $this->jsonArray($variant['identity'] ?? []),
            'features' => $features,
            'produces_win' => isset($featureMap['win_game']),
            'produces_infinite_mana' => isset($featureMap['infinite_mana']),
            'produces_infinite_damage' => isset($featureMap['infinite_damage']),
            'produces_infinite_tokens' => isset($featureMap['infinite_tokens']),
            'produces_infinite_draw' => isset($featureMap['draw']) && (isset($featureMap['infinite_mana']) || isset($featureMap['win_game'])),
            'produces_mill' => isset($featureMap['mill']),
            'produces_lock' => isset($featureMap['lock']),
            'requires_commander' => $requiresCommander,
            'requires_graveyard' => $requiresGraveyard,
            'requires_battlefield' => $requiresBattlefield,
            'requires_template' => $requirements['requiresTemplate'],
            'popularity' => is_numeric($variant['popularity'] ?? null) ? (int) $variant['popularity'] : null,
            'bracket_tag' => $this->stringOrNull($variant['bracket_tag'] ?? null),
        ];
        $profile['combo_power_score'] = $this->powerScore($profile);
        $profile['combo_complexity_score'] = $this->complexityScore($profile);
        $profile['analysis_hash'] = $this->analysisHash($profile);

        return $profile;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function powerScore(array $profile): int
    {
        $score = 0;
        $score += $profile['produces_win'] ? 40 : 0;
        $score += $profile['produces_infinite_mana'] ? 25 : 0;
        $score += $profile['produces_infinite_damage'] ? 20 : 0;
        $score += $profile['produces_infinite_tokens'] ? 15 : 0;
        $score += in_array('lethal_loop', $profile['features'], true) ? 35 : 0;
        $score += in_array($profile['bracket_tag'], ['E', 'S'], true) ? 10 : 0;

        return min(100, $score);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function complexityScore(array $profile): int
    {
        $comboSize = (int) $profile['combo_size'];
        if ($comboSize <= 2 && !$profile['requires_template'] && !$profile['requires_graveyard'] && !$profile['requires_commander']) {
            $score = 100;
        } elseif ($comboSize <= 3) {
            $score = 75;
        } else {
            $score = 50;
        }

        $score -= $profile['requires_template'] ? 10 : 0;
        $score -= $profile['requires_graveyard'] ? 10 : 0;
        $score -= $profile['requires_commander'] ? 10 : 0;

        return max(0, $score);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function insertProfile(array $profile): void
    {
        $this->connection->executeStatement($this->insertSql(), $this->dbParameters($profile), $this->dbTypes());
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function updateProfile(array $profile): void
    {
        $this->connection->executeStatement(
            <<<'SQL'
UPDATE combo_analysis_profile SET
    external_id = :external_id,
    required_oracle_ids = :required_oracle_ids,
    required_count = :required_count,
    combo_size = :combo_size,
    identity = :identity,
    features = :features,
    produces_win = :produces_win,
    produces_infinite_mana = :produces_infinite_mana,
    produces_infinite_damage = :produces_infinite_damage,
    produces_infinite_tokens = :produces_infinite_tokens,
    produces_infinite_draw = :produces_infinite_draw,
    produces_mill = :produces_mill,
    produces_lock = :produces_lock,
    requires_commander = :requires_commander,
    requires_graveyard = :requires_graveyard,
    requires_battlefield = :requires_battlefield,
    requires_template = :requires_template,
    popularity = :popularity,
    bracket_tag = :bracket_tag,
    combo_power_score = :combo_power_score,
    combo_complexity_score = :combo_complexity_score,
    analysis_hash = :analysis_hash,
    updated_at = NOW()
WHERE combo_variant_id = :combo_variant_id
SQL,
            $this->dbParameters($profile),
            $this->dbTypes(),
        );
    }

    private function insertSql(): string
    {
        return <<<'SQL'
INSERT INTO combo_analysis_profile (
    combo_variant_id,
    external_id,
    required_oracle_ids,
    required_count,
    combo_size,
    identity,
    features,
    produces_win,
    produces_infinite_mana,
    produces_infinite_damage,
    produces_infinite_tokens,
    produces_infinite_draw,
    produces_mill,
    produces_lock,
    requires_commander,
    requires_graveyard,
    requires_battlefield,
    requires_template,
    popularity,
    bracket_tag,
    combo_power_score,
    combo_complexity_score,
    analysis_hash,
    updated_at
) VALUES (
    :combo_variant_id,
    :external_id,
    :required_oracle_ids,
    :required_count,
    :combo_size,
    :identity,
    :features,
    :produces_win,
    :produces_infinite_mana,
    :produces_infinite_damage,
    :produces_infinite_tokens,
    :produces_infinite_draw,
    :produces_mill,
    :produces_lock,
    :requires_commander,
    :requires_graveyard,
    :requires_battlefield,
    :requires_template,
    :popularity,
    :bracket_tag,
    :combo_power_score,
    :combo_complexity_score,
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
            'required_oracle_ids' => $this->json($profile['required_oracle_ids']),
            'identity' => $this->json($profile['identity']),
            'features' => $this->json($profile['features']),
        ];
    }

    /**
     * @return array<string,int>
     */
    private function dbTypes(): array
    {
        return [
            'produces_win' => ParameterType::BOOLEAN,
            'produces_infinite_mana' => ParameterType::BOOLEAN,
            'produces_infinite_damage' => ParameterType::BOOLEAN,
            'produces_infinite_tokens' => ParameterType::BOOLEAN,
            'produces_infinite_draw' => ParameterType::BOOLEAN,
            'produces_mill' => ParameterType::BOOLEAN,
            'produces_lock' => ParameterType::BOOLEAN,
            'requires_commander' => ParameterType::BOOLEAN,
            'requires_graveyard' => ParameterType::BOOLEAN,
            'requires_battlefield' => ParameterType::BOOLEAN,
            'requires_template' => ParameterType::BOOLEAN,
        ];
    }

    /**
     * @param array<string,mixed> $row
     */
    private function requiresGraveyard(array $row): bool
    {
        return $this->locationsContain($row['zone_locations'] ?? [], ['G', 'GRAVEYARD'])
            || $this->stringOrNull($row['graveyard_card_state'] ?? null) !== null;
    }

    /**
     * @param array<string,mixed> $row
     */
    private function requiresBattlefield(array $row): bool
    {
        return $this->locationsContain($row['zone_locations'] ?? [], ['B', 'BATTLEFIELD'])
            || $this->stringOrNull($row['battlefield_card_state'] ?? null) !== null;
    }

    /**
     * @param list<string> $needles
     */
    private function locationsContain(mixed $locations, array $needles): bool
    {
        foreach ($this->jsonArray($locations) as $location) {
            if (!is_scalar($location)) {
                continue;
            }

            if (in_array(strtoupper(trim((string) $location)), $needles, true)) {
                return true;
            }
        }

        return false;
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

    private function normalizedName(mixed $value): ?string
    {
        $string = $this->stringOrNull($value);

        return $string === null ? null : mb_strtolower($string);
    }

    /**
     * @param array<string,bool> $cardNames
     */
    private function isLethalLoop(array $cardNames): bool
    {
        return isset($cardNames['exquisite blood'], $cardNames['sanguine bond'])
            || isset($cardNames['exquisite blood'], $cardNames['vito, thorn of the dusk rose'])
            || isset($cardNames['bloodchief ascension'], $cardNames['mindcrank']);
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
