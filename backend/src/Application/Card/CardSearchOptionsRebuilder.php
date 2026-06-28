<?php

namespace App\Application\Card;

use App\Domain\Localization\LanguageCatalog;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;

final class CardSearchOptionsRebuilder
{
    private const OPTION_KINDS = ['type', 'subtype', 'format', 'rarity'];

    /**
     * @var array<string,array<string,string>>
     */
    private const TYPE_LABELS = [
        'en' => [
            'artifact' => 'Artifact',
            'battle' => 'Battle',
            'creature' => 'Creature',
            'enchantment' => 'Enchantment',
            'instant' => 'Instant',
            'land' => 'Land',
            'planeswalker' => 'Planeswalker',
            'sorcery' => 'Sorcery',
        ],
        'es' => [
            'artifact' => 'Artefacto',
            'battle' => 'Batalla',
            'creature' => 'Criatura',
            'enchantment' => 'Encantamiento',
            'instant' => 'Instantaneo',
            'land' => 'Tierra',
            'planeswalker' => 'Planeswalker',
            'sorcery' => 'Conjuro',
        ],
        'fr' => [
            'artifact' => 'Artefact',
            'battle' => 'Bataille',
            'creature' => 'Creature',
            'enchantment' => 'Enchantement',
            'instant' => 'Ephemere',
            'land' => 'Terrain',
            'planeswalker' => 'Planeswalker',
            'sorcery' => 'Rituel',
        ],
        'de' => [
            'artifact' => 'Artefakt',
            'battle' => 'Schlacht',
            'creature' => 'Kreatur',
            'enchantment' => 'Verzauberung',
            'instant' => 'Spontanzauber',
            'land' => 'Land',
            'planeswalker' => 'Planeswalker',
            'sorcery' => 'Hexerei',
        ],
        'it' => [
            'artifact' => 'Artefatto',
            'battle' => 'Battaglia',
            'creature' => 'Creatura',
            'enchantment' => 'Incantesimo',
            'instant' => 'Istantaneo',
            'land' => 'Terra',
            'planeswalker' => 'Planeswalker',
            'sorcery' => 'Stregoneria',
        ],
        'pt' => [
            'artifact' => 'Artefato',
            'battle' => 'Batalha',
            'creature' => 'Criatura',
            'enchantment' => 'Encantamento',
            'instant' => 'Magica Instantanea',
            'land' => 'Terreno',
            'planeswalker' => 'Planeswalker',
            'sorcery' => 'Feitico',
        ],
    ];

    /**
     * @var array<string,array<string,string>>
     */
    private const RARITY_LABELS = [
        'en' => [
            'mythic' => 'Mythic',
            'rare' => 'Rare',
            'uncommon' => 'Uncommon',
            'common' => 'Common',
        ],
        'es' => [
            'mythic' => 'Mitica',
            'rare' => 'Rara',
            'uncommon' => 'Infrecuente',
            'common' => 'Comun',
        ],
        'fr' => [
            'mythic' => 'Mythique',
            'rare' => 'Rare',
            'uncommon' => 'Peu commune',
            'common' => 'Commune',
        ],
        'de' => [
            'mythic' => 'Mythisch',
            'rare' => 'Selten',
            'uncommon' => 'Nicht ganz so haufig',
            'common' => 'Haufig',
        ],
        'it' => [
            'mythic' => 'Mitica',
            'rare' => 'Rara',
            'uncommon' => 'Non comune',
            'common' => 'Comune',
        ],
        'pt' => [
            'mythic' => 'Mitica',
            'rare' => 'Rara',
            'uncommon' => 'Incomum',
            'common' => 'Comum',
        ],
    ];

