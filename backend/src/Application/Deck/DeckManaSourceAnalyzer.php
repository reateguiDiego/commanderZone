<?php

namespace App\Application\Deck;

use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;

final class DeckManaSourceAnalyzer
{
    private const COLORS = ['W', 'U', 'B', 'R', 'G'];
    private const COLOR_KEYS = [
        'W' => 'white',
        'U' => 'blue',
        'B' => 'black',
        'R' => 'red',
        'G' => 'green',
        'C' => 'colorless',
    ];
    private const LAND_CYCLES = [
        'fetchland',
        'shockland',
        'triome',
        'surveil_land',
        'fastland',
        'slowland',
        'painland',
        'checkland',
        'filterland',
        'pathway',
        'battle_land',
        'bond_land',
        'bounce_land',
        'temple',
        'gain_land',
        'utility_land',
        'colorless_utility_land',
        'mdfc_land',
    ];

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @param list<array<string,mixed>> $resolvedCards
     * @return array<string,mixed>
     */
    public function analyze(string $deckId, array $resolvedCards): array
    {
        unset($deckId);

        return $this->analyzeResolvedCards($resolvedCards, $this->profilesByOracleId($this->oracleIds($resolvedCards)));
    }

    /**
     * @param list<array<string,mixed>> $resolvedCards
     * @param array<string,array<string,mixed>> $profilesByOracleId
     * @return array<string,mixed>
     */
    public function analyzeResolvedCards(array $resolvedCards, array $profilesByOracleId): array
    {
        $identity = $this->deckColorIdentity($resolvedCards);
        $metrics = $this->emptyMetrics();
        $deckLands = $this->deckLandProfiles($resolvedCards, $profilesByOracleId);
        $filterlands = 0;
        $pathways = 0;
        $checklands = 0;
        $bounceLands = 0;

        foreach ($resolvedCards as $card) {
            $quantity = max(1, (int) ($card['quantity'] ?? 1));
            $profile = $profilesByOracleId[(string) $card['oracleId']] ?? null;
            if ($profile !== null) {
                $cycle = (string) ($profile['land_cycle_type'] ?? 'other');
                $this->addLandMetrics($metrics, $profile, $quantity);
                $this->addRampMetrics($metrics, $profile, $quantity);
                $this->addFixingMetrics($metrics, $profile, $quantity);
                $this->addSourceMetrics($metrics, $profile, $quantity, $identity);
                $filterlands += $cycle === 'filterland' ? $quantity : 0;
                $pathways += $cycle === 'pathway' ? $quantity : 0;
                $checklands += $cycle === 'checkland' ? $quantity : 0;
                $bounceLands += $cycle === 'bounce_land' ? $quantity : 0;
            }

            $this->addPipDemand($metrics, $card, $quantity);
        }

        $this->addFetchlandAnalysis($metrics, $resolvedCards, $profilesByOracleId, $deckLands);
        $this->finalizeLandCycleAnalysis($metrics, $identity, $filterlands, $pathways, $checklands, $bounceLands);
        $this->addCommanderCastability($metrics, $resolvedCards);
        $this->filterManaSourcesToDeckIdentity($metrics, $identity, $this->hasCommander($resolvedCards));

        return $metrics;
    }

