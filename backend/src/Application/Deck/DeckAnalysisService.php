<?php

namespace App\Application\Deck;

use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;

class DeckAnalysisService
{
    private const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'];
    private const COLORED = ['W', 'U', 'B', 'R', 'G'];
    private const PRIMARY_TYPES = [
        'creature' => 'Creatures',
        'instant' => 'Instants',
        'sorcery' => 'Sorceries',
        'artifact' => 'Artifacts',
        'enchantment' => 'Enchantments',
        'planeswalker' => 'Planeswalkers',
        'battle' => 'Battles',
        'land' => 'Lands',
        'other' => 'Other',
    ];

    /**
     * @param array<string,mixed> $options
     * @return array<string,mixed>
     */
    public function analyze(Deck $deck, array $options = []): array
    {
        $options = $this->normalizeOptions($options);
        $entries = $this->analysisEntries($deck, $options);
        $expanded = $this->expand($entries);
        $nonlands = array_values(array_filter($expanded, fn (DeckCard $entry): bool => !$this->isLand($entry)));
        $manaValuesWithLands = array_map(fn (DeckCard $entry): int => $this->manaValue($entry), $expanded);
        $manaValuesWithoutLands = array_map(fn (DeckCard $entry): int => $this->manaValue($entry), $nonlands);
        $typeSections = $this->buildTypeSections($entries);
        $colorRequirement = $this->calculateColorRequirement($entries);
        $manaProduction = $this->calculateManaProduction($entries, (string) $options['manaSourcesMode']);

        return [
            'summary' => [
                'totalCards' => count($expanded),
                'mainboardCards' => $this->countSection($deck, DeckCard::SECTION_MAIN),
                'commanderCards' => $this->countSection($deck, DeckCard::SECTION_COMMANDER),
                'landCount' => count($expanded) - count($nonlands),
                'nonLandCount' => count($nonlands),
                'creatureCount' => $this->sectionCount($typeSections, 'creature'),
                'instantCount' => $this->sectionCount($typeSections, 'instant'),
                'sorceryCount' => $this->sectionCount($typeSections, 'sorcery'),
                'artifactCount' => $this->sectionCount($typeSections, 'artifact'),
                'enchantmentCount' => $this->sectionCount($typeSections, 'enchantment'),
                'planeswalkerCount' => $this->sectionCount($typeSections, 'planeswalker'),
                'battleCount' => $this->sectionCount($typeSections, 'battle'),
                'averageManaValueWithLands' => $this->calculateAverageManaValue($manaValuesWithLands),
                'averageManaValueWithoutLands' => $this->calculateAverageManaValue($manaValuesWithoutLands),
                'medianManaValueWithLands' => $this->calculateMedianManaValue($manaValuesWithLands),
                'medianManaValueWithoutLands' => $this->calculateMedianManaValue($manaValuesWithoutLands),
                'totalManaValue' => array_sum($manaValuesWithLands),
                'colorIdentity' => $this->deckColorIdentity($deck),
            ],
            'manaCurve' => [
                'buckets' => $this->buildManaCurve($entries),
            ],
            'typeBreakdown' => [
                'sections' => array_values($typeSections),
            ],
            'colorRequirement' => $colorRequirement,
            'manaProduction' => $manaProduction,
            'colorBalance' => [
                'colors' => $this->calculateColorBalance($colorRequirement, $manaProduction),
            ],
            'curvePlayability' => $this->calculateCurvePlayability($entries, (string) $options['curvePlayabilityMode']),
            'sections' => array_values($typeSections),
            'options' => $options,
        ];
    }

    /**
     * @return array<string,mixed>
     */
    public function parseManaCost(?string $cost): array
    {
        $raw = $cost ?? '';
        $parsed = [
            'raw' => $raw,
            'genericAmount' => 0,
            'coloredSymbols' => ['W' => 0, 'U' => 0, 'B' => 0, 'R' => 0, 'G' => 0],
            'colorlessSymbols' => 0,
            'hybridSymbols' => [],
            'phyrexianSymbols' => [],
            'xSymbols' => 0,
            'totalSymbols' => 0,
        ];

        preg_match_all('/\{([^}]+)\}/', $raw, $matches);
        foreach ($matches[1] ?? [] as $symbol) {
            $symbol = strtoupper(trim((string) $symbol));
            ++$parsed['totalSymbols'];

            if (ctype_digit($symbol)) {
                $parsed['genericAmount'] += (int) $symbol;
                continue;
            }
            if ($symbol === 'X') {
                ++$parsed['xSymbols'];
                continue;
            }
            if ($symbol === 'C') {
                ++$parsed['colorlessSymbols'];
                continue;
            }
            if (str_contains($symbol, '/')) {
                if (str_contains($symbol, '/P')) {
                    $parsed['phyrexianSymbols'][] = $symbol;
                } else {
                    $parsed['hybridSymbols'][] = $symbol;
                }
            }

            foreach (self::COLORED as $color) {
                if (preg_match(sprintf('/(^|\/)%s(\/|$)/', $color), $symbol) === 1 || $symbol === $color) {
                    ++$parsed['coloredSymbols'][$color];
                }
            }
        }

        return $parsed;
    }

