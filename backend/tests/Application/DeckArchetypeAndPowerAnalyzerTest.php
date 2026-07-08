<?php

namespace App\Tests\Application;

use App\Application\Deck\CardRoleMetricsAggregator;
use App\Application\Deck\DeckArchetypeAnalyzer;
use App\Application\Deck\DeckPowerAnalyzer;
use PHPUnit\Framework\TestCase;

final class DeckArchetypeAndPowerAnalyzerTest extends TestCase
{
    public function testGoodstuffDoesNotBecomePrimaryComboFromRawComboPieces(): void
    {
        $analysis = $this->analyze([
            $this->card(8, roles: ['combo_piece']),
            $this->card(4, roles: ['draw']),
            $this->card(4, roles: ['spot_removal']),
        ]);

        self::assertNotSame('combo', $analysis['archetypes']['primary']);
        self::assertSame('mixed', $analysis['archetypes']['primary']);
    }

    public function testReanimatorDoesNotBecomeComboFromComboPiecesWhenGraveyardStructureFits(): void
    {
        $analysis = $this->analyze([
            $this->card(4, roles: ['reanimation', 'combo_piece']),
            $this->card(3, roles: ['recursion']),
            $this->card(3, roles: ['discard'], conditionKeys: ['requires_discard_outlets']),
            $this->card(3, manaValue: 7),
        ]);

        self::assertSame('reanimator', $analysis['archetypes']['primary']);
        self::assertNotSame('combo', $analysis['archetypes']['primary']);
    }

    public function testRealAristocratsBecomesPrimaryAristocrats(): void
    {
        $analysis = $this->analyze([
            $this->card(4, roles: ['sacrifice_outlet']),
            $this->card(5, subroles: ['sacrifice_payoff']),
            $this->card(7, roles: ['token_maker']),
        ]);

        self::assertSame('aristocrats', $analysis['archetypes']['primary']);
        self::assertSame('high', $analysis['archetypes']['confidence']);
    }

    public function testFakeAristocratsDoesNotBecomeStrongAristocrats(): void
    {
        $analysis = $this->analyze([
            $this->card(5, subroles: ['one_shot_sacrifice']),
            $this->card(4, subroles: ['self_sacrifice']),
            $this->card(2, subroles: ['sacrifice_payoff']),
        ]);

        self::assertNotSame('aristocrats', $analysis['archetypes']['primary']);
    }

    public function testTutorComboCanBecomePrimaryComboWhenCompleteLinesAndSupportExist(): void
    {
        $analysis = $this->analyze([
            $this->card(2, roles: ['wincon', 'combo_piece'], powerFlags: ['compact_wincon']),
            $this->card(4, roles: ['tutor'], subroles: ['true_tutor'], flags: ['efficientTutor' => true], powerFlags: ['efficient_tutor']),
            $this->card(2, roles: ['combo_piece'], powerFlags: ['mana_positive_combo_piece']),
            $this->card(3, roles: ['protection'], flags: ['freeInteraction' => true], powerFlags: ['free_interaction']),
        ], combos: [
            'completeCount' => 1,
            'winLikeCount' => 1,
            'infiniteManaCount' => 1,
            'infiniteDamageCount' => 0,
            'infiniteTokensCount' => 0,
            'partialOneMissingCount' => 2,
        ]);

        self::assertSame('combo', $analysis['archetypes']['primary']);
        self::assertContains($analysis['power']['band'], ['high_casual', 'high_power', 'cedh_like']);
    }

    public function testStaxCanBecomePrimaryStax(): void
    {
        $analysis = $this->analyze([
            $this->card(5, roles: ['stax'], conditionKeys: ['symmetrical_stax_risk']),
            $this->card(3, roles: ['tax']),
            $this->card(2, roles: ['protection']),
        ]);

        self::assertSame('stax', $analysis['archetypes']['primary']);
    }

    public function testLowOpportunityCostAloneDoesNotCreateHighPower(): void
    {
        $analysis = $this->analyze([
            $this->card(10, powerFlags: ['low_opportunity_cost']),
        ]);

        self::assertContains($analysis['power']['band'], ['precon_like', 'casual', 'upgraded']);
        self::assertSame(10, $analysis['power']['signals']['lowOpportunityCost']);
        self::assertContains('Low opportunity cost cards count as flexibility, not raw power.', $analysis['power']['notes']);
    }

