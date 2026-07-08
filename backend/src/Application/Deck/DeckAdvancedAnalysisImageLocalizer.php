<?php

namespace App\Application\Deck;

use App\Application\Card\CardLocalizedPayloadResolver;
use App\Domain\Localization\LanguageCatalog;

final class DeckAdvancedAnalysisImageLocalizer
{
    public function __construct(private readonly CardLocalizedPayloadResolver $localizedPayloadResolver)
    {
    }

    /**
     * @param array<string,mixed> $analysis
     * @return array<string,mixed>
     */
    public function localize(array $analysis, ?string $requestedLanguage): array
    {
        $language = LanguageCatalog::normalize($requestedLanguage) ?? LanguageCatalog::DEFAULT_LANGUAGE;
        if (!LanguageCatalog::isSupportedCardLanguage($language)) {
            $language = LanguageCatalog::DEFAULT_LANGUAGE;
        }

        $scryfallIds = $this->scryfallIds($analysis);
        if ($scryfallIds === []) {
            return $analysis;
        }

        $localizedLookup = $this->localizedPayloadResolver->buildLocalizedImageLookupForScryfallIds($scryfallIds, [$language]);
        $localizedByScryfallId = $localizedLookup[$language] ?? [];
        if ($localizedByScryfallId === []) {
            return $analysis;
        }

        return $this->localizeNode($analysis, $localizedByScryfallId);
    }

    /**
     * @param array<string,mixed> $node
     * @return list<string>
     */
    private function scryfallIds(array $node): array
    {
        $ids = [];
        $this->collectScryfallIds($node, $ids);

        return array_keys($ids);
    }

    /**
     * @param array<string,mixed> $node
     * @param array<string,true> $ids
     */
    private function collectScryfallIds(array $node, array &$ids): void
    {
        $scryfallId = $this->stringOrNull($node['scryfallId'] ?? null);
        if ($scryfallId !== null) {
            $ids[$scryfallId] = true;
        }

        foreach ($node as $value) {
            if (is_array($value)) {
                $this->collectScryfallIds($value, $ids);
            }
        }
    }

    /**
     * @param array<string,mixed> $node
     * @param array<string,array<string,mixed>> $localizedByScryfallId
     * @return array<string,mixed>
     */
    private function localizeNode(array $node, array $localizedByScryfallId): array
    {
        $scryfallId = $this->stringOrNull($node['scryfallId'] ?? null);
        if ($scryfallId !== null && isset($localizedByScryfallId[$scryfallId])) {
            $node = $this->applyLocalizedImages($node, $localizedByScryfallId[$scryfallId]);
        }

        foreach ($node as $key => $value) {
            if (is_array($value)) {
                $node[$key] = $this->localizeNode($value, $localizedByScryfallId);
            }
        }

        return $node;
    }

    /**
     * @param array<string,mixed> $card
     * @param array<string,mixed> $localized
     * @return array<string,mixed>
     */
    private function applyLocalizedImages(array $card, array $localized): array
    {
        if (is_array($localized['imageUris'] ?? null) && $localized['imageUris'] !== []) {
            $card['imageUris'] = $localized['imageUris'];
        }

        if (is_array($localized['cardFaces'] ?? null) && $localized['cardFaces'] !== []) {
            $sourceFaces = is_array($card['cardFaces'] ?? null) ? $card['cardFaces'] : [];
            $card['cardFaces'] = $sourceFaces === []
                ? array_values($localized['cardFaces'])
                : $this->mergeLocalizedFaceImages($sourceFaces, $localized['cardFaces']);
        }

        $card['imageUrl'] = $this->imageUrl($card);

        return $card;
    }

    /**
     * @param list<array<string,mixed>> $sourceFaces
     * @param list<array<string,mixed>> $localizedFaces
     * @return list<array<string,mixed>>
     */
    private function mergeLocalizedFaceImages(array $sourceFaces, array $localizedFaces): array
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

    /**
     * @param array<string,mixed> $card
     */
    private function imageUrl(array $card): ?string
    {
        $imageUris = is_array($card['imageUris'] ?? null) ? $card['imageUris'] : [];
        $url = $this->firstImageUrl($imageUris);
        if ($url !== null) {
            return $url;
        }

        $cardFaces = is_array($card['cardFaces'] ?? null) ? $card['cardFaces'] : [];
        foreach ($cardFaces as $face) {
            if (!is_array($face) || !is_array($face['imageUris'] ?? null)) {
                continue;
            }

            $url = $this->firstImageUrl($face['imageUris']);
            if ($url !== null) {
                return $url;
            }
        }

        return $this->stringOrNull($card['imageUrl'] ?? null);
    }

    /**
     * @param array<string,mixed> $imageUris
     */
    private function firstImageUrl(array $imageUris): ?string
    {
        foreach (['normal', 'large', 'small', 'png', 'border_crop', 'art_crop'] as $key) {
            $url = $this->stringOrNull($imageUris[$key] ?? null);
            if ($url !== null) {
                return $url;
            }
        }

        return null;
    }

    private function stringOrNull(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = trim((string) $value);

        return $string !== '' ? $string : null;
    }
}
