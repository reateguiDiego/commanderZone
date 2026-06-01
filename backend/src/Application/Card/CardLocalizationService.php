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
    private ?CardLocalizedPayloadResolver $localizedPayloadResolver;

    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        ?CardLocalizedPayloadResolver $localizedPayloadResolver = null,
    )
    {
        $this->localizedPayloadResolver = $localizedPayloadResolver;
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
        return $this->localizeCardPayloads([$card], $requestedLanguage, $preserveIdentity)[0] ?? $card;
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
            $scryfallIds = array_values(array_unique($scryfallIds));
        }

        if ($scryfallIds === []) {
            return $cards;
        }

        $lookup = $this->payloadResolver()->buildLocalizedLookupForScryfallIds($scryfallIds, [$requestedLanguage]);
        $localizedBySource = $lookup[$requestedLanguage] ?? [];
        if ($localizedBySource === []) {
            return $cards;
        }

        $localizedCardsByScryfallId = [];
        if (!$preserveIdentity) {
            $localizedIds = array_values(array_unique(array_filter(
                array_map(
                    static fn (array $payload): string => trim((string) ($payload['scryfallId'] ?? '')),
                    $localizedBySource,
                ),
                static fn (string $id): bool => $id !== '',
            )));
            $localizedCardsByScryfallId = $this->cardsByScryfallIds($localizedIds);
        }

        return array_values(array_map(function (array $card) use ($preserveIdentity, $localizedBySource, $localizedCardsByScryfallId): array {
            $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
            $localizedPayload = $localizedBySource[$scryfallId] ?? null;
            if (!is_array($localizedPayload)) {
                return $card;
            }

            if (!$preserveIdentity) {
                $localizedId = trim((string) ($localizedPayload['scryfallId'] ?? ''));
                $localizedCard = $localizedCardsByScryfallId[$localizedId] ?? null;
                if ($localizedCard instanceof Card) {
                    return $localizedCard->toArray();
                }
            }

            return $this->mergeLocalizedPayload($card, $localizedPayload, $preserveIdentity);
        }, $cards));
    }

    /**
     * @param list<string> $scryfallIds
     * @param list<string> $requestedLanguages
     *
     * @return array<string,array<string,array<string,mixed>>>
     */
    public function localizedPayloadLookupForScryfallIds(array $scryfallIds, array $requestedLanguages): array
    {
        return $this->payloadResolver()->buildLocalizedLookupForScryfallIds($scryfallIds, $requestedLanguages);
    }

    /**
     * @param list<string> $scryfallIds
     * @param list<string> $requestedLanguages
     *
     * @return array<string,array<string,array<string,mixed>>>
     */
    public function localizedImagePayloadLookupForScryfallIds(array $scryfallIds, array $requestedLanguages): array
    {
        return $this->payloadResolver()->buildLocalizedImageLookupForScryfallIds($scryfallIds, $requestedLanguages);
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array<string,mixed>
     */
    public function localizeCardPayloadImagesOnly(array $card, ?string $requestedLanguage): array
    {
        $requestedLanguage = LanguageCatalog::normalize($requestedLanguage);
        if (!LanguageCatalog::isSupported($requestedLanguage) || $requestedLanguage === null) {
            return $card;
        }

        $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
        if ($scryfallId === '') {
            return $card;
        }

        $lookup = $this->payloadResolver()->buildLocalizedImageLookupForScryfallIds([$scryfallId], [$requestedLanguage]);
        $localized = $lookup[$requestedLanguage][$scryfallId] ?? null;
        if (!is_array($localized)) {
            return $card;
        }

        if (is_array($localized['imageUris'] ?? null) && $localized['imageUris'] !== []) {
            $card['imageUris'] = $localized['imageUris'];
        }

        if (is_array($card['cardFaces'] ?? null) && is_array($localized['cardFaces'] ?? null)) {
            $card['cardFaces'] = $this->mergeLocalizedCardFaceImages($card['cardFaces'], $localized['cardFaces']);
        }

        return $card;
    }

    /**
     * @param list<Card> $candidates
     */
    private function preferredLocalizedCandidate(Card $source, array $candidates, string $requestedLanguage): ?Card
    {
        $exactRequested = $this->matchExactLocalizedCandidate($source, $candidates, $requestedLanguage);
        if ($exactRequested instanceof Card && $this->isUsableLocalizedCandidate($source, $exactRequested, $requestedLanguage)) {
            return $exactRequested;
        }

        foreach ($candidates as $candidate) {
            if ($this->isUsableLocalizedCandidate($source, $candidate, $requestedLanguage)) {
                return $candidate;
            }
        }

        if ($requestedLanguage !== LanguageCatalog::DEFAULT_LANGUAGE) {
            $exactEnglish = $this->matchExactLocalizedCandidate($source, $candidates, LanguageCatalog::DEFAULT_LANGUAGE);
            if ($exactEnglish instanceof Card && $this->isUsableLocalizedCandidate($source, $exactEnglish, LanguageCatalog::DEFAULT_LANGUAGE)) {
                return $exactEnglish;
            }

            foreach ($candidates as $candidate) {
                if ($this->isUsableLocalizedCandidate($source, $candidate, LanguageCatalog::DEFAULT_LANGUAGE)) {
                    return $candidate;
                }
            }
        }

        return null;
    }

    /**
     * @param list<Card> $candidates
     */
    private function matchExactLocalizedCandidate(Card $source, array $candidates, string $language): ?Card
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

    /**
     * @param list<string> $scryfallIds
     *
     * @return array<string,Card>
     */
    private function cardsByScryfallIds(array $scryfallIds): array
    {
        if ($scryfallIds === []) {
            return [];
        }

        $cards = $this->entityManager->getRepository(Card::class)
            ->createQueryBuilder('card')
            ->andWhere('card.scryfallId IN (:ids)')
            ->setParameter('ids', $scryfallIds)
            ->getQuery()
            ->getResult();

        $cardsByScryfallId = [];
        foreach ($cards as $card) {
            if ($card instanceof Card) {
                $cardsByScryfallId[$card->scryfallId()] = $card;
            }
        }

        return $cardsByScryfallId;
    }

    /**
     * @param array<string,mixed> $card
     * @param array<string,mixed> $localizedPayload
     *
     * @return array<string,mixed>
     */
    private function mergeLocalizedPayload(array $card, array $localizedPayload, bool $preserveIdentity): array
    {
        if (!$preserveIdentity) {
            $card['scryfallId'] = $localizedPayload['scryfallId'] ?? ($card['scryfallId'] ?? null);
        }

        $card['name'] = $this->localizedPayloadName($localizedPayload, (string) ($card['name'] ?? ''));
        $card['imageUris'] = $localizedPayload['imageUris'] ?? [];
        $card['cardFaces'] = $localizedPayload['cardFaces'] ?? [];
        $card['typeLine'] = $localizedPayload['typeLine'] ?? null;
        $card['manaCost'] = $localizedPayload['manaCost'] ?? null;
        $card['oracleText'] = $localizedPayload['oracleText'] ?? null;
        $card['lang'] = $localizedPayload['lang'] ?? ($card['lang'] ?? null);
        $card['printedName'] = $localizedPayload['printedName'] ?? ($card['printedName'] ?? null);

        return $card;
    }

    /**
     * @param array<string,mixed> $localizedPayload
     */
    private function localizedPayloadName(array $localizedPayload, string $fallback): string
    {
        $printedName = trim((string) ($localizedPayload['printedName'] ?? ''));
        if ($printedName !== '') {
            return $printedName;
        }

        $name = trim((string) ($localizedPayload['name'] ?? ''));

        return $name !== '' ? $name : $fallback;
    }

    /**
     * @param list<array<string,mixed>> $sourceFaces
     * @param list<array<string,mixed>> $localizedFaces
     *
     * @return list<array<string,mixed>>
     */
    private function mergeLocalizedCardFaceImages(array $sourceFaces, array $localizedFaces): array
    {
        return array_values(array_map(
            static function (array $face, int $index) use ($localizedFaces): array {
                $localizedFace = $localizedFaces[$index] ?? null;
                if (!is_array($localizedFace) || !is_array($localizedFace['imageUris'] ?? null) || $localizedFace['imageUris'] === []) {
                    return $face;
                }

                $face['imageUris'] = $localizedFace['imageUris'];

                return $face;
            },
            $sourceFaces,
            array_keys($sourceFaces),
        ));
    }

    private function payloadResolver(): CardLocalizedPayloadResolver
    {
        if (!$this->localizedPayloadResolver instanceof CardLocalizedPayloadResolver) {
            $this->localizedPayloadResolver = new CardLocalizedPayloadResolver($this->entityManager->getConnection());
        }

        return $this->localizedPayloadResolver;
    }

    private function isUsableLocalizedCandidate(Card $source, Card $candidate, string $requestedLanguage): bool
    {
        if ($candidate->lang() !== $requestedLanguage) {
            return false;
        }

        if ($this->isImageStatusUnavailable($candidate->imageStatus())) {
            return false;
        }

        if ($requestedLanguage === LanguageCatalog::DEFAULT_LANGUAGE) {
            return true;
        }

        // Legacy fallback for rows imported before image_status existed.
        if ($candidate->imageStatus() !== null) {
            return true;
        }

        $printedName = trim((string) ($candidate->printedName() ?? ''));
        if ($printedName !== '') {
            return true;
        }

        $candidateType = trim((string) ($candidate->typeLine() ?? ''));
        $sourceType = trim((string) ($source->typeLine() ?? ''));
        if ($candidateType !== '' && $candidateType !== $sourceType) {
            return true;
        }

        $candidateOracle = trim((string) ($candidate->oracleText() ?? ''));
        $sourceOracle = trim((string) ($source->oracleText() ?? ''));

        return $candidateOracle !== '' && $candidateOracle !== $sourceOracle;
    }

    private function isImageStatusUnavailable(?string $imageStatus): bool
    {
        if ($imageStatus === null) {
            return false;
        }

        return in_array(strtolower(trim($imageStatus)), ['missing', 'placeholder'], true);
    }
}
