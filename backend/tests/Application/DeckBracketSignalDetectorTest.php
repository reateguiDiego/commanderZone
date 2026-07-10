<?php

namespace App\Tests\Application;

use App\Application\Deck\DeckBracketClassifier;
use App\Application\Deck\DeckBracketSignalDetector;
use PHPUnit\Framework\TestCase;

final class DeckBracketSignalDetectorTest extends TestCase
{
    public function testFetchlandsDoNotCountAsNonLandTutors(): void
    {
        $cards = [];
        for ($index = 0; $index < 10; ++$index) {
            $cards[] = $this->card('fetch-'.$index, 'Fetchland '.$index, roles: ['land', 'tutor'], subroles: ['true_tutor'], manaProfile: [
                'isLand' => true,
                'isFetchland' => true,
                'manaSourceCategory' => 'fetchland',
            ]);
        }

        $signals = $this->detect($cards);

        self::assertSame(0, $signals['nonLandTutorSignal']['count']);
        self::assertSame(0, $signals['nonLandTutorSignal']['efficientCount']);

        $bracket = (new DeckBracketClassifier())->classify($signals);
        self::assertStringNotContainsString('fetchland', mb_strtolower(json_encode($bracket['explanation'], JSON_THROW_ON_ERROR)));
        self::assertStringNotContainsString('non-land tutors were detected', mb_strtolower(json_encode($bracket['explanation'], JSON_THROW_ON_ERROR)));
    }

    public function testLandRampAndLandTutorsDoNotCountAsNonLandTutors(): void
    {
        $signals = $this->detect([
            $this->card('rampant-growth', 'Rampant Growth', roles: ['tutor', 'ramp'], subroles: ['ramp_search'], manaProfile: [
                'isLandRamp' => true,
                'isLandSearchToBattlefield' => true,
                'manaSourceCategory' => 'land_ramp',
            ]),
            $this->card('farseek', 'Farseek', roles: ['tutor', 'ramp'], subroles: ['ramp_search'], manaProfile: [
                'isLandRamp' => true,
                'isLandSearchToBattlefield' => true,
                'manaSourceCategory' => 'land_ramp',
            ]),
            $this->card('cultivate', 'Cultivate', roles: ['tutor', 'ramp'], subroles: ['ramp_search'], manaProfile: [
                'isLandRamp' => true,
                'isLandSearchToBattlefield' => true,
                'isLandSearchToHand' => true,
                'manaSourceCategory' => 'land_ramp',
            ]),
            $this->card('sylvan-scrying', 'Sylvan Scrying', roles: ['tutor'], subroles: ['land_tutor'], manaProfile: [
                'isLandTutor' => true,
                'manaSourceCategory' => 'land_tutor',
            ]),
            $this->card('demonic-tutor', 'Demonic Tutor', roles: ['tutor'], subroles: ['true_tutor']),
        ]);

        self::assertSame(1, $signals['nonLandTutorSignal']['count']);
        self::assertSame(1, $signals['nonLandTutorSignal']['efficientCount']);
        self::assertSame(['Demonic Tutor'], array_column($signals['nonLandTutorSignal']['cards'], 'name'));
    }

    public function testGameChangersUseLocalProfileFlags(): void
    {
        $signals = $this->detect([
            $this->card('gc-1', 'Known Game Changer', isGameChanger: true),
            $this->card('gc-2', 'Manual Game Changer', powerFlags: ['manual_game_changer']),
            $this->card('normal', 'Normal Card'),
        ]);

        self::assertSame(2, $signals['gameChangerSignal']['count']);
        self::assertSame(['Known Game Changer', 'Manual Game Changer'], array_column($signals['gameChangerSignal']['cards'], 'name'));
    }

