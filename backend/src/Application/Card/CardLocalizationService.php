<?php

namespace App\Application\Card;

use App\Domain\Card\Card;
use App\Domain\Localization\LanguageCatalog;
use Doctrine\ORM\EntityManagerInterface;

class CardLocalizationService
{
    /**
     * @var array<string,Card>
     */
    private array $cardsByScryfallId = [];

    /**
     * @var array<string,Card>
     */
    private array $localizedBySourceAndLanguage = [];

    public function __construct(private readonly EntityManagerInterface $entityManager)
    {
    }

    /**
     * @param list<string> $scryfallIds
     */
    public function primeForLanguage(array $scryfallIds, ?string $requestedLanguage): void
    {
        $requestedLanguage = LanguageCatalog::normalize($requestedLanguage);
        if (!LanguageCatalog::isSupported($requestedLanguage) || $requestedLanguage === null) {
            return;
        }

        $missingIds = [];
        foreach ($scryfallIds as $scryfallId) {
            if (!isset($this->cardsByScryfallId[$scryfallId])) {
                $missingIds[] = $scryfallId;
            }
        }

        if ($missingIds !== []) {
            $cards = $this->entityManager->getRepository(Card::class)
                ->createQueryBuilder('card')
                ->andWhere('card.scryfallId IN (:ids)')
                ->setParameter('ids', array_values(array_unique($missingIds)))
                ->getQuery()
                ->getResult();
            foreach ($cards as $card) {
                if ($card instanceof Card) {
                    $this->cardsByScryfallId[$card->scryfallId()] = $card;
                }
            }
        }

        $sources = [];
        foreach (array_values(array_unique($scryfallIds)) as $scryfallId) {
            $source = $this->cardsByScryfallId[$scryfallId] ?? null;
            if (!$source instanceof Card) {
                continue;
            }

            $cacheKey = $this->cacheKey($source->scryfallId(), $requestedLanguage);
            if (isset($this->localizedBySourceAndLanguage[$cacheKey])) {
                continue;
            }

            $sources[] = $source;
        }

        if ($sources === []) {
            return;
        }

        $normalizedNames = array_values(array_unique(array_filter(
            array_map(static fn (Card $card): string => $card->normalizedName(), $sources),
            static fn (string $name): bool => $name !== '',
        )));
        if ($normalizedNames === []) {
            foreach ($sources as $source) {
                $cacheKey = $this->cacheKey($source->scryfallId(), $requestedLanguage);
                $this->localizedBySourceAndLanguage[$cacheKey] = $source;
            }

            return;
        }

        $lookupLanguages = array_values(array_unique([$requestedLanguage, LanguageCatalog::DEFAULT_LANGUAGE]));
        $candidates = $this->entityManager->getRepository(Card::class)
            ->createQueryBuilder('card')
            ->andWhere('card.normalizedName IN (:names)')
            ->andWhere('card.lang IN (:languages)')
            ->setParameter('names', $normalizedNames)
            ->setParameter('languages', $lookupLanguages)
            ->orderBy('card.normalizedName', 'ASC')
            ->addOrderBy('card.setCode', 'ASC')
            ->addOrderBy('card.collectorNumber', 'ASC')
            ->getQuery()
            ->getResult();

        $candidatesByName = [];
        foreach ($candidates as $candidate) {
            if (!$candidate instanceof Card) {
                continue;
            }

            $candidatesByName[$candidate->normalizedName()] ??= [];
            $candidatesByName[$candidate->normalizedName()][] = $candidate;
        }

        foreach ($sources as $source) {
            $sourceCandidates = $candidatesByName[$source->normalizedName()] ?? [];
            $localized = $this->preferredLocalizedCandidate($source, $sourceCandidates, $requestedLanguage)
                ?? $source;
            $cacheKey = $this->cacheKey($source->scryfallId(), $requestedLanguage);
            $this->localizedBySourceAndLanguage[$cacheKey] = $localized;
        }
    }

    public function localizeCard(Card $card, ?string $requestedLanguage): Card
    {
        $requestedLanguage = LanguageCatalog::normalize($requestedLanguage);
        if (!LanguageCatalog::isSupported($requestedLanguage) || $requestedLanguage === null) {
            return $card;
        }

        $cacheKey = $this->cacheKey($card->scryfallId(), $requestedLanguage);
        if (!isset($this->localizedBySourceAndLanguage[$cacheKey])) {
            $this->primeForLanguage([$card->scryfallId()], $requestedLanguage);
        }

        return $this->localizedBySourceAndLanguage[$cacheKey] ?? $card;
    }