    /**
     * Printed type lines are localized text, but multi-subtype lines can reorder
     * words by language. These overrides fix common stable subtype labels where
     * index-based inference is ambiguous.
     *
     * @var array<string,array<string,string>>
     */
    private const SUBTYPE_LABEL_OVERRIDES = [
        'beast' => ['en' => 'Beast', 'es' => 'Bestia', 'fr' => 'bête', 'it' => 'Bestia', 'pt' => 'Besta'],
        'cat' => ['en' => 'Cat', 'es' => 'Felino', 'fr' => 'chat', 'it' => 'Felino', 'pt' => 'Felino'],
        'dragon' => ['en' => 'Dragon', 'es' => 'Dragon', 'fr' => 'dragon', 'it' => 'Drago', 'pt' => 'Dragao'],
        'elf' => ['en' => 'Elf', 'es' => 'Elfo', 'fr' => 'elfe', 'it' => 'Elfo', 'pt' => 'Elfo'],
        'human' => ['en' => 'Human', 'es' => 'Humano', 'fr' => 'humain', 'it' => 'Umano', 'pt' => 'Humano'],
        'soldier' => ['en' => 'Soldier', 'es' => 'Soldado', 'fr' => 'soldat', 'it' => 'Soldato', 'pt' => 'Soldado'],
        'warrior' => ['en' => 'Warrior', 'es' => 'Guerrero', 'fr' => 'guerrier', 'it' => 'Guerriero', 'pt' => 'Guerreiro'],
        'wizard' => ['en' => 'Wizard', 'es' => 'Mago', 'fr' => 'sorcier', 'it' => 'Mago', 'pt' => 'Mago'],
        'zombie' => ['en' => 'Zombie', 'es' => 'Zombie', 'fr' => 'zombie', 'it' => 'Zombie', 'pt' => 'Zumbi'],
    ];

    public function __construct(private readonly Connection $connection)
    {
    }

    public function rebuild(): void
    {
        $this->connection->transactional(function (): void {
            $this->connection->executeStatement('DELETE FROM card_search_option');
            $this->connection->executeStatement('DELETE FROM card_search_set_option');

            $options = $this->baseStaticOptions();
            $this->collectTypeAndSubtypeOptions($options);
            $setOptions = $this->collectSetOptions();

            $this->insertOptions($options);
            $this->insertSetOptions($setOptions);
        });
    }

    /**
     * @return array<string,array<string,array<string,array{label:string,sortOrder:int,cardCount:?int}>>>
     */
    private function baseStaticOptions(): array
    {
        $options = [];
        foreach (CardSearchFilterBuilder::TYPES as $index => $type) {
            foreach ($this->supportedLanguagesForStaticLabels(self::TYPE_LABELS) as $lang) {
                $this->setOption(
                    $options,
                    'type',
                    $type,
                    $lang,
                    self::TYPE_LABELS[$lang][$type] ?? self::TYPE_LABELS['en'][$type] ?? ucfirst($type),
                    $index,
                );
            }
        }

        foreach (CardSearchFilterBuilder::FORMATS as $index => $format) {
            $this->setOption($options, 'format', $format, 'en', ucfirst($format), $index);
        }

        foreach (CardSearchFilterBuilder::RARITIES as $index => $rarity) {
            foreach ($this->supportedLanguagesForStaticLabels(self::RARITY_LABELS) as $lang) {
                $this->setOption(
                    $options,
                    'rarity',
                    $rarity,
                    $lang,
                    self::RARITY_LABELS[$lang][$rarity] ?? self::RARITY_LABELS['en'][$rarity] ?? ucfirst($rarity),
                    $index,
                );
            }
        }

        return $options;
    }

    /**
     * @param array<string,array<string,string>> $labels
     *
     * @return list<string>
     */
    private function supportedLanguagesForStaticLabels(array $labels): array
    {
        return array_values(array_unique([
            'en',
            ...array_keys($labels),
        ]));
    }