    public function testCommanderIllegalCardsDoNotContributeBracketSignals(): void
    {
        $signals = $this->detect([
            $this->card('mana-crypt', 'Mana Crypt', roles: ['fast_mana'], powerFlags: ['fast_mana', 'cedh_staple', 'compact_wincon', 'manual_game_changer'], manaProfile: [
                'isFastMana' => true,
                'isPermanentRamp' => true,
                'isManaRock' => true,
            ], isGameChanger: true, commanderLegal: false, commanderBanned: true),
            $this->card('armageddon', 'Armageddon', commanderLegal: false, commanderBanned: true),
            $this->card('time-warp', 'Time Warp', roles: ['extra_turn'], commanderLegal: false, commanderBanned: true),
            $this->card('demonic-tutor', 'Demonic Tutor', roles: ['tutor'], subroles: ['true_tutor'], powerFlags: ['efficient_tutor'], commanderLegal: false, commanderBanned: true),
            $this->card('force', 'Force of Will', powerFlags: ['free_interaction'], commanderLegal: false, commanderBanned: true),
            $this->card('normal', 'Normal Card'),
        ]);

        self::assertSame(0, $signals['gameChangerSignal']['count']);
        self::assertSame(0, $signals['massLandDenialSignal']['count']);
        self::assertSame(0, $signals['extraTurnSignal']['count']);
        self::assertSame(0, $signals['nonLandTutorSignal']['count']);
        self::assertSame(0, $signals['fastManaSignal']['count']);
        self::assertSame(0, $signals['freeInteractionSignal']['count']);
        self::assertSame(0, $signals['compactWinconSignal']['count']);
        self::assertSame(0, $signals['staplesSignal']['cedhStaples']);
    }

    public function testMassLandDenialDetectsConservativeNames(): void
    {
        $signals = $this->detect([
            $this->card('armageddon', 'Armageddon'),
            $this->card('ruination', 'Ruination'),
            $this->card('winter-orb', 'Winter Orb'),
            $this->card('blood-moon', 'Blood Moon'),
            $this->card('strip-mine', 'Strip Mine', typeLine: 'Land', manaProfile: ['isLand' => true]),
        ]);

        self::assertTrue($signals['massLandDenialSignal']['detected']);
        self::assertSame(4, $signals['massLandDenialSignal']['count']);
        self::assertNotContains('Strip Mine', array_column($signals['massLandDenialSignal']['cards'], 'name'));
    }

    public function testExtraTurnsDetectCountAndRepeatableEngines(): void
    {
        $signals = $this->detect([
            $this->card('time-warp', 'Time Warp', roles: ['extra_turn']),
            $this->card('nexus', 'Nexus of Fate'),
        ]);

        self::assertSame(2, $signals['extraTurnSignal']['count']);
        self::assertTrue($signals['extraTurnSignal']['repeatableExtraTurns']);
        self::assertTrue($signals['extraTurnSignal']['chainsOrLoops']);
    }

    public function testTwoCardComboDetectsOracleConsultationBeforeTurnSix(): void
    {
        $oracle = $this->card('oracle', 'Thassa\'s Oracle', roles: ['combo_piece'], powerFlags: ['compact_wincon'], manaValue: 2);
        $consultation = $this->card('consultation', 'Demonic Consultation', roles: ['tutor', 'combo_piece'], subroles: ['true_tutor'], powerFlags: ['efficient_tutor', 'compact_wincon'], manaValue: 1);
        $signals = $this->detect([$oracle, $consultation], combos: [
            'complete' => [
                [
                    'comboVariantId' => 'combo-1',
                    'externalId' => 'oracle-consultation',
                    'requiredOracleIds' => ['oracle', 'consultation'],
                    'missingOracleIds' => [],
                    'comboSize' => 2,
                    'producesWinLike' => true,
                    'producesWin' => true,
                    'producesInfiniteMana' => false,
                    'producesInfiniteDamage' => false,
                    'producesInfiniteTokens' => false,
                    'lethalLoop' => false,
                    'requiresCommander' => false,
                    'requiresTemplate' => false,
                    'comboPowerScore' => 90,
                    'comboComplexityScore' => 1,
                    'bracketTag' => 'bracket_4',
                    'cards' => [
                        ['oracleId' => 'oracle', 'name' => 'Thassa\'s Oracle'],
                        ['oracleId' => 'consultation', 'name' => 'Demonic Consultation'],
                    ],
                ],
            ],
        ]);

        self::assertSame(1, $signals['twoCardComboSignal']['count']);
        self::assertSame(1, $signals['twoCardComboSignal']['beforeTurnSix']);
        self::assertSame(0, $signals['twoCardComboSignal']['lateGameOnly']);
    }

