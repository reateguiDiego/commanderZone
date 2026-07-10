<?php

namespace App\Application\Deck;

use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\ORM\EntityManagerInterface;

final readonly class DeckDerivedTokenResolver
{
    public function __construct(private EntityManagerInterface $entityManager)
    {
    }

    /**
     * @return array{data:list<array<string,mixed>>,unresolved:list<array<string,mixed>>}
     */
    public function resolve(Deck $deck): array
    {
        return $this->resolveSourceRows($this->sourceRowsForDeck($deck->id()));
    }

    /**
     * @return array{data:list<array<string,mixed>>,unresolved:list<array<string,mixed>>}
     */
    public function resolveEditor(Deck $deck): array
    {
        return $this->resolveSourceRows($this->sourceRowsForDeck($deck->id()), true);
    }

    /**
     * @return array{data:list<array<string,mixed>>,unresolved:list<array<string,mixed>>}|null
     */
    public function resolveForOwnedDeck(string $deckId, string $ownerId): ?array
    {
        if (!$this->deckIsOwnedBy($deckId, $ownerId)) {
            return null;
        }

        return $this->resolveSourceRows($this->sourceRowsForDeck($deckId));
    }

    /**
     * @param list<array<string,mixed>> $sourceRows
     * @return array{data:list<array<string,mixed>>,unresolved:list<array<string,mixed>>}
     */
    private function resolveSourceRows(array $sourceRows, bool $compactTokenPayload = false): array
    {
        if ($sourceRows === []) {
            return ['data' => [], 'unresolved' => []];
        }

        $relations = $this->relationsForSources($sourceRows);
        if ($relations === []) {
            return ['data' => [], 'unresolved' => []];
        }

        $tokenCardsByScryfallId = $this->randomTokenPrintsByRelationTokenId($relations);
        $relationsBySource = $this->relationsBySource($relations);
        $data = [];
        $unresolved = [];
        $emittedSourceCards = [];

        foreach ($sourceRows as $source) {
            $sourceScryfallId = $this->nullableString($source['source_scryfall_id'] ?? null);
            if ($sourceScryfallId === null || isset($emittedSourceCards[$sourceScryfallId])) {
                continue;
            }

            $sourcePayload = [
                'scryfallId' => $sourceScryfallId,
                'name' => $this->nullableString($source['source_name'] ?? null) ?? 'Unknown card',
                'section' => $this->nullableString($source['section'] ?? null) ?? 'main',
            ];
            $resolvedCandidates = [];
            $unresolvedCandidates = [];
            $seenTokenIdentities = [];

            foreach ($this->sourceRelations($relationsBySource, $source) as $relation) {
                $tokenScryfallId = trim((string) ($relation['token_scryfall_id'] ?? ''));
                if ($tokenScryfallId === '') {
                    continue;
                }

                $token = $tokenCardsByScryfallId[$tokenScryfallId] ?? null;
                if ($token instanceof Card) {
                    $identity = $this->tokenDedupeIdentity($token, $tokenScryfallId);
                    if (isset($seenTokenIdentities[$identity])) {
                        continue;
                    }
                    $seenTokenIdentities[$identity] = true;

                    $resolvedCandidates[] = [
                        'sourceCard' => $sourcePayload,
                        'token' => $compactTokenPayload ? $this->editorTokenPayload($token) : $token->toArray(),
                        'resolved' => true,
                    ];
                    continue;
                }

                $identity = 'unresolved:'.$tokenScryfallId;
                if (isset($seenTokenIdentities[$identity])) {
                    continue;
                }
                $seenTokenIdentities[$identity] = true;

                $unresolvedCandidates[] = [
                    'sourceCard' => $sourcePayload,
                    'token' => [
                        'scryfallId' => $tokenScryfallId,
                        'name' => $this->relationTokenName($relation),
                        'uri' => $this->relationTokenUri($relation),
                    ],
                    'resolved' => false,
                ];
            }

            if ($resolvedCandidates !== []) {
                $data[] = $resolvedCandidates[random_int(0, count($resolvedCandidates) - 1)];
                $emittedSourceCards[$sourceScryfallId] = true;
                continue;
            }

            if ($unresolvedCandidates !== []) {
                $unresolved[] = $unresolvedCandidates[random_int(0, count($unresolvedCandidates) - 1)];
                $emittedSourceCards[$sourceScryfallId] = true;
            }
        }

        return ['data' => $data, 'unresolved' => $unresolved];
    }

    /**
     * @param array{data?:mixed,unresolved?:mixed} $payload
     * @return array{data:list<array<string,mixed>>,tokens:array<string,array<string,mixed>>,unresolved:list<array<string,mixed>>}
     */
    public function compactEditorPayload(array $payload): array
    {
        $data = [];
        $tokens = [];
        foreach (($payload['data'] ?? []) as $entry) {
            if (!is_array($entry) || !is_array($entry['token'] ?? null)) {
                continue;
            }

            $token = $this->compactEditorTokenArray($entry['token']);
            $tokenRef = $this->editorTokenReference($token);
            $tokens[$tokenRef] ??= $token;
            $data[] = [
                'sourceCard' => is_array($entry['sourceCard'] ?? null) ? $entry['sourceCard'] : [],
                'tokenRef' => $tokenRef,
                'resolved' => true,
            ];
        }

        return [
            'data' => $data,
            'tokens' => $tokens,
            'unresolved' => array_values(array_filter(
                is_array($payload['unresolved'] ?? null) ? $payload['unresolved'] : [],
                static fn (mixed $entry): bool => is_array($entry),
            )),
        ];
    }

    private function deckIsOwnedBy(string $deckId, string $ownerId): bool
    {
        return (bool) $this->entityManager->getConnection()->fetchOne(
            'SELECT 1 FROM deck WHERE id = :deckId AND owner_id = :ownerId',
            [
                'deckId' => $deckId,
                'ownerId' => $ownerId,
            ],
        );
    }

    public function tokenDataVersion(Deck $deck): string
    {
        $rows = $this->entityManager->getConnection()->executeQuery(
            <<<'SQL'
SELECT
    source.scryfall_id AS source_scryfall_id,
    source.updated_at AS source_updated_at,
    relation.token_scryfall_id,
    relation.updated_at AS relation_updated_at,
    token.updated_at AS token_updated_at
FROM deck_card
INNER JOIN card source ON source.id = deck_card.card_id
LEFT JOIN card_token_relation relation
    ON relation.source_scryfall_id = source.scryfall_id
    OR relation.source_oracle_id = source.oracle_id
LEFT JOIN card token ON token.scryfall_id = relation.token_scryfall_id
WHERE deck_card.deck_id = :deckId
ORDER BY source.scryfall_id ASC, relation.token_scryfall_id ASC
SQL,
            ['deckId' => $deck->id()],
        )->fetchAllAssociative();

        return hash('sha256', json_encode($rows, JSON_THROW_ON_ERROR));
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function sourceRowsForDeck(string $deckId): array
    {
        return $this->entityManager->getConnection()->executeQuery(
            <<<'SQL'
SELECT
    card.scryfall_id AS source_scryfall_id,
    card.oracle_id AS source_oracle_id,
    card.name AS source_name,
    deck_card.section
FROM deck_card
INNER JOIN card ON card.id = deck_card.card_id
WHERE deck_card.deck_id = :deckId
ORDER BY deck_card.id ASC
SQL,
            ['deckId' => $deckId],
        )->fetchAllAssociative();
    }

    /**
     * @param list<array<string,mixed>> $sourceRows
     * @return list<array<string,mixed>>
     */
    private function relationsForSources(array $sourceRows): array
    {
        $sourceScryfallIds = [];
        $sourceOracleIds = [];
        foreach ($sourceRows as $source) {
            $scryfallId = $this->nullableString($source['source_scryfall_id'] ?? null);
            if ($scryfallId !== null) {
                $sourceScryfallIds[$scryfallId] = true;
            }

            $oracleId = $this->nullableString($source['source_oracle_id'] ?? null);
            if ($oracleId !== null) {
                $sourceOracleIds[$oracleId] = true;
            }
        }

        return [
            ...$this->relationsForOracleIds(array_keys($sourceOracleIds)),
            ...$this->relationsForScryfallIds(array_keys($sourceScryfallIds)),
        ];
    }

    /**
     * @param list<string> $sourceOracleIds
     * @return list<array<string,mixed>>
     */
    private function relationsForOracleIds(array $sourceOracleIds): array
    {
        if ($sourceOracleIds === []) {
            return [];
        }

        return $this->entityManager->getConnection()->executeQuery(
            <<<'SQL'
SELECT source_scryfall_id, source_oracle_id, token_scryfall_id, token_name, token_uri
FROM card_token_relation
WHERE source_oracle_id IN (:sourceOracleIds)
ORDER BY token_name ASC, token_scryfall_id ASC
SQL,
            ['sourceOracleIds' => $sourceOracleIds],
            ['sourceOracleIds' => ArrayParameterType::STRING],
        )->fetchAllAssociative();
    }

    /**
     * @param list<string> $sourceScryfallIds
     * @return list<array<string,mixed>>
     */
    private function relationsForScryfallIds(array $sourceScryfallIds): array
    {
        if ($sourceScryfallIds !== []) {
            return $this->entityManager->getConnection()->executeQuery(
                <<<'SQL'
SELECT source_scryfall_id, source_oracle_id, token_scryfall_id, token_name, token_uri
FROM card_token_relation
WHERE source_scryfall_id IN (:sourceScryfallIds)
ORDER BY token_name ASC, token_scryfall_id ASC
SQL,
                ['sourceScryfallIds' => $sourceScryfallIds],
                ['sourceScryfallIds' => ArrayParameterType::STRING],
            )->fetchAllAssociative();
        }

        return [];
    }

    /**
     * @param list<array<string,mixed>> $relations
     * @return array{oracle:array<string,list<array<string,mixed>>>,scryfall:array<string,list<array<string,mixed>>>}
     */
    private function relationsBySource(array $relations): array
    {
        $byOracleId = [];
        $byScryfallId = [];
        foreach ($relations as $relation) {
            $sourceOracleId = $this->nullableString($relation['source_oracle_id'] ?? null);
            if ($sourceOracleId !== null) {
                $byOracleId[$sourceOracleId][] = $relation;
            }

            $sourceScryfallId = $this->nullableString($relation['source_scryfall_id'] ?? null);
            if ($sourceScryfallId !== null) {
                $byScryfallId[$sourceScryfallId][] = $relation;
            }
        }

        return ['oracle' => $byOracleId, 'scryfall' => $byScryfallId];
    }

    /**
     * @param array{oracle:array<string,list<array<string,mixed>>>,scryfall:array<string,list<array<string,mixed>>>} $relationsBySource
     * @param array<string,mixed> $source
     * @return list<array<string,mixed>>
     */
    private function sourceRelations(array $relationsBySource, array $source): array
    {
        $relations = [];
        $sourceOracleId = $this->nullableString($source['source_oracle_id'] ?? null);
        if ($sourceOracleId !== null) {
            $relations = $relationsBySource['oracle'][$sourceOracleId] ?? [];
        }

        $sourceScryfallId = $this->nullableString($source['source_scryfall_id'] ?? null);
        if ($sourceScryfallId === null) {
            return $relations;
        }

        return [
            ...$relations,
            ...($relationsBySource['scryfall'][$sourceScryfallId] ?? []),
        ];
    }

    /**
     * @param list<array<string,mixed>> $relations
     * @return array<string,Card>
     */
    private function randomTokenPrintsByRelationTokenId(array $relations): array
    {
        $tokenScryfallIds = array_values(array_unique(array_filter(
            array_map(
                static fn (array $relation): string => trim((string) ($relation['token_scryfall_id'] ?? '')),
                $relations,
            ),
            static fn (string $scryfallId): bool => $scryfallId !== '',
        )));
        if ($tokenScryfallIds === []) {
            return [];
        }

        $sourceTokens = $this->entityManager->getRepository(Card::class)
            ->createQueryBuilder('card')
            ->andWhere('card.scryfallId IN (:ids)')
            ->setParameter('ids', $tokenScryfallIds)
            ->getQuery()
            ->getResult();

        $sourceTokensByScryfallId = [];
        $tokenOracleIds = [];
        foreach ($sourceTokens as $token) {
            if ($token instanceof Card) {
                $sourceTokensByScryfallId[$token->scryfallId()] = $token;
                $oracleId = $token->oracleId();
                if ($oracleId !== null) {
                    $tokenOracleIds[$oracleId] = true;
                }
            }
        }

        $randomPrintsByOracleId = $this->randomTokenPrintsByOracleId(array_keys($tokenOracleIds));
        $tokensByRelationTokenId = [];
        foreach ($sourceTokensByScryfallId as $tokenScryfallId => $sourceToken) {
            $oracleId = $sourceToken->oracleId();
            $randomPrint = $oracleId !== null ? ($randomPrintsByOracleId[$oracleId] ?? null) : null;
            $token = $randomPrint instanceof Card ? $randomPrint : $sourceToken;
            if ($this->hasUsableTokenImage($token)) {
                $tokensByRelationTokenId[$tokenScryfallId] = $token;
            }
        }

        return $tokensByRelationTokenId;
    }

    /**
     * @param list<string> $tokenOracleIds
     * @return array<string,Card>
     */
    private function randomTokenPrintsByOracleId(array $tokenOracleIds): array
    {
        if ($tokenOracleIds === []) {
            return [];
        }

        $tokens = $this->entityManager->getRepository(Card::class)
            ->createQueryBuilder('card')
            ->andWhere('card.oracleId IN (:oracleIds)')
            ->setParameter('oracleIds', $tokenOracleIds)
            ->orderBy('card.oracleId', 'ASC')
            ->addOrderBy('card.scryfallId', 'ASC')
            ->getQuery()
            ->getResult();

        $candidatesByOracleId = [];
        foreach ($tokens as $token) {
            if (!$token instanceof Card || !$this->hasUsableTokenImage($token)) {
                continue;
            }

            $oracleId = $token->oracleId();
            if ($oracleId !== null) {
                $candidatesByOracleId[$oracleId][] = $token;
            }
        }

        $selectedByOracleId = [];
        foreach ($candidatesByOracleId as $oracleId => $candidates) {
            $selectedByOracleId[$oracleId] = $candidates[random_int(0, count($candidates) - 1)];
        }

        return $selectedByOracleId;
    }

    private function tokenDedupeIdentity(Card $token, string $fallbackScryfallId): string
    {
        $oracleId = $token->oracleId();
        if ($oracleId !== null) {
            return 'oracle:'.$oracleId;
        }

        return 'scryfall:'.$fallbackScryfallId;
    }

    private function hasUsableTokenImage(Card $token): bool
    {
        foreach (['normal', 'large', 'png', 'small'] as $format) {
            if ($token->imageUri($format) !== null) {
                return true;
            }
        }

        foreach ($token->cardFaces() as $face) {
            $imageUris = $face['imageUris'] ?? null;
            if (is_array($imageUris) && $imageUris !== []) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array<string,mixed>
     */
    private function editorTokenPayload(Card $token): array
    {
        return [
            'id' => $token->id(),
            'scryfallId' => $token->scryfallId(),
            'name' => $token->printedName() ?: $token->name(),
            'manaCost' => $token->manaCost(),
            'typeLine' => $token->typeLine(),
            'oracleText' => null,
            'power' => $token->power(),
            'toughness' => $token->toughness(),
            'loyalty' => $token->loyalty(),
            'colors' => [],
            'colorIdentity' => $token->colorIdentity(),
            'legalities' => [],
            'imageUris' => $token->imageUris(),
            'cardFaces' => $this->compactEditorCardFaces($token->cardFaces()),
            'layout' => $token->layout(),
            'commanderLegal' => false,
            'set' => $token->setCode(),
            'collectorNumber' => $token->collectorNumber(),
            'lang' => $token->lang(),
            'printedName' => $token->printedName(),
            'flavorName' => $token->flavorName(),
        ];
    }

    /**
     * @param array<string,mixed> $token
     * @return array<string,mixed>
     */
    private function compactEditorTokenArray(array $token): array
    {
        return [
            'id' => $this->nullableString($token['id'] ?? null) ?? $this->nullableString($token['scryfallId'] ?? null) ?? 'token',
            'scryfallId' => $this->nullableString($token['scryfallId'] ?? null) ?? '',
            'name' => $this->nullableString($token['name'] ?? null) ?? 'Token',
            'manaCost' => $this->nullableString($token['manaCost'] ?? null),
            'typeLine' => $this->nullableString($token['typeLine'] ?? null),
            'oracleText' => null,
            'power' => $this->nullableString($token['power'] ?? null),
            'toughness' => $this->nullableString($token['toughness'] ?? null),
            'loyalty' => $this->nullableString($token['loyalty'] ?? null),
            'colors' => [],
            'colorIdentity' => array_values(array_filter(
                is_array($token['colorIdentity'] ?? null) ? $token['colorIdentity'] : [],
                static fn (mixed $value): bool => is_scalar($value),
            )),
            'legalities' => [],
            'imageUris' => is_array($token['imageUris'] ?? null) ? $token['imageUris'] : [],
            'cardFaces' => $this->compactEditorCardFaces(is_array($token['cardFaces'] ?? null) ? $token['cardFaces'] : []),
            'layout' => $this->nullableString($token['layout'] ?? null) ?? 'token',
            'commanderLegal' => false,
            'set' => $this->nullableString($token['set'] ?? null),
            'collectorNumber' => $this->nullableString($token['collectorNumber'] ?? null),
            'lang' => $this->nullableString($token['lang'] ?? null),
            'printedName' => $this->nullableString($token['printedName'] ?? null),
            'flavorName' => $this->nullableString($token['flavorName'] ?? null),
        ];
    }

    /**
     * @param array<string,mixed> $token
     */
    private function editorTokenReference(array $token): string
    {
        $scryfallId = $this->nullableString($token['scryfallId'] ?? null);
        if ($scryfallId !== null) {
            return 'scryfall:'.$scryfallId;
        }

        return 'token:'.hash('sha256', json_encode([
            'name' => $token['name'] ?? null,
            'typeLine' => $token['typeLine'] ?? null,
            'manaCost' => $token['manaCost'] ?? null,
            'power' => $token['power'] ?? null,
            'toughness' => $token['toughness'] ?? null,
            'loyalty' => $token['loyalty'] ?? null,
        ], JSON_THROW_ON_ERROR));
    }

    /**
     * @param list<array<string,mixed>> $faces
     * @return list<array<string,mixed>>
     */
    private function compactEditorCardFaces(array $faces): array
    {
        $compact = [];
        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $compact[] = [
                'name' => $this->nullableString($face['name'] ?? null),
                'manaCost' => $this->nullableString($face['manaCost'] ?? null),
                'typeLine' => $this->nullableString($face['typeLine'] ?? null),
                'oracleText' => null,
                'power' => $this->nullableString($face['power'] ?? null),
                'toughness' => $this->nullableString($face['toughness'] ?? null),
                'loyalty' => $this->nullableString($face['loyalty'] ?? null),
                'colors' => [],
                'imageUris' => is_array($face['imageUris'] ?? null) ? $face['imageUris'] : [],
            ];
        }

        return $compact;
    }

    /**
     * @param array<string,mixed> $relation
     */
    private function relationTokenName(array $relation): string
    {
        return $this->nullableString($relation['token_name'] ?? null) ?? 'Unknown token';
    }

    /**
     * @param array<string,mixed> $relation
     */
    private function relationTokenUri(array $relation): ?string
    {
        return $this->nullableString($relation['token_uri'] ?? null);
    }

    private function nullableString(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $value = trim((string) $value);

        return $value !== '' ? $value : null;
    }
}
