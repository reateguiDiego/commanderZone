<?php

namespace App\Application\Card;

use App\Domain\Card\Card;
use App\Domain\Localization\LanguageCatalog;
use Doctrine\ORM\EntityManagerInterface;

class CardResolver
{
    private ?bool $printLocaleTablesAvailableCache = null;

    /** @var array<string, list<Card>> */
    private array $cardsBySetAndCollectorNumberCache = [];

    /** @var array<string, list<Card>> */
    private array $decklistNameCandidatesCache = [];

    public function __construct(private readonly EntityManagerInterface $entityManager)
    {
    }

    /**
     * @return list<Card>
     */
    public function resolveCandidates(array $criteria, ?string $preferredLanguage = null): array
    {
        $preferredLanguage = LanguageCatalog::normalize($preferredLanguage);
        $scryfallId = trim((string) ($criteria['scryfallId'] ?? ''));
        if ($scryfallId !== '') {
            $card = $this->entityManager->getRepository(Card::class)->findOneBy(['scryfallId' => $scryfallId]);

            return $card instanceof Card ? [$card] : [];
        }

        $setCode = mb_strtolower(trim((string) ($criteria['setCode'] ?? '')));
        $collectorNumber = trim((string) ($criteria['collectorNumber'] ?? ''));
        if ($setCode !== '' && $collectorNumber !== '') {
            $matches = $this->entityManager->getRepository(Card::class)->findBy([
                'setCode' => $setCode,
                'collectorNumber' => $collectorNumber,
            ]);

            $resolvedMatches = array_values(array_filter($matches, static fn (mixed $card) => $card instanceof Card));
            $preferred = $this->preferredPrint($resolvedMatches, $preferredLanguage);
            if ($preferred instanceof Card) {
                return [$preferred];
            }

            return $resolvedMatches;
        }

        $name = trim((string) ($criteria['name'] ?? ''));
        if ($name !== '') {
            $matches = $this->entityManager->getRepository(Card::class)->findBy([
                'normalizedName' => Card::normalizeName($name),
            ]);

            $resolvedMatches = array_values(array_filter($matches, static fn (mixed $card) => $card instanceof Card));
            if ($resolvedMatches !== []) {
                return $resolvedMatches;
            }

            $localizedMatches = $this->entityManager->getRepository(Card::class)
                ->createQueryBuilder('card')
                ->andWhere('LOWER(card.printedName) = :printedName')
                ->setParameter('printedName', Card::normalizeName($name))
                ->orderBy('card.commanderLegal', 'DESC')
                ->addOrderBy('card.normalizedName', 'ASC')
                ->addOrderBy('card.setCode', 'ASC')
                ->addOrderBy('card.collectorNumber', 'ASC')
                ->getQuery()
                ->getResult();

            $resolvedLocalizedMatches = array_values(array_filter($localizedMatches, static fn (mixed $card) => $card instanceof Card));
            if ($resolvedLocalizedMatches !== []) {
                return $resolvedLocalizedMatches;
            }

            $card = $this->resolveDecklistName($name);

            return $card instanceof Card ? [$card] : [];
        }

        $flavorName = trim((string) ($criteria['flavorName'] ?? ''));
        if ($flavorName !== '' && $setCode !== '' && $collectorNumber !== '') {
            $matches = $this->entityManager->getRepository(Card::class)->findBy([
                'setCode' => $setCode,
                'collectorNumber' => $collectorNumber,
            ]);

            $resolvedMatches = array_values(array_filter($matches, static fn (mixed $card) => $card instanceof Card));
            $preferred = $this->preferredPrint($resolvedMatches, $preferredLanguage);
            if ($preferred instanceof Card) {
                return [$preferred];
            }

            return $resolvedMatches;
        }

        return [];
    }

    public function resolveOne(array $criteria, ?string $preferredLanguage = null): ?Card
    {
        return $this->resolveCandidates($criteria, $preferredLanguage)[0] ?? null;
    }

    /**
     * @return array{card:?Card,error:?string,matches:list<Card>}
     */
    public function resolveUnique(array $criteria, ?string $preferredLanguage = null): array
    {
        $matches = $this->resolveCandidates($criteria, $preferredLanguage);
        if ($matches === []) {
            return ['card' => null, 'error' => 'not_found', 'matches' => []];
        }

        if (count($matches) > 1) {
            return ['card' => null, 'error' => 'ambiguous', 'matches' => $matches];
        }

        return ['card' => $matches[0], 'error' => null, 'matches' => $matches];
    }

