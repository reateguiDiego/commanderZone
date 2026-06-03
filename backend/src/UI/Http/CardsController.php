<?php

namespace App\UI\Http;

use App\Application\Card\CardLocalizationService;
use App\Application\Card\CardResolver;
use App\Domain\Card\Card;
use App\Domain\Localization\LanguageCatalog;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\HttpClient\HttpClientInterface;

class CardsController extends ApiController
{
    private const IMAGE_FORMATS = ['small', 'normal', 'large', 'png', 'art_crop', 'border_crop'];
    private const IMAGE_MODES = ['uri', 'redirect', 'binary'];

    #[Route('/cards/search', methods: ['GET'])]
    public function search(Request $request, EntityManagerInterface $entityManager, CardLocalizationService $localization): JsonResponse
    {
        $requestedLanguage = $this->requestedLanguage($request);
        if ($requestedLanguage === false) {
            return $this->fail('lang filter is invalid.');
        }

        $query = Card::normalizeName((string) $request->query->get('q', ''));
        $page = max(1, (int) $request->query->get('page', 1));
        $limit = min(500, max(1, (int) $request->query->get('limit', 25)));

        $where = [];
        $params = [];
        $searchRankSql = '0';
        $languageRankSql = $this->searchLanguageRankSql($requestedLanguage, $params);
        $languageScope = $this->searchLanguageScopeSql($requestedLanguage, $params);
        if ($languageScope !== null) {
            $where[] = $languageScope;
        }

        if ($query !== '') {
            $foldedQuery = $this->foldLatinAccents($query);
            $useContainsSearch = mb_strlen($query) >= 4;
            $params['queryExact'] = $query;
            $params['queryPrefix'] = $query.'%';
            if ($useContainsSearch) {
                $params['query'] = '%'.$query.'%';
            }

            if ($foldedQuery === $query) {
                $where[] = $this->indexedSearchCandidateSql($requestedLanguage, $useContainsSearch, $params);
                $searchRankSql = $this->indexedSearchRankSql($requestedLanguage, $params);
            } else {
                $accentFoldedName = $this->accentFoldSql('c.normalized_name');
                $accentFoldedPrintedName = $this->accentFoldSql("LOWER(COALESCE(c.printed_name, ''))");
                $accentFoldedFlavorName = $this->accentFoldSql("LOWER(COALESCE(c.flavor_name, ''))");
                $exactSearchConditions = [
                    "(c.normalized_name = :queryExact OR {$accentFoldedName} = :foldedQueryExact)",
                    "(LOWER(COALESCE(c.printed_name, '')) = :queryExact OR {$accentFoldedPrintedName} = :foldedQueryExact)",
                    "(LOWER(COALESCE(c.flavor_name, '')) = :queryExact OR {$accentFoldedFlavorName} = :foldedQueryExact)",
                ];
                $prefixSearchConditions = [
                    "(c.normalized_name LIKE :queryPrefix OR {$accentFoldedName} LIKE :foldedQueryPrefix)",
                    "(LOWER(COALESCE(c.printed_name, '')) LIKE :queryPrefix OR {$accentFoldedPrintedName} LIKE :foldedQueryPrefix)",
                    "(LOWER(COALESCE(c.flavor_name, '')) LIKE :queryPrefix OR {$accentFoldedFlavorName} LIKE :foldedQueryPrefix)",
                ];
                $containsSearchConditions = $useContainsSearch ? [
                    "(c.normalized_name LIKE :query OR {$accentFoldedName} LIKE :foldedQuery)",
                    "(LOWER(COALESCE(c.printed_name, '')) LIKE :query OR {$accentFoldedPrintedName} LIKE :foldedQuery)",
                    "(LOWER(COALESCE(c.flavor_name, '')) LIKE :query OR {$accentFoldedFlavorName} LIKE :foldedQuery)",
                ] : [];
                if ($this->shouldSearchLocalizedPrintTables($entityManager, $requestedLanguage)) {
                    $accentFoldedLocaleName = $this->accentFoldSql("LOWER(COALESCE(locale.name, ''))");
                    $accentFoldedLocalePrintedName = $this->accentFoldSql("LOWER(COALESCE(locale.printed_name, ''))");
                    $exactSearchConditions[] = <<<SQL
EXISTS (
    SELECT 1
    FROM card_print_locale locale
    WHERE locale.print_scryfall_id = c.scryfall_id
      AND locale.lang = :queryLang
      AND (
          LOWER(COALESCE(locale.name, '')) = :queryExact
          OR {$accentFoldedLocaleName} = :foldedQueryExact
          OR LOWER(COALESCE(locale.printed_name, '')) = :queryExact
          OR {$accentFoldedLocalePrintedName} = :foldedQueryExact
      )
)
SQL;
                    $prefixSearchConditions[] = <<<SQL
EXISTS (
    SELECT 1
    FROM card_print_locale locale
    WHERE locale.print_scryfall_id = c.scryfall_id
      AND locale.lang = :queryLang
      AND (
          LOWER(COALESCE(locale.name, '')) LIKE :queryPrefix
          OR {$accentFoldedLocaleName} LIKE :foldedQueryPrefix
          OR LOWER(COALESCE(locale.printed_name, '')) LIKE :queryPrefix
          OR {$accentFoldedLocalePrintedName} LIKE :foldedQueryPrefix
      )
)
SQL;
                    if ($useContainsSearch) {
                        $containsSearchConditions[] = <<<SQL
EXISTS (
    SELECT 1
    FROM card_print_locale locale
    WHERE locale.print_scryfall_id = c.scryfall_id
      AND locale.lang = :queryLang
      AND (
          LOWER(COALESCE(locale.name, '')) LIKE :query
          OR {$accentFoldedLocaleName} LIKE :foldedQuery
          OR LOWER(COALESCE(locale.printed_name, '')) LIKE :query
          OR {$accentFoldedLocalePrintedName} LIKE :foldedQuery
      )
)
SQL;
                    }
                    $params['queryLang'] = $requestedLanguage;
                }

                $activeSearchConditions = $useContainsSearch ? $containsSearchConditions : $prefixSearchConditions;
                $where[] = '('.implode(' OR ', $activeSearchConditions).')';
                $searchRankSql = sprintf(
                    'CASE WHEN %s THEN 0 WHEN %s THEN 1 ELSE 2 END',
                    implode(' OR ', $exactSearchConditions),
                    implode(' OR ', $prefixSearchConditions),
                );
                $params['foldedQueryExact'] = $foldedQuery;
                $params['foldedQueryPrefix'] = $foldedQuery.'%';
                if ($useContainsSearch) {
                    $params['foldedQuery'] = '%'.$foldedQuery.'%';
                }
            }
        }

        $commanderLegal = $request->query->get('commanderLegal');
        if ($commanderLegal !== null && $commanderLegal !== '') {
            $where[] = 'c.commander_legal = :commanderLegal';
            $params['commanderLegal'] = filter_var($commanderLegal, FILTER_VALIDATE_BOOLEAN);
        }

        $tokenOnly = $request->query->get('tokenOnly');
        if ($tokenOnly !== null && $tokenOnly !== '' && filter_var($tokenOnly, FILTER_VALIDATE_BOOLEAN)) {
            $where[] = '(c.layout IN (:tokenLayout, :doubleFacedTokenLayout) OR LOWER(c.type_line) LIKE :tokenTypeLine)';
            $params['tokenLayout'] = 'token';
            $params['doubleFacedTokenLayout'] = 'double_faced_token';
            $params['tokenTypeLine'] = '%token%';
        }

        $type = mb_strtolower(trim((string) $request->query->get('type', '')));
        if ($type !== '') {
            $allowedTypes = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land'];
            if (!in_array($type, $allowedTypes, true)) {
                return $this->fail('type filter is invalid.');
            }

            $where[] = 'LOWER(c.type_line) LIKE :type';
            $params['type'] = '%'.$type.'%';
        }

        $colorIdentity = trim((string) $request->query->get('colorIdentity', ''));
        if ($colorIdentity !== '') {
            foreach (array_filter(array_map('trim', explode(',', strtoupper($colorIdentity)))) as $index => $color) {
                if (!in_array($color, ['W', 'U', 'B', 'R', 'G'], true)) {
                    return $this->fail('colorIdentity filter is invalid.');
                }

                $where[] = sprintf('c.color_identity::text LIKE :colorIdentity%d', $index);
                $params[sprintf('colorIdentity%d', $index)] = '%"'.$color.'"%';
            }
        }

        $sql = <<<'SQL'
SELECT id
FROM (
    SELECT DISTINCT ON (
        c.normalized_name,
        COALESCE(LOWER(c.type_line), ''),
        COALESCE(LOWER(c.mana_cost), '')
    ) c.id, c.name,
SQL;
        $sql .= " {$searchRankSql} AS search_rank, {$languageRankSql} AS language_rank FROM card c";
        if ($where !== []) {
            $sql .= ' WHERE '.implode(' AND ', $where);
        }
        $sql .= <<<'SQL'
    ORDER BY
        c.normalized_name ASC,
        COALESCE(LOWER(c.type_line), '') ASC,
        COALESCE(LOWER(c.mana_cost), '') ASC,
        search_rank ASC,
        language_rank ASC,
        c.scryfall_id ASC,
        c.name ASC
) AS distinct_cards
ORDER BY search_rank ASC, language_rank ASC, name ASC
SQL;
        $sql .= sprintf(' LIMIT %d OFFSET %d', $limit, ($page - 1) * $limit);

        $ids = $entityManager->getConnection()->fetchFirstColumn($sql, $params);
        if ($ids === []) {
            return $this->json(['data' => [], 'page' => $page, 'limit' => $limit]);
        }

        $cards = $this->fetchSearchPayloadsByIds($entityManager, $ids);
        $cards = $localization->localizeCardPayloads($cards, $requestedLanguage, true);

        return $this->json(['data' => $cards, 'page' => $page, 'limit' => $limit]);
    }

