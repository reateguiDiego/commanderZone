<?php

namespace App\Tests\Integration;

use App\Application\Deck\DeckAdvancedAnalyzerVersion;
use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;

final class DeckAdvancedAnalysisApiTest extends ApiTestCase
{
    public function testEndpointReturnsCompletedAnalysisAndDoesNotChangeSimpleAnalysis(): void
    {
        [$token, $deck] = $this->advancedDeckFixture('endpoint-completed');

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame($deck->id(), $response['deckId']);
        self::assertSame(DeckAdvancedAnalyzerVersion::CURRENT, $response['analyzerVersion']);
        self::assertSame('completed', $response['summary']['status']);
        self::assertSame(2, $response['metrics']['cards']['totalCards']);
        self::assertSame(1, $response['metrics']['cards']['uniqueCards']);
        self::assertSame(2, $response['metrics']['cards']['resolvedCards']);
        self::assertSame(0, $response['metrics']['cards']['unmatchedCards']);
        self::assertArrayHasKey('roles', $response['metrics']);
        self::assertArrayHasKey('quality', $response['metrics']);
        self::assertArrayHasKey('mana', $response['metrics']);
        self::assertArrayHasKey('boardWipes', $response['metrics']);
        self::assertArrayHasKey('details', $response['metrics']['boardWipes']);
        foreach (['lands', 'landCycles', 'sources', 'untappedSources', 'earlySources', 'ramp', 'fixing', 'fetchlands', 'landCycleAnalysis', 'requirements'] as $manaKey) {
            self::assertArrayHasKey($manaKey, $response['metrics']['mana']);
        }
        self::assertSame(0, $response['combos']['completeCount']);
        self::assertSame([], $response['topComboCompleters']);
        self::assertArrayHasKey('primary', $response['archetypes']);
        self::assertLessThanOrEqual(1, count($response['summary']['secondaryArchetypes']));
        self::assertLessThanOrEqual(1, count($response['archetypes']['secondary']));
        self::assertLessThanOrEqual(2, count($response['archetypes']['scores']));
        self::assertArrayHasKey('typal', $response);
        self::assertFalse($response['typal']['detected']);
        self::assertArrayNotHasKey('band', $response['power']);
        self::assertArrayNotHasKey('confidence', $response['power']);
        self::assertArrayHasKey('signals', $response['power']);
        self::assertSame('monte_carlo', $response['consistency']['method']);
        self::assertArrayHasKey('colorAccess', $response['consistency']);
        self::assertArrayHasKey('commanderCurve', $response['consistency']['colorAccess']);
        self::assertSame('opening_hand_and_card_access', $response['consistency']['scope']);
        self::assertStringContainsString('not match win rate', $response['consistency']['disclaimer']);
        self::assertArrayHasKey('archetypeConfidence', $response['summary']);
        self::assertArrayHasKey('archetypeExplanations', $response['summary']);
        self::assertArrayHasKey('mainWarnings', $response['summary']);
        self::assertIsArray($response['summary']['mainWarnings']);
        self::assertNotEmpty($response['summary']['archetypeExplanations']);
        self::assertArrayHasKey('reasonKey', $response['summary']['archetypeExplanations'][0]);
        self::assertArrayNotHasKey('score', $response['summary']['archetypeExplanations'][0]);
        self::assertArrayNotHasKey('evidence', $response['summary']['archetypeExplanations'][0]);
        self::assertArrayHasKey('reasonKey', $response['archetypes']['scores'][0]);
        self::assertArrayNotHasKey('score', $response['archetypes']['scores'][0]);
        self::assertArrayNotHasKey('evidence', $response['archetypes']['scores'][0]);
        self::assertArrayNotHasKey('powerBand', $response['summary']);
        self::assertArrayNotHasKey('powerConfidence', $response['summary']);
        self::assertArrayHasKey('ramp', $response['health']);
        self::assertArrayHasKey('mana', $response['health']);
        self::assertArrayHasKey('boardWipes', $response['health']);
        self::assertArrayHasKey('evidence', $response['health']['boardWipes']);
        self::assertArrayHasKey('evidence', $response['health']['mana']);
        self::assertArrayHasKey('message', $response['health']['ramp']);
        self::assertArrayHasKey('evidence', $response['health']['ramp']);
        self::assertSame('good', $response['health']['combos']['status']);
        self::assertSame('No combo package detected.', $response['health']['combos']['message']);
        self::assertArrayHasKey('suggestedActionType', $response['issues'][0]);
        self::assertArrayNotHasKey('recommendations', $response);
        self::assertFalse($response['snapshot']['hit']);
        self::assertSame('missing', $response['snapshot']['reason']);
        self::assertArrayHasKey('manaDataVersion', $response['snapshot']);
        self::assertSame(DeckAdvancedAnalyzerVersion::DEFAULT_MONTE_CARLO_RUNS, $response['snapshot']['monteCarloRuns']);

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis', token: $token);
        self::assertResponseIsSuccessful();
        $simple = $this->jsonResponse();
        self::assertArrayHasKey('manaCurve', $simple);
        self::assertArrayNotHasKey('snapshot', $simple);
    }

