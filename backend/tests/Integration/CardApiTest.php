<?php

namespace App\Tests\Integration;

use App\Application\Card\CardSearchOptionsRebuilder;
use App\Application\Card\CardSearchEntryRebuilder;
use App\Domain\User\User;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

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

    public function testCommanderCandidateSearchUsesCanonicalCardTextBeforeLocalization(): void
    {
        $commander = $this->seedCard('00000000-0000-0000-0000-000000000101', 'Atraxa, Grand Unifier', [
            'type_line' => 'Legendary Creature - Phyrexian Angel',
            'oracle_text' => 'Flying, vigilance, deathtouch, lifelink.',
            'lang' => 'en',
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000102', "Atraxa's Fall", [
            'type_line' => 'Sorcery',
            'oracle_text' => 'Destroy target artifact, battle, enchantment, or creature with flying.',
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
    'Atraxa, gran unificadora',
    'Atraxa, gran unificadora',
    '{1}',
    'Criatura legendaria - Angel pirexiano',
    'Vuela, vigilancia, toque mortal, vinculo vital.',
    '{}',
    '[]',
    NULL,
    NOW()
)
ON CONFLICT (print_scryfall_id, lang) DO UPDATE SET
    name = EXCLUDED.name,
    printed_name = EXCLUDED.printed_name,
    type_line = EXCLUDED.type_line,
    oracle_text = EXCLUDED.oracle_text,
    updated_at = NOW()
SQL,
            ['print_scryfall_id' => $commander->scryfallId()],
        );

        $this->jsonRequest('GET', '/cards/search?q=atraxa&lang=es&limit=10&commanderCandidate=true');

        self::assertResponseIsSuccessful();
        self::assertSame([$commander->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
        self::assertSame('Atraxa, gran unificadora', $this->jsonResponse()['data'][0]['name']);
        self::assertSame('Criatura legendaria - Angel pirexiano', $this->jsonResponse()['data'][0]['typeLine']);
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

        $email = sprintf('cards-language-%s@example.test', bin2hex(random_bytes(6)));
        $password = 'Password123!';

        $user = new User($email, 'Cards Language');
        $passwordHasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        $user->setPassword($passwordHasher->hashPassword($user, $password));
        $user->markEmailVerified();
        $this->entityManager->persist($user);
        $this->entityManager->flush();

        $this->jsonRequest('POST', '/auth/login', [
            'email' => $email,
            'password' => $password,
        ]);
        self::assertResponseIsSuccessful();
        $token = (string) $this->jsonResponse()['token'];

        $this->jsonRequest('PATCH', '/me', ['cardLanguage' => 'es'], $token);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('GET', '/cards/languages', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('es', $this->jsonResponse()['selectedCardLanguage']);
    }

    public function testCardPrintingsEndpointReturnsLocalizedPrintVersions(): void
    {
        $sourcePrint = $this->seedCard('00000000-0000-0000-0000-0000000000e1', 'Sol Ring', [
            'set' => 'one',
            'collector_number' => '1',
            'lang' => 'en',
        ]);
        $localizedPrint = $this->seedCard('00000000-0000-0000-0000-0000000000e2', 'Sol Ring', [
            'set' => 'two',
            'collector_number' => '2',
            'lang' => 'es',
            'printed_name' => 'Anillo solar',
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000e3', 'Arcane Signet', [
            'set' => 'one',
            'collector_number' => '3',
            'lang' => 'es',
            'printed_name' => 'Sello arcano',
        ]);

        $this->jsonRequest('GET', '/cards/'.$sourcePrint->scryfallId().'/printings?lang=es');

        self::assertResponseIsSuccessful();
        self::assertSame($sourcePrint->scryfallId(), $this->jsonResponse()['scryfallId']);
        self::assertSame([$localizedPrint->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
        self::assertSame('Anillo solar', $this->jsonResponse()['data'][0]['name']);
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

    public function testTokenSearchWithQueryLooksAcrossAllLanguages(): void
    {
        $spanishToken = $this->seedCard('00000000-0000-0000-0000-0000000000d1', 'Spanish Token Probe', [
            'layout' => 'token',
            'type_line' => 'Token Creature - Soldier',
            'lang' => 'es',
            'printed_name' => 'Ficha de prueba espanola',
        ]);
        $englishToken = $this->seedCard('00000000-0000-0000-0000-0000000000d2', 'English Token Probe', [
            'layout' => 'token',
            'type_line' => 'Token Creature - Soldier',
            'lang' => 'en',
        ]);
        $portugueseToken = $this->seedCard('00000000-0000-0000-0000-0000000000d3', 'Portuguese Token Probe', [
            'layout' => 'token',
            'type_line' => 'Token Creature - Soldier',
            'lang' => 'pt',
            'printed_name' => 'Ficha de teste portuguesa',
        ]);

        $this->jsonRequest('GET', '/cards/search?q=token&lang=es&tokenOnly=true&limit=20');

        self::assertResponseIsSuccessful();
        $resultIds = array_column($this->jsonResponse()['data'], 'scryfallId');
        self::assertContains($spanishToken->scryfallId(), $resultIds);
        self::assertContains($englishToken->scryfallId(), $resultIds);
        self::assertContains($portugueseToken->scryfallId(), $resultIds);
    }

    public function testTokenSearchFallsBackToEnglishPayloadWhenMatchExistsOnlyInAnotherLanguage(): void
    {
        $this->seedCard('00000000-0000-0000-0000-0000000000d4', 'Shared Token Probe', [
            'layout' => 'token',
            'type_line' => 'Token Creature - Soldier',
            'lang' => 'en',
            'set' => 'tok',
            'collector_number' => '1',
            'image_uris' => ['normal' => 'https://cards.scryfall.io/shared-token-en.jpg'],
        ]);
        $portugueseToken = $this->seedCard('00000000-0000-0000-0000-0000000000d5', 'Shared Token Probe', [
            'layout' => 'token',
            'type_line' => 'Token Creature - Soldier',
            'lang' => 'pt',
            'printed_name' => 'Ficha compartilhada',
            'set' => 'tok',
            'collector_number' => '2',
            'image_uris' => ['normal' => 'https://cards.scryfall.io/shared-token-pt.jpg'],
        ]);

        $this->jsonRequest('GET', '/cards/search?q=ficha%20compartilhada&lang=es&tokenOnly=true&limit=5');

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame($portugueseToken->scryfallId(), $response['data'][0]['scryfallId']);
        self::assertSame('Shared Token Probe', $response['data'][0]['name']);
        self::assertSame('en', $response['data'][0]['lang']);
        self::assertSame('https://cards.scryfall.io/shared-token-en.jpg', $response['data'][0]['imageUris']['normal'] ?? null);
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

    public function testSearchExcludesCardsWithoutAnyNonAlchemyLegalFormat(): void
    {
        $legal = $this->seedCard('00000000-0000-0000-0000-000000000031', 'Legality Probe Commander', [
            'type_line' => 'Artifact',
            'legalities' => ['commander' => 'legal', 'alchemy' => 'not_legal'],
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000032', 'Legality Probe Nowhere', [
            'type_line' => 'Artifact',
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000033', 'Legality Probe Alchemy Only', [
            'type_line' => 'Artifact',
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000034', 'A-Legality Probe Rebalanced', [
            'type_line' => 'Artifact',
            'legalities' => ['commander' => 'legal', 'modern' => 'legal'],
        ]);
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
UPDATE card
SET legalities = :legalities::json,
    commander_legal = false
WHERE scryfall_id = :scryfall_id
SQL,
            [
                'scryfall_id' => '00000000-0000-0000-0000-000000000032',
                'legalities' => json_encode(array_fill_keys([
                    'standard',
                    'future',
                    'historic',
                    'timeless',
                    'gladiator',
                    'pioneer',
                    'modern',
                    'legacy',
                    'pauper',
                    'vintage',
                    'penny',
                    'commander',
                    'oathbreaker',
                    'standardbrawl',
                    'brawl',
                    'competitivebrawl',
                    'alchemy',
                    'paupercommander',
                    'duel',
                    'oldschool',
                    'premodern',
                    'predh',
                    'tlr',
                ], 'not_legal'), JSON_THROW_ON_ERROR),
            ],
        );
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
UPDATE card
SET legalities = :legalities::json,
    commander_legal = false
WHERE scryfall_id = :scryfall_id
SQL,
            [
                'scryfall_id' => '00000000-0000-0000-0000-000000000033',
                'legalities' => json_encode(['alchemy' => 'legal', 'commander' => 'not_legal', 'modern' => 'not_legal'], JSON_THROW_ON_ERROR),
            ],
        );

        $this->jsonRequest('GET', '/cards/search?q=legality%20probe&limit=10');

        self::assertResponseIsSuccessful();
        self::assertSame([$legal->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
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

    public function testAdvancedSearchCanMatchExactOracleTextWords(): void
    {
        $rat = $this->seedCard('00000000-0000-0000-0000-0000000000f1', 'Exact Text Rat Match', [
            'type_line' => 'Creature - Rat',
            'oracle_text' => 'When this creature enters, create a 1/1 black Rat creature token.',
        ]);
        $pirates = $this->seedCard('00000000-0000-0000-0000-0000000000f2', 'Exact Text Pirate Partial Miss', [
            'type_line' => 'Creature - Human Pirate',
            'oracle_text' => 'Whenever this creature attacks, create two tapped Pirates.',
        ]);

        $this->jsonRequest('GET', '/cards/search?oracleTextA=rat&limit=10');

        self::assertResponseIsSuccessful();
        self::assertContains($rat->scryfallId(), array_column($this->jsonResponse()['data'], 'scryfallId'));
        self::assertContains($pirates->scryfallId(), array_column($this->jsonResponse()['data'], 'scryfallId'));

        $this->jsonRequest('GET', '/cards/search?oracleTextA=rat&oracleTextExact=true&limit=10');

        self::assertResponseIsSuccessful();
        self::assertSame([$rat->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
    }

    public function testUnqueriedAdvancedSearchUsesMaterializedEntriesForFormatPaginationAndSorting(): void
    {
        $lowMana = $this->seedCard('00000000-0000-0000-0000-0000000000d1', 'Entry Search Low', [
            'mana_cost' => '{1}',
            'cmc' => 1,
            'type_line' => 'Artifact',
            'legalities' => ['legacy' => 'legal', 'commander' => 'legal'],
        ]);
        $highMana = $this->seedCard('00000000-0000-0000-0000-0000000000d2', 'Entry Search High', [
            'mana_cost' => '{6}',
            'cmc' => 6,
            'type_line' => 'Artifact',
            'legalities' => ['legacy' => 'legal', 'commander' => 'legal'],
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000d3', 'Entry Search Modern Only', [
            'mana_cost' => '{2}',
            'cmc' => 2,
            'type_line' => 'Artifact',
            'legalities' => ['modern' => 'legal', 'legacy' => 'not_legal'],
        ]);
        static::getContainer()->get(CardSearchEntryRebuilder::class)->rebuild();

        $this->jsonRequest('GET', '/cards/search?q=&page=1&limit=20&lang=en&sort=mana_value_desc&formats=legacy');

        self::assertResponseIsSuccessful();
        self::assertSame(2, $this->jsonResponse()['total']);
        self::assertSame(
            [$highMana->scryfallId(), $lowMana->scryfallId()],
            array_column($this->jsonResponse()['data'], 'scryfallId'),
        );
    }

    public function testUnqueriedAdvancedSearchUsesMaterializedEntriesWithTypeFilters(): void
    {
        $artifact = $this->seedCard('00000000-0000-0000-0000-0000000000d4', 'Entry Search Artifact', [
            'type_line' => 'Artifact',
            'legalities' => ['legacy' => 'legal', 'commander' => 'legal'],
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000d5', 'Entry Search Creature', [
            'type_line' => 'Creature - Elf',
            'legalities' => ['legacy' => 'legal', 'commander' => 'legal'],
        ]);
        static::getContainer()->get(CardSearchEntryRebuilder::class)->rebuild();

        $this->jsonRequest('GET', '/cards/search?q=&page=1&limit=20&lang=en&sort=name_asc&types=artifact');

        self::assertResponseIsSuccessful();
        self::assertSame(1, $this->jsonResponse()['total']);
        self::assertSame([$artifact->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
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

    public function testAdvancedSearchTypeModifiersRequireBasicAndLegendaryTypeLine(): void
    {
        $match = $this->seedCard('00000000-0000-0000-0000-0000000000ba', 'Legendary Basic Test Land', [
            'type_line' => 'Legendary Basic Land - Plains',
            'mana_cost' => '',
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000bb', 'Basic Test Land', [
            'type_line' => 'Basic Land - Plains',
            'mana_cost' => '',
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000bc', 'Legendary Test Land', [
            'type_line' => 'Legendary Land',
            'mana_cost' => '',
        ]);

        $this->jsonRequest('GET', '/cards/search?types=land&basic=true&legendary=true&limit=10');

        self::assertResponseIsSuccessful();
        self::assertSame([$match->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
    }

    public function testSearchSortsResultsByRequestedOrder(): void
    {
        $highMana = $this->seedCard('00000000-0000-0000-0000-0000000000bd', 'Sort Probe High', [
            'mana_cost' => '{6}',
            'cmc' => 6,
            'type_line' => 'Artifact',
        ]);
        $lowMana = $this->seedCard('00000000-0000-0000-0000-0000000000be', 'Sort Probe Low', [
            'mana_cost' => '{1}',
            'cmc' => 1,
            'type_line' => 'Artifact',
        ]);

        $this->jsonRequest('GET', '/cards/search?q=sort%20probe&sort=mana_value_desc&limit=10');

        self::assertResponseIsSuccessful();
        self::assertSame(
            [$highMana->scryfallId(), $lowMana->scryfallId()],
            array_column($this->jsonResponse()['data'], 'scryfallId'),
        );

        $this->jsonRequest('GET', '/cards/search?q=sort%20probe&sort=name_desc&limit=10');

        self::assertResponseIsSuccessful();
        self::assertSame(
            [$lowMana->scryfallId(), $highMana->scryfallId()],
            array_column($this->jsonResponse()['data'], 'scryfallId'),
        );
    }

    public function testSearchSortsAndGroupsResultsByColorsWithoutUsingMaterializedFastPath(): void
    {
        $colorless = $this->seedCard('00000000-0000-0000-0000-0000000000bf', 'Color Sort Colorless', [
            'colors' => [],
            'color_identity' => [],
        ]);
        $white = $this->seedCard('00000000-0000-0000-0000-0000000000c0', 'Color Sort White', [
            'colors' => ['W'],
            'color_identity' => ['W'],
        ]);
        $blue = $this->seedCard('00000000-0000-0000-0000-0000000000c1', 'Color Sort Blue', [
            'colors' => ['U'],
            'color_identity' => ['U'],
        ]);
        $azorius = $this->seedCard('00000000-0000-0000-0000-0000000000c2', 'Color Sort Azorius', [
            'colors' => ['W', 'U'],
            'color_identity' => ['W', 'U'],
        ]);
        $gruul = $this->seedCard('00000000-0000-0000-0000-0000000000c3', 'Color Sort Gruul', [
            'colors' => ['R', 'G'],
            'color_identity' => ['R', 'G'],
        ]);
        static::getContainer()->get(CardSearchEntryRebuilder::class)->rebuild();

        $this->jsonRequest('GET', '/cards/search?q=&page=1&limit=20&lang=en&sort=colors');

        self::assertResponseIsSuccessful();
        self::assertSame(
            [
                $colorless->scryfallId(),
                $white->scryfallId(),
                $blue->scryfallId(),
                $azorius->scryfallId(),
                $gruul->scryfallId(),
            ],
            array_column($this->jsonResponse()['data'], 'scryfallId'),
        );
    }

    public function testQuerySearchSortsAndGroupsResultsByColors(): void
    {
        $colorless = $this->seedCard('00000000-0000-0000-0000-0000000000c4', 'Color Query Colorless', [
            'colors' => [],
            'color_identity' => [],
        ]);
        $white = $this->seedCard('00000000-0000-0000-0000-0000000000c5', 'Color Query White', [
            'colors' => ['W'],
            'color_identity' => ['W'],
        ]);
        $blue = $this->seedCard('00000000-0000-0000-0000-0000000000c6', 'Color Query Blue', [
            'colors' => ['U'],
            'color_identity' => ['U'],
        ]);
        $azorius = $this->seedCard('00000000-0000-0000-0000-0000000000c7', 'Color Query Azorius', [
            'colors' => ['W', 'U'],
            'color_identity' => ['W', 'U'],
        ]);
        $gruul = $this->seedCard('00000000-0000-0000-0000-0000000000c8', 'Color Query Gruul', [
            'colors' => ['R', 'G'],
            'color_identity' => ['R', 'G'],
        ]);

        $this->jsonRequest('GET', '/cards/search?q=color%20query&sort=colors&limit=10');

        self::assertResponseIsSuccessful();
        self::assertSame(
            [
                $colorless->scryfallId(),
                $white->scryfallId(),
                $blue->scryfallId(),
                $azorius->scryfallId(),
                $gruul->scryfallId(),
            ],
            array_column($this->jsonResponse()['data'], 'scryfallId'),
        );
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
    set_name,
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
    'Coleccion de opciones',
    '{}',
    '[]',
    NULL,
    NOW()
)
ON CONFLICT (print_scryfall_id, lang) DO UPDATE SET
    name = EXCLUDED.name,
    printed_name = EXCLUDED.printed_name,
    type_line = EXCLUDED.type_line,
    set_name = EXCLUDED.set_name,
    updated_at = NOW()
SQL,
            ['print_scryfall_id' => $card->scryfallId()],
        );
        static::getContainer()->get(CardSearchOptionsRebuilder::class)->rebuild();

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
        self::assertSame('Coleccion de opciones', $this->optionName($response['sets'], 'opt'));
        self::assertSame(1, $this->optionCardCount($response['sets'], 'opt'));
    }

    public function testAdvancedSearchOptionsPreferLocalizedSubtypeNamesWhenFallbackWasSeenFirst(): void
    {
        $this->seedCard('00000000-0000-0000-0000-0000000000aa', 'Fallback Beast', [
            'type_line' => 'Creature - Beast',
            'set' => 'opt',
            'collector_number' => '10',
        ]);
        $localized = $this->seedCard('00000000-0000-0000-0000-0000000000ab', 'Localized Beast', [
            'type_line' => 'Creature - Beast',
            'set' => 'opt',
            'collector_number' => '11',
        ]);
        $sibling = $this->seedCard('00000000-0000-0000-0000-0000000000ac', 'Sibling Wizard', [
            'type_line' => 'Creature - Wizard',
            'set' => 'sib',
            'collector_number' => '7',
        ]);

        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_print (
    scryfall_id,
    normalized_name,
    set_code,
    collector_number,
    default_name,
    default_lang,
    default_set_name,
    default_mana_cost,
    default_type_line,
    default_oracle_text,
    default_image_uris,
    default_card_faces,
    layout,
    commander_legal,
    updated_at
) VALUES (
    '00000000-0000-0000-0000-0000000000ad',
    'sibling wizard',
    'sib',
    '7',
    'Sibling Wizard',
    'en',
    'Sibling Set',
    '{1}',
    'Creature - Wizard',
    '',
    '{}',
    '[]',
    'normal',
    true,
    NOW()
)
ON CONFLICT (scryfall_id) DO NOTHING
SQL,
        );
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
    set_name,
    image_uris,
    card_faces,
    image_status,
    updated_at
) VALUES
    (:localized_print_scryfall_id, 'es', 'Bestia localizada', 'Bestia localizada', '{1}', 'Criatura - Bestia', '','Options Set', '{}', '[]', NULL, NOW()),
    (:sibling_print_scryfall_id, 'es', 'Mago hermano', 'Mago hermano', '{1}', 'Criatura - Mago', '', 'Coleccion hermana', '{}', '[]', NULL, NOW())
ON CONFLICT (print_scryfall_id, lang) DO UPDATE SET
    name = EXCLUDED.name,
    printed_name = EXCLUDED.printed_name,
    type_line = EXCLUDED.type_line,
    set_name = EXCLUDED.set_name,
    updated_at = NOW()
SQL,
            [
                'localized_print_scryfall_id' => $localized->scryfallId(),
                'sibling_print_scryfall_id' => $sibling->scryfallId(),
            ],
        );
        static::getContainer()->get(CardSearchOptionsRebuilder::class)->rebuild();

        $this->jsonRequest('GET', '/cards/search/options?lang=es');

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame('Bestia', $this->optionName($response['subtypes'], 'beast'));
        self::assertSame('Mago', $this->optionName($response['subtypes'], 'wizard'));
    }

    public function testAdvancedSearchOptionsSetCountsExcludeNonPlayableCatalogRows(): void
    {
        $this->seedCard('00000000-0000-0000-0000-0000000000b1', 'Playable Counted', [
            'type_line' => 'Creature - Elf',
            'set' => 'cnt',
            'set_name' => 'Counted Set',
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000b2', 'Ignored Token', [
            'type_line' => 'Token Creature - Elf',
            'layout' => 'token',
            'set' => 'cnt',
            'set_name' => 'Counted Set',
        ]);
        $this->seedCard('00000000-0000-0000-0000-0000000000b3', 'Ignored Emblem', [
            'type_line' => 'Emblem',
            'layout' => 'emblem',
            'set' => 'cnt',
            'set_name' => 'Counted Set',
        ]);
        static::getContainer()->get(CardSearchOptionsRebuilder::class)->rebuild();

        $this->jsonRequest('GET', '/cards/search/options?lang=en');

        self::assertResponseIsSuccessful();
        self::assertSame(1, $this->optionCardCount($this->jsonResponse()['sets'], 'cnt'));
    }

    public function testAdvancedSearchOptionsSortLabelsIgnoringAccents(): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_search_option (kind, code, lang, label, card_count, sort_order, updated_at) VALUES
    ('type', 't-a', 'en', 'Abe', NULL, 0, NOW()),
    ('type', 't-a', 'es', 'Abeja', NULL, 0, NOW()),
    ('type', 't-accent', 'en', 'Angel', NULL, 0, NOW()),
    ('type', 't-accent', 'es', 'Ángel', NULL, 0, NOW()),
    ('type', 't-b', 'en', 'Bison', NULL, 0, NOW()),
    ('type', 't-b', 'es', 'Bisonte', NULL, 0, NOW()),
    ('subtype', 's-a', 'en', 'Arachnid', NULL, 0, NOW()),
    ('subtype', 's-a', 'es', 'Araña', NULL, 0, NOW()),
    ('subtype', 's-accent', 'en', 'Treefolk', NULL, 0, NOW()),
    ('subtype', 's-accent', 'es', 'Árbol', NULL, 0, NOW()),
    ('subtype', 's-b', 'en', 'Beast', NULL, 0, NOW()),
    ('subtype', 's-b', 'es', 'Bestia', NULL, 0, NOW())
SQL,
        );
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_search_set_option (code, lang, label, card_count, updated_at) VALUES
    ('set-a', 'en', 'A Set', 1, NOW()),
    ('set-a', 'es', 'Amonkhet', 1, NOW()),
    ('set-accent', 'en', 'Accent Set', 1, NOW()),
    ('set-accent', 'es', 'Álbum Promocional', 1, NOW()),
    ('set-b', 'en', 'B Set', 1, NOW()),
    ('set-b', 'es', 'Bloomburrow', 1, NOW())
SQL,
        );

        $this->jsonRequest('GET', '/cards/search/options?lang=es');

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(['t-a', 't-accent', 't-b'], array_column($response['types'], 'code'));
        self::assertSame(['s-a', 's-accent', 's-b'], array_column($response['subtypes'], 'code'));
        self::assertSame(['set-accent', 'set-a', 'set-b'], array_column($response['sets'], 'code'));
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

        $this->jsonRequest('GET', '/cards/search?sort=sideways');
        self::assertResponseStatusCodeSame(400);
        self::assertSame('sort filter is invalid.', $this->jsonResponse()['error']);
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

    public function testSearchFallsBackToOtherSupportedLanguagesWhenRequestedEnglishAndCommonMiss(): void
    {
        $portuguesePrint = $this->seedCard('00000000-0000-0000-0000-000000000077', 'Arcane Signet', [
            'lang' => 'pt',
            'printed_name' => 'Sinete Arcano',
        ]);

        $this->jsonRequest('GET', '/cards/search?q=arcane%20signet&lang=es&limit=5');

        self::assertResponseIsSuccessful();
        self::assertSame([$portuguesePrint->scryfallId()], array_column($this->jsonResponse()['data'], 'scryfallId'));
    }

    public function testSetSearchReturnsRealSetPrintingsEvenWhenMaterializedEntriesPreferOtherSets(): void
    {
        $g17Cards = $this->seedBasicLandCycle('g17', 'en', [
            'set_name' => 'Gift Pack 2017',
            'legalities' => ['modern' => 'legal', 'commander' => 'legal', 'legacy' => 'legal'],
        ]);
        $this->seedBasicLandCycle('lrw', 'es', [
            'set_name' => 'Lorwyn',
            'printed_names' => [
                'Plains' => 'Llanura',
                'Island' => 'Isla',
                'Swamp' => 'Pantano',
                'Mountain' => 'Montana',
                'Forest' => 'Bosque',
            ],
            'collector_numbers' => [
                'Plains' => '291',
                'Island' => '295',
                'Swamp' => '299',
                'Mountain' => '297',
                'Forest' => '293',
            ],
        ]);
        static::getContainer()->get(CardSearchEntryRebuilder::class)->rebuild();

        $this->jsonRequest('GET', '/cards/search?q=&page=1&limit=20&lang=es&sort=name_asc&sets=g17');

        self::assertResponseIsSuccessful();
        self::assertSame(5, $this->jsonResponse()['total']);
        self::assertEqualsCanonicalizing(
            array_map(static fn ($card): string => $card->scryfallId(), $g17Cards),
            array_column($this->jsonResponse()['data'], 'scryfallId'),
        );
    }

    public function testSetSearchAppliesFormatFiltersToRealSetPrintings(): void
    {
        $g17Cards = $this->seedBasicLandCycle('g17', 'en', [
            'set_name' => 'Gift Pack 2017',
            'legalities' => ['modern' => 'legal', 'commander' => 'legal', 'legacy' => 'legal'],
        ]);
        static::getContainer()->get(CardSearchEntryRebuilder::class)->rebuild();

        $this->jsonRequest('GET', '/cards/search?q=&page=1&limit=20&lang=es&sort=name_asc&sets=g17&formats=modern');

        self::assertResponseIsSuccessful();
        self::assertSame(5, $this->jsonResponse()['total']);
        self::assertEqualsCanonicalizing(
            array_map(static fn ($card): string => $card->scryfallId(), $g17Cards),
            array_column($this->jsonResponse()['data'], 'scryfallId'),
        );
    }

    public function testSetSearchReturnsRealPrintingsAcrossMultipleSelectedSets(): void
    {
        $g17Forest = $this->seedCard('00000000-0000-0000-0000-000000000078', 'Forest', [
            'lang' => 'en',
            'set' => 'g17',
            'set_name' => 'Gift Pack 2017',
            'collector_number' => '5',
            'type_line' => 'Basic Land - Forest',
            'mana_cost' => '',
            'legalities' => ['modern' => 'legal', 'commander' => 'legal', 'legacy' => 'legal'],
        ]);
        $abcForest = $this->seedCard('00000000-0000-0000-0000-000000000079', 'Forest', [
            'lang' => 'en',
            'set' => 'abc',
            'set_name' => 'Alphabet Set',
            'collector_number' => '19',
            'type_line' => 'Basic Land - Forest',
            'mana_cost' => '',
            'legalities' => ['modern' => 'legal', 'commander' => 'legal', 'legacy' => 'legal'],
        ]);
        static::getContainer()->get(CardSearchEntryRebuilder::class)->rebuild();

        $this->jsonRequest('GET', '/cards/search?q=&page=1&limit=20&lang=es&sort=name_asc&sets=g17,abc');

        self::assertResponseIsSuccessful();
        self::assertSame(2, $this->jsonResponse()['total']);
        self::assertEqualsCanonicalizing(
            [$g17Forest->scryfallId(), $abcForest->scryfallId()],
            array_column($this->jsonResponse()['data'], 'scryfallId'),
        );
    }

    public function testSetSearchWithQueryDoesNotDeduplicateAcrossSelectedSets(): void
    {
        $g17Forest = $this->seedCard('00000000-0000-0000-0000-000000000080', 'Forest', [
            'lang' => 'en',
            'set' => 'g17',
            'set_name' => 'Gift Pack 2017',
            'collector_number' => '5',
            'type_line' => 'Basic Land - Forest',
            'mana_cost' => '',
            'legalities' => ['modern' => 'legal', 'commander' => 'legal', 'legacy' => 'legal'],
        ]);
        $abcForest = $this->seedCard('00000000-0000-0000-0000-000000000081', 'Forest', [
            'lang' => 'en',
            'set' => 'abc',
            'set_name' => 'Alphabet Set',
            'collector_number' => '19',
            'type_line' => 'Basic Land - Forest',
            'mana_cost' => '',
            'legalities' => ['modern' => 'legal', 'commander' => 'legal', 'legacy' => 'legal'],
        ]);
        static::getContainer()->get(CardSearchEntryRebuilder::class)->rebuild();

        $this->jsonRequest('GET', '/cards/search?q=forest&page=1&limit=20&lang=es&sort=name_asc&sets=g17,abc');

        self::assertResponseIsSuccessful();
        self::assertSame(2, $this->jsonResponse()['total']);
        self::assertEqualsCanonicalizing(
            [$g17Forest->scryfallId(), $abcForest->scryfallId()],
            array_column($this->jsonResponse()['data'], 'scryfallId'),
        );
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
     * @param list<array{code:string,name:string,cardCount?:int}> $options
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

    /**
     * @param list<array{code:string,name:string,cardCount?:int}> $options
     */
    private function optionCardCount(array $options, string $code): ?int
    {
        foreach ($options as $option) {
            if (($option['code'] ?? null) === $code) {
                return isset($option['cardCount']) ? (int) $option['cardCount'] : null;
            }
        }

        return null;
    }

    /**
     * @param array{
     *   set_name?: string,
     *   legalities?: array<string,string>,
     *   printed_names?: array<string,string>,
     *   collector_numbers?: array<string,string>
     * } $overrides
     *
     * @return list<Card>
     */
    private function seedBasicLandCycle(string $setCode, string $lang, array $overrides = []): array
    {
        $setName = $overrides['set_name'] ?? strtoupper($setCode);
        $legalities = $overrides['legalities'] ?? ['commander' => 'legal', 'legacy' => 'legal'];
        $printedNames = $overrides['printed_names'] ?? [];
        $collectorNumbers = $overrides['collector_numbers'] ?? [];
        $cards = [];

        foreach ([
            ['name' => 'Plains', 'collector' => '1', 'type_line' => 'Basic Land - Plains'],
            ['name' => 'Island', 'collector' => '2', 'type_line' => 'Basic Land - Island'],
            ['name' => 'Swamp', 'collector' => '3', 'type_line' => 'Basic Land - Swamp'],
            ['name' => 'Mountain', 'collector' => '4', 'type_line' => 'Basic Land - Mountain'],
            ['name' => 'Forest', 'collector' => '5', 'type_line' => 'Basic Land - Forest'],
        ] as $index => $land) {
            $cards[] = $this->seedCard(sprintf('00000000-0000-0000-0000-%012d', 820 + $index + (crc32($setCode.$lang) % 100) * 10), $land['name'], [
                'lang' => $lang,
                'printed_name' => $printedNames[$land['name']] ?? null,
                'set' => $setCode,
                'set_name' => $setName,
                'collector_number' => $collectorNumbers[$land['name']] ?? $land['collector'],
                'type_line' => $land['type_line'],
                'mana_cost' => '',
                'colors' => [],
                'color_identity' => [],
                'legalities' => $legalities,
            ]);
        }

        return $cards;
    }
}
