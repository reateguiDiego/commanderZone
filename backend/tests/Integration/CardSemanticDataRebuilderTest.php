<?php

namespace App\Tests\Integration;

use App\Application\Deck\CardSemanticDataRebuilder;
use Doctrine\DBAL\ParameterType;

final class CardSemanticDataRebuilderTest extends ApiTestCase
{
    public function testRampTagGeneratesRampRole(): void
    {
        $oracleId = '83000000-0000-0000-0000-000000000001';
        $this->insertOracleProfile($oracleId, 'Ramp Card');
        $this->insertExternalTag('83000000-0000-0000-0000-000000000011', $oracleId, 'ramp');

        $this->rebuilder()->rebuild();

        self::assertSame('scryfall_tag', $this->roleSource($oracleId, 'ramp'));
    }

    public function testBoardWipeTagGeneratesBoardWipeRole(): void
    {
        $oracleId = '83000000-0000-0000-0000-000000000002';
        $this->insertOracleProfile($oracleId, 'Sweeper Card', [
            'type_line' => 'Sorcery',
            'oracle_text' => 'Destroy all creatures.',
            'is_artifact' => false,
            'is_sorcery' => true,
        ]);
        $this->insertExternalTag('83000000-0000-0000-0000-000000000012', $oracleId, 'board-wipe');

        $this->rebuilder()->rebuild();

        self::assertSame('scryfall_tag', $this->roleSource($oracleId, 'board_wipe'));
    }

    public function testDeflectingSwatGeneratesCommanderCondition(): void
    {
        $oracleId = '83000000-0000-0000-0000-000000000003';
        $this->insertOracleProfile($oracleId, 'Deflecting Swat');

        $this->rebuilder()->rebuild();

        self::assertSame(
            'requires_commander_on_battlefield',
            $this->entityManager->getConnection()->fetchOne(
                'SELECT condition_key FROM card_condition WHERE oracle_id = :oracleId',
                ['oracleId' => $oracleId],
            ),
        );
    }

    public function testSolRingGeneratesFastManaAndPremiumQuality(): void
    {
        $oracleId = '83000000-0000-0000-0000-000000000004';
        $this->insertOracleProfile($oracleId, 'Sol Ring', [
            'mana_value' => 1,
            'type_line' => 'Artifact',
            'oracle_text' => '{T}: Add {C}{C}.',
            'produced_mana' => ['C'],
            'is_artifact' => true,
        ]);

        $this->rebuilder()->rebuild();

        self::assertSame('rule', $this->roleSource($oracleId, 'fast_mana'));
        self::assertSame(
            'premium',
            $this->entityManager->getConnection()->fetchOne(
                'SELECT quality FROM card_role_quality WHERE oracle_id = :oracleId AND role = :role',
                ['oracleId' => $oracleId, 'role' => 'fast_mana'],
            ),
        );
        self::assertSame('premium', $this->roleQualityValue($oracleId, 'ramp', 'quality'));
    }

    public function testDarkRitualGeneratesBurstManaAndRitualWithoutPermanentRamp(): void
    {
        $oracleId = '83000000-0000-0000-0000-000000000006';
        $this->insertOracleProfile($oracleId, 'Dark Ritual', [
            'mana_value' => 1,
            'type_line' => 'Instant',
            'oracle_text' => 'Add {B}{B}{B}.',
            'produced_mana' => ['B'],
            'is_artifact' => false,
            'is_instant' => true,
        ]);

        $this->rebuilder()->rebuild();

        self::assertTrue($this->hasRole($oracleId, 'burst_mana'));
        self::assertTrue($this->hasRole($oracleId, 'ritual'));
        self::assertFalse($this->hasRole($oracleId, 'ramp'));
        self::assertSame('one_shot', $this->roleQualityValue($oracleId, 'burst_mana', 'repeatability'));
    }

    public function testRampQualityDistinguishesArcaneSignetAndCommandersSphere(): void
    {
        $signetId = '83000000-0000-0000-0000-000000000007';
        $sphereId = '83000000-0000-0000-0000-000000000008';
        $this->insertOracleProfile($signetId, 'Arcane Signet', [
            'mana_value' => 2,
            'type_line' => 'Artifact',
            'oracle_text' => '{T}: Add one mana of any color in your commander\'s color identity.',
            'produced_mana' => ['W', 'U', 'B', 'R', 'G'],
        ]);
        $this->insertOracleProfile($sphereId, 'Commander\'s Sphere', [
            'mana_value' => 3,
            'type_line' => 'Artifact',
            'oracle_text' => '{T}: Add one mana of any color in your commander\'s color identity. Sacrifice Commander\'s Sphere: Draw a card.',
            'produced_mana' => ['W', 'U', 'B', 'R', 'G'],
        ]);

        $this->rebuilder()->rebuild();

        self::assertTrue($this->hasRole($signetId, 'mana_fixing'));
        self::assertSame('good', $this->roleQualityValue($signetId, 'ramp', 'quality'));
        self::assertSame('slow', $this->roleQualityValue($sphereId, 'ramp', 'quality'));
    }

    public function testTextRulesGeneratePreviouslyMissingRoles(): void
    {
        $cases = [
            ['83000000-0000-0000-0000-000000000009', 'Token Maker', 'Sorcery', 'Create two 1/1 white Soldier creature tokens.', 'token_maker'],
            ['83000000-0000-0000-0000-000000000010', 'Cost Reducer', 'Creature', 'Instant and sorcery spells you cast cost less to cast.', 'cost_reducer'],
            ['83000000-0000-0000-0000-000000000011', 'Craterhoof Behemoth', 'Creature', 'Creatures you control get +X/+X and gain trample until end of turn.', 'combat_finisher'],
            ['83000000-0000-0000-0000-000000000012', "Thassa's Oracle", 'Creature', 'When Thassa\'s Oracle enters, look at the top X cards. If X is greater than or equal to the number of cards in your library, you win the game.', 'combo_piece'],
        ];

        foreach ($cases as [$oracleId, $name, $typeLine, $text, $role]) {
            $this->insertOracleProfile($oracleId, $name, [
                'type_line' => $typeLine,
                'oracle_text' => $text,
                'is_artifact' => false,
                'is_creature' => $typeLine === 'Creature',
                'is_instant' => $typeLine === 'Instant',
                'is_sorcery' => $typeLine === 'Sorcery',
            ]);
        }

        $this->rebuilder()->rebuild();

        foreach ($cases as [$oracleId, , , , $role]) {
            self::assertTrue($this->hasRole($oracleId, $role), $role.' was not generated.');
        }
    }

    public function testManualConditionIsPreservedAfterRebuild(): void
    {
        $oracleId = '83000000-0000-0000-0000-000000000013';
        $this->insertOracleProfile($oracleId, 'Manual Condition Card');
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_condition (
    id,
    oracle_id,
    condition_key,
    risk_if_unmet,
    description,
    source,
    updated_at
) VALUES (
    '83000000-0000-0000-0000-000000000113',
    :oracle_id,
    'requires_spell_density',
    'high',
    'Manual override.',
    'manual',
    NOW()
)
SQL,
            ['oracle_id' => $oracleId],
        );

        $this->rebuilder()->rebuild();