    public function testFastManaTutorsAndFreeInteractionPushPowerMoreThanLowOpportunityCost(): void
    {
        $lowOnly = $this->analyze([
            $this->card(10, powerFlags: ['low_opportunity_cost']),
        ]);
        $powered = $this->analyze([
            $this->card(4, roles: ['fast_mana'], flags: ['fastMana' => true], powerFlags: ['fast_mana']),
            $this->card(4, roles: ['tutor'], subroles: ['true_tutor'], flags: ['efficientTutor' => true], powerFlags: ['efficient_tutor']),
            $this->card(3, flags: ['freeInteraction' => true], powerFlags: ['free_interaction']),
            $this->card(1, powerFlags: ['compact_wincon']),
        ]);

        self::assertSame('precon_like', $lowOnly['power']['band']);
        self::assertContains($powered['power']['band'], ['high_casual', 'high_power']);
        self::assertGreaterThan($lowOnly['power']['signals']['lowOpportunityCost'], $powered['power']['signals']['fastMana'] + $powered['power']['signals']['efficientTutors'] + $powered['power']['signals']['freeInteraction']);
    }

    public function testLandWithTutorRoleDoesNotCreateStrongTutorPowerSignal(): void
    {
        $analysis = $this->analyze([
            $this->card(4, roles: ['land', 'tutor'], subroles: ['true_tutor'], roleScores: ['tutor' => ['quality' => 'good']]),
            $this->card(1, roles: ['tutor'], subroles: ['true_tutor'], roleScores: ['tutor' => ['quality' => 'good']]),
        ]);

        self::assertSame(1, $analysis['power']['signals']['strongTutors']);
    }

    /**
     * @param list<array{quantity:int,analysisProfile:array<string,mixed>}> $cards
     * @param array<string,mixed> $combos
     * @return array{archetypes:array<string,mixed>,power:array<string,mixed>}
     */
    private function analyze(array $cards, array $combos = []): array
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
        $metrics = (new CardRoleMetricsAggregator())->aggregate($cards, []);
        $archetypeResult = (new DeckArchetypeAnalyzer())->analyze($metrics, $cards, $comboSummary);
        $power = (new DeckPowerAnalyzer())->analyze($metrics, $cards, $comboSummary);

        return [
            'archetypes' => $archetypeResult['archetypes'],
            'power' => $power,
        ];
    }

    /**
     * @param list<string> $roles
     * @param list<string> $subroles
     * @param list<string> $powerFlags
     * @param array<string,bool> $flags
     * @param list<string> $conditionKeys
     * @param array<string,float|int> $archetypeWeights
     * @param array<string,array<string,mixed>> $roleScores
     * @return array{quantity:int,analysisProfile:array<string,mixed>}
     */
    private function card(
        int $quantity,
        array $roles = [],
        array $subroles = [],
        array $powerFlags = [],
        array $flags = [],
        array $conditionKeys = [],
        array $archetypeWeights = [],
        array $roleScores = [],
        int $manaValue = 2,
        string $typeLine = 'Artifact',
    ): array {
        $id = 'test-card-'.substr(hash('sha256', serialize([$quantity, $roles, $subroles, $powerFlags, $flags, $conditionKeys, $archetypeWeights, $roleScores, $manaValue, $typeLine])), 0, 12);

        return [
            'deckCardId' => $id.'-deck',
            'cardId' => $id.'-card',
            'scryfallId' => $id.'-scryfall',
            'oracleId' => $id.'-oracle',
            'name' => $id,
            'imageUrl' => null,
            'imageUris' => [],
            'cardFaces' => [],
            'quantity' => $quantity,
            'section' => 'main',
            'analysisProfile' => [
                'roles' => $roles,
                'subroles' => $subroles,
                'roleScores' => $roleScores,
                'conditionKeys' => $conditionKeys,
                'archetypeWeights' => $archetypeWeights,
                'powerFlags' => $powerFlags,
                'flags' => [
                    'fastMana' => $flags['fastMana'] ?? false,
                    'freeInteraction' => $flags['freeInteraction'] ?? false,
                    'efficientTutor' => $flags['efficientTutor'] ?? false,
                    'cedhStaple' => $flags['cedhStaple'] ?? false,
                ],
                'types' => [
                    'land' => in_array('land', $roles, true),
                    'artifact' => str_contains(mb_strtolower($typeLine), 'artifact'),
                    'enchantment' => str_contains(mb_strtolower($typeLine), 'enchantment'),
                    'instant' => str_contains(mb_strtolower($typeLine), 'instant'),
                    'sorcery' => str_contains(mb_strtolower($typeLine), 'sorcery'),
                ],
                'typeLine' => $typeLine,
                'manaValue' => $manaValue,
                'isGameChanger' => false,
            ],
        ];
    }
}