    public function testEndpointReturnsCardReferencesForHealthAndPowerSignals(): void
    {
        $token = $this->registerAndLogin('advanced-card-references@example.test', 'Advanced Refs');
        $user = $this->entityManager->getRepository(User::class)->find($this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);
        $user->updateCardLanguage('es');

        $solRing = $this->seedCard('99000000-0000-0000-0000-000000001001', 'Sol Ring', [
            'oracle_id' => '99000000-0000-0000-0001-000000001001',
            'set' => 'tst',
            'collector_number' => '1',
            'layout' => 'transform',
            'card_faces' => [
                [
                    'name' => 'Sol Ring',
                    'type_line' => 'Artifact',
                    'image_uris' => [
                        'normal' => 'https://cards.scryfall.io/normal/front/99000000-0000-0000-0000-000000001001.jpg',
                    ],
                ],
                [
                    'name' => 'Sol Ring Back',
                    'type_line' => 'Artifact',
                    'image_uris' => [
                        'normal' => 'https://cards.scryfall.io/normal/back/99000000-0000-0000-0000-000000001001.jpg',
                    ],
                ],
            ],
        ]);
        $this->seedCard('99000000-0000-0000-0000-000000001101', 'Sol Ring', [
            'oracle_id' => '99000000-0000-0000-0001-000000001001',
            'set' => 'tst',
            'collector_number' => '1',
            'lang' => 'es',
            'printed_name' => 'Anillo solar',
            'layout' => 'transform',
            'image_uris' => [
                'normal' => 'https://cards.scryfall.io/normal/front/99000000-0000-0000-0000-000000001101-es.jpg',
            ],
            'card_faces' => [
                [
                    'name' => 'Sol Ring',
                    'type_line' => 'Artifact',
                    'image_uris' => [
                        'normal' => 'https://cards.scryfall.io/normal/front/99000000-0000-0000-0000-000000001101-es.jpg',
                    ],
                ],
                [
                    'name' => 'Sol Ring Back',
                    'type_line' => 'Artifact',
                    'image_uris' => [
                        'normal' => 'https://cards.scryfall.io/normal/back/99000000-0000-0000-0000-000000001101-es.jpg',
                    ],
                ],
            ],
        ]);
        $wrath = $this->seedCard('99000000-0000-0000-0000-000000001002', 'Wrath of God', [
            'oracle_id' => '99000000-0000-0000-0001-000000001002',
            'set' => 'tst',
            'collector_number' => '2',
        ]);
        $rift = $this->seedCard('99000000-0000-0000-0000-000000001003', 'Cyclonic Rift', [
            'oracle_id' => '99000000-0000-0000-0001-000000001003',
            'set' => 'tst',
            'collector_number' => '3',
        ]);
        $farewell = $this->seedCard('99000000-0000-0000-0000-000000001004', 'Farewell', [
            'oracle_id' => '99000000-0000-0000-0001-000000001004',
            'set' => 'tst',
            'collector_number' => '4',
        ]);

        $this->insertAnalysisProfile($solRing->oracleId(), 'Sol Ring', roles: ['ramp', 'fast_mana'], roleScores: [
            'ramp' => ['quality' => 'premium', 'repeatability' => 'repeatable'],
        ], powerFlags: ['fast_mana']);
        $this->insertAnalysisProfile($wrath->oracleId(), 'Wrath of God', roles: ['board_wipe']);
        $this->insertAnalysisProfile($rift->oracleId(), 'Cyclonic Rift', subroles: ['mass_bounce']);
        $this->insertAnalysisProfile($farewell->oracleId(), 'Farewell', roles: ['board_wipe'], subroles: ['conditional_wipe']);
        $this->insertBoardWipeProfile($wrath->oracleId(), 'Wrath of God', methods: ['destroy'], scope: ['creatures'], hardCreature: true);
        $this->insertBoardWipeProfile($rift->oracleId(), 'Cyclonic Rift', type: 'bounce_wipe', methods: ['bounce'], scope: ['nonland_permanents', 'opponents_only'], symmetry: 'one_sided', overload: true);
        $this->insertBoardWipeProfile($farewell->oracleId(), 'Farewell', type: 'modal_wipe', methods: ['exile', 'graveyard_exile'], scope: ['artifacts', 'creatures', 'enchantments', 'graveyards'], modal: true, answersIndestructible: true);

        $deck = new Deck($user, 'Advanced Card References');
        $deckCardIds = [];
        foreach ([$solRing, $wrath, $rift, $farewell] as $card) {
            $deckCardIds[$card->oracleId()] = $deck->addOrIncrementCard($card, 1, DeckCard::SECTION_MAIN)->id();
        }
        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame($deckCardIds[$solRing->oracleId()], $response['metrics']['roleCards']['permanentRamp'][0]);
        self::assertArrayNotHasKey('name', $response['health']['ramp']['cards'][0]);
        self::assertArrayNotHasKey('cardId', $response['health']['ramp']['cards'][0]);
        self::assertArrayNotHasKey('imageUris', $response['health']['ramp']['cards'][0]);
        self::assertContains('permanentRamp', $response['health']['ramp']['cards'][0]['matchedMetrics']);
        self::assertEqualsCanonicalizing(
            [$wrath->oracleId(), $farewell->oracleId(), $rift->oracleId()],
            array_column($response['health']['wipes']['cards'], 'oracleId'),
        );
        $farewellReference = array_values(array_filter(
            $response['health']['wipes']['cards'],
            static fn (array $card): bool => ($card['oracleId'] ?? null) === $farewell->oracleId(),
        ))[0] ?? null;
        self::assertIsArray($farewellReference);
        self::assertContains('modalWipes', $farewellReference['matchedMetrics']);
        $wrathReference = array_values(array_filter(
            $response['health']['wipes']['cards'],
            static fn (array $card): bool => ($card['oracleId'] ?? null) === $wrath->oracleId(),
        ))[0] ?? null;
        self::assertIsArray($wrathReference);
        self::assertArrayNotHasKey('imageUrl', $wrathReference);
        self::assertSame($deckCardIds[$solRing->oracleId()], $response['power']['signalCards']['fastMana'][0]);
        self::assertContains($deckCardIds[$solRing->oracleId()], $response['metrics']['qualityCards']['ramp']['premium']);
        self::assertContains($deckCardIds[$solRing->oracleId()], array_column($response['health']['consistency']['cards'], 'deckCardId'));
        self::assertContains($deckCardIds[$solRing->oracleId()], array_column($response['health']['mana']['cards'], 'deckCardId'));
        self::assertSame([], $response['cardCatalog']);

        $snapshotJson = (string) $this->entityManager->getConnection()->fetchOne(
            'SELECT result_json::text FROM deck_advanced_analysis_snapshot WHERE deck_id = :deckId',
            ['deckId' => $deck->id()],
        );
        self::assertStringNotContainsString('imageUris', $snapshotJson);
        self::assertStringNotContainsString('cardFaces', $snapshotJson);
    }

