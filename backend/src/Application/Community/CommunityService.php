<?php

namespace App\Application\Community;

use App\Application\Card\CardLocalizationService;
use App\Application\Card\CommanderCandidateSql;
use App\Application\Deck\DeckFormatCatalog;
use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;

final class CommunityService
{
    private const HOME_COMMANDERS_LIMIT = 3;
    private const HOME_CARDS_LIMIT = 3;
    private const HOME_DECKS_LIMIT = 6;
    private const DECKS_PAGE_LIMIT = 20;
    private const TOP_PREVIEW_LIMIT = 100;
    private const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];
    private const HOME_CACHE_TTL_SECONDS = 60;
    private const DECK_LIST_CACHE_TTL_SECONDS = 60;
    private const DECK_DETAIL_CACHE_TTL_SECONDS = 60;
    private const TOP_CACHE_TTL_SECONDS = 300;
    private const PREVIEW_MIN_PLAYED_COUNT = 500;
    private const PREVIEW_MAX_PLAYED_COUNT = 3000;
    private const PREVIEW_TYPE_FILTERS = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery'];
    private const PREVIEW_MESSAGE = "Pr\u{00F3}ximamente: estad\u{00ED}sticas basadas en partidas reales de CommanderZone.";

    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        private readonly CardLocalizationService $localization,
        private readonly CacheInterface $cache,
        #[Autowire('%kernel.environment%')]
        private readonly string $environment,
    )
    {
    }

    /**
     * @return array{
     *   commanders:list<array{id:string,scryfallId:string,name:string,cropImage:?string,colors:list<string>,cardType:?string,cardTypeIcon:?string,timesPlayed:int}>,
     *   cards:list<array{id:string,scryfallId:string,name:string,cropImage:?string,colors:list<string>,cardType:?string,cardTypeIcon:?string,timesPlayed:int}>,
     *   decks:list<array<string,mixed>>
     * }
     */
    public function home(?string $requestedLanguage): array
    {
        return $this->remember(
            $this->cacheKey('home', ['lang' => $requestedLanguage]),
            self::HOME_CACHE_TTL_SECONDS,
            function () use ($requestedLanguage): array {
                return [
                    'commanders' => $this->randomCardPreviews(
                        CommanderCandidateSql::condition('card'),
                        self::HOME_COMMANDERS_LIMIT,
                        $requestedLanguage,
                    ),
                    'cards' => $this->randomCardPreviews(
                        'card.commander_legal = true',
                        self::HOME_CARDS_LIMIT,
                        $requestedLanguage,
                    ),
                    'decks' => $this->fetchDeckSummariesByIds(
                        $this->randomPublicValidDeckIds(self::HOME_DECKS_LIMIT),
                        $requestedLanguage,
                    ),
                ];
            },
        );
    }

    /**
     * @param array{q?:mixed,commander?:mixed,format?:mixed,colors?:mixed,page?:mixed} $filters
     *
     * @return array{decks:list<array<string,mixed>>,page:int,limit:int,total:int,totalPages:int,hasMore:bool}
     */
    public function decks(array $filters, ?string $requestedLanguage): array
    {
        $normalizedFilters = $this->normalizedFilters($filters);
        $page = $this->normalizedPage($filters['page'] ?? null);

        return $this->remember(
            $this->cacheKey('decks', ['lang' => $requestedLanguage, 'filters' => $normalizedFilters, 'page' => $page]),
            self::DECK_LIST_CACHE_TTL_SECONDS,
            function () use ($normalizedFilters, $page, $requestedLanguage): array {
                $deckPage = $this->listPublicValidDeckPage($normalizedFilters, $page);

                return [
                    'decks' => $this->fetchDeckSummariesByIds(
                        $deckPage['ids'],
                        $requestedLanguage,
                    ),
                    'page' => $deckPage['page'],
                    'limit' => $deckPage['limit'],
                    'total' => $deckPage['total'],
                    'totalPages' => $deckPage['totalPages'],
                    'hasMore' => $deckPage['hasMore'],
                ];
            },
        );
    }

    /**
     * @return array{deck:array<string,mixed>}|null
     */
    public function deckDetail(string $id, ?string $requestedLanguage): ?array
    {
        return $this->remember(
            $this->cacheKey('detail', ['id' => $id, 'lang' => $requestedLanguage]),
            self::DECK_DETAIL_CACHE_TTL_SECONDS,
            function () use ($id, $requestedLanguage): ?array {
                $deck = $this->publicDeckByIdOrSlug($id);

                if (!$deck instanceof Deck) {
                    return null;
                }

                return [
                    'deck' => $this->mapDeckDetail($deck, $requestedLanguage),
                ];
            },
        );
    }

    /**
     * @return array{
     *   items:list<array{id:string,scryfallId:string,name:string,cropImage:?string,colors:list<string>,cardType:?string,cardTypeIcon:?string,timesPlayed:int}>,
     *   total:int,
     *   isPreview:true,
     *   message:string
     * }
     */
    public function topCommanders(array $filters, ?string $requestedLanguage): array
    {
        $normalizedFilters = $this->normalizedPreviewFilters($filters);

        return $this->remember(
            $this->cacheKey('top-commanders', ['lang' => $requestedLanguage, 'filters' => $normalizedFilters]),
            self::TOP_CACHE_TTL_SECONDS,
            function () use ($normalizedFilters, $requestedLanguage): array {
                $preview = $this->topPreviewCards(
                    CommanderCandidateSql::condition('card'),
                    $normalizedFilters,
                    self::TOP_PREVIEW_LIMIT,
                    $requestedLanguage,
                );

                return [
                    'items' => $preview['items'],
                    'total' => $preview['total'],
                    'isPreview' => true,
                    'message' => self::PREVIEW_MESSAGE,
                ];
            },
        );
    }

    /**
     * @return array{
     *   items:list<array{id:string,scryfallId:string,name:string,cropImage:?string,colors:list<string>,cardType:?string,cardTypeIcon:?string,timesPlayed:int}>,
     *   total:int,
     *   isPreview:true,
     *   message:string
     * }
     */
    public function topCards(array $filters, ?string $requestedLanguage): array
    {
        $normalizedFilters = $this->normalizedPreviewFilters($filters);

        return $this->remember(
            $this->cacheKey('top-cards', ['lang' => $requestedLanguage, 'filters' => $normalizedFilters]),
            self::TOP_CACHE_TTL_SECONDS,
            function () use ($normalizedFilters, $requestedLanguage): array {
                $preview = $this->topPreviewCards(
                    'card.commander_legal = true',
                    $normalizedFilters,
                    self::TOP_PREVIEW_LIMIT,
                    $requestedLanguage,
                );

                return [
                    'items' => $preview['items'],
                    'total' => $preview['total'],
                    'isPreview' => true,
                    'message' => self::PREVIEW_MESSAGE,
                ];
            },
        );
    }

    /**
     * @return array{
     *   decks:list<array{id:string,slug:string,canonicalPath:string,updatedAt:string}>,
     *   users:list<array{username:string,canonicalPath:string,updatedAt:string}>,
     *   commanders:list<array{slug:string,canonicalPath:string,updatedAt:string}>,
     *   cards:list<array{slug:string,canonicalPath:string,updatedAt:string}>
     * }
     */
    public function indexable(): array
    {
        return [
            'decks' => $this->indexableDecks(),
            'users' => $this->indexableUsers(),
            'commanders' => $this->indexableCards(true),
            'cards' => $this->indexableCards(false),
        ];
    }

    /**
     * @param array{q?:mixed,commander?:mixed,format?:mixed,colors?:mixed,page?:mixed} $filters
     *
     * @return array{user:array<string,mixed>,decks:list<array<string,mixed>>,page:int,limit:int,total:int,totalPages:int,hasMore:bool}|null
     */
    public function user(string $username, array $filters, ?string $requestedLanguage): ?array
    {
        $username = trim($username);
        $decodedUsername = rawurldecode($username);
        $displayNameCandidates = array_values(array_unique([
            mb_strtolower($decodedUsername),
            mb_strtolower(str_replace('-', ' ', $decodedUsername)),
        ]));
        $user = $this->entityManager->getRepository(User::class)->createQueryBuilder('user')
            ->where('LOWER(user.publicHandle) = :username')
            ->orWhere('LOWER(user.displayName) IN (:displayNameCandidates)')
            ->setParameter('username', mb_strtolower($decodedUsername))
            ->setParameter('displayNameCandidates', $displayNameCandidates)
            ->setMaxResults(1)
            ->getQuery()
            ->getOneOrNullResult();
        if (!$user instanceof User) {
            return null;
        }

        $normalizedFilters = $this->normalizedFilters($filters);
        $page = $this->normalizedPage($filters['page'] ?? null);

        return $this->remember(
            $this->cacheKey('user', ['username' => $username, 'lang' => $requestedLanguage, 'filters' => $normalizedFilters, 'page' => $page]),
            self::DECK_LIST_CACHE_TTL_SECONDS,
            function () use ($user, $normalizedFilters, $page, $requestedLanguage): array {
                $deckPage = $this->listPublicValidDeckPage($normalizedFilters, $page, (string) $user->id());

                return [
                    'user' => [
                        'id' => (string) $user->id(),
                        'username' => (string) $user->publicHandle(),
                        'canonicalPath' => (string) $user->publicPath(),
                        'displayName' => $user->displayName(),
                        'avatar' => $user->avatar(),
                        'displayNameStyle' => $user->displayNameStyle(),
                    ],
                    'decks' => $this->fetchDeckSummariesByIds(
                        $deckPage['ids'],
                        $requestedLanguage,
                    ),
                    'page' => $deckPage['page'],
                    'limit' => $deckPage['limit'],
                    'total' => $deckPage['total'],
                    'totalPages' => $deckPage['totalPages'],
                    'hasMore' => $deckPage['hasMore'],
                ];
            },
        );
    }

    /**
     * @return array{item:array<string,mixed>,decks:list<array<string,mixed>>}|null
     */
    public function commanderDetail(string $slug, ?string $requestedLanguage): ?array
    {
        return $this->cardDiscoveryDetail($slug, true, $requestedLanguage);
    }

    /**
     * @return array{item:array<string,mixed>,decks:list<array<string,mixed>>}|null
     */
    public function cardDetail(string $slug, ?string $requestedLanguage): ?array
    {
        return $this->cardDiscoveryDetail($slug, false, $requestedLanguage);
    }

    /**
     * @param array{q:string,commander:string,format:string,colors:string} $filters
     *
     * @return array{ids:list<string>,page:int,limit:int,total:int,totalPages:int,hasMore:bool}
     */
    private function listPublicValidDeckPage(array $filters, int $page, ?string $ownerId = null): array
    {
        $limit = self::DECKS_PAGE_LIMIT;
        $query = $this->publicDeckListQuery($filters, $ownerId);
        if ($query === null) {
            return [
                'ids' => [],
                'page' => 1,
                'limit' => $limit,
                'total' => 0,
                'totalPages' => 1,
                'hasMore' => false,
            ];
        }

        $total = (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT COUNT(*) '.$query['fromWhereSql'],
            $query['params'],
        );
        $totalPages = max(1, (int) ceil($total / $limit));
        $page = min($page, $totalPages);
        $offset = ($page - 1) * $limit;

        $ids = $this->stringIds(
            $this->entityManager->getConnection()->fetchFirstColumn(
                sprintf(
                    "SELECT d.id\n%s\nORDER BY d.updated_at DESC, d.id DESC\nLIMIT %d OFFSET %d",
                    $query['fromWhereSql'],
                    $limit,
                    $offset,
                ),
                $query['params'],
            ),
        );

        return [
            'ids' => $ids,
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'totalPages' => $totalPages,
            'hasMore' => $page < $totalPages,
        ];
    }

    /**
     * @param array{q:string,commander:string,format:string,colors:string} $filters
     *
     * @return array{fromWhereSql:string,params:array<string,mixed>}|null
     */
    private function publicDeckListQuery(array $filters, ?string $ownerId = null): ?array
    {
        $colors = $this->parseColorsFilter($filters['colors']);
        if ($colors === false) {
            return null;
        }

        $sql = <<<'SQL'
FROM deck d
WHERE d.visibility = :visibility
  AND d.is_valid = true
SQL;
        $params = [
            'visibility' => Deck::VISIBILITY_PUBLIC,
            'commanderSection' => DeckCard::SECTION_COMMANDER,
        ];

        if ($ownerId !== null) {
            $sql .= "\n  AND d.owner_id = :ownerId";
            $params['ownerId'] = $ownerId;
        }

        if ($filters['q'] !== '') {
            $sql .= "\n  AND LOWER(d.name) LIKE :deckQuery";
            $params['deckQuery'] = '%'.mb_strtolower($filters['q']).'%';
        }

        if ($filters['format'] !== '') {
            $normalizedFormat = DeckFormatCatalog::normalize($filters['format']);
            if ($normalizedFormat === null) {
                return null;
            }

            $sql .= "\n  AND d.format = :format";
            $params['format'] = $normalizedFormat;
        }

        if ($filters['commander'] !== '') {
            $sql .= <<<'SQL'

  AND EXISTS (
      SELECT 1
      FROM deck_card commander_dc
      JOIN card commander_card ON commander_card.id = commander_dc.card_id
      WHERE commander_dc.deck_id = d.id
        AND commander_dc.section = :commanderSection
        AND (
            commander_card.id = :commanderExactId
            OR commander_card.scryfall_id = :commanderExactId
            OR commander_card.normalized_name LIKE :commanderNormalizedQuery
            OR LOWER(COALESCE(commander_card.printed_name, '')) LIKE :commanderPrintedQuery
        )
  )
SQL;
            $params['commanderExactId'] = $filters['commander'];
            $params['commanderNormalizedQuery'] = '%'.Card::normalizeName($filters['commander']).'%';
            $params['commanderPrintedQuery'] = '%'.mb_strtolower($filters['commander']).'%';
        }

        if ($colors === ['C']) {
            $sql .= <<<'SQL'

  AND NOT EXISTS (
      SELECT 1
      FROM deck_card color_dc
      JOIN card color_card ON color_card.id = color_dc.card_id
      WHERE color_dc.deck_id = d.id
        AND color_dc.section = :commanderSection
        AND jsonb_array_length(COALESCE(color_card.color_identity::jsonb, '[]'::jsonb)) > 0
  )
SQL;
        } elseif (is_array($colors)) {
            foreach (array_values($colors) as $index => $color) {
                $colorParam = 'communityColor'.$index;
                $sql .= sprintf(
                    "\n  AND EXISTS (\n      SELECT 1\n      FROM deck_card color_dc_%1\$d\n      JOIN card color_card_%1\$d ON color_card_%1\$d.id = color_dc_%1\$d.card_id\n      WHERE color_dc_%1\$d.deck_id = d.id\n        AND color_dc_%1\$d.section = :commanderSection\n        AND COALESCE(color_card_%1\$d.color_identity::jsonb, '[]'::jsonb) @> :%2\$s::jsonb\n  )",
                    $index,
                    $colorParam,
                );
                $params[$colorParam] = json_encode([$color], JSON_THROW_ON_ERROR);
            }
        }

        return [
            'fromWhereSql' => $sql,
            'params' => $params,
        ];
    }

    /**
     * @return list<string>
     */
    private function randomPublicValidDeckIds(int $limit): array
    {
        return $this->stringIds(
            $this->entityManager->getConnection()->fetchFirstColumn(
                sprintf(
                    'SELECT d.id FROM deck d WHERE d.visibility = :visibility AND d.is_valid = true ORDER BY RANDOM() LIMIT %d',
                    max(1, $limit),
                ),
                ['visibility' => Deck::VISIBILITY_PUBLIC],
            ),
        );
    }

    /**
     * @return list<array{id:string,scryfallId:string,name:string,cropImage:?string,colors:list<string>,cardType:?string,cardTypeIcon:?string,timesPlayed:int}>
     */
    private function randomCardPreviews(string $whereSql, int $limit, ?string $requestedLanguage): array
    {
        $rows = $this->entityManager->getConnection()->fetchAllAssociative(
            sprintf(
                'SELECT card.id, card.scryfall_id, card.name, card.printed_name, card.colors, card.image_uris, card.card_faces, card.type_line FROM card WHERE %s ORDER BY RANDOM() LIMIT %d',
                $whereSql,
                max(1, $limit),
            ),
        );

        return $this->mapCardPreviewRows($rows, $requestedLanguage);
    }

    /**
     * @param array{type:string,colors:string} $filters
     *
     * @return array{
     *   items:list<array{id:string,scryfallId:string,name:string,cropImage:?string,imageUris:array<string,mixed>,cardFaces:list<array<string,mixed>>,colors:list<string>,cardType:?string,cardTypeIcon:?string,timesPlayed:int}>,
     *   total:int
     * }
     */
    private function topPreviewCards(string $baseWhereSql, array $filters, int $limit, ?string $requestedLanguage): array
    {
        $query = $this->previewQuery($baseWhereSql, $filters);
        if ($query === null) {
            return [
                'items' => [],
                'total' => 0,
            ];
        }

        $rows = $this->entityManager->getConnection()->fetchAllAssociative(
            sprintf(
                'SELECT card.id, card.scryfall_id, card.name, card.printed_name, card.colors, card.image_uris, card.card_faces, card.type_line FROM card WHERE %s ORDER BY RANDOM() LIMIT %d',
                $query['whereSql'],
                max(1, $limit),
            ),
            $query['params'],
        );

        $total = (int) $this->entityManager->getConnection()->fetchOne(
            sprintf('SELECT COUNT(*) FROM card WHERE %s', $query['whereSql']),
            $query['params'],
        );

        return [
            'items' => $this->mapCardPreviewRows($rows, $requestedLanguage),
            'total' => $total,
        ];
    }

    /**
     * @param array{type:string,colors:string} $filters
     *
     * @return array{
     *   items:list<array{id:string,scryfallId:string,name:string,cropImage:?string,imageUris:array<string,mixed>,cardFaces:list<array<string,mixed>>,colors:list<string>,cardType:?string,cardTypeIcon:?string,timesPlayed:int}>,
     *   total:int
     * }
     */
    private function topPublicDeckCards(bool $commandersOnly, array $filters, int $limit, ?string $requestedLanguage): array
    {
        $query = $this->publicDeckCardStatsQuery($commandersOnly, $filters);
        if ($query === null) {
            return [
                'items' => [],
                'total' => 0,
            ];
        }

        $rows = $this->entityManager->getConnection()->fetchAllAssociative(
            sprintf(
                <<<'SQL'
SELECT
    card.id,
    card.scryfall_id,
    card.name,
    card.printed_name,
    card.colors,
    card.image_uris,
    card.card_faces,
    card.type_line,
    COUNT(DISTINCT deck.id) AS public_deck_count,
    MAX(deck.updated_at) AS latest_deck_updated_at
FROM deck
JOIN deck_card ON deck_card.deck_id = deck.id
JOIN card ON card.id = deck_card.card_id
WHERE %s
GROUP BY card.id
ORDER BY public_deck_count DESC, card.name ASC
LIMIT %d
SQL,
                $query['whereSql'],
                max(1, $limit),
            ),
            $query['params'],
        );

        $total = (int) $this->entityManager->getConnection()->fetchOne(
            sprintf(
                <<<'SQL'
SELECT COUNT(*) FROM (
    SELECT card.id
    FROM deck
    JOIN deck_card ON deck_card.deck_id = deck.id
    JOIN card ON card.id = deck_card.card_id
    WHERE %s
    GROUP BY card.id
) stats
SQL,
                $query['whereSql'],
            ),
            $query['params'],
        );

        return [
            'items' => $this->mapCardPreviewRows($rows, $requestedLanguage),
            'total' => $total,
        ];
    }

    /**
     * @param list<string> $deckIds
     *
     * @return list<array<string,mixed>>
     */
    private function fetchDeckSummariesByIds(array $deckIds, ?string $requestedLanguage): array
    {
        if ($deckIds === []) {
            return [];
        }

        $rows = $this->entityManager->getConnection()->fetchAllAssociative(
            <<<'SQL'
SELECT
    d.id AS deck_id,
    d.public_slug AS deck_public_slug,
    d.name AS deck_name,
    d.format AS deck_format,
    d.is_valid AS deck_valid,
    d.updated_at AS deck_updated_at,
    dc.id AS commander_entry_id,
    c.id AS card_id,
    c.scryfall_id,
    c.name AS card_name,
    c.printed_name,
    c.colors,
    c.color_identity,
    c.image_uris,
    c.card_faces
FROM deck d
LEFT JOIN deck_card dc
    ON dc.deck_id = d.id
   AND dc.section = :commanderSection
LEFT JOIN card c
    ON c.id = dc.card_id
WHERE d.id IN (:ids)
ORDER BY d.updated_at DESC, dc.id ASC
SQL,
            [
                'commanderSection' => DeckCard::SECTION_COMMANDER,
                'ids' => $deckIds,
            ],
            [
                'ids' => ArrayParameterType::STRING,
            ],
        );

        $grouped = [];
        $localizationPayloads = [];
        $localizationTargets = [];

        foreach ($rows as $row) {
            $deckId = trim((string) ($row['deck_id'] ?? ''));
            if ($deckId === '') {
                continue;
            }

            if (!isset($grouped[$deckId])) {
                $grouped[$deckId] = [
                    'id' => $deckId,
                    'publicSlug' => $this->nullableString($row['deck_public_slug'] ?? null),
                    'name' => (string) ($row['deck_name'] ?? ''),
                    'format' => (string) ($row['deck_format'] ?? DeckFormatCatalog::COMMANDER),
                    'valid' => $this->boolValue($row['deck_valid'] ?? false),
                    'updatedAt' => $this->dateTimeAtom($row['deck_updated_at'] ?? null),
                    'commanders' => [],
                ];
            }

            if (trim((string) ($row['card_id'] ?? '')) === '') {
                continue;
            }

            $payload = $this->cardPayloadFromSummaryRow($row);
            $grouped[$deckId]['commanders'][] = $payload;
            $localizationPayloads[] = $payload;
            $localizationTargets[] = [
                'deckId' => $deckId,
                'index' => count($grouped[$deckId]['commanders']) - 1,
            ];
        }

        if ($localizationPayloads !== []) {
            $localizedPayloads = $this->localizeCardPayloads($localizationPayloads, $requestedLanguage);
            foreach ($localizationTargets as $offset => $target) {
                $localized = $localizedPayloads[$offset] ?? null;
                if (!is_array($localized)) {
                    continue;
                }

                $grouped[$target['deckId']]['commanders'][$target['index']] = $localized;
            }
        }

        $summaries = [];
        foreach ($deckIds as $deckId) {
            if (!isset($grouped[$deckId])) {
                continue;
            }

            $summaries[] = $this->mapDeckSummaryFromArray($grouped[$deckId]);
        }

        return $summaries;
    }

    /**
     * @param array<string,mixed> $deck
     *
     * @return array<string,mixed>
     */
    private function mapDeckSummaryFromArray(array $deck): array
    {
        $commanders = is_array($deck['commanders'] ?? null) ? $deck['commanders'] : [];
        $primaryCommander = $commanders[0] ?? null;
        $secondaryCommander = $commanders[1] ?? null;

        return [
            'id' => (string) ($deck['id'] ?? ''),
            'publicSlug' => $this->nullableString($deck['publicSlug'] ?? null),
            'canonicalPath' => $this->canonicalDeckPath($this->nullableString($deck['publicSlug'] ?? null), (string) ($deck['id'] ?? '')),
            'name' => (string) ($deck['name'] ?? ''),
            'format' => (string) ($deck['format'] ?? DeckFormatCatalog::COMMANDER),
            'valid' => $this->boolValue($deck['valid'] ?? false),
            'cropImage' => $this->cardCropImage(is_array($primaryCommander) ? $primaryCommander : null),
            'secondaryCropImage' => $this->cardCropImage(is_array($secondaryCommander) ? $secondaryCommander : null),
            'commanderName' => $this->commanderDisplayName($commanders),
            'colorIdentity' => $this->commanderColorIdentity($commanders),
            'updatedAt' => (string) ($deck['updatedAt'] ?? ''),
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function mapDeckDetail(Deck $deck, ?string $requestedLanguage): array
    {
        $deck->ensurePublicSlug();
        $deck->owner()->ensurePublicHandle();
        $this->entityManager->flush();

        $payload = $deck->toArray(true);
        $payload['commanders'] = $this->localizeCardPayloads(
            is_array($payload['commanders'] ?? null) ? $payload['commanders'] : [],
            $requestedLanguage,
        );
        $payload['cards'] = $this->localizeDeckCardLines(
            is_array($payload['cards'] ?? null) ? $payload['cards'] : [],
            $requestedLanguage,
        );
        $payload['sections'] = $this->sectionsFromDeckCards($payload['cards']);
        $payload['owner'] = [
            'id' => (string) $deck->owner()->id(),
            'displayName' => $deck->owner()->displayName(),
            'username' => $deck->owner()->publicHandle(),
            'canonicalPath' => $deck->owner()->publicPath(),
            'avatar' => $deck->owner()->avatar(),
            'displayNameStyle' => $deck->owner()->displayNameStyle(),
        ];

        return $payload;
    }

    /**
     * @param list<array<string,mixed>> $rows
     *
     * @return list<array{id:string,scryfallId:string,name:string,cropImage:?string,colors:list<string>,cardType:?string,cardTypeIcon:?string,timesPlayed:int}>
     */
    private function mapCardPreviewRows(array $rows, ?string $requestedLanguage): array
    {
        if ($rows === []) {
            return [];
        }

        $payloads = array_map(
            fn (array $row): array => $this->cardPayloadFromPreviewRow($row),
            $rows,
        );
        $localizedPayloads = $this->localizeCardPayloads($payloads, $requestedLanguage);

        $items = array_map(
            function (array $payload, array $sourcePayload): array {
                return [
                    'id' => (string) ($payload['id'] ?? ''),
                    'scryfallId' => (string) ($payload['scryfallId'] ?? ''),
                    'name' => $this->cardDisplayName($payload),
                    'cropImage' => $this->cardCropImage($payload),
                    'imageUris' => is_array($payload['imageUris'] ?? null) ? $payload['imageUris'] : [],
                    'cardFaces' => is_array($payload['cardFaces'] ?? null) ? array_values($payload['cardFaces']) : [],
                    'colors' => is_array($payload['colors'] ?? null) ? array_values($payload['colors']) : [],
                    'cardType' => $this->cardTypeLine($payload),
                    'cardTypeIcon' => $this->cardTypeIcon($sourcePayload),
                    'timesPlayed' => array_key_exists('publicDeckCount', $sourcePayload)
                        ? max(0, (int) ($sourcePayload['publicDeckCount'] ?? 0))
                        : $this->stablePreviewPlayedCount($payload),
                    'updatedAt' => $this->dateTimeAtom($sourcePayload['latestDeckUpdatedAt'] ?? null),
                    'slug' => $this->cardSlug($payload),
                    'canonicalPath' => $this->cardCanonicalPath($payload),
                ];
            },
            $localizedPayloads,
            $payloads,
        );

        usort(
            $items,
            static fn (array $left, array $right): int => ($right['timesPlayed'] <=> $left['timesPlayed'])
                ?: strcmp((string) ($left['name'] ?? ''), (string) ($right['name'] ?? ''))
                ?: strcmp((string) ($left['scryfallId'] ?? ''), (string) ($right['scryfallId'] ?? '')),
        );

        return array_values($items);
    }

    /**
     * @param array<string,mixed> $row
     *
     * @return array<string,mixed>
     */
    private function cardPayloadFromPreviewRow(array $row): array
    {
        $payload = [
            'id' => (string) ($row['id'] ?? ''),
            'scryfallId' => (string) ($row['scryfall_id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'printedName' => $this->nullableString($row['printed_name'] ?? null),
            'typeLine' => $this->nullableString($row['type_line'] ?? null),
            'colors' => $this->decodeJsonArray($row['colors'] ?? []),
            'imageUris' => $this->decodeJsonArray($row['image_uris'] ?? []),
            'cardFaces' => $this->decodeJsonArray($row['card_faces'] ?? []),
        ];

        if (array_key_exists('public_deck_count', $row)) {
            $payload['publicDeckCount'] = (int) ($row['public_deck_count'] ?? 0);
        }
        if (array_key_exists('latest_deck_updated_at', $row)) {
            $payload['latestDeckUpdatedAt'] = $row['latest_deck_updated_at'];
        }

        return $payload;
    }

    /**
     * @param array<string,mixed> $row
     *
     * @return array<string,mixed>
     */
    private function cardPayloadFromSummaryRow(array $row): array
    {
        return [
            'id' => (string) ($row['card_id'] ?? ''),
            'scryfallId' => (string) ($row['scryfall_id'] ?? ''),
            'name' => (string) ($row['card_name'] ?? ''),
            'printedName' => $this->nullableString($row['printed_name'] ?? null),
            'colors' => $this->decodeJsonArray($row['colors'] ?? []),
            'colorIdentity' => $this->decodeJsonArray($row['color_identity'] ?? []),
            'imageUris' => $this->decodeJsonArray($row['image_uris'] ?? []),
            'cardFaces' => $this->decodeJsonArray($row['card_faces'] ?? []),
        ];
    }

    /**
     * @param list<array<string,mixed>> $payloads
     *
     * @return list<array<string,mixed>>
     */
    private function localizeCardPayloads(array $payloads, ?string $requestedLanguage): array
    {
        if ($payloads === []) {
            return [];
        }

        return $this->localization->localizeCardPayloads($payloads, $requestedLanguage, true);
    }

    /**
     * @param list<array<string,mixed>> $lines
     *
     * @return list<array<string,mixed>>
     */
    private function localizeDeckCardLines(array $lines, ?string $requestedLanguage): array
    {
        $payloads = [];
        $indexes = [];
        foreach ($lines as $index => $line) {
            if (!is_array($line) || !is_array($line['card'] ?? null)) {
                continue;
            }

            $indexes[] = $index;
            $payloads[] = $line['card'];
        }

        if ($payloads === []) {
            return array_values($lines);
        }

        $localizedPayloads = $this->localizeCardPayloads($payloads, $requestedLanguage);
        foreach ($indexes as $offset => $index) {
            if (is_array($localizedPayloads[$offset] ?? null) && is_array($lines[$index] ?? null)) {
                $lines[$index]['card'] = $localizedPayloads[$offset];
            }
        }

        return array_values($lines);
    }

    /**
     * @param list<array<string,mixed>> $cards
     *
     * @return array{commander:list<array<string,mixed>>,main:list<array<string,mixed>>,sideboard:list<array<string,mixed>>,maybeboard:list<array<string,mixed>>}
     */
    private function sectionsFromDeckCards(array $cards): array
    {
        $sections = [
            DeckCard::SECTION_COMMANDER => [],
            DeckCard::SECTION_MAIN => [],
            DeckCard::SECTION_SIDEBOARD => [],
            DeckCard::SECTION_MAYBEBOARD => [],
        ];

        foreach ($cards as $line) {
            if (!is_array($line)) {
                continue;
            }

            $section = (string) ($line['section'] ?? '');
            if (!array_key_exists($section, $sections)) {
                continue;
            }

            $sections[$section][] = $line;
        }

        return $sections;
    }

    /**
     * @param list<array<string,mixed>> $commanders
     *
     * @return list<string>
     */
    private function commanderColorIdentity(array $commanders): array
    {
        $seen = [];
        foreach ($commanders as $commander) {
            foreach (($commander['colorIdentity'] ?? []) as $color) {
                $normalized = strtoupper(trim((string) $color));
                if ($normalized !== '') {
                    $seen[$normalized] = true;
                }
            }
        }

        $ordered = [];
        foreach (self::COLOR_ORDER as $color) {
            if (isset($seen[$color])) {
                $ordered[] = $color;
                unset($seen[$color]);
            }
        }

        $extra = array_keys($seen);
        sort($extra);

        $colors = [...$ordered, ...$extra];
        if ($colors === [] && $commanders !== []) {
            return ['C'];
        }

        return $colors;
    }

    /**
     * @param list<array<string,mixed>> $commanders
     */
    private function commanderDisplayName(array $commanders): ?string
    {
        $names = array_values(array_filter(
            array_map(fn (array $payload): string => $this->cardDisplayName($payload), $commanders),
            static fn (string $name): bool => $name !== '',
        ));

        return $names === [] ? null : implode(' / ', $names);
    }

    /**
     * @param array<string,mixed>|null $payload
     */
    private function cardCropImage(?array $payload): ?string
    {
        if ($payload === null) {
            return null;
        }

        $imageUris = is_array($payload['imageUris'] ?? null) ? $payload['imageUris'] : [];
        foreach (['art_crop', 'border_crop', 'large', 'normal', 'small', 'png'] as $key) {
            $value = $imageUris[$key] ?? null;
            if (is_string($value) && trim($value) !== '') {
                return $value;
            }
        }

        $faces = is_array($payload['cardFaces'] ?? null) ? $payload['cardFaces'] : [];
        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $faceImageUris = is_array($face['imageUris'] ?? null) ? $face['imageUris'] : [];
            foreach (['art_crop', 'border_crop', 'large', 'normal', 'small', 'png'] as $key) {
                $value = $faceImageUris[$key] ?? null;
                if (is_string($value) && trim($value) !== '') {
                    return $value;
                }
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function cardDisplayName(array $payload): string
    {
        $printedName = trim((string) ($payload['printedName'] ?? ''));
        if ($printedName !== '') {
            return $printedName;
        }

        return trim((string) ($payload['name'] ?? ''));
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function cardTypeLine(array $payload): ?string
    {
        $typeLine = trim((string) ($payload['typeLine'] ?? ''));
        if ($typeLine !== '') {
            return $typeLine;
        }

        $faces = is_array($payload['cardFaces'] ?? null) ? $payload['cardFaces'] : [];
        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $faceTypeLine = trim((string) ($face['typeLine'] ?? $face['type_line'] ?? ''));
            if ($faceTypeLine !== '') {
                return $faceTypeLine;
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function cardTypeIcon(array $payload): ?string
    {
        $typeLine = strtolower($this->cardTypeLine($payload) ?? '');
        if ($typeLine === '') {
            return null;
        }

        foreach (['battle', 'creature', 'artifact', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery'] as $icon) {
            if (str_contains($typeLine, $icon)) {
                return $icon;
            }
        }

        return 'multiple';
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function stablePreviewPlayedCount(array $payload): int
    {
        $seed = trim((string) ($payload['scryfallId'] ?? $payload['id'] ?? $payload['name'] ?? ''));
        $range = self::PREVIEW_MAX_PLAYED_COUNT - self::PREVIEW_MIN_PLAYED_COUNT + 1;
        $offset = abs((int) crc32($seed)) % $range;

        return self::PREVIEW_MIN_PLAYED_COUNT + $offset;
    }

    /**
     * @return list<string>|false
     */
    private function parseColorsFilter(string $value): array|false
    {
        $raw = strtoupper(trim($value));
        if ($raw === '') {
            return [];
        }

        $tokens = str_contains($raw, ',')
            ? preg_split('/\s*,\s*/', $raw, -1, PREG_SPLIT_NO_EMPTY)
            : preg_split('/\s*/', $raw, -1, PREG_SPLIT_NO_EMPTY);
        if (!is_array($tokens) || $tokens === []) {
            return false;
        }

        $unique = [];
        foreach ($tokens as $token) {
            $normalized = trim((string) $token);
            if (!in_array($normalized, ['W', 'U', 'B', 'R', 'G', 'C'], true)) {
                return false;
            }

            $unique[$normalized] = true;
        }

        $colors = array_keys($unique);
        if (in_array('C', $colors, true) && count($colors) > 1) {
            return false;
        }

        usort($colors, function (string $left, string $right): int {
            $leftIndex = array_search($left, [...self::COLOR_ORDER, 'C'], true);
            $rightIndex = array_search($right, [...self::COLOR_ORDER, 'C'], true);

            return (is_int($leftIndex) ? $leftIndex : 99) <=> (is_int($rightIndex) ? $rightIndex : 99);
        });

        return $colors;
    }

    /**
     * @param array{q?:mixed,commander?:mixed,format?:mixed,colors?:mixed,page?:mixed} $filters
     *
     * @return array{q:string,commander:string,format:string,colors:string}
     */
    private function normalizedFilters(array $filters): array
    {
        return [
            'q' => trim((string) ($filters['q'] ?? '')),
            'commander' => trim((string) ($filters['commander'] ?? '')),
            'format' => trim((string) ($filters['format'] ?? '')),
            'colors' => trim((string) ($filters['colors'] ?? '')),
        ];
    }

    /**
     * @param array{type?:mixed,colors?:mixed} $filters
     *
     * @return array{type:string,colors:string}
     */
    private function normalizedPreviewFilters(array $filters): array
    {
        return [
            'type' => mb_strtolower(trim((string) ($filters['type'] ?? ''))),
            'colors' => trim((string) ($filters['colors'] ?? '')),
        ];
    }

    /**
     * @param array{type:string,colors:string} $filters
     *
     * @return array{whereSql:string,params:array<string,mixed>}|null
     */
    private function previewQuery(string $baseWhereSql, array $filters): ?array
    {
        $whereParts = [$baseWhereSql];
        $params = [];

        if ($filters['type'] !== '') {
            if (!in_array($filters['type'], self::PREVIEW_TYPE_FILTERS, true)) {
                return null;
            }

            $whereParts[] = "(LOWER(COALESCE(card.type_line, '')) LIKE :previewType OR LOWER(COALESCE(card.card_faces::text, '')) LIKE :previewType)";
            $params['previewType'] = '%'.$filters['type'].'%';
        }

        $colors = $this->parseColorsFilter($filters['colors']);
        if ($colors === false) {
            return null;
        }

        if ($colors === ['C']) {
            $whereParts[] = "jsonb_array_length(COALESCE(card.colors::jsonb, '[]'::jsonb)) = 0";
        } elseif (is_array($colors) && $colors !== []) {
            foreach (array_values($colors) as $index => $color) {
                $paramName = 'previewColor'.$index;
                $whereParts[] = sprintf(
                    "COALESCE(card.colors::jsonb, '[]'::jsonb) @> :%s::jsonb",
                    $paramName,
                );
                $params[$paramName] = json_encode([$color], JSON_THROW_ON_ERROR);
            }
        }

        return [
            'whereSql' => implode(' AND ', $whereParts),
            'params' => $params,
        ];
    }

    private function normalizedPage(mixed $page): int
    {
        $normalized = (int) $page;

        return max(1, $normalized);
    }

    /**
     * @param array{type:string,colors:string} $filters
     *
     * @return array{whereSql:string,params:array<string,mixed>}|null
     */
    private function publicDeckCardStatsQuery(bool $commandersOnly, array $filters): ?array
    {
        $whereParts = [
            'deck.visibility = :visibility',
            'deck.is_valid = true',
        ];
        $params = ['visibility' => Deck::VISIBILITY_PUBLIC];

        if ($commandersOnly) {
            $whereParts[] = 'deck_card.section = :commanderSection';
            $whereParts[] = CommanderCandidateSql::condition('card');
            $params['commanderSection'] = DeckCard::SECTION_COMMANDER;
        } else {
            $whereParts[] = 'card.commander_legal = true';
        }

        if ($filters['type'] !== '') {
            if (!in_array($filters['type'], self::PREVIEW_TYPE_FILTERS, true)) {
                return null;
            }

            $whereParts[] = "(LOWER(COALESCE(card.type_line, '')) LIKE :previewType OR LOWER(COALESCE(card.card_faces::text, '')) LIKE :previewType)";
            $params['previewType'] = '%'.$filters['type'].'%';
        }

        $colors = $this->parseColorsFilter($filters['colors']);
        if ($colors === false) {
            return null;
        }

        if ($colors === ['C']) {
            $whereParts[] = "jsonb_array_length(COALESCE(card.colors::jsonb, '[]'::jsonb)) = 0";
        } elseif (is_array($colors) && $colors !== []) {
            foreach (array_values($colors) as $index => $color) {
                $paramName = 'previewColor'.$index;
                $whereParts[] = sprintf(
                    "COALESCE(card.colors::jsonb, '[]'::jsonb) @> :%s::jsonb",
                    $paramName,
                );
                $params[$paramName] = json_encode([$color], JSON_THROW_ON_ERROR);
            }
        }

        return [
            'whereSql' => implode(' AND ', $whereParts),
            'params' => $params,
        ];
    }

    private function publicDeckByIdOrSlug(string $idOrSlug): ?Deck
    {
        $idOrSlug = trim($idOrSlug);
        if ($idOrSlug === '') {
            return null;
        }

        return $this->entityManager->getRepository(Deck::class)->findOneBy([
            str_contains($idOrSlug, '-') && strlen($idOrSlug) > 36 ? 'publicSlug' : 'id' => $idOrSlug,
            'visibility' => Deck::VISIBILITY_PUBLIC,
            'valid' => true,
        ]) ?? $this->entityManager->getRepository(Deck::class)->findOneBy([
            'publicSlug' => $idOrSlug,
            'visibility' => Deck::VISIBILITY_PUBLIC,
            'valid' => true,
        ]);
    }

    /**
     * @return list<array{id:string,slug:string,canonicalPath:string,updatedAt:string}>
     */
    private function indexableDecks(): array
    {
        $rows = $this->entityManager->getConnection()->fetchAllAssociative(
            <<<'SQL'
SELECT id, public_slug, updated_at
FROM deck
WHERE visibility = :visibility
  AND is_valid = true
  AND public_slug IS NOT NULL
ORDER BY updated_at DESC
SQL,
            ['visibility' => Deck::VISIBILITY_PUBLIC],
        );

        return array_values(array_map(fn (array $row): array => [
            'id' => (string) ($row['id'] ?? ''),
            'slug' => (string) ($row['public_slug'] ?? ''),
            'canonicalPath' => $this->canonicalDeckPath((string) ($row['public_slug'] ?? ''), (string) ($row['id'] ?? '')),
            'updatedAt' => $this->dateTimeAtom($row['updated_at'] ?? null),
        ], $rows));
    }

    /**
     * @return list<array{username:string,canonicalPath:string,updatedAt:string}>
     */
    private function indexableUsers(): array
    {
        $rows = $this->entityManager->getConnection()->fetchAllAssociative(
            <<<'SQL'
SELECT u.display_name, MAX(d.updated_at) AS updated_at
FROM app_user u
JOIN deck d ON d.owner_id = u.id
WHERE d.visibility = :visibility
  AND d.is_valid = true
GROUP BY u.id, u.display_name
ORDER BY updated_at DESC
LIMIT 5000
SQL,
            ['visibility' => Deck::VISIBILITY_PUBLIC],
        );

        return array_values(array_map(fn (array $row): array => [
            'username' => $this->urlUsername((string) ($row['display_name'] ?? '')),
            'canonicalPath' => sprintf('/community/users/%s', rawurlencode($this->urlUsername((string) ($row['display_name'] ?? '')))),
            'updatedAt' => $this->dateTimeAtom($row['updated_at'] ?? null),
        ], $rows));
    }

    /**
     * @return list<array{slug:string,canonicalPath:string,updatedAt:string}>
     */
    private function indexableCards(bool $commandersOnly): array
    {
        $stats = $this->topPublicDeckCards($commandersOnly, ['type' => '', 'colors' => ''], 5000, null);
        $pathPrefix = $commandersOnly ? '/community/commanders/' : '/community/cards/';

        return array_values(array_map(fn (array $item): array => [
            'slug' => (string) ($item['slug'] ?? ''),
            'canonicalPath' => $pathPrefix.(string) ($item['slug'] ?? '').'/',
            'updatedAt' => (string) ($item['updatedAt'] ?? ''),
        ], array_filter(
            $stats['items'],
            static fn (array $item): bool => trim((string) ($item['slug'] ?? '')) !== '',
        )));
    }

    /**
     * @return array{item:array<string,mixed>,decks:list<array<string,mixed>>}|null
     */
    private function cardDiscoveryDetail(string $slug, bool $commandersOnly, ?string $requestedLanguage): ?array
    {
        $suffix = $this->slugSuffix($slug);
        if ($suffix === '') {
            return null;
        }

        $filters = ['type' => '', 'colors' => ''];
        $stats = $this->topPublicDeckCards($commandersOnly, $filters, 5000, $requestedLanguage);
        $item = null;
        foreach ($stats['items'] as $candidate) {
            if (($candidate['slug'] ?? '') === $slug || str_ends_with((string) ($candidate['slug'] ?? ''), '-'.$suffix)) {
                $item = $candidate;
                break;
            }
        }

        if ($item === null) {
            return null;
        }

        return [
            'item' => $item,
            'decks' => $this->fetchDeckSummariesByIds(
                $this->publicValidDeckIdsForCard((string) $item['scryfallId'], $commandersOnly),
                $requestedLanguage,
            ),
        ];
    }

    /**
     * @return list<string>
     */
    private function publicValidDeckIdsForCard(string $scryfallId, bool $commandersOnly): array
    {
        $whereSection = $commandersOnly ? 'AND deck_card.section = :commanderSection' : '';
        $params = [
            'scryfallId' => $scryfallId,
            'visibility' => Deck::VISIBILITY_PUBLIC,
        ];
        if ($commandersOnly) {
            $params['commanderSection'] = DeckCard::SECTION_COMMANDER;
        }

        return $this->stringIds($this->entityManager->getConnection()->fetchFirstColumn(
            sprintf(
                <<<'SQL'
SELECT DISTINCT deck.id, deck.updated_at
FROM deck
JOIN deck_card ON deck_card.deck_id = deck.id
JOIN card ON card.id = deck_card.card_id
WHERE deck.visibility = :visibility
  AND deck.is_valid = true
  AND card.scryfall_id = :scryfallId
  %s
ORDER BY deck.updated_at DESC
LIMIT 100
SQL,
                $whereSection,
            ),
            $params,
        ));
    }

    private function canonicalDeckPath(?string $slug, string $id): string
    {
        $identifier = $slug !== null && $slug !== '' ? $slug : $id;

        return sprintf('/community/decks/%s/', $identifier);
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function cardSlug(array $payload): string
    {
        $suffix = $this->cardSlugSuffix((string) ($payload['scryfallId'] ?? $payload['id'] ?? ''));
        if ($suffix === '') {
            return '';
        }

        return sprintf('%s-%s', $this->slugPart($this->cardDisplayName($payload)), $suffix);
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function cardCanonicalPath(array $payload): string
    {
        $slug = $this->cardSlug($payload);

        return $slug === '' ? '' : sprintf('/community/cards/%s/', $slug);
    }

    private function cardSlugSuffix(string $value): string
    {
        $compact = preg_replace('/[^a-z0-9]/i', '', $value) ?? '';

        return strtolower(substr($compact, -8));
    }

    private function slugSuffix(string $slug): string
    {
        $parts = explode('-', trim($slug));

        return strtolower((string) end($parts));
    }

    private function slugPart(string $value): string
    {
        $slug = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
        if (!is_string($slug)) {
            $slug = $value;
        }

        $slug = strtolower(trim($slug));
        $slug = preg_replace('/[^a-z0-9]+/', '-', $slug) ?? '';
        $slug = trim($slug, '-');

        return $slug !== '' ? substr($slug, 0, 140) : 'card';
    }

    private function urlUsername(string $displayName): string
    {
        $username = preg_replace('/\s+/', '-', trim($displayName)) ?? '';

        return $username !== '' ? $username : 'Player';
    }

    /**
     * @param array<string,mixed> $parts
     */
    private function cacheKey(string $prefix, array $parts): string
    {
        ksort($parts);

        return 'community.'.$prefix.'.'.hash('sha256', (string) json_encode($parts, JSON_THROW_ON_ERROR));
    }

    /**
     * @return list<string>
     */
    private function stringIds(array $ids): array
    {
        return array_values(array_filter(
            array_map(static fn (mixed $id): string => trim((string) $id), $ids),
            static fn (string $id): bool => $id !== '',
        ));
    }

    private function dateTimeAtom(mixed $value): string
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format(DATE_ATOM);
        }

        $stringValue = trim((string) $value);
        if ($stringValue === '') {
            return '';
        }

        return (new \DateTimeImmutable($stringValue))->format(DATE_ATOM);
    }

    /**
     * @return array<int,mixed>
     */
    private function decodeJsonArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (!is_string($value) || trim($value) === '') {
            return [];
        }

        try {
            $decoded = json_decode($value, true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [];
        }

        return is_array($decoded) ? $decoded : [];
    }

    private function boolValue(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if (is_numeric($value)) {
            return (int) $value === 1;
        }

        return in_array(mb_strtolower(trim((string) $value)), ['true', 't', '1'], true);
    }

    private function nullableString(mixed $value): ?string
    {
        $stringValue = trim((string) $value);

        return $stringValue === '' ? null : $stringValue;
    }

    private function remember(string $cacheKey, int $ttlSeconds, callable $resolver): mixed
    {
        if ($this->environment === 'test') {
            return $resolver();
        }

        return $this->cache->get($cacheKey, function (ItemInterface $item) use ($ttlSeconds, $resolver): mixed {
            $item->expiresAfter($ttlSeconds);

            return $resolver();
        });
    }
}
