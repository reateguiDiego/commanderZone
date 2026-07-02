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
    private function resolveSourceRows(array $sourceRows): array
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
                        'token' => $token->toArray(),
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
