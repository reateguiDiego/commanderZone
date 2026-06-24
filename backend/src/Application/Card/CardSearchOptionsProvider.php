<?php

namespace App\Application\Card;

use App\Domain\Localization\LanguageCatalog;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;

final class CardSearchOptionsProvider
{
    /**
     * Scryfall localized print rows in the current local catalog can keep type_line
     * in English, so base card types need a small UI label fallback.
     *
     * @var array<string,array<string,string>>
     */
    private const LOCALIZED_TYPE_NAMES = [
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
            'instant' => 'Ephémere',
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
            'instant' => 'Mágica Instantânea',
            'land' => 'Terreno',
            'planeswalker' => 'Planeswalker',
            'sorcery' => 'Feitiço',
        ],
    ];

    public function __construct(private readonly EntityManagerInterface $entityManager)
    {
    }

    /**
     * @return array{
     *   types:list<array{code:string,name:string}>,
     *   subtypes:list<array{code:string,name:string}>,
     *   sets:list<array{code:string,name:string}>,
     *   rarities:list<array{code:string,name:string}>,
     *   formats:list<array{code:string,name:string}>
     * }
     */
    public function options(?string $language): array
    {
        $connection = $this->entityManager->getConnection();
        $requestedLanguage = LanguageCatalog::normalize($language) ?? LanguageCatalog::DEFAULT_LANGUAGE;

        [$typeNames, $subtypes] = $this->typeAndSubtypeOptions($connection, $requestedLanguage);

        return [
            'types' => array_map(
                fn (string $type): array => [
                    'code' => $type,
                    'name' => $this->localizedTypeName($type, $requestedLanguage, $typeNames),
                ],
                CardSearchFilterBuilder::TYPES,
            ),
            'subtypes' => $this->sortedOptions($subtypes),
            'sets' => $this->setOptions($connection),
            'rarities' => $this->rarityOptions(),
            'formats' => CardSearchFilterBuilder::formatOptions(),
        ];
    }

    /**
     * @param array<string,string> $catalogTypeNames
     */
    private function localizedTypeName(string $type, string $language, array $catalogTypeNames): string
    {
        return self::LOCALIZED_TYPE_NAMES[$language][$type]
            ?? $catalogTypeNames[$type]
            ?? ucfirst($type);
    }

    /**
     * @return list<array{code:string,name:string}>
     */
    private function setOptions(Connection $connection): array
    {
        $sets = $connection->fetchAllAssociative(<<<'SQL'
SELECT LOWER(set_code) AS code, COALESCE(MAX(set_name), UPPER(MAX(set_code))) AS name
FROM card
WHERE set_code IS NOT NULL AND set_code <> ''
GROUP BY LOWER(set_code)
ORDER BY name ASC
SQL);

        return array_map(
            static fn (array $set): array => [
                'code' => (string) ($set['code'] ?? ''),
                'name' => (string) ($set['name'] ?? $set['code'] ?? ''),
            ],
            $sets,
        );
    }

    /**
     * @return list<array{code:string,name:string}>
     */
    private function rarityOptions(): array
    {
        return array_map(
            static fn (string $rarity): array => ['code' => $rarity, 'name' => ucfirst($rarity)],
            CardSearchFilterBuilder::RARITIES,
        );
    }

    /**
     * @return array{0:array<string,string>,1:array<string,string>}
     */
    private function typeAndSubtypeOptions(Connection $connection, string $language): array
    {
        $localizedTypeLineSql = $this->localizedTypeLineSql($connection, $language);
        $params = str_contains($localizedTypeLineSql, ':optionLang') ? ['optionLang' => $language] : [];
        $rows = $connection->fetchAllAssociative(
            <<<SQL
SELECT
    c.type_line AS default_type_line,
    {$localizedTypeLineSql} AS localized_type_line
FROM card c
WHERE c.type_line IS NOT NULL AND c.type_line <> ''
SQL,
            $params,
        );

        $typeNames = [];
        $subtypes = [];
        foreach ($rows as $row) {
            $defaultTypeLine = $this->stringValue($row['default_type_line'] ?? null);
            if ($defaultTypeLine === null) {
                continue;
            }

            $localizedTypeLine = $this->stringValue($row['localized_type_line'] ?? null) ?? $defaultTypeLine;
            $this->collectTypeNames($defaultTypeLine, $localizedTypeLine, $typeNames);
            $this->collectSubtypeNames($defaultTypeLine, $localizedTypeLine, $subtypes);
        }

        return [$typeNames, $subtypes];
    }

    private function localizedTypeLineSql(Connection $connection, string $language): string
    {
        if ($language === LanguageCatalog::DEFAULT_LANGUAGE || !$this->printLocaleTableAvailable($connection)) {
            return 'c.type_line';
        }

        return <<<'SQL'
COALESCE(
    (
        SELECT locale.type_line
        FROM card_print_locale locale
        WHERE locale.print_scryfall_id = c.scryfall_id
          AND locale.lang = :optionLang
          AND locale.type_line IS NOT NULL
          AND locale.type_line <> ''
        LIMIT 1
    ),
    c.type_line
)
SQL;
    }

    private function printLocaleTableAvailable(Connection $connection): bool
    {
        try {
            $table = $connection->fetchOne("SELECT to_regclass('public.card_print_locale')");

            return is_string($table) && $table !== '';
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * @param array<string,string> $typeNames
     */
    private function collectTypeNames(string $defaultTypeLine, string $localizedTypeLine, array &$typeNames): void
    {
        foreach ($this->facePairs($defaultTypeLine, $localizedTypeLine) as [$defaultFace, $localizedFace]) {
            [$defaultBase] = $this->splitTypeLine($defaultFace);
            [$localizedBase] = $this->splitTypeLine($localizedFace);
            $code = mb_strtolower(trim($defaultBase));
            if (!in_array($code, CardSearchFilterBuilder::TYPES, true) || isset($typeNames[$code])) {
                continue;
            }

            $name = trim($localizedBase);
            if ($name !== '') {
                $typeNames[$code] = $name;
            }
        }
    }

    /**
     * @param array<string,string> $subtypes
     */
    private function collectSubtypeNames(string $defaultTypeLine, string $localizedTypeLine, array &$subtypes): void
    {
        foreach ($this->facePairs($defaultTypeLine, $localizedTypeLine) as [$defaultFace, $localizedFace]) {
            [, $defaultSubtypeLine] = $this->splitTypeLine($defaultFace);
            [, $localizedSubtypeLine] = $this->splitTypeLine($localizedFace);
            if ($defaultSubtypeLine === null) {
                continue;
            }

            $defaultSubtypes = $this->subtypeTokens($defaultSubtypeLine);
            $localizedSubtypes = $localizedSubtypeLine !== null ? $this->subtypeTokens($localizedSubtypeLine) : [];
            foreach ($defaultSubtypes as $index => $subtype) {
                $code = mb_strtolower($subtype);
                $subtypes[$code] ??= $localizedSubtypes[$index] ?? $subtype;
            }
        }
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
    private function subtypeTokens(string $subtypeLine): array
    {
        $tokens = [];
        foreach (preg_split('/\s+/', trim($subtypeLine)) ?: [] as $subtype) {
            if (!is_string($subtype)) {
                continue;
            }

            $cleanSubtype = trim($subtype, " \t\n\r\0\x0B,.;:?!\"'");
            if ($cleanSubtype === '' || str_contains($cleanSubtype, '/')) {
                continue;
            }

            $tokens[] = $cleanSubtype;
        }

        return $tokens;
    }

    /**
     * @param array<string,string> $options
     * @return list<array{code:string,name:string}>
     */
    private function sortedOptions(array $options): array
    {
        uasort($options, static fn (string $left, string $right): int => strcasecmp($left, $right));

        return array_map(
            static fn (string $code, string $name): array => ['code' => $code, 'name' => $name],
            array_keys($options),
            array_values($options),
        );
    }

    private function stringValue(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $stringValue = trim((string) $value);

        return $stringValue === '' ? null : $stringValue;
    }
}