    #[Route('/cards/resolve', methods: ['GET'])]
    public function resolve(Request $request, CardResolver $resolver, CardLocalizationService $localization): JsonResponse
    {
        $requestedLanguage = $this->requestedLanguage($request);
        if ($requestedLanguage === false) {
            return $this->fail('lang filter is invalid.');
        }

        $matches = $resolver->resolveCandidates([
            'scryfallId' => $request->query->get('scryfallId'),
            'name' => $request->query->get('name'),
            'setCode' => $request->query->get('setCode'),
            'collectorNumber' => $request->query->get('collectorNumber'),
            'flavorName' => $request->query->get('flavorName'),
        ], $requestedLanguage);

        if ($matches === []) {
            return $this->fail('Card not found.', 404);
        }

        if (count($matches) > 1) {
            return $this->fail('Card resolution is ambiguous.', 409, [
                'matches' => array_map(
                    fn (Card $card): array => $localization->localizeCardPayload($card->toArray(), $requestedLanguage),
                    $matches,
                ),
            ]);
        }

        return $this->json(['card' => $localization->localizeCardPayload($matches[0]->toArray(), $requestedLanguage)]);
    }

    #[Route('/cards/{scryfallId}/image', methods: ['GET'])]
    public function image(string $scryfallId, Request $request, EntityManagerInterface $entityManager, HttpClientInterface $httpClient): JsonResponse|RedirectResponse|Response
    {
        $card = $entityManager->getRepository(Card::class)->findOneBy(['scryfallId' => $scryfallId]);
        if (!$card instanceof Card) {
            return $this->fail('Card not found.', 404);
        }

        $format = (string) $request->query->get('format', 'normal');
        if (!in_array($format, self::IMAGE_FORMATS, true)) {
            return $this->fail('Image format is invalid.');
        }

        $mode = (string) $request->query->get('mode', 'uri');
        if (!in_array($mode, self::IMAGE_MODES, true)) {
            return $this->fail('Image mode is invalid.');
        }

        $uri = $card->imageUri($format);
        if ($uri === null) {
            return $this->fail('Image format not found for card.', 404);
        }

        if ($mode === 'uri') {
            return $this->json([
                'scryfallId' => $card->scryfallId(),
                'format' => $format,
                'uri' => $uri,
            ]);
        }

        if ($mode === 'redirect') {
            return $this->redirect($uri);
        }

        if (!$this->isAllowedImageUri($uri)) {
            return $this->fail('Image URI host is not allowed.', 502);
        }

        $response = $httpClient->request('GET', $uri, [
            'headers' => ['Accept' => 'image/*'],
        ]);

        return new Response(
            $response->getContent(),
            200,
            [
                'Content-Type' => $response->getHeaders(false)['content-type'][0] ?? 'application/octet-stream',
                'Cache-Control' => 'public, max-age=86400',
            ],
        );
    }