    public function testManaSourcesAreFilteredToDeckColorIdentityInResponseAndSnapshot(): void
    {
        $token = $this->registerAndLogin('advanced-mana-identity@example.test', 'Mana Identity');
        $user = $this->entityManager->getRepository(User::class)->find($this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);

        $commander = $this->seedCard('99000000-0000-0000-0000-000000009901', 'Azorius Commander', [
            'oracle_id' => '99000000-0000-0000-0001-000000009901',
            'color_identity' => ['W', 'U'],
        ]);
        $triome = $this->seedCard('99000000-0000-0000-0000-000000009902', 'Raugrin Triome', [
            'oracle_id' => '99000000-0000-0000-0001-000000009902',
        ]);
        $this->insertAnalysisProfile($commander->oracleId(), 'Azorius Commander', typeLine: 'Legendary Creature', colorIdentity: ['W', 'U']);
        $this->insertAnalysisProfile($triome->oracleId(), 'Raugrin Triome', typeLine: 'Land', isLand: true);
        $this->insertManaProfile($triome->oracleId(), 'Raugrin Triome', ['W', 'U', 'R'], ['Plains', 'Island', 'Mountain'], cycle: 'triome');

        $deck = new Deck($user, 'Advanced Mana Identity');
        $deck->addOrIncrementCard($commander, 1, DeckCard::SECTION_COMMANDER);
        $deck->addOrIncrementCard($triome, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertArrayHasKey('white', $response['metrics']['mana']['sources']);
        self::assertArrayHasKey('blue', $response['metrics']['mana']['sources']);
        self::assertArrayNotHasKey('black', $response['metrics']['mana']['sources']);
        self::assertArrayNotHasKey('red', $response['metrics']['mana']['sources']);
        self::assertArrayNotHasKey('green', $response['metrics']['mana']['sources']);

        $stored = $this->connection()->fetchOne('SELECT result_json::text FROM deck_advanced_analysis_snapshot WHERE deck_id = :deckId', ['deckId' => $deck->id()]);
        self::assertIsString($stored);
        $snapshot = json_decode($stored, true, 512, JSON_THROW_ON_ERROR);
        self::assertArrayNotHasKey('red', $snapshot['metrics']['mana']['sources']);
        self::assertArrayNotHasKey('green', $snapshot['metrics']['mana']['sources']);
    }

    public function testEndpointDetectsElfTypalDeckWithVisualCardReferences(): void
    {
        $token = $this->registerAndLogin('advanced-typal-elf@example.test', 'Advanced Typal');
        $user = $this->entityManager->getRepository(User::class)->find($this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);

        $commander = $this->seedCard('99000000-0000-0000-0000-000000002000', 'Lathril, Blade of the Elves', [
            'oracle_id' => '99000000-0000-0000-0001-000000002000',
        ]);
        $this->insertAnalysisProfile($commander->oracleId(), 'Lathril, Blade of the Elves', typeLine: 'Legendary Creature - Elf Noble');

        $deck = new Deck($user, 'Advanced Elf Typal');
        $commanderEntry = $deck->addOrIncrementCard($commander, 1, DeckCard::SECTION_COMMANDER);

        for ($index = 1; $index <= 14; ++$index) {
            $card = $this->seedCard(sprintf('99000000-0000-0000-0000-000000002%03d', $index), 'Elf Scout '.$index, [
                'oracle_id' => sprintf('99000000-0000-0000-0001-000000002%03d', $index),
            ]);
            $this->insertAnalysisProfile($card->oracleId(), 'Elf Scout '.$index, typeLine: 'Creature - Elf Scout');
            $deck->addOrIncrementCard($card, 1, DeckCard::SECTION_MAIN);
        }

        $firstSupportEntry = null;
        for ($index = 1; $index <= 2; ++$index) {
            $card = $this->seedCard(sprintf('99000000-0000-0000-0000-000000003%03d', $index), 'Elf Warcaller '.$index, [
                'oracle_id' => sprintf('99000000-0000-0000-0001-000000003%03d', $index),
            ]);
            $this->insertAnalysisProfile($card->oracleId(), 'Elf Warcaller '.$index, subroles: ['typal'], archetypeWeights: ['typal' => 4], typeLine: 'Creature - Elf Advisor');
            $entry = $deck->addOrIncrementCard($card, 1, DeckCard::SECTION_MAIN);
            $firstSupportEntry ??= $entry;
        }

        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertTrue($response['typal']['detected']);
        self::assertSame('Elf', $response['typal']['primaryType']);
        self::assertSame('Elf', $response['summary']['primaryTypalType']);
        self::assertSame('typal', $response['archetypes']['primary']);
        self::assertTrue($response['typal']['commanderMatches']);
        self::assertGreaterThanOrEqual(17, $response['typal']['creatureCount']);
        self::assertSame(2, $response['typal']['supportCount']);

        $elfType = $response['typal']['types'][0];
        self::assertSame('Elf', $elfType['type']);
        self::assertContains($commanderEntry->id(), $elfType['creatureCards']);
        self::assertNotNull($firstSupportEntry);
        self::assertContains($firstSupportEntry->id(), $elfType['supportCards']);
        $typalScore = array_values(array_filter(
            $response['archetypes']['scores'],
            static fn (array $score): bool => ($score['archetype'] ?? null) === 'typal',
        ))[0] ?? null;
        self::assertIsArray($typalScore);
        self::assertContains($commanderEntry->id(), $typalScore['cards']);
        self::assertContains($commanderEntry->id(), $response['summary']['archetypeExplanations'][0]['cards']);
        self::assertArrayNotHasKey('combo_pieces_without_complete_combos', array_flip(array_column($response['issues'], 'code')));
    }

    public function testEndpointDoesNotDetectTypalForDispersedCreatureTypes(): void
    {
        $token = $this->registerAndLogin('advanced-typal-dispersed@example.test', 'Advanced Mixed');
        $user = $this->entityManager->getRepository(User::class)->find($this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);
        $deck = new Deck($user, 'Advanced Dispersed Creatures');

        $types = ['Elf', 'Goblin', 'Zombie', 'Human', 'Merfolk', 'Wizard', 'Warrior', 'Cleric', 'Druid', 'Vampire'];
        foreach ($types as $index => $type) {
            $card = $this->seedCard(sprintf('99000000-0000-0000-0000-000000004%03d', $index), $type.' Creature', [
                'oracle_id' => sprintf('99000000-0000-0000-0001-000000004%03d', $index),
            ]);
            $this->insertAnalysisProfile($card->oracleId(), $type.' Creature', typeLine: 'Creature - '.$type);
            $deck->addOrIncrementCard($card, 1, DeckCard::SECTION_MAIN);
        }

        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertFalse($response['typal']['detected']);
        self::assertNull($response['typal']['primaryType']);
        self::assertNull($response['summary']['primaryTypalType']);
    }

    public function testEndpointWarnsForTypalSupportWithoutCreatureDensity(): void
    {
        $token = $this->registerAndLogin('advanced-typal-support-gap@example.test', 'Advanced Typal Gap');
        $user = $this->entityManager->getRepository(User::class)->find($this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);
        $deck = new Deck($user, 'Advanced Typal Support Gap');

        for ($index = 1; $index <= 3; ++$index) {
            $card = $this->seedCard(sprintf('99000000-0000-0000-0000-000000005%03d', $index), 'Sparse Elf Lord '.$index, [
                'oracle_id' => sprintf('99000000-0000-0000-0001-000000005%03d', $index),
            ]);
            $this->insertAnalysisProfile($card->oracleId(), 'Sparse Elf Lord '.$index, subroles: ['typal'], archetypeWeights: ['typal' => 4], typeLine: 'Creature - Elf Noble');
            $deck->addOrIncrementCard($card, 1, DeckCard::SECTION_MAIN);
        }

        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertFalse($response['typal']['detected']);
        self::assertContains('typal_support_without_density', array_column($response['issues'], 'code'));
        self::assertArrayNotHasKey('recommendations', $response);
    }

    public function testEndpointRespectsDeckOwnership(): void
    {
        [$token, $deck] = $this->advancedDeckFixture('endpoint-permissions');
        $otherToken = $this->registerAndLogin('advanced-other@example.test', 'Advanced Other');

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $otherToken);

        self::assertResponseStatusCodeSame(404);
        self::assertSame('0', (string) $this->connection()->fetchOne('SELECT COUNT(*) FROM deck_advanced_analysis_snapshot WHERE deck_id = :deckId', ['deckId' => $deck->id()]));

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);
        self::assertResponseIsSuccessful();
    }

    public function testEndpointUsesSnapshotAndInvalidatesWhenDeckChanges(): void
    {
        [$token, $deck] = $this->advancedDeckFixture('endpoint-snapshot');
        $extraCard = $this->seedCard('99000000-0000-0000-0000-000000000901', 'Advanced Extra', [
            'oracle_id' => '99000000-0000-0000-0001-000000000901',
        ]);
        $this->insertAnalysisProfile($extraCard->oracleId(), 'Advanced Extra');

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('missing', $this->jsonResponse()['snapshot']['reason']);

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);
        self::assertResponseIsSuccessful();
        $second = $this->jsonResponse();
        self::assertTrue($second['snapshot']['hit']);
        self::assertSame('fresh', $second['snapshot']['reason']);

        $deck->addOrIncrementCard($extraCard, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->flush();

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);
        self::assertResponseIsSuccessful();
        $third = $this->jsonResponse();
        self::assertFalse($third['snapshot']['hit']);
        self::assertSame('deck_hash_changed', $third['snapshot']['reason']);
        self::assertSame(3, $third['metrics']['cards']['resolvedCards']);
    }

    public function testEndpointIgnoresNonPlayableSectionsForAdvancedAnalysis(): void
    {
        [$token, $deck] = $this->advancedDeckFixture('non-playable-sections');
        $sideboard = $this->seedCard('99000000-0000-0000-0000-000000000911', 'Sideboard Tutor', [
            'oracle_id' => '99000000-0000-0000-0001-000000000911',
        ]);
        $maybeboard = $this->seedCard('99000000-0000-0000-0000-000000000912', 'Maybeboard Ramp', [
            'oracle_id' => '99000000-0000-0000-0001-000000000912',
        ]);
        $this->insertAnalysisProfile($sideboard->oracleId(), 'Sideboard Tutor', roles: ['tutor'], subroles: ['true_tutor']);
        $this->insertAnalysisProfile($maybeboard->oracleId(), 'Maybeboard Ramp', roles: ['ramp']);
        $deck->addOrIncrementCard($sideboard, 4, DeckCard::SECTION_SIDEBOARD);
        $deck->addOrIncrementCard($maybeboard, 3, DeckCard::SECTION_MAYBEBOARD);
        $this->entityManager->flush();

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(2, $response['metrics']['cards']['totalCards']);
        self::assertSame(2, $response['metrics']['cards']['resolvedCards']);
        self::assertSame(0, $response['metrics']['roles']['trueTutors']);
    }

    public function testFetchLandsDoNotCountAsTutors(): void
    {
        $token = $this->registerAndLogin('advanced-fetch@example.test', 'Advanced Fetch');
        $user = $this->entityManager->getRepository(User::class)->find($this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);
        $fetch = $this->seedCard('99000000-0000-0000-0000-000000000913', 'Polluted Delta', [
            'oracle_id' => '99000000-0000-0000-0001-000000000913',
            'type_line' => 'Land',
            'oracle_text' => '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.',
        ]);
        $this->insertAnalysisProfile(
            $fetch->oracleId(),
            'Polluted Delta',
            roles: ['tutor'],
            subroles: ['land_tutor', 'ramp_search'],
            roleScores: ['tutor' => ['quality' => 'premium']],
            typeLine: 'Land',
            isLand: true,
        );
        $deck = new Deck($user, 'Advanced Fetch');
        $deck->addOrIncrementCard($fetch, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);

        self::assertResponseIsSuccessful();
        $roles = $this->jsonResponse()['metrics']['roles'];
        self::assertSame(0, $roles['trueTutors']);
        self::assertSame(0, $roles['typedTutors']);
        self::assertSame(0, $roles['landTutors']);
        self::assertSame(0, $roles['rampSearch']);
    }

    public function testManaFetchlandDetailsIncludeRenderableCardReferences(): void
    {
        $token = $this->registerAndLogin('advanced-fetch-visuals@example.test', 'Fetch Visuals');
        $user = $this->entityManager->getRepository(User::class)->find($this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);

        $fetch = $this->seedCard('99000000-0000-0000-0000-000000002001', 'Wooded Foothills', [
            'oracle_id' => '99000000-0000-0000-0001-000000002001',
            'type_line' => 'Land',
            'oracle_text' => '{T}, Pay 1 life, Sacrifice Wooded Foothills: Search your library for a Mountain or Forest card, put it onto the battlefield, then shuffle.',
        ]);
        $shock = $this->seedCard('99000000-0000-0000-0000-000000002002', 'Stomping Ground', [
            'oracle_id' => '99000000-0000-0000-0001-000000002002',
            'type_line' => 'Land - Mountain Forest',
            'oracle_text' => 'As Stomping Ground enters, you may pay 2 life. If you do not, it enters tapped.',
        ]);
        $battle = $this->seedCard('99000000-0000-0000-0000-000000002003', 'Cinder Glade', [
            'oracle_id' => '99000000-0000-0000-0001-000000002003',
            'type_line' => 'Land - Mountain Forest',
            'oracle_text' => 'Cinder Glade enters tapped unless you control two or more basic lands.',
        ]);

        $this->insertAnalysisProfile($fetch->oracleId(), 'Wooded Foothills', typeLine: $fetch->typeLine() ?? 'Land', isLand: true);
        $this->insertAnalysisProfile($shock->oracleId(), 'Stomping Ground', typeLine: $shock->typeLine() ?? 'Land', isLand: true);
        $this->insertAnalysisProfile($battle->oracleId(), 'Cinder Glade', typeLine: $battle->typeLine() ?? 'Land', isLand: true);
        $this->insertManaProfile($fetch->oracleId(), 'Wooded Foothills', fetchableTypes: ['Mountain', 'Forest'], isFetchland: true, cycle: 'fetchland');
        $this->insertManaProfile($shock->oracleId(), 'Stomping Ground', colors: ['R', 'G'], basicTypes: ['Mountain', 'Forest'], cycle: 'shockland', canEnterUntapped: true);
        $this->insertManaProfile($battle->oracleId(), 'Cinder Glade', colors: ['R', 'G'], basicTypes: ['Mountain', 'Forest'], cycle: 'battle_land', conditional: true, canEnterUntapped: true);

        $deck = new Deck($user, 'Advanced Fetch Visuals');
        $deck->addOrIncrementCard($fetch, 1, DeckCard::SECTION_MAIN);
        $deck->addOrIncrementCard($shock, 1, DeckCard::SECTION_MAIN);
        $deck->addOrIncrementCard($battle, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);

        self::assertResponseIsSuccessful();
        $details = $this->jsonResponse()['metrics']['mana']['fetchlands']['details'];
        self::assertCount(1, $details);
        $detail = $details[0];
        self::assertArrayNotHasKey('fetchland', $detail);
        self::assertSame($fetch->oracleId(), $detail['oracleId']);
        self::assertArrayNotHasKey('cardId', $detail);
        self::assertArrayNotHasKey('name', $detail);
        self::assertArrayNotHasKey('imageUrl', $detail);
        self::assertArrayNotHasKey('validTargets', $detail);
        self::assertSame(['red', 'green'], $detail['effectiveColors']);
        self::assertSame(['red', 'green'], $detail['untappedEffectiveColors']);
        self::assertSame([], $detail['tappedOnlyEffectiveColors']);
    }

    public function testEndpointReturnsNotFoundForMissingDeck(): void
    {
        $token = $this->registerAndLogin('advanced-missing-deck@example.test', 'Advanced Missing');

        $this->jsonRequest('GET', '/decks/00000000-0000-0000-0000-000000000000/analysis/advanced', token: $token);

        self::assertResponseStatusCodeSame(404);
    }

    public function testEndpointReturnsUnmatchedCardsWithoutFailing(): void
    {
        $token = $this->registerAndLogin('advanced-unmatched@example.test', 'Advanced Unmatched');
        $user = $this->entityManager->getRepository(User::class)->find($this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);
        $card = $this->seedCard('99000000-0000-0000-0000-000000000902', 'Advanced Missing Oracle', [
            'oracle_id' => null,
        ]);
        $deck = new Deck($user, 'Advanced Unmatched');
        $deck->addOrIncrementCard($card, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(1, $response['metrics']['cards']['unmatchedCards']);
        self::assertSame('missing_oracle_id', $response['unmatchedCards'][0]['reason']);
        self::assertArrayNotHasKey('cardId', $response['unmatchedCards'][0]);
    }

    /**
     * @return array{0:string,1:Deck}
     */
    private function advancedDeckFixture(string $suffix): array
    {
        $token = $this->registerAndLogin('advanced-'.$suffix.'@example.test', substr('Adv'.$suffix, 0, 20));
        $user = $this->entityManager->getRepository(User::class)->find($this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);
        $card = $this->seedCard('99000000-0000-0000-0000-'.substr(md5($suffix), 0, 12), 'Advanced Card '.$suffix, [
            'oracle_id' => '99000000-0000-0000-0001-'.substr(md5($suffix), 0, 12),
        ]);
        $this->insertAnalysisProfile($card->oracleId(), 'Advanced Card '.$suffix);
        $deck = new Deck($user, 'Advanced '.$suffix);
        $deck->addOrIncrementCard($card, 2, DeckCard::SECTION_MAIN);
        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        return [$token, $deck];
    }

    private function connection(): \Doctrine\DBAL\Connection
    {
        return $this->entityManager->getConnection();
    }

    /**
     * @param list<string> $roles
     * @param list<string> $subroles
     * @param array<string,mixed> $roleScores
     * @param list<string> $conditionKeys
     * @param list<string> $powerFlags
     */
    private function insertAnalysisProfile(
        ?string $oracleId,
        string $name,
        array $roles = [],
        array $subroles = [],
        array $roleScores = [],
        array $conditionKeys = [],
        array $powerFlags = [],
        array $archetypeWeights = [],
        string $typeLine = 'Artifact',
        array $colorIdentity = [],
        bool $isLand = false,
    ): void {
        self::assertNotNull($oracleId);
        $this->connection()->executeStatement(
            <<<'SQL'
INSERT INTO card_analysis_profile (
    oracle_id,
    name,
    normalized_name,
    mana_value,
    type_line,
    colors,
    color_identity,
    produced_mana,
    keywords,
    commander_legal,
    roles,
    subroles,
    role_scores,
    condition_keys,
    archetype_weights,
    power_flags,
    is_land,
    analysis_hash,
    updated_at
) VALUES (
    :oracle_id,
    :name,
    :normalized_name,
    1,
    :type_line,
    '[]'::jsonb,
    :color_identity::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    true,
    :roles::jsonb,
    :subroles::jsonb,
    :role_scores::jsonb,
    :condition_keys::jsonb,
    :archetype_weights::jsonb,
    :power_flags::jsonb,
    :is_land,
    :analysis_hash,
    NOW()
)
SQL,
            [
                'oracle_id' => $oracleId,
                'name' => $name,
                'normalized_name' => mb_strtolower($name),
                'roles' => json_encode($roles, JSON_THROW_ON_ERROR),
                'subroles' => json_encode($subroles, JSON_THROW_ON_ERROR),
                'role_scores' => json_encode($roleScores, JSON_THROW_ON_ERROR),
                'condition_keys' => json_encode($conditionKeys, JSON_THROW_ON_ERROR),
                'type_line' => $typeLine,
                'color_identity' => json_encode($colorIdentity, JSON_THROW_ON_ERROR),
                'archetype_weights' => json_encode($archetypeWeights, JSON_THROW_ON_ERROR),
                'power_flags' => json_encode($powerFlags, JSON_THROW_ON_ERROR),
                'is_land' => $isLand,
                'analysis_hash' => hash('sha256', $oracleId),
            ],
            [
                'is_land' => \Doctrine\DBAL\ParameterType::BOOLEAN,
            ],
        );
    }

    /**
     * @param list<string> $colors
     * @param list<string> $basicTypes
     * @param list<string> $fetchableTypes
     */
    private function insertManaProfile(
        ?string $oracleId,
        string $name,
        array $colors = [],
        array $basicTypes = [],
        array $fetchableTypes = [],
        bool $isFetchland = false,
        string $cycle = 'land',
        bool $basic = false,
        bool $conditional = false,
        bool $canEnterUntapped = false,
    ): void {
        self::assertNotNull($oracleId);
        $this->connection()->executeStatement(
            <<<'SQL'
INSERT INTO card_mana_profile (
    oracle_id,
    name,
    type_line,
    is_land,
    is_basic_land,
    is_nonbasic_land,
    is_fetchland,
    is_typed_land,
    basic_land_types,
    produced_mana_colors,
    enters_tapped_conditionally,
    can_enter_untapped,
    mana_source_category,
    land_cycle_type,
    land_speed_profile,
    fetchable_land_types,
    updated_at
) VALUES (
    :oracle_id,
    :name,
    :type_line,
    true,
    :is_basic_land,
    :is_nonbasic_land,
    :is_fetchland,
    :is_typed_land,
    :basic_land_types::jsonb,
    :produced_mana_colors::jsonb,
    :enters_tapped_conditionally,
    :can_enter_untapped,
    :mana_source_category,
    :land_cycle_type,
    :land_speed_profile,
    :fetchable_land_types::jsonb,
    NOW()
)
SQL,
            [
                'oracle_id' => $oracleId,
                'name' => $name,
                'type_line' => $basicTypes === [] ? 'Land' : 'Land - '.implode(' ', $basicTypes),
                'is_basic_land' => $basic,
                'is_nonbasic_land' => !$basic,
                'is_fetchland' => $isFetchland,
                'is_typed_land' => $basicTypes !== [],
                'basic_land_types' => json_encode($basicTypes, JSON_THROW_ON_ERROR),
                'produced_mana_colors' => json_encode($colors, JSON_THROW_ON_ERROR),
                'enters_tapped_conditionally' => $conditional,
                'can_enter_untapped' => $canEnterUntapped,
                'mana_source_category' => $isFetchland ? 'fetchland' : 'land',
                'land_cycle_type' => $cycle,
                'land_speed_profile' => $canEnterUntapped ? 'always_untapped' : 'unknown',
                'fetchable_land_types' => json_encode($fetchableTypes, JSON_THROW_ON_ERROR),
            ],
            [
                'is_basic_land' => \Doctrine\DBAL\ParameterType::BOOLEAN,
                'is_nonbasic_land' => \Doctrine\DBAL\ParameterType::BOOLEAN,
                'is_fetchland' => \Doctrine\DBAL\ParameterType::BOOLEAN,
                'is_typed_land' => \Doctrine\DBAL\ParameterType::BOOLEAN,
                'enters_tapped_conditionally' => \Doctrine\DBAL\ParameterType::BOOLEAN,
                'can_enter_untapped' => \Doctrine\DBAL\ParameterType::BOOLEAN,
            ],
        );
    }

    /**
     * @param list<string> $methods
     * @param list<string> $scope
     */
    private function insertBoardWipeProfile(
        ?string $oracleId,
        string $name,
        string $type = 'hard_creature_wipe',
        array $methods = ['destroy'],
        array $scope = ['creatures'],
        string $symmetry = 'symmetrical',
        bool $hardCreature = false,
        bool $modal = false,
        bool $overload = false,
        bool $answersIndestructible = false,
    ): void {
        self::assertNotNull($oracleId);
        $this->connection()->executeStatement(
            <<<'SQL'
INSERT INTO card_board_wipe_profile (
    oracle_id,
    name,
    mana_value,
    is_board_wipe,
    is_creature_wipe,
    board_wipe_type,
    wipe_method,
    wipe_scope,
    symmetry_profile,
    effective_cost_min,
    has_modes,
    has_alternative_mass_mode,
    alternative_cost_type,
    mass_mode_type,
    answers_indestructible,
    gets_around_hexproof_shroud,
    analysis_hash,
    updated_at
) VALUES (
    :oracle_id,
    :name,
    4,
    true,
    :is_creature_wipe,
    :board_wipe_type,
    :wipe_method::jsonb,
    :wipe_scope::jsonb,
    :symmetry_profile,
    4,
    :has_modes,
    :has_alternative_mass_mode,
    :alternative_cost_type,
    :mass_mode_type,
    :answers_indestructible,
    :gets_around_hexproof_shroud,
    :analysis_hash,
    NOW()
)
SQL,
            [
                'oracle_id' => $oracleId,
                'name' => $name,
                'is_creature_wipe' => $hardCreature || in_array('creatures', $scope, true),
                'board_wipe_type' => $type,
                'wipe_method' => json_encode($methods, JSON_THROW_ON_ERROR),
                'wipe_scope' => json_encode($scope, JSON_THROW_ON_ERROR),
                'symmetry_profile' => $symmetry,
                'has_modes' => $modal,
                'has_alternative_mass_mode' => $overload,
                'alternative_cost_type' => $overload ? 'overload' : null,
                'mass_mode_type' => in_array('bounce', $methods, true) ? 'mass_bounce' : 'board_wipe',
                'answers_indestructible' => $answersIndestructible,
                'gets_around_hexproof_shroud' => $hardCreature,
                'analysis_hash' => hash('sha256', $oracleId.$name),
            ],
            [
                'is_creature_wipe' => \Doctrine\DBAL\ParameterType::BOOLEAN,
                'has_modes' => \Doctrine\DBAL\ParameterType::BOOLEAN,
                'has_alternative_mass_mode' => \Doctrine\DBAL\ParameterType::BOOLEAN,
                'answers_indestructible' => \Doctrine\DBAL\ParameterType::BOOLEAN,
                'gets_around_hexproof_shroud' => \Doctrine\DBAL\ParameterType::BOOLEAN,
            ],
        );
    }
}