    /**
     * @param list<Card> $cards
     *
     * @return list<Card>
     */
    public function localizeCards(array $cards, ?string $requestedLanguage): array
    {
        $requestedLanguage = LanguageCatalog::normalize($requestedLanguage);
        if (!LanguageCatalog::isSupported($requestedLanguage) || $requestedLanguage === null) {
            return $cards;
        }

        $this->primeForLanguage(
            array_values(array_map(static fn (Card $card): string => $card->scryfallId(), $cards)),
            $requestedLanguage,
        );

        return array_map(fn (Card $card): Card => $this->localizeCard($card, $requestedLanguage), $cards);
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array<string,mixed>
     */
    public function localizeCardPayload(array $card, ?string $requestedLanguage, bool $preserveIdentity = false): array
    {
        $requestedLanguage = LanguageCatalog::normalize($requestedLanguage);
        if (!LanguageCatalog::isSupported($requestedLanguage) || $requestedLanguage === null) {
            return $card;
        }

        $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
        if ($scryfallId === '') {
            return $card;
        }

        $source = $this->cardsByScryfallId[$scryfallId] ?? null;
        if (!$source instanceof Card) {
            $this->primeForLanguage([$scryfallId], $requestedLanguage);
            $source = $this->cardsByScryfallId[$scryfallId] ?? null;
            if (!$source instanceof Card) {
                return $card;
            }
        }

        $localized = $this->localizeCard($source, $requestedLanguage);
        $localizedPayload = $localized->toArray();

        if (!$preserveIdentity) {
            return $localizedPayload;
        }

        $card['name'] = $this->localizedName($localized);
        $card['imageUris'] = $localizedPayload['imageUris'] ?? [];
        $card['cardFaces'] = $localizedPayload['cardFaces'] ?? [];
        $card['typeLine'] = $localizedPayload['typeLine'] ?? null;
        $card['manaCost'] = $localizedPayload['manaCost'] ?? null;
        $card['oracleText'] = $localizedPayload['oracleText'] ?? null;
        $card['lang'] = $localized->lang();
        $card['printedName'] = $localized->printedName();

        return $card;
    }

    /**
     * @param list<array<string,mixed>> $cards
     *
     * @return list<array<string,mixed>>
     */
    public function localizeCardPayloads(array $cards, ?string $requestedLanguage, bool $preserveIdentity = false): array
    {
        $requestedLanguage = LanguageCatalog::normalize($requestedLanguage);
        if (!LanguageCatalog::isSupported($requestedLanguage) || $requestedLanguage === null) {
            return $cards;
        }

        $scryfallIds = [];
        foreach ($cards as $card) {
            $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
            if ($scryfallId !== '') {
                $scryfallIds[] = $scryfallId;
            }
        }
        if ($scryfallIds !== []) {
            $this->primeForLanguage(array_values(array_unique($scryfallIds)), $requestedLanguage);
        }

        return array_values(array_map(
            fn (array $card): array => $this->localizeCardPayload($card, $requestedLanguage, $preserveIdentity),
            $cards,
        ));
    }

    /**
     * @param list<Card> $candidates
     */
    private function preferredLocalizedCandidate(Card $source, array $candidates, string $requestedLanguage): ?Card
    {
        $exactRequested = $this->matchLocalizedCandidate($source, $candidates, $requestedLanguage);
        if ($exactRequested instanceof Card) {
            return $exactRequested;
        }

        if ($requestedLanguage !== LanguageCatalog::DEFAULT_LANGUAGE) {
            $english = $this->matchLocalizedCandidate($source, $candidates, LanguageCatalog::DEFAULT_LANGUAGE);
            if ($english instanceof Card) {
                return $english;
            }
        }

        return null;
    }

    /**
     * @param list<Card> $candidates
     */
    private function matchLocalizedCandidate(Card $source, array $candidates, string $language): ?Card
    {
        $sourceSetCode = $source->setCode();
        $sourceCollectorNumber = $source->collectorNumber();

        foreach ($candidates as $candidate) {
            if ($candidate->lang() !== $language) {
                continue;
            }

            if (
                $sourceSetCode !== null
                && $sourceCollectorNumber !== null
                && $candidate->setCode() === $sourceSetCode
                && $candidate->collectorNumber() === $sourceCollectorNumber
            ) {
                return $candidate;
            }
        }

        if ($sourceSetCode !== null && $sourceCollectorNumber !== null) {
            return null;
        }

        foreach ($candidates as $candidate) {
            if ($candidate->lang() === $language) {
                return $candidate;
            }
        }

        return null;
    }

    private function cacheKey(string $scryfallId, string $language): string
    {
        return sprintf('%s|%s', $scryfallId, $language);
    }

    private function localizedName(Card $card): string
    {
        $printedName = trim((string) ($card->printedName() ?? ''));

        return $printedName !== '' ? $printedName : $card->name();
    }
}