    #[Route('/cards/{scryfallId}', methods: ['GET'])]
    public function show(string $scryfallId, Request $request, EntityManagerInterface $entityManager, CardLocalizationService $localization): JsonResponse
    {
        $requestedLanguage = $this->requestedLanguage($request);
        if ($requestedLanguage === false) {
            return $this->fail('lang filter is invalid.');
        }

        $card = $entityManager->getRepository(Card::class)->findOneBy(['scryfallId' => $scryfallId]);
        if (!$card instanceof Card) {
            return $this->fail('Card not found.', 404);
        }

        return $this->json(['card' => $localization->localizeCardPayload($card->toArray(), $requestedLanguage)]);
    }

    private function isAllowedImageUri(string $uri): bool
    {
        $host = parse_url($uri, PHP_URL_HOST);

        return is_string($host) && (str_ends_with($host, '.scryfall.io') || $host === 'scryfall.io');
    }

    private function requestedLanguage(Request $request): string|false|null
    {
        if (!$request->query->has('lang')) {
            return null;
        }

        $requestedLanguage = LanguageCatalog::normalize($request->query->get('lang'));
        if (!LanguageCatalog::isSupported($requestedLanguage)) {
            return false;
        }

        return $requestedLanguage;
    }

    private function printLocaleTablesAvailable(EntityManagerInterface $entityManager): bool
    {
        try {
            $connection = $entityManager->getConnection();
            $cardPrint = $connection->fetchOne("SELECT to_regclass('public.card_print')");
            $cardPrintLocale = $connection->fetchOne("SELECT to_regclass('public.card_print_locale')");

            return is_string($cardPrint)
                && $cardPrint !== ''
                && is_string($cardPrintLocale)
                && $cardPrintLocale !== '';
        } catch (\Throwable) {
            return false;
        }
    }

