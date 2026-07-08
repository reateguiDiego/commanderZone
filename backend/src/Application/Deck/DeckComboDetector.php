<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;

final class DeckComboDetector
{
    private const DETAIL_LIMIT = 20;
    private const MAX_USEFUL_TEMPLATE_PARTIAL_SIZE = 4;

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @param list<string> $deckOracleIds
     * @param list<array<string,mixed>> $resolvedCards
     * @param list<string> $commanderOracleIds
     * @param list<string> $deckColorIdentity
     * @return array{
     *     combos:array<string,mixed>,
     *     topComboCompleters:list<array{oracleId:string,name:string,imageUrl:?string,completesCombos:int}>
     * }
     */
    public function detect(array $deckOracleIds, array $resolvedCards, array $commanderOracleIds = [], array $deckColorIdentity = []): array
    {
        $deckOracleIdSet = $this->idSet($deckOracleIds);
        if ($deckOracleIdSet === []) {
            return [
                'combos' => $this->emptyResult(),
                'topComboCompleters' => [],
            ];
        }

        $commanderOracleIdSet = $this->idSet($commanderOracleIds);
        $deckColorIdentitySet = $this->colorSet($deckColorIdentity);
        $complete = [];
        $partialOneMissing = [];
        $partialTwoMissing = [];

        foreach ($this->candidateRows(array_keys($deckOracleIdSet)) as $row) {
            $item = $this->comboItem($row);
            if (!$this->isValidComboItem($item)) {
                continue;
            }
            if (!$this->comboFitsColorIdentity($item, $deckColorIdentitySet)) {
                continue;
            }

            $missingOracleIds = array_values(array_diff($item['requiredOracleIds'], array_keys($deckOracleIdSet)));
            sort($missingOracleIds, SORT_STRING);
            $item['missingOracleIds'] = $missingOracleIds;

            $missingCount = count($missingOracleIds);
            if ($missingCount === 0) {
                if (!$this->commanderRequirementCanBeSatisfied($item, $commanderOracleIdSet)) {
                    continue;
                }
                $complete[] = $item;
                continue;
            }

            if (!$this->isUsefulPartial($item)) {
                continue;
            }

            if ($missingCount === 1) {
                $partialOneMissing[] = $item;
            } elseif ($missingCount === 2) {
                $partialTwoMissing[] = $item;
            }
        }

        $this->sortCombos($complete);
        $this->sortCombos($partialOneMissing);
        $this->sortCombos($partialTwoMissing);

        $topComboCompleters = $this->topComboCompleters($partialOneMissing, $resolvedCards);
        $cardReferences = $this->cardReferences([
            ...$this->comboOracleIds($complete),
            ...$this->comboOracleIds($partialOneMissing),
            ...$this->comboOracleIds($partialTwoMissing),
            ...array_column($topComboCompleters, 'oracleId'),
        ], $resolvedCards);

        return [
            'combos' => [
                'completeCount' => count($complete),
                'partialOneMissingCount' => count($partialOneMissing),
                'partialTwoMissingCount' => count($partialTwoMissing),
                'winLikeCount' => $this->countCompleteBy($complete, static fn (array $combo): bool => $combo['producesWinLike'] === true),
                'infiniteManaCount' => $this->countCompleteBy($complete, static fn (array $combo): bool => $combo['producesInfiniteMana'] === true),
                'infiniteDamageCount' => $this->countCompleteBy($complete, static fn (array $combo): bool => $combo['producesInfiniteDamage'] === true),
                'infiniteTokensCount' => $this->countCompleteBy($complete, static fn (array $combo): bool => $combo['producesInfiniteTokens'] === true),
                'lethalLoopCount' => $this->countCompleteBy($complete, static fn (array $combo): bool => $combo['lethalLoop'] === true),
                'commanderRequiredCount' => $this->countCompleteBy($complete, static fn (array $combo): bool => $combo['requiresCommander'] === true),
                'templateRequiredCount' => $this->countCompleteBy($complete, static fn (array $combo): bool => $combo['requiresTemplate'] === true),
                'complete' => $this->publicDetails($complete, $cardReferences),
                'partialOneMissing' => $this->publicDetails($partialOneMissing, $cardReferences),
                'partialTwoMissing' => $this->publicDetails($partialTwoMissing, $cardReferences),
            ],
            'topComboCompleters' => $this->enrichTopComboCompleters($topComboCompleters, $cardReferences),
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function emptyResult(): array
    {
        return [
            'completeCount' => 0,
            'partialOneMissingCount' => 0,
            'partialTwoMissingCount' => 0,
            'winLikeCount' => 0,
            'infiniteManaCount' => 0,
            'infiniteDamageCount' => 0,
            'infiniteTokensCount' => 0,
            'lethalLoopCount' => 0,
            'commanderRequiredCount' => 0,
            'templateRequiredCount' => 0,
            'complete' => [],
            'partialOneMissing' => [],
            'partialTwoMissing' => [],
        ];
    }

    /**
     * @param list<string> $oracleIds
     * @return iterable<array<string,mixed>>
     */
    private function candidateRows(array $oracleIds): iterable
    {
        $oracleIdPlaceholders = [];
        $parameters = [];
        foreach ($oracleIds as $index => $oracleId) {
            $parameter = 'oracle_id_'.$index;
            $oracleIdPlaceholders[] = ':'.$parameter;
            $parameters[$parameter] = $oracleId;
        }

        $sql = <<<'SQL'
SELECT
    combo_variant_id,
    external_id,
    required_oracle_ids,
    identity,
    COALESCE((
        SELECT jsonb_agg(DISTINCT required_card_color.color)
        FROM jsonb_array_elements_text(combo_analysis_profile.required_oracle_ids) AS required_card(oracle_id)
        LEFT JOIN card_analysis_profile required_analysis_profile ON required_analysis_profile.oracle_id = required_card.oracle_id
        LEFT JOIN card_oracle_profile required_oracle_profile ON required_oracle_profile.oracle_id = required_card.oracle_id
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(
            required_analysis_profile.color_identity::jsonb,
            required_oracle_profile.color_identity::jsonb,
            (
                SELECT required_print.color_identity::jsonb
                FROM card required_print
                WHERE required_print.oracle_id = required_card.oracle_id
                  AND required_print.color_identity IS NOT NULL
                LIMIT 1
            ),
            '[]'::jsonb
        )) AS required_card_color(color)
    ), '[]'::jsonb) AS required_card_identity,
    features,
    produces_win,
    produces_infinite_mana,
    produces_infinite_damage,
    produces_infinite_tokens,
    produces_mill,
    produces_lock,
    requires_commander,
    requires_template,
    popularity,
    bracket_tag,
    combo_power_score,
    combo_complexity_score,
    combo_size
FROM combo_analysis_profile
WHERE jsonb_typeof(required_oracle_ids) = 'array'
  AND jsonb_exists_any(required_oracle_ids, ARRAY[%s])
SQL;

        return $this->connection->executeQuery(sprintf($sql, implode(', ', $oracleIdPlaceholders)), $parameters)->iterateAssociative();
    }

    /**
     * @param array<string,mixed> $row
     * @return array{
     *     comboVariantId:string,
     *     externalId:string,
     *     requiredOracleIds:list<string>,
     *     missingOracleIds:list<string>,
     *     identity:list<string>,
     *     requiredCardIdentity:list<string>,
     *     features:list<string>,
     *     producesWin:bool,
     *     producesWinLike:bool,
     *     lethalLoop:bool,
     *     producesInfiniteMana:bool,
     *     producesInfiniteDamage:bool,
     *     producesInfiniteTokens:bool,
     *     producesMill:bool,
     *     producesLock:bool,
     *     requiresCommander:bool,
     *     requiresTemplate:bool,
     *     comboPowerScore:?int,
     *     comboComplexityScore:?int,
     *     comboSize:int,
     *     bracketTag:?string,
     *     popularity:?int
     * }
     */
    private function comboItem(array $row): array
    {
        $features = $this->jsonStringList($row['features'] ?? null);
        $lethalLoop = in_array('lethal_loop', $features, true);
        $producesWin = $this->boolValue($row['produces_win'] ?? false);
        $producesInfiniteDamage = $this->boolValue($row['produces_infinite_damage'] ?? false);
        $producesInfiniteTokens = $this->boolValue($row['produces_infinite_tokens'] ?? false);
        $producesMill = $this->boolValue($row['produces_mill'] ?? false);
        $producesLock = $this->boolValue($row['produces_lock'] ?? false);

        return [
            'comboVariantId' => (string) $row['combo_variant_id'],
            'externalId' => (string) $row['external_id'],
            'requiredOracleIds' => $this->jsonStringList($row['required_oracle_ids'] ?? null),
            'missingOracleIds' => [],
            'identity' => $this->jsonStringList($row['identity'] ?? null),
            'requiredCardIdentity' => $this->jsonStringList($row['required_card_identity'] ?? null),
            'features' => $features,
            'producesWin' => $producesWin,
            'producesWinLike' => $producesWin || $lethalLoop || $producesInfiniteDamage || $producesInfiniteTokens || $producesMill || $producesLock,
            'lethalLoop' => $lethalLoop,
            'producesInfiniteMana' => $this->boolValue($row['produces_infinite_mana'] ?? false),
            'producesInfiniteDamage' => $producesInfiniteDamage,
            'producesInfiniteTokens' => $producesInfiniteTokens,
            'producesMill' => $producesMill,
            'producesLock' => $producesLock,
            'requiresCommander' => $this->boolValue($row['requires_commander'] ?? false),
            'requiresTemplate' => $this->boolValue($row['requires_template'] ?? false),
            'comboPowerScore' => $this->intOrNull($row['combo_power_score'] ?? null),
            'comboComplexityScore' => $this->intOrNull($row['combo_complexity_score'] ?? null),
            'comboSize' => max(0, (int) ($row['combo_size'] ?? 0)),
            'bracketTag' => $this->stringOrNull($row['bracket_tag'] ?? null),
            'popularity' => $this->intOrNull($row['popularity'] ?? null),
        ];
    }

    /**
     * @param array<string,mixed> $item
     */
    private function isValidComboItem(array $item): bool
    {
        return $item['comboVariantId'] !== ''
            && $item['externalId'] !== ''
            && $item['comboSize'] > 0
            && $item['requiredOracleIds'] !== [];
    }

    /**
     * @param array<string,mixed> $item
     * @param array<string,true> $deckColorIdentitySet
     */
    private function comboFitsColorIdentity(array $item, array $deckColorIdentitySet): bool
    {
        foreach ($this->comboColorIdentitySet($item) as $color => $_) {
            if (!isset($deckColorIdentitySet[$color])) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param array<string,mixed> $item
     * @return array<string,true>
     */
    private function comboColorIdentitySet(array $item): array
    {
        return [
            ...$this->colorSet($item['identity'] ?? []),
            ...$this->colorSet($item['requiredCardIdentity'] ?? []),
        ];
    }

    /**
     * @param array<string,mixed> $item
     */
    private function isUsefulPartial(array $item): bool
    {
        if (!$item['requiresTemplate']) {
            return true;
        }

        return $item['comboSize'] <= self::MAX_USEFUL_TEMPLATE_PARTIAL_SIZE;
    }

    /**
     * @param array<string,mixed> $item
     * @param array<string,true> $commanderOracleIdSet
     */
    private function commanderRequirementCanBeSatisfied(array $item, array $commanderOracleIdSet): bool
    {
        if ($commanderOracleIdSet === []) {
            return true;
        }

        foreach ($item['requiredOracleIds'] as $requiredOracleId) {
            if (isset($commanderOracleIdSet[$requiredOracleId])) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param list<array<string,mixed>> $combos
     */
    private function sortCombos(array &$combos): void
    {
        usort($combos, static function (array $left, array $right): int {
            return [$right['producesWinLike'], $left['comboSize'], -($left['comboPowerScore'] ?? 0), $left['comboComplexityScore'] ?? 999, -($left['popularity'] ?? 0), $left['externalId']]
                <=> [$left['producesWinLike'], $right['comboSize'], -($right['comboPowerScore'] ?? 0), $right['comboComplexityScore'] ?? 999, -($right['popularity'] ?? 0), $right['externalId']];
        });
    }

    /**
     * @param list<array<string,mixed>> $combos
     */
    private function countCompleteBy(array $combos, callable $predicate): int
    {
        $count = 0;
        foreach ($combos as $combo) {
            if ($predicate($combo)) {
                ++$count;
            }
        }

        return $count;
    }

    /**
     * @param list<array<string,mixed>> $combos
     * @param array<string,array<string,mixed>> $cardReferences
     * @return list<array<string,mixed>>
     */
    private function publicDetails(array $combos, array $cardReferences): array
    {
        $details = [];
        foreach (array_slice($combos, 0, self::DETAIL_LIMIT) as $combo) {
            unset($combo['popularity']);
            $presentOracleIds = array_values(array_diff($combo['requiredOracleIds'], $combo['missingOracleIds']));
            $combo['cards'] = $this->referencesForOracleIds($presentOracleIds, $cardReferences);
            $combo['missingCards'] = $this->referencesForOracleIds($combo['missingOracleIds'], $cardReferences);
            $details[] = $combo;
        }

        return $details;
    }

    /**
     * @param list<array<string,mixed>> $partialOneMissing
     * @param list<array<string,mixed>> $resolvedCards
     * @return list<array{oracleId:string,name:string,completesCombos:int}>
     */
    private function topComboCompleters(array $partialOneMissing, array $resolvedCards): array
    {
        $presentNames = [];
        foreach ($resolvedCards as $card) {
            $presentNames[$card['oracleId']] = $card['name'];
        }

        $frequencies = [];
        foreach ($partialOneMissing as $combo) {
            $missingOracleId = $combo['missingOracleIds'][0] ?? null;
            if (!is_string($missingOracleId) || $missingOracleId === '') {
                continue;
            }
            $frequencies[$missingOracleId] = ($frequencies[$missingOracleId] ?? 0) + 1;
        }

        if ($frequencies === []) {
            return [];
        }

        $references = $this->cardReferences(array_keys($frequencies), $resolvedCards);
        $items = [];
        foreach ($frequencies as $oracleId => $count) {
            $items[] = [
                'oracleId' => $oracleId,
                'name' => $references[$oracleId]['name'] ?? $presentNames[$oracleId] ?? $oracleId,
                'completesCombos' => $count,
            ];
        }

        usort($items, static fn (array $left, array $right): int => [$right['completesCombos'], $left['name'], $left['oracleId']] <=> [$left['completesCombos'], $right['name'], $right['oracleId']]);

        return array_slice($items, 0, self::DETAIL_LIMIT);
    }

    /**
     * @param list<string> $oracleIds
     * @param list<array<string,mixed>> $resolvedCards
     * @return array<string,array<string,mixed>>
     */
    private function cardReferences(array $oracleIds, array $resolvedCards): array
    {
        $references = [];
        foreach ($resolvedCards as $card) {
            $oracleId = $this->stringOrNull($card['oracleId'] ?? null);
            $name = $this->stringOrNull($card['name'] ?? null);
            if ($oracleId === null || $name === null) {
                continue;
            }

            $references[$oracleId] = [
                'deckCardId' => $this->stringOrNull($card['deckCardId'] ?? null),
                'cardId' => $this->stringOrNull($card['cardId'] ?? null),
                'scryfallId' => $this->stringOrNull($card['scryfallId'] ?? null),
                'oracleId' => $oracleId,
                'name' => $name,
                'imageUrl' => $this->stringOrNull($card['imageUrl'] ?? null),
                'imageUris' => is_array($card['imageUris'] ?? null) ? $card['imageUris'] : [],
                'cardFaces' => is_array($card['cardFaces'] ?? null) ? array_values($card['cardFaces']) : [],
                'quantity' => is_numeric($card['quantity'] ?? null) ? max(1, (int) $card['quantity']) : null,
                'section' => $this->stringOrNull($card['section'] ?? null),
            ];
        }

        $oracleIds = array_values(array_unique(array_filter($oracleIds, fn (string $oracleId): bool => !isset($references[$oracleId]))));
        if ($oracleIds === []) {
            return $references;
        }

        $placeholders = [];
        $parameters = [];
        foreach ($oracleIds as $index => $oracleId) {
            $parameter = 'missing_'.$index;
            $placeholders[] = '(:'.$parameter.')';
            $parameters[$parameter] = $oracleId;
        }

        $rows = $this->connection->executeQuery(
            sprintf(
                <<<'SQL'
WITH missing(oracle_id) AS (VALUES %s)
SELECT
    missing.oracle_id,
    MIN(card.scryfall_id) AS scryfall_id,
    COALESCE(card_oracle_profile.name, card_analysis_profile.name, MIN(card.name)) AS name,
    MIN(COALESCE(
        NULLIF(card.image_uris::jsonb ->> 'normal', ''),
        NULLIF(card.image_uris::jsonb ->> 'large', ''),
        NULLIF(card.image_uris::jsonb ->> 'small', ''),
        NULLIF(card.image_uris::jsonb ->> 'png', ''),
        NULLIF(card.image_uris::jsonb ->> 'border_crop', ''),
        NULLIF(card.image_uris::jsonb ->> 'art_crop', '')
    )) AS image_url,
    COALESCE(
        jsonb_object_agg(card.id, card.image_uris::jsonb) FILTER (WHERE card.id IS NOT NULL),
        '{}'::jsonb
    ) AS image_uris_by_card,
    COALESCE(
        jsonb_object_agg(card.id, card.card_faces::jsonb) FILTER (WHERE card.id IS NOT NULL),
        '{}'::jsonb
    ) AS card_faces_by_card
FROM missing
LEFT JOIN card_oracle_profile ON card_oracle_profile.oracle_id = missing.oracle_id
LEFT JOIN card_analysis_profile ON card_analysis_profile.oracle_id = missing.oracle_id
LEFT JOIN card ON card.oracle_id = missing.oracle_id
GROUP BY missing.oracle_id, card_oracle_profile.name, card_analysis_profile.name
SQL,
                implode(', ', $placeholders),
            ),
            $parameters,
        )->fetchAllAssociative();

        foreach ($rows as $row) {
            $oracleId = $this->stringOrNull($row['oracle_id'] ?? null);
            $name = $this->stringOrNull($row['name'] ?? null);
            if ($oracleId !== null && $name !== null) {
                $imageUrisByCard = $this->jsonObject($row['image_uris_by_card'] ?? null);
                $cardFacesByCard = $this->jsonObject($row['card_faces_by_card'] ?? null);
                $imageUris = $this->firstObjectValue($imageUrisByCard);
                $cardFaces = $this->firstListValue($cardFacesByCard);
                $references[$oracleId] = [
                    'oracleId' => $oracleId,
                    'scryfallId' => $this->stringOrNull($row['scryfall_id'] ?? null),
                    'name' => $name,
                    'imageUrl' => $this->stringOrNull($row['image_url'] ?? null),
                    'imageUris' => $imageUris,
                    'cardFaces' => $cardFaces,
                ];
            }
        }

        return $references;
    }

    /**
     * @param list<array<string,mixed>> $combos
     * @return list<string>
     */
    private function comboOracleIds(array $combos): array
    {
        $oracleIds = [];
        foreach (array_slice($combos, 0, self::DETAIL_LIMIT) as $combo) {
            foreach ([...($combo['requiredOracleIds'] ?? []), ...($combo['missingOracleIds'] ?? [])] as $oracleId) {
                if (is_string($oracleId) && $oracleId !== '') {
                    $oracleIds[$oracleId] = true;
                }
            }
        }

        return array_keys($oracleIds);
    }

    /**
     * @param list<string> $oracleIds
     * @param array<string,array<string,mixed>> $cardReferences
     * @return list<array<string,mixed>>
     */
    private function referencesForOracleIds(array $oracleIds, array $cardReferences): array
    {
        $references = [];
        foreach ($oracleIds as $oracleId) {
            $reference = $cardReferences[$oracleId] ?? null;
            $references[] = $reference ?? [
                'oracleId' => $oracleId,
                'scryfallId' => null,
                'name' => $oracleId,
                'imageUrl' => null,
                'imageUris' => [],
                'cardFaces' => [],
            ];
        }

        return $references;
    }

    /**
     * @param list<array{oracleId:string,name:string,completesCombos:int}> $items
     * @param array<string,array<string,mixed>> $cardReferences
     * @return list<array{oracleId:string,name:string,imageUrl:?string,completesCombos:int}>
     */
    private function enrichTopComboCompleters(array $items, array $cardReferences): array
    {
        return array_map(static function (array $item) use ($cardReferences): array {
            $reference = $cardReferences[$item['oracleId']] ?? null;

            return [
                ...$item,
                'scryfallId' => $reference['scryfallId'] ?? null,
                'imageUrl' => $reference['imageUrl'] ?? null,
                'imageUris' => is_array($reference['imageUris'] ?? null) ? $reference['imageUris'] : [],
                'cardFaces' => is_array($reference['cardFaces'] ?? null) ? $reference['cardFaces'] : [],
            ];
        }, $items);
    }

    /**
     * @param list<string> $oracleIds
     * @return array<string,true>
     */
    private function idSet(array $oracleIds): array
    {
        $set = [];
        foreach ($oracleIds as $oracleId) {
            $normalized = $this->stringOrNull($oracleId);
            if ($normalized !== null) {
                $set[$normalized] = true;
            }
        }

        return $set;
    }

    /**
     * @param list<mixed> $colors
     * @return array<string,true>
     */
    private function colorSet(array $colors): array
    {
        $set = [];
        foreach ($colors as $color) {
            $normalized = $this->stringOrNull($color);
            if ($normalized === null) {
                continue;
            }
            $normalized = mb_strtoupper($normalized);
            if (in_array($normalized, ['W', 'U', 'B', 'R', 'G'], true)) {
                $set[$normalized] = true;
            }
        }

        return $set;
    }

    /**
     * @return list<string>
     */
    private function jsonStringList(mixed $value): array
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
        } else {
            $decoded = $value;
        }

        if (!is_array($decoded)) {
            return [];
        }

        $items = [];
        foreach ($decoded as $item) {
            $string = $this->stringOrNull($item);
            if ($string !== null) {
                $items[$string] = true;
            }
        }

        $list = array_keys($items);
        sort($list, SORT_STRING);

        return $list;
    }

    private function intOrNull(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }

    /**
     * @return array<string,mixed>
     */
    private function jsonObject(mixed $value): array
    {
        $decoded = $this->jsonValue($value);

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @param array<string,mixed> $values
     * @return array<string,mixed>
     */
    private function firstObjectValue(array $values): array
    {
        foreach ($values as $value) {
            if (is_array($value)) {
                return $value;
            }
        }

        return [];
    }

    /**
     * @param array<string,mixed> $values
     * @return list<array<string,mixed>>
     */
    private function firstListValue(array $values): array
    {
        foreach ($values as $value) {
            if (is_array($value)) {
                return array_values(array_filter($value, static fn (mixed $item): bool => is_array($item)));
            }
        }

        return [];
    }

    private function jsonValue(mixed $value): mixed
    {
        if (is_array($value)) {
            return $value;
        }

        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        return json_decode($value, true);
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