    /**
     * @return array<string,mixed>
     */
    private function emptyMetrics(): array
    {
        return [
            'lands' => [
                'total' => 0,
                'basic' => 0,
                'nonBasic' => 0,
                'fetchlands' => 0,
                'typedLands' => 0,
                'utilityLands' => 0,
                'colorlessUtilityLands' => 0,
                'tappedLands' => 0,
                'conditionallyTappedLands' => 0,
                'untappedLands' => 0,
                'mdfcLands' => 0,
            ],
            'landCycles' => array_fill_keys(self::LAND_CYCLES, 0),
            'sources' => $this->emptyColorCounts() + ['anyColor' => 0, 'commanderColor' => 0],
            'untappedSources' => $this->emptyColorCounts(),
            'earlySources' => [
                'turn1' => $this->emptyColorCounts(),
                'turn2' => $this->emptyColorCounts(),
                'turn3' => $this->emptyColorCounts(),
            ],
            'ramp' => [
                'permanentRamp' => 0,
                'landRamp' => 0,
                'manaRocks' => 0,
                'manaDorks' => 0,
                'fastMana' => 0,
                'burstMana' => 0,
                'rituals' => 0,
                'oneShotMana' => 0,
                'treasureSources' => 0,
                'costReducers' => 0,
            ],
            'fixing' => [
                'fetchlands' => 0,
                'rainbowSources' => 0,
                'conditionalFixing' => 0,
                'landRampFixing' => 0,
                'artifactFixing' => 0,
                'creatureFixing' => 0,
            ],
            'fetchlands' => [
                'count' => 0,
                'deadFetchlands' => 0,
                'effectiveColorSources' => $this->emptyColorCounts(false),
                'untappedEffectiveColorSources' => $this->emptyColorCounts(false),
                'tappedOnlyEffectiveColorSources' => $this->emptyColorCounts(false),
                'details' => [],
            ],
            'landCycleAnalysis' => [
                'typedLandDensity' => 0.0,
                'fetchSynergyScore' => 'unknown',
                'checklandSupport' => 'unknown',
                'earlyUntappedAccess' => 'unknown',
                'tappedLandPressure' => 'unknown',
                'colorlessUtilityPressure' => 'unknown',
                'pathwayColorChoicePressure' => 'unknown',
                'filterlandInputPressure' => 'unknown',
                'bounceLandTempoPressure' => 'unknown',
            ],
            'requirements' => [
                'pipDemand' => $this->emptyPipCounts(),
                'earlyPipDemand' => $this->emptyPipCounts(),
                'colorIntensity' => $this->emptyFloatColorCounts(),
                'commanderCost' => [],
                'commanderCastability' => [],
            ],
        ];
    }

    /**
     * @return array<string,int>
     */
    private function emptyColorCounts(bool $includeColorless = true): array
    {
        $counts = [
            'white' => 0,
            'blue' => 0,
            'black' => 0,
            'red' => 0,
            'green' => 0,
        ];

        if ($includeColorless) {
            $counts['colorless'] = 0;
        }

        return $counts;
    }

    /**
     * @return array<string,int>
     */
    private function emptyPipCounts(): array
    {
        return [
            'white' => 0,
            'blue' => 0,
            'black' => 0,
            'red' => 0,
            'green' => 0,
        ];
    }

    /**
     * @return array<string,float>
     */
    private function emptyFloatColorCounts(): array
    {
        return [
            'white' => 0.0,
            'blue' => 0.0,
            'black' => 0.0,
            'red' => 0.0,
            'green' => 0.0,
        ];
    }

    /**
     * @param array<string,mixed> $metrics
     * @param array<string,mixed> $profile
     */
    private function addLandMetrics(array &$metrics, array $profile, int $quantity): void
    {
        if (!$this->boolValue($profile['is_land'] ?? false)) {
            return;
        }

        $cycle = (string) ($profile['land_cycle_type'] ?? 'other');
        $metrics['lands']['total'] += $quantity;
        $metrics['lands']['basic'] += $this->boolValue($profile['is_basic_land'] ?? false) ? $quantity : 0;
        $metrics['lands']['nonBasic'] += $this->boolValue($profile['is_nonbasic_land'] ?? false) ? $quantity : 0;
        $metrics['lands']['fetchlands'] += $this->boolValue($profile['is_fetchland'] ?? false) ? $quantity : 0;
        $metrics['lands']['typedLands'] += $this->boolValue($profile['is_typed_land'] ?? false) ? $quantity : 0;
        $metrics['lands']['utilityLands'] += $this->boolValue($profile['is_utility_land'] ?? false) ? $quantity : 0;
        $metrics['lands']['colorlessUtilityLands'] += $this->boolValue($profile['is_colorless_utility_land'] ?? false) ? $quantity : 0;
        $metrics['lands']['tappedLands'] += $this->boolValue($profile['enters_tapped'] ?? false) ? $quantity : 0;
        $metrics['lands']['conditionallyTappedLands'] += $this->boolValue($profile['enters_tapped_conditionally'] ?? false) ? $quantity : 0;
        $metrics['lands']['untappedLands'] += $this->cleanUntappedLand($profile) ? $quantity : 0;
        $metrics['lands']['mdfcLands'] += $this->boolValue($profile['is_mdfc_land'] ?? false) ? $quantity : 0;

        if (isset($metrics['landCycles'][$cycle])) {
            $metrics['landCycles'][$cycle] += $quantity;
        }
    }

