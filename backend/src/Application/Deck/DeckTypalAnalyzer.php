<?php

namespace App\Application\Deck;

final class DeckTypalAnalyzer
{
    private const MIN_PRIMARY_CREATURES = 8;
    private const MIN_PRIMARY_SHARE = 0.35;
    private const MEDIUM_CREATURES = 12;
    private const HIGH_CREATURES = 18;
    private const HIGH_SUPPORT = 5;
    private const MEDIUM_SUPPORT = 2;
    private const IGNORED_SUBTYPES = [];

    /**
     * @param list<array{deckCardId:string,cardId:string,scryfallId:string,oracleId:string,name:string,imageUrl?:?string,quantity:int,section:string,analysisProfile:array<string,mixed>}> $resolvedCards
     * @return array{detected:bool,primaryType:?string,confidence:string,creatureCount:int,supportCount:int,commanderMatches:bool,types:list<array{type:string,creatureCount:int,supportCount:int,commanderMatches:bool,creatureCards:list<array<string,mixed>>,supportCards:list<array<string,mixed>>}>}
     */
    public function analyze(array $resolvedCards): array
    {
        $groups = [];
        $genericSupportCards = [];
        $totalTypedCreatures = 0;

        foreach ($resolvedCards as $card) {
            $profile = $card['analysisProfile'];
            $quantity = max(1, (int) $card['quantity']);
            $types = $this->creatureTypes((string) ($profile['typeLine'] ?? ''));
            $reference = $this->cardReference($card);

            if ($types !== []) {
                $totalTypedCreatures += $quantity;
                foreach ($types as $type) {
                    $groups[$type] ??= $this->emptyGroup($type);
                    $groups[$type]['creatureCount'] += $quantity;
                    $this->addCard($groups[$type]['creatureCards'], $reference);
                    if ($card['section'] === 'commander') {
                        $groups[$type]['commanderMatches'] = true;
                    }
                }
            }

            if (!$this->isTypalSupport($profile)) {
                continue;
            }

            if ($types === []) {
                $this->addCard($genericSupportCards, $reference);
                continue;
            }

            foreach ($types as $type) {
                $groups[$type] ??= $this->emptyGroup($type);
                $groups[$type]['supportCount'] += $quantity;
                $this->addCard($groups[$type]['supportCards'], $reference);
            }
        }

        foreach ($groups as &$group) {
            foreach ($genericSupportCards as $card) {
                $this->addCard($group['supportCards'], $card);
            }
            $group['supportCount'] += $this->totalQuantity($genericSupportCards);
        }
        unset($group);

        $types = array_values($groups);
        usort($types, static fn (array $left, array $right): int => [
            $right['creatureCount'],
            $right['supportCount'],
            $left['type'],
        ] <=> [
            $left['creatureCount'],
            $left['supportCount'],
            $right['type'],
        ]);

        $types = array_slice($types, 0, 6);
        $primary = $types[0] ?? null;
        $primaryShare = $totalTypedCreatures > 0 && is_array($primary)
            ? $primary['creatureCount'] / $totalTypedCreatures
            : 0.0;
        $detected = is_array($primary) && (
            ($primary['creatureCount'] >= self::MIN_PRIMARY_CREATURES && $primaryShare >= self::MIN_PRIMARY_SHARE)
            || ($primary['creatureCount'] >= 5 && $primaryShare >= 0.25 && ($primary['commanderMatches'] || $primary['supportCount'] >= self::MEDIUM_SUPPORT))
            || ($primary['creatureCount'] >= 12 && $primaryShare >= 0.25)
        );

        return [
            'detected' => $detected,
            'primaryType' => $detected ? $primary['type'] : null,
            'confidence' => $detected ? $this->confidence($primary, $primaryShare) : 'low',
            'creatureCount' => $detected ? $primary['creatureCount'] : 0,
            'supportCount' => $detected ? $primary['supportCount'] : 0,
            'commanderMatches' => $detected && $primary['commanderMatches'],
            'types' => $types,
        ];
    }

    /**
     * @return array{type:string,creatureCount:int,supportCount:int,commanderMatches:bool,creatureCards:list<array<string,mixed>>,supportCards:list<array<string,mixed>>}
     */
    private function emptyGroup(string $type): array
    {
        return [
            'type' => $type,
            'creatureCount' => 0,
            'supportCount' => 0,
            'commanderMatches' => false,
            'creatureCards' => [],
            'supportCards' => [],
        ];
    }

