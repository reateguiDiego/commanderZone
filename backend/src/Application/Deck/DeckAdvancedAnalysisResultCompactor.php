<?php

namespace App\Application\Deck;

final class DeckAdvancedAnalysisResultCompactor
{
    /**
     * @param array<string,mixed> $analysis
     * @return array<string,mixed>
     */
    public function compact(array $analysis): array
    {
        $catalog = [];

        $this->compactRoleCards($analysis, $catalog);
        $this->compactQualityCards($analysis, $catalog);
        $this->compactHealthCards($analysis, $catalog);
        $this->compactSummaryCards($analysis, $catalog);
        $this->compactArchetypeCards($analysis, $catalog);
        $this->compactPowerCards($analysis, $catalog);
        $this->compactTypalCards($analysis, $catalog);
        $this->compactComboCards($analysis, $catalog);
        $this->compactTopComboCompleters($analysis, $catalog);
        $this->compactFetchlands($analysis, $catalog);
        $this->compactUnmatchedCards($analysis);

        $analysis['cardCatalog'] = $catalog;

        return $analysis;
    }

    /**
     * @param array<string,mixed> $analysis
     * @param array<string,array<string,mixed>> $catalog
     */
    private function compactQualityCards(array &$analysis, array &$catalog): void
    {
        if (!is_array($analysis['metrics']['qualityCards'] ?? null)) {
            return;
        }

        foreach ($analysis['metrics']['qualityCards'] as $group => $buckets) {
            if (!is_array($buckets)) {
                continue;
            }

            foreach ($buckets as $bucket => $cards) {
                if (!is_array($cards)) {
                    continue;
                }

                $analysis['metrics']['qualityCards'][$group][$bucket] = $this->compactReferenceIds($cards, $catalog);
            }
        }
    }

    /**
     * @param array<string,mixed> $analysis
     * @param array<string,array<string,mixed>> $catalog
     */
    private function compactRoleCards(array &$analysis, array &$catalog): void
    {
        if (!is_array($analysis['metrics']['roleCards'] ?? null)) {
            return;
        }

        foreach ($analysis['metrics']['roleCards'] as $role => $cards) {
            if (!is_array($cards)) {
                continue;
            }

            $analysis['metrics']['roleCards'][$role] = $this->compactReferenceIds($cards, $catalog);
        }
    }

    /**
     * @param array<string,mixed> $analysis
     * @param array<string,array<string,mixed>> $catalog
     */
    private function compactHealthCards(array &$analysis, array &$catalog): void
    {
        if (!is_array($analysis['health'] ?? null)) {
            return;
        }

        foreach ($analysis['health'] as $key => $section) {
            if (!is_array($section) || !is_array($section['cards'] ?? null)) {
                continue;
            }

            $analysis['health'][$key]['cards'] = $this->compactMetricReferences($section['cards'], $catalog);
        }
    }

    /**
     * @param array<string,mixed> $analysis
     * @param array<string,array<string,mixed>> $catalog
     */
    private function compactSummaryCards(array &$analysis, array &$catalog): void
    {
        if (!is_array($analysis['summary']['archetypeExplanations'] ?? null)) {
            return;
        }

        foreach ($analysis['summary']['archetypeExplanations'] as $index => $explanation) {
            if (!is_array($explanation)) {
                continue;
            }

            unset($analysis['summary']['archetypeExplanations'][$index]['score']);
            if (is_array($explanation['cards'] ?? null)) {
                $analysis['summary']['archetypeExplanations'][$index]['cards'] = $this->compactReferenceIds($explanation['cards'], $catalog);
            }
        }
    }

    /**
     * @param array<string,mixed> $analysis
     * @param array<string,array<string,mixed>> $catalog
     */
    private function compactArchetypeCards(array &$analysis, array &$catalog): void
    {
        if (!is_array($analysis['archetypes']['scores'] ?? null)) {
            return;
        }

        foreach ($analysis['archetypes']['scores'] as $index => $score) {
            if (!is_array($score)) {
                continue;
            }

            $analysis['archetypes']['scores'][$index]['reasonKey'] = $this->archetypeReasonKey((string) ($score['archetype'] ?? ''));
            unset($analysis['archetypes']['scores'][$index]['score'], $analysis['archetypes']['scores'][$index]['evidence']);
            if (is_array($score['cards'] ?? null)) {
                $analysis['archetypes']['scores'][$index]['cards'] = $this->compactReferenceIds($score['cards'], $catalog);
            }
        }
    }