    public function resolveForDecklistEntry(array $entry, ?string $preferredLanguage = null): ?Card
    {
        $preferredLanguage = LanguageCatalog::normalize($preferredLanguage);
        if (!LanguageCatalog::isSupported($preferredLanguage)) {
            return $this->resolveForDecklistEntryLegacy($entry);
        }

        $setCode = mb_strtolower(trim((string) ($entry['setCode'] ?? '')));
        $collectorNumber = trim((string) ($entry['collectorNumber'] ?? ''));
        if ($setCode !== '' && $collectorNumber !== '') {
            $card = $this->pickRandomDecklistImportPrint(
                $this->findCardsBySetAndCollectorNumber($setCode, $collectorNumber),
                $preferredLanguage,
            );
            if ($card instanceof Card) {
                return $card;
            }
        }

        return $this->pickRandomDecklistImportPrint(
            $this->resolveDecklistNameCandidates((string) ($entry['name'] ?? ''), $preferredLanguage),
            $preferredLanguage,
        );
    }

    /**
     * @param list<Card> $matches
     */
    private function preferredPrint(array $matches, ?string $preferredLanguage): ?Card
    {
        if ($matches === []) {
            return null;
        }

        if (!LanguageCatalog::isSupported($preferredLanguage) || $preferredLanguage === null) {
            return null;
        }

        foreach ($matches as $match) {
            if ($match->lang() === $preferredLanguage) {
                return $match;
            }
        }

        if ($preferredLanguage !== LanguageCatalog::DEFAULT_LANGUAGE) {
            foreach ($matches as $match) {
                if ($match->lang() === LanguageCatalog::DEFAULT_LANGUAGE) {
                    return $match;
                }
            }
        }

        return $matches[0] ?? null;
    }

    private function resolveForDecklistEntryLegacy(array $entry): ?Card
    {
        if (($entry['setCode'] ?? null) !== null && ($entry['collectorNumber'] ?? null) !== null) {
            $card = $this->resolveOne([
                'setCode' => $entry['setCode'],
                'collectorNumber' => $entry['collectorNumber'],
                'flavorName' => $entry['name'] ?? null,
            ]);
            if ($card instanceof Card) {
                return $card;
            }
        }

        return $this->resolveDecklistName((string) ($entry['name'] ?? ''));
    }

    /**
     * @return list<Card>
     */
    private function findCardsBySetAndCollectorNumber(string $setCode, string $collectorNumber): array
    {
        $cacheKey = $setCode.'|'.$collectorNumber;
        if (array_key_exists($cacheKey, $this->cardsBySetAndCollectorNumberCache)) {
            return $this->cardsBySetAndCollectorNumberCache[$cacheKey];
        }

        $matches = $this->entityManager->getRepository(Card::class)->findBy([
            'setCode' => $setCode,
            'collectorNumber' => $collectorNumber,
        ]);

        return $this->cardsBySetAndCollectorNumberCache[$cacheKey] = array_values(array_filter(
            $matches,
            static fn (mixed $card) => $card instanceof Card,
        ));
    }