    /**
     * @param array<string,mixed> $metrics
     * @param array<string,mixed> $profile
     */
    private function addRampMetrics(array &$metrics, array $profile, int $quantity): void
    {
        $isRitual = $this->boolValue($profile['is_ritual'] ?? false);
        $isBurst = $this->boolValue($profile['is_burst_mana'] ?? false);
        $metrics['ramp']['landRamp'] += $this->boolValue($profile['is_land_ramp'] ?? false) ? $quantity : 0;
        $metrics['ramp']['manaRocks'] += $this->boolValue($profile['is_mana_rock'] ?? false) ? $quantity : 0;
        $metrics['ramp']['manaDorks'] += $this->boolValue($profile['is_mana_dork'] ?? false) ? $quantity : 0;
        $metrics['ramp']['fastMana'] += $this->boolValue($profile['is_fast_mana'] ?? false) ? $quantity : 0;
        $metrics['ramp']['burstMana'] += $isBurst ? $quantity : 0;
        $metrics['ramp']['rituals'] += $isRitual ? $quantity : 0;
        $metrics['ramp']['oneShotMana'] += $this->boolValue($profile['is_one_shot_mana'] ?? false) ? $quantity : 0;
        $metrics['ramp']['treasureSources'] += $this->boolValue($profile['is_treasure_related'] ?? false) ? $quantity : 0;
        $metrics['ramp']['costReducers'] += $this->boolValue($profile['is_cost_reducer'] ?? false) ? $quantity : 0;
        $metrics['ramp']['permanentRamp'] += $this->boolValue($profile['is_permanent_ramp'] ?? false) && !$isRitual && !$isBurst ? $quantity : 0;
    }

    /**
     * @param array<string,mixed> $metrics
     * @param array<string,mixed> $profile
     */
    private function addFixingMetrics(array &$metrics, array $profile, int $quantity): void
    {
        $category = (string) ($profile['mana_source_category'] ?? 'other');
        if ($this->boolValue($profile['is_fetchland'] ?? false)) {
            $metrics['fixing']['fetchlands'] += $quantity;
        }
        if ($this->boolValue($profile['produces_any_color'] ?? false)) {
            $metrics['fixing']['rainbowSources'] += $quantity;
        }
        if ($this->boolValue($profile['produced_mana_is_conditional'] ?? false)) {
            $metrics['fixing']['conditionalFixing'] += $quantity;
        }
        if ($category === 'land_ramp') {
            $metrics['fixing']['landRampFixing'] += $quantity;
        }
        if ($category === 'mana_rock' && $this->boolValue($profile['is_color_fixing'] ?? false)) {
            $metrics['fixing']['artifactFixing'] += $quantity;
        }
        if ($category === 'mana_dork' && $this->boolValue($profile['is_color_fixing'] ?? false)) {
            $metrics['fixing']['creatureFixing'] += $quantity;
        }
    }

    /**
     * @param array<string,mixed> $metrics
     * @param array<string,mixed> $profile
     * @param list<string> $identity
     */
    private function addSourceMetrics(array &$metrics, array $profile, int $quantity, array $identity): void
    {
        if ($this->boolValue($profile['is_fetchland'] ?? false) || $this->boolValue($profile['is_cost_reducer'] ?? false) || $this->boolValue($profile['is_ritual'] ?? false)) {
            return;
        }
        if ((string) ($profile['land_cycle_type'] ?? '') === 'filterland') {
            $this->addColors($metrics['sources'], $this->colorlessOnly($profile), $quantity);

            return;
        }

        $colors = $this->sourceColors($profile, $identity);
        $this->addColors($metrics['sources'], $colors, $quantity);
        if ($this->boolValue($profile['produces_any_color'] ?? false)) {
            $metrics['sources']['anyColor'] += $quantity;
            $metrics['sources']['commanderColor'] += $quantity;
        }
        if ($this->cleanUntappedSource($profile)) {
            $this->addColors($metrics['untappedSources'], $colors, $quantity);
        }
        foreach ([1, 2, 3] as $turn) {
            if ($this->availableByTurn($profile, $turn)) {
                $this->addColors($metrics['earlySources']['turn'.$turn], $colors, $quantity);
            }
        }
    }