    private function shouldSearchLocalizedPrintTables(EntityManagerInterface $entityManager, ?string $requestedLanguage): bool
    {
        return $requestedLanguage !== null
            && $requestedLanguage !== LanguageCatalog::DEFAULT_LANGUAGE
            && $this->printLocaleTablesAvailable($entityManager);
    }

    private function searchLanguageScopeSql(?string $requestedLanguage, array &$params, string $alias = 'c'): ?string
    {
        if ($requestedLanguage === null) {
            return null;
        }

        $params['searchDefaultLang'] = LanguageCatalog::DEFAULT_LANGUAGE;
        if ($requestedLanguage === LanguageCatalog::DEFAULT_LANGUAGE) {
            return sprintf('(%1$s.lang = :searchDefaultLang OR %1$s.lang IS NULL)', $alias);
        }

        $params['searchRequestedLang'] = $requestedLanguage;

        return sprintf('(%1$s.lang = :searchRequestedLang OR %1$s.lang = :searchDefaultLang OR %1$s.lang IS NULL)', $alias);
    }

    private function searchLanguageRankSql(?string $requestedLanguage, array &$params, string $alias = 'c'): string
    {
        if ($requestedLanguage === null) {
            return '0';
        }

        $params['rankDefaultLang'] = LanguageCatalog::DEFAULT_LANGUAGE;
        if ($requestedLanguage === LanguageCatalog::DEFAULT_LANGUAGE) {
            return sprintf(<<<'SQL'
CASE
    WHEN %1$s.lang = :rankDefaultLang THEN 0
    WHEN %1$s.lang IS NULL THEN 1
    ELSE 2
END
SQL, $alias);
        }

        $params['rankRequestedLang'] = $requestedLanguage;

        return sprintf(<<<'SQL'
CASE
    WHEN %1$s.lang = :rankRequestedLang THEN 0
    WHEN %1$s.lang = :rankDefaultLang THEN 1
    WHEN %1$s.lang IS NULL THEN 2
    ELSE 3
END
SQL, $alias);
    }

