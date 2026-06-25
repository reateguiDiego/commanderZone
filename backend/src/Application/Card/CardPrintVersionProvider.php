<?php

namespace App\Application\Card;

use App\Domain\Card\Card;
use App\Domain\Localization\LanguageCatalog;
use Doctrine\ORM\EntityManagerInterface;

class CardPrintVersionProvider
{
    /**
     * @return list<Card>
     */
    public function printVersionCards(Card $card, EntityManagerInterface $entityManager, ?string $preferredLanguage = null): array
    {
        $preferredLanguage = LanguageCatalog::normalize($preferredLanguage);
        $candidates = $entityManager->getRepository(Card::class)
            ->createQueryBuilder('card')
            ->andWhere('card.normalizedName IN (:names)')
            ->setParameter('names', [$card->normalizedName()])
            ->orderBy('card.setCode', 'ASC')
            ->addOrderBy('card.collectorNumber', 'ASC')
            ->getQuery()
            ->getResult();

        $cards = array_values(array_filter(
            $candidates,
            fn (Card $candidate): bool => $this->isEquivalentPrintVersion($card, $candidate),
        ));
        $cards = $this->cardsInPrintVersionLanguage($cards, $preferredLanguage ?? LanguageCatalog::DEFAULT_LANGUAGE);

        usort($cards, static function (Card $left, Card $right): int {
            return [$left->name(), $left->setCode() ?? '', $left->collectorNumber() ?? '']
                <=> [$right->name(), $right->setCode() ?? '', $right->collectorNumber() ?? ''];
        });

        return $cards;
    }

    public function isEquivalentPrintVersion(Card $source, Card $candidate): bool
    {
        return $source->normalizedName() === $candidate->normalizedName();
    }

    /**
     * @param list<Card> $cards
     *
     * @return list<Card>
     */
    private function cardsInPrintVersionLanguage(array $cards, string $preferredLanguage): array
    {
        $commonPrintCards = $this->filterCardsByPrintLanguages($cards, LanguageCatalog::commonPrintLanguages());
        $preferredCards = $this->filterCardsByPrintLanguage($cards, $preferredLanguage);
        if ($preferredCards !== []) {
            return $this->uniqueCardsByScryfallId([...$preferredCards, ...$commonPrintCards]);
        }

        if ($preferredLanguage === LanguageCatalog::DEFAULT_LANGUAGE) {
            return $commonPrintCards;
        }

        return $this->uniqueCardsByScryfallId([
            ...$this->filterCardsByPrintLanguage($cards, LanguageCatalog::DEFAULT_LANGUAGE),
            ...$commonPrintCards,
        ]);
    }

    /**
     * @param list<Card> $cards
     *
     * @return list<Card>
     */
    private function filterCardsByPrintLanguage(array $cards, string $language): array
    {
        return array_values(array_filter(
            $cards,
            fn (Card $card): bool => (LanguageCatalog::normalize($card->lang()) ?? LanguageCatalog::DEFAULT_LANGUAGE) === $language
                && $this->isPrintVersionImageAvailable($card),
        ));
    }

    /**
     * @param list<Card> $cards
     * @param list<string> $languages
     *
     * @return list<Card>
     */
    private function filterCardsByPrintLanguages(array $cards, array $languages): array
    {
        $languagesByCode = array_fill_keys($languages, true);

        return array_values(array_filter(
            $cards,
            fn (Card $card): bool => isset($languagesByCode[LanguageCatalog::normalize($card->lang()) ?? LanguageCatalog::DEFAULT_LANGUAGE])
                && $this->isPrintVersionImageAvailable($card),
        ));
    }

    /**
     * @param list<Card> $cards
     *
     * @return list<Card>
     */
    private function uniqueCardsByScryfallId(array $cards): array
    {
        $uniqueCards = [];
        foreach ($cards as $card) {
            $uniqueCards[$card->scryfallId()] ??= $card;
        }

        return array_values($uniqueCards);
    }

    private function isPrintVersionImageAvailable(Card $card): bool
    {
        $imageStatus = $card->imageStatus();
        if ($imageStatus === null) {
            return true;
        }

        return !in_array(strtolower(trim($imageStatus)), ['missing', 'placeholder'], true);
    }
}