    /**
     * @param list<array<string,mixed>> $resolvedCards
     * @param array<string,array<string,mixed>> $profilesByOracleId
     * @param list<array<string,mixed>> $deckLands
     */
    private function addFetchlandAnalysis(array &$metrics, array $resolvedCards, array $profilesByOracleId, array $deckLands): void
    {
        foreach ($resolvedCards as $card) {
            $profile = $profilesByOracleId[(string) $card['oracleId']] ?? null;
            if ($profile === null || !$this->boolValue($profile['is_fetchland'] ?? false)) {
                continue;
            }

            $quantity = max(1, (int) ($card['quantity'] ?? 1));
            $fetchableTypes = $this->jsonList($profile['fetchable_land_types'] ?? []);
            $targets = $this->fetchTargets($fetchableTypes, $deckLands);
            $effective = [];
            $untapped = [];
            $tappedOnly = [];

            foreach ($targets as $target) {
                $targetColors = $this->jsonList($target['profile']['produced_mana_colors'] ?? []);
                foreach ($targetColors as $color) {
                    $effective[$color] = true;
                    if ($this->targetCanEnterUntapped($target['profile'])) {
                        $untapped[$color] = true;
                    }
                }
            }
            foreach (array_keys($effective) as $color) {
                if (!isset($untapped[$color])) {
                    $tappedOnly[$color] = true;
                }
            }

            $metrics['fetchlands']['count'] += $quantity;
            if ($targets === []) {
                $metrics['fetchlands']['deadFetchlands'] += $quantity;
            }
            $this->addColors($metrics['fetchlands']['effectiveColorSources'], array_keys($effective), $quantity);
            $this->addColors($metrics['fetchlands']['untappedEffectiveColorSources'], array_keys($untapped), $quantity);
            $this->addColors($metrics['fetchlands']['tappedOnlyEffectiveColorSources'], array_keys($tappedOnly), $quantity);
            $this->addColors($metrics['sources'], array_keys($effective), $quantity);
            $this->addColors($metrics['untappedSources'], array_keys($untapped), $quantity);
            foreach ([1, 2, 3] as $turn) {
                $this->addColors($metrics['earlySources']['turn'.$turn], $turn === 1 ? array_keys($untapped) : array_keys($effective), $quantity);
            }
            $fetchland = $this->cardReference($card, (string) ($profile['name'] ?? 'Unknown fetchland'));
            $metrics['fetchlands']['details'][] = [
                ...$fetchland,
                'fetchland' => $fetchland,
                'quantity' => $quantity,
                'fetchableLandTypes' => $fetchableTypes,
                'effectiveColors' => $this->colorNames(array_keys($effective)),
                'untappedEffectiveColors' => $this->colorNames(array_keys($untapped)),
                'tappedOnlyEffectiveColors' => $this->colorNames(array_keys($tappedOnly)),
                'dead' => $targets === [],
            ];
        }
    }

    /**
     * @param array<string,mixed> $metrics
     * @param list<string> $identity
     */
    private function finalizeLandCycleAnalysis(array &$metrics, array $identity, int $filterlands, int $pathways, int $checklands, int $bounceLands): void
    {
        $lands = max(0, (int) $metrics['lands']['total']);
        $typed = (int) $metrics['lands']['typedLands'];
        $tapped = (int) $metrics['lands']['tappedLands'];
        $conditional = (int) $metrics['lands']['conditionallyTappedLands'];
        $colorlessUtility = (int) $metrics['lands']['colorlessUtilityLands'];
        $turn2Colored = array_sum(array_intersect_key($metrics['earlySources']['turn2'], array_flip(array_map(fn (string $color): string => self::COLOR_KEYS[$color], $identity))));

        $metrics['landCycleAnalysis']['typedLandDensity'] = $lands > 0 ? round($typed / $lands, 3) : 0.0;
        $metrics['landCycleAnalysis']['fetchSynergyScore'] = $this->fetchSynergyScore($metrics);
        $metrics['landCycleAnalysis']['checklandSupport'] = $checklands === 0 ? 'unknown' : $this->thresholdStatus($typed, max(4, $checklands * 2), max(2, $checklands));
        $metrics['landCycleAnalysis']['earlyUntappedAccess'] = $identity === [] ? 'unknown' : $this->thresholdStatus($turn2Colored, count($identity) * 6, count($identity) * 4);
        $metrics['landCycleAnalysis']['tappedLandPressure'] = $lands === 0 ? 'unknown' : $this->pressureStatus(($tapped + $conditional) / $lands, 0.22, 0.34);
        $metrics['landCycleAnalysis']['colorlessUtilityPressure'] = $lands === 0 ? 'unknown' : $this->pressureStatus($colorlessUtility / $lands, 0.12, 0.2);
        $metrics['landCycleAnalysis']['pathwayColorChoicePressure'] = $pathways === 0 ? 'unknown' : ($pathways >= 4 && count($identity) >= 3 ? 'warning' : 'good');
        $metrics['landCycleAnalysis']['filterlandInputPressure'] = $filterlands === 0 ? 'unknown' : ($filterlands >= 3 && array_sum($metrics['untappedSources']) < count($identity) * 6 ? 'warning' : 'good');
        $metrics['landCycleAnalysis']['bounceLandTempoPressure'] = $bounceLands === 0 ? 'unknown' : ($bounceLands >= 3 ? 'critical' : ($bounceLands >= 2 ? 'warning' : 'good'));
    }