    private function indexedSearchCandidateSql(?string $requestedLanguage, bool $useContainsSearch, array &$params): string
    {
        $patternParam = $useContainsSearch ? ':query' : ':queryPrefix';
        $candidateQueries = [];
        $scopeSql = $this->searchLanguageScopeSql($requestedLanguage, $params, 'c_search');
        $scopePrefix = $scopeSql !== null ? $scopeSql.' AND ' : '';

        $candidateQueries[] = sprintf(
            "SELECT c_search.id FROM card c_search WHERE %sc_search.normalized_name LIKE %s",
            $scopePrefix,
            $patternParam,
        );
        $candidateQueries[] = sprintf(
            "SELECT c_search.id FROM card c_search WHERE %sLOWER(COALESCE(c_search.printed_name, '')) LIKE %s",
            $scopePrefix,
            $patternParam,
        );
        $candidateQueries[] = sprintf(
            "SELECT c_search.id FROM card c_search WHERE %sLOWER(COALESCE(c_search.flavor_name, '')) LIKE %s",
            $scopePrefix,
            $patternParam,
        );

        if ($requestedLanguage !== null && $requestedLanguage !== LanguageCatalog::DEFAULT_LANGUAGE) {
            $params['queryLang'] = $requestedLanguage;
            $candidateQueries[] = sprintf(
                "SELECT c_search.id FROM card c_search INNER JOIN card_print_locale locale ON locale.print_scryfall_id = c_search.scryfall_id WHERE %slocale.lang = :queryLang AND (LOWER(COALESCE(locale.name, '')) LIKE %s OR LOWER(COALESCE(locale.printed_name, '')) LIKE %s)",
                $scopePrefix,
                $patternParam,
                $patternParam,
            );
        }

        return 'c.id IN (SELECT matched.id FROM ('.implode(' UNION ', $candidateQueries).') AS matched)';
    }

    private function indexedSearchRankSql(?string $requestedLanguage, array &$params): string
    {
        $exactSearchConditions = [
            "c.normalized_name = :queryExact",
            "LOWER(COALESCE(c.printed_name, '')) = :queryExact",
            "LOWER(COALESCE(c.flavor_name, '')) = :queryExact",
        ];
        $prefixSearchConditions = [
            "c.normalized_name LIKE :queryPrefix",
            "LOWER(COALESCE(c.printed_name, '')) LIKE :queryPrefix",
            "LOWER(COALESCE(c.flavor_name, '')) LIKE :queryPrefix",
        ];

        if ($requestedLanguage !== null && $requestedLanguage !== LanguageCatalog::DEFAULT_LANGUAGE) {
            $params['queryLang'] = $requestedLanguage;
            $exactSearchConditions[] = "c.scryfall_id IN (SELECT locale_exact.print_scryfall_id FROM card_print_locale locale_exact WHERE locale_exact.lang = :queryLang AND (LOWER(COALESCE(locale_exact.name, '')) = :queryExact OR LOWER(COALESCE(locale_exact.printed_name, '')) = :queryExact))";
            $prefixSearchConditions[] = "c.scryfall_id IN (SELECT locale_prefix.print_scryfall_id FROM card_print_locale locale_prefix WHERE locale_prefix.lang = :queryLang AND (LOWER(COALESCE(locale_prefix.name, '')) LIKE :queryPrefix OR LOWER(COALESCE(locale_prefix.printed_name, '')) LIKE :queryPrefix))";
        }

        return sprintf(
            'CASE WHEN %s THEN 0 WHEN %s THEN 1 ELSE 2 END',
            implode(' OR ', $exactSearchConditions),
            implode(' OR ', $prefixSearchConditions),
        );
    }

    /**
     * @param list<string> $ids
     *
     * @return list<array<string,mixed>>
     */
    private function fetchSearchPayloadsByIds(EntityManagerInterface $entityManager, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $rows = $entityManager->getConnection()->executeQuery(
            <<<'SQL'
SELECT
    id,
    scryfall_id,
    name,
    mana_cost,
    type_line,
    oracle_text,
    power,
    toughness,
    loyalty,
    face_stats,
    colors,
    color_identity,
    legalities,
    image_uris,
    card_faces,
    has_rulings,
    all_parts,
    mana_value,
    produced_mana,
    prices,
    layout,
    commander_legal,
    set_code,
    collector_number,
    lang,
    printed_name,
    flavor_name
FROM card
WHERE id IN (:ids)
SQL,
            ['ids' => $ids],
            ['ids' => ArrayParameterType::STRING],
        )->fetchAllAssociative();

        $cardsById = [];
        foreach ($rows as $row) {
            $id = $this->nullableString($row['id'] ?? null);
            if ($id !== null) {
                $cardsById[$id] = $this->searchPayloadFromRow($row);
            }
        }

        $cards = [];
        foreach ($ids as $id) {
            if (isset($cardsById[$id])) {
                $cards[] = $cardsById[$id];
            }
        }

        return $cards;
    }