    public function testFastManaPremiumCountIsSeparated(): void
    {
        $signals = $this->detect([
            $this->card('sol-ring', 'Sol Ring', roles: ['fast_mana'], powerFlags: ['fast_mana'], manaProfile: [
                'isFastMana' => true,
                'isPermanentRamp' => true,
                'isManaRock' => true,
                'producedManaColors' => ['C'],
            ]),
            $this->card('mox-diamond', 'Mox Diamond', roles: ['fast_mana'], powerFlags: ['fast_mana'], manaProfile: [
                'isFastMana' => true,
                'isPermanentRamp' => true,
                'isManaRock' => true,
                'producedManaColors' => ['C'],
            ]),
            $this->card('dark-ritual', 'Dark Ritual', roles: ['fast_mana'], powerFlags: ['fast_mana'], manaProfile: [
                'isFastMana' => true,
                'isOneShotMana' => true,
                'isRitual' => true,
                'producedManaColors' => ['B'],
            ]),
        ]);

        self::assertSame(3, $signals['fastManaSignal']['count']);
        self::assertSame(2, $signals['fastManaSignal']['premiumCount']);
        self::assertSame(2, $signals['fastManaSignal']['permanentCount']);
        self::assertSame(1, $signals['fastManaSignal']['oneShotCount']);
    }

    public function testFreeInteractionDetectsPremiumCards(): void
    {
        $signals = $this->detect([
            $this->card('force', 'Force of Will', powerFlags: ['free_interaction']),
            $this->card('fierce', 'Fierce Guardianship', powerFlags: ['free_interaction']),
            $this->card('swat', 'Deflecting Swat', powerFlags: ['free_interaction']),
        ]);

        self::assertSame(3, $signals['freeInteractionSignal']['count']);
        self::assertSame(3, $signals['freeInteractionSignal']['premiumCount']);
    }

