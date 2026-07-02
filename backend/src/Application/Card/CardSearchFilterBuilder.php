<?php

namespace App\Application\Card;

use Doctrine\DBAL\ArrayParameterType;
use Symfony\Component\HttpFoundation\Request;

final class CardSearchFilterBuilder
{
    /**
     * Keep these aligned with Scryfall legality keys persisted in card.legalities.
     *
     * @var list<string>
     */
    public const FORMATS = [
        'standard',
        'pioneer',
        'modern',
        'legacy',
        'vintage',
        'commander',
        'brawl',
        'pauper',
    ];

    /**
     * @var list<string>
     */
    public const TYPES = [
        'creature',
        'instant',
        'sorcery',
        'artifact',
        'enchantment',
        'planeswalker',
        'battle',
        'land',
    ];

    /**
     * @var list<string>
     */
    public const RARITIES = ['mythic', 'rare', 'uncommon', 'common'];

    /**
     * @var list<string>
     */
    private const COLORS = ['W', 'U', 'B', 'R', 'G'];

    private const NUMERIC_STAT_REGEX = '^-?[0-9]+(\\.[0-9]+)?$';

    public function build(Request $request, bool $includePlayableCatalogFilter = true, bool $includeFormatFilter = true): CardSearchFilterSet
    {
        $filters = [];
        $params = [];
        $types = [];
        $formats = $this->formatValues($request);

        if ($includePlayableCatalogFilter) {
            $this->appendPlayableCatalogFilter($request, $formats, $filters, $params, $types);
        }
        $this->appendBooleanFilter($request, $filters, $params);
        $this->appendGameplayFilter($request, $filters, $params);
        $this->appendTypeFilters($request, $filters, $params);
        $this->appendListFilter($request, 'subtypes', $filters, $params, 'subtype', $this->typeLineLikeSql(...));
        $this->appendListFilter($request, 'sets', $filters, $params, 'setCode', $this->setCodeSql(...));
        $this->appendRarityFilter($request, $filters, $params, $types);
        $this->appendColorIdentityFilter($request, $filters, $params, $types);
        $this->appendColorsFilter($request, $filters, $params, $types);
        $this->appendOracleTextFilters($request, $filters, $params);
        $this->appendManaFilters($request, $filters, $params);
        $this->appendStatFilter($request, $filters, $params, 'power');
        $this->appendStatFilter($request, $filters, $params, 'toughness');
        if ($includeFormatFilter) {
            $this->appendFormatFilter($formats, $filters);
        }

        return new CardSearchFilterSet($filters, $params, $types, $formats);
    }

    /**
     * @return list<array{code:string,name:string}>
     */
    public static function formatOptions(): array
    {
        return array_map(
            static fn (string $format): array => ['code' => $format, 'name' => ucfirst($format)],
            self::FORMATS,
        );
    }

    private function appendBooleanFilter(Request $request, array &$filters, array &$params): void
    {
        $commanderLegal = $request->query->get('commanderLegal');
        if ($commanderLegal !== null && $commanderLegal !== '') {
            $filters[] = 'c.commander_legal = :commanderLegal';
            $params['commanderLegal'] = filter_var($commanderLegal, FILTER_VALIDATE_BOOLEAN);
        }

        $commanderCandidate = $request->query->get('commanderCandidate');
        if ($commanderCandidate !== null && $commanderCandidate !== '' && filter_var($commanderCandidate, FILTER_VALIDATE_BOOLEAN)) {
            $filters[] = CommanderCandidateSql::condition('c');
        }

        $tokenOnly = $request->query->get('tokenOnly');
        if ($tokenOnly !== null && $tokenOnly !== '' && filter_var($tokenOnly, FILTER_VALIDATE_BOOLEAN)) {
            $filters[] = '(c.layout IN (:tokenLayout, :doubleFacedTokenLayout) OR LOWER(c.type_line) LIKE :tokenTypeLine)';
            $params['tokenLayout'] = 'token';
            $params['doubleFacedTokenLayout'] = 'double_faced_token';
            $params['tokenTypeLine'] = '%token%';
        }

        foreach (['artifact', 'land', 'basic', 'legendary'] as $typeToggle) {
            $enabled = $request->query->get($typeToggle);
            if ($enabled !== null && $enabled !== '' && filter_var($enabled, FILTER_VALIDATE_BOOLEAN)) {
                $filters[] = sprintf('LOWER(c.type_line) LIKE :%sToggleType', $typeToggle);
                $params[$typeToggle.'ToggleType'] = '%'.$typeToggle.'%';
            }
        }

        $multicolor = $request->query->get('multicolor');
        if ($multicolor !== null && $multicolor !== '' && filter_var($multicolor, FILTER_VALIDATE_BOOLEAN)) {
            $filters[] = 'jsonb_array_length(c.colors::jsonb) > 1';
        }
    }

