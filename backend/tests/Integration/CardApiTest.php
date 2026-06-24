<?php

namespace App\Tests\Integration;

class CardApiTest extends ApiTestCase
{
    public function testSearchShowImageAndResolveCards(): void
    {
        $card = $this->seedCard('00000000-0000-0000-0000-000000000001', 'Sol Ring', [
            'set' => 'tst',
            'collector_number' => '1',
        ]);

        $this->jsonRequest('GET', '/cards/search?q=Sol%20Ring&commanderLegal=true&type=artifact&limit=5');
        self::assertResponseIsSuccessful();
        self::assertSame($card->scryfallId(), $this->jsonResponse()['data'][0]['scryfallId']);

        $this->jsonRequest('GET', '/cards/'.$card->scryfallId());
        self::assertResponseIsSuccessful();
        self::assertSame('Sol Ring', $this->jsonResponse()['card']['name']);
        self::assertFalse($this->jsonResponse()['card']['hasRulings']);

        $this->jsonRequest('GET', '/cards/'.$card->scryfallId().'/image?format=normal&mode=uri');
        self::assertResponseIsSuccessful();
        self::assertStringStartsWith('https://cards.scryfall.io/', $this->jsonResponse()['uri']);

        $this->jsonRequest('GET', '/cards/'.$card->scryfallId().'/image?format=art_crop&mode=uri');
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('GET', '/cards/'.$card->scryfallId().'/image?format=normal&mode=redirect');
        self::assertResponseRedirects();

        $this->jsonRequest('GET', '/cards/resolve?scryfallId='.$card->scryfallId());
        self::assertResponseIsSuccessful();
        self::assertSame($card->scryfallId(), $this->jsonResponse()['card']['scryfallId']);

        $this->jsonRequest('GET', '/cards/resolve?setCode=tst&collectorNumber=1');
        self::assertResponseIsSuccessful();
        self::assertSame($card->scryfallId(), $this->jsonResponse()['card']['scryfallId']);
    }