        self::assertSame(
            'manual',
            $this->entityManager->getConnection()->fetchOne(
                'SELECT source FROM card_condition WHERE oracle_id = :oracleId AND condition_key = :conditionKey',
                ['oracleId' => $oracleId, 'conditionKey' => 'requires_spell_density'],
            ),
        );
    }

    public function testPowerFlagsAreGeneratedFromProfileAndManualLists(): void
    {
        $gameChangerId = '83000000-0000-0000-0000-000000000014';
        $forceId = '83000000-0000-0000-0000-000000000015';
        $tutorId = '83000000-0000-0000-0000-000000000016';
        $oracleId = '83000000-0000-0000-0000-000000000017';
        $cryptId = '83000000-0000-0000-0000-000000000018';
        $this->insertOracleProfile($gameChangerId, 'Game Changer Card', ['is_game_changer' => true]);
        $this->insertOracleProfile($forceId, 'Force of Will');
        $this->insertOracleProfile($tutorId, 'Demonic Tutor');
        $this->insertOracleProfile($oracleId, "Thassa's Oracle");
        $this->insertOracleProfile($cryptId, 'Mana Crypt');

        $this->rebuilder()->rebuild();

        self::assertTrue($this->hasPowerFlag($gameChangerId, 'game_changer'));
        self::assertTrue($this->hasPowerFlag($forceId, 'free_interaction'));
        self::assertTrue($this->hasPowerFlag($tutorId, 'efficient_tutor'));
        self::assertTrue($this->hasPowerFlag($oracleId, 'compact_wincon'));
        self::assertTrue($this->hasPowerFlag($cryptId, 'fast_mana'));
    }

    public function testArchetypeSignalsCoverReanimatorAristocratsBlinkAndLandfall(): void
    {
        $reanimateId = '83000000-0000-0000-0000-000000000019';
        $artistId = '83000000-0000-0000-0000-000000000020';
        $blinkId = '83000000-0000-0000-0000-000000000021';
        $landfallId = '83000000-0000-0000-0000-000000000022';
        $spellslingerId = '83000000-0000-0000-0000-000000000153';
        $discardPayoffId = '83000000-0000-0000-0000-000000000154';
        $this->insertOracleProfile($reanimateId, 'Reanimate', [
            'mana_value' => 1,
            'type_line' => 'Sorcery',
            'oracle_text' => 'Put target creature card from a graveyard onto the battlefield under your control.',
            'is_artifact' => false,
            'is_sorcery' => true,
        ]);
        $this->insertOracleProfile($artistId, 'Blood Artist', [
            'type_line' => 'Creature',
            'oracle_text' => 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($blinkId, 'Ephemerate', [
            'type_line' => 'Instant',
            'oracle_text' => 'Exile target creature you control, then return it to the battlefield under its owner\'s control.',
            'is_artifact' => false,
            'is_instant' => true,
        ]);
        $this->insertOracleProfile($landfallId, 'Landfall Card', [
            'type_line' => 'Creature',
            'oracle_text' => 'Landfall — Whenever a land enters the battlefield under your control, draw a card.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($spellslingerId, 'Electrostatic Infantry', [
            'type_line' => 'Creature',
            'oracle_text' => 'Trample Whenever you cast an instant or sorcery spell, put a +1/+1 counter on this creature.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($discardPayoffId, 'Fell Specter', [
            'type_line' => 'Creature',
            'oracle_text' => 'When this creature enters, target opponent discards a card. Whenever an opponent discards a card, that player loses 2 life.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);

        $this->rebuilder()->rebuild();

        self::assertTrue($this->hasArchetype($reanimateId, 'reanimator'));
        self::assertTrue($this->hasArchetype($reanimateId, 'graveyard'));
        self::assertTrue($this->hasArchetype($artistId, 'aristocrats'));
        self::assertTrue($this->hasRole($artistId, 'payoff'));
        self::assertTrue($this->hasArchetype($blinkId, 'blink'));
        self::assertFalse($this->hasRole($blinkId, 'spot_removal'));
        self::assertTrue($this->hasArchetype($landfallId, 'landfall'));
        self::assertTrue($this->hasArchetype($spellslingerId, 'spellslinger'));
        self::assertFalse($this->hasRole($spellslingerId, 'wincon'));
        self::assertTrue($this->hasRole($discardPayoffId, 'discard'));
        self::assertTrue($this->hasSubrole($discardPayoffId, 'discard_payoff'));
        self::assertTrue($this->hasArchetype($discardPayoffId, 'discard'));
    }

    public function testCostReducersGenerateRoleQualityAndArchetypes(): void
    {
        $spellId = '83000000-0000-0000-0000-000000000023';
        $artifactId = '83000000-0000-0000-0000-000000000024';
        $this->insertOracleProfile($spellId, 'Goblin Electromancer', [
            'type_line' => 'Creature',
            'oracle_text' => 'Instant and sorcery spells you cast cost {1} less to cast.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($artifactId, 'Etherium Sculptor', [
            'type_line' => 'Artifact Creature',
            'oracle_text' => 'Artifact spells you cast cost {1} less to cast.',
            'is_artifact' => true,
            'is_creature' => true,
        ]);

        $this->rebuilder()->rebuild();

        self::assertTrue($this->hasRole($spellId, 'cost_reducer'));
        self::assertSame('medium', $this->roleQualityValue($spellId, 'cost_reducer', 'quality'));
        self::assertTrue($this->hasArchetype($spellId, 'spellslinger'));
        self::assertTrue($this->hasRole($artifactId, 'cost_reducer'));
        self::assertTrue($this->hasArchetype($artifactId, 'artifacts'));
    }

    public function testCombatFinishersGenerateFinisherAndWinconRoles(): void
    {
        $craterhoofId = '83000000-0000-0000-0000-000000000025';
        $finaleId = '83000000-0000-0000-0000-000000000026';
        $this->insertOracleProfile($craterhoofId, 'Craterhoof Behemoth', [
            'mana_value' => 8,
            'type_line' => 'Creature',
            'oracle_text' => 'When Craterhoof Behemoth enters the battlefield, creatures you control gain trample and get +X/+X until end of turn.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($finaleId, 'Finale of Devastation', [
            'mana_value' => 2,
            'type_line' => 'Sorcery',
            'oracle_text' => 'Search your library and/or graveyard for a creature card. If X is 10 or more, creatures you control get +X/+X and gain haste until end of turn.',
            'is_artifact' => false,
            'is_sorcery' => true,
        ]);

        $this->rebuilder()->rebuild();

        self::assertTrue($this->hasRole($craterhoofId, 'combat_finisher'));
        self::assertTrue($this->hasRole($craterhoofId, 'wincon'));
        self::assertTrue($this->hasRole($finaleId, 'combat_finisher'));
        self::assertTrue($this->hasRole($finaleId, 'wincon'));
    }

    public function testCombatSupportUsesSubrolesWithoutInflatingWincons(): void
    {
        $watchingId = '83000000-0000-0000-0000-000000000141';
        $marshalId = '83000000-0000-0000-0000-000000000142';
        $agentId = '83000000-0000-0000-0000-000000000143';
        $assaultId = '83000000-0000-0000-0000-000000000144';
        $skirmisherId = '83000000-0000-0000-0000-000000000152';
        $this->insertOracleProfile($watchingId, 'Always Watching', [
            'type_line' => 'Enchantment',
            'oracle_text' => 'Nontoken creatures you control get +1/+1 and have vigilance.',
            'is_artifact' => false,
            'is_enchantment' => true,
        ]);
        $this->insertOracleProfile($marshalId, 'Benalish Marshal', [
            'type_line' => 'Creature',
            'oracle_text' => 'Other creatures you control get +1/+1.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($agentId, 'Blighted Agent', [
            'type_line' => 'Creature',
            'oracle_text' => 'Infect This creature can\'t be blocked.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($assaultId, 'Aggravated Assault', [
            'type_line' => 'Enchantment',
            'oracle_text' => '{3}{R}{R}: Untap all creatures you control. After this main phase, there is an additional combat phase followed by an additional main phase. Activate only as a sorcery.',
            'is_artifact' => false,
            'is_enchantment' => true,
        ]);
        $this->insertOracleProfile($skirmisherId, 'Angelic Skirmisher', [
            'type_line' => 'Creature',
            'oracle_text' => 'At the beginning of each combat, choose first strike, vigilance, or lifelink. Creatures you control gain that ability until end of turn.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);

        $this->rebuilder()->rebuild();

        self::assertTrue($this->hasSubrole($watchingId, 'anthem'));
        self::assertTrue($this->hasSubrole($watchingId, 'combat_support'));
        self::assertFalse($this->hasRole($watchingId, 'wincon'));
        self::assertTrue($this->hasSubrole($marshalId, 'lord_effect'));
        self::assertFalse($this->hasRole($marshalId, 'wincon'));
        self::assertTrue($this->hasSubrole($agentId, 'infect_threat'));
        self::assertFalse($this->hasRole($agentId, 'wincon'));
        self::assertTrue($this->hasRole($assaultId, 'extra_combat'));
        self::assertTrue($this->hasSubrole($assaultId, 'extra_combat_engine'));
        self::assertTrue($this->hasRole($assaultId, 'combo_piece'));
        self::assertFalse($this->hasRole($assaultId, 'wincon'));
        self::assertTrue($this->hasSubrole($skirmisherId, 'combat_support'));
        self::assertTrue($this->hasSubrole($skirmisherId, 'evasion_support'));
        self::assertFalse($this->hasRole($skirmisherId, 'wincon'));
    }

    public function testLethalCombatThreatsRemainStrongSignals(): void
    {
        $blightsteelId = '83000000-0000-0000-0000-000000000145';
        $aureliaId = '83000000-0000-0000-0000-000000000146';
        $this->insertOracleProfile($blightsteelId, 'Blightsteel Colossus', [
            'type_line' => 'Artifact Creature',
            'oracle_text' => 'Trample, infect, indestructible.',
            'is_artifact' => true,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($aureliaId, 'Aurelia, the Warleader', [
            'type_line' => 'Legendary Creature',
            'oracle_text' => 'Flying, vigilance, haste Whenever Aurelia attacks for the first time each turn, untap all creatures you control. After this phase, there is an additional combat phase.',
            'is_artifact' => false,
            'is_creature' => true,
            'is_legendary' => true,
        ]);

        $this->rebuilder()->rebuild();

        self::assertTrue($this->hasSubrole($blightsteelId, 'infect_threat'));
        self::assertTrue($this->hasRole($blightsteelId, 'combat_finisher'));
        self::assertTrue($this->hasRole($blightsteelId, 'wincon'));
        self::assertTrue($this->hasRole($aureliaId, 'extra_combat'));
        self::assertTrue($this->hasSubrole($aureliaId, 'extra_combat_engine'));
        self::assertTrue($this->hasRole($aureliaId, 'combat_finisher'));
    }

    public function testLowOpportunityCostFlagsCoverManualNamesAndFrontFaceNames(): void
    {
        $malakirId = '83000000-0000-0000-0000-000000000027';
        $boseijuId = '83000000-0000-0000-0000-000000000028';
        $this->insertOracleProfile($malakirId, 'Malakir Rebirth // Malakir Mire');
        $this->insertOracleProfile($boseijuId, 'Boseiju, Who Endures', [
            'type_line' => 'Legendary Land',
            'is_land' => true,
            'is_artifact' => false,
        ]);

        $this->rebuilder()->rebuild();

        self::assertTrue($this->hasPowerFlag($malakirId, 'low_opportunity_cost'));
        self::assertTrue($this->hasPowerFlag($boseijuId, 'low_opportunity_cost'));
    }

    public function testLocalComboProfilesGenerateComboPieceRole(): void
    {
        $oracleId = '83000000-0000-0000-0000-000000000029';
        $this->insertOracleProfile($oracleId, 'Isochron Scepter');
        $this->insertComboAnalysisProfile('83000000-0000-0000-0000-000000000129', $oracleId);

        $this->rebuilder()->rebuild();

        self::assertTrue($this->hasRole($oracleId, 'combo_piece'));
        self::assertSame('premium', $this->roleQualityValue($oracleId, 'combo_piece', 'quality'));
    }

    public function testConsultationAndPactAreCompactTutorsWithoutDrawOrBoardWipeFalsePositives(): void
    {
        $consultationId = '83000000-0000-0000-0000-000000000030';
        $pactId = '83000000-0000-0000-0000-000000000031';
        $this->insertOracleProfile($consultationId, 'Demonic Consultation', [
            'type_line' => 'Instant',
            'oracle_text' => 'Choose a card name. Exile the top six cards of your library, then reveal cards from the top of your library until you reveal a card with the chosen name. Put that card into your hand and exile all other cards revealed this way.',
            'is_artifact' => false,
            'is_instant' => true,
        ]);
        $this->insertOracleProfile($pactId, 'Tainted Pact', [
            'type_line' => 'Instant',
            'oracle_text' => 'Exile the top card of your library. You may put that card into your hand unless it has the same name as another card exiled this way. Repeat this process until you put a card into your hand.',
            'is_artifact' => false,
            'is_instant' => true,
        ]);

        $this->rebuilder()->rebuild();

        foreach ([$consultationId, $pactId] as $oracleId) {
            self::assertTrue($this->hasRole($oracleId, 'tutor'));
            self::assertTrue($this->hasRole($oracleId, 'combo_piece'));
            self::assertFalse($this->hasRole($oracleId, 'draw'));
        }
        self::assertFalse($this->hasRole($consultationId, 'board_wipe'));
    }

    public function testCompactTutorsSuppressExternalDrawAndBoardWipeTags(): void
    {
        $oracleId = '83000000-0000-0000-0000-000000000132';
        $this->insertOracleProfile($oracleId, 'Demonic Consultation', [
            'type_line' => 'Instant',
            'oracle_text' => 'Choose a card name. Exile the top six cards of your library, then reveal cards from the top of your library until you reveal a card with the chosen name. Put that card into your hand and exile all other cards revealed this way.',
            'is_artifact' => false,
            'is_instant' => true,
        ]);
        $this->insertExternalTag('83000000-0000-0000-0000-000000000232', $oracleId, 'card-draw');
        $this->insertExternalTag('83000000-0000-0000-0000-000000000233', $oracleId, 'board-wipe');

        $this->rebuilder()->rebuild();

        self::assertTrue($this->hasRole($oracleId, 'tutor'));
        self::assertTrue($this->hasRole($oracleId, 'combo_piece'));
        self::assertFalse($this->hasRole($oracleId, 'draw'));
        self::assertFalse($this->hasRole($oracleId, 'board_wipe'));
    }

    public function testOneShotManaArtifactsAndTurnaboutGenerateBurstMana(): void
    {
        $blackLotusId = '83000000-0000-0000-0000-000000000032';
        $ledId = '83000000-0000-0000-0000-000000000033';
        $turnaboutId = '83000000-0000-0000-0000-000000000034';
        $this->insertOracleProfile($blackLotusId, 'Black Lotus', [
            'type_line' => 'Artifact',
            'oracle_text' => '{T}, Sacrifice this artifact: Add three mana of any one color.',
            'produced_mana' => ['W', 'U', 'B', 'R', 'G'],
            'is_artifact' => true,
        ]);
        $this->insertOracleProfile($ledId, 'Lion\'s Eye Diamond', [
            'type_line' => 'Artifact',
            'oracle_text' => 'Discard your hand, Sacrifice this artifact: Add three mana of any one color. Activate only as an instant.',
            'produced_mana' => ['W', 'U', 'B', 'R', 'G'],
            'is_artifact' => true,
        ]);
        $this->insertOracleProfile($turnaboutId, 'Turnabout', [
            'type_line' => 'Instant',
            'oracle_text' => 'Choose artifact, creature, or land. Tap all untapped permanents of the chosen type target player controls, or untap all tapped permanents of that type target player controls.',
            'is_artifact' => false,
            'is_instant' => true,
        ]);

        $this->rebuilder()->rebuild();

        foreach ([$blackLotusId, $ledId, $turnaboutId] as $oracleId) {
            self::assertTrue($this->hasRole($oracleId, 'burst_mana'));
            self::assertTrue($this->hasRole($oracleId, 'ritual'));
            self::assertSame('one_shot', $this->roleQualityValue($oracleId, 'burst_mana', 'repeatability'));
        }
    }

    public function testStackProtectionAndSilenceEffectsGenerateProtection(): void
    {
        $swatId = '83000000-0000-0000-0000-000000000035';
        $silenceId = '83000000-0000-0000-0000-000000000036';
        $abolisherId = '83000000-0000-0000-0000-000000000037';
        $forceId = '83000000-0000-0000-0000-000000000137';
        $rollickId = '83000000-0000-0000-0000-000000000138';
        $this->insertOracleProfile($swatId, 'Deflecting Swat', [
            'type_line' => 'Instant',
            'oracle_text' => 'If you control a commander, you may cast this spell without paying its mana cost. You may choose new targets for target spell or ability.',
            'is_artifact' => false,
            'is_instant' => true,
        ]);
        $this->insertOracleProfile($silenceId, 'Silence', [
            'type_line' => 'Instant',
            'oracle_text' => 'Your opponents can\'t cast spells this turn.',
            'is_artifact' => false,
            'is_instant' => true,
        ]);
        $this->insertOracleProfile($abolisherId, 'Grand Abolisher', [
            'type_line' => 'Creature',
            'oracle_text' => 'During your turn, your opponents can\'t cast spells or activate abilities of artifacts, creatures, or enchantments.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($forceId, 'Force of Will', [
            'type_line' => 'Instant',
            'oracle_text' => 'You may pay 1 life and exile a blue card from your hand rather than pay this spell\'s mana cost. Counter target spell.',
            'is_artifact' => false,
            'is_instant' => true,
        ]);
        $this->insertOracleProfile($rollickId, 'Deadly Rollick', [
            'type_line' => 'Instant',
            'oracle_text' => 'If you control a commander, you may cast this spell without paying its mana cost. Exile target creature.',
            'is_artifact' => false,
            'is_instant' => true,
        ]);

        $this->rebuilder()->rebuild();

        foreach ([$swatId, $silenceId, $abolisherId, $forceId, $rollickId] as $oracleId) {
            self::assertTrue($this->hasRole($oracleId, 'protection'));
        }
    }

    public function testBlinkEnablersAndEtbPayoffsGenerateRolesAndArchetype(): void
    {
        $bragoId = '83000000-0000-0000-0000-000000000038';
        $panharmoniconId = '83000000-0000-0000-0000-000000000039';
        $this->insertOracleProfile($bragoId, 'Brago, King Eternal', [
            'type_line' => 'Creature',
            'oracle_text' => 'Whenever Brago deals combat damage to a player, exile any number of target nonland permanents you control, then return those cards to the battlefield under their owner\'s control.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($panharmoniconId, 'Panharmonicon', [
            'type_line' => 'Artifact',
            'oracle_text' => 'If an artifact or creature entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
            'is_artifact' => true,
        ]);

        $this->rebuilder()->rebuild();

        self::assertTrue($this->hasRole($bragoId, 'enabler'));
        self::assertTrue($this->hasRole($bragoId, 'payoff'));
        self::assertTrue($this->hasArchetype($bragoId, 'blink'));
        self::assertTrue($this->hasRole($panharmoniconId, 'payoff'));
        self::assertTrue($this->hasArchetype($panharmoniconId, 'blink'));
    }

    public function testRecursionAndReanimationDoNotBecomeBlinkWithoutExileReturn(): void
    {
        $angelId = '83000000-0000-0000-0000-000000000147';
        $dragonId = '83000000-0000-0000-0000-000000000148';
        $this->insertOracleProfile($angelId, 'Angel of Glory\'s Rise', [
            'type_line' => 'Creature',
            'oracle_text' => 'When Angel of Glory\'s Rise enters the battlefield, exile all Zombies, then return all Human creature cards from your graveyard to the battlefield.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($dragonId, 'Bone Dragon', [
            'type_line' => 'Creature',
            'oracle_text' => '{3}{B}{B}, Exile seven other cards from your graveyard: Return Bone Dragon from your graveyard to the battlefield tapped.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);

        $this->rebuilder()->rebuild();

        foreach ([$angelId, $dragonId] as $oracleId) {
            self::assertFalse($this->hasSubrole($oracleId, 'blink'));
            self::assertFalse($this->hasSubrole($oracleId, 'blink_enabler'));
            self::assertFalse($this->hasArchetype($oracleId, 'blink'));
        }
    }

    public function testStaxTaxPatternsGenerateRoles(): void
    {
        $cases = [
            ['83000000-0000-0000-0000-000000000040', 'Drannith Magistrate', 'Your opponents can\'t cast spells from anywhere other than their hands.'],
            ['83000000-0000-0000-0000-000000000041', 'Collector Ouphe', 'Activated abilities of artifacts can\'t be activated.'],
            ['83000000-0000-0000-0000-000000000042', 'Rule of Law', 'Each player can\'t cast more than one spell each turn.'],
            ['83000000-0000-0000-0000-000000000043', 'Winter Orb', 'As long as this artifact is untapped, players can\'t untap more than one land during their untap steps.'],
            ['83000000-0000-0000-0000-000000000044', 'Linvala, Keeper of Silence', 'Activated abilities of creatures your opponents control can\'t be activated.'],
        ];

        foreach ($cases as [$oracleId, $name, $text]) {
            $this->insertOracleProfile($oracleId, $name, [
                'type_line' => 'Artifact',
                'oracle_text' => $text,
            ]);
        }

        $this->rebuilder()->rebuild();

        foreach ($cases as [$oracleId]) {
            self::assertTrue($this->hasRole($oracleId, 'stax') || $this->hasRole($oracleId, 'tax'));
            self::assertTrue($this->hasArchetype($oracleId, 'stax'));
        }
    }

    public function testSacrificeAndTokenDrainPayoffsGenerateAristocratsPayoff(): void
    {
        $mayhemId = '83000000-0000-0000-0000-000000000139';
        $batsId = '83000000-0000-0000-0000-000000000140';
        $bloodbriarId = '83000000-0000-0000-0000-000000000149';
        $grafMoleId = '83000000-0000-0000-0000-000000000155';
        $pumpPayoffId = '83000000-0000-0000-0000-000000000156';
        $this->insertOracleProfile($mayhemId, 'Mayhem Devil', [
            'type_line' => 'Creature',
            'oracle_text' => 'Whenever a player sacrifices a permanent, this creature deals 1 damage to any target.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($batsId, 'Mirkwood Bats', [
            'type_line' => 'Creature',
            'oracle_text' => 'Flying Whenever you create or sacrifice a token, each opponent loses 1 life.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($bloodbriarId, 'Bloodbriar', [
            'type_line' => 'Creature',
            'oracle_text' => 'Whenever you sacrifice another permanent, put a +1/+1 counter on this creature.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($grafMoleId, 'Graf Mole', [
            'type_line' => 'Creature',
            'oracle_text' => 'Whenever you sacrifice a Clue, you gain 3 life.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($pumpPayoffId, 'Sacrifice Pump Payoff', [
            'type_line' => 'Creature',
            'oracle_text' => 'Whenever you sacrifice another permanent, this creature gets +1/+0 until end of turn.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);

        $this->rebuilder()->rebuild();

        foreach ([$mayhemId, $batsId, $grafMoleId] as $oracleId) {
            self::assertTrue($this->hasRole($oracleId, 'payoff'));
            self::assertTrue($this->hasArchetype($oracleId, 'aristocrats'));
        }
        self::assertTrue($this->hasRole($grafMoleId, 'lifegain'));
        self::assertTrue($this->hasRole($bloodbriarId, 'payoff'));
        self::assertTrue($this->hasSubrole($bloodbriarId, 'sacrifice_payoff'));
        self::assertFalse($this->hasRole($bloodbriarId, 'sacrifice_outlet'));
        self::assertTrue($this->hasRole($pumpPayoffId, 'payoff'));
        self::assertTrue($this->hasSubrole($pumpPayoffId, 'sacrifice_payoff'));
        self::assertFalse($this->hasRole($pumpPayoffId, 'sacrifice_outlet'));
    }

    public function testActivatedArtifactSacrificeCostsGenerateSacrificeOutlet(): void
    {
        $boshId = '83000000-0000-0000-0000-000000000150';
        $oneShotId = '83000000-0000-0000-0000-000000000151';
        $this->insertOracleProfile($boshId, 'Bosh, Iron Golem Avatar', [
            'type_line' => 'Artifact Creature',
            'oracle_text' => '{X}, Sacrifice an artifact with mana value X: Bosh deals X damage to any target.',
            'is_artifact' => true,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($oneShotId, 'One-Shot Sacrifice Spell', [
            'type_line' => 'Sorcery',
            'oracle_text' => 'As an additional cost to cast this spell, sacrifice a creature. Draw two cards.',
            'is_artifact' => false,
            'is_sorcery' => true,
        ]);

        $this->rebuilder()->rebuild();

        self::assertTrue($this->hasRole($boshId, 'sacrifice_outlet'));
        self::assertFalse($this->hasRole($oneShotId, 'sacrifice_outlet'));
    }

    public function testConservativeSacrificeTaxonomySeparatesOutletsOneShotsAndSelfSacrifice(): void
    {
        $visceraId = '83000000-0000-0000-0000-000000000157';
        $bombardmentId = '83000000-0000-0000-0000-000000000158';
        $altarId = '83000000-0000-0000-0000-000000000159';
        $bloodArtistId = '83000000-0000-0000-0000-000000000160';
        $altarReapId = '83000000-0000-0000-0000-000000000161';
        $villageRitesId = '83000000-0000-0000-0000-000000000162';
        $boneSplintersId = '83000000-0000-0000-0000-000000000163';
        $spellbombId = '83000000-0000-0000-0000-000000000164';
        $baubleId = '83000000-0000-0000-0000-000000000165';

        $this->insertOracleProfile($visceraId, 'Viscera Seer', ['type_line' => 'Creature', 'oracle_text' => 'Sacrifice a creature: Scry 1.', 'is_artifact' => false, 'is_creature' => true]);
        $this->insertOracleProfile($bombardmentId, 'Goblin Bombardment', ['type_line' => 'Enchantment', 'oracle_text' => 'Sacrifice a creature: Goblin Bombardment deals 1 damage to any target.', 'is_artifact' => false, 'is_enchantment' => true]);
        $this->insertOracleProfile($altarId, 'Ashnod\'s Altar', ['type_line' => 'Artifact', 'oracle_text' => 'Sacrifice a creature: Add {C}{C}.', 'produced_mana' => ['C'], 'is_artifact' => true]);
        $this->insertOracleProfile($bloodArtistId, 'Blood Artist', ['type_line' => 'Creature', 'oracle_text' => 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.', 'is_artifact' => false, 'is_creature' => true]);
        $this->insertOracleProfile($altarReapId, 'Altar\'s Reap', ['type_line' => 'Instant', 'oracle_text' => 'As an additional cost to cast this spell, sacrifice a creature. Draw two cards.', 'is_artifact' => false, 'is_instant' => true]);
        $this->insertOracleProfile($villageRitesId, 'Village Rites', ['type_line' => 'Instant', 'oracle_text' => 'As an additional cost to cast this spell, sacrifice a creature. Draw two cards.', 'is_artifact' => false, 'is_instant' => true]);
        $this->insertOracleProfile($boneSplintersId, 'Bone Splinters', ['type_line' => 'Sorcery', 'oracle_text' => 'As an additional cost to cast this spell, sacrifice a creature. Destroy target creature.', 'is_artifact' => false, 'is_sorcery' => true]);
        $this->insertOracleProfile($spellbombId, 'Aether Spellbomb', ['type_line' => 'Artifact', 'oracle_text' => '{U}, Sacrifice Aether Spellbomb: Return target creature to its owner\'s hand.', 'is_artifact' => true]);
        $this->insertOracleProfile($baubleId, 'Wayfarer\'s Bauble', ['type_line' => 'Artifact', 'oracle_text' => '{2}, {T}, Sacrifice Wayfarer\'s Bauble: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.', 'is_artifact' => true]);

        $this->rebuilder()->rebuild();

        foreach ([$visceraId, $bombardmentId, $altarId] as $oracleId) {
            self::assertTrue($this->hasRole($oracleId, 'sacrifice_outlet'));
        }
        self::assertTrue($this->hasRole($altarId, 'ramp'));
        self::assertFalse($this->hasRole($bloodArtistId, 'sacrifice_outlet'));
        self::assertTrue($this->hasSubrole($bloodArtistId, 'aristocrats_payoff'));

        foreach ([$altarReapId, $villageRitesId, $boneSplintersId] as $oracleId) {
            self::assertTrue($this->hasSubrole($oracleId, 'one_shot_sacrifice'));
            self::assertFalse($this->hasRole($oracleId, 'sacrifice_outlet'));
        }
        self::assertTrue($this->hasRole($altarReapId, 'draw'));
        self::assertTrue($this->hasRole($boneSplintersId, 'creature_removal'));

        foreach ([$spellbombId, $baubleId] as $oracleId) {
            self::assertTrue($this->hasSubrole($oracleId, 'self_sacrifice'));
            self::assertFalse($this->hasRole($oracleId, 'sacrifice_outlet'));
        }
    }

    public function testConservativeBoardWipeTaxonomySeparatesHardBounceAndConditionalWipes(): void
    {
        $damnationId = '83000000-0000-0000-0000-000000000166';
        $farewellId = '83000000-0000-0000-0000-000000000167';
        $riftId = '83000000-0000-0000-0000-000000000168';
        $aetherizeId = '83000000-0000-0000-0000-000000000169';
        $balefireId = '83000000-0000-0000-0000-000000000170';
        $blastZoneId = '83000000-0000-0000-0000-000000000171';

        $this->insertOracleProfile($damnationId, 'Damnation', ['type_line' => 'Sorcery', 'oracle_text' => 'Destroy all creatures. They can\'t be regenerated.', 'is_artifact' => false, 'is_sorcery' => true]);
        $this->insertOracleProfile($farewellId, 'Farewell', ['type_line' => 'Sorcery', 'oracle_text' => 'Choose one or more - Exile all artifacts. Exile all creatures. Exile all enchantments. Exile all graveyards.', 'is_artifact' => false, 'is_sorcery' => true]);
        $this->insertOracleProfile($riftId, 'Cyclonic Rift', ['type_line' => 'Instant', 'oracle_text' => 'Return target nonland permanent you don\'t control to its owner\'s hand. Overload Return each nonland permanent you don\'t control to its owner\'s hand.', 'is_artifact' => false, 'is_instant' => true]);
        $this->insertOracleProfile($aetherizeId, 'Aetherize', ['type_line' => 'Instant', 'oracle_text' => 'Return all attacking creatures to their owner\'s hand.', 'is_artifact' => false, 'is_instant' => true]);
        $this->insertOracleProfile($balefireId, 'Balefire Dragon', ['type_line' => 'Creature', 'oracle_text' => 'Whenever Balefire Dragon deals combat damage to a player, it deals that much damage to each creature that player controls.', 'is_artifact' => false, 'is_creature' => true]);
        $this->insertOracleProfile($blastZoneId, 'Blast Zone', ['type_line' => 'Land', 'oracle_text' => '{T}, Sacrifice Blast Zone: Destroy each nonland permanent with mana value equal to the number of charge counters on Blast Zone.', 'is_artifact' => false, 'is_land' => true]);

        $this->rebuilder()->rebuild();

        foreach ([$damnationId, $farewellId] as $oracleId) {
            self::assertTrue($this->hasRole($oracleId, 'board_wipe'));
        }
        self::assertFalse($this->hasRole($riftId, 'board_wipe'));
        self::assertTrue($this->hasSubrole($riftId, 'mass_bounce'));
        self::assertFalse($this->hasRole($aetherizeId, 'board_wipe'));
        self::assertTrue($this->hasSubrole($aetherizeId, 'pseudo_wipe'));
        foreach ([$balefireId, $blastZoneId] as $oracleId) {
            self::assertFalse($this->hasRole($oracleId, 'board_wipe'));
            self::assertTrue($this->hasSubrole($oracleId, 'conditional_wipe'));
        }
    }

    public function testConservativeTutorTaxonomySeparatesTrueTypedLandRampAndOpponentTutors(): void
    {
        $demonicId = '83000000-0000-0000-0000-000000000172';
        $vampiricId = '83000000-0000-0000-0000-000000000173';
        $enlightenedId = '83000000-0000-0000-0000-000000000174';
        $cropId = '83000000-0000-0000-0000-000000000175';
        $rampantId = '83000000-0000-0000-0000-000000000176';
        $cultivateId = '83000000-0000-0000-0000-000000000177';
        $briberyId = '83000000-0000-0000-0000-000000000178';
        $fieldId = '83000000-0000-0000-0000-000000000179';

        $this->insertOracleProfile($demonicId, 'Demonic Tutor', ['type_line' => 'Sorcery', 'oracle_text' => 'Search your library for a card, put that card into your hand, then shuffle.', 'is_artifact' => false, 'is_sorcery' => true]);
        $this->insertOracleProfile($vampiricId, 'Vampiric Tutor', ['type_line' => 'Instant', 'oracle_text' => 'Search your library for a card, then shuffle and put that card on top.', 'is_artifact' => false, 'is_instant' => true]);
        $this->insertOracleProfile($enlightenedId, 'Enlightened Tutor', ['type_line' => 'Instant', 'oracle_text' => 'Search your library for an artifact or enchantment card, reveal it, then shuffle and put that card on top.', 'is_artifact' => false, 'is_instant' => true]);
        $this->insertOracleProfile($cropId, 'Crop Rotation', ['type_line' => 'Instant', 'oracle_text' => 'As an additional cost to cast this spell, sacrifice a land. Search your library for a land card, put that card onto the battlefield, then shuffle.', 'is_artifact' => false, 'is_instant' => true]);
        $this->insertOracleProfile($rampantId, 'Rampant Growth', ['type_line' => 'Sorcery', 'oracle_text' => 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.', 'is_artifact' => false, 'is_sorcery' => true]);
        $this->insertOracleProfile($cultivateId, 'Cultivate', ['type_line' => 'Sorcery', 'oracle_text' => 'Search your library for up to two basic land cards, reveal them, put one onto the battlefield tapped and the other into your hand, then shuffle.', 'is_artifact' => false, 'is_sorcery' => true]);
        $this->insertOracleProfile($briberyId, 'Bribery', ['type_line' => 'Sorcery', 'oracle_text' => 'Search target opponent\'s library for a creature card and put that card onto the battlefield under your control.', 'is_artifact' => false, 'is_sorcery' => true]);
        $this->insertOracleProfile($fieldId, 'Field of Ruin', ['type_line' => 'Land', 'oracle_text' => '{2}, {T}, Sacrifice Field of Ruin: Destroy target nonbasic land an opponent controls. Each player searches their library for a basic land card.', 'is_artifact' => false, 'is_land' => true]);

        $this->rebuilder()->rebuild();

        foreach ([$demonicId, $vampiricId] as $oracleId) {
            self::assertTrue($this->hasRole($oracleId, 'tutor'));
            self::assertTrue($this->hasSubrole($oracleId, 'true_tutor'));
            self::assertTrue($this->hasPowerFlag($oracleId, 'efficient_tutor'));
        }
        self::assertTrue($this->hasRole($enlightenedId, 'tutor'));
        self::assertTrue($this->hasSubrole($enlightenedId, 'typed_tutor'));
        self::assertFalse($this->hasRole($cropId, 'tutor'));
        self::assertTrue($this->hasSubrole($cropId, 'land_tutor'));
        foreach ([$rampantId, $cultivateId] as $oracleId) {
            self::assertFalse($this->hasRole($oracleId, 'tutor'));
            self::assertTrue($this->hasSubrole($oracleId, 'ramp_search'));
        }
        self::assertFalse($this->hasRole($briberyId, 'tutor'));
        self::assertTrue($this->hasSubrole($briberyId, 'opponent_tutor'));
        self::assertFalse($this->hasRole($fieldId, 'tutor'));
    }

    public function testFetchlandsAndLandRampTagsDoNotBecomeTrueTutors(): void
    {
        $fetchId = '83000000-0000-0000-0000-000000000280';
        $woodElvesId = '83000000-0000-0000-0000-000000000281';
        $expeditionMapId = '83000000-0000-0000-0000-000000000282';

        $this->insertOracleProfile($fetchId, 'Polluted Delta', [
            'type_line' => 'Land',
            'oracle_text' => '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.',
            'is_artifact' => false,
            'is_land' => true,
        ]);
        $this->insertOracleProfile($woodElvesId, 'Wood Elves', [
            'type_line' => 'Creature — Elf Scout',
            'oracle_text' => 'When Wood Elves enters the battlefield, search your library for a Forest card, put that card onto the battlefield, then shuffle.',
            'is_artifact' => false,
            'is_creature' => true,
        ]);
        $this->insertOracleProfile($expeditionMapId, 'Expedition Map', [
            'type_line' => 'Artifact',
            'oracle_text' => '{2}, {T}, Sacrifice Expedition Map: Search your library for a land card, reveal it, put it into your hand, then shuffle.',
            'is_artifact' => true,
        ]);
        $this->insertExternalTag('83000000-0000-0000-0000-000000000290', $fetchId, 'tutor');
        $this->insertExternalTag('83000000-0000-0000-0000-000000000291', $woodElvesId, 'tutor');
        $this->insertExternalTag('83000000-0000-0000-0000-000000000292', $woodElvesId, 'ramp');
        $this->insertExternalTag('83000000-0000-0000-0000-000000000293', $expeditionMapId, 'tutor');

        $this->rebuilder()->rebuild();

        self::assertFalse($this->hasRole($fetchId, 'tutor'));
        self::assertFalse($this->hasSubrole($fetchId, 'true_tutor'));
        self::assertTrue($this->hasSubrole($fetchId, 'fetchland'));
        self::assertTrue($this->hasRole($fetchId, 'mana_fixing'));

        self::assertFalse($this->hasRole($woodElvesId, 'tutor'));
        self::assertFalse($this->hasSubrole($woodElvesId, 'true_tutor'));
        self::assertTrue($this->hasSubrole($woodElvesId, 'ramp_search'));
        self::assertTrue($this->hasSubrole($woodElvesId, 'land_ramp'));

        self::assertFalse($this->hasRole($expeditionMapId, 'tutor'));
        self::assertFalse($this->hasSubrole($expeditionMapId, 'true_tutor'));
        self::assertTrue($this->hasSubrole($expeditionMapId, 'land_tutor'));
    }

    public function testConservativeWinconAndRemovalRulesAvoidFalsePositives(): void
    {
        $notDeadId = '83000000-0000-0000-0000-000000000180';
        $witchMarkId = '83000000-0000-0000-0000-000000000181';
        $exsanguinateId = '83000000-0000-0000-0000-000000000182';
        $tormentId = '83000000-0000-0000-0000-000000000183';
        $arcSloggerId = '83000000-0000-0000-0000-000000000184';
        $pathId = '83000000-0000-0000-0000-000000000185';

        $this->insertOracleProfile($notDeadId, 'Not Dead After All', ['type_line' => 'Instant', 'oracle_text' => 'Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner\'s control."', 'is_artifact' => false, 'is_instant' => true]);
        $this->insertOracleProfile($witchMarkId, 'Witch\'s Mark', ['type_line' => 'Sorcery', 'oracle_text' => 'Target creature gets +1/+0 until end of turn. When it dies this turn, create a Role token.', 'is_artifact' => false, 'is_sorcery' => true]);
        $this->insertOracleProfile($exsanguinateId, 'Exsanguinate', ['type_line' => 'Sorcery', 'oracle_text' => 'Each opponent loses X life. You gain life equal to the life lost this way.', 'is_artifact' => false, 'is_sorcery' => true]);
        $this->insertOracleProfile($tormentId, 'Torment of Hailfire', ['type_line' => 'Sorcery', 'oracle_text' => 'Repeat the following process X times. Each opponent loses 3 life unless that player sacrifices a nonland permanent or discards a card.', 'is_artifact' => false, 'is_sorcery' => true]);
        $this->insertOracleProfile($arcSloggerId, 'Arc-Slogger', ['type_line' => 'Creature', 'oracle_text' => 'Exile the top ten cards of your library: Arc-Slogger deals 2 damage to any target.', 'is_artifact' => false, 'is_creature' => true]);
        $this->insertOracleProfile($pathId, 'Path to Exile', ['type_line' => 'Instant', 'oracle_text' => 'Exile target creature. Its controller may search their library for a basic land card.', 'is_artifact' => false, 'is_instant' => true]);

        $this->rebuilder()->rebuild();

        self::assertFalse($this->hasRole($notDeadId, 'wincon'));
        self::assertFalse($this->hasRole($witchMarkId, 'wincon'));
        self::assertTrue($this->hasRole($exsanguinateId, 'wincon'));
        self::assertTrue($this->hasRole($tormentId, 'wincon'));
        self::assertFalse($this->hasRole($arcSloggerId, 'spot_removal'));
        self::assertFalse($this->hasRole($arcSloggerId, 'creature_removal'));
        self::assertTrue($this->hasRole($pathId, 'creature_removal'));
    }

    public function testSymmetricalStaxRiskIsAddedWithoutRemovingStaxRole(): void
    {
        $collectorId = '83000000-0000-0000-0000-000000000186';
        $bloodMoonId = '83000000-0000-0000-0000-000000000187';
        $ruleId = '83000000-0000-0000-0000-000000000188';
        $winterId = '83000000-0000-0000-0000-000000000189';
        $ripId = '83000000-0000-0000-0000-000000000190';

        $this->insertOracleProfile($collectorId, 'Collector Ouphe', ['type_line' => 'Creature', 'oracle_text' => 'Activated abilities of artifacts can\'t be activated.', 'is_artifact' => false, 'is_creature' => true]);
        $this->insertOracleProfile($bloodMoonId, 'Blood Moon', ['type_line' => 'Enchantment', 'oracle_text' => 'Nonbasic lands are Mountains.', 'is_artifact' => false, 'is_enchantment' => true]);
        $this->insertOracleProfile($ruleId, 'Rule of Law', ['type_line' => 'Enchantment', 'oracle_text' => 'Each player can\'t cast more than one spell each turn.', 'is_artifact' => false, 'is_enchantment' => true]);
        $this->insertOracleProfile($winterId, 'Winter Orb', ['type_line' => 'Artifact', 'oracle_text' => 'As long as this artifact is untapped, players can\'t untap more than one land during their untap steps.', 'is_artifact' => true]);
        $this->insertOracleProfile($ripId, 'Rest in Peace', ['type_line' => 'Enchantment', 'oracle_text' => 'When Rest in Peace enters, exile all graveyards. If a card or token would be put into a graveyard from anywhere, exile it instead.', 'is_artifact' => false, 'is_enchantment' => true]);

        $this->rebuilder()->rebuild();

        foreach ([$collectorId, $bloodMoonId, $ruleId, $winterId] as $oracleId) {
            self::assertTrue($this->hasRole($oracleId, 'stax') || $this->hasRole($oracleId, 'tax'));
            self::assertTrue($this->hasCondition($oracleId, 'symmetrical_stax_risk'));
        }
        self::assertTrue($this->hasRole($ripId, 'graveyard_hate'));
        self::assertTrue($this->hasCondition($ripId, 'symmetrical_stax_risk'));
    }

    public function testBurstManaDoesNotBecomePermanentRamp(): void
    {
        $ledId = '83000000-0000-0000-0000-000000000191';
        $petalId = '83000000-0000-0000-0000-000000000192';
        $signetId = '83000000-0000-0000-0000-000000000193';

        $this->insertOracleProfile($ledId, 'Lion\'s Eye Diamond', ['type_line' => 'Artifact', 'oracle_text' => 'Discard your hand, Sacrifice this artifact: Add three mana of any one color. Activate only as an instant.', 'produced_mana' => ['W', 'U', 'B', 'R', 'G'], 'is_artifact' => true]);
        $this->insertOracleProfile($petalId, 'Lotus Petal', ['type_line' => 'Artifact', 'oracle_text' => '{T}, Sacrifice this artifact: Add one mana of any color.', 'produced_mana' => ['W', 'U', 'B', 'R', 'G'], 'is_artifact' => true]);
        $this->insertOracleProfile($signetId, 'Arcane Signet', ['type_line' => 'Artifact', 'oracle_text' => '{T}: Add one mana of any color in your commander\'s color identity.', 'produced_mana' => ['W', 'U', 'B', 'R', 'G'], 'is_artifact' => true]);

        $this->rebuilder()->rebuild();

        foreach ([$ledId, $petalId] as $oracleId) {
            self::assertTrue($this->hasRole($oracleId, 'burst_mana'));
            self::assertSame('one_shot', $this->roleQualityValue($oracleId, 'ramp', 'repeatability'));
            self::assertFalse($this->hasSubrole($oracleId, 'permanent_ramp'));
        }
        self::assertTrue($this->hasSubrole($signetId, 'permanent_ramp'));
    }

    public function testRebuildCanRunTwiceWithoutDuplicatingRecords(): void
    {
        $oracleId = '83000000-0000-0000-0000-000000000005';
        $this->insertOracleProfile($oracleId, 'Repeatable Ramp');
        $this->insertExternalTag('83000000-0000-0000-0000-000000000015', $oracleId, 'ramp');

        $this->rebuilder()->rebuild();
        $firstCount = $this->generatedRecordCount($oracleId);

        $this->rebuilder()->rebuild();

        self::assertSame($firstCount, $this->generatedRecordCount($oracleId));
    }

    private function rebuilder(): CardSemanticDataRebuilder
    {
        return new CardSemanticDataRebuilder($this->entityManager->getConnection());
    }

    /**
     * @param array<string,mixed> $overrides
     */
    private function insertOracleProfile(string $oracleId, string $name, array $overrides = []): void
    {
        $profile = array_replace([
            'oracle_id' => $oracleId,
            'default_scryfall_id' => null,
            'name' => $name,
            'normalized_name' => mb_strtolower($name),
            'mana_cost' => null,
            'mana_value' => null,
            'type_line' => 'Artifact',
            'oracle_text' => '',
            'colors' => [],
            'color_identity' => [],
            'produced_mana' => [],
            'keywords' => [],
            'layout' => null,
            'card_faces' => [],
            'power' => null,
            'toughness' => null,
            'loyalty' => null,
            'defense' => null,
            'commander_legal' => true,
            'commander_banned' => false,
            'can_be_commander' => false,
            'is_land' => false,
            'is_creature' => false,
            'is_artifact' => true,
            'is_enchantment' => false,
            'is_instant' => false,
            'is_sorcery' => false,
            'is_planeswalker' => false,
            'is_battle' => false,
            'is_legendary' => false,
            'edhrec_rank' => null,
            'is_game_changer' => false,
            'data_hash' => hash('sha256', $oracleId.$name),
        ], $overrides);

        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_oracle_profile (
    oracle_id,
    default_scryfall_id,
    name,
    normalized_name,
    mana_cost,
    mana_value,
    type_line,
    oracle_text,
    colors,
    color_identity,
    produced_mana,
    keywords,
    layout,
    card_faces,
    power,
    toughness,
    loyalty,
    defense,
    commander_legal,
    commander_banned,
    can_be_commander,
    is_land,
    is_creature,
    is_artifact,
    is_enchantment,
    is_instant,
    is_sorcery,
    is_planeswalker,
    is_battle,
    is_legendary,
    edhrec_rank,
    is_game_changer,
    data_hash,
    updated_at
) VALUES (
    :oracle_id,
    :default_scryfall_id,
    :name,
    :normalized_name,
    :mana_cost,
    :mana_value,
    :type_line,
    :oracle_text,
    :colors,
    :color_identity,
    :produced_mana,
    :keywords,
    :layout,
    :card_faces,
    :power,
    :toughness,
    :loyalty,
    :defense,
    :commander_legal,
    :commander_banned,
    :can_be_commander,
    :is_land,
    :is_creature,
    :is_artifact,
    :is_enchantment,
    :is_instant,
    :is_sorcery,
    :is_planeswalker,
    :is_battle,
    :is_legendary,
    :edhrec_rank,
    :is_game_changer,
    :data_hash,
    NOW()
)
SQL,
            [
                ...$profile,
                'colors' => json_encode($profile['colors'], JSON_THROW_ON_ERROR),
                'color_identity' => json_encode($profile['color_identity'], JSON_THROW_ON_ERROR),
                'produced_mana' => json_encode($profile['produced_mana'], JSON_THROW_ON_ERROR),
                'keywords' => json_encode($profile['keywords'], JSON_THROW_ON_ERROR),
                'card_faces' => json_encode($profile['card_faces'], JSON_THROW_ON_ERROR),
            ],
            [
                'commander_legal' => ParameterType::BOOLEAN,
                'commander_banned' => ParameterType::BOOLEAN,
                'can_be_commander' => ParameterType::BOOLEAN,
                'is_land' => ParameterType::BOOLEAN,
                'is_creature' => ParameterType::BOOLEAN,
                'is_artifact' => ParameterType::BOOLEAN,
                'is_enchantment' => ParameterType::BOOLEAN,
                'is_instant' => ParameterType::BOOLEAN,
                'is_sorcery' => ParameterType::BOOLEAN,
                'is_planeswalker' => ParameterType::BOOLEAN,
                'is_battle' => ParameterType::BOOLEAN,
                'is_legendary' => ParameterType::BOOLEAN,
                'is_game_changer' => ParameterType::BOOLEAN,
            ],
        );
    }

    private function insertExternalTag(string $id, string $oracleId, string $tagSlug): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO external_card_tag (
    id,
    oracle_id,
    source,
    tag_type,
    tag_slug,
    import_query,
    confidence,
    active,
    imported_at
) VALUES (
    :id,
    :oracle_id,
    'scryfall_tagger',
    'otag',
    :tag_slug,
    :import_query,
    1.0,
    true,
    NOW()
)
SQL,
            [
                'id' => $id,
                'oracle_id' => $oracleId,
                'tag_slug' => $tagSlug,
                'import_query' => 'otag:'.$tagSlug,
            ],
        );
    }

    private function insertComboAnalysisProfile(string $comboVariantId, string $oracleId): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO spellbook_combo_variant (
    id,
    external_id,
    identity,
    source_hash,
    synced_at
) VALUES (
    :id,
    :external_id,
    '[]',
    :source_hash,
    NOW()
)
SQL,
            [
                'id' => $comboVariantId,
                'external_id' => 'combo-'.$comboVariantId,
                'source_hash' => hash('sha256', $comboVariantId),
            ],
        );
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO combo_analysis_profile (
    combo_variant_id,
    external_id,
    required_oracle_ids,
    required_count,
    combo_size,
    identity,
    features,
    produces_win,
    produces_infinite_mana,
    produces_infinite_damage,
    produces_infinite_tokens,
    produces_infinite_draw,
    produces_mill,
    produces_lock,
    requires_commander,
    requires_graveyard,
    requires_battlefield,
    requires_template,
    combo_power_score,
    combo_complexity_score,
    analysis_hash,
    updated_at
) VALUES (
    :combo_variant_id,
    :external_id,
    :required_oracle_ids,
    2,
    2,
    '[]',
    '["infinite_mana"]',
    false,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    55,
    90,
    :analysis_hash,
    NOW()
)
SQL,
            [
                'combo_variant_id' => $comboVariantId,
                'external_id' => 'combo-'.$comboVariantId,
                'required_oracle_ids' => json_encode([$oracleId], JSON_THROW_ON_ERROR),
                'analysis_hash' => hash('sha256', $comboVariantId.$oracleId),
            ],
        );
    }

    private function roleSource(string $oracleId, string $role): string
    {
        $source = $this->entityManager->getConnection()->fetchOne(
            'SELECT source FROM card_role WHERE oracle_id = :oracleId AND role = :role AND active = true',
            ['oracleId' => $oracleId, 'role' => $role],
        );
        self::assertIsString($source);

        return $source;
    }

    private function hasRole(string $oracleId, string $role): bool
    {
        return (bool) $this->entityManager->getConnection()->fetchOne(
            'SELECT CASE WHEN EXISTS (SELECT 1 FROM card_role WHERE oracle_id = :oracleId AND role = :role AND active = true) THEN 1 ELSE 0 END',
            ['oracleId' => $oracleId, 'role' => $role],
        );
    }

    private function hasSubrole(string $oracleId, string $subrole): bool
    {
        return (bool) $this->entityManager->getConnection()->fetchOne(
            'SELECT CASE WHEN EXISTS (SELECT 1 FROM card_role WHERE oracle_id = :oracleId AND subrole = :subrole AND active = true) THEN 1 ELSE 0 END',
            ['oracleId' => $oracleId, 'subrole' => $subrole],
        );
    }

    private function roleQualityValue(string $oracleId, string $role, string $column): string
    {
        self::assertContains($column, ['quality', 'speed', 'repeatability', 'mana_efficiency', 'conditionality']);
        $value = $this->entityManager->getConnection()->fetchOne(
            sprintf('SELECT %s FROM card_role_quality WHERE oracle_id = :oracleId AND role = :role', $column),
            ['oracleId' => $oracleId, 'role' => $role],
        );
        self::assertIsString($value);

        return $value;
    }

    private function hasPowerFlag(string $oracleId, string $flag): bool
    {
        return (bool) $this->entityManager->getConnection()->fetchOne(
            'SELECT CASE WHEN EXISTS (SELECT 1 FROM card_power_flag WHERE oracle_id = :oracleId AND flag = :flag) THEN 1 ELSE 0 END',
            ['oracleId' => $oracleId, 'flag' => $flag],
        );
    }

    private function hasCondition(string $oracleId, string $conditionKey): bool
    {
        return (bool) $this->entityManager->getConnection()->fetchOne(
            'SELECT CASE WHEN EXISTS (SELECT 1 FROM card_condition WHERE oracle_id = :oracleId AND condition_key = :conditionKey) THEN 1 ELSE 0 END',
            ['oracleId' => $oracleId, 'conditionKey' => $conditionKey],
        );
    }

    private function hasArchetype(string $oracleId, string $archetype): bool
    {
        return (bool) $this->entityManager->getConnection()->fetchOne(
            'SELECT CASE WHEN EXISTS (SELECT 1 FROM card_archetype_signal WHERE oracle_id = :oracleId AND archetype = :archetype) THEN 1 ELSE 0 END',
            ['oracleId' => $oracleId, 'archetype' => $archetype],
        );
    }

    private function generatedRecordCount(string $oracleId): int
    {
        $connection = $this->entityManager->getConnection();

        return (int) $connection->fetchOne(
            <<<'SQL'
SELECT
    (SELECT COUNT(*) FROM card_role WHERE oracle_id = :oracleId)
  + (SELECT COUNT(*) FROM card_role_quality WHERE oracle_id = :oracleId)
  + (SELECT COUNT(*) FROM card_condition WHERE oracle_id = :oracleId)
  + (SELECT COUNT(*) FROM card_archetype_signal WHERE oracle_id = :oracleId)
  + (SELECT COUNT(*) FROM card_power_flag WHERE oracle_id = :oracleId)
SQL,
            ['oracleId' => $oracleId],
        );
    }
}