    /**
     * @param array<string,array<string,array<string,array{label:string,sortOrder:int,cardCount:?int}>>> $options
     */
    private function collectTypeAndSubtypeOptions(array &$options): void
    {
        $subtypePriorities = [];
        foreach ($this->typeLineRows() as $row) {
            $defaultTypeLine = $this->stringValue($row['default_type_line'] ?? null);
            if ($defaultTypeLine === null) {
                continue;
            }

            $lang = LanguageCatalog::normalize($row['lang'] ?? null) ?? LanguageCatalog::DEFAULT_LANGUAGE;
            $localizedTypeLine = $this->stringValue($row['localized_type_line'] ?? null) ?? $defaultTypeLine;

            $this->collectTypeNames($defaultTypeLine, $localizedTypeLine, $lang, $options);
            $this->collectSubtypeNames($defaultTypeLine, $localizedTypeLine, $lang, $options, $subtypePriorities);
        }
        $this->applySubtypeOverrides($options);
    }

    /**
     * @param array<string,array<string,array<string,array{label:string,sortOrder:int,cardCount:?int}>>> $options
     */
    private function applySubtypeOverrides(array &$options): void
    {
        foreach (self::SUBTYPE_LABEL_OVERRIDES as $code => $labels) {
            if (!isset($options['subtype'][$code]['en'])) {
                continue;
            }

            foreach ($labels as $lang => $label) {
                $this->setOption($options, 'subtype', $code, $lang, $label, 0);
            }
        }
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    private function typeLineRows(): iterable
    {
        $sql = sprintf(
            <<<'SQL'
WITH english_type_lines AS (
    SELECT DISTINCT ON (normalized_name)
        normalized_name,
        default_type_line
    FROM card_print
    WHERE default_lang = 'en'
      AND default_type_line IS NOT NULL
      AND default_type_line <> ''
    ORDER BY normalized_name ASC, scryfall_id ASC
)
SELECT DISTINCT
    COALESCE(english_type_lines.default_type_line, p.default_type_line, c.type_line) AS default_type_line,
    COALESCE(locale.type_line, c.type_line) AS localized_type_line,
    COALESCE(locale.lang, c.lang, 'en') AS lang
FROM card c
LEFT JOIN card_print p ON p.scryfall_id = c.scryfall_id
LEFT JOIN english_type_lines ON english_type_lines.normalized_name = COALESCE(p.normalized_name, c.normalized_name)
LEFT JOIN card_print_locale locale ON locale.print_scryfall_id = p.scryfall_id
WHERE %s
SQL,
            PlayableCardCatalogSql::condition('c'),
        );

        return $this->connection->executeQuery(
            $sql,
            PlayableCardCatalogSql::parameters(),
            PlayableCardCatalogSql::parameterTypes(),
        )->iterateAssociative();
    }

    /**
     * @param array<string,array<string,array<string,array{label:string,sortOrder:int,cardCount:?int}>>> $options
     */
    private function collectTypeNames(string $defaultTypeLine, string $localizedTypeLine, string $lang, array &$options): void
    {
        foreach ($this->facePairs($defaultTypeLine, $localizedTypeLine) as [$defaultFace, $localizedFace]) {
            [$defaultBase] = $this->splitTypeLine($defaultFace);
            [$localizedBase] = $this->splitTypeLine($localizedFace);
            $defaultParts = $this->typeTokens($defaultBase);
            $localizedParts = $this->labelTokens($localizedBase);

            foreach ($defaultParts as $index => $type) {
                if (!in_array($type, CardSearchFilterBuilder::TYPES, true)) {
                    continue;
                }
                if (isset(self::TYPE_LABELS[$lang][$type])) {
                    continue;
                }

                $localizedLabel = $localizedParts[$index] ?? self::TYPE_LABELS[$lang][$type] ?? self::TYPE_LABELS['en'][$type] ?? ucfirst($type);
                $sortOrder = (int) array_search($type, CardSearchFilterBuilder::TYPES, true);
                $this->setOption($options, 'type', $type, $lang, $localizedLabel, $sortOrder);
            }
        }
    }

    /**
     * @param array<string,array<string,array<string,array{label:string,sortOrder:int,cardCount:?int}>>> $options
     * @param array<string,array<string,int>> $subtypePriorities
     */
    private function collectSubtypeNames(string $defaultTypeLine, string $localizedTypeLine, string $lang, array &$options, array &$subtypePriorities): void
    {
        foreach ($this->facePairs($defaultTypeLine, $localizedTypeLine) as [$defaultFace, $localizedFace]) {
            [, $defaultSubtypeLine] = $this->splitTypeLine($defaultFace);
            [, $localizedSubtypeLine] = $this->splitTypeLine($localizedFace);
            if ($defaultSubtypeLine === null) {
                continue;
            }

            $defaultSubtypes = $this->subtypeTokens($defaultSubtypeLine);
            $localizedSubtypes = $localizedSubtypeLine !== null ? $this->subtypeTokens($localizedSubtypeLine) : [];
            $priority = count($defaultSubtypes) === 1 && count($localizedSubtypes) === 1 ? 0 : 1;
            foreach ($defaultSubtypes as $index => $subtype) {
                $code = mb_strtolower($subtype);
                $matchingLocalizedSubtype = $this->matchingLocalizedSubtype($code, $localizedSubtypes);
                $localizedSubtype = $matchingLocalizedSubtype ?? $localizedSubtypes[$index] ?? $subtype;
                $effectivePriority = $matchingLocalizedSubtype !== null ? 0 : $priority;
                $current = $options['subtype'][$code][$lang]['label'] ?? null;
                $currentPriority = $subtypePriorities[$code][$lang] ?? PHP_INT_MAX;
                if (
                    $current !== null
                    && $effectivePriority > $currentPriority
                    && !$this->shouldPreferSubtypeName($current, $subtype, $localizedSubtype)
                ) {
                    continue;
                }
                if (
                    $current !== null
                    && $effectivePriority === $currentPriority
                    && !$this->shouldPreferSubtypeName($current, $subtype, $localizedSubtype)
                ) {
                    continue;
                }

                $this->setOption($options, 'subtype', $code, $lang, $localizedSubtype, 0);
                $subtypePriorities[$code][$lang] = $effectivePriority;
                $this->setOption($options, 'subtype', $code, 'en', $subtype, 0);
                $subtypePriorities[$code]['en'] = 0;
            }
        }
    }

    private function shouldPreferSubtypeName(string $currentName, string $defaultName, string $candidateName): bool
    {
        if ($candidateName === $defaultName) {
            return false;
        }

        return mb_strtolower($currentName) === mb_strtolower($defaultName);
    }

    /**
     * @return array<string,array<string,array{label:string,cardCount:int}>>
     */
    private function collectSetOptions(): array
    {
        $counts = $this->setCardCounts();
        $sets = [];

        foreach ($this->setRows() as $row) {
            $code = mb_strtolower(trim((string) ($row['code'] ?? '')));
            $label = $this->stringValue($row['label'] ?? null);
            if ($code === '' || $label === null || !isset($counts[$code])) {
                continue;
            }

            $lang = LanguageCatalog::normalize($row['lang'] ?? null) ?? LanguageCatalog::DEFAULT_LANGUAGE;
            $sets[$code][$lang] = [
                'label' => $label,
                'cardCount' => $counts[$code],
            ];
        }

        foreach ($counts as $code => $count) {
            if (isset($sets[$code]['en'])) {
                continue;
            }

            $sets[$code]['en'] = [
                'label' => strtoupper($code),
                'cardCount' => $count,
            ];
        }

        return $sets;
    }

    /**
     * @return array<string,int>
     */
    private function setCardCounts(): array
    {
        $sql = sprintf(
            <<<'SQL'
SELECT printable.set_code AS code, COUNT(*) AS card_count
FROM (
    SELECT DISTINCT ON (
        LOWER(c.set_code),
        c.normalized_name,
        LOWER(COALESCE(c.type_line, '')),
        LOWER(COALESCE(c.mana_cost, ''))
    )
        LOWER(c.set_code) AS set_code
    FROM card c
    WHERE %s
      AND c.set_code IS NOT NULL
      AND c.set_code <> ''
    ORDER BY
        LOWER(c.set_code),
        c.normalized_name,
        LOWER(COALESCE(c.type_line, '')),
        LOWER(COALESCE(c.mana_cost, '')),
        c.scryfall_id ASC
) printable
GROUP BY printable.set_code
SQL,
            PlayableCardCatalogSql::condition('c'),
        );

        $counts = [];
        foreach ($this->connection->executeQuery($sql, PlayableCardCatalogSql::parameters(), PlayableCardCatalogSql::parameterTypes())->iterateAssociative() as $row) {
            $code = mb_strtolower(trim((string) ($row['code'] ?? '')));
            if ($code !== '') {
                $counts[$code] = (int) ($row['card_count'] ?? 0);
            }
        }

        return $counts;
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    private function setRows(): iterable
    {
        $sql = sprintf(
            <<<'SQL'
SELECT DISTINCT
    LOWER(COALESCE(p.set_code, c.set_code)) AS code,
    COALESCE(locale.lang, c.lang, 'en') AS lang,
    COALESCE(NULLIF(locale.set_name, ''), NULLIF(p.default_set_name, ''), NULLIF(c.set_name, '')) AS label
FROM card c
LEFT JOIN card_print p ON p.scryfall_id = c.scryfall_id
LEFT JOIN card_print_locale locale ON locale.print_scryfall_id = p.scryfall_id
WHERE %s
  AND COALESCE(p.set_code, c.set_code) IS NOT NULL
  AND COALESCE(p.set_code, c.set_code) <> ''
SQL,
            PlayableCardCatalogSql::condition('c'),
        );

        return $this->connection->executeQuery(
            $sql,
            PlayableCardCatalogSql::parameters(),
            PlayableCardCatalogSql::parameterTypes(),
        )->iterateAssociative();
    }

    /**
     * @param array<string,array<string,array<string,array{label:string,sortOrder:int,cardCount:?int}>>> $options
     */
    private function insertOptions(array $options): void
    {
        foreach (self::OPTION_KINDS as $kind) {
            foreach ($options[$kind] ?? [] as $code => $languages) {
                if (!isset($languages['en'])) {
                    continue;
                }

                foreach ($languages as $lang => $option) {
                    $types = ['sort_order' => ParameterType::INTEGER];
                    if ($option['cardCount'] !== null) {
                        $types['card_count'] = ParameterType::INTEGER;
                    }

                    $this->connection->executeStatement(
                        <<<'SQL'
INSERT INTO card_search_option (kind, code, lang, label, card_count, sort_order, updated_at)
VALUES (:kind, :code, :lang, :label, :card_count, :sort_order, NOW())
SQL,
                        [
                            'kind' => $kind,
                            'code' => $code,
                            'lang' => $lang,
                            'label' => $option['label'],
                            'card_count' => $option['cardCount'],
                            'sort_order' => $option['sortOrder'],
                        ],
                        $types,
                    );
                }
            }
        }
    }

    /**
     * @param array<string,array<string,array{label:string,cardCount:int}>> $sets
     */
    private function insertSetOptions(array $sets): void
    {
        foreach ($sets as $code => $languages) {
            if (!isset($languages['en'])) {
                continue;
            }

            foreach ($languages as $lang => $set) {
                $this->connection->executeStatement(
                    <<<'SQL'
INSERT INTO card_search_set_option (code, lang, label, card_count, updated_at)
VALUES (:code, :lang, :label, :card_count, NOW())
SQL,
                    [
                        'code' => $code,
                        'lang' => $lang,
                        'label' => $set['label'],
                        'card_count' => $set['cardCount'],
                    ],
                    [
                        'card_count' => ParameterType::INTEGER,
                    ],
                );
            }
        }
    }

    /**
     * @param array<string,array<string,array<string,array{label:string,sortOrder:int,cardCount:?int}>>> $options
     */
    private function setOption(array &$options, string $kind, string $code, string $lang, string $label, int $sortOrder, ?int $cardCount = null): void
    {
        $normalizedCode = mb_strtolower(trim($code));
        $normalizedLang = LanguageCatalog::normalize($lang) ?? LanguageCatalog::DEFAULT_LANGUAGE;
        $normalizedLabel = $this->normalizeLabel($label);
        if ($normalizedCode === '' || $normalizedLabel === '') {
            return;
        }

        $options[$kind][$normalizedCode][$normalizedLang] = [
            'label' => $normalizedLabel,
            'sortOrder' => $sortOrder,
            'cardCount' => $cardCount,
        ];
    }

    /**
     * @return list<array{0:string,1:string}>
     */
    private function facePairs(string $defaultTypeLine, string $localizedTypeLine): array
    {
        $defaultFaces = preg_split('/\s+\/\/\s+/u', $defaultTypeLine) ?: [];
        $localizedFaces = preg_split('/\s+\/\/\s+/u', $localizedTypeLine) ?: [];
        $pairs = [];
        foreach ($defaultFaces as $index => $defaultFace) {
            if (!is_string($defaultFace)) {
                continue;
            }

            $localizedFace = $localizedFaces[$index] ?? $defaultFace;
            $pairs[] = [$defaultFace, is_string($localizedFace) ? $localizedFace : $defaultFace];
        }

        return $pairs;
    }

    /**
     * @return array{0:string,1:?string}
     */
    private function splitTypeLine(string $typeLine): array
    {
        if (preg_match('/\s+(?:-|\x{2014})\s+/u', $typeLine) !== 1) {
            return [trim($typeLine), null];
        }

        $parts = preg_split('/\s+(?:-|\x{2014})\s+/u', $typeLine, 2);

        return [trim((string) ($parts[0] ?? '')), trim((string) ($parts[1] ?? '')) ?: null];
    }

    /**
     * @return list<string>
     */
    private function typeTokens(string $typeLine): array
    {
        return array_values(array_filter(
            array_map(static fn (string $type): string => mb_strtolower(trim($type)), preg_split('/\s+/', trim($typeLine)) ?: []),
            static fn (string $type): bool => $type !== '',
        ));
    }

    /**
     * @return list<string>
     */
    private function labelTokens(string $typeLine): array
    {
        return array_values(array_filter(
            array_map(static fn (string $type): string => trim($type), preg_split('/\s+/', trim($typeLine)) ?: []),
            static fn (string $type): bool => $type !== '',
        ));
    }

    /**
     * @return list<string>
     */
    private function subtypeTokens(string $subtypeLine): array
    {
        $tokens = [];
        foreach (preg_split('/[\s\/\x{FF0F}]+/u', trim($subtypeLine)) ?: [] as $subtype) {
            if (!is_string($subtype)) {
                continue;
            }

            $cleanSubtype = trim($subtype, " \t\n\r\0\x0B,.;:?!\"'");
            if ($cleanSubtype === '' || $this->isSubtypeConnector($cleanSubtype)) {
                continue;
            }

            $tokens[] = $cleanSubtype;
        }

        return $tokens;
    }

    private function isSubtypeConnector(string $subtype): bool
    {
        return in_array(mb_strtolower($subtype), ['and', 'y', 'e', 'et', 'und'], true);
    }

    /**
     * @param list<string> $localizedSubtypes
     */
    private function matchingLocalizedSubtype(string $code, array $localizedSubtypes): ?string
    {
        foreach ($localizedSubtypes as $localizedSubtype) {
            if (mb_strtolower($localizedSubtype) === $code) {
                return $localizedSubtype;
            }
        }

        return null;
    }

    private function stringValue(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $stringValue = trim((string) $value);

        return $stringValue === '' ? null : $stringValue;
    }

    private function normalizeLabel(string $label): string
    {
        return trim(preg_replace('/\s+/', ' ', $label) ?? $label);
    }
}
