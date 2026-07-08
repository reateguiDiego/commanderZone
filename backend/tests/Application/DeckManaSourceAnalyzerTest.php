<?php

namespace App\Tests\Application;

use App\Application\Deck\DeckManaSourceAnalyzer;
use Doctrine\DBAL\Connection;
use PHPUnit\Framework\TestCase;

final class DeckManaSourceAnalyzerTest extends TestCase
{
    public function testTwoColorFetchShockCountsEffectiveUntappedSources(): void
    {
        $metrics = $this->analyze(
            [
                $this->card('fetch', 'Flooded Strand'),
                $this->card('shock', 'Hallowed Fountain'),
            ],
            [
                'fetch' => $this->fetchProfile('Flooded Strand', ['Plains', 'Island']),
                'shock' => $this->landProfile('Hallowed Fountain', ['W', 'U'], ['Plains', 'Island'], 'shockland', canEnterUntapped: true),
            ],
        );

        self::assertSame(1, $metrics['fetchlands']['count']);
        self::assertSame(1, $metrics['fetchlands']['validTargets']);
        self::assertSame(0, $metrics['fetchlands']['deadFetchlands']);
        self::assertSame(1, $metrics['fetchlands']['effectiveColorSources']['white']);
        self::assertSame(1, $metrics['fetchlands']['effectiveColorSources']['blue']);
        self::assertSame(1, $metrics['fetchlands']['untappedEffectiveColorSources']['white']);
        self::assertSame(1, $metrics['fetchlands']['untappedEffectiveColorSources']['blue']);
        self::assertSame('good', $metrics['landCycleAnalysis']['fetchSynergyScore']);
    }

    public function testThreeColorFetchTriomeSeparatesTappedOnlyEffectiveColors(): void
    {
        $metrics = $this->analyze(
            [
                $this->card('fetch', 'Flooded Strand'),
                $this->card('triome', 'Raugrin Triome'),
            ],
            [
                'fetch' => $this->fetchProfile('Flooded Strand', ['Plains', 'Island']),
                'triome' => $this->landProfile('Raugrin Triome', ['W', 'U', 'R'], ['Plains', 'Island', 'Mountain'], 'triome', entersTapped: true),
            ],
        );

        self::assertSame(1, $metrics['fetchlands']['effectiveColorSources']['red']);
        self::assertSame(0, $metrics['fetchlands']['untappedEffectiveColorSources']['red']);
        self::assertSame(1, $metrics['fetchlands']['tappedOnlyEffectiveColorSources']['red']);
        self::assertSame(1, $metrics['landCycles']['triome']);
        self::assertSame(1, $metrics['lands']['tappedLands']);
    }

    public function testDeadFetchlandDoesNotCountAsEffectiveSource(): void
    {
        $metrics = $this->analyze(
            [
                $this->card('fetch', 'Polluted Delta'),
                $this->card('forest', 'Forest'),
            ],
            [
                'fetch' => $this->fetchProfile('Polluted Delta', ['Island', 'Swamp']),
                'forest' => $this->landProfile('Forest', ['G'], ['Forest'], 'basic', basic: true, canEnterUntapped: true),
            ],
        );

        self::assertSame(1, $metrics['fetchlands']['deadFetchlands']);
        self::assertSame(0, $metrics['fetchlands']['effectiveColorSources']['blue']);
        self::assertSame(0, $metrics['fetchlands']['effectiveColorSources']['black']);
        self::assertSame('critical', $metrics['landCycleAnalysis']['fetchSynergyScore']);
    }