    /**
     * @param list<string> $formats
     */
    private function appendPlayableCatalogFilter(Request $request, array $formats, array &$filters, array &$params, array &$types): void
    {
        $gameplayKind = trim((string) $request->query->get('gameplayKind', ''));
        $tokenOnly = filter_var($request->query->get('tokenOnly'), FILTER_VALIDATE_BOOLEAN);
        if ($gameplayKind !== '' || $tokenOnly) {
            return;
        }

        PlayableCardCatalogSql::append('c', $filters, $params, $types, $formats === []);
    }

    private function appendGameplayFilter(Request $request, array &$filters, array &$params): void
    {
        $gameplayKind = mb_strtolower(trim((string) $request->query->get('gameplayKind', '')));
        if ($gameplayKind === '') {
            return;
        }

        if (!in_array($gameplayKind, ['token', 'emblem', 'dungeon'], true)) {
            throw new \InvalidArgumentException('gameplayKind filter is invalid.');
        }

        if ($gameplayKind === 'token') {
            $filters[] = '(c.layout IN (:gameplayTokenLayout, :gameplayDoubleFacedTokenLayout) OR LOWER(c.type_line) LIKE :gameplayTokenTypeLine)';
            $params['gameplayTokenLayout'] = 'token';
            $params['gameplayDoubleFacedTokenLayout'] = 'double_faced_token';
            $params['gameplayTokenTypeLine'] = '%token%';

            return;
        }

        if ($gameplayKind === 'emblem') {
            $filters[] = '(c.layout = :gameplayEmblemLayout OR LOWER(c.type_line) LIKE :gameplayEmblemTypeLine)';
            $params['gameplayEmblemLayout'] = 'emblem';
            $params['gameplayEmblemTypeLine'] = '%emblem%';

            return;
        }

        $filters[] = '(c.layout = :gameplayDungeonLayout OR LOWER(c.type_line) LIKE :gameplayDungeonTypeLine)';
        $params['gameplayDungeonLayout'] = 'dungeon';
        $params['gameplayDungeonTypeLine'] = 'dungeon%';
    }

    private function appendTypeFilters(Request $request, array &$filters, array &$params): void
    {
        $typeValues = $this->csvValues($request->query->get('types'));
        $legacyType = mb_strtolower(trim((string) $request->query->get('type', '')));
        if ($legacyType !== '') {
            $typeValues[] = $legacyType;
        }

        $typeValues = array_values(array_unique(array_map(
            static fn (string $type): string => mb_strtolower($type),
            $typeValues,
        )));
        if ($typeValues === []) {
            return;
        }

        foreach ($typeValues as $type) {
            if (!in_array($type, self::TYPES, true)) {
                throw new \InvalidArgumentException('type filter is invalid.');
            }
        }

        $conditions = [];
        foreach ($typeValues as $index => $type) {
            $param = 'type'.($index + 1);
            $conditions[] = sprintf('LOWER(c.type_line) LIKE :%s', $param);
            $params[$param] = '%'.$type.'%';
        }

        $filters[] = '('.implode(' OR ', $conditions).')';
    }

    /**
     * @param callable(string,string,array<string,mixed>&): string $conditionFactory
     */
    private function appendListFilter(Request $request, string $queryKey, array &$filters, array &$params, string $paramPrefix, callable $conditionFactory): void
    {
        $values = $this->csvValues($request->query->get($queryKey));
        if ($values === []) {
            return;
        }

        $conditions = [];
        foreach ($values as $index => $value) {
            $conditions[] = $conditionFactory($paramPrefix.($index + 1), $value, $params);
        }

        $filters[] = '('.implode(' OR ', $conditions).')';
    }

    /**
     * @param array<string,mixed> $params
     */
    private function typeLineLikeSql(string $param, string $value, array &$params): string
    {
        $params[$param] = '%'.mb_strtolower($value).'%';

        return sprintf('LOWER(c.type_line) LIKE :%s', $param);
    }

    /**
     * @param array<string,mixed> $params
     */
    private function setCodeSql(string $param, string $value, array &$params): string
    {
        $params[$param] = mb_strtolower($value);

        return sprintf('LOWER(c.set_code) = :%s', $param);
    }

    private function appendRarityFilter(Request $request, array &$filters, array &$params, array &$types): void
    {
        $rarities = array_map(
            static fn (string $rarity): string => mb_strtolower($rarity),
            $this->csvValues($request->query->get('rarities')),
        );
        if ($rarities === []) {
            return;
        }

        foreach ($rarities as $rarity) {
            if (!in_array($rarity, self::RARITIES, true)) {
                throw new \InvalidArgumentException('rarities filter is invalid.');
            }
        }

        $filters[] = 'LOWER(c.rarity) IN (:rarities)';
        $params['rarities'] = $rarities;
        $types['rarities'] = ArrayParameterType::STRING;
    }