    public function getPrimaryType(Card $card): string
    {
        $typeLine = mb_strtolower($card->typeLine() ?? '');
        foreach (['land', 'creature', 'planeswalker', 'artifact', 'enchantment', 'battle', 'instant', 'sorcery'] as $type) {
            if (preg_match(sprintf('/(^|\s)%s(\s|$)/', preg_quote($type, '/')), $typeLine) === 1) {
                return $type;
            }
        }

        return 'other';
    }

    public function hypergeometricAtLeast(int $populationSize, int $successStates, int $draws, int $minSuccesses): float
    {
        if ($populationSize <= 0 || $draws <= 0 || $successStates <= 0) {
            return $minSuccesses <= 0 ? 1.0 : 0.0;
        }

        $draws = min($draws, $populationSize);
        $maxSuccesses = min($successStates, $draws);
        if ($minSuccesses <= 0) {
            return 1.0;
        }
        if ($minSuccesses > $maxSuccesses) {
            return 0.0;
        }

        $total = 0.0;
        $denominator = $this->combination($populationSize, $draws);
        for ($successes = $minSuccesses; $successes <= $maxSuccesses; ++$successes) {
            $failures = $draws - $successes;
            if ($failures > $populationSize - $successStates) {
                continue;
            }
            $total += ($this->combination($successStates, $successes) * $this->combination($populationSize - $successStates, $failures)) / $denominator;
        }

        return round(min(1.0, max(0.0, $total)) * 100, 2);
    }

    public function calculateAverageManaValue(array $values): float
    {
        return $values === [] ? 0.0 : round(array_sum($values) / count($values), 2);
    }

    public function calculateMedianManaValue(array $values): float
    {
        if ($values === []) {
            return 0.0;
        }
        sort($values, SORT_NUMERIC);
        $middle = intdiv(count($values), 2);
        if (count($values) % 2 === 0) {
            return round(($values[$middle - 1] + $values[$middle]) / 2, 2);
        }

        return (float) $values[$middle];
    }

    private function normalizeOptions(array $options): array
    {
        $curvePlayabilityMode = $options['curvePlayabilityMode'] ?? 'play';
        $manaSourcesMode = $options['manaSourcesMode'] ?? 'landsOnly';

        return [
            'includeCommanderInAnalysis' => $this->boolOption($options['includeCommanderInAnalysis'] ?? null, true),
            'includeSideboard' => $this->boolOption($options['includeSideboard'] ?? null, false),
            'includeMaybeboard' => $this->boolOption($options['includeMaybeboard'] ?? null, false),
            'curvePlayabilityMode' => in_array($curvePlayabilityMode, ['play', 'draw'], true) ? $curvePlayabilityMode : 'play',
            'manaSourcesMode' => in_array($manaSourcesMode, ['landsOnly', 'landsAndRamp'], true) ? $manaSourcesMode : 'landsOnly',
        ];
    }

