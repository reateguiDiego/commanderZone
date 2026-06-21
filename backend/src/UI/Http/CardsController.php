<?php

namespace App\UI\Http;

use App\Application\Card\CardLocalizationService;
use App\Application\Card\CardResolver;
use App\Application\Card\CardsLanguageService;
use App\Domain\Card\Card;
use App\Domain\Localization\LanguageCatalog;
use App\Domain\User\User;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;
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

        $filters = [];
        $filterParams = [];
        $filterTypes = [];

        $commanderLegal = $request->query->get('commanderLegal');
        if ($commanderLegal !== null && $commanderLegal !== '') {
            $filters[] = 'c.commander_legal = :commanderLegal';
            $filterParams['commanderLegal'] = filter_var($commanderLegal, FILTER_VALIDATE_BOOLEAN);
        }

        $tokenOnly = $request->query->get('tokenOnly');
        if ($tokenOnly !== null && $tokenOnly !== '' && filter_var($tokenOnly, FILTER_VALIDATE_BOOLEAN)) {
            $filters[] = '(c.layout IN (:tokenLayout, :doubleFacedTokenLayout) OR LOWER(c.type_line) LIKE :tokenTypeLine)';
            $filterParams['tokenLayout'] = 'token';
            $filterParams['doubleFacedTokenLayout'] = 'double_faced_token';
            $filterParams['tokenTypeLine'] = '%token%';
        }

        $gameplayKind = mb_strtolower(trim((string) $request->query->get('gameplayKind', '')));
        if ($gameplayKind !== '') {
            if (!in_array($gameplayKind, ['token', 'emblem', 'dungeon'], true)) {
                return $this->fail('gameplayKind filter is invalid.');
            }

            if ($gameplayKind === 'token') {
                $filters[] = '(c.layout IN (:gameplayTokenLayout, :gameplayDoubleFacedTokenLayout) OR LOWER(c.type_line) LIKE :gameplayTokenTypeLine)';
                $filterParams['gameplayTokenLayout'] = 'token';
                $filterParams['gameplayDoubleFacedTokenLayout'] = 'double_faced_token';
                $filterParams['gameplayTokenTypeLine'] = '%token%';
            } elseif ($gameplayKind === 'emblem') {
                $filters[] = '(c.layout = :gameplayEmblemLayout OR LOWER(c.type_line) LIKE :gameplayEmblemTypeLine)';
                $filterParams['gameplayEmblemLayout'] = 'emblem';
                $filterParams['gameplayEmblemTypeLine'] = '%emblem%';
            } else {
                $filters[] = '(c.layout = :gameplayDungeonLayout OR LOWER(c.type_line) LIKE :gameplayDungeonTypeLine)';
                $filterParams['gameplayDungeonLayout'] = 'dungeon';
                $filterParams['gameplayDungeonTypeLine'] = 'dungeon%';
            }
        }

        $type = mb_strtolower(trim((string) $request->query->get('type', '')));
        if ($type !== '') {
            $allowedTypes = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land'];
            if (!in_array($type, $allowedTypes, true)) {
                return $this->fail('type filter is invalid.');
            }

            $filters[] = 'LOWER(c.type_line) LIKE :type';
            $filterParams['type'] = '%'.$type.'%';
        }

        $colorIdentity = trim((string) $request->query->get('colorIdentity', ''));
        if ($colorIdentity !== '') {
            $allowedColors = [];
            foreach (array_filter(array_map('trim', explode(',', strtoupper($colorIdentity)))) as $color) {
                if (!in_array($color, ['W', 'U', 'B', 'R', 'G'], true)) {
                    return $this->fail('colorIdentity filter is invalid.');
                }

                $allowedColors[$color] = $color;
            }

            $filters[] = <<<'SQL'
NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(c.color_identity::jsonb) AS card_color(color)
    WHERE card_color.color NOT IN (:allowedColorIdentity)
)
SQL;
            $filterParams['allowedColorIdentity'] = array_values($allowedColors);
            $filterTypes['allowedColorIdentity'] = ArrayParameterType::STRING;
        }

        if ($query !== '') {
            $searchPatterns = $this->searchPatterns($query);
            $buckets = $requestedLanguage === null ? ['all'] : $this->searchBuckets($requestedLanguage);
            $ids = [];

            foreach ($buckets as $bucket) {
                [$sql, $params, $types] = $this->buildBucketedSearchSql(
                    $entityManager,
                    $bucket,
                    $requestedLanguage,
                    $filters,
                    $filterParams,
                    $filterTypes,
                    $searchPatterns,
                    $limit,
                    $page,
                );
                $ids = $entityManager->getConnection()->fetchFirstColumn($sql, $params, $types);
                if ($ids !== []) {
                    break;
                }
            }
        } else {
            $where = $filters;
            $params = $filterParams;
            $searchRankSql = '0';
            $languageRankSql = $this->searchLanguageRankSql($requestedLanguage, $params);
            $languageScope = $this->searchLanguageScopeSql($requestedLanguage, $params);
            if ($languageScope !== null) {
                $where[] = $languageScope;
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
        }
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

    #[Route('/cards/languages', methods: ['GET'])]
    public function languages(CardsLanguageService $cardsLanguage, #[CurrentUser] ?User $user): JsonResponse
    {
        return $this->json([
            'selectedCardLanguage' => LanguageCatalog::normalize($user?->cardLanguage()) ?? LanguageCatalog::DEFAULT_LANGUAGE,
            'data' => $cardsLanguage->languageCoverage(),
        ]);
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

    /**
     * @return array{exact:string,prefix:string,contains:?string,useContains:bool}
     */
    private function searchPatterns(string $query): array
    {
        $folded = $this->normalizeSearchQuery($query);
        $useContains = mb_strlen($query) >= 4;

        return [
            'exact' => $folded,
            'prefix' => $folded.'%',
            'contains' => $useContains ? '%'.$folded.'%' : null,
            'useContains' => $useContains,
        ];
    }

    /**
     * @return list<string>
     */
    private function searchBuckets(string $requestedLanguage): array
    {
        if ($requestedLanguage === LanguageCatalog::DEFAULT_LANGUAGE) {
            return ['english', 'common'];
        }

        return ['requested', 'english', 'common'];
    }

    /**
     * @param list<string> $filters
     * @param array<string,mixed> $baseParams
     * @param array<string,mixed> $baseTypes
     * @param array{exact:string,prefix:string,contains:?string,useContains:bool} $patterns
     *
     * @return array{0:string,1:array<string,mixed>,2:array<string,mixed>}
     */
    private function buildBucketedSearchSql(
        EntityManagerInterface $entityManager,
        string $bucket,
        ?string $requestedLanguage,
        array $filters,
        array $baseParams,
        array $baseTypes,
        array $patterns,
        int $limit,
        int $page,
    ): array {
        $params = $baseParams;
        $types = $baseTypes;
        $where = $filters;

        $params['queryExactFolded'] = $patterns['exact'];
        $params['queryPrefixFolded'] = $patterns['prefix'];
        if (is_string($patterns['contains'])) {
            $params['queryContainsFolded'] = $patterns['contains'];
        }

        $languageScope = $this->searchBucketScopeSql($bucket, $requestedLanguage, $params, $types);
        if ($languageScope !== null) {
            $where[] = $languageScope;
        }

        $where[] = $this->indexedSearchCandidateSql($entityManager, $bucket, $requestedLanguage, (bool) $patterns['useContains'], $params, $types);
        $searchRankSql = $this->indexedSearchRankSql($entityManager, $bucket, $requestedLanguage, $params, $types);
        $languageRankSql = $this->searchBucketRankSql($bucket, $requestedLanguage, $params, $types);

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

        return [$sql, $params, $types];
    }

    private function searchBucketScopeSql(string $bucket, ?string $requestedLanguage, array &$params, array &$types, string $alias = 'c'): ?string
    {
        $this->primeBucketParams($bucket, $requestedLanguage, $params, $types);

        return match ($bucket) {
            'all' => null,
            'requested' => sprintf('%s.lang = :bucketRequestedLang', $alias),
            'english' => sprintf('(%1$s.lang = :bucketEnglishLang OR %1$s.lang IS NULL)', $alias),
            'common' => sprintf('%s.lang IN (:bucketCommonLangs)', $alias),
            default => null,
        };
    }

    private function searchBucketRankSql(string $bucket, ?string $requestedLanguage, array &$params, array &$types, string $alias = 'c'): string
    {
        $this->primeBucketParams($bucket, $requestedLanguage, $params, $types);

        return match ($bucket) {
            'all', 'requested' => '0',
            'english' => sprintf(<<<'SQL'
CASE
    WHEN %1$s.lang = :bucketEnglishLang THEN 0
    WHEN %1$s.lang IS NULL THEN 1
    ELSE 2
END
SQL, $alias),
            'common' => $this->commonLanguageRankSql($alias),
            default => '0',
        };
    }

    private function commonLanguageRankSql(string $alias): string
    {
        $cases = [];
        foreach (LanguageCatalog::commonPrintLanguages() as $index => $language) {
            $cases[] = sprintf("WHEN %s.lang = '%s' THEN %d", $alias, $language, $index);
        }

        return "CASE\n    ".implode("\n    ", $cases)."\n    ELSE ".count(LanguageCatalog::commonPrintLanguages())."\nEND";
    }

    private function indexedSearchCandidateSql(
        EntityManagerInterface $entityManager,
        string $bucket,
        ?string $requestedLanguage,
        bool $useContainsSearch,
        array &$params,
        array &$types,
    ): string {
        $patternParam = $useContainsSearch ? ':queryContainsFolded' : ':queryPrefixFolded';
        $candidateQueries = [];
        $scopeSql = $this->searchBucketScopeSql($bucket, $requestedLanguage, $params, $types, 'c_search');
        $scopePrefix = $scopeSql !== null ? $scopeSql.' AND ' : '';

        $candidateQueries[] = sprintf(
            'SELECT c_search.id FROM card c_search WHERE %s%s LIKE %s',
            $scopePrefix,
            $this->foldedSearchSql('c_search.normalized_name'),
            $patternParam,
        );
        $candidateQueries[] = sprintf(
            'SELECT c_search.id FROM card c_search WHERE %s%s LIKE %s',
            $scopePrefix,
            $this->foldedSearchSql("COALESCE(c_search.printed_name, '')"),
            $patternParam,
        );
        $candidateQueries[] = sprintf(
            'SELECT c_search.id FROM card c_search WHERE %s%s LIKE %s',
            $scopePrefix,
            $this->foldedSearchSql("COALESCE(c_search.flavor_name, '')"),
            $patternParam,
        );

        $localeScope = $this->localizedBucketScopeSql($entityManager, $bucket, $requestedLanguage, $params, $types, 'locale');
        if ($localeScope !== null) {
            $candidateQueries[] = sprintf(
                'SELECT c_search.id FROM card c_search INNER JOIN card_print_locale locale ON locale.print_scryfall_id = c_search.scryfall_id WHERE %s%s AND (%s LIKE %s OR %s LIKE %s)',
                $scopePrefix,
                $localeScope,
                $this->foldedSearchSql("COALESCE(locale.name, '')"),
                $patternParam,
                $this->foldedSearchSql("COALESCE(locale.printed_name, '')"),
                $patternParam,
            );
        }

        return 'c.id IN (SELECT matched.id FROM ('.implode(' UNION ', $candidateQueries).') AS matched)';
    }

    private function indexedSearchRankSql(
        EntityManagerInterface $entityManager,
        string $bucket,
        ?string $requestedLanguage,
        array &$params,
        array &$types,
    ): string {
        $exactSearchConditions = [
            $this->foldedSearchSql('c.normalized_name').' = :queryExactFolded',
            $this->foldedSearchSql("COALESCE(c.printed_name, '')").' = :queryExactFolded',
            $this->foldedSearchSql("COALESCE(c.flavor_name, '')").' = :queryExactFolded',
        ];
        $prefixSearchConditions = [
            $this->foldedSearchSql('c.normalized_name').' LIKE :queryPrefixFolded',
            $this->foldedSearchSql("COALESCE(c.printed_name, '')").' LIKE :queryPrefixFolded',
            $this->foldedSearchSql("COALESCE(c.flavor_name, '')").' LIKE :queryPrefixFolded',
        ];

        $exactLocaleScope = $this->localizedBucketScopeSql($entityManager, $bucket, $requestedLanguage, $params, $types, 'locale_exact');
        if ($exactLocaleScope !== null) {
            $exactSearchConditions[] = sprintf(
                'c.scryfall_id IN (SELECT locale_exact.print_scryfall_id FROM card_print_locale locale_exact WHERE %s AND (%s = :queryExactFolded OR %s = :queryExactFolded))',
                $exactLocaleScope,
                $this->foldedSearchSql("COALESCE(locale_exact.name, '')"),
                $this->foldedSearchSql("COALESCE(locale_exact.printed_name, '')"),
            );
            $prefixSearchConditions[] = sprintf(
                'c.scryfall_id IN (SELECT locale_prefix.print_scryfall_id FROM card_print_locale locale_prefix WHERE %s AND (%s LIKE :queryPrefixFolded OR %s LIKE :queryPrefixFolded))',
                $this->localizedBucketScopeSql($entityManager, $bucket, $requestedLanguage, $params, $types, 'locale_prefix'),
                $this->foldedSearchSql("COALESCE(locale_prefix.name, '')"),
                $this->foldedSearchSql("COALESCE(locale_prefix.printed_name, '')"),
            );
        }

        return sprintf(
            'CASE WHEN %s THEN 0 WHEN %s THEN 1 ELSE 2 END',
            implode(' OR ', $exactSearchConditions),
            implode(' OR ', $prefixSearchConditions),
        );
    }

    private function localizedBucketScopeSql(
        EntityManagerInterface $entityManager,
        string $bucket,
        ?string $requestedLanguage,
        array &$params,
        array &$types,
        string $alias = 'locale',
    ): ?string {
        if (!$this->printLocaleTablesAvailable($entityManager) || $bucket === 'all') {
            return null;
        }

        $this->primeBucketParams($bucket, $requestedLanguage, $params, $types);

        return match ($bucket) {
            'requested' => sprintf('%s.lang = :bucketRequestedLocaleLang', $alias),
            'english' => sprintf('%s.lang = :bucketEnglishLocaleLang', $alias),
            'common' => sprintf('%s.lang IN (:bucketCommonLocaleLangs)', $alias),
            default => null,
        };
    }

    private function primeBucketParams(string $bucket, ?string $requestedLanguage, array &$params, array &$types): void
    {
        if ($bucket === 'requested' && $requestedLanguage !== null) {
            $params['bucketRequestedLang'] = $requestedLanguage;
            $params['bucketRequestedLocaleLang'] = $requestedLanguage;

            return;
        }

        if ($bucket === 'english') {
            $params['bucketEnglishLang'] = LanguageCatalog::DEFAULT_LANGUAGE;
            $params['bucketEnglishLocaleLang'] = LanguageCatalog::DEFAULT_LANGUAGE;

            return;
        }

        if ($bucket === 'common') {
            $params['bucketCommonLangs'] = LanguageCatalog::commonPrintLanguages();
            $types['bucketCommonLangs'] = ArrayParameterType::STRING;
            $params['bucketCommonLocaleLangs'] = LanguageCatalog::commonPrintLanguages();
            $types['bucketCommonLocaleLangs'] = ArrayParameterType::STRING;
        }
    }

    private function foldedSearchSql(string $expression): string
    {
        return sprintf('LOWER(immutable_unaccent(%s))', $expression);
    }

    private function normalizeSearchQuery(string $query): string
    {
        $normalized = Card::normalizeName($query);

        if (class_exists(\Transliterator::class)) {
            $transliterator = \Transliterator::create('NFD; [:Nonspacing Mark:] Remove; NFC');
            if ($transliterator instanceof \Transliterator) {
                return Card::normalizeName($transliterator->transliterate($normalized));
            }
        }

        if (class_exists(\Normalizer::class)) {
            $decomposed = \Normalizer::normalize($normalized, \Normalizer::FORM_D);
            if (is_string($decomposed)) {
                $withoutMarks = preg_replace('/\p{Mn}+/u', '', $decomposed);
                if (is_string($withoutMarks)) {
                    return Card::normalizeName($withoutMarks);
                }
            }
        }

        $converted = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $normalized);

        return is_string($converted) && $converted !== '' ? Card::normalizeName($converted) : $normalized;
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
            'cardFaces' => $this->normalizeCardFaces($this->decodeJsonArray($row['card_faces'] ?? [])),
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

    /**
     * @param list<mixed> $faces
     *
     * @return list<array<string,mixed>>
     */
    private function normalizeCardFaces(array $faces): array
    {
        $normalized = [];
        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $normalized[] = [
                'name' => $this->nullableString($face['name'] ?? null),
                'manaCost' => $this->nullableString($face['manaCost'] ?? $face['mana_cost'] ?? null),
                'typeLine' => $this->nullableString($face['typeLine'] ?? $face['type_line'] ?? null),
                'oracleText' => $this->nullableString($face['oracleText'] ?? $face['oracle_text'] ?? null),
                'power' => $this->nullableString($face['power'] ?? null),
                'toughness' => $this->nullableString($face['toughness'] ?? null),
                'loyalty' => $this->nullableString($face['loyalty'] ?? null),
                'colors' => $this->arrayValues($face['colors'] ?? []),
                'imageUris' => $this->arrayObject($face['imageUris'] ?? $face['image_uris'] ?? []),
            ];
        }

        return $normalized;
    }

    /**
     * @return list<mixed>
     */
    private function arrayValues(mixed $value): array
    {
        return is_array($value) ? array_values($value) : [];
    }

    /**
     * @return array<string,mixed>
     */
    private function arrayObject(mixed $value): array
    {
        return is_array($value) ? $value : [];
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
