<?php

namespace App\Application\Card;

use App\Domain\Card\Card;
use App\Domain\Localization\LanguageCatalog;
use Doctrine\ORM\EntityManagerInterface;

class CardResolver
{
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

    public function resolveForDecklistEntry(array $entry): ?Card
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