    public function testFetchlandDetailsIncludeRenderableFetchlandAndTargets(): void
    {
        $metrics = $this->analyze(
            [
                $this->card('fetch', 'Wooded Foothills', overrides: [
                    'cardId' => 'card-wooded-foothills',
                    'scryfallId' => 'scryfall-wooded-foothills',
                    'imageUrl' => 'https://cards.example.test/wooded-foothills.jpg',
                    'imageUris' => ['normal' => 'https://cards.example.test/wooded-foothills.jpg'],
                ]),
                $this->card('shock', 'Stomping Ground', overrides: [
                    'cardId' => 'card-stomping-ground',
                    'scryfallId' => 'scryfall-stomping-ground',
                    'imageUrl' => 'https://cards.example.test/stomping-ground.jpg',
                    'imageUris' => ['normal' => 'https://cards.example.test/stomping-ground.jpg'],
                ]),
                $this->card('battle', 'Cinder Glade', overrides: [
                    'cardId' => 'card-cinder-glade',
                    'scryfallId' => 'scryfall-cinder-glade',
                    'imageUrl' => 'https://cards.example.test/cinder-glade.jpg',
                    'imageUris' => ['normal' => 'https://cards.example.test/cinder-glade.jpg'],
                ]),
            ],
            [
                'fetch' => $this->fetchProfile('Wooded Foothills', ['Mountain', 'Forest']),
                'shock' => $this->landProfile('Stomping Ground', ['R', 'G'], ['Mountain', 'Forest'], 'shockland', canEnterUntapped: true),
                'battle' => $this->landProfile('Cinder Glade', ['R', 'G'], ['Mountain', 'Forest'], 'battle_land', conditional: true, canEnterUntapped: true),
            ],
        );

        $detail = $metrics['fetchlands']['details'][0] ?? null;
        self::assertIsArray($detail);
        $this->assertNoNakedCardIds($metrics['fetchlands']['details']);
        self::assertSame('fetch', $detail['oracleId']);
        self::assertSame('card-wooded-foothills', $detail['cardId']);
        self::assertSame('Wooded Foothills', $detail['name']);
        self::assertSame('https://cards.example.test/wooded-foothills.jpg', $detail['imageUrl']);
        self::assertFalse($detail['missingImage']);
        self::assertSame($detail['oracleId'], $detail['fetchland']['oracleId']);
        self::assertSame($detail['name'], $detail['fetchland']['name']);
        self::assertSame($detail['imageUrl'], $detail['fetchland']['imageUrl']);

        self::assertCount(2, $detail['validTargets']);
        self::assertSame('shock', $detail['validTargets'][0]['oracleId']);
        self::assertSame('Stomping Ground', $detail['validTargets'][0]['name']);
        self::assertSame('https://cards.example.test/stomping-ground.jpg', $detail['validTargets'][0]['imageUrl']);
        self::assertSame('shockland', $detail['validTargets'][0]['landCycleType']);
        self::assertSame(['red', 'green'], $detail['validTargets'][0]['colors']);
        self::assertTrue($detail['validTargets'][0]['canEnterUntapped']);
        self::assertFalse($detail['validTargets'][0]['missingImage']);
        self::assertSame('Cinder Glade', $detail['validTargets'][1]['name']);
        self::assertSame('https://cards.example.test/cinder-glade.jpg', $detail['validTargets'][1]['imageUrl']);
    }

    public function testFetchlandDetailsMarkMissingImagesWithoutFailing(): void
    {
        $metrics = $this->analyze(
            [
                $this->card('fetch', 'Wooded Foothills'),
                $this->card('forest', 'Forest'),
            ],
            [
                'fetch' => $this->fetchProfile('Wooded Foothills', ['Forest']),
                'forest' => $this->landProfile('Forest', ['G'], ['Forest'], 'basic', basic: true, canEnterUntapped: true),
            ],
        );

        $detail = $metrics['fetchlands']['details'][0] ?? null;
        self::assertIsArray($detail);
        $this->assertNoNakedCardIds($metrics['fetchlands']['details']);
        self::assertSame('Wooded Foothills', $detail['fetchland']['name']);
        self::assertNull($detail['fetchland']['imageUrl']);
        self::assertTrue($detail['fetchland']['missingImage']);
        self::assertSame('Forest', $detail['validTargets'][0]['name']);
        self::assertNull($detail['validTargets'][0]['imageUrl']);
        self::assertTrue($detail['validTargets'][0]['missingImage']);
    }

