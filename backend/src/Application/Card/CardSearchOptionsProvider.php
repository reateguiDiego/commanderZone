<?php

namespace App\Application\Card;

use App\Domain\Localization\LanguageCatalog;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;

final class CardSearchOptionsProvider
{
    public function __construct(private readonly EntityManagerInterface $entityManager)
    {
    }

    /**
     * @return array{
     *   types:list<array{code:string,name:string,aliases?:list<string>,cardCount?:int}>,
     *   subtypes:list<array{code:string,name:string,aliases?:list<string>,cardCount?:int}>,
     *   sets:list<array{code:string,name:string,aliases?:list<string>,cardCount?:int}>,
     *   rarities:list<array{code:string,name:string,aliases?:list<string>,cardCount?:int}>,
     *   formats:list<array{code:string,name:string,aliases?:list<string>,cardCount?:int}>
     * }
     */
    public function options(?string $language): array
    {
        $connection = $this->entityManager->getConnection();
        $requestedLanguage = LanguageCatalog::normalize($language) ?? LanguageCatalog::DEFAULT_LANGUAGE;

        return [
            'types' => $this->optionRows($connection, 'type', $requestedLanguage),
            'subtypes' => $this->optionRows($connection, 'subtype', $requestedLanguage),
            'sets' => $this->setRows($connection, $requestedLanguage),
            'rarities' => $this->optionRows($connection, 'rarity', $requestedLanguage),
            'formats' => $this->optionRows($connection, 'format', $requestedLanguage),
        ];
    }

    /**
     * @return list<array{code:string,name:string,aliases?:list<string>,cardCount?:int}>
     */
    private function optionRows(Connection $connection, string $kind, string $language): array
    {
        $rows = $connection->fetchAllAssociative(
            <<<'SQL'
SELECT
    fallback.code,
    COALESCE(localized.label, fallback.label) AS name,
    COALESCE(localized.card_count, fallback.card_count) AS card_count,
    COALESCE((
        SELECT json_agg(DISTINCT alias.label)
        FROM card_search_option alias
        WHERE alias.kind = fallback.kind
          AND alias.code = fallback.code
          AND alias.label <> COALESCE(localized.label, fallback.label)
    ), '[]'::json) AS aliases
FROM card_search_option fallback
LEFT JOIN card_search_option localized
    ON localized.kind = fallback.kind
   AND localized.code = fallback.code
   AND localized.lang = :lang
WHERE fallback.kind = :kind
  AND fallback.lang = 'en'
ORDER BY fallback.sort_order ASC, COALESCE(localized.label, fallback.label) ASC, fallback.code ASC
SQL,
            [
                'kind' => $kind,
                'lang' => $language,
            ],
        );

        $options = array_values(array_filter(array_map($this->mapOption(...), $rows)));
        if ($kind === 'type' || $kind === 'subtype') {
            $this->sortOptionsByNormalizedName($options);
        }

        return $options;
    }

    /**
     * @return list<array{code:string,name:string,aliases?:list<string>,cardCount?:int}>
     */
    private function setRows(Connection $connection, string $language): array
    {
        $rows = $connection->fetchAllAssociative(
            <<<'SQL'
SELECT
    fallback.code,
    COALESCE(localized.label, fallback.label) AS name,
    fallback.card_count,
    COALESCE((
        SELECT json_agg(DISTINCT alias.label)
        FROM card_search_set_option alias
        WHERE alias.code = fallback.code
          AND alias.label <> COALESCE(localized.label, fallback.label)
    ), '[]'::json) AS aliases
FROM card_search_set_option fallback
LEFT JOIN card_search_set_option localized
    ON localized.code = fallback.code
   AND localized.lang = :lang
WHERE fallback.lang = 'en'
ORDER BY COALESCE(localized.label, fallback.label) ASC, fallback.code ASC
SQL,
            [
                'lang' => $language,
            ],
        );

        $options = array_values(array_filter(array_map($this->mapOption(...), $rows)));
        $this->sortOptionsByNormalizedName($options);

        return $options;
    }

    /**
     * @param array<string,mixed> $row
     *
     * @return array{code:string,name:string,aliases?:list<string>,cardCount?:int}|null
     */
    private function mapOption(array $row): ?array
    {
        $code = trim((string) ($row['code'] ?? ''));
        $name = trim((string) ($row['name'] ?? ''));
        if ($code === '' || $name === '') {
            return null;
        }

        $option = [
            'code' => $code,
            'name' => $name,
        ];
        $aliases = $this->aliases($row['aliases'] ?? null);
        if ($aliases !== []) {
            $option['aliases'] = $aliases;
        }
        if ($row['card_count'] !== null) {
            $option['cardCount'] = (int) $row['card_count'];
        }

        return $option;
    }

    /**
     * @return list<string>
     */
    private function aliases(mixed $value): array
    {
        if (!is_string($value) || $value === '') {
            return [];
        }

        $decoded = json_decode($value, true);
        if (!is_array($decoded)) {
            return [];
        }

        return array_values(array_unique(array_filter(
            array_map(static fn (mixed $alias): string => is_scalar($alias) ? trim((string) $alias) : '', $decoded),
            static fn (string $alias): bool => $alias !== '',
        )));
    }

    /**
     * @param list<array{code:string,name:string,aliases?:list<string>,cardCount?:int}> $options
     */
    private function sortOptionsByNormalizedName(array &$options): void
    {
        usort($options, fn (array $left, array $right): int => [
            $this->normalizedSortKey($left['name']),
            $left['code'],
        ] <=> [
            $this->normalizedSortKey($right['name']),
            $right['code'],
        ]);
    }

    private function normalizedSortKey(string $value): string
    {
        $normalized = trim($value);
        if (class_exists(\Normalizer::class)) {
            $decomposed = \Normalizer::normalize($normalized, \Normalizer::FORM_D);
            if (is_string($decomposed)) {
                $normalized = preg_replace('/\p{Mn}+/u', '', $decomposed) ?? $decomposed;
            }
        }

        $normalized = strtr($normalized, [
            'Á' => 'A', 'À' => 'A', 'Â' => 'A', 'Ä' => 'A', 'Ã' => 'A', 'Å' => 'A', 'Ā' => 'A',
            'á' => 'a', 'à' => 'a', 'â' => 'a', 'ä' => 'a', 'ã' => 'a', 'å' => 'a', 'ā' => 'a',
            'É' => 'E', 'È' => 'E', 'Ê' => 'E', 'Ë' => 'E', 'Ē' => 'E',
            'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'ē' => 'e',
            'Í' => 'I', 'Ì' => 'I', 'Î' => 'I', 'Ï' => 'I', 'Ī' => 'I',
            'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i', 'ī' => 'i',
            'Ó' => 'O', 'Ò' => 'O', 'Ô' => 'O', 'Ö' => 'O', 'Õ' => 'O', 'Ø' => 'O', 'Ō' => 'O',
            'ó' => 'o', 'ò' => 'o', 'ô' => 'o', 'ö' => 'o', 'õ' => 'o', 'ø' => 'o', 'ō' => 'o',
            'Ú' => 'U', 'Ù' => 'U', 'Û' => 'U', 'Ü' => 'U', 'Ū' => 'U',
            'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ū' => 'u',
            'Ñ' => 'N', 'ñ' => 'n', 'Ç' => 'C', 'ç' => 'c',
            'Ý' => 'Y', 'Ÿ' => 'Y', 'ý' => 'y', 'ÿ' => 'y',
            'Æ' => 'AE', 'æ' => 'ae', 'Œ' => 'OE', 'œ' => 'oe',
        ]);

        return strtolower($normalized);
    }
}