    private function archetypeReasonKey(string $archetype): string
    {
        $key = trim($archetype);

        return preg_match('/^[a-z0-9_]+$/', $key) === 1 ? $key : 'generic';
    }

    /**
     * @param array<string,mixed> $analysis
     * @param array<string,array<string,mixed>> $catalog
     */
    private function compactPowerCards(array &$analysis, array &$catalog): void
    {
        if (!is_array($analysis['power']['signalCards'] ?? null)) {
            return;
        }

        foreach ($analysis['power']['signalCards'] as $signal => $cards) {
            if (!is_array($cards)) {
                continue;
            }

            $analysis['power']['signalCards'][$signal] = $this->compactReferenceIds($cards, $catalog);
        }
    }

    /**
     * @param array<string,mixed> $analysis
     * @param array<string,array<string,mixed>> $catalog
     */
    private function compactTypalCards(array &$analysis, array &$catalog): void
    {
        if (!is_array($analysis['typal']['types'] ?? null)) {
            return;
        }

        foreach ($analysis['typal']['types'] as $index => $type) {
            if (!is_array($type)) {
                continue;
            }

            foreach (['creatureCards', 'supportCards'] as $key) {
                if (is_array($type[$key] ?? null)) {
                    $analysis['typal']['types'][$index][$key] = $this->compactReferenceIds($type[$key], $catalog);
                }
            }
        }
    }

    /**
     * @param array<string,mixed> $analysis
     * @param array<string,array<string,mixed>> $catalog
     */
    private function compactComboCards(array &$analysis, array &$catalog): void
    {
        if (!is_array($analysis['combos'] ?? null)) {
            return;
        }

        foreach (['complete', 'partialOneMissing', 'partialTwoMissing'] as $group) {
            if (!is_array($analysis['combos'][$group] ?? null)) {
                continue;
            }

            foreach ($analysis['combos'][$group] as $index => $combo) {
                if (!is_array($combo)) {
                    continue;
                }

                foreach (['cards', 'missingCards'] as $key) {
                    if (is_array($combo[$key] ?? null)) {
                        $analysis['combos'][$group][$index][$key] = $this->compactReferenceIds($combo[$key], $catalog);
                    }
                }
            }
        }
    }

    /**
     * @param array<string,mixed> $analysis
     * @param array<string,array<string,mixed>> $catalog
     */
    private function compactTopComboCompleters(array &$analysis, array &$catalog): void
    {
        if (!is_array($analysis['topComboCompleters'] ?? null)) {
            return;
        }

        $items = [];
        foreach ($analysis['topComboCompleters'] as $item) {
            if (!is_array($item)) {
                continue;
            }

            $this->addCatalogEntry($catalog, $item);
            $oracleId = $this->stringOrNull($item['oracleId'] ?? null);
            if ($oracleId === null) {
                continue;
            }

            $items[] = [
                'oracleId' => $oracleId,
                'completesCombos' => max(0, (int) ($item['completesCombos'] ?? 0)),
            ];
        }

        $analysis['topComboCompleters'] = $items;
    }

    /**
     * @param array<string,mixed> $analysis
     * @param array<string,array<string,mixed>> $catalog
     */
    private function compactFetchlands(array &$analysis, array &$catalog): void
    {
        if (!is_array($analysis['metrics']['mana']['fetchlands']['details'] ?? null)) {
            return;
        }

        $details = [];
        foreach ($analysis['metrics']['mana']['fetchlands']['details'] as $detail) {
            if (!is_array($detail)) {
                continue;
            }

            $compact = $this->compactReference($detail, $catalog);
            if ($compact === null) {
                continue;
            }

            foreach (['quantity', 'fetchableLandTypes', 'effectiveColors', 'untappedEffectiveColors', 'tappedOnlyEffectiveColors', 'dead'] as $key) {
                if (array_key_exists($key, $detail)) {
                    $compact[$key] = $detail[$key];
                }
            }

            $targets = [];
            foreach (($detail['validTargets'] ?? []) as $target) {
                if (!is_array($target)) {
                    continue;
                }

                $compactTarget = $this->compactReference($target, $catalog);
                if ($compactTarget === null) {
                    continue;
                }

                foreach (['landCycleType', 'colors', 'canEnterUntapped', 'entersTapped'] as $key) {
                    if (array_key_exists($key, $target)) {
                        $compactTarget[$key] = $target[$key];
                    }
                }

                $targets[] = $compactTarget;
            }

            $compact['validTargets'] = $targets;
            $details[] = $compact;
        }

        $analysis['metrics']['mana']['fetchlands']['details'] = $details;
    }