    public function testRampRitualAndCostReducerBucketsDoNotConflatePermanentMana(): void
    {
        $metrics = $this->analyze(
            [
                $this->card('growth', 'Rampant Growth'),
                $this->card('ritual', 'Dark Ritual'),
                $this->card('reducer', 'Goblin Electromancer'),
            ],
            [
                'growth' => $this->spellProfile('Rampant Growth', 'land_ramp', landRamp: true, permanentRamp: true),
                'ritual' => $this->spellProfile('Dark Ritual', 'ritual', ritual: true, burst: true, oneShot: true),
                'reducer' => $this->spellProfile('Goblin Electromancer', 'cost_reducer', costReducer: true),
            ],
        );

        self::assertSame(1, $metrics['ramp']['landRamp']);
        self::assertSame(1, $metrics['ramp']['permanentRamp']);
        self::assertSame(1, $metrics['ramp']['rituals']);
        self::assertSame(1, $metrics['ramp']['burstMana']);
        self::assertSame(1, $metrics['ramp']['oneShotMana']);
        self::assertSame(1, $metrics['ramp']['costReducers']);
        self::assertSame(0, $metrics['sources']['red']);
    }

    public function testLandCycleTimingAndPressureSignals(): void
    {
        $cards = [
            $this->card('commander', 'Three Color Commander', 'commander', manaCost: '{1}{W}{U}{R}', colorIdentity: ['W', 'U', 'R']),
            $this->card('fast', 'Seachrome Coast'),
            $this->card('slow', 'Deserted Beach'),
            $this->card('pain', 'Adarkar Wastes'),
            $this->card('check', 'Glacial Fortress'),
            $this->card('filter1', 'Mystic Gate'),
            $this->card('filter2', 'Sunken Ruins'),
            $this->card('filter3', 'Graven Cairns'),
            $this->card('path1', 'Hengegate Pathway'),
            $this->card('path2', 'Riverglide Pathway'),
            $this->card('path3', 'Blightstep Pathway'),
            $this->card('path4', 'Branchloft Pathway'),
            $this->card('bounce1', 'Azorius Chancery'),
            $this->card('bounce2', 'Izzet Boilerworks'),
            $this->card('bog1', 'Colorless Utility 1'),
            $this->card('bog2', 'Colorless Utility 2'),
            $this->card('bog3', 'Colorless Utility 3'),
        ];
        $profiles = [
            'fast' => $this->landProfile('Seachrome Coast', ['W', 'U'], [], 'fastland', canEnterUntapped: true),
            'slow' => $this->landProfile('Deserted Beach', ['W', 'U'], [], 'slowland', conditional: true, canEnterUntapped: true),
            'pain' => $this->landProfile('Adarkar Wastes', ['C', 'W', 'U'], [], 'painland', canEnterUntapped: true),
            'check' => $this->landProfile('Glacial Fortress', ['W', 'U'], [], 'checkland', conditional: true, canEnterUntapped: true),
            'filter1' => $this->landProfile('Mystic Gate', ['C', 'W', 'U'], [], 'filterland', conditional: true, canEnterUntapped: true, requiresInput: true),
            'filter2' => $this->landProfile('Sunken Ruins', ['C', 'U', 'B'], [], 'filterland', conditional: true, canEnterUntapped: true, requiresInput: true),
            'filter3' => $this->landProfile('Graven Cairns', ['C', 'B', 'R'], [], 'filterland', conditional: true, canEnterUntapped: true, requiresInput: true),
            'path1' => $this->landProfile('Hengegate Pathway', ['W', 'U'], [], 'pathway', canEnterUntapped: true),
            'path2' => $this->landProfile('Riverglide Pathway', ['U', 'R'], [], 'pathway', canEnterUntapped: true),
            'path3' => $this->landProfile('Blightstep Pathway', ['B', 'R'], [], 'pathway', canEnterUntapped: true),
            'path4' => $this->landProfile('Branchloft Pathway', ['G', 'W'], [], 'pathway', canEnterUntapped: true),
            'bounce1' => $this->landProfile('Azorius Chancery', ['W', 'U'], [], 'bounce_land', entersTapped: true),
            'bounce2' => $this->landProfile('Izzet Boilerworks', ['U', 'R'], [], 'bounce_land', entersTapped: true),
            'bog1' => $this->landProfile('Colorless Utility 1', ['C'], [], 'colorless_utility_land', colorlessUtility: true, canEnterUntapped: true),
            'bog2' => $this->landProfile('Colorless Utility 2', ['C'], [], 'colorless_utility_land', colorlessUtility: true, canEnterUntapped: true),
            'bog3' => $this->landProfile('Colorless Utility 3', ['C'], [], 'colorless_utility_land', colorlessUtility: true, canEnterUntapped: true),
        ];

        $metrics = $this->analyze($cards, $profiles);

        self::assertGreaterThan(0, $metrics['earlySources']['turn1']['white']);
        self::assertGreaterThan(0, $metrics['earlySources']['turn2']['white']);
        self::assertGreaterThan($metrics['earlySources']['turn2']['white'], $metrics['earlySources']['turn3']['white']);
        self::assertGreaterThan(0, $metrics['earlySources']['turn1']['colorless']);
        self::assertSame('critical', $metrics['landCycleAnalysis']['checklandSupport']);
        self::assertSame('warning', $metrics['landCycleAnalysis']['filterlandInputPressure']);
        self::assertSame('warning', $metrics['landCycleAnalysis']['pathwayColorChoicePressure']);
        self::assertSame('warning', $metrics['landCycleAnalysis']['bounceLandTempoPressure']);
        self::assertSame('warning', $metrics['landCycleAnalysis']['colorlessUtilityPressure']);
    }