    public function testCardLanguagesReportDistinctNameCoverageAgainstEnglish(): void
    {
        $this->seedCard('00000000-0000-0000-0000-0000000000d1', 'Sol Ring', [
            'set' => 'one',
            'collector_number' => '1',
            'lang' => 'en',
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000d2', 'Sol Ring', [
            'set' => 'two',
            'collector_number' => '2',
            'lang' => 'en',
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000d3', 'Arcane Signet', [
            'set' => 'three',
            'collector_number' => '3',
            'lang' => 'en',
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000d4', 'Sol Ring', [
            'set' => 'four',
            'collector_number' => '4',
            'lang' => 'es',
            'printed_name' => 'Anillo solar',
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000d5', 'Sol Ring', [
            'set' => 'five',
            'collector_number' => '5',
            'lang' => 'ph',
            'printed_name' => 'Sol Ring PH',
        ]);

        $this->jsonRequest('GET', '/cards/languages');

        self::assertResponseIsSuccessful();
        self::assertSame('en', $this->jsonResponse()['selectedCardLanguage']);
        $languages = [];
        foreach ($this->jsonResponse()['data'] as $language) {
            $languages[(string) $language['code']] = $language;
        }

        self::assertArrayHasKey('en', $languages);
        self::assertArrayHasKey('es', $languages);
        self::assertArrayNotHasKey('ph', $languages);
        self::assertSame(2, $languages['en']['distinctCardNames']);
        self::assertSame(1, $languages['es']['distinctCardNames']);
        self::assertEquals(100.0, $languages['en']['percentageOfEnglish']);
        self::assertEquals(50.0, $languages['es']['percentageOfEnglish']);

        $token = $this->registerAndLogin('cards-language@example.test', 'Cards Language');
        $this->jsonRequest('PATCH', '/me', ['cardLanguage' => 'es'], $token);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('GET', '/cards/languages', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('es', $this->jsonResponse()['selectedCardLanguage']);
    }

    public function testShowsDoubleFacedCardFaces(): void
    {
        $card = $this->seedCard('00000000-0000-0000-0000-000000000003', 'Invasion of Zendikar // Awakened Skyclave', [
            'layout' => 'transform',
            'type_line' => 'Battle - Siege',
            'card_faces' => [
                [
                    'name' => 'Invasion of Zendikar',
                    'mana_cost' => '{3}{G}',
                    'type_line' => 'Battle - Siege',
                    'oracle_text' => 'Search your library for up to two basic land cards.',
                    'colors' => ['G'],
                    'image_uris' => ['normal' => 'https://cards.scryfall.io/front.jpg'],
                ],
                [
                    'name' => 'Awakened Skyclave',
                    'type_line' => 'Creature - Elemental',
                    'oracle_text' => 'Vigilance, haste',
                    'power' => '4',
                    'toughness' => '4',
                    'colors' => ['G'],
                    'image_uris' => ['normal' => 'https://cards.scryfall.io/back.jpg'],
                ],
            ],
        ]);

        $this->jsonRequest('GET', '/cards/'.$card->scryfallId());

        self::assertResponseIsSuccessful();
        $faces = $this->jsonResponse()['card']['cardFaces'];
        self::assertCount(2, $faces);
        self::assertSame('Invasion of Zendikar', $faces[0]['name']);
        self::assertSame('Awakened Skyclave', $faces[1]['name']);
        self::assertSame('4', $faces[1]['power']);
        self::assertSame('4', $faces[1]['toughness']);
        self::assertArrayHasKey('defense', $faces[0]);
        self::assertArrayHasKey('handModifier', $faces[0]);
        self::assertArrayHasKey('lifeModifier', $faces[0]);
        self::assertSame('https://cards.scryfall.io/back.jpg', $faces[1]['imageUris']['normal']);
    }

    public function testCardPayloadIncludesPersistedHasRulingsMetadata(): void
    {
        $card = $this->seedCard('00000000-0000-0000-0000-0000000000ab', 'Rules Lawyer', [
            'has_rulings' => true,
        ]);

        $this->jsonRequest('GET', '/cards/'.$card->scryfallId());
        self::assertResponseIsSuccessful();
        self::assertTrue($this->jsonResponse()['card']['hasRulings']);

        $this->jsonRequest('GET', '/cards/search?q=rules%20lawyer&limit=5');
        self::assertResponseIsSuccessful();
        self::assertTrue($this->jsonResponse()['data'][0]['hasRulings']);
    }

    public function testCardResponseIncludesFaceStatsWithBattleDefenseAndModifiers(): void
    {
        $card = $this->seedCard('00000000-0000-0000-0000-0000000000aa', 'Battle Mentor', [
            'layout' => 'transform',
            'type_line' => 'Battle - Siege',
            'defense' => '5',
            'hand_modifier' => '+1',
            'life_modifier' => '-2',
            'card_faces' => [
                [
                    'name' => 'Battle Mentor',
                    'type_line' => 'Battle - Siege',
                    'defense' => '5',
                    'hand_modifier' => '+1',
                    'life_modifier' => '-2',
                    'oracle_text' => 'Front face',
                    'image_uris' => ['normal' => 'https://cards.scryfall.io/front-battle.jpg'],
                ],
                [
                    'name' => 'Mentor Awakened',
                    'type_line' => 'Creature - Avatar',
                    'power' => '4',
                    'toughness' => '4',
                    'oracle_text' => 'Back face',
                    'image_uris' => ['normal' => 'https://cards.scryfall.io/back-battle.jpg'],
                ],
            ],
        ]);

        $this->jsonRequest('GET', '/cards/'.$card->scryfallId());
        self::assertResponseIsSuccessful();

        $payload = $this->jsonResponse()['card'];
        self::assertArrayHasKey('faceStats', $payload);
        self::assertSame('5', $payload['faceStats']['root']['defense']);
        self::assertSame('+1', $payload['faceStats']['root']['handModifier']);
        self::assertSame('-2', $payload['faceStats']['root']['lifeModifier']);
        self::assertCount(2, $payload['faceStats']['faces']);
        self::assertSame('Battle Mentor', $payload['faceStats']['faces'][0]['name']);
        self::assertSame('5', $payload['faceStats']['faces'][0]['defense']);
        self::assertSame('+1', $payload['faceStats']['faces'][0]['handModifier']);
        self::assertSame('-2', $payload['faceStats']['faces'][0]['lifeModifier']);
    }

    public function testAmbiguousNameResolutionReturnsConflict(): void
    {
        $this->seedCard('00000000-0000-0000-0000-000000000001', 'Opt', ['set' => 'one', 'collector_number' => '1']);
        $this->seedCard('00000000-0000-0000-0000-000000000002', 'Opt', ['set' => 'two', 'collector_number' => '2']);

        $this->jsonRequest('GET', '/cards/resolve?name=Opt');

        self::assertResponseStatusCodeSame(409);
        self::assertCount(2, $this->jsonResponse()['matches']);
    }

    public function testSearchMatchesContainedSubstringCaseInsensitive(): void
    {
        $contained = $this->seedCard('00000000-0000-0000-0000-000000000012', 'Oath of Liliana');
        $startsWith = $this->seedCard('00000000-0000-0000-0000-000000000011', 'Liliana of the Veil');
        $this->seedCard('00000000-0000-0000-0000-000000000013', 'Professor Onyx');

        $this->jsonRequest('GET', '/cards/search?q=LiLiAnA&limit=10');

        self::assertResponseIsSuccessful();
        $resultIds = array_column($this->jsonResponse()['data'], 'scryfallId');
        self::assertContains($startsWith->scryfallId(), $resultIds);
        self::assertContains($contained->scryfallId(), $resultIds);
    }

    public function testSearchShortQueriesUsePrefixMatchingOnly(): void
    {
        $prefix = $this->seedCard('00000000-0000-0000-0000-000000000017', 'Ingot Chewer');
        $contained = $this->seedCard('00000000-0000-0000-0000-000000000018', 'Sol Ring');

        $this->jsonRequest('GET', '/cards/search?q=ing&limit=10');

        self::assertResponseIsSuccessful();
        $resultIds = array_column($this->jsonResponse()['data'], 'scryfallId');
        self::assertContains($prefix->scryfallId(), $resultIds);
        self::assertNotContains($contained->scryfallId(), $resultIds);
    }

    public function testSearchPrefersExactMatchesWhenResultsAreLimited(): void
    {
        $exact = $this->seedCard('00000000-0000-0000-0000-000000000014', 'Sol Ring');
        $this->seedCard('00000000-0000-0000-0000-000000000015', 'Sol Ring Replica');
        $this->seedCard('00000000-0000-0000-0000-000000000016', 'Replica of Sol Ring');

        $this->jsonRequest('GET', '/cards/search?q=sol%20ring&limit=1');

        self::assertResponseIsSuccessful();
        self::assertSame([$exact->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
    }

    public function testSearchCanFilterTokensOnly(): void
    {
        $token = $this->seedCard('00000000-0000-0000-0000-000000000021', 'Goblin Token', [
            'layout' => 'token',
            'type_line' => 'Token Creature - Goblin',
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000022', 'Goblin Instigator', [
            'layout' => 'normal',
            'type_line' => 'Creature - Goblin Rogue',
        ]);

        $this->jsonRequest('GET', '/cards/search?q=goblin&tokenOnly=true');

        self::assertResponseIsSuccessful();
        self::assertSame([$token->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
    }

    public function testSearchCanFilterGameplayHelpersByKind(): void
    {
        $token = $this->seedCard('00000000-0000-0000-0000-0000000000c1', 'Goblin Token', [
            'layout' => 'token',
            'type_line' => 'Token Creature - Goblin',
        ]);
        $emblem = $this->seedCard('00000000-0000-0000-0000-0000000000c2', 'Chandra Emblem', [
            'layout' => 'emblem',
            'type_line' => 'Emblem',
        ]);
        $dungeon = $this->seedCard('00000000-0000-0000-0000-0000000000c3', 'Lost Mine of Phandelver', [
            'layout' => 'dungeon',
            'type_line' => 'Dungeon',
        ]);
        $namedDungeon = $this->seedCard('00000000-0000-0000-0000-0000000000c5', 'Dungeon of the Mad Mage', [
            'layout' => 'normal',
            'type_line' => 'Dungeon',
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000c4', 'Dungeon Master', [
            'layout' => 'normal',
            'type_line' => 'Legendary Creature - Human Gamer',
        ]);

        $this->jsonRequest('GET', '/cards/search?q=token&gameplayKind=token');
        self::assertResponseIsSuccessful();
        self::assertSame([$token->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));

        $this->jsonRequest('GET', '/cards/search?q=emblem&gameplayKind=emblem');
        self::assertResponseIsSuccessful();
        self::assertSame([$emblem->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));

        $this->jsonRequest('GET', '/cards/search?q=phandelver&gameplayKind=dungeon');
        self::assertResponseIsSuccessful();
        self::assertSame([$dungeon->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));

        $this->jsonRequest('GET', '/cards/search?q=dungeon&gameplayKind=dungeon');
        self::assertResponseIsSuccessful();
        $dungeonResultIds = array_column($this->jsonResponse()['data'], 'scryfallId');
        self::assertContains($namedDungeon->scryfallId(), $dungeonResultIds);
        self::assertNotContains('00000000-0000-0000-0000-0000000000c4', $dungeonResultIds);
    }

    public function testSearchColorIdentityFilterUsesSubsetSemanticsAndKeepsColorlessCards(): void
    {
        $blueCard = $this->seedCard('00000000-0000-0000-0000-000000000023', 'Arcane Denial', [
            'type_line' => 'Instant',
            'color_identity' => ['U'],
        ]);
        $colorlessCard = $this->seedCard('00000000-0000-0000-0000-000000000024', 'Arcane Signet', [
            'type_line' => 'Artifact',
            'color_identity' => [],
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000025', 'Arcane Growth', [
            'type_line' => 'Sorcery',
            'color_identity' => ['U', 'G'],
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000026', 'Arcane Verdict', [
            'type_line' => 'Instant',
            'color_identity' => ['U', 'W'],
        ]);

        $this->jsonRequest('GET', '/cards/search?q=arcane&colorIdentity=U&limit=10');

        self::assertResponseIsSuccessful();
        self::assertSame(
            [$blueCard->scryfallId(), $colorlessCard->scryfallId()],
            array_column($this->jsonResponse()['data'], 'scryfallId'),
        );
    }

    public function testAdvancedSearchFiltersTextSetsRarityFormatsManaAndStats(): void
    {
        $match = $this->seedCard('00000000-0000-0000-0000-0000000000a1', 'Advanced Filter Match', [
            'mana_cost' => '{2}{G}{G}',
            'cmc' => 4,
            'type_line' => 'Creature - Elf Druid',
            'oracle_text' => 'Draw a card, then create a Treasure token.',
            'colors' => ['G'],
            'set' => 'adv',
            'set_name' => 'Advanced Set',
            'rarity' => 'rare',
            'power' => '4',
            'toughness' => '5',
            'legalities' => ['commander' => 'legal', 'modern' => 'legal'],
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000a2', 'Advanced Filter Miss', [
            'mana_cost' => '{2}{U}',
            'cmc' => 3,
            'type_line' => 'Instant',
            'oracle_text' => 'Counter target spell.',
            'colors' => ['U'],
            'set' => 'adv',
            'set_name' => 'Advanced Set',
            'rarity' => 'uncommon',
            'legalities' => ['commander' => 'legal', 'modern' => 'not_legal'],
        ]);

        $this->jsonRequest('GET', '/cards/search?oracleTextA=draw&oracleTextB=treasure&oracleTextMode=and&types=creature&subtypes=elf&sets=adv&rarities=rare&formats=modern&manaValueMin=4&manaValueMax=4&manaCost=2GG&powerMin=4&toughnessMax=5&limit=10');

        self::assertResponseIsSuccessful();
        self::assertSame([$match->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
        self::assertSame('Advanced Set', $this->jsonResponse()['data'][0]['setName']);
        self::assertSame('rare', $this->jsonResponse()['data'][0]['rarity']);
    }

    public function testAdvancedSearchOracleTextMatchesLocalizedRulesTextAcrossLanguages(): void
    {
        $card = $this->seedCard('00000000-0000-0000-0000-0000000000b1', 'Landfall Test', [
            'type_line' => 'Creature - Beast',
            'oracle_text' => 'Landfall - Whenever a land enters the battlefield under your control, draw a card.',
            'lang' => 'en',
        ]);
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_print_locale (
    print_scryfall_id,
    lang,
    name,
    printed_name,
    mana_cost,
    type_line,
    oracle_text,
    image_uris,
    card_faces,
    image_status,
    updated_at
) VALUES (
    :print_scryfall_id,
    'es',
    'Prueba de aterrizaje',
    'Prueba de aterrizaje',
    '{1}',
    'Criatura - Bestia',
    'Aterrizaje - Siempre que una tierra entre al campo de batalla bajo tu control, roba una carta.',
    '{}',
    '[]',
    NULL,
    NOW()
)
ON CONFLICT (print_scryfall_id, lang) DO UPDATE SET
    name = EXCLUDED.name,
    printed_name = EXCLUDED.printed_name,
    oracle_text = EXCLUDED.oracle_text,
    updated_at = NOW()
SQL,
            ['print_scryfall_id' => $card->scryfallId()],
        );

        $this->jsonRequest('GET', '/cards/search?oracleTextA=aterrizaje&lang=es&limit=10');

        self::assertResponseIsSuccessful();
        self::assertSame([$card->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
        self::assertSame('Prueba de aterrizaje', $this->jsonResponse()['data'][0]['name']);
        self::assertStringContainsString('Aterrizaje', $this->jsonResponse()['data'][0]['oracleText']);
    }

    public function testSearchNameMatchesPrintedNamesFromOtherLanguagesAndFallsBackToEnglishPayload(): void
    {
        $card = $this->seedCard('00000000-0000-0000-0000-0000000000b2', 'French Name Test', [
            'type_line' => 'Creature - Beast',
            'oracle_text' => 'Trample.',
            'lang' => 'en',
        ]);
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_print_locale (
    print_scryfall_id,
    lang,
    name,
    printed_name,
    mana_cost,
    type_line,
    oracle_text,
    image_uris,
    card_faces,
    image_status,
    updated_at
) VALUES (
    :print_scryfall_id,
    'fr',
    'Bete de test francaise',
    'Bete de test francaise',
    '{1}',
    'Creature - bête',
    'Pietinement.',
    '{}',
    '[]',
    NULL,
    NOW()
)
ON CONFLICT (print_scryfall_id, lang) DO UPDATE SET
    name = EXCLUDED.name,
    printed_name = EXCLUDED.printed_name,
    updated_at = NOW()
SQL,
            ['print_scryfall_id' => $card->scryfallId()],
        );

        $this->jsonRequest('GET', '/cards/search?q=bete de test francaise&lang=es&limit=10');

        self::assertResponseIsSuccessful();
        self::assertSame([$card->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
        self::assertSame('French Name Test', $this->jsonResponse()['data'][0]['name']);
    }

    public function testAdvancedSearchColorModesUsePrintedColors(): void
    {
        $whiteBlue = $this->seedCard('00000000-0000-0000-0000-0000000000a3', 'Azorius Card', [
            'colors' => ['W', 'U'],
            'color_identity' => ['W', 'U'],
        ]);
        $blueOnly = $this->seedCard('00000000-0000-0000-0000-0000000000a4', 'Blue Card', [
            'colors' => ['U'],
            'color_identity' => ['U'],
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000a5', 'Esper Card', [
            'colors' => ['W', 'U', 'B'],
            'color_identity' => ['W', 'U', 'B'],
        ]);

        $this->jsonRequest('GET', '/cards/search?colors=W,U&colorMatchMode=exact&limit=10');

        self::assertResponseIsSuccessful();
        self::assertSame([$whiteBlue->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));

        $this->jsonRequest('GET', '/cards/search?colors=U&colorMatchMode=any&limit=10');
        self::assertResponseIsSuccessful();
        self::assertContains($blueOnly->scryfallId(), array_column($this->jsonResponse()['data'], 'scryfallId'));
    }

    public function testAdvancedSearchCanIncludeVariableStats(): void
    {
        $variable = $this->seedCard('00000000-0000-0000-0000-0000000000a6', 'Variable Avatar', [
            'type_line' => 'Creature - Avatar',
            'power' => '*',
            'toughness' => '*',
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000a7', 'Small Avatar', [
            'type_line' => 'Creature - Avatar',
            'power' => '1',
            'toughness' => '1',
        ]);

        $this->jsonRequest('GET', '/cards/search?types=creature&powerMin=5&includeVariablePower=true&limit=10');

        self::assertResponseIsSuccessful();
        self::assertSame([$variable->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
    }

    public function testAdvancedSearchOptionsExposeCatalogValues(): void
    {
        $card = $this->seedCard('00000000-0000-0000-0000-0000000000a8', 'Options Elf', [
            'type_line' => 'Creature - Elf Druid',
            'set' => 'opt',
            'set_name' => 'Options Set',
            'rarity' => 'mythic',
        ]);
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_print_locale (
    print_scryfall_id,
    lang,
    name,
    printed_name,
    mana_cost,
    type_line,
    oracle_text,
    image_uris,
    card_faces,
    image_status,
    updated_at
) VALUES (
    :print_scryfall_id,
    'es',
    'Elfo de opciones',
    'Elfo de opciones',
    '{1}',
    'Criatura - Elfo Druida',
    '',
    '{}',
    '[]',
    NULL,
    NOW()
)
ON CONFLICT (print_scryfall_id, lang) DO UPDATE SET
    name = EXCLUDED.name,
    printed_name = EXCLUDED.printed_name,
    type_line = EXCLUDED.type_line,
    updated_at = NOW()
SQL,
            ['print_scryfall_id' => $card->scryfallId()],
        );

        $this->jsonRequest('GET', '/cards/search/options?lang=es');

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertContains('opt', array_column($response['sets'], 'code'));
        self::assertContains('elf', array_column($response['subtypes'], 'code'));
        self::assertNotContains('kindred', array_column($response['types'], 'code'));
        self::assertContains('mythic', array_column($response['rarities'], 'code'));
        self::assertContains('commander', array_column($response['formats'], 'code'));
        self::assertSame('Criatura', $this->optionName($response['types'], 'creature'));
        self::assertSame('Elfo', $this->optionName($response['subtypes'], 'elf'));
    }

    public function testAdvancedSearchOptionsRejectInvalidLanguage(): void
    {
        $this->jsonRequest('GET', '/cards/search/options?lang=zz');

        self::assertResponseStatusCodeSame(400);
        self::assertSame('lang filter is invalid.', $this->jsonResponse()['error']);
    }

    public function testAdvancedSearchRejectsInvalidEnums(): void
    {
        $this->jsonRequest('GET', '/cards/search?rarities=legendary');
        self::assertResponseStatusCodeSame(400);
        self::assertSame('rarities filter is invalid.', $this->jsonResponse()['error']);

        $this->jsonRequest('GET', '/cards/search?formats=alchemy');
        self::assertResponseStatusCodeSame(400);
        self::assertSame('formats filter is invalid.', $this->jsonResponse()['error']);
    }

    public function testSearchDeduplicatesPrintingsByNameTypeAndManaCost(): void
    {
        $this->seedCard('00000000-0000-0000-0000-000000000031', 'Sol Ring', [
            'set' => 'one',
            'collector_number' => '1',
            'type_line' => 'Artifact',
            'mana_cost' => '{1}',
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000032', 'Sol Ring', [
            'set' => 'two',
            'collector_number' => '2',
            'type_line' => 'Artifact',
            'mana_cost' => '{1}',
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000033', 'Sol Ring', [
            'set' => 'three',
            'collector_number' => '3',
            'type_line' => 'Artifact',
            'mana_cost' => '{2}',
        ]);

        $this->jsonRequest('GET', '/cards/search?q=sol%20ring&limit=20');

        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['data']);
    }

    public function testDefaultSearchExcludesNonPlayableCatalogEntries(): void
    {
        $this->seedCard('00000000-0000-0000-0000-000000000034', 'Lightning Bolt', [
            'type_line' => 'Instant',
            'layout' => 'normal',
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000035', 'Goblin Token', [
            'type_line' => 'Token Creature - Goblin',
            'layout' => 'token',
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000036', 'Checklist Card', [
            'type_line' => 'Card',
            'layout' => 'art_series',
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000037', 'Chandra Emblem', [
            'type_line' => 'Emblem - Chandra',
            'layout' => 'emblem',
        ]);

        $this->jsonRequest('GET', '/cards/search?limit=20');

        self::assertResponseIsSuccessful();
        $names = array_column($this->jsonResponse()['data'], 'name');
        self::assertContains('Lightning Bolt', $names);
        self::assertNotContains('Goblin Token', $names);
        self::assertNotContains('Checklist Card', $names);
        self::assertNotContains('Chandra Emblem', $names);

        $this->jsonRequest('GET', '/cards/search?q=goblin&gameplayKind=token&limit=20');
        self::assertResponseIsSuccessful();
        self::assertSame('Goblin Token', $this->jsonResponse()['data'][0]['name']);
    }

    public function testSearchReportsWhetherMorePagesExist(): void
    {
        for ($index = 1; $index <= 3; ++$index) {
            $this->seedCard(sprintf('00000000-0000-0000-0000-00000000004%d', $index), 'Page Card '.$index, [
                'type_line' => 'Artifact',
                'mana_cost' => sprintf('{%d}', $index),
            ]);
        }

        $this->jsonRequest('GET', '/cards/search?q=page&limit=2');

        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['data']);
        self::assertTrue($this->jsonResponse()['hasMore']);
        self::assertSame(3, $this->jsonResponse()['total']);

        $this->jsonRequest('GET', '/cards/search?q=page&limit=2&page=2');

        self::assertResponseIsSuccessful();
        self::assertCount(1, $this->jsonResponse()['data']);
        self::assertFalse($this->jsonResponse()['hasMore']);
        self::assertSame(3, $this->jsonResponse()['total']);
    }

    public function testSearchLimitIsCappedAtFiveHundred(): void
    {
        $this->seedCard('00000000-0000-0000-0000-000000000041', 'Sheoldred, Whispering One', [
            'type_line' => 'Legendary Creature - Phyrexian Praetor',
        ]);

        $this->jsonRequest('GET', '/cards/search?q=erin&limit=999');

        self::assertResponseIsSuccessful();
        self::assertSame(500, $this->jsonResponse()['limit']);
        self::assertNotEmpty($this->jsonResponse()['data']);
    }

    public function testCardEndpointsSupportLanguageSelectionAndFallbacks(): void
    {
        $englishPrint = $this->seedCard('00000000-0000-0000-0000-000000000051', 'Sol Ring', [
            'set' => 'tst',
            'collector_number' => '51',
            'lang' => 'en',
            'printed_name' => null,
            'image_uris' => ['normal' => 'https://cards.scryfall.io/sol-ring-en.jpg'],
        ]);
        $spanishPrint = $this->seedCard('00000000-0000-0000-0000-000000000052', 'Sol Ring', [
            'set' => 'tst',
            'collector_number' => '51',
            'lang' => 'es',
            'printed_name' => 'Anillo solar',
            'image_uris' => ['normal' => 'https://cards.scryfall.io/sol-ring-es.jpg'],
        ]);
        $japaneseOnlyPrint = $this->seedCard('00000000-0000-0000-0000-000000000053', 'Dark Ritual', [
            'set' => 'tst',
            'collector_number' => '53',
            'lang' => 'ja',
            'printed_name' => 'Dark Ritual JA',
            'image_uris' => ['normal' => 'https://cards.scryfall.io/dark-ritual-ja.jpg'],
        ]);

        $this->jsonRequest('GET', '/cards/search?q=sol%20ring&lang=es&limit=5');
        self::assertResponseIsSuccessful();
        self::assertSame($spanishPrint->scryfallId(), $this->jsonResponse()['data'][0]['scryfallId']);
        self::assertSame('Anillo solar', $this->jsonResponse()['data'][0]['printedName']);

        $this->jsonRequest('GET', '/cards/search?q=anillo%20solar&lang=es&limit=5');
        self::assertResponseIsSuccessful();
        self::assertSame($spanishPrint->scryfallId(), $this->jsonResponse()['data'][0]['scryfallId']);

        $this->jsonRequest('GET', '/cards/resolve?setCode=tst&collectorNumber=51&lang=es');
        self::assertResponseIsSuccessful();
        self::assertSame($spanishPrint->scryfallId(), $this->jsonResponse()['card']['scryfallId']);

        $this->jsonRequest('GET', '/cards/resolve?name=Anillo%20solar&lang=es');
        self::assertResponseIsSuccessful();
        self::assertSame($spanishPrint->scryfallId(), $this->jsonResponse()['card']['scryfallId']);

        $this->jsonRequest('GET', '/cards/'.$englishPrint->scryfallId().'?lang=es');
        self::assertResponseIsSuccessful();
        self::assertSame($spanishPrint->scryfallId(), $this->jsonResponse()['card']['scryfallId']);

        $this->jsonRequest('GET', '/cards/'.$spanishPrint->scryfallId().'?lang=ru');
        self::assertResponseIsSuccessful();
        self::assertSame($englishPrint->scryfallId(), $this->jsonResponse()['card']['scryfallId']);

        $this->jsonRequest('GET', '/cards/'.$japaneseOnlyPrint->scryfallId().'?lang=fr');
        self::assertResponseIsSuccessful();
        self::assertSame($japaneseOnlyPrint->scryfallId(), $this->jsonResponse()['card']['scryfallId']);
    }

    public function testSearchMatchesFlavorName(): void
    {
        $card = $this->seedCard('00000000-0000-0000-0000-000000000071', 'Zilortha, Strength Incarnate', [
            'flavor_name' => 'Godzilla, King of the Monsters',
        ]);

        $this->jsonRequest('GET', '/cards/search?q=godzilla&limit=5');

        self::assertResponseIsSuccessful();
        self::assertSame($card->scryfallId(), $this->jsonResponse()['data'][0]['scryfallId']);
    }

    public function testSearchIsAccentInsensitiveWithoutChangingRepresentativeResults(): void
    {
        $spanishPrint = $this->seedCard('00000000-0000-0000-0000-000000000072', 'Delivery Truck', [
            'lang' => 'es',
            'printed_name' => 'Camión',
        ]);

        $this->jsonRequest('GET', '/cards/search?q=camion&lang=es&limit=5');
        self::assertResponseIsSuccessful();
        $unaccentedIds = array_column($this->jsonResponse()['data'], 'scryfallId');

        $this->jsonRequest('GET', '/cards/search?q=cami%C3%B3n&lang=es&limit=5');
        self::assertResponseIsSuccessful();
        $accentedIds = array_column($this->jsonResponse()['data'], 'scryfallId');

        self::assertSame([$spanishPrint->scryfallId()], $unaccentedIds);
        self::assertSame($unaccentedIds, $accentedIds);
    }

    public function testSearchFallsBackToEnglishOnlyWhenRequestedLanguageHasNoMatches(): void
    {
        $englishPrint = $this->seedCard('00000000-0000-0000-0000-000000000073', 'Dark Ritual', [
            'lang' => 'en',
            'printed_name' => null,
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000074', 'Dark Ritual', [
            'lang' => 'pt',
            'printed_name' => 'Ritual Sombrio',
        ]);

        $this->jsonRequest('GET', '/cards/search?q=dark%20ritual&lang=es&limit=5');

        self::assertResponseIsSuccessful();
        self::assertSame([$englishPrint->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
    }

    public function testSearchFallsBackToCommonPrintLanguagesOnlyWhenLocalAndEnglishMiss(): void
    {
        $commonPrint = $this->seedCard('00000000-0000-0000-0000-000000000075', 'Sol Ring', [
            'lang' => 'ph',
            'printed_name' => 'Sol Ring PH',
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000076', 'Sol Ring', [
            'lang' => 'pt',
            'printed_name' => 'Anel Solar',
        ]);

        $this->jsonRequest('GET', '/cards/search?q=sol%20ring&lang=es&limit=5');

        self::assertResponseIsSuccessful();
        self::assertSame([$commonPrint->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
    }

    public function testSearchReturnsNoResultsWhenNoSupportedFallbackBucketMatches(): void
    {
        $this->seedCard('00000000-0000-0000-0000-000000000077', 'Arcane Signet', [
            'lang' => 'pt',
            'printed_name' => 'Sinete Arcano',
        ]);

        $this->jsonRequest('GET', '/cards/search?q=arcane%20signet&lang=es&limit=5');

        self::assertResponseIsSuccessful();
        self::assertSame([], $this->jsonResponse()['data']);
    }

    public function testCardEndpointsRejectInvalidLanguageFilters(): void
    {
        $card = $this->seedCard('00000000-0000-0000-0000-000000000061', 'Swords to Plowshares');

        $this->jsonRequest('GET', '/cards/search?q=swords&lang=zz');
        self::assertResponseStatusCodeSame(400);
        self::assertSame('lang filter is invalid.', $this->jsonResponse()['error']);

        $this->jsonRequest('GET', '/cards/resolve?scryfallId='.$card->scryfallId().'&lang=zz');
        self::assertResponseStatusCodeSame(400);
        self::assertSame('lang filter is invalid.', $this->jsonResponse()['error']);

        $this->jsonRequest('GET', '/cards/'.$card->scryfallId().'?lang=zz');
        self::assertResponseStatusCodeSame(400);
        self::assertSame('lang filter is invalid.', $this->jsonResponse()['error']);
    }

    /**
     * @param list<array{code:string,name:string}> $options
     */
    private function optionName(array $options, string $code): ?string
    {
        foreach ($options as $option) {
            if (($option['code'] ?? null) === $code) {
                return $option['name'] ?? null;
            }
        }

        return null;
    }
}
