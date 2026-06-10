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
}
