<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;

final class CardManaProfileRebuilder
{
    private const BASIC_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
    private const MANA_COLORS = ['W', 'U', 'B', 'R', 'G'];

    /**
     * @var array<string,array{type:string,family:?string,speed:string,fixing:string,risks:list<string>,synergies:list<string>}>
     */
    private const NAMED_LAND_CYCLES = [
        'badlands' => ['type' => 'original_dual', 'family' => 'Original dual', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => [], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'bayou' => ['type' => 'original_dual', 'family' => 'Original dual', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => [], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'plateau' => ['type' => 'original_dual', 'family' => 'Original dual', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => [], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'savannah' => ['type' => 'original_dual', 'family' => 'Original dual', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => [], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'scrubland' => ['type' => 'original_dual', 'family' => 'Original dual', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => [], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'taiga' => ['type' => 'original_dual', 'family' => 'Original dual', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => [], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'tropical island' => ['type' => 'original_dual', 'family' => 'Original dual', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => [], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'tundra' => ['type' => 'original_dual', 'family' => 'Original dual', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => [], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'underground sea' => ['type' => 'original_dual', 'family' => 'Original dual', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => [], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'volcanic island' => ['type' => 'original_dual', 'family' => 'Original dual', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => [], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'blood crypt' => ['type' => 'shockland', 'family' => 'Ravnica shock', 'speed' => 'untapped_with_life_payment', 'fixing' => 'dual_color', 'risks' => ['life_payment'], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'breeding pool' => ['type' => 'shockland', 'family' => 'Ravnica shock', 'speed' => 'untapped_with_life_payment', 'fixing' => 'dual_color', 'risks' => ['life_payment'], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'godless shrine' => ['type' => 'shockland', 'family' => 'Ravnica shock', 'speed' => 'untapped_with_life_payment', 'fixing' => 'dual_color', 'risks' => ['life_payment'], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'hallowed fountain' => ['type' => 'shockland', 'family' => 'Ravnica shock', 'speed' => 'untapped_with_life_payment', 'fixing' => 'dual_color', 'risks' => ['life_payment'], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'overgrown tomb' => ['type' => 'shockland', 'family' => 'Ravnica shock', 'speed' => 'untapped_with_life_payment', 'fixing' => 'dual_color', 'risks' => ['life_payment'], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'sacred foundry' => ['type' => 'shockland', 'family' => 'Ravnica shock', 'speed' => 'untapped_with_life_payment', 'fixing' => 'dual_color', 'risks' => ['life_payment'], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'steam vents' => ['type' => 'shockland', 'family' => 'Ravnica shock', 'speed' => 'untapped_with_life_payment', 'fixing' => 'dual_color', 'risks' => ['life_payment'], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'stomping ground' => ['type' => 'shockland', 'family' => 'Ravnica shock', 'speed' => 'untapped_with_life_payment', 'fixing' => 'dual_color', 'risks' => ['life_payment'], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'temple garden' => ['type' => 'shockland', 'family' => 'Ravnica shock', 'speed' => 'untapped_with_life_payment', 'fixing' => 'dual_color', 'risks' => ['life_payment'], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'watery grave' => ['type' => 'shockland', 'family' => 'Ravnica shock', 'speed' => 'untapped_with_life_payment', 'fixing' => 'dual_color', 'risks' => ['life_payment'], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'seachrome coast' => ['type' => 'fastland', 'family' => 'Scars fastland', 'speed' => 'untapped_early', 'fixing' => 'dual_color', 'risks' => ['tapped_late'], 'synergies' => []],
        'darkslick shores' => ['type' => 'fastland', 'family' => 'Scars fastland', 'speed' => 'untapped_early', 'fixing' => 'dual_color', 'risks' => ['tapped_late'], 'synergies' => []],
        'blackcleave cliffs' => ['type' => 'fastland', 'family' => 'Scars fastland', 'speed' => 'untapped_early', 'fixing' => 'dual_color', 'risks' => ['tapped_late'], 'synergies' => []],
        'deserted beach' => ['type' => 'slowland', 'family' => 'Innistrad slowland', 'speed' => 'untapped_late', 'fixing' => 'dual_color', 'risks' => ['tapped_early'], 'synergies' => []],
        'shipwreck marsh' => ['type' => 'slowland', 'family' => 'Innistrad slowland', 'speed' => 'untapped_late', 'fixing' => 'dual_color', 'risks' => ['tapped_early'], 'synergies' => []],
        'deathcap glade' => ['type' => 'slowland', 'family' => 'Innistrad slowland', 'speed' => 'untapped_late', 'fixing' => 'dual_color', 'risks' => ['tapped_early'], 'synergies' => []],
        'adarkar wastes' => ['type' => 'painland', 'family' => 'Apocalypse painland', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => ['pain_for_colored'], 'synergies' => []],
        'underground river' => ['type' => 'painland', 'family' => 'Apocalypse painland', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => ['pain_for_colored'], 'synergies' => []],
        'yavimaya coast' => ['type' => 'painland', 'family' => 'Apocalypse painland', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => ['pain_for_colored'], 'synergies' => []],
        'glacial fortress' => ['type' => 'checkland', 'family' => 'Checkland', 'speed' => 'conditional_untapped', 'fixing' => 'dual_color', 'risks' => ['requires_basic_types'], 'synergies' => []],
        'drowned catacomb' => ['type' => 'checkland', 'family' => 'Checkland', 'speed' => 'conditional_untapped', 'fixing' => 'dual_color', 'risks' => ['requires_basic_types'], 'synergies' => []],
        'rootbound crag' => ['type' => 'checkland', 'family' => 'Checkland', 'speed' => 'conditional_untapped', 'fixing' => 'dual_color', 'risks' => ['requires_basic_types'], 'synergies' => []],
        'mystic gate' => ['type' => 'filterland', 'family' => 'Lorwyn filterland', 'speed' => 'conditional_untapped', 'fixing' => 'filter', 'risks' => ['requires_existing_source'], 'synergies' => []],
        'sunken ruins' => ['type' => 'filterland', 'family' => 'Lorwyn filterland', 'speed' => 'conditional_untapped', 'fixing' => 'filter', 'risks' => ['requires_existing_source'], 'synergies' => []],
        'graven cairns' => ['type' => 'filterland', 'family' => 'Future Sight filterland', 'speed' => 'conditional_untapped', 'fixing' => 'filter', 'risks' => ['requires_existing_source'], 'synergies' => []],
        'prairie stream' => ['type' => 'battle_land', 'family' => 'Battle for Zendikar battle land', 'speed' => 'conditional_untapped', 'fixing' => 'dual_color', 'risks' => ['requires_basic_count'], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'sunken hollow' => ['type' => 'battle_land', 'family' => 'Battle for Zendikar battle land', 'speed' => 'conditional_untapped', 'fixing' => 'dual_color', 'risks' => ['requires_basic_count'], 'synergies' => ['fetchable', 'enables_checklands', 'enables_domain']],
        'sea of clouds' => ['type' => 'bond_land', 'family' => 'Battlebond bond land', 'speed' => 'conditional_untapped', 'fixing' => 'dual_color', 'risks' => ['requires_multiple_opponents'], 'synergies' => []],
        'morphic pool' => ['type' => 'bond_land', 'family' => 'Battlebond bond land', 'speed' => 'conditional_untapped', 'fixing' => 'dual_color', 'risks' => ['requires_multiple_opponents'], 'synergies' => []],
        'luxury suite' => ['type' => 'bond_land', 'family' => 'Battlebond bond land', 'speed' => 'conditional_untapped', 'fixing' => 'dual_color', 'risks' => ['requires_multiple_opponents'], 'synergies' => []],
        'port town' => ['type' => 'reveal_land', 'family' => 'Shadows over Innistrad reveal land', 'speed' => 'conditional_untapped', 'fixing' => 'dual_color', 'risks' => ['requires_reveal'], 'synergies' => []],
        'choked estuary' => ['type' => 'reveal_land', 'family' => 'Shadows over Innistrad reveal land', 'speed' => 'conditional_untapped', 'fixing' => 'dual_color', 'risks' => ['requires_reveal'], 'synergies' => []],
        'game trail' => ['type' => 'reveal_land', 'family' => 'Shadows over Innistrad reveal land', 'speed' => 'conditional_untapped', 'fixing' => 'dual_color', 'risks' => ['requires_reveal'], 'synergies' => []],
        'horizon canopy' => ['type' => 'canopy_land', 'family' => 'Horizon canopy land', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => ['pain_for_colored', 'life_payment'], 'synergies' => ['card_draw_sacrifice']],
        'fiery islet' => ['type' => 'canopy_land', 'family' => 'Horizon canopy land', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => ['pain_for_colored', 'life_payment'], 'synergies' => ['card_draw_sacrifice']],
        'silent clearing' => ['type' => 'canopy_land', 'family' => 'Horizon canopy land', 'speed' => 'always_untapped', 'fixing' => 'dual_color', 'risks' => ['pain_for_colored', 'life_payment'], 'synergies' => ['card_draw_sacrifice']],
    ];

    /**
     * @var array<string,string>
     */
    private const FETCH_FAMILIES = [
        'flooded strand' => 'Onslaught fetch',
        'polluted delta' => 'Onslaught fetch',
        'bloodstained mire' => 'Onslaught fetch',
        'wooded foothills' => 'Onslaught fetch',
        'windswept heath' => 'Onslaught fetch',
        'marsh flats' => 'Zendikar fetch',
        'scalding tarn' => 'Zendikar fetch',
        'verdant catacombs' => 'Zendikar fetch',
        'arid mesa' => 'Zendikar fetch',
        'misty rainforest' => 'Zendikar fetch',
        'prismatic vista' => 'Modern Horizons fetch',
        'fabled passage' => 'Throne of Eldraine fetch',
        'evolving wilds' => 'Common fetch',
        'terramorphic expanse' => 'Common fetch',
    ];

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @return array{
     *     profiles:int,
     *     totalProcessed:int,
     *     inserted:int,
     *     updated:int,
     *     skipped:int,
     *     lands:int,
     *     fetchlands:int,
     *     typedLands:int,
     *     landCyclesCount:int,
     *     manaRocks:int,
     *     manaDorks:int,
     *     rituals:int,
     *     landRamp:int,
     *     landTutors:int,
     *     costReducers:int,
     *     unknownNeedsReview:int,
     *     dataVersion:string
     * }
     */
    public function rebuild(): array
    {
        return $this->connection->transactional(function (): array {
            $stats = [
                'profiles' => 0,
                'totalProcessed' => 0,
                'inserted' => 0,
                'updated' => 0,
                'skipped' => 0,
                'lands' => 0,
                'fetchlands' => 0,
                'typedLands' => 0,
                'landCyclesCount' => 0,
                'manaRocks' => 0,
                'manaDorks' => 0,
                'rituals' => 0,
                'landRamp' => 0,
                'landTutors' => 0,
                'costReducers' => 0,
                'unknownNeedsReview' => 0,
                'dataVersion' => '',
            ];
            $landCycles = [];
            $hash = hash_init('sha256');

            foreach ($this->profileRows() as $row) {
                ++$stats['totalProcessed'];
                $oracleId = trim((string) ($row['oracle_id'] ?? ''));
                if ($oracleId === '') {
                    ++$stats['skipped'];
                    continue;
                }

                $exists = $this->profileExists($oracleId);
                $profile = $this->manaProfile($this->normalizeProfile($row));
                $this->upsertProfile($profile);
                hash_update($hash, json_encode($profile, JSON_THROW_ON_ERROR));

                ++$stats['profiles'];
                if ($exists) {
                    ++$stats['updated'];
                } else {
                    ++$stats['inserted'];
                }

                $this->collectStats($stats, $landCycles, $profile);
            }

            $stats['landCyclesCount'] = count($landCycles);
            $stats['dataVersion'] = 'sha256:'.hash_final($hash);
            (new DeckAnalysisDataVersionProvider($this->connection))->setManaVersion($stats['dataVersion']);

            return $stats;
        });
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    private function profileRows(): iterable
    {
        return $this->connection->executeQuery(
            <<<'SQL'
SELECT
    oracle_id,
    name,
    normalized_name,
    mana_value,
    type_line,
    oracle_text,
    produced_mana,
    is_land,
    is_creature,
    is_artifact,
    is_enchantment,
    is_instant,
    is_sorcery,
    is_legendary
FROM card_oracle_profile
ORDER BY oracle_id ASC
SQL,
        )->iterateAssociative();
    }

    /**
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function normalizeProfile(array $row): array
    {
        $oracleText = $this->stringOrNull($row['oracle_text'] ?? null);

        return [
            'oracle_id' => (string) $row['oracle_id'],
            'name' => (string) $row['name'],
            'normalized_name' => (string) $row['normalized_name'],
            'mana_value' => is_numeric($row['mana_value'] ?? null) ? (float) $row['mana_value'] : null,
            'type_line' => $this->stringOrNull($row['type_line'] ?? null),
            'oracle_text' => $oracleText,
            'text' => mb_strtolower($oracleText ?? ''),
            'produced_mana' => $this->jsonArray($row['produced_mana'] ?? []),
            'is_land' => $this->boolValue($row['is_land'] ?? false),
            'is_creature' => $this->boolValue($row['is_creature'] ?? false),
            'is_artifact' => $this->boolValue($row['is_artifact'] ?? false),
            'is_enchantment' => $this->boolValue($row['is_enchantment'] ?? false),
            'is_instant' => $this->boolValue($row['is_instant'] ?? false),
            'is_sorcery' => $this->boolValue($row['is_sorcery'] ?? false),
            'is_legendary' => $this->boolValue($row['is_legendary'] ?? false),
        ];
    }

    /**
     * @param array<string,mixed> $profile
     * @return array<string,mixed>
     */
    private function manaProfile(array $profile): array
    {
        $typeLine = mb_strtolower((string) ($profile['type_line'] ?? ''));
        $text = $profile['text'];
        $name = $profile['normalized_name'];
        $isLand = $profile['is_land'] || str_contains($typeLine, 'land');
        $isMdfcLand = str_contains($typeLine, '//') && str_contains($typeLine, 'land');
        $basicLandTypes = $this->basicLandTypes($profile);
        $producedMana = $this->producedManaColors($profile['produced_mana']);
        $fetchableLandTypes = $this->fetchableLandTypes($profile);
        $isFetchland = $isLand && $this->isFetchland($profile, $fetchableLandTypes);
        $isLandSearchToBattlefield = !$isFetchland && $this->isLandSearchToBattlefield($profile);
        $isLandSearchToHand = !$isFetchland && $this->isLandSearchToHand($profile);
        $isLandTutor = !$isFetchland && !$isLandSearchToBattlefield && $this->isLandTutor($profile);
        $isOneShotMana = $this->isOneShotMana($profile);
        $isCostReducer = $this->isCostReducer($profile);
        $cycle = $this->landCycle($profile, $isLand, $isMdfcLand, $isFetchland, $basicLandTypes, $producedMana);
        $risks = $cycle['risks'];
        $synergies = $cycle['synergies'];

        $requiresLifePayment = str_contains($text, 'pay 1 life') || str_contains($text, 'pay 2 life') || str_contains($text, 'you lose 1 life');
        $requiresSacrifice = str_contains($text, 'sacrifice');
        $requiresInputMana = $this->requiresInputMana($profile, $cycle['type']);
        $requiresOpponentMana = str_contains($text, 'opponent') && (str_contains($text, 'could produce') || str_contains($text, 'opponents'));
        $requiresExistingSource = $requiresInputMana || in_array($cycle['type'], ['filterland'], true);
        $isManaRock = !$isLand && $profile['is_artifact'] && $producedMana !== [] && !$isOneShotMana;
        $isManaDork = !$isLand && $profile['is_creature'] && $producedMana !== [] && !$isOneShotMana;
        $isRitual = $this->isRitual($profile);
        $isBurstMana = $isOneShotMana || $isRitual;
        $isLandRamp = $isLandSearchToBattlefield && !$isLand;
        $isFastMana = $this->isFastMana($profile);
        $isColorFixing = count(array_intersect($producedMana, self::MANA_COLORS)) > 1
            || $cycle['fixing'] !== 'mono_color'
            && !in_array($cycle['fixing'], ['colorless', 'unknown'], true)
            || $isFetchland;
        $category = $this->manaSourceCategory($profile, $isLand, $isFetchland, $isManaRock, $isManaDork, $isRitual, $isLandRamp, $isLandTutor, $isLandSearchToBattlefield, $isCostReducer, $cycle['type']);

        if ($requiresLifePayment) {
            $risks['life_payment'] = true;
        }
        if ($requiresOpponentMana) {
            $risks['requires_opponent_colors'] = true;
        }
        if ($requiresExistingSource) {
            $risks['requires_existing_source'] = true;
        }
        if ($isFetchland) {
            $risks['no_mana_ability'] = true;
            $synergies['enables_landfall'] = true;
            $synergies['enables_graveyard_land_synergy'] = true;
        }
        if ($basicLandTypes !== []) {
            $synergies['fetchable'] = true;
            $synergies['enables_checklands'] = true;
            $synergies['enables_domain'] = true;
        }

        $entersTapped = $cycle['speed'] === 'always_tapped' || preg_match('/enters? (the battlefield )?tapped\b/', $text) === 1 && !str_contains($text, 'unless') && !str_contains($text, 'you may pay');
        $entersTappedConditionally = str_starts_with($cycle['speed'], 'conditional_') || in_array($cycle['speed'], ['untapped_early', 'untapped_late', 'untapped_with_life_payment'], true);
        $canEnterUntapped = in_array($cycle['speed'], ['always_untapped', 'optional_tapped', 'untapped_with_life_payment', 'untapped_early', 'untapped_late', 'conditional_untapped'], true);
        $classificationStatus = $this->classificationStatus($profile, $category, $isLand, $producedMana);
        $needsManualReview = $classificationStatus === 'unknown';

        return [
            'oracle_id' => $profile['oracle_id'],
            'name' => $profile['name'],
            'type_line' => $profile['type_line'],
            'oracle_text' => $profile['oracle_text'],
            'is_land' => $isLand,
            'is_mdfc_land' => $isMdfcLand,
            'is_basic_land' => $this->isBasicLand($profile, $basicLandTypes),
            'is_nonbasic_land' => $isLand && !$this->isBasicLand($profile, $basicLandTypes),
            'is_fetchland' => $isFetchland,
            'is_typed_land' => $basicLandTypes !== [],
            'basic_land_types' => $basicLandTypes,
            'is_utility_land' => $isLand && $category === 'utility_land',
            'is_colorless_utility_land' => $isLand && $category === 'colorless_utility_land',
            'is_legendary_land' => $isLand && $profile['is_legendary'],
            'produced_mana_colors' => $producedMana,
            'produces_colorless' => in_array('C', $producedMana, true),
            'produces_any_color' => $this->producesAnyColor($profile, $producedMana),
            'produces_commander_identity' => $isLand || $producedMana !== [],
            'produced_mana_is_conditional' => $this->producedManaIsConditional($profile, $cycle['type']),
            'produced_mana_condition_type' => $this->producedManaConditionType($profile, $cycle['type']),
            'requires_input_mana' => $requiresInputMana,
            'requires_tap' => $isLand || str_contains($text, '{t}'),
            'requires_life_payment' => $requiresLifePayment,
            'requires_sacrifice' => $requiresSacrifice,
            'requires_creature_type_choice' => str_contains($text, 'choose a creature type'),
            'requires_opponent_mana' => $requiresOpponentMana,
            'requires_existing_source' => $requiresExistingSource,
            'is_repeatable_mana' => ($isLand || $isManaRock || $isManaDork) && !$isOneShotMana,
            'is_one_shot_mana' => $isOneShotMana,
            'enters_tapped' => $entersTapped,
            'enters_tapped_conditionally' => $entersTappedConditionally,
            'can_enter_untapped' => $canEnterUntapped,
            'untapped_condition_type' => $cycle['untapped_condition_type'],
            'delayed_until_turn' => $cycle['speed'] === 'untapped_late' ? 3 : null,
            'usable_turn_one' => !$isFetchland && ($canEnterUntapped || !$isLand) && !$requiresInputMana,
            'usable_turn_two' => !$isFetchland && ($canEnterUntapped || !$entersTapped),
            'mana_source_category' => $category,
            'land_cycle_type' => $cycle['type'],
            'land_cycle_family' => $cycle['family'],
            'land_speed_profile' => $cycle['speed'],
            'land_fixing_profile' => $cycle['fixing'],
            'land_risk_profile' => array_keys($risks),
            'land_synergy_profile' => array_keys($synergies),
            'is_permanent_ramp' => ($isManaRock || $isManaDork || $isLandRamp) && !$isBurstMana,
            'is_fast_mana' => $isFastMana,
            'is_burst_mana' => $isBurstMana,
            'is_ritual' => $isRitual,
            'is_mana_rock' => $isManaRock,
            'is_mana_dork' => $isManaDork,
            'is_land_ramp' => $isLandRamp,
            'is_land_search_to_hand' => $isLandSearchToHand,
            'is_land_search_to_battlefield' => $isLandSearchToBattlefield,
            'is_land_tutor' => $isLandTutor,
            'is_fetchland_fixing' => $isFetchland,
            'is_color_fixing' => $isColorFixing,
            'is_cost_reducer' => $isCostReducer,
            'is_treasure_related' => str_contains($text, 'treasure'),
            'is_landfall_enabler' => $isFetchland || str_contains($text, 'landfall'),
            'is_domain_support' => $basicLandTypes !== [] || $cycle['fixing'] === 'fetch_based',
            'is_graveyard_land_synergy' => $isFetchland || str_contains($text, 'land card from your graveyard'),
            'fetchable_land_types' => $fetchableLandTypes,
            'can_fetch_basic' => $isFetchland && ($fetchableLandTypes === self::BASIC_TYPES || str_contains($text, 'basic land')),
            'can_fetch_typed_nonbasic' => $isFetchland && $fetchableLandTypes !== [] && !str_contains($text, 'basic land'),
            'fetch_puts_onto_battlefield' => $isFetchland && str_contains($text, 'onto the battlefield'),
            'fetch_requires_sacrifice' => $isFetchland && $requiresSacrifice,
            'fetch_life_payment' => $isFetchland && $requiresLifePayment,
            'fetch_timing' => $isFetchland ? ($isLand ? 'instant_speed' : 'sorcery_speed') : null,
            'fetch_enters_untapped_itself' => false,
            'classification_status' => $classificationStatus,
            'needs_manual_review' => $needsManualReview,
        ];
    }

    /**
     * @param array<string,mixed> $profile
     * @return list<string>
     */
    private function basicLandTypes(array $profile): array
    {
        $types = [];
        $typeLine = (string) ($profile['type_line'] ?? '');
        foreach (self::BASIC_TYPES as $type) {
            if (preg_match('/\b'.preg_quote($type, '/').'\b/i', $typeLine) === 1) {
                $types[$type] = true;
            }
        }

        return array_keys($types);
    }

    /**
     * @param list<mixed> $producedMana
     * @return list<string>
     */
    private function producedManaColors(array $producedMana): array
    {
        $colors = [];
        foreach ($producedMana as $color) {
            if (!is_scalar($color)) {
                continue;
            }
            $normalized = mb_strtoupper(trim((string) $color));
            if (in_array($normalized, ['W', 'U', 'B', 'R', 'G', 'C'], true)) {
                $colors[$normalized] = true;
            }
        }

        return array_keys($colors);
    }

    /**
     * @param array<string,mixed> $profile
     * @return list<string>
     */
    private function fetchableLandTypes(array $profile): array
    {
        $text = $profile['text'];
        if (preg_match('/search your library for (a |an |up to one |up to two |any number of )?basic land cards?/', $text) === 1) {
            return self::BASIC_TYPES;
        }

        $types = [];
        foreach (self::BASIC_TYPES as $type) {
            if (preg_match('/\b'.preg_quote(mb_strtolower($type), '/').'\b/', $text) === 1) {
                $types[$type] = true;
            }
        }

        return array_keys($types);
    }

    /**
     * @param array<string,mixed> $profile
     * @param list<string> $fetchableLandTypes
     */
    private function isFetchland(array $profile, array $fetchableLandTypes): bool
    {
        if (isset(self::FETCH_FAMILIES[$profile['normalized_name']])) {
            return true;
        }

        return $fetchableLandTypes !== []
            && str_contains($profile['text'], 'search your library')
            && str_contains($profile['text'], 'onto the battlefield')
            && str_contains($profile['text'], 'sacrifice');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isLandSearchToBattlefield(array $profile): bool
    {
        return str_contains($profile['text'], 'search your library')
            && $this->searchesLand($profile)
            && (str_contains($profile['text'], 'onto the battlefield') || str_contains($profile['text'], 'onto the battlefield tapped'));
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isLandSearchToHand(array $profile): bool
    {
        return str_contains($profile['text'], 'search your library')
            && $this->searchesLand($profile)
            && (str_contains($profile['text'], 'put it into your hand') || str_contains($profile['text'], 'put that card into your hand') || str_contains($profile['text'], 'put them into your hand'));
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isLandTutor(array $profile): bool
    {
        return str_contains($profile['text'], 'search your library') && $this->searchesLand($profile);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function searchesLand(array $profile): bool
    {
        return preg_match('/search your library for (a |an |up to one |up to two |any number of )?(basic land|basic [a-z ]*land|land|plains|island|swamp|mountain|forest|desert|gate|locus|cave) cards?/', $profile['text']) === 1;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isOneShotMana(array $profile): bool
    {
        if (in_array($profile['normalized_name'], [
            'black lotus',
            'lion\'s eye diamond',
            'lotus petal',
            'turnabout',
            'high tide',
            'culling the weak',
            'dark ritual',
            'cabal ritual',
            'seething song',
            'rite of flame',
            'pyretic ritual',
            'desperate ritual',
            'mana geyser',
            'jeska\'s will',
        ], true)) {
            return true;
        }

        return ($profile['is_instant'] || $profile['is_sorcery'])
            && ($profile['produced_mana'] !== [] || preg_match('/\badd(s)?\b.*\bmana\b/', $profile['text']) === 1)
            || preg_match('/\bsacrifice this (artifact|creature|land): add\b/', $profile['text']) === 1;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isRitual(array $profile): bool
    {
        return $this->isOneShotMana($profile)
            && ($profile['is_instant'] || $profile['is_sorcery'] || str_contains($profile['text'], 'sacrifice this'));
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isCostReducer(array $profile): bool
    {
        return preg_match('/costs?\b[^.]*\bless/', $profile['text']) === 1
            || in_array($profile['normalized_name'], [
                'goblin electromancer',
                'foundry inspector',
                'urza\'s incubator',
                'cloud key',
                'ruby medallion',
                'jet medallion',
            ], true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isFastMana(array $profile): bool
    {
        return in_array($profile['normalized_name'], [
            'sol ring',
            'mana crypt',
            'mox diamond',
            'chrome mox',
            'mox opal',
            'lotus petal',
            'lion\'s eye diamond',
            'black lotus',
        ], true);
    }

    /**
     * @param array<string,mixed> $profile
     * @param list<string> $basicLandTypes
     */
    private function isBasicLand(array $profile, array $basicLandTypes): bool
    {
        return $profile['is_land']
            && (
                str_contains(mb_strtolower((string) ($profile['type_line'] ?? '')), 'basic land')
                || in_array($profile['normalized_name'], ['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes'], true)
            )
            && (count($basicLandTypes) <= 1 || $profile['normalized_name'] === 'wastes');
    }

    /**
     * @param array<string,mixed> $profile
     * @param list<string> $producedMana
     */
    private function producesAnyColor(array $profile, array $producedMana): bool
    {
        return count(array_intersect($producedMana, self::MANA_COLORS)) >= 5
            || str_contains($profile['text'], 'mana of any color')
            || str_contains($profile['text'], 'one mana of any color');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function producedManaIsConditional(array $profile, string $cycleType): bool
    {
        return in_array($cycleType, ['checkland', 'filterland', 'battle_land', 'bond_land', 'reveal_land', 'slowland', 'fastland', 'tainted_land', 'storage_land'], true)
            || str_contains($profile['text'], 'only if')
            || str_contains($profile['text'], 'spend this mana only')
            || str_contains($profile['text'], 'mana of any color that a land an opponent controls could produce');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function producedManaConditionType(array $profile, string $cycleType): ?string
    {
        if ($cycleType === 'filterland') {
            return 'requires_input_mana';
        }
        if ($cycleType === 'checkland') {
            return 'requires_basic_types';
        }
        if ($cycleType === 'battle_land') {
            return 'requires_basic_count';
        }
        if ($cycleType === 'bond_land') {
            return 'requires_multiple_opponents';
        }
        if ($cycleType === 'reveal_land') {
            return 'requires_reveal';
        }
        if (str_contains($profile['text'], 'opponent')) {
            return 'requires_opponent_colors';
        }

        return null;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function requiresInputMana(array $profile, string $cycleType): bool
    {
        return $cycleType === 'filterland'
            || preg_match('/\{[wubrgc]\}.*add/i', $profile['text']) === 1
            || str_contains($profile['text'], 'filter');
    }

    /**
     * @param array<string,mixed> $profile
     * @param list<string> $basicLandTypes
     * @param list<string> $producedMana
     * @return array{type:string,family:?string,speed:string,fixing:string,risks:array<string,true>,synergies:array<string,true>,untapped_condition_type:?string}
     */
    private function landCycle(array $profile, bool $isLand, bool $isMdfcLand, bool $isFetchland, array $basicLandTypes, array $producedMana): array
    {
        $name = $profile['normalized_name'];
        $typeLine = mb_strtolower((string) ($profile['type_line'] ?? ''));
        $text = $profile['text'];
        $risks = [];
        $synergies = [];
        $type = 'other';
        $family = null;
        $speed = 'unknown';
        $fixing = 'unknown';
        $untappedCondition = null;

        if (!$isLand) {
            return compact('type', 'family', 'speed', 'fixing', 'risks', 'synergies') + ['untapped_condition_type' => null];
        }

        if ($this->isBasicLand($profile, $basicLandTypes)) {
            $type = 'basic';
            $family = 'Basic land';
            $speed = 'always_untapped';
            $fixing = $name === 'wastes' ? 'colorless' : 'mono_color';
        } elseif ($isFetchland) {
            $type = 'fetchland';
            $family = self::FETCH_FAMILIES[$name] ?? 'Fetchland';
            $speed = 'depends_on_target';
            $fixing = 'fetch_based';
        } elseif (isset(self::NAMED_LAND_CYCLES[$name])) {
            $cycle = self::NAMED_LAND_CYCLES[$name];
            $type = $cycle['type'];
            $family = $cycle['family'];
            $speed = $cycle['speed'];
            $fixing = $cycle['fixing'];
            $risks = array_fill_keys($cycle['risks'], true);
            $synergies = array_fill_keys($cycle['synergies'], true);
        } elseif (str_contains($name, 'pathway //')) {
            $type = 'pathway';
            $speed = 'always_untapped';
            $fixing = 'modal_choice';
            $risks['modal_color_choice'] = true;
        } elseif ($isMdfcLand) {
            $type = 'mdfc_land';
            $speed = str_contains($text, 'pay 3 life') ? 'untapped_with_life_payment' : (str_contains($text, 'enters the battlefield tapped') ? 'always_tapped' : 'depends_on_target');
            $fixing = $this->fixingFromColors($producedMana);
        } elseif (str_contains($typeLine, 'artifact land')) {
            $type = 'artifact_land';
            $speed = 'always_untapped';
            $fixing = $this->fixingFromColors($producedMana);
            $synergies['enables_artifact_synergy'] = true;
        } elseif (str_contains($typeLine, 'snow land')) {
            $type = 'snow_land';
            $speed = 'always_untapped';
            $fixing = $this->fixingFromColors($producedMana);
            $synergies['enables_snow_synergy'] = true;
        } elseif (str_contains($typeLine, 'gate')) {
            $type = 'gate';
            $speed = 'always_tapped';
            $fixing = $this->fixingFromColors($producedMana);
            $risks['always_tapped'] = true;
            $synergies['enables_gate_synergy'] = true;
        } elseif (str_contains($name, 'triome') || in_array($name, ['spara\'s headquarters', 'raffine\'s tower', 'xander\'s lounge', 'ziatora\'s proving ground', 'jetmir\'s garden'], true)) {
            $type = 'triome';
            $family = str_contains($name, 'triome') ? 'Ikoria triome' : 'New Capenna triome';
            $speed = 'always_tapped';
            $fixing = 'tri_color';
            $risks['always_tapped'] = true;
            $synergies = ['fetchable' => true, 'enables_checklands' => true, 'enables_domain' => true];
            if (str_contains($text, 'cycling')) {
                $synergies['cycling_upside'] = true;
            }
        } elseif (in_array($name, ['meticulous archive', 'undercity sewers'], true) || str_contains($text, 'surveil 1')) {
            $type = 'surveil_land';
            $family = 'Murders at Karlov Manor surveil land';
            $speed = 'always_tapped';
            $fixing = 'dual_color';
            $risks['always_tapped'] = true;
            $synergies = ['fetchable' => true, 'enables_checklands' => true, 'enables_domain' => true, 'surveil_upside' => true];
        } elseif (preg_match('/^temple of /', $name) === 1) {
            $type = 'temple';
            $speed = 'always_tapped';
            $fixing = $this->fixingFromColors($producedMana);
            $risks['always_tapped'] = true;
            $synergies['scry_upside'] = true;
        } elseif (str_contains($text, 'you gain 1 life') && preg_match('/enters? (the battlefield )?tapped\b/', $text) === 1) {
            $type = 'gain_land';
            $speed = 'always_tapped';
            $fixing = $this->fixingFromColors($producedMana);
            $risks['always_tapped'] = true;
        } elseif (str_contains($text, 'return a land you control to its owner\'s hand')) {
            $type = str_contains($text, 'lair enters') ? 'lair' : 'bounce_land';
            $speed = 'always_tapped';
            $fixing = $this->fixingFromColors($producedMana);
            $risks['bounce_land_tempo_loss'] = true;
        } elseif (str_contains($text, 'cycling')) {
            $type = 'cycling_land';
            $speed = preg_match('/enters? (the battlefield )?tapped\b/', $text) === 1 ? 'always_tapped' : 'unknown';
            $fixing = $this->fixingFromColors($producedMana);
            $synergies['cycling_upside'] = true;
        } elseif (str_starts_with($name, 'vivid ')) {
            $type = 'vivid_land';
            $speed = 'always_tapped';
            $fixing = 'conditional_any_color';
            $risks = ['always_tapped' => true, 'conditional_only' => true];
        } elseif (str_starts_with($name, 'tainted ')) {
            $type = 'tainted_land';
            $speed = 'conditional_untapped';
            $fixing = 'conditional_dual';
            $risks['requires_swamp'] = true;
            $untappedCondition = 'requires_swamp';
        } elseif (str_contains($text, 'storage counter')) {
            $type = 'storage_land';
            $speed = 'delayed';
            $fixing = 'delayed';
            $risks['delayed'] = true;
        } elseif (str_contains($text, 'depletion counter')) {
            $type = 'depletion_land';
            $speed = 'conditional_untapped';
            $fixing = 'temporary';
            $risks['one_shot'] = true;
        } elseif ($profile['is_legendary'] && str_contains($text, 'channel')) {
            $type = 'channel_land';
            $speed = 'always_untapped';
            $fixing = $this->fixingFromColors($producedMana);
            $synergies['spell_channel'] = true;
        } elseif ($profile['is_legendary']) {
            $type = 'legendary_land';
            $speed = 'always_untapped';
            $fixing = $this->fixingFromColors($producedMana);
            $risks['legendary_conflict'] = true;
        } else {
            $fixing = $this->fixingFromColors($producedMana);
            $speed = preg_match('/enters? (the battlefield )?tapped\b/', $text) === 1 ? 'always_tapped' : 'unknown';
            $type = $fixing === 'colorless' ? 'colorless_utility_land' : 'utility_land';
            if ($fixing === 'colorless') {
                $risks['colorless_pressure'] = true;
            }
        }

        $untappedCondition ??= match ($type) {
            'shockland' => 'life_payment',
            'fastland' => 'early_land_count',
            'slowland' => 'late_land_count',
            'checkland' => 'requires_basic_types',
            'battle_land' => 'requires_basic_count',
            'bond_land' => 'requires_multiple_opponents',
            'reveal_land' => 'requires_reveal',
            'filterland' => 'requires_existing_source',
            default => null,
        };

        return [
            'type' => $type,
            'family' => $family,
            'speed' => $speed,
            'fixing' => $fixing,
            'risks' => $risks,
            'synergies' => $synergies,
            'untapped_condition_type' => $untappedCondition,
        ];
    }

    /**
     * @param list<string> $producedMana
     */
    private function fixingFromColors(array $producedMana): string
    {
        $colored = array_values(array_intersect($producedMana, self::MANA_COLORS));
        if ($colored === [] && in_array('C', $producedMana, true)) {
            return 'colorless';
        }

        return match (count($colored)) {
            0 => 'unknown',
            1 => 'mono_color',
            2 => 'dual_color',
            3 => 'tri_color',
            5 => 'five_color',
            default => 'unknown',
        };
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function manaSourceCategory(array $profile, bool $isLand, bool $isFetchland, bool $isManaRock, bool $isManaDork, bool $isRitual, bool $isLandRamp, bool $isLandTutor, bool $isLandSearchToBattlefield, bool $isCostReducer, string $landCycleType): string
    {
        if ($isFetchland) {
            return 'fetchland';
        }
        if ($isLand) {
            return match ($landCycleType) {
                'shockland', 'original_dual', 'battle_land', 'checkland', 'fastland', 'slowland', 'painland', 'filterland', 'bond_land', 'reveal_land', 'canopy_land' => 'dual_land',
                'triome', 'lair' => 'triome',
                'colorless_utility_land' => 'colorless_utility_land',
                default => str_contains($landCycleType, 'utility') ? 'utility_land' : 'land',
            };
        }
        if ($isManaRock) {
            return 'mana_rock';
        }
        if ($isManaDork) {
            return 'mana_dork';
        }
        if ($isRitual) {
            return 'ritual';
        }
        if ($isLandRamp) {
            return 'land_ramp';
        }
        if ($isLandTutor) {
            return 'land_tutor';
        }
        if ($isLandSearchToBattlefield) {
            return 'ramp_search';
        }
        if ($isCostReducer) {
            return 'cost_reducer';
        }
        if (str_contains($profile['text'], 'treasure')) {
            return 'treasure_creator';
        }
        if (str_contains($profile['text'], 'additional land')) {
            return 'extra_land_drop';
        }
        if ($this->requiresInputMana($profile, $landCycleType)) {
            return 'mana_filter';
        }

        return 'other';
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function upsertProfile(array $profile): void
    {
        $columns = array_keys($profile);
        $jsonColumns = [
            'basic_land_types',
            'produced_mana_colors',
            'land_risk_profile',
            'land_synergy_profile',
            'fetchable_land_types',
        ];
        $boolColumns = array_values(array_filter(
            $columns,
            static fn (string $column): bool => is_bool($profile[$column] ?? null),
        ));
        $params = $profile;
        foreach ($jsonColumns as $column) {
            $params[$column] = json_encode($profile[$column], JSON_THROW_ON_ERROR);
        }
        $params['updated_at'] = (new \DateTimeImmutable())->format('Y-m-d H:i:s');

        $this->connection->executeStatement(
            sprintf(
                'INSERT INTO card_mana_profile (%s, updated_at) VALUES (%s, :updated_at) ON CONFLICT (oracle_id) DO UPDATE SET %s',
                implode(', ', $columns),
                implode(', ', array_map(static fn (string $column): string => ':'.$column, $columns)),
                implode(', ', array_map(
                    static fn (string $column): string => $column.' = EXCLUDED.'.$column,
                    array_values(array_filter($columns, static fn (string $column): bool => $column !== 'oracle_id')),
                )).' , updated_at = EXCLUDED.updated_at',
            ),
            $params,
            array_fill_keys($boolColumns, ParameterType::BOOLEAN),
        );
    }

    private function profileExists(string $oracleId): bool
    {
        return $this->connection->fetchOne(
            'SELECT 1 FROM card_mana_profile WHERE oracle_id = :oracle_id',
            ['oracle_id' => $oracleId],
        ) !== false;
    }

    /**
     * @param array<string,int|string> $stats
     * @param array<string,true> $landCycles
     * @param array<string,mixed> $profile
     */
    private function collectStats(array &$stats, array &$landCycles, array $profile): void
    {
        if ($profile['is_land'] === true) {
            ++$stats['lands'];
            $cycle = (string) $profile['land_cycle_type'];
            if (!in_array($cycle, ['other', 'utility_land', 'colorless_utility_land'], true)) {
                $landCycles[$cycle] = true;
            }
        }
        if ($profile['is_fetchland'] === true) {
            ++$stats['fetchlands'];
        }
        if ($profile['is_typed_land'] === true) {
            ++$stats['typedLands'];
        }
        if ($profile['is_mana_rock'] === true) {
            ++$stats['manaRocks'];
        }
        if ($profile['is_mana_dork'] === true) {
            ++$stats['manaDorks'];
        }
        if ($profile['is_ritual'] === true) {
            ++$stats['rituals'];
        }
        if ($profile['is_land_ramp'] === true) {
            ++$stats['landRamp'];
        }
        if ($profile['is_land_tutor'] === true) {
            ++$stats['landTutors'];
        }
        if ($profile['is_cost_reducer'] === true) {
            ++$stats['costReducers'];
        }
        if ($profile['needs_manual_review'] === true) {
            ++$stats['unknownNeedsReview'];
        }
    }

    /**
     * @param array<string,mixed> $profile
     * @param list<string> $producedMana
     */
    private function classificationStatus(array $profile, string $category, bool $isLand, array $producedMana): string
    {
        if ($category !== 'other' || $isLand || $producedMana !== []) {
            return 'classified';
        }

        return $this->hasManaSignal($profile) ? 'unknown' : 'not_mana_relevant';
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function hasManaSignal(array $profile): bool
    {
        $text = $profile['text'];

        return preg_match('/\badd(s)?\b.*\bmana\b/', $text) === 1
            || str_contains($text, 'could produce')
            || str_contains($text, 'costs')
            || str_contains($text, 'search your library')
            || str_contains($text, 'treasure')
            || str_contains($text, 'additional land');
    }

    /**
     * @return list<mixed>
     */
    private function jsonArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (!is_string($value) || trim($value) === '') {
            return [];
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : [];
    }

    private function stringOrNull(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = trim((string) $value);

        return $string !== '' ? $string : null;
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
}