    /**
     * @return list<Card>
     */
    private function resolveDecklistNameCandidates(string $name, ?string $preferredLanguage = null): array
    {
        $normalizedName = Card::normalizeName($name);
        if ($normalizedName === '') {
            return [];
        }

        $cacheKey = ($preferredLanguage ?? '-').'|'.$normalizedName;
        if (array_key_exists($cacheKey, $this->decklistNameCandidatesCache)) {
            return $this->decklistNameCandidatesCache[$cacheKey];
        }

        $repository = $this->entityManager->getRepository(Card::class);
        $exactMatches = array_values(array_filter(
            $repository->findBy(['normalizedName' => $normalizedName]),
            static fn (mixed $card) => $card instanceof Card,
        ));
        if ($exactMatches !== []) {
            return $this->decklistNameCandidatesCache[$cacheKey] = $exactMatches;
        }

        if (LanguageCatalog::isSupported($preferredLanguage)) {
            $localizedPrintTableMatches = $this->resolveLocalizedPrintTableDecklistCandidates($normalizedName, $preferredLanguage);
            if ($localizedPrintTableMatches !== []) {
                return $this->decklistNameCandidatesCache[$cacheKey] = $localizedPrintTableMatches;
            }
        }

        $localizedMatches = array_values(array_filter(
            $repository->createQueryBuilder('card')
                ->andWhere('LOWER(card.printedName) = :printedName')
                ->setParameter('printedName', $normalizedName)
                ->orderBy('card.commanderLegal', 'DESC')
                ->addOrderBy('card.normalizedName', 'ASC')
                ->addOrderBy('card.setCode', 'ASC')
                ->addOrderBy('card.collectorNumber', 'ASC')
                ->getQuery()
                ->getResult(),
            static fn (mixed $card) => $card instanceof Card,
        ));
        if ($localizedMatches !== []) {
            return $this->decklistNameCandidatesCache[$cacheKey] = $localizedMatches;
        }

        if (!LanguageCatalog::isSupported($preferredLanguage)) {
            $localizedPrintTableMatches = $this->resolveLocalizedPrintTableDecklistCandidates($normalizedName, $preferredLanguage);
            if ($localizedPrintTableMatches !== []) {
                return $this->decklistNameCandidatesCache[$cacheKey] = $localizedPrintTableMatches;
            }
        }

        $doubleFacedMatches = array_values(array_filter(
            $repository->createQueryBuilder('card')
                ->andWhere('card.normalizedName LIKE :frontFace OR card.normalizedName LIKE :backFace')
                ->setParameter('frontFace', $normalizedName.' // %')
                ->setParameter('backFace', '% // '.$normalizedName)
                ->orderBy('card.commanderLegal', 'DESC')
                ->addOrderBy('card.normalizedName', 'ASC')
                ->addOrderBy('card.setCode', 'ASC')
                ->addOrderBy('card.collectorNumber', 'ASC')
                ->getQuery()
                ->getResult(),
            static fn (mixed $card) => $card instanceof Card,
        ));
        $flavorMatches = array_values(array_filter(
            $repository->createQueryBuilder('card')
                ->andWhere('LOWER(card.flavorName) = :flavorName')
                ->setParameter('flavorName', $normalizedName)
                ->orderBy('card.commanderLegal', 'DESC')
                ->addOrderBy('card.normalizedName', 'ASC')
                ->addOrderBy('card.setCode', 'ASC')
                ->addOrderBy('card.collectorNumber', 'ASC')
                ->getQuery()
                ->getResult(),
            static fn (mixed $card) => $card instanceof Card,
        ));

        return $this->decklistNameCandidatesCache[$cacheKey] = $this->uniqueCardsByScryfallId([
            ...$doubleFacedMatches,
            ...$flavorMatches,
        ]);
    }

    /**
     * @return list<Card>
     */
    private function resolveLocalizedPrintTableDecklistCandidates(string $normalizedName, ?string $preferredLanguage = null): array
    {
        if (!$this->printLocaleTablesAvailable()) {
            return [];
        }

        $params = ['query' => $normalizedName];
        $sql = <<<'SQL'
SELECT DISTINCT c.scryfall_id
FROM card c
INNER JOIN card_print_locale locale ON locale.print_scryfall_id = c.scryfall_id
WHERE LOWER(COALESCE(locale.name, '')) = :query
   OR LOWER(COALESCE(locale.printed_name, '')) = :query
SQL;
        if (LanguageCatalog::isSupported($preferredLanguage)) {
            $sql = <<<'SQL'
SELECT DISTINCT c.scryfall_id
FROM card c
INNER JOIN card_print_locale locale ON locale.print_scryfall_id = c.scryfall_id
WHERE locale.lang = :preferredLanguage
  AND (
      LOWER(COALESCE(locale.name, '')) = :query
      OR LOWER(COALESCE(locale.printed_name, '')) = :query
  )
SQL;
            $params['preferredLanguage'] = $preferredLanguage;
        }

        $ids = $this->entityManager->getConnection()->fetchFirstColumn($sql, $params);

        if ($ids === []) {
            return [];
        }

        $matches = $this->entityManager->getRepository(Card::class)
            ->createQueryBuilder('card')
            ->andWhere('card.scryfallId IN (:ids)')
            ->setParameter('ids', $ids)
            ->orderBy('card.commanderLegal', 'DESC')
            ->addOrderBy('card.normalizedName', 'ASC')
            ->addOrderBy('card.setCode', 'ASC')
            ->addOrderBy('card.collectorNumber', 'ASC')
            ->getQuery()
            ->getResult();

        return array_values(array_filter($matches, static fn (mixed $card) => $card instanceof Card));
    }

