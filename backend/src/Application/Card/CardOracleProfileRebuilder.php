<?php

namespace App\Application\Card;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;

final class CardOracleProfileRebuilder
{
    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @return array{profiles:int,changed:int,staleDeleted:int}
     */
    public function rebuild(): array
    {
        return $this->connection->transactional(function (): array {
            $staleDeleted = $this->deleteStaleProfiles();
            $profiles = 0;
            $changed = 0;

            foreach ($this->profileSourceRows() as $row) {
                $profile = $this->profileFromRow($row);
                ++$profiles;
                $changed += $this->upsertProfile($profile);
            }

            return [
                'profiles' => $profiles,
                'changed' => $changed,
                'staleDeleted' => $staleDeleted,
            ];
        });
    }

    private function deleteStaleProfiles(): int
    {
        return $this->connection->executeStatement(
            <<<'SQL'
DELETE FROM card_oracle_profile profile
WHERE NOT EXISTS (
    SELECT 1
    FROM card
    WHERE card.oracle_id = profile.oracle_id
      AND card.oracle_id IS NOT NULL
      AND BTRIM(card.oracle_id) <> ''
)
SQL,
        );
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    private function profileSourceRows(): iterable
    {
        return $this->connection->executeQuery(
            <<<'SQL'
SELECT
    ranked.scryfall_id,
    ranked.oracle_id,
    ranked.name,
    ranked.normalized_name,
    ranked.mana_cost,
    ranked.mana_value,
    ranked.type_line,
    ranked.oracle_text,
    ranked.colors,
    ranked.color_identity,
    ranked.produced_mana,
    ranked.keywords,
    ranked.layout,
    ranked.card_faces,
    ranked.power,
    ranked.toughness,
    ranked.loyalty,
    ranked.defense,
    ranked.legalities,
    ranked.edhrec_rank,
    ranked.is_game_changer
FROM (
    SELECT
        card.*,
        ROW_NUMBER() OVER (
            PARTITION BY card.oracle_id
            ORDER BY
                CASE WHEN card.lang = 'en' THEN 0 ELSE 1 END ASC,
                CASE WHEN NULLIF(BTRIM(COALESCE(card.oracle_text, '')), '') IS NOT NULL THEN 0 ELSE 1 END ASC,
                CASE WHEN card.commander_legal = true THEN 0 ELSE 1 END ASC,
                card.scryfall_id ASC
        ) AS row_number
    FROM card
    WHERE card.oracle_id IS NOT NULL
      AND BTRIM(card.oracle_id) <> ''
) ranked
WHERE ranked.row_number = 1
ORDER BY ranked.oracle_id ASC
SQL,
        )->iterateAssociative();
    }

    /**
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function profileFromRow(array $row): array
    {
        $typeLine = $this->stringOrNull($row['type_line'] ?? null);
        $oracleText = $this->stringOrNull($row['oracle_text'] ?? null);
        $legalities = $this->jsonArray($row['legalities'] ?? []);
        $commanderLegality = is_string($legalities['commander'] ?? null) ? trim((string) $legalities['commander']) : null;

        $profile = [
            'oracle_id' => (string) $row['oracle_id'],
            'default_scryfall_id' => $this->stringOrNull($row['scryfall_id'] ?? null),
            'name' => (string) $row['name'],
            'normalized_name' => (string) $row['normalized_name'],
            'mana_cost' => $this->stringOrNull($row['mana_cost'] ?? null),
            'mana_value' => $this->floatOrNull($row['mana_value'] ?? null),
            'type_line' => $typeLine,
            'oracle_text' => $oracleText,
            'colors' => $this->jsonArray($row['colors'] ?? []),
            'color_identity' => $this->jsonArray($row['color_identity'] ?? []),
            'produced_mana' => $this->jsonArray($row['produced_mana'] ?? []),
            'keywords' => $this->jsonArray($row['keywords'] ?? []),
            'layout' => $this->stringOrNull($row['layout'] ?? null),
            'card_faces' => $this->jsonArray($row['card_faces'] ?? []),
            'power' => $this->stringOrNull($row['power'] ?? null),
            'toughness' => $this->stringOrNull($row['toughness'] ?? null),
            'loyalty' => $this->stringOrNull($row['loyalty'] ?? null),
            'defense' => $this->stringOrNull($row['defense'] ?? null),
            'commander_legal' => $commanderLegality === 'legal',
            'commander_banned' => $commanderLegality === 'banned',
            'can_be_commander' => $this->canBeCommander($typeLine, $oracleText),
            'is_land' => $this->hasType($typeLine, 'Land'),
            'is_creature' => $this->hasType($typeLine, 'Creature'),
            'is_artifact' => $this->hasType($typeLine, 'Artifact'),
            'is_enchantment' => $this->hasType($typeLine, 'Enchantment'),
            'is_instant' => $this->hasType($typeLine, 'Instant'),
            'is_sorcery' => $this->hasType($typeLine, 'Sorcery'),
            'is_planeswalker' => $this->hasType($typeLine, 'Planeswalker'),
            'is_battle' => $this->hasType($typeLine, 'Battle'),
            'is_legendary' => $this->hasType($typeLine, 'Legendary'),
            'edhrec_rank' => $this->intOrNull($row['edhrec_rank'] ?? null),
            'is_game_changer' => $this->boolValue($row['is_game_changer'] ?? false),
        ];
        $profile['data_hash'] = $this->profileHash($profile);

        return $profile;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function upsertProfile(array $profile): int
    {
        return $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO card_oracle_profile (
    oracle_id,
    default_scryfall_id,
    name,
    normalized_name,
    mana_cost,
    mana_value,
    type_line,
    oracle_text,
    colors,
    color_identity,
    produced_mana,
    keywords,
    layout,
    card_faces,
    power,
    toughness,
    loyalty,
    defense,
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
    data_hash,
    updated_at
) VALUES (
    :oracle_id,
    :default_scryfall_id,
    :name,
    :normalized_name,
    :mana_cost,
    :mana_value,
    :type_line,
    :oracle_text,
    :colors,
    :color_identity,
    :produced_mana,
    :keywords,
    :layout,
    :card_faces,
    :power,
    :toughness,
    :loyalty,
    :defense,
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
    :data_hash,
    NOW()
)
ON CONFLICT (oracle_id) DO UPDATE SET
    default_scryfall_id = EXCLUDED.default_scryfall_id,
    name = EXCLUDED.name,
    normalized_name = EXCLUDED.normalized_name,
    mana_cost = EXCLUDED.mana_cost,
    mana_value = EXCLUDED.mana_value,
    type_line = EXCLUDED.type_line,
    oracle_text = EXCLUDED.oracle_text,
    colors = EXCLUDED.colors,
    color_identity = EXCLUDED.color_identity,
    produced_mana = EXCLUDED.produced_mana,
    keywords = EXCLUDED.keywords,
    layout = EXCLUDED.layout,
    card_faces = EXCLUDED.card_faces,
    power = EXCLUDED.power,
    toughness = EXCLUDED.toughness,
    loyalty = EXCLUDED.loyalty,
    defense = EXCLUDED.defense,
    commander_legal = EXCLUDED.commander_legal,
    commander_banned = EXCLUDED.commander_banned,
    can_be_commander = EXCLUDED.can_be_commander,
    is_land = EXCLUDED.is_land,
    is_creature = EXCLUDED.is_creature,
    is_artifact = EXCLUDED.is_artifact,
    is_enchantment = EXCLUDED.is_enchantment,
    is_instant = EXCLUDED.is_instant,
    is_sorcery = EXCLUDED.is_sorcery,
    is_planeswalker = EXCLUDED.is_planeswalker,
    is_battle = EXCLUDED.is_battle,
    is_legendary = EXCLUDED.is_legendary,
    edhrec_rank = EXCLUDED.edhrec_rank,
    is_game_changer = EXCLUDED.is_game_changer,
    data_hash = EXCLUDED.data_hash,
    updated_at = NOW()
WHERE card_oracle_profile.data_hash <> EXCLUDED.data_hash
SQL,
            [
                ...$profile,
                'colors' => $this->json($profile['colors']),
                'color_identity' => $this->json($profile['color_identity']),
                'produced_mana' => $this->json($profile['produced_mana']),
                'keywords' => $this->json($profile['keywords']),
                'card_faces' => $this->json($profile['card_faces']),
            ],
            [
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
            ],
        );
    }

    private function hasType(?string $typeLine, string $type): bool
    {
        return preg_match('/\b'.preg_quote($type, '/').'\b/i', (string) $typeLine) === 1;
    }

    private function canBeCommander(?string $typeLine, ?string $oracleText): bool
    {
        if ($this->hasType($typeLine, 'Legendary') && $this->hasType($typeLine, 'Creature')) {
            return true;
        }

        $text = mb_strtolower(trim((string) $oracleText));
        if (preg_match('/\bcan be your commander\b/', $text) === 1) {
            return true;
        }

        if (!$this->hasType($typeLine, 'Legendary')) {
            return false;
        }

        return preg_match('/(^|\n)\s*partner(?:\s*\(|\s*$)/', $text) === 1
            || preg_match('/(^|\n)\s*partner with [^\n(]+/', $text) === 1
            || str_contains($text, 'friends forever')
            || str_contains($text, 'choose a background')
            || str_contains($text, "doctor's companion");
    }

    /**
     * @return array<mixed>
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

    private function profileHash(array $profile): string
    {
        $hashData = $profile;
        unset($hashData['data_hash']);
        $hashData = $this->normalizeForHash($hashData);

        return hash('sha256', json_encode($hashData, JSON_THROW_ON_ERROR));
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

    private function stringOrNull(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = trim((string) $value);

        return $string !== '' ? $string : null;
    }

    private function floatOrNull(mixed $value): ?float
    {
        if (!is_numeric($value)) {
            return null;
        }

        $float = (float) $value;

        return abs($float) < 1000 ? $float : null;
    }

    private function intOrNull(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
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