    public function testPipDemandAndCommanderCastabilityAreReported(): void
    {
        $metrics = $this->analyze(
            [
                $this->card('commander', 'Azorius Commander', 'commander', manaCost: '{2}{W}{U}', colorIdentity: ['W', 'U']),
                $this->card('spell1', 'Counterspell', manaCost: '{U}{U}', manaValue: 2, colorIdentity: ['U']),
                $this->card('spell2', 'Cryptic Command', manaCost: '{1}{U}{U}{U}', manaValue: 4, colorIdentity: ['U']),
                $this->card('plains1', 'Plains'),
                $this->card('plains2', 'Plains 2'),
                $this->card('island1', 'Island'),
                $this->card('island2', 'Island 2'),
            ],
            [
                'plains1' => $this->landProfile('Plains', ['W'], ['Plains'], 'basic', basic: true, canEnterUntapped: true),
                'plains2' => $this->landProfile('Plains 2', ['W'], ['Plains'], 'basic', basic: true, canEnterUntapped: true),
                'island1' => $this->landProfile('Island', ['U'], ['Island'], 'basic', basic: true, canEnterUntapped: true),
                'island2' => $this->landProfile('Island 2', ['U'], ['Island'], 'basic', basic: true, canEnterUntapped: true),
            ],
        );

        self::assertSame(1, $metrics['requirements']['pipDemand']['white']);
        self::assertSame(6, $metrics['requirements']['pipDemand']['blue']);
        self::assertSame(3, $metrics['requirements']['earlyPipDemand']['blue']);
        self::assertCount(2, $metrics['requirements']['doublePipCards']);
        self::assertCount(1, $metrics['requirements']['triplePipCards']);
        self::assertSame(1, $metrics['requirements']['commanderCastability']['white']['requiredPips']);
        self::assertSame('critical', $metrics['requirements']['commanderCastability']['white']['status']);
        self::assertSame(2, $metrics['requirements']['commanderCastability']['blue']['sourceCount']);
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @param array<string,array<string,mixed>> $profiles
     * @return array<string,mixed>
     */
    private function analyze(array $cards, array $profiles): array
    {
        return (new DeckManaSourceAnalyzer($this->createStub(Connection::class)))->analyzeResolvedCards($cards, $profiles);
    }

    /**
     * @param mixed $value
     */
    private function assertNoNakedCardIds(mixed $value): void
    {
        if (!is_array($value)) {
            return;
        }

        $hasCardIdentifier = false;
        foreach (['oracleId', 'cardId', 'scryfallId'] as $key) {
            $hasCardIdentifier = $hasCardIdentifier || (isset($value[$key]) && is_string($value[$key]) && $value[$key] !== '');
        }

        if ($hasCardIdentifier) {
            self::assertIsString($value['name'] ?? null);
            self::assertNotSame('', trim((string) $value['name']));
            self::assertTrue(
                (isset($value['imageUrl']) && is_string($value['imageUrl']) && $value['imageUrl'] !== '')
                || (isset($value['imageUris']) && is_array($value['imageUris']) && $value['imageUris'] !== [])
                || ($value['missingImage'] ?? false) === true,
                'Card ids in fetchland details must include image data or missingImage=true.',
            );
        }

        foreach ($value as $child) {
            $this->assertNoNakedCardIds($child);
        }
    }

    /**
     * @param list<string> $colorIdentity
     * @return array<string,mixed>
     */
    private function card(
        string $oracleId,
        string $name,
        string $section = 'main',
        string $manaCost = '',
        float $manaValue = 0.0,
        array $colorIdentity = [],
        array $overrides = [],
    ): array {
        return array_replace([
            'oracleId' => $oracleId,
            'name' => $name,
            'quantity' => 1,
            'section' => $section,
            'analysisProfile' => [
                'manaCost' => $manaCost,
                'manaValue' => $manaValue,
                'colorIdentity' => $colorIdentity,
                'types' => ['land' => $manaCost === '' && $section === 'main' && !str_contains($name, 'Commander')],
            ],
        ], $overrides);
    }

    /**
     * @param list<string> $fetchableTypes
     * @return array<string,mixed>
     */
    private function fetchProfile(string $name, array $fetchableTypes): array
    {
        return [
            ...$this->landProfile($name, [], [], 'fetchland'),
            'is_fetchland' => true,
            'is_fetchland_fixing' => true,
            'fetchable_land_types' => $fetchableTypes,
            'mana_source_category' => 'fetchland',
            'can_enter_untapped' => false,
        ];
    }

    /**
     * @param list<string> $colors
     * @param list<string> $basicTypes
     * @return array<string,mixed>
     */
    private function landProfile(
        string $name,
        array $colors,
        array $basicTypes,
        string $cycle,
        bool $basic = false,
        bool $entersTapped = false,
        bool $conditional = false,
        bool $canEnterUntapped = false,
        bool $requiresInput = false,
        bool $colorlessUtility = false,
    ): array {
        return [
            'oracle_id' => strtolower(str_replace(' ', '-', $name)),
            'name' => $name,
            'is_land' => true,
            'is_basic_land' => $basic,
            'is_nonbasic_land' => !$basic,
            'is_fetchland' => false,
            'is_typed_land' => $basicTypes !== [],
            'basic_land_types' => $basicTypes,
            'is_utility_land' => $cycle === 'utility_land',
            'is_colorless_utility_land' => $colorlessUtility || $cycle === 'colorless_utility_land',
            'is_mdfc_land' => $cycle === 'mdfc_land',
            'produced_mana_colors' => $colors,
            'produces_any_color' => false,
            'produced_mana_is_conditional' => $conditional,
            'requires_input_mana' => $requiresInput,
            'is_cost_reducer' => false,
            'is_ritual' => false,
            'is_burst_mana' => false,
            'is_permanent_ramp' => false,
            'is_land_ramp' => false,
            'is_mana_rock' => false,
            'is_mana_dork' => false,
            'is_fast_mana' => false,
            'is_one_shot_mana' => false,
            'is_treasure_related' => false,
            'enters_tapped' => $entersTapped,
            'enters_tapped_conditionally' => $conditional,
            'can_enter_untapped' => $canEnterUntapped,
            'land_cycle_type' => $cycle,
            'land_speed_profile' => $entersTapped ? 'always_tapped' : ($canEnterUntapped ? 'always_untapped' : 'unknown'),
            'mana_source_category' => $cycle === 'colorless_utility_land' ? 'colorless_utility_land' : 'land',
            'fetchable_land_types' => [],
        ];
    }

    private function spellProfile(
        string $name,
        string $category,
        bool $landRamp = false,
        bool $permanentRamp = false,
        bool $ritual = false,
        bool $burst = false,
        bool $oneShot = false,
        bool $costReducer = false,
    ): array {
        return [
            'name' => $name,
            'is_land' => false,
            'is_fetchland' => false,
            'produced_mana_colors' => [],
            'produces_any_color' => false,
            'requires_input_mana' => false,
            'mana_source_category' => $category,
            'is_land_ramp' => $landRamp,
            'is_permanent_ramp' => $permanentRamp,
            'is_ritual' => $ritual,
            'is_burst_mana' => $burst,
            'is_one_shot_mana' => $oneShot,
            'is_cost_reducer' => $costReducer,
            'is_mana_rock' => false,
            'is_mana_dork' => false,
            'is_fast_mana' => false,
            'is_treasure_related' => false,
            'produced_mana_is_conditional' => false,
            'land_cycle_type' => 'other',
            'fetchable_land_types' => [],
        ];
    }
}