    /**
     * @param array<string,mixed> $metrics
     * @param list<array{oracleId:string,quantity:int,section:string,analysisProfile:array<string,mixed>,name?:string}> $resolvedCards
     */
    private function addCommanderCastability(array &$metrics, array $resolvedCards): void
    {
        foreach ($resolvedCards as $card) {
            if (($card['section'] ?? '') !== 'commander') {
                continue;
            }

            $pips = $this->manaCostPips($this->stringOrNull($card['analysisProfile']['manaCost'] ?? null));
            $metrics['requirements']['commanderCost'][(string) ($card['name'] ?? $card['oracleId'])] = $pips;
            foreach ($pips as $color => $required) {
                if ($required <= 0) {
                    continue;
                }
                $metrics['requirements']['commanderCastability'][$color] = [
                    'requiredPips' => $required,
                    'sourceCount' => $metrics['sources'][$color] ?? 0,
                    'untappedSourceCount' => $metrics['untappedSources'][$color] ?? 0,
                    'earlySourceCount' => $metrics['earlySources']['turn3'][$color] ?? 0,
                    'status' => $this->castabilityStatus((int) ($metrics['sources'][$color] ?? 0), $required),
                ];
            }
        }
    }

    /**
     * @param array<string,mixed> $metrics
     * @param list<string> $identity
     * @param bool $hasCommander
     */
    private function filterManaSourcesToDeckIdentity(array &$metrics, array $identity, bool $hasCommander): void
    {
        if ($identity === [] && !$hasCommander) {
            return;
        }

        $allowedColors = array_flip(array_map(static fn (string $color): string => self::COLOR_KEYS[$color], $identity));
        $sourceKeys = $allowedColors + ['colorless' => true, 'anyColor' => true, 'commanderColor' => true];
        $colorSourceKeys = $allowedColors + ['colorless' => true];

        if (is_array($metrics['sources'] ?? null)) {
            $metrics['sources'] = array_intersect_key($metrics['sources'], $sourceKeys);
        }
        if (is_array($metrics['untappedSources'] ?? null)) {
            $metrics['untappedSources'] = array_intersect_key($metrics['untappedSources'], $colorSourceKeys);
        }
        if (is_array($metrics['earlySources'] ?? null)) {
            foreach (['turn1', 'turn2', 'turn3'] as $turn) {
                if (is_array($metrics['earlySources'][$turn] ?? null)) {
                    $metrics['earlySources'][$turn] = array_intersect_key($metrics['earlySources'][$turn], $colorSourceKeys);
                }
            }
        }
        if (is_array($metrics['fetchlands'] ?? null)) {
            foreach (['effectiveColorSources', 'untappedEffectiveColorSources', 'tappedOnlyEffectiveColorSources'] as $key) {
                if (is_array($metrics['fetchlands'][$key] ?? null)) {
                    $metrics['fetchlands'][$key] = array_intersect_key($metrics['fetchlands'][$key], $allowedColors);
                }
            }

            if (is_array($metrics['fetchlands']['details'] ?? null)) {
                foreach ($metrics['fetchlands']['details'] as $index => $detail) {
                    if (!is_array($detail)) {
                        continue;
                    }
                    foreach (['effectiveColors', 'untappedEffectiveColors', 'tappedOnlyEffectiveColors'] as $key) {
                        if (is_array($detail[$key] ?? null)) {
                            $metrics['fetchlands']['details'][$index][$key] = $this->filterColorNameList($detail[$key], $allowedColors);
                        }
                    }
                }
            }
        }
    }

