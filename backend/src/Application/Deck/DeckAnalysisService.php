<?php

namespace App\Application\Deck;

use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;

class DeckAnalysisService
{
    /**
     * @return array<string,mixed>
     */
    public function analyze(Deck $deck): array
    {
        $expanded = $this->expand($deck);
        $nonlands = array_values(array_filter($expanded, fn (DeckCard $entry) => !$this->isLand($entry)));

        return [
            'totalCards' => count($expanded),
            'landCount' => count($expanded) - count($nonlands),
            'nonlandCount' => count($nonlands),
            'colorPips' => $this->countPips($nonlands),
            'landTypes' => $this->landTypeCounts($expanded),
            'manaCurve' => $this->curve($nonlands),
            'creatures' => $this->metric('Creatures', $expanded, fn (DeckCard $entry) => $this->hasType($entry, 'creature')),
            'artifacts' => $this->metric('Artifacts', $expanded, fn (DeckCard $entry) => $this->hasType($entry, 'artifact')),
            'enchantments' => $this->metric('Enchantments', $expanded, fn (DeckCard $entry) => $this->hasType($entry, 'enchantment')),
            'instants' => $this->metric('Instants', $expanded, fn (DeckCard $entry) => $this->hasType($entry, 'instant')),
            'sorceries' => $this->metric('Sorceries', $expanded, fn (DeckCard $entry) => $this->hasType($entry, 'sorcery')),
            'planeswalkers' => $this->metric('Planeswalkers', $expanded, fn (DeckCard $entry) => $this->hasType($entry, 'planeswalker')),
            'ramp' => $this->metric('Ramp', $nonlands, fn (DeckCard $entry) => $this->isRamp($entry)),
            'draw' => $this->metric('Card draw', $nonlands, fn (DeckCard $entry) => $this->isDraw($entry)),
            'removal' => $this->metric('Spot removal', $nonlands, fn (DeckCard $entry) => $this->isRemoval($entry)),
            'wipes' => $this->metric('Board wipes', $nonlands, fn (DeckCard $entry) => $this->isWipe($entry)),
        ];
    }

    /**
     * @return list<DeckCard>
     */
    private function expand(Deck $deck): array
    {
        $expanded = [];
        foreach ($deck->cards() as $entry) {
            if (!$entry instanceof DeckCard) {
                continue;
            }
            if (!$entry->isPlayable()) {
                continue;
            }

            for ($i = 0; $i < $entry->quantity(); ++$i) {
                $expanded[] = $entry;
            }
        }

        return $expanded;
    }

    /**
     * @param list<DeckCard> $cards
     * @return list<array{manaValue:int,count:int}>
     */
    private function curve(array $cards): array
    {
        $buckets = array_fill(0, 8, 0);
        foreach ($cards as $entry) {
            $manaValue = min($this->manaValue($entry->card()->manaCost()), 7);
            ++$buckets[$manaValue];
        }

        return array_map(
            static fn (int $count, int $manaValue): array => ['manaValue' => $manaValue, 'count' => $count],
            $buckets,
            array_keys($buckets),
        );
    }

    /**
     * @param list<DeckCard> $cards
     * @return array{W:int,U:int,B:int,R:int,G:int}
     */
    private function countPips(array $cards): array
    {
        $pips = ['W' => 0, 'U' => 0, 'B' => 0, 'R' => 0, 'G' => 0];
        foreach ($cards as $entry) {
            preg_match_all('/\{[^}]+\}/', $entry->card()->manaCost() ?? '', $matches);
            foreach ($matches[0] ?? [] as $symbol) {
                foreach (array_keys($pips) as $color) {
                    if (str_contains($symbol, $color)) {
                        ++$pips[$color];
                    }
                }
            }
        }

        return $pips;
    }

    /**
     * @param list<DeckCard> $cards
     * @return list<array{label:string,symbol:string,count:int}>
     */
    private function landTypeCounts(array $cards): array
    {
        $types = [
            ['label' => 'Plains', 'symbol' => 'W', 'pattern' => '/(^|\s)plains(\s|$)/i'],
            ['label' => 'Island', 'symbol' => 'U', 'pattern' => '/(^|\s)island(\s|$)/i'],
            ['label' => 'Swamp', 'symbol' => 'B', 'pattern' => '/(^|\s)swamp(\s|$)/i'],
            ['label' => 'Mountain', 'symbol' => 'R', 'pattern' => '/(^|\s)mountain(\s|$)/i'],
            ['label' => 'Forest', 'symbol' => 'G', 'pattern' => '/(^|\s)forest(\s|$)/i'],
        ];

        return array_map(fn (array $type): array => [
            'label' => $type['label'],
            'symbol' => $type['symbol'],
            'count' => count(array_filter($cards, fn (DeckCard $entry) => preg_match($type['pattern'], $entry->card()->typeLine() ?? '') === 1)),
        ], $types);
    }

    private function manaValue(?string $cost): int
    {
        if ($cost === null || $cost === '') {
            return 0;
        }

        preg_match_all('/\{([^}]+)\}/', $cost, $matches);
        $total = 0;
        foreach ($matches[1] ?? [] as $symbol) {
            $numeric = filter_var($symbol, FILTER_VALIDATE_INT);
            if (is_int($numeric)) {
                $total += $numeric;
                continue;
            }

            $total += strtoupper((string) $symbol) === 'X' ? 0 : 1;
        }

        return $total;
    }

    /**
     * @param list<DeckCard> $cards
     * @return array{label:string,count:int,cards:list<string>}
     */
    private function metric(string $label, array $cards, callable $predicate): array
    {
        $names = [];
        $count = 0;
        foreach ($cards as $entry) {
            if (!$predicate($entry)) {
                continue;
            }

            ++$count;
            $names[$entry->card()->name()] = true;
        }

        $cardNames = array_keys($names);
        sort($cardNames, SORT_NATURAL | SORT_FLAG_CASE);

        return ['label' => $label, 'count' => $count, 'cards' => $cardNames];
    }

    private function isLand(DeckCard $entry): bool
    {
        return preg_match('/(^|\s)land(\s|$)/i', $entry->card()->typeLine() ?? '') === 1;
    }

    private function hasType(DeckCard $entry, string $type): bool
    {
        return preg_match(sprintf('/(^|\s)%s(\s|$)/i', preg_quote($type, '/')), $entry->card()->typeLine() ?? '') === 1;
    }

    private function text(DeckCard $entry): string
    {
        return mb_strtolower(($entry->card()->typeLine() ?? '')."\n".($entry->card()->oracleText() ?? ''));
    }

    private function isRamp(DeckCard $entry): bool
    {
        $text = $this->text($entry);

        return preg_match('/add (one|two|three|[wubrgc]|\{[wubrgc]\})/', $text) === 1
            || preg_match('/search your library for (a |up to .* )?basic land/', $text) === 1
            || preg_match('/put .* land .* onto the battlefield/', $text) === 1
            || str_contains($text, 'treasure token');
    }

    private function isDraw(DeckCard $entry): bool
    {
        return preg_match('/draw (a|one|two|three|\d+) cards?/', $this->text($entry)) === 1;
    }

    private function isRemoval(DeckCard $entry): bool
    {
        $text = $this->text($entry);

        return preg_match('/(destroy|exile|return target|counter target|deals? .* damage to target)/', $text) === 1
            && str_contains($text, 'target');
    }

    private function isWipe(DeckCard $entry): bool
    {
        $text = $this->text($entry);

        return preg_match('/(destroy|exile|return) all /', $text) === 1
            || str_contains($text, 'each creature');
    }
}