    public function testManaEfficiencyScoresOptimizedAndSlowManaBasesApart(): void
    {
        $optimized = $this->detect([
            $this->card('commander', 'Esper Commander', section: 'commander', manaCost: '{1}{W}{U}{B}', manaValue: 4),
            $this->card('chrome-mox', 'Chrome Mox', roles: ['fast_mana'], powerFlags: ['fast_mana'], manaProfile: ['isFastMana' => true, 'isManaRock' => true, 'producedManaColors' => ['C']]),
        ], mana: [
            'lands' => ['total' => 30, 'untappedLands' => 28, 'tappedLands' => 1, 'conditionallyTappedLands' => 1],
            'earlySources' => ['turn2' => ['white' => 12, 'blue' => 12, 'black' => 12]],
            'requirements' => [
                'earlyPipDemand' => ['white' => 2, 'blue' => 2, 'black' => 2],
                'commanderCastability' => [
                    'white' => ['status' => 'good'],
                    'blue' => ['status' => 'good'],
                    'black' => ['status' => 'good'],
                ],
            ],
            'ramp' => ['permanentRamp' => 10],
            'fixing' => ['landRampFixing' => 2, 'artifactFixing' => 5, 'creatureFixing' => 1, 'rainbowSources' => 8],
            'fetchlands' => ['count' => 9, 'deadFetchlands' => 0],
            'landCycleAnalysis' => ['fetchSynergyScore' => 'good', 'colorlessUtilityPressure' => 'good'],
        ]);

        $slow = $this->detect([
            $this->card('commander', 'Slow Commander', section: 'commander', manaCost: '{3}{W}{U}{B}', manaValue: 6),
            $this->card('expensive', 'Seven Drop', manaCost: '{7}', manaValue: 7),
        ], mana: [
            'lands' => ['total' => 36, 'untappedLands' => 8, 'tappedLands' => 22, 'conditionallyTappedLands' => 4],
            'earlySources' => ['turn2' => ['white' => 2, 'blue' => 1, 'black' => 1]],
            'requirements' => [
                'earlyPipDemand' => ['white' => 3, 'blue' => 3, 'black' => 3],
                'commanderCastability' => [
                    'white' => ['status' => 'critical'],
                    'blue' => ['status' => 'critical'],
                    'black' => ['status' => 'critical'],
                ],
            ],
            'ramp' => ['permanentRamp' => 1],
            'fixing' => ['landRampFixing' => 0, 'artifactFixing' => 0, 'creatureFixing' => 0, 'rainbowSources' => 0],
            'fetchlands' => ['count' => 4, 'deadFetchlands' => 3],
            'landCycleAnalysis' => [
                'fetchSynergyScore' => 'critical',
                'colorlessUtilityPressure' => 'warning',
                'bounceLandTempoPressure' => 'warning',
            ],
        ]);

        self::assertGreaterThan(70, $optimized['manaEfficiencySignal']['score']);
        self::assertLessThan(35, $slow['manaEfficiencySignal']['score']);
        self::assertGreaterThan($slow['manaEfficiencySignal']['score'], $optimized['manaEfficiencySignal']['score']);
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @param array<string,mixed> $combos
     * @param array<string,mixed> $mana
     * @return array<string,mixed>
     */
    private function detect(array $cards, array $combos = [], array $mana = []): array
    {
        $comboSummary = array_replace([
            'completeCount' => 0,
            'partialOneMissingCount' => 0,
            'partialTwoMissingCount' => 0,
            'winLikeCount' => 0,
            'infiniteManaCount' => 0,
            'infiniteDamageCount' => 0,
            'infiniteTokensCount' => 0,
            'lethalLoopCount' => 0,
            'commanderRequiredCount' => 0,
            'templateRequiredCount' => 0,
            'complete' => [],
            'partialOneMissing' => [],
            'partialTwoMissing' => [],
        ], $combos);

        return (new DeckBracketSignalDetector())->detect($cards, [], $comboSummary, $mana, []);
    }

    /**
     * @param list<string> $roles
     * @param list<string> $subroles
     * @param list<string> $powerFlags
     * @param array<string,mixed> $manaProfile
     * @return array<string,mixed>
     */
    private function card(
        string $oracleId,
        string $name,
        array $roles = [],
        array $subroles = [],
        array $powerFlags = [],
        array $manaProfile = [],
        bool $isGameChanger = false,
        string $typeLine = 'Instant',
        string $section = 'main',
        string $manaCost = '{1}',
        float $manaValue = 1.0,
        bool $commanderLegal = true,
        bool $commanderBanned = false,
    ): array {
        return [
            'deckCardId' => $oracleId.'-deck',
            'cardId' => $oracleId.'-card',
            'scryfallId' => $oracleId.'-scryfall',
            'oracleId' => $oracleId,
            'name' => $name,
            'imageUrl' => null,
            'imageUris' => [],
            'cardFaces' => [],
            'quantity' => 1,
            'section' => $section,
            'analysisProfile' => [
                'name' => $name,
                'manaCost' => $manaCost,
                'manaValue' => $manaValue,
                'typeLine' => $typeLine,
                'roles' => $roles,
                'subroles' => $subroles,
                'powerFlags' => $powerFlags,
                'conditionKeys' => [],
                'roleScores' => [
                    'tutor' => ['quality' => in_array('efficient_tutor', $powerFlags, true) ? 'premium' : 'medium'],
                ],
                'flags' => [
                    'fastMana' => in_array('fast_mana', $powerFlags, true),
                    'freeInteraction' => in_array('free_interaction', $powerFlags, true),
                    'efficientTutor' => in_array('efficient_tutor', $powerFlags, true),
                    'cedhStaple' => in_array('cedh_staple', $powerFlags, true),
                ],
                'types' => [
                    'land' => str_contains(mb_strtolower($typeLine), 'land'),
                    'artifact' => str_contains(mb_strtolower($typeLine), 'artifact'),
                    'instant' => str_contains(mb_strtolower($typeLine), 'instant'),
                    'sorcery' => str_contains(mb_strtolower($typeLine), 'sorcery'),
                ],
                'isGameChanger' => $isGameChanger,
                'commanderLegal' => $commanderLegal,
                'commanderBanned' => $commanderBanned,
            ],
            'manaProfile' => $manaProfile,
        ];
    }
}