    private function appendColorIdentityFilter(Request $request, array &$filters, array &$params, array &$types): void
    {
        $colorIdentity = trim((string) $request->query->get('colorIdentity', ''));
        if ($colorIdentity === '') {
            return;
        }

        $allowedColors = $this->colorValues($colorIdentity, 'colorIdentity filter is invalid.');
        $filters[] = <<<'SQL'
NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(c.color_identity::jsonb) AS card_color(color)
    WHERE card_color.color NOT IN (:allowedColorIdentity)
)
SQL;
        $params['allowedColorIdentity'] = $allowedColors;
        $types['allowedColorIdentity'] = ArrayParameterType::STRING;
    }

    private function appendColorsFilter(Request $request, array &$filters, array &$params, array &$types): void
    {
        $colors = $this->csvValues($request->query->get('colors'));
        if ($colors === []) {
            return;
        }

        $colors = $this->colorValues(implode(',', $colors), 'colors filter is invalid.');
        $mode = mb_strtolower(trim((string) $request->query->get('colorMatchMode', 'any')));
        if (!in_array($mode, ['any', 'all', 'exact'], true)) {
            throw new \InvalidArgumentException('colorMatchMode filter is invalid.');
        }

        if ($mode === 'any') {
            $params['colors'] = $colors;
            $types['colors'] = ArrayParameterType::STRING;
            $filters[] = <<<'SQL'
EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(c.colors::jsonb) AS card_color(color)
    WHERE card_color.color IN (:colors)
)
SQL;

            return;
        }

        foreach ($colors as $index => $color) {
            $param = 'requiredColor'.($index + 1);
            $filters[] = sprintf(
                'EXISTS (SELECT 1 FROM jsonb_array_elements_text(c.colors::jsonb) AS card_color(color) WHERE card_color.color = :%s)',
                $param,
            );
            $params[$param] = $color;
        }
        if ($mode === 'exact') {
            $filters[] = 'jsonb_array_length(c.colors::jsonb) = :colorsCount';
            $params['colorsCount'] = count($colors);
        }
    }

    private function appendOracleTextFilters(Request $request, array &$filters, array &$params): void
    {
        $texts = array_values(array_filter([
            trim((string) $request->query->get('oracleTextA', '')),
            trim((string) $request->query->get('oracleTextB', '')),
        ], static fn (string $value): bool => $value !== ''));
        if ($texts === []) {
            return;
        }

        $mode = mb_strtolower(trim((string) $request->query->get('oracleTextMode', 'and')));
        if (!in_array($mode, ['and', 'or'], true)) {
            throw new \InvalidArgumentException('oracleTextMode filter is invalid.');
        }

        $exact = filter_var($request->query->get('oracleTextExact'), FILTER_VALIDATE_BOOLEAN);
        $conditions = [];
        foreach ($texts as $index => $text) {
            $param = 'oracleText'.($index + 1);
            $operator = $exact ? '~' : 'LIKE';
            $conditions[] = sprintf(
                "(%s %s :%s OR EXISTS (
                    SELECT 1
                    FROM card_print_locale oracle_locale
                    WHERE oracle_locale.print_scryfall_id = c.scryfall_id
                      AND %s %s :%s
                ))",
                $this->foldedSearchSql("COALESCE(c.oracle_text, '') || ' ' || COALESCE(c.card_faces::text, '')"),
                $operator,
                $param,
                $this->foldedSearchSql("COALESCE(oracle_locale.oracle_text, '') || ' ' || COALESCE(oracle_locale.card_faces::text, '')"),
                $operator,
                $param,
            );
            $params[$param] = $exact
                ? $this->exactTextPattern($text)
                : '%'.$this->normalizeSearchText($text).'%';
        }

        $filters[] = '('.implode($mode === 'and' ? ' AND ' : ' OR ', $conditions).')';
    }

    private function appendManaFilters(Request $request, array &$filters, array &$params): void
    {
        $this->appendNumericRange($request, $filters, $params, 'manaValue', 'c.mana_value');

        $manaCost = $this->normalizeManaCost((string) $request->query->get('manaCost', ''));
        if ($manaCost === '') {
            return;
        }

        $filters[] = "REGEXP_REPLACE(LOWER(COALESCE(c.mana_cost, '')), '[{}[:space:]]', '', 'g') = :manaCost";
        $params['manaCost'] = $manaCost;
    }

    private function appendStatFilter(Request $request, array &$filters, array &$params, string $stat): void
    {
        $minKey = $stat.'Min';
        $maxKey = $stat.'Max';
        $hasMin = trim((string) $request->query->get($minKey, '')) !== '';
        $hasMax = trim((string) $request->query->get($maxKey, '')) !== '';
        if (!$hasMin && !$hasMax) {
            return;
        }

        $numericConditions = [sprintf("c.%s ~ '%s'", $stat, self::NUMERIC_STAT_REGEX)];
        if ($hasMin) {
            $numericConditions[] = sprintf('c.%s::numeric >= :%s', $stat, $minKey);
            $params[$minKey] = (float) $request->query->get($minKey);
        }
        if ($hasMax) {
            $numericConditions[] = sprintf('c.%s::numeric <= :%s', $stat, $maxKey);
            $params[$maxKey] = (float) $request->query->get($maxKey);
        }

        $condition = '('.implode(' AND ', $numericConditions).')';
        $includeVariableKey = 'includeVariable'.ucfirst($stat);
        $includeVariable = filter_var($request->query->get($includeVariableKey), FILTER_VALIDATE_BOOLEAN);
        if ($includeVariable) {
            $condition = sprintf(
                '(%s OR (c.%s IS NOT NULL AND c.%s !~ \'%s\'))',
                $condition,
                $stat,
                $stat,
                self::NUMERIC_STAT_REGEX,
            );
        }

        $filters[] = $condition;
    }

    private function appendNumericRange(Request $request, array &$filters, array &$params, string $keyPrefix, string $column): void
    {
        $minKey = $keyPrefix.'Min';
        $maxKey = $keyPrefix.'Max';
        $min = trim((string) $request->query->get($minKey, ''));
        $max = trim((string) $request->query->get($maxKey, ''));

        if ($min !== '') {
            $filters[] = sprintf('%s >= :%s', $column, $minKey);
            $params[$minKey] = (float) $min;
        }
        if ($max !== '') {
            $filters[] = sprintf('%s <= :%s', $column, $maxKey);
            $params[$maxKey] = (float) $max;
        }
    }

    /**
     * @param list<string> $formats
     */
    private function appendFormatFilter(array $formats, array &$filters): void
    {
        if ($formats === []) {
            return;
        }

        foreach ($formats as $format) {
            $filters[] = sprintf("(c.legalities::jsonb ->> '%s') = 'legal'", $format);
        }
    }

    /**
     * @return list<string>
     */
    private function formatValues(Request $request): array
    {
        $formats = array_map(
            static fn (string $format): string => mb_strtolower($format),
            $this->csvValues($request->query->get('formats')),
        );

        foreach ($formats as $format) {
            if (!in_array($format, self::FORMATS, true)) {
                throw new \InvalidArgumentException('formats filter is invalid.');
            }
        }

        return array_values(array_unique($formats));
    }

    /**
     * @return list<string>
     */
    private function csvValues(mixed $value): array
    {
        if (!is_scalar($value)) {
            return [];
        }

        $rawValue = trim((string) $value);
        if ($rawValue === '') {
            return [];
        }

        return array_values(array_filter(
            array_map(static fn (string $item): string => trim($item), explode(',', $rawValue)),
            static fn (string $item): bool => $item !== '',
        ));
    }

    /**
     * @return list<string>
     */
    private function colorValues(string $value, string $errorMessage): array
    {
        $colors = [];
        foreach (array_filter(array_map('trim', explode(',', strtoupper($value)))) as $color) {
            if (!in_array($color, self::COLORS, true)) {
                throw new \InvalidArgumentException($errorMessage);
            }

            $colors[$color] = $color;
        }

        return array_values($colors);
    }

    private function normalizeManaCost(string $value): string
    {
        return mb_strtolower((string) preg_replace('/[{}\s]+/', '', trim($value)));
    }

    private function normalizeSearchText(string $value): string
    {
        $normalized = mb_strtolower(trim(preg_replace('/\s+/', ' ', $value) ?? $value));

        if (class_exists(\Transliterator::class)) {
            $transliterator = \Transliterator::create('NFD; [:Nonspacing Mark:] Remove; NFC');
            if ($transliterator instanceof \Transliterator) {
                return mb_strtolower($transliterator->transliterate($normalized));
            }
        }

        $converted = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $normalized);

        return is_string($converted) && $converted !== '' ? mb_strtolower($converted) : $normalized;
    }

    private function exactTextPattern(string $value): string
    {
        $escaped = preg_quote($this->normalizeSearchText($value));
        $escaped = (string) preg_replace('/\s+/', '[[:space:]]+', $escaped);

        return '(^|[^[:alnum:]_])'.$escaped.'([^[:alnum:]_]|$)';
    }

    private function foldedSearchSql(string $expression): string
    {
        return sprintf('LOWER(immutable_unaccent(%s))', $expression);
    }
}