    /**
     * @param list<mixed> $colors
     * @param array<string,int> $allowedColors
     * @return list<string>
     */
    private function filterColorNameList(array $colors, array $allowedColors): array
    {
        return array_values(array_filter(
            array_map(static fn (mixed $color): ?string => is_scalar($color) ? trim((string) $color) : null, $colors),
            static fn (?string $color): bool => $color !== null && isset($allowedColors[$color]),
        ));
    }

    /**
     * @param array<string,mixed> $metrics
     * @param array<string,mixed> $card
     */
    private function addPipDemand(array &$metrics, array $card, int $quantity): void
    {
        $profile = $card['analysisProfile'] ?? [];
        if (!is_array($profile) || $this->boolPath($profile, ['types', 'land'])) {
            return;
        }

        $pips = $this->manaCostPips($this->stringOrNull($profile['manaCost'] ?? null));
        $manaValue = is_numeric($profile['manaValue'] ?? null) ? (float) $profile['manaValue'] : null;
        $totalPips = 0;
        foreach ($pips as $color => $count) {
            if ($count <= 0) {
                continue;
            }
            $metrics['requirements']['pipDemand'][$color] += $count * $quantity;
            $totalPips += $count * $quantity;
            if ($manaValue !== null && $manaValue <= 3.0) {
                $metrics['requirements']['earlyPipDemand'][$color] += $count * $quantity;
            }
        }

        if ($totalPips > 0) {
            foreach ($pips as $color => $count) {
                $metrics['requirements']['colorIntensity'][$color] = round($metrics['requirements']['colorIntensity'][$color] + ($count * $quantity / $totalPips), 3);
            }
        }
    }

    /**
     * @param list<string> $oracleIds
     * @return array<string,array<string,mixed>>
     */
    private function profilesByOracleId(array $oracleIds): array
    {
        if ($oracleIds === []) {
            return [];
        }

        $profiles = [];
        foreach ($this->connection->executeQuery(
            'SELECT * FROM card_mana_profile WHERE oracle_id IN (:oracleIds)',
            ['oracleIds' => $oracleIds],
            ['oracleIds' => ArrayParameterType::STRING],
        )->fetchAllAssociative() as $row) {
            $profiles[(string) $row['oracle_id']] = $this->normalizeManaProfile($row);
        }

        return $profiles;
    }

    /**
     * @param list<array{oracleId:string}> $resolvedCards
     * @return list<string>
     */
    private function oracleIds(array $resolvedCards): array
    {
        $ids = [];
        foreach ($resolvedCards as $card) {
            $id = trim((string) ($card['oracleId'] ?? ''));
            if ($id !== '') {
                $ids[$id] = true;
            }
        }

        return array_keys($ids);
    }

    /**
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function normalizeManaProfile(array $row): array
    {
        foreach (['basic_land_types', 'produced_mana_colors', 'land_risk_profile', 'land_synergy_profile', 'fetchable_land_types'] as $column) {
            $row[$column] = $this->jsonList($row[$column] ?? []);
        }

        return $row;
    }

    /**
     * @param list<array<string,mixed>> $resolvedCards
     * @param array<string,array<string,mixed>> $profilesByOracleId
     * @return list<array<string,mixed>>
     */
    private function deckLandProfiles(array $resolvedCards, array $profilesByOracleId): array
    {
        $lands = [];
        foreach ($resolvedCards as $card) {
            $profile = $profilesByOracleId[(string) $card['oracleId']] ?? null;
            if ($profile === null || !$this->boolValue($profile['is_land'] ?? false) || $this->boolValue($profile['is_fetchland'] ?? false)) {
                continue;
            }
            $lands[] = [
                ...$this->cardReference($card, (string) ($profile['name'] ?? 'Unknown land')),
                'profile' => $profile,
            ];
        }

        return $lands;
    }