    /**
     * @param array<string,mixed> $row
     *
     * @return array<string,mixed>
     */
    private function searchPayloadFromRow(array $row): array
    {
        $name = $this->nullableString($row['name'] ?? null) ?? '';
        $printedName = $this->nullableString($row['printed_name'] ?? null);

        return [
            'id' => $this->nullableString($row['id'] ?? null) ?? '',
            'scryfallId' => $this->nullableString($row['scryfall_id'] ?? null) ?? '',
            'name' => $printedName ?? $name,
            'manaCost' => $this->nullableString($row['mana_cost'] ?? null),
            'typeLine' => $this->nullableString($row['type_line'] ?? null),
            'oracleText' => $this->nullableString($row['oracle_text'] ?? null),
            'power' => $this->nullableString($row['power'] ?? null),
            'toughness' => $this->nullableString($row['toughness'] ?? null),
            'loyalty' => $this->nullableString($row['loyalty'] ?? null),
            'faceStats' => $this->decodeJsonValue($row['face_stats'] ?? []),
            'colors' => $this->decodeJsonArray($row['colors'] ?? []),
            'colorIdentity' => $this->decodeJsonArray($row['color_identity'] ?? []),
            'legalities' => $this->decodeJsonObject($row['legalities'] ?? []),
            'imageUris' => $this->decodeJsonObject($row['image_uris'] ?? []),
            'cardFaces' => $this->decodeJsonArray($row['card_faces'] ?? []),
            'hasRulings' => (bool) ($row['has_rulings'] ?? false),
            'allParts' => $this->decodeJsonArray($row['all_parts'] ?? []),
            'manaValue' => is_numeric($row['mana_value'] ?? null) ? (float) $row['mana_value'] : null,
            'producedMana' => $this->decodeJsonArray($row['produced_mana'] ?? []),
            'prices' => $this->decodeJsonObject($row['prices'] ?? []),
            'layout' => $this->nullableString($row['layout'] ?? null) ?? 'normal',
            'commanderLegal' => (bool) ($row['commander_legal'] ?? false),
            'set' => $this->nullableString($row['set_code'] ?? null),
            'collectorNumber' => $this->nullableString($row['collector_number'] ?? null),
            'lang' => $this->nullableString($row['lang'] ?? null),
            'printedName' => $printedName,
            'flavorName' => $this->nullableString($row['flavor_name'] ?? null),
        ];
    }

    private function foldLatinAccents(string $value): string
    {
        return strtr($value, [
            'á' => 'a',
            'à' => 'a',
            'ä' => 'a',
            'â' => 'a',
            'ã' => 'a',
            'å' => 'a',
            'é' => 'e',
            'è' => 'e',
            'ë' => 'e',
            'ê' => 'e',
            'í' => 'i',
            'ì' => 'i',
            'ï' => 'i',
            'î' => 'i',
            'ó' => 'o',
            'ò' => 'o',
            'ö' => 'o',
            'ô' => 'o',
            'õ' => 'o',
            'ú' => 'u',
            'ù' => 'u',
            'ü' => 'u',
            'û' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
        ]);
    }

    private function accentFoldSql(string $expression): string
    {
        return "TRANSLATE({$expression}, 'áàäâãåéèëêíìïîóòöôõúùüûñç', 'aaaaaaeeeeiiiiooooouuuunc')";
    }
    private function decodeJsonArray(mixed $value): array
    {
        $decoded = $this->decodeJsonValue($value);

        return is_array($decoded) ? array_values($decoded) : [];
    }

    private function decodeJsonObject(mixed $value): array
    {
        $decoded = $this->decodeJsonValue($value);

        return is_array($decoded) ? $decoded : [];
    }

    private function decodeJsonValue(mixed $value): mixed
    {
        if (is_array($value)) {
            return $value;
        }

        if (!is_string($value) || trim($value) === '') {
            return [];
        }

        $decoded = json_decode($value, true);

        return $decoded ?? [];
    }

    private function nullableString(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $stringValue = trim((string) $value);

        return $stringValue === '' ? null : $stringValue;
    }
}