    private function boolOption(mixed $value, bool $default): bool
    {
        if ($value === null || $value === '') {
            return $default;
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }

    /**
     * @return list<DeckCard>
     */
    private function analysisEntries(Deck $deck, array $options): array
    {
        $entries = [];
        foreach ($deck->cards() as $entry) {
            if (!$entry instanceof DeckCard) {
                continue;
            }
            if ($entry->section() === DeckCard::SECTION_COMMANDER && !$options['includeCommanderInAnalysis']) {
                continue;
            }
            if ($entry->section() === DeckCard::SECTION_SIDEBOARD && !$options['includeSideboard']) {
                continue;
            }
            if ($entry->section() === DeckCard::SECTION_MAYBEBOARD && !$options['includeMaybeboard']) {
                continue;
            }
            if (!$entry->isPlayable() && !in_array($entry->section(), [DeckCard::SECTION_SIDEBOARD, DeckCard::SECTION_MAYBEBOARD], true)) {
                continue;
            }
            $entries[] = $entry;
        }

        return $entries;
    }

    /**
     * @return list<DeckCard>
     */
    private function expand(array $entries): array
    {
        $expanded = [];
        foreach ($entries as $entry) {
            for ($i = 0; $i < $entry->quantity(); ++$i) {
                $expanded[] = $entry;
            }
        }

        return $expanded;
    }

    private function countSection(Deck $deck, string $section): int
    {
        $count = 0;
        foreach ($deck->cards() as $entry) {
            if ($entry instanceof DeckCard && $entry->section() === $section) {
                $count += $entry->quantity();
            }
        }

        return $count;
    }

    private function sectionCount(array $sections, string $key): int
    {
        return (int) ($sections[$key]['count'] ?? 0);
    }

    /**
     * @return list<string>
     */
    private function deckColorIdentity(Deck $deck): array
    {
        $colors = [];
        $hasCommander = false;
        foreach ($deck->cards() as $entry) {
            if (!$entry instanceof DeckCard) {
                continue;
            }
            if ($entry->section() === DeckCard::SECTION_COMMANDER) {
                $hasCommander = true;
                $colors = [...$colors, ...$entry->card()->colorIdentity()];
            }
        }
        if (!$hasCommander) {
            foreach ($deck->cards() as $entry) {
                if ($entry instanceof DeckCard && $entry->isPlayable()) {
                    $colors = [...$colors, ...$entry->card()->colorIdentity()];
                }
            }
        }

        return array_values(array_filter(self::COLORED, static fn (string $color): bool => in_array($color, $colors, true)));
    }

    private function isLand(DeckCard $entry): bool
    {
        return $this->getPrimaryType($entry->card()) === 'land';
    }

    private function isPermanent(DeckCard $entry): bool
    {
        return in_array($this->getPrimaryType($entry->card()), ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land'], true);
    }

    private function manaValue(DeckCard $entry): int
    {
        if ($this->isLand($entry)) {
            return 0;
        }

        $value = $entry->card()->manaValue();
        if ($value !== null) {
            return (int) floor($value);
        }

        $parsed = $this->parseManaCost($entry->card()->manaCost());

        return $this->manaValueFromParsedCost($parsed);
    }

    private function manaValueFromParsedCost(array $parsed): int
    {
        $value = (int) $parsed['genericAmount'];
        preg_match_all('/\{([^}]+)\}/', (string) $parsed['raw'], $matches);
        foreach ($matches[1] ?? [] as $symbol) {
            $symbol = strtoupper(trim((string) $symbol));
            if (ctype_digit($symbol) || $symbol === 'X') {
                continue;
            }
            ++$value;
        }

        return $value;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function buildManaCurve(array $entries): array
    {
        $buckets = [];
        for ($i = 0; $i <= 7; ++$i) {
            $buckets[$i] = ['manaValue' => $i, 'totalCards' => 0, 'permanents' => 0, 'spells' => 0, 'lands' => 0, 'cards' => []];
        }

        foreach ($entries as $entry) {
            $manaValue = min($this->manaValue($entry), 7);
            $quantity = $entry->quantity();
            $buckets[$manaValue]['totalCards'] += $quantity;
            if ($this->isLand($entry)) {
                $buckets[$manaValue]['lands'] += $quantity;
            } elseif ($this->isPermanent($entry)) {
                $buckets[$manaValue]['permanents'] += $quantity;
            } else {
                $buckets[$manaValue]['spells'] += $quantity;
            }
            $buckets[$manaValue]['cards'][] = $this->curveCard($entry);
        }

        foreach ($buckets as &$bucket) {
            usort($bucket['cards'], fn (array $a, array $b): int => [$a['manaValue'], $a['name']] <=> [$b['manaValue'], $b['name']]);
        }

        return array_values($buckets);
    }

    private function curveCard(DeckCard $entry): array
    {
        $card = $entry->card();
        $primaryType = $this->getPrimaryType($card);

        return [
            'id' => $card->scryfallId(),
            'name' => $card->name(),
            'quantity' => $entry->quantity(),
            'manaValue' => $this->manaValue($entry),
            'typeLine' => $card->typeLine() ?? '',
            'primaryType' => $primaryType,
            'isPermanent' => $this->isPermanent($entry),
            'isLand' => $primaryType === 'land',
            'imageUrl' => $card->imageUri('normal'),
            'priceEur' => $card->priceEur(),
        ];
    }

    /**
     * @return array<string,array<string,mixed>>
     */
    private function buildTypeSections(array $entries): array
    {
        $sections = [];
        foreach (self::PRIMARY_TYPES as $key => $label) {
            $sections[$key] = ['key' => $key, 'label' => $label, 'count' => 0, 'cards' => []];
        }

        foreach ($entries as $entry) {
            $key = $this->getPrimaryType($entry->card());
            $sections[$key]['count'] += $entry->quantity();
            $sections[$key]['cards'][] = $this->sectionCard($entry);
        }

        foreach ($sections as &$section) {
            usort($section['cards'], fn (array $a, array $b): int => [$a['manaValue'], $a['name']] <=> [$b['manaValue'], $b['name']]);
        }

        return $sections;
    }

    private function sectionCard(DeckCard $entry): array
    {
        $card = $entry->card();

        return [
            'id' => $card->scryfallId(),
            'name' => $card->name(),
            'quantity' => $entry->quantity(),
            'manaValue' => $this->manaValue($entry),
            'manaCost' => $card->manaCost(),
            'typeLine' => $card->typeLine() ?? '',
            'imageUrl' => $card->imageUri('normal'),
            'priceEur' => $card->priceEur(),
        ];
    }

    private function calculateColorRequirement(array $entries): array
    {
        $stats = [];
        foreach (self::COLORS as $color) {
            $stats[$color] = ['color' => $color, 'symbolCount' => 0, 'percentageOfColoredSymbols' => 0.0, 'percentageOfAllSymbols' => 0.0, 'cardsRequiringColor' => 0];
        }
        $totalColored = 0;
        $totalAll = 0;
        $estimated = false;

        foreach ($entries as $entry) {
            if ($this->isLand($entry)) {
                continue;
            }
            $parsed = $this->parseManaCost($entry->card()->manaCost());
            $quantity = $entry->quantity();
            $totalAll += $parsed['totalSymbols'] * $quantity;
            if ($parsed['hybridSymbols'] !== [] || $parsed['phyrexianSymbols'] !== []) {
                $estimated = true;
            }
            foreach (self::COLORED as $color) {
                $count = $parsed['coloredSymbols'][$color] * $quantity;
                $stats[$color]['symbolCount'] += $count;
                $totalColored += $count;
                if ($parsed['coloredSymbols'][$color] > 0) {
                    $stats[$color]['cardsRequiringColor'] += $quantity;
                }
            }
            $stats['C']['symbolCount'] += $parsed['colorlessSymbols'] * $quantity;
        }

        foreach (self::COLORS as $color) {
            $stats[$color]['percentageOfColoredSymbols'] = $totalColored > 0 && $color !== 'C' ? round(($stats[$color]['symbolCount'] / $totalColored) * 100, 2) : 0.0;
            $stats[$color]['percentageOfAllSymbols'] = $totalAll > 0 ? round(($stats[$color]['symbolCount'] / $totalAll) * 100, 2) : 0.0;
        }

        return ['totalColoredSymbols' => $totalColored, 'totalAllSymbols' => $totalAll, 'estimated' => $estimated, 'symbolsByColor' => $stats];
    }

    private function calculateManaProduction(array $entries, string $mode): array
    {
        $stats = [];
        foreach (self::COLORS as $color) {
            $stats[$color] = ['color' => $color, 'sourceCount' => 0, 'symbolCount' => 0, 'percentageOfAllProduction' => 0.0, 'percentageFromLands' => 0.0, 'landSourceCount' => 0, 'nonLandSourceCount' => 0];
        }
        $estimated = false;
        $totalSources = 0;

        foreach ($entries as $entry) {
            if ($mode === 'landsOnly' && !$this->isLand($entry)) {
                continue;
            }
            $production = $this->producedColors($entry);
            if ($production['estimated']) {
                $estimated = true;
            }
            if ($production['colors'] === []) {
                continue;
            }
            $totalSources += $entry->quantity();
            foreach ($production['colors'] as $color) {
                $stats[$color]['sourceCount'] += $entry->quantity();
                $stats[$color]['symbolCount'] += $entry->quantity();
                if ($this->isLand($entry)) {
                    $stats[$color]['landSourceCount'] += $entry->quantity();
                } else {
                    $stats[$color]['nonLandSourceCount'] += $entry->quantity();
                }
            }
        }

        $totalSymbols = array_sum(array_column($stats, 'symbolCount'));
        foreach (self::COLORS as $color) {
            $stats[$color]['percentageOfAllProduction'] = $totalSymbols > 0 ? round(($stats[$color]['symbolCount'] / $totalSymbols) * 100, 2) : 0.0;
            $stats[$color]['percentageFromLands'] = $stats[$color]['sourceCount'] > 0 ? round(($stats[$color]['landSourceCount'] / $stats[$color]['sourceCount']) * 100, 2) : 0.0;
        }

        return ['totalManaSources' => $totalSources, 'totalProducedSymbols' => $totalSymbols, 'estimated' => $estimated, 'productionByColor' => $stats];
    }

    private function producedColors(DeckCard $entry): array
    {
        $card = $entry->card();
        $produced = array_values(array_intersect(self::COLORS, array_map('strtoupper', $card->producedMana())));
        if ($produced !== []) {
            return ['colors' => $produced, 'estimated' => false];
        }

        $colors = [];
        $typeLine = mb_strtolower($card->typeLine() ?? '');
        $oracle = mb_strtolower($card->oracleText() ?? '');
        foreach (['W' => 'plains', 'U' => 'island', 'B' => 'swamp', 'R' => 'mountain', 'G' => 'forest'] as $color => $landType) {
            if (str_contains($typeLine, $landType)) {
                $colors[] = $color;
            }
        }
        if (str_contains($typeLine, 'wastes')) {
            $colors[] = 'C';
        }
        if (preg_match_all('/add \{([WUBRGC])\}/i', $oracle, $matches)) {
            $colors = [...$colors, ...array_map('strtoupper', $matches[1])];
        }
        if (preg_match('/add one mana of any color|add .* mana .* any color|mana of any type/i', $oracle) === 1) {
            $colors = [...$colors, ...self::COLORED];
        }

        return ['colors' => array_values(array_unique($colors)), 'estimated' => $colors !== []];
    }

    private function calculateColorBalance(array $requirement, array $production): array
    {
        $rows = [];
        foreach (self::COLORS as $color) {
            $required = (float) ($requirement['symbolsByColor'][$color]['percentageOfColoredSymbols'] ?? 0.0);
            $produced = (float) ($production['productionByColor'][$color]['percentageOfAllProduction'] ?? 0.0);
            $delta = round($produced - $required, 2);
            $status = 'balanced';
            if ($required === 0.0 && $produced > 0.0) {
                $status = 'unused';
            } elseif ($delta < -8) {
                $status = 'underproduced';
            } elseif ($delta > 12) {
                $status = 'overproduced';
            }
            $rows[] = ['color' => $color, 'requiredPercentage' => $required, 'producedPercentage' => $produced, 'delta' => $delta, 'status' => $status];
        }

        return $rows;
    }

    private function calculateCurvePlayability(array $entries, string $mode): array
    {
        $deckSize = array_sum(array_map(static fn (DeckCard $entry): int => $entry->quantity(), array_filter($entries, static fn (DeckCard $entry): bool => $entry->section() !== DeckCard::SECTION_COMMANDER)));
        $landCount = array_sum(array_map(fn (DeckCard $entry): int => $this->isLand($entry) ? $entry->quantity() : 0, $entries));
        $buckets = [];
        for ($manaValue = 1; $manaValue <= 7; ++$manaValue) {
            $cardCount = 0;
            foreach ($entries as $entry) {
                if (!$this->isLand($entry) && min($this->manaValue($entry), 7) === $manaValue) {
                    $cardCount += $entry->quantity();
                }
            }
            $draws = min($deckSize, 7 + $manaValue - ($mode === 'draw' ? 0 : 1));
            $spellProbability = $this->hypergeometricAtLeast($deckSize, $cardCount, $draws, 1);
            $manaProbability = $this->hypergeometricAtLeast($deckSize, $landCount, $draws, $manaValue);
            $buckets[] = [
                'manaValue' => $manaValue,
                'cardCountAtManaValue' => $cardCount,
                'probabilityOfHavingSpellByTurn' => $spellProbability,
                'probabilityOfHavingEnoughManaByTurn' => $manaProbability,
                'probabilityOfPlayingOnCurve' => round(($spellProbability / 100) * ($manaProbability / 100) * 100, 2),
            ];
        }

        return [
            'disclaimer' => 'This is an approximate probability based on hypergeometric distribution and simplified mana source assumptions.',
            'buckets' => $buckets,
        ];
    }

    private function combination(int $n, int $k): float
    {
        if ($k < 0 || $k > $n) {
            return 0.0;
        }
        $k = min($k, $n - $k);
        $result = 1.0;
        for ($i = 1; $i <= $k; ++$i) {
            $result *= ($n - $k + $i) / $i;
        }

        return $result;
    }
}
