<?php

namespace App\Application\Community;

use App\Application\Card\CardLocalizationService;
use App\Application\Deck\DeckFormatCatalog;
use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
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
                        $this->commanderCandidateWhereSql('card'),
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
     * @param array{q?:mixed,commander?:mixed,format?:mixed,colors?:mixed} $filters
     *
     * @return array{decks:list<array<string,mixed>>}
     */
    public function decks(array $filters, ?string $requestedLanguage): array
    {
        $normalizedFilters = $this->normalizedFilters($filters);

        return $this->remember(
            $this->cacheKey('decks', ['lang' => $requestedLanguage, 'filters' => $normalizedFilters]),
            self::DECK_LIST_CACHE_TTL_SECONDS,
            function () use ($normalizedFilters, $requestedLanguage): array {
                return [
                    'decks' => $this->fetchDeckSummariesByIds(
                        $this->listPublicValidDeckIds($normalizedFilters),
                        $requestedLanguage,
                    ),
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
                $deck = $this->entityManager->getRepository(Deck::class)->findOneBy([
                    'id' => $id,
                    'visibility' => Deck::VISIBILITY_PUBLIC,
                    'valid' => true,
                ]);

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
                    $this->commanderCandidateWhereSql('card'),
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
     * @param array{q:string,commander:string,format:string,colors:string} $filters
     *
     * @return list<string>
     */
    private function listPublicValidDeckIds(array $filters): array
    {
        $colors = $this->parseColorsFilter($filters['colors']);
        if ($colors === false) {
            return [];
        }

        $sql = <<<'SQL'
SELECT d.id
FROM deck d
WHERE d.visibility = :visibility
  AND d.is_valid = true
SQL;
        $params = [
            'visibility' => Deck::VISIBILITY_PUBLIC,
            'commanderSection' => DeckCard::SECTION_COMMANDER,
        ];

        if ($filters['q'] !== '') {
            $sql .= "\n  AND LOWER(d.name) LIKE :deckQuery";
            $params['deckQuery'] = '%'.mb_strtolower($filters['q']).'%';
        }

        if ($filters['format'] !== '') {
            $normalizedFormat = DeckFormatCatalog::normalize($filters['format']);
            if ($normalizedFormat === null) {
                return [];
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

        $sql .= sprintf("\nORDER BY d.updated_at DESC\nLIMIT %d", self::DECKS_PAGE_LIMIT);

        return $this->stringIds(
            $this->entityManager->getConnection()->fetchFirstColumn($sql, $params),
        );
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

    private function commanderCandidateWhereSql(string $alias): string
    {
        return sprintf(
            "%1\$s.commander_legal = true AND ((LOWER(COALESCE(%1\$s.type_line, '')) LIKE '%%legendary%%' AND LOWER(COALESCE(%1\$s.type_line, '')) LIKE '%%creature%%') OR LOWER(COALESCE(%1\$s.oracle_text, '')) LIKE '%%can be your commander%%')",
            $alias,
        );
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
            'displayName' => $deck->owner()->displayName(),
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
                    'timesPlayed' => $this->stablePreviewPlayedCount($payload),
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
        return [
            'id' => (string) ($row['id'] ?? ''),
            'scryfallId' => (string) ($row['scryfall_id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'printedName' => $this->nullableString($row['printed_name'] ?? null),
            'typeLine' => $this->nullableString($row['type_line'] ?? null),
            'colors' => $this->decodeJsonArray($row['colors'] ?? []),
            'imageUris' => $this->decodeJsonArray($row['image_uris'] ?? []),
            'cardFaces' => $this->decodeJsonArray($row['card_faces'] ?? []),
        ];
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
     * @param array{q?:mixed,commander?:mixed,format?:mixed,colors?:mixed} $filters
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