    /**
     * @param array<string,mixed> $analysis
     */
    private function compactUnmatchedCards(array &$analysis): void
    {
        if (!is_array($analysis['unmatchedCards'] ?? null)) {
            return;
        }

        foreach ($analysis['unmatchedCards'] as $index => $card) {
            if (!is_array($card)) {
                continue;
            }

            unset($analysis['unmatchedCards'][$index]['cardId']);
        }

        $analysis['unmatchedCards'] = array_values($analysis['unmatchedCards']);
    }

    /**
     * @param list<mixed> $references
     * @param array<string,array<string,mixed>> $catalog
     * @return list<string>
     */
    private function compactReferenceIds(array $references, array &$catalog): array
    {
        $compact = [];
        foreach ($references as $reference) {
            if (!is_array($reference)) {
                continue;
            }

            $referenceId = $this->compactReferenceId($reference, $catalog);
            if ($referenceId !== null) {
                $compact[] = $referenceId;
            }
        }

        return $compact;
    }

    /**
     * @param list<mixed> $references
     * @param array<string,array<string,mixed>> $catalog
     * @return list<array<string,mixed>>
     */
    private function compactMetricReferences(array $references, array &$catalog): array
    {
        $compact = [];
        foreach ($references as $reference) {
            if (!is_array($reference)) {
                continue;
            }

            $item = $this->compactReference($reference, $catalog);
            if ($item !== null) {
                $compact[] = $item;
            }
        }

        return $compact;
    }

    /**
     * @param array<string,mixed> $reference
     * @param array<string,array<string,mixed>> $catalog
     */
    private function compactReferenceId(array $reference, array &$catalog): ?string
    {
        $oracleId = $this->stringOrNull($reference['oracleId'] ?? null);
        if ($oracleId === null) {
            return null;
        }

        if (!$this->hasDeckIdentity($reference)) {
            $this->addCatalogEntry($catalog, $reference);
        }

        return $this->stringOrNull($reference['deckCardId'] ?? null) ?? $oracleId;
    }

    /**
     * @param array<string,mixed> $reference
     * @param array<string,array<string,mixed>> $catalog
     * @return array<string,mixed>|null
     */
    private function compactReference(array $reference, array &$catalog): ?array
    {
        $oracleId = $this->stringOrNull($reference['oracleId'] ?? null);
        if ($oracleId === null) {
            return null;
        }

        if (!$this->hasDeckIdentity($reference)) {
            $this->addCatalogEntry($catalog, $reference);
        }

        $compact = ['oracleId' => $oracleId];
        $deckCardId = $this->stringOrNull($reference['deckCardId'] ?? null);
        if ($deckCardId !== null) {
            $compact['deckCardId'] = $deckCardId;
        }

        if (is_array($reference['matchedMetrics'] ?? null)) {
            $metrics = array_values(array_filter(
                array_map(fn (mixed $value): ?string => $this->stringOrNull($value), $reference['matchedMetrics']),
                static fn (?string $value): bool => $value !== null,
            ));
            if ($metrics !== []) {
                $compact['matchedMetrics'] = $metrics;
            }
        }

        return $compact;
    }

    /**
     * @param array<string,array<string,mixed>> $catalog
     * @param array<string,mixed> $reference
     */
    private function addCatalogEntry(array &$catalog, array $reference): void
    {
        $oracleId = $this->stringOrNull($reference['oracleId'] ?? null);
        $name = $this->stringOrNull($reference['name'] ?? null);
        if ($oracleId === null || $name === null) {
            return;
        }

        $entry = [
            'oracleId' => $oracleId,
            'name' => $name,
        ];

        $imageUrl = $this->stringOrNull($reference['imageUrl'] ?? null);
        if ($imageUrl !== null) {
            $entry['imageUrl'] = $imageUrl;
        }

        $catalog[$oracleId] = $entry;
    }

    /**
     * @param array<string,mixed> $reference
     */
    private function hasDeckIdentity(array $reference): bool
    {
        return $this->stringOrNull($reference['deckCardId'] ?? null) !== null
            || $this->stringOrNull($reference['cardId'] ?? null) !== null;
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