    /**
     * @param list<Card> $matches
     */
    private function pickRandomDecklistImportPrint(array $matches, string $preferredLanguage): ?Card
    {
        $preferredMatches = $this->cardsInLanguage($matches, $preferredLanguage);
        if ($preferredMatches !== []) {
            return $this->randomCard($preferredMatches);
        }

        $englishMatches = $this->cardsInLanguage($matches, LanguageCatalog::DEFAULT_LANGUAGE);
        if ($englishMatches !== []) {
            return $this->randomCard($englishMatches);
        }

        return null;
    }

    /**
     * @param list<Card> $matches
     * @return list<Card>
     */
    private function cardsInLanguage(array $matches, string $language): array
    {
        return array_values(array_filter(
            $matches,
            static function (Card $card) use ($language): bool {
                $cardLanguage = LanguageCatalog::normalize($card->lang()) ?? LanguageCatalog::DEFAULT_LANGUAGE;

                return $cardLanguage === $language;
            },
        ));
    }

    /**
     * @param list<Card> $matches
     */
    private function randomCard(array $matches): ?Card
    {
        if ($matches === []) {
            return null;
        }

        return $matches[array_rand($matches)] ?? null;
    }

    /**
     * @param list<Card> $matches
     * @return list<Card>
     */
    private function uniqueCardsByScryfallId(array $matches): array
    {
        $unique = [];
        foreach ($matches as $match) {
            $unique[$match->scryfallId()] = $match;
        }

        return array_values($unique);
    }

    private function printLocaleTablesAvailable(): bool
    {
        if ($this->printLocaleTablesAvailableCache !== null) {
            return $this->printLocaleTablesAvailableCache;
        }

        try {
            $connection = $this->entityManager->getConnection();
            $cardPrint = $connection->fetchOne("SELECT to_regclass('public.card_print')");
            $cardPrintLocale = $connection->fetchOne("SELECT to_regclass('public.card_print_locale')");

            return $this->printLocaleTablesAvailableCache = is_string($cardPrint)
                && $cardPrint !== ''
                && is_string($cardPrintLocale)
                && $cardPrintLocale !== '';
        } catch (\Throwable) {
            return $this->printLocaleTablesAvailableCache = false;
        }
    }

    private function resolveDecklistName(string $name): ?Card
    {
        $normalizedName = Card::normalizeName($name);
        if ($normalizedName === '') {
            return null;
        }

        $repository = $this->entityManager->getRepository(Card::class);
        $exact = $repository->findOneBy(['normalizedName' => $normalizedName]);
        if ($exact instanceof Card) {
            return $exact;
        }

        $matches = $repository->createQueryBuilder('card')
            ->andWhere('card.normalizedName LIKE :frontFace OR card.normalizedName LIKE :backFace')
            ->setParameter('frontFace', $normalizedName.' // %')
            ->setParameter('backFace', '% // '.$normalizedName)
            ->orderBy('card.commanderLegal', 'DESC')
            ->addOrderBy('card.normalizedName', 'ASC')
            ->setMaxResults(1)
            ->getQuery()
            ->getResult();

        $match = $matches[0] ?? null;
        if ($match instanceof Card) {
            return $match;
        }

        $flavorMatches = $repository->createQueryBuilder('card')
            ->andWhere('LOWER(card.flavorName) = :flavorName')
            ->setParameter('flavorName', $normalizedName)
            ->orderBy('card.commanderLegal', 'DESC')
            ->addOrderBy('card.normalizedName', 'ASC')
            ->setMaxResults(1)
            ->getQuery()
            ->getResult();

        $flavorMatch = $flavorMatches[0] ?? null;

        return $flavorMatch instanceof Card ? $flavorMatch : null;
    }
}