    /**
     * @param array<string,mixed> $card
     * @return array{oracleId:string,cardId:?string,scryfallId:?string,name:string,imageUrl:?string,imageUris:array<string,mixed>,cardFaces:list<array<string,mixed>>,quantity:int,missingImage:bool}
     */
    private function cardReference(array $card, string $fallbackName): array
    {
        $imageUrl = $this->stringOrNull($card['imageUrl'] ?? null);
        $imageUris = is_array($card['imageUris'] ?? null) ? $card['imageUris'] : [];
        $cardFaces = $this->cardFaces($card['cardFaces'] ?? []);

        return [
            'oracleId' => (string) ($card['oracleId'] ?? ''),
            'cardId' => $this->stringOrNull($card['cardId'] ?? null),
            'scryfallId' => $this->stringOrNull($card['scryfallId'] ?? null),
            'name' => $this->stringOrNull($card['name'] ?? null) ?? $fallbackName,
            'imageUrl' => $imageUrl,
            'imageUris' => $imageUris,
            'cardFaces' => $cardFaces,
            'quantity' => max(1, (int) ($card['quantity'] ?? 1)),
            'missingImage' => $imageUrl === null && $imageUris === [] && $cardFaces === [],
        ];
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function cardFaces(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        return array_values(array_filter($value, static fn (mixed $face): bool => is_array($face)));
    }

    /**
     * @param array<string,mixed> $profile
     * @param list<string> $identity
     * @return list<string>
     */
    private function sourceColors(array $profile, array $identity): array
    {
        $colors = $this->jsonList($profile['produced_mana_colors'] ?? []);
        if ($this->boolValue($profile['produces_any_color'] ?? false) && $identity !== []) {
            $colors = [...$colors, ...$identity];
        }

        return array_values(array_unique(array_filter($colors, static fn (string $color): bool => isset(self::COLOR_KEYS[$color]))));
    }

    /**
     * @param array<string,mixed> $profile
     * @return list<string>
     */
    private function colorlessOnly(array $profile): array
    {
        return in_array('C', $this->jsonList($profile['produced_mana_colors'] ?? []), true) ? ['C'] : [];
    }

    /**
     * @param array<string,int> $bucket
     * @param list<string> $colors
     */
    private function addColors(array &$bucket, array $colors, int $quantity): void
    {
        foreach ($this->colorNames($colors) as $color) {
            if (array_key_exists($color, $bucket)) {
                $bucket[$color] += $quantity;
            }
        }
    }

    /**
     * @param list<string> $colors
     * @return list<string>
     */
    private function colorNames(array $colors): array
    {
        $names = [];
        foreach ($colors as $color) {
            $normalized = mb_strtoupper(trim($color));
            if (isset(self::COLOR_KEYS[$normalized])) {
                $names[] = self::COLOR_KEYS[$normalized];
            }
        }

        return array_values(array_unique($names));
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function cleanUntappedLand(array $profile): bool
    {
        return $this->boolValue($profile['is_land'] ?? false)
            && !$this->boolValue($profile['enters_tapped'] ?? false)
            && !$this->boolValue($profile['enters_tapped_conditionally'] ?? false)
            && !$this->boolValue($profile['is_fetchland'] ?? false);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function cleanUntappedSource(array $profile): bool
    {
        if (!$this->boolValue($profile['is_land'] ?? false)) {
            return !$this->boolValue($profile['requires_input_mana'] ?? false);
        }

        return $this->cleanUntappedLand($profile)
            || in_array((string) ($profile['land_cycle_type'] ?? ''), ['fastland', 'painland'], true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function availableByTurn(array $profile, int $turn): bool
    {
        $cycle = (string) ($profile['land_cycle_type'] ?? '');
        if ($this->boolValue($profile['is_fetchland'] ?? false)) {
            return false;
        }
        if (!$this->boolValue($profile['is_land'] ?? false)) {
            return !$this->boolValue($profile['requires_input_mana'] ?? false) && !$this->boolValue($profile['is_cost_reducer'] ?? false);
        }
        if (in_array($cycle, ['triome', 'surveil_land', 'temple', 'gain_land', 'bounce_land'], true)) {
            return false;
        }
        if ($cycle === 'slowland') {
            return $turn >= 3;
        }
        if ($cycle === 'fastland') {
            return $turn <= 2;
        }

        return $this->cleanUntappedSource($profile) || $turn >= 3 && $this->boolValue($profile['can_enter_untapped'] ?? false);
    }

    /**
     * @param list<string> $fetchableTypes
     * @param list<array{oracleId:string,name:string,quantity:int,profile:array<string,mixed>}> $deckLands
     * @return list<array{oracleId:string,name:string,quantity:int,profile:array<string,mixed>}>
     */
    private function fetchTargets(array $fetchableTypes, array $deckLands): array
    {
        if ($fetchableTypes === []) {
            return [];
        }

        return array_values(array_filter($deckLands, function (array $land) use ($fetchableTypes): bool {
            $types = $this->jsonList($land['profile']['basic_land_types'] ?? []);

            return array_intersect($fetchableTypes, $types) !== [];
        }));
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function targetCanEnterUntapped(array $profile): bool
    {
        return in_array((string) ($profile['land_speed_profile'] ?? ''), ['always_untapped', 'untapped_with_life_payment', 'untapped_early', 'conditional_untapped'], true)
            || $this->cleanUntappedLand($profile);
    }

    /**
     * @param array<string,mixed> $metrics
     */
    private function fetchSynergyScore(array $metrics): string
    {
        $count = (int) $metrics['fetchlands']['count'];
        if ($count === 0) {
            return 'unknown';
        }
        if ((int) $metrics['fetchlands']['deadFetchlands'] > 0) {
            return (int) $metrics['fetchlands']['deadFetchlands'] >= $count ? 'critical' : 'warning';
        }

        return 'good';
    }

    private function thresholdStatus(int $value, int $good, int $warning): string
    {
        if ($value >= $good) {
            return 'good';
        }
        if ($value >= $warning) {
            return 'warning';
        }

        return 'critical';
    }

    private function pressureStatus(float $ratio, float $warning, float $critical): string
    {
        if ($ratio >= $critical) {
            return 'critical';
        }
        if ($ratio >= $warning) {
            return 'warning';
        }

        return 'good';
    }

    private function castabilityStatus(int $sources, int $requiredPips): string
    {
        $good = match ($requiredPips) {
            1 => 8,
            2 => 14,
            default => 18,
        };
        $warning = match ($requiredPips) {
            1 => 5,
            2 => 10,
            default => 14,
        };

        return $this->thresholdStatus($sources, $good, $warning);
    }

    /**
     * @param list<array{analysisProfile:array<string,mixed>}> $resolvedCards
     * @return list<string>
     */
    private function deckColorIdentity(array $resolvedCards): array
    {
        $commander = [];
        $deck = [];
        foreach ($resolvedCards as $card) {
            $colors = $this->colorSymbols($card['analysisProfile']['colorIdentity'] ?? []);
            foreach ($colors as $color) {
                $deck[$color] = true;
                if (($card['section'] ?? '') === 'commander') {
                    $commander[$color] = true;
                }
            }
        }
        $identity = $commander !== [] ? array_keys($commander) : array_keys($deck);
        sort($identity, SORT_STRING);

        return $identity;
    }

    /**
     * @param list<array<string,mixed>> $resolvedCards
     */
    private function hasCommander(array $resolvedCards): bool
    {
        foreach ($resolvedCards as $card) {
            if (($card['section'] ?? '') === 'commander') {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array<string,int>
     */
    private function manaCostPips(?string $manaCost): array
    {
        $pips = $this->emptyPipCounts();
        if ($manaCost === null || preg_match_all('/\{([^}]+)\}/', $manaCost, $matches) === 0) {
            return $pips;
        }

        foreach ($matches[1] as $symbol) {
            foreach (self::COLORS as $color) {
                if (preg_match('/(^|[^A-Z])'.preg_quote($color, '/').'([^A-Z]|$)/', (string) $symbol) === 1) {
                    $pips[self::COLOR_KEYS[$color]] += 1;
                }
            }
        }

        return $pips;
    }

    /**
     * @return list<string>
     */
    private function colorSymbols(mixed $value): array
    {
        return array_values(array_filter($this->jsonList($value), static fn (string $color): bool => in_array($color, self::COLORS, true)));
    }

    /**
     * @return list<string>
     */
    private function jsonList(mixed $value): array
    {
        if (is_array($value)) {
            return array_values(array_filter(array_map(
                static fn (mixed $item): ?string => is_scalar($item) ? mb_strtoupper(trim((string) $item)) : null,
                $value,
            ), static fn (?string $item): bool => $item !== null && $item !== ''));
        }

        if (!is_string($value) || trim($value) === '') {
            return [];
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $this->jsonList($decoded) : [];
    }

    /**
     * @param array<string,mixed> $source
     * @param list<string> $path
     */
    private function boolPath(array $source, array $path): bool
    {
        $value = $source;
        foreach ($path as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) {
                return false;
            }
            $value = $value[$segment];
        }

        return $value === true;
    }

    private function boolValue(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value)) {
            return $value === 1;
        }

        return is_string($value) && in_array(mb_strtolower(trim($value)), ['1', 'true', 't', 'yes', 'y'], true);
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