    /**
     * @return list<string>
     */
    private function creatureTypes(string $typeLine): array
    {
        $types = [];
        $normalized = str_replace(['—', '–'], '-', $typeLine);
        foreach (preg_split('/\s*\/\/\s*/', $normalized) ?: [] as $faceTypeLine) {
            if (!preg_match('/\bCreature\b/i', $faceTypeLine) || !str_contains($faceTypeLine, '-')) {
                continue;
            }

            $subtypeText = trim((string) preg_replace('/^.*?-\s*/', '', $faceTypeLine));
            if ($subtypeText === '') {
                continue;
            }

            $words = preg_split('/\s+/', $subtypeText) ?: [];
            for ($index = 0; $index < count($words); ++$index) {
                $word = trim($words[$index], " \t\n\r\0\x0B,.;:()[]");
                if ($word === '') {
                    continue;
                }

                if (strcasecmp($word, 'Time') === 0 && strcasecmp($words[$index + 1] ?? '', 'Lord') === 0) {
                    $word = 'Time Lord';
                    ++$index;
                }

                $key = mb_strtolower($word);
                if (isset(self::IGNORED_SUBTYPES[$key])) {
                    continue;
                }

                $types[$word] = true;
            }
        }

        return array_keys($types);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isTypalSupport(array $profile): bool
    {
        $weights = is_array($profile['archetypeWeights'] ?? null) ? $profile['archetypeWeights'] : [];
        if (($weights['typal'] ?? 0) > 0) {
            return true;
        }

        $roles = $this->stringSet($profile['roles'] ?? []);
        $subroles = $this->stringSet($profile['subroles'] ?? []);

        return isset($subroles['typal'])
            || isset($subroles['anthem'])
            || isset($subroles['tribal'])
            || (isset($roles['cost_reducer']) && ($weights['typal'] ?? 0) > 0)
            || (isset($roles['payoff']) && ($weights['typal'] ?? 0) > 0);
    }

    /**
     * @param array{creatureCount:int,supportCount:int,commanderMatches:bool} $primary
     */
    private function confidence(array $primary, float $share): string
    {
        if ($primary['creatureCount'] >= self::HIGH_CREATURES && $primary['supportCount'] >= self::HIGH_SUPPORT && $primary['commanderMatches'] && $share >= 0.55) {
            return 'high';
        }

        if ($primary['creatureCount'] >= self::MEDIUM_CREATURES || $primary['supportCount'] >= self::MEDIUM_SUPPORT || $primary['commanderMatches']) {
            return 'medium';
        }

        return 'low';
    }

    /**
     * @param array<string,mixed> $card
     * @return array{deckCardId:string,cardId:string,scryfallId:string,oracleId:string,name:string,imageUrl:?string,imageUris:array<string,mixed>,cardFaces:list<array<string,mixed>>,quantity:int,section:string}
     */
    private function cardReference(array $card): array
    {
        return [
            'deckCardId' => (string) $card['deckCardId'],
            'cardId' => (string) $card['cardId'],
            'scryfallId' => (string) $card['scryfallId'],
            'oracleId' => (string) $card['oracleId'],
            'name' => (string) $card['name'],
            'imageUrl' => $this->nullableString($card['imageUrl'] ?? null),
            'imageUris' => is_array($card['imageUris'] ?? null) ? $card['imageUris'] : [],
            'cardFaces' => is_array($card['cardFaces'] ?? null) ? array_values($card['cardFaces']) : [],
            'quantity' => max(1, (int) $card['quantity']),
            'section' => (string) $card['section'],
        ];
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @param array<string,mixed> $reference
     */
    private function addCard(array &$cards, array $reference): void
    {
        $key = (string) ($reference['deckCardId'] ?? $reference['cardId'] ?? $reference['oracleId'] ?? $reference['name'] ?? '');
        if ($key === '') {
            return;
        }

        foreach ($cards as $card) {
            $existingKey = (string) ($card['deckCardId'] ?? $card['cardId'] ?? $card['oracleId'] ?? $card['name'] ?? '');
            if ($existingKey === $key) {
                return;
            }
        }

        $cards[] = $reference;
    }

    /**
     * @param list<array<string,mixed>> $cards
     */
    private function totalQuantity(array $cards): int
    {
        $total = 0;
        foreach ($cards as $card) {
            $total += max(1, (int) ($card['quantity'] ?? 1));
        }

        return $total;
    }

    /**
     * @return array<string,true>
     */
    private function stringSet(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $set = [];
        foreach ($value as $item) {
            if (!is_scalar($item)) {
                continue;
            }
            $string = mb_strtolower(trim((string) $item));
            if ($string !== '') {
                $set[$string] = true;
            }
        }

        return $set;
    }

    private function nullableString(mixed $value): ?string
    {
        return is_scalar($value) && trim((string) $value) !== '' ? (string) $value : null;
    }
}
