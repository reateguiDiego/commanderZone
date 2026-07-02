<?php

namespace App\Tests\Integration;

use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;

class DeckbuildingApiTest extends ApiTestCase
{
    public function testDeckSelectedInRoomCannotBeDeleted(): void
    {
        $token = $this->registerAndLogin('deck-in-room@example.test', 'Deck In Room');

        $this->jsonRequest('POST', '/decks', ['name' => 'Room Deck'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'maxPlayers' => 2, 'deckId' => $deckId], $token);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('DELETE', '/decks/'.$deckId, token: $token);
        self::assertResponseStatusCodeSame(409);
        self::assertSame('deck.in_use', $this->jsonResponse()['code']);
        self::assertSame('This deck cannot be deleted because it is being used in a game.', $this->jsonResponse()['error']);

        $this->jsonRequest('GET', '/decks/'.$deckId, token: $token);
        self::assertResponseIsSuccessful();
    }

    public function testCommanderValidationPersistsDeckValidity(): void
    {
        $token = $this->registerAndLogin('deck-validity@example.test', 'Deck Validity');
        $commander = $this->seedCard('00000000-0000-0000-0000-000000000801', 'Persisted Commander', [
            'type_line' => 'Legendary Creature',
        ]);
        $alternateCommanderPrint = $this->seedCard('00000000-0000-0000-0000-000000000803', 'Persisted Commander', [
            'type_line' => 'Legendary Creature',
            'set' => 'alt',
            'collector_number' => '2',
        ]);
        $island = $this->seedCard('00000000-0000-0000-0000-000000000802', 'Island', [
            'type_line' => 'Basic Land - Island',
        ]);

        $this->jsonRequest('POST', '/decks', ['name' => 'Persisted Validity'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/validate-commander', token: $token);
        self::assertResponseIsSuccessful();
        self::assertFalse($this->jsonResponse()['valid']);
        $this->assertDeckValidity($deckId, false);

        $this->jsonRequest('POST', '/decks/'.$deckId.'/cards', [
            'scryfallId' => $commander->scryfallId(),
            'quantity' => 1,
            'section' => DeckCard::SECTION_COMMANDER,
        ], $token);
        self::assertResponseIsSuccessful();
        $this->jsonRequest('POST', '/decks/'.$deckId.'/cards', [
            'scryfallId' => $island->scryfallId(),
            'quantity' => 99,
            'section' => DeckCard::SECTION_MAIN,
        ], $token);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/decks/'.$deckId.'/validate-commander', token: $token);
        self::assertResponseIsSuccessful();
        self::assertTrue($this->jsonResponse()['valid']);
        $this->assertDeckValidity($deckId, true);

        $commanderDeckCardId = $this->storedDeckCardId($deckId, 'Persisted Commander', DeckCard::SECTION_COMMANDER);
        $this->jsonRequest('PATCH', '/decks/'.$deckId.'/cards/'.$commanderDeckCardId.'/printing', [
            'scryfallId' => $alternateCommanderPrint->scryfallId(),
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertTrue($this->jsonResponse()['deck']['valid']);
        $this->assertDeckValidity($deckId, true);
    }

    public function testDeckImportPersistsDeckValidity(): void
    {
        $token = $this->registerAndLogin('deck-import-validity@example.test', 'Deck Import Validity');
        $commander = $this->seedCard('00000000-0000-0000-0000-000000000804', 'Import Valid Commander', [
            'type_line' => 'Legendary Creature',
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000805', 'Island', [
            'type_line' => 'Basic Land - Island',
        ]);

        $this->jsonRequest('POST', '/decks', ['name' => 'Import Validity'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'decklist' => <<<TXT
Deck
1 Island
TXT,
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertFalse($this->jsonResponse()['deck']['valid']);
        $this->assertDeckValidity($deckId, false);

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'commanderScryfallId' => $commander->scryfallId(),
            'decklist' => <<<TXT
Deck
1 Import Valid Commander
99 Island
TXT,
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertTrue($this->jsonResponse()['deck']['valid']);
        $this->assertDeckValidity($deckId, true);
    }

    public function testFoldersDecksCardsImportAndOwnership(): void
    {
        $token = $this->registerAndLogin('owner@example.test', 'Owner');
        $otherToken = $this->registerAndLogin('other@example.test', 'Other');
        $solRing = $this->seedCard('00000000-0000-0000-0000-000000000001', 'Sol Ring', [
            'mana_cost' => '{1}',
            'type_line' => 'Artifact',
            'oracle_text' => '{T}: Add {C}{C}.',
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $island = $this->seedCard('00000000-0000-0000-0000-000000000002', 'Island', [
            'type_line' => 'Basic Land - Island',
            'set' => 'tst',
            'collector_number' => '2',
        ]);
        $plantToken = $this->seedCard('00000000-0000-0000-0000-000000000003', 'Plant Token', [
            'type_line' => 'Token Creature - Plant',
            'set' => 'ttk',
            'collector_number' => '1',
        ]);
        $tokenProducer = $this->seedCard('00000000-0000-0000-0000-000000000004', 'Avenger of Zendikar', [
            'type_line' => 'Creature - Elemental',
            'oracle_text' => 'Create a 0/1 green Plant creature token.',
            'power' => '5',
            'toughness' => '5',
            'set' => 'tst',
            'collector_number' => '3',
            'card_faces' => [
                [
                    'name' => 'Avenger of Zendikar',
                    'mana_cost' => '{5}{G}{G}',
                    'type_line' => 'Creature - Elemental',
                    'oracle_text' => 'Create a 0/1 green Plant creature token.',
                    'power' => '5',
                    'toughness' => '5',
                    'colors' => ['G'],
                    'image_uris' => ['normal' => 'https://cards.scryfall.io/avenger-front.jpg'],
                ],
                [
                    'name' => 'Awakened Garden',
                    'type_line' => 'Creature - Plant',
                    'oracle_text' => 'Reach',
                    'power' => '0',
                    'toughness' => '1',
                    'colors' => ['G'],
                    'image_uris' => ['normal' => 'https://cards.scryfall.io/avenger-back.jpg'],
                ],
            ],
            'all_parts' => [
                [
                    'id' => $plantToken->scryfallId(),
                    'component' => 'token',
                    'name' => 'Plant Token',
                    'type_line' => 'Token Creature - Plant',
                    'uri' => 'https://api.scryfall.com/cards/'.$plantToken->scryfallId(),
                ],
            ],
        ]);
        $alternateTokenProducer = $this->seedCard('00000000-0000-0000-0000-000000000006', 'Avenger of Zendikar', [
            'type_line' => 'Creature - Elemental',
            'oracle_text' => 'Create a 0/1 green Plant creature token.',
            'power' => '5',
            'toughness' => '5',
            'set' => 'alt',
            'collector_number' => '7',
        ]);
        $balaGed = $this->seedCard('00000000-0000-0000-0000-000000000005', 'Bala Ged Recovery // Bala Ged Sanctuary', [
            'type_line' => 'Sorcery // Land',
            'oracle_text' => 'Return target card from your graveyard to your hand.',
            'set' => 'tst',
            'collector_number' => '4',
        ]);
        $flavorNamedCard = $this->seedCard('00000000-0000-0000-0000-000000000007', 'Arcane Signet', [
            'type_line' => 'Artifact',
            'set' => 'tst',
            'collector_number' => '5',
            'flavor_name' => 'The Vault Key',
        ]);

        $this->jsonRequest('POST', '/deck-folders', ['name' => 'Commander', 'visibility' => 'public'], $token);
        self::assertResponseStatusCodeSame(201);
        $folder = $this->jsonResponse()['folder'];
        $folderId = (string) $folder['id'];
        self::assertSame('public', $folder['visibility']);

        $this->jsonRequest('GET', '/deck-folders', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('Commander', $this->jsonResponse()['data'][0]['name']);

        $this->jsonRequest('GET', '/deck-formats', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('commander', $this->jsonResponse()['data'][0]['id']);

        $this->jsonRequest('POST', '/decks', ['name' => 'Test Deck', 'folderId' => $folderId, 'visibility' => 'public', 'format' => 'commander'], $token);
        self::assertResponseStatusCodeSame(201);
        $createdDeck = $this->jsonResponse()['deck'];
        $deckId = (string) $createdDeck['id'];
        self::assertSame('commander', $createdDeck['format']);
        self::assertFalse($createdDeck['valid']);
        self::assertSame('public', $createdDeck['visibility']);
        self::assertSame('back_5', $createdDeck['backgroundName']);
        self::assertSame('facedown_card', $createdDeck['sleevesName']);

        $this->jsonRequest('POST', '/decks', ['name' => 'Private Deck', 'folderId' => $folderId, 'visibility' => 'private'], $token);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('GET', '/deck-folders', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('public', $this->jsonResponse()['data'][0]['visibility']);

        $this->jsonRequest('PATCH', '/deck-folders/'.$folderId, ['name' => 'Commander', 'visibility' => 'private'], $token);
        self::assertResponseIsSuccessful();
        self::assertSame('private', $this->jsonResponse()['folder']['visibility']);

        $this->jsonRequest('GET', '/decks?folderId='.$folderId, token: $token);
        self::assertResponseIsSuccessful();
        $folderDecks = $this->jsonResponse()['data'];
        self::assertContains($deckId, array_column($folderDecks, 'id'));
        self::assertSame('public', $this->deckById($folderDecks, $deckId)['visibility']);

        $this->jsonRequest('PATCH', '/decks/'.$deckId, ['name' => 'Renamed Deck'], $otherToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('POST', '/decklists/parse', [
            'format' => 'moxfield',
            'decklist' => <<<TXT
Commander
1x Missing Commander (TST) 999

Deck
1x Sol Ring (TST) 1
1x Missing Spell
TXT,
        ], $token);
        self::assertResponseIsSuccessful();
        $preview = $this->jsonResponse();
        self::assertSame('moxfield', $preview['format']);
        self::assertSame(3, $preview['summary']['totalCards']);
        self::assertSame(1, $preview['summary']['resolvedCards']);
        self::assertSame(1, $preview['summary']['importedCards']);
        self::assertSame(2, $preview['summary']['missingCards']);
        self::assertCount(2, $preview['missingCards']);

        $this->jsonRequest('POST', '/decklists/parse', [
            'decklist' => <<<TXT
Commander
1x Missing Commander (TST) 999

Deck
1x Sol Ring (TST) 1
TXT,
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertSame('moxfield', $this->jsonResponse()['format']);
        self::assertSame('moxfield', $this->jsonResponse()['summary']['format']);

        $this->jsonRequest('POST', '/decklists/parse', [
            'decklist' => <<<TXT
Commanders (1)
1 Missing Commander (TST) 999

Artifacts (1)
1 Sol Ring (TST) 1
TXT,
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertSame('archidekt', $this->jsonResponse()['format']);
        self::assertSame('archidekt', $this->jsonResponse()['summary']['format']);

        $this->jsonRequest('GET', '/decks/'.$deckId, token: $token);
        self::assertResponseIsSuccessful();
        self::assertCount(0, $this->jsonResponse()['deck']['cards']);
        self::assertSame('back_5', $this->jsonResponse()['deck']['backgroundName']);
        self::assertSame('facedown_card', $this->jsonResponse()['deck']['sleevesName']);

        $this->jsonRequest('POST', '/decks/'.$deckId.'/cards', [
            'scryfallId' => $solRing->scryfallId(),
            'quantity' => 1,
            'section' => 'main',
        ], $token);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('POST', '/decks/'.$deckId.'/cards', [
            'scryfallId' => $solRing->scryfallId(),
            'quantity' => 2,
            'section' => 'main',
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $deck = $this->jsonResponse()['deck'];
        self::assertSame(3, $deck['cards'][0]['quantity']);
        $deckCardId = (string) $deck['cards'][0]['id'];

        $this->jsonRequest('PATCH', '/decks/'.$deckId.'/cards/'.$deckCardId, [
            'quantity' => 1,
            'section' => 'commander',
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertSame('commander', $this->jsonResponse()['deck']['cards'][0]['section']);

        $this->jsonRequest('DELETE', '/decks/'.$deckId.'/cards/'.$deckCardId, token: $token);
        self::assertResponseIsSuccessful();
        self::assertCount(0, $this->jsonResponse()['deck']['cards']);

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'decklist' => <<<TXT
Deck
1x Sol Ring (TST) 1
2x Island (TST) 2
TXT,
        ], $token);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame('moxfield', $response['format']);
        self::assertSame('moxfield', $response['summary']['format']);
        self::assertSame([], $response['missing']);
        self::assertSame(3, $response['summary']['totalCards']);
        self::assertSame(3, $response['summary']['resolvedCards']);
        self::assertSame(3, $response['summary']['importedCards']);
        self::assertSame(0, $response['summary']['missingCards']);
        self::assertSame([], $response['missingCards']);
        self::assertCount(2, $response['deck']['cards']);
        self::assertContains($island->scryfallId(), array_map(static fn (array $card) => $card['card']['scryfallId'], $response['deck']['cards']));

        $this->jsonRequest('POST', '/decks', ['name' => 'Import Rules Deck'], $token);
        self::assertResponseStatusCodeSame(201);
        $importRulesDeckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$importRulesDeckId.'/import', [
            'commanderScryfallId' => $tokenProducer->scryfallId(),
            'decklist' => <<<TXT
Deck
1x Avenger of Zendikar (TST) 3
99x Island (TST) 2
TXT,
        ], $token);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(100, $response['summary']['totalCards']);
        self::assertSame(1, $response['summary']['commanderCount']);
        self::assertSame(99, $response['summary']['mainCount']);
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $tokenProducer->scryfallId(), 'commander')['quantity']);
        self::assertNull($this->lineByScryfallIdOrNull($response['deck']['cards'], $tokenProducer->scryfallId(), 'main'));

        $this->jsonRequest('POST', '/decks/'.$importRulesDeckId.'/import', [
            'commanderScryfallId' => $tokenProducer->scryfallId(),
            'decklist' => <<<TXT
Deck
1x Avenger of Zendikar (ALT) 7
99x Island (TST) 2
TXT,
        ], $token);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $tokenProducer->scryfallId(), 'commander')['quantity']);
        self::assertNull($this->lineByScryfallIdOrNull($response['deck']['cards'], $alternateTokenProducer->scryfallId(), 'main'));

        $this->jsonRequest('POST', '/decks/'.$importRulesDeckId.'/import', [
            'commanderScryfallId' => $balaGed->scryfallId(),
            'decklist' => <<<TXT
Deck
1x Bala Ged Recovery
99x Island (TST) 2
TXT,
        ], $token);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $balaGed->scryfallId(), 'commander')['quantity']);
        self::assertNull($this->lineByScryfallIdOrNull($response['deck']['cards'], $balaGed->scryfallId(), 'main'));

        $this->jsonRequest('POST', '/decks/'.$importRulesDeckId.'/import', [
            'decklist' => '1 Bala Ged Recovery',
        ], $token);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame([], $response['missing']);
        self::assertSame($balaGed->scryfallId(), $response['deck']['cards'][0]['card']['scryfallId']);

        $this->jsonRequest('POST', '/decks/'.$importRulesDeckId.'/import', [
            'decklist' => '1 The Vault Key',
        ], $token);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame([], $response['missing']);
        self::assertSame($flavorNamedCard->scryfallId(), $response['deck']['cards'][0]['card']['scryfallId']);

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'Flavor Quick',
            'cards' => [
                ['name' => 'The Vault Key'],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $response = $this->jsonResponse();
        self::assertSame([], $response['missing']);
        self::assertSame($flavorNamedCard->scryfallId(), $response['deck']['cards'][0]['card']['scryfallId']);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/export?format=plain', token: $token);
        self::assertResponseIsSuccessful();
        self::assertStringContainsString("Deck\n1 Sol Ring", $this->jsonResponse()['content']);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/export?format=moxfield', token: $token);
        self::assertResponseIsSuccessful();
        self::assertStringContainsString('1x Sol Ring (TST) 1', $this->jsonResponse()['content']);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/export?format=archidekt', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('archidekt', $this->jsonResponse()['format']);
        self::assertStringContainsString('Mainboard', $this->jsonResponse()['content']);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/analysis', token: $token);
        self::assertResponseIsSuccessful();
        $analysis = $this->jsonResponse();
        self::assertSame(3, $analysis['summary']['totalCards']);
        self::assertSame(2, $analysis['summary']['landCount']);
        self::assertSame(1, $analysis['summary']['nonLandCount']);
        self::assertSame(1, $analysis['summary']['artifactCount']);
        self::assertArrayHasKey('manaCurve', $analysis);
        self::assertArrayHasKey('colorRequirement', $analysis);
        self::assertArrayHasKey('manaProduction', $analysis);
        self::assertArrayHasKey('curvePlayability', $analysis);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/analysis?includeSideboard=true&includeMaybeboard=true&curvePlayabilityMode=draw&manaSourcesMode=landsAndRamp', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('draw', $this->jsonResponse()['options']['curvePlayabilityMode']);

        $this->jsonRequest('POST', '/decks/'.$deckId.'/validate-commander', token: $token);
        self::assertResponseIsSuccessful();
        $validation = $this->jsonResponse();
        self::assertFalse($validation['valid']);
        self::assertSame('commander', $validation['format']);
        self::assertArrayHasKey('counts', $validation);
        self::assertArrayHasKey('commander', $validation);
        self::assertNotEmpty($validation['errors']);
        self::assertArrayHasKey('warnings', $validation);
        self::assertContains('commander.missing', array_column($validation['errors'], 'code'));

        $this->jsonRequest('POST', '/decks/'.$deckId.'/cards', [
            'scryfallId' => $tokenProducer->scryfallId(),
            'quantity' => 1,
            'section' => 'sideboard',
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $tokenProducerLine = $this->lineByScryfallId($this->jsonResponse()['deck']['cards'], $tokenProducer->scryfallId(), 'sideboard');

        $this->jsonRequest('POST', '/decks/'.$deckId.'/cards', [
            'scryfallId' => $island->scryfallId(),
            'quantity' => 1,
            'section' => 'maybeboard',
        ], $token);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('PATCH', '/decks/'.$deckId.'/cards', [
            'cards' => [
                ['deckCardId' => $tokenProducerLine['id'], 'section' => 'maybeboard'],
            ],
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertSame('maybeboard', $this->lineByScryfallId($this->jsonResponse()['deck']['cards'], $tokenProducer->scryfallId(), 'maybeboard')['section']);

        $this->jsonRequest('GET', '/decks/'.$deckId, token: $token);
        self::assertResponseIsSuccessful();
        $deckLine = $this->lineByScryfallId($this->jsonResponse()['deck']['cards'], $tokenProducer->scryfallId(), 'maybeboard');
        self::assertSame('5', $deckLine['card']['power']);
        self::assertSame('5', $deckLine['card']['toughness']);
        self::assertSame('Awakened Garden', $deckLine['card']['cardFaces'][1]['name']);
        self::assertSame('0', $deckLine['card']['cardFaces'][1]['power']);
        self::assertSame('1', $deckLine['card']['cardFaces'][1]['toughness']);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/sections', token: $token);
        self::assertResponseIsSuccessful();
        $sections = $this->jsonResponse();
        self::assertSame(3, $sections['counts']['playableTotal']);
        self::assertSame(2, $sections['counts']['maybeboard']);
        self::assertSame(1, $sections['counts']['tokens']);
        self::assertSame('Plant Token', $sections['sections']['tokens'][0]['token']['name']);
        $sectionLine = $this->lineByScryfallId($sections['sections']['maybeboard'], $tokenProducer->scryfallId(), 'maybeboard');
        self::assertSame('5', $sectionLine['card']['power']);
        self::assertSame('5', $sectionLine['card']['toughness']);
        self::assertSame('Awakened Garden', $sectionLine['card']['cardFaces'][1]['name']);
        self::assertSame('0', $sectionLine['card']['cardFaces'][1]['power']);
        self::assertSame('1', $sectionLine['card']['cardFaces'][1]['toughness']);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/tokens', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame($deckId, $this->jsonResponse()['deckId']);
        self::assertSame('Plant Token', $this->jsonResponse()['data'][0]['token']['name']);
        self::assertSame([], $this->jsonResponse()['unresolved']);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/analysis', token: $otherToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/export', token: $otherToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'decklist' => '1 Sol Ring',
        ], $otherToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('POST', '/decks/'.$deckId.'/validate-commander', token: $otherToken);
        self::assertResponseStatusCodeSame(404);
    }

    public function testDerivedTokensUseOracleRelationAcrossLocalizedPrints(): void
    {
        $token = $this->registerAndLogin('localized-tokens@example.test', 'Localized Tokens');
        $otherToken = $this->registerAndLogin('localized-tokens-other@example.test', 'Other Tokens');
        $plantToken = $this->seedCard('10000000-0000-0000-0000-000000000001', 'Plant Token', [
            'type_line' => 'Token Creature - Plant',
            'set' => 'ttk',
            'collector_number' => '1',
        ]);
        $this->seedCard('10000000-0000-0000-0000-000000000002', 'Token Maker', [
            'oracle_id' => '10000000-0000-0000-0000-000000000099',
            'type_line' => 'Creature - Druid',
            'oracle_text' => 'Create a 0/1 green Plant creature token.',
            'lang' => 'en',
            'set' => 'eng',
            'collector_number' => '1',
            'all_parts' => [
                [
                    'id' => $plantToken->scryfallId(),
                    'component' => 'token',
                    'name' => 'Plant Token',
                    'uri' => 'https://api.scryfall.com/cards/'.$plantToken->scryfallId(),
                ],
            ],
        ]);
        $spanishPrint = $this->seedCard('10000000-0000-0000-0000-000000000003', 'Token Maker', [
            'oracle_id' => '10000000-0000-0000-0000-000000000099',
            'type_line' => 'Creature - Druid',
            'oracle_text' => 'Create a 0/1 green Plant creature token.',
            'lang' => 'es',
            'printed_name' => 'Creador de fichas',
            'set' => 'spa',
            'collector_number' => '1',
            'all_parts' => [],
        ]);

        $this->jsonRequest('PATCH', '/me', ['cardLanguage' => 'es'], $token);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/decks', ['name' => 'Oracle Tokens'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'decklist' => '1 Token Maker',
        ], $token);
        self::assertResponseIsSuccessful();
        $imported = $this->jsonResponse();
        self::assertSame($spanishPrint->scryfallId(), $imported['deck']['cards'][0]['card']['scryfallId']);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/tokens', token: $token);
        self::assertResponseIsSuccessful();
        $tokens = $this->jsonResponse();
        self::assertSame('Plant Token', $tokens['data'][0]['token']['name']);
        self::assertSame(
            'https://cards.scryfall.io/normal/front/10000000-0000-0000-0000-000000000001.jpg',
            $tokens['data'][0]['token']['imageUris']['normal'] ?? null,
        );
        self::assertSame([], $tokens['unresolved']);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/tokens', token: $otherToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/sections', token: $token);
        self::assertResponseIsSuccessful();
        $sections = $this->jsonResponse();
        self::assertSame(1, $sections['counts']['tokens']);
        self::assertSame('Plant Token', $sections['sections']['tokens'][0]['token']['name']);
        self::assertSame(
            'https://cards.scryfall.io/normal/front/10000000-0000-0000-0000-000000000001.jpg',
            $sections['sections']['tokens'][0]['token']['imageUris']['normal'] ?? null,
        );
    }

    public function testDerivedTokensFallbackToSourceScryfallIdWhenOracleIdIsMissing(): void
    {
        $token = $this->registerAndLogin('fallback-tokens@example.test', 'Fallback Tokens');
        $clueToken = $this->seedCard('10000000-0000-0000-0000-000000000011', 'Clue Token', [
            'type_line' => 'Token Artifact - Clue',
        ]);
        $producer = $this->seedCard('10000000-0000-0000-0000-000000000012', 'Clue Maker', [
            'oracle_id' => null,
            'type_line' => 'Creature - Human',
            'oracle_text' => 'Create a Clue token.',
            'all_parts' => [
                [
                    'id' => $clueToken->scryfallId(),
                    'component' => 'token',
                    'name' => 'Clue Token',
                    'uri' => 'https://api.scryfall.com/cards/'.$clueToken->scryfallId(),
                ],
            ],
        ]);

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'Scryfall Fallback',
            'cards' => [
                ['scryfallId' => $producer->scryfallId()],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('GET', '/decks/'.$deckId.'/tokens', token: $token);
        self::assertResponseIsSuccessful();
        $tokens = $this->jsonResponse();
        self::assertSame('Clue Token', $tokens['data'][0]['token']['name']);
        self::assertSame([], $tokens['unresolved']);
    }

    public function testDerivedTokensReturnRandomPrintFromTokenOraclePool(): void
    {
        $token = $this->registerAndLogin('random-token-print@example.test', 'Random Token Print');
        $tokenOracleId = '10000000-0000-0000-0000-000000000040';
        $originalToken = $this->seedCard('10000000-0000-0000-0000-000000000041', 'Plant Token', [
            'oracle_id' => $tokenOracleId,
            'type_line' => 'Token Creature - Plant',
            'set' => 'tok',
            'collector_number' => '1',
        ]);
        $alternateToken = $this->seedCard('10000000-0000-0000-0000-000000000042', 'Plant Token', [
            'oracle_id' => $tokenOracleId,
            'type_line' => 'Token Creature - Plant',
            'set' => 'tok',
            'collector_number' => '2',
        ]);
        $unrelatedSameNameToken = $this->seedCard('10000000-0000-0000-0000-000000000043', 'Plant Token', [
            'oracle_id' => '10000000-0000-0000-0000-000000000044',
            'type_line' => 'Token Creature - Plant',
            'set' => 'tok',
            'collector_number' => '3',
        ]);
        $producer = $this->seedCard('10000000-0000-0000-0000-000000000045', 'Random Plant Maker', [
            'oracle_id' => '10000000-0000-0000-0000-000000000046',
            'type_line' => 'Creature - Druid',
            'oracle_text' => 'Create a 0/1 green Plant creature token.',
            'all_parts' => [
                [
                    'id' => $originalToken->scryfallId(),
                    'component' => 'token',
                    'name' => 'Plant Token',
                    'uri' => 'https://api.scryfall.com/cards/'.$originalToken->scryfallId(),
                ],
            ],
        ]);

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'Random Token Prints',
            'cards' => [
                ['scryfallId' => $producer->scryfallId()],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $allowedTokenIds = [$originalToken->scryfallId(), $alternateToken->scryfallId()];
        for ($attempt = 0; $attempt < 5; ++$attempt) {
            $this->jsonRequest('GET', '/decks/'.$deckId.'/tokens', token: $token);
            self::assertResponseIsSuccessful();
            $tokens = $this->jsonResponse();
            $returnedToken = $tokens['data'][0]['token'] ?? null;

            self::assertIsArray($returnedToken);
            self::assertContains($returnedToken['scryfallId'] ?? null, $allowedTokenIds);
            self::assertNotSame($unrelatedSameNameToken->scryfallId(), $returnedToken['scryfallId'] ?? null);
            self::assertNotEmpty($returnedToken['imageUris']['normal'] ?? null);
            self::assertSame([], $tokens['unresolved']);
        }
    }

    public function testDerivedTokensCollapseEquivalentTokenRelationsFromSourceOraclePrints(): void
    {
        $token = $this->registerAndLogin('dedupe-token-relations@example.test', 'Dedupe Tokens');
        $sourceOracleId = '10000000-0000-0000-0000-000000000050';
        $tokenOracleId = '10000000-0000-0000-0000-000000000051';
        $firstTokenPrint = $this->seedCard('10000000-0000-0000-0000-000000000052', 'Elephant Token', [
            'oracle_id' => $tokenOracleId,
            'type_line' => 'Token Creature - Elephant',
            'set' => 'tok',
            'collector_number' => '1',
        ]);
        $secondTokenPrint = $this->seedCard('10000000-0000-0000-0000-000000000053', 'Elephant Token', [
            'oracle_id' => $tokenOracleId,
            'type_line' => 'Token Creature - Elephant',
            'set' => 'tok',
            'collector_number' => '2',
        ]);
        $firstSourcePrint = $this->seedCard('10000000-0000-0000-0000-000000000054', 'Gift Maker', [
            'oracle_id' => $sourceOracleId,
            'type_line' => 'Instant',
            'oracle_text' => 'Create a 3/3 green Elephant creature token.',
            'set' => 'one',
            'collector_number' => '1',
            'all_parts' => [
                [
                    'id' => $firstTokenPrint->scryfallId(),
                    'component' => 'token',
                    'name' => 'Elephant Token',
                    'uri' => 'https://api.scryfall.com/cards/'.$firstTokenPrint->scryfallId(),
                ],
            ],
        ]);
        $this->seedCard('10000000-0000-0000-0000-000000000055', 'Gift Maker', [
            'oracle_id' => $sourceOracleId,
            'type_line' => 'Instant',
            'oracle_text' => 'Create a 3/3 green Elephant creature token.',
            'set' => 'two',
            'collector_number' => '1',
            'all_parts' => [
                [
                    'id' => $secondTokenPrint->scryfallId(),
                    'component' => 'token',
                    'name' => 'Elephant Token',
                    'uri' => 'https://api.scryfall.com/cards/'.$secondTokenPrint->scryfallId(),
                ],
            ],
        ]);

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'Dedupe Token Prints',
            'cards' => [
                ['scryfallId' => $firstSourcePrint->scryfallId()],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('GET', '/decks/'.$deckId.'/tokens', token: $token);
        self::assertResponseIsSuccessful();
        $tokens = $this->jsonResponse();

        self::assertCount(1, $tokens['data']);
        self::assertSame('Elephant Token', $tokens['data'][0]['token']['name']);
        self::assertContains($tokens['data'][0]['token']['scryfallId'] ?? null, [
            $firstTokenPrint->scryfallId(),
            $secondTokenPrint->scryfallId(),
        ]);
        self::assertSame([], $tokens['unresolved']);
    }

    public function testDerivedTokensReturnOnlyOneRandomTokenRelationPerSourceCard(): void
    {
        $token = $this->registerAndLogin('single-token-relation@example.test', 'One Token');
        $firstToken = $this->seedCard('10000000-0000-0000-0000-000000000061', 'Clue Token', [
            'oracle_id' => '10000000-0000-0000-0000-000000000062',
            'type_line' => 'Token Artifact - Clue',
        ]);
        $secondToken = $this->seedCard('10000000-0000-0000-0000-000000000063', 'Treasure Token', [
            'oracle_id' => '10000000-0000-0000-0000-000000000064',
            'type_line' => 'Token Artifact - Treasure',
        ]);
        $producer = $this->seedCard('10000000-0000-0000-0000-000000000065', 'Two Token Maker', [
            'oracle_id' => '10000000-0000-0000-0000-000000000066',
            'type_line' => 'Creature - Artificer',
            'oracle_text' => 'Create a Clue token and a Treasure token.',
            'all_parts' => [
                [
                    'id' => $firstToken->scryfallId(),
                    'component' => 'token',
                    'name' => 'Clue Token',
                    'uri' => 'https://api.scryfall.com/cards/'.$firstToken->scryfallId(),
                ],
                [
                    'id' => $secondToken->scryfallId(),
                    'component' => 'token',
                    'name' => 'Treasure Token',
                    'uri' => 'https://api.scryfall.com/cards/'.$secondToken->scryfallId(),
                ],
            ],
        ]);

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'One Token Rel',
            'cards' => [
                ['scryfallId' => $producer->scryfallId()],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('GET', '/decks/'.$deckId.'/tokens', token: $token);
        self::assertResponseIsSuccessful();
        $tokens = $this->jsonResponse();

        self::assertCount(1, $tokens['data']);
        self::assertContains($tokens['data'][0]['token']['scryfallId'] ?? null, [
            $firstToken->scryfallId(),
            $secondToken->scryfallId(),
        ]);
        self::assertSame([], $tokens['unresolved']);
    }

    public function testDerivedTokensReportUnresolvedCatalogRelations(): void
    {
        $token = $this->registerAndLogin('unresolved-tokens@example.test', 'Unresolved Tokens');
        $producer = $this->seedCard('10000000-0000-0000-0000-000000000021', 'Unknown Token Maker', [
            'type_line' => 'Creature - Wizard',
            'oracle_text' => 'Create an unknown token.',
            'all_parts' => [
                [
                    'id' => '10000000-0000-0000-0000-000000000022',
                    'component' => 'token',
                    'name' => 'Unknown Test Token',
                    'uri' => 'https://api.scryfall.com/cards/10000000-0000-0000-0000-000000000022',
                ],
            ],
        ]);

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'Unresolved Tokens',
            'cards' => [
                ['scryfallId' => $producer->scryfallId()],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('GET', '/decks/'.$deckId.'/tokens', token: $token);
        self::assertResponseIsSuccessful();
        $tokens = $this->jsonResponse();
        self::assertSame([], $tokens['data']);
        self::assertSame('Unknown Test Token', $tokens['unresolved'][0]['token']['name']);
        self::assertSame('10000000-0000-0000-0000-000000000022', $tokens['unresolved'][0]['token']['scryfallId']);
    }

    public function testAuthoritativeDeckEditingEndpoints(): void
    {
        $token = $this->registerAndLogin('editor@example.test', 'Editor');
        $otherToken = $this->registerAndLogin('outsider@example.test', 'Outsider');
        $commanderA = $this->seedCard('00000000-0000-0000-0000-000000000101', 'Commander A', [
            'type_line' => 'Legendary Creature',
            'set' => 'tst',
            'collector_number' => '10',
        ]);
        $commanderB = $this->seedCard('00000000-0000-0000-0000-000000000102', 'Commander B', [
            'type_line' => 'Legendary Creature',
            'set' => 'tst',
            'collector_number' => '11',
        ]);
        $solRing = $this->seedCard('00000000-0000-0000-0000-000000000103', 'Sol Ring', [
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $island = $this->seedCard('00000000-0000-0000-0000-000000000104', 'Island', [
            'type_line' => 'Basic Land - Island',
            'set' => 'tst',
            'collector_number' => '2',
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000105', 'Ambiguous Card', [
            'set' => 'a01',
            'collector_number' => '1',
        ]);
        $this->seedCard('00000000-0000-0000-0000-000000000106', 'Ambiguous Card', [
            'set' => 'a02',
            'collector_number' => '1',
        ]);

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'Quick Deck',
            'cards' => [
                ['setCode' => 'tst', 'collectorNumber' => '1', 'quantity' => 2],
                ['name' => 'Missing Card', 'quantity' => 1],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $quick = $this->jsonResponse();
        self::assertSame(['Missing Card'], $quick['missing']);
        self::assertCount(1, $quick['missingCards']);
        $deckId = (string) $quick['deck']['id'];
        self::assertSame(2, $quick['deck']['cards'][0]['quantity']);
        $solRingDeckCardId = (string) $quick['deck']['cards'][0]['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/cards', [
            'setCode' => 'tst',
            'collectorNumber' => '2',
            'quantity' => 3,
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $deck = $this->jsonResponse()['deck'];
        $islandLine = $this->lineByScryfallId($deck['cards'], $island->scryfallId(), 'main');
        self::assertSame(3, $islandLine['quantity']);

        $this->jsonRequest('POST', '/decks/'.$deckId.'/cards', [
            'name' => 'Ambiguous Card',
        ], $token);
        self::assertResponseStatusCodeSame(409);
        self::assertCount(2, $this->jsonResponse()['matches']);

        $this->jsonRequest('PUT', '/decks/'.$deckId.'/commanders', [
            'cards' => [
                ['scryfallId' => $solRing->scryfallId()],
                ['scryfallId' => $commanderA->scryfallId()],
            ],
        ], $token);
        self::assertResponseIsSuccessful();
        $deck = $this->jsonResponse()['deck'];
        self::assertCount(2, $deck['commanders']);
        self::assertArrayNotHasKey('commander', $deck);
        self::assertSame(1, $this->lineByScryfallId($deck['cards'], $solRing->scryfallId(), 'main')['quantity']);
        self::assertSame(1, $this->lineByScryfallId($deck['cards'], $solRing->scryfallId(), 'commander')['quantity']);
        self::assertSame(1, $this->lineByScryfallId($deck['cards'], $commanderA->scryfallId(), 'commander')['quantity']);

        $this->jsonRequest('PUT', '/decks/'.$deckId.'/commanders', [
            'cards' => [
                ['scryfallId' => $commanderB->scryfallId()],
            ],
        ], $token);
        self::assertResponseIsSuccessful();
        $deck = $this->jsonResponse()['deck'];
        self::assertSame(2, $this->lineByScryfallId($deck['cards'], $solRing->scryfallId(), 'main')['quantity']);
        self::assertSame(1, $this->lineByScryfallId($deck['cards'], $commanderA->scryfallId(), 'main')['quantity']);
        self::assertSame(1, $this->lineByScryfallId($deck['cards'], $commanderB->scryfallId(), 'commander')['quantity']);

        $this->jsonRequest('GET', '/decks', token: $token);
        self::assertResponseIsSuccessful();
        $listedDeck = $this->deckById($this->jsonResponse()['data'], $deckId);
        self::assertCount(1, $listedDeck['commanders']);
        self::assertSame($commanderB->scryfallId(), $listedDeck['commanders'][0]['scryfallId']);
        self::assertArrayNotHasKey('commander', $listedDeck);

        $islandLine = $this->lineByScryfallId($deck['cards'], $island->scryfallId(), 'main');
        $this->jsonRequest('PATCH', '/decks/'.$deckId.'/cards', [
            'cards' => [
                ['deckCardId' => $solRingDeckCardId, 'quantity' => 4],
                ['deckCardId' => $islandLine['id'], 'quantity' => 0],
            ],
        ], $token);
        self::assertResponseIsSuccessful();
        $deck = $this->jsonResponse()['deck'];
        self::assertSame(4, $this->lineByScryfallId($deck['cards'], $solRing->scryfallId(), 'main')['quantity']);
        self::assertNull($this->lineByScryfallIdOrNull($deck['cards'], $island->scryfallId(), 'main'));

        $this->jsonRequest('PUT', '/decks/'.$deckId.'/commanders', [
            'cards' => [
                ['scryfallId' => $commanderA->scryfallId()],
                ['scryfallId' => $commanderB->scryfallId()],
                ['scryfallId' => $solRing->scryfallId()],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('PATCH', '/decks/'.$deckId.'/cards', ['cards' => []], $otherToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('PUT', '/decks/'.$deckId.'/commanders', ['cards' => []], $otherToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'Outsider Folder',
            'folderId' => '00000000-0000-0000-0000-000000000000',
        ], $otherToken);
        self::assertResponseStatusCodeSame(404);
    }

    public function testDeckCardPrintVersionCanBeListedAndSelected(): void
    {
        $token = $this->registerAndLogin('prints@example.test', 'Prints');
        $firstPrint = $this->seedCard('00000000-0000-0000-0000-000000000201', 'Sol Ring', [
            'set' => 'one',
            'collector_number' => '1',
            'lang' => 'en',
        ]);
        $secondPrint = $this->seedCard('00000000-0000-0000-0000-000000000202', 'Sol Ring', [
            'set' => 'two',
            'collector_number' => '2',
            'lang' => 'es',
            'printed_name' => 'Anillo solar',
        ]);
        $placeholderPreferredPrint = $this->seedCard('00000000-0000-0000-0000-000000000206', 'Sol Ring', [
            'set' => 'five',
            'collector_number' => '5',
            'lang' => 'es',
            'printed_name' => 'Anillo solar',
            'image_status' => 'placeholder',
        ]);
        $thirdPrint = $this->seedCard('00000000-0000-0000-0000-000000000204', 'Sol Ring', [
            'set' => 'three',
            'collector_number' => '3',
            'lang' => 'pt',
        ]);
        $commonLanguagePrint = $this->seedCard('00000000-0000-0000-0000-000000000205', 'Sol Ring', [
            'set' => 'four',
            'collector_number' => '4',
            'lang' => 'ph',
        ]);
        $differentCard = $this->seedCard('00000000-0000-0000-0000-000000000203', 'Arcane Signet', [
            'set' => 'one',
            'collector_number' => '3',
        ]);

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'Prints',
            'cards' => [
                ['scryfallId' => $firstPrint->scryfallId(), 'quantity' => 2],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $deck = $this->jsonResponse()['deck'];
        $deckId = (string) $deck['id'];
        $deckCardId = (string) $deck['cards'][0]['id'];

        $this->jsonRequest('PATCH', '/me', ['cardLanguage' => 'es'], $token);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('GET', '/decks/'.$deckId.'/cards/'.$deckCardId.'/printings', token: $token);
        self::assertResponseIsSuccessful();
        $printings = $this->jsonResponse()['data'];
        self::assertEqualsCanonicalizing(
            [$secondPrint->scryfallId(), $commonLanguagePrint->scryfallId()],
            array_column($printings, 'scryfallId'),
        );
        self::assertNotContains($placeholderPreferredPrint->scryfallId(), array_column($printings, 'scryfallId'));

        $this->jsonRequest('PATCH', '/me', ['cardLanguage' => 'de'], $token);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('GET', '/decks/'.$deckId.'/cards/'.$deckCardId.'/printings', token: $token);
        self::assertResponseIsSuccessful();
        $printings = $this->jsonResponse()['data'];
        self::assertEqualsCanonicalizing(
            [$firstPrint->scryfallId(), $commonLanguagePrint->scryfallId()],
            array_column($printings, 'scryfallId'),
        );
        self::assertNotContains($thirdPrint->scryfallId(), array_column($printings, 'scryfallId'));
        self::assertNotContains($differentCard->scryfallId(), array_column($printings, 'scryfallId'));

        $this->jsonRequest('PATCH', '/decks/'.$deckId.'/cards/'.$deckCardId.'/printing', [
            'scryfallId' => $secondPrint->scryfallId(),
        ], $token);
        self::assertResponseIsSuccessful();
        $updatedLine = $this->jsonResponse()['deck']['cards'][0];
        self::assertSame($deckCardId, $updatedLine['id']);
        self::assertSame(2, $updatedLine['quantity']);
        self::assertSame($secondPrint->scryfallId(), $updatedLine['card']['scryfallId']);

        $this->jsonRequest('PATCH', '/decks/'.$deckId.'/cards/'.$deckCardId.'/printing', [
            'scryfallId' => $differentCard->scryfallId(),
        ], $token);
        self::assertResponseStatusCodeSame(422);
    }

    public function testDeckCardPrintVersionsFallbackToEnglishWhenPreferredImagesAreUnavailable(): void
    {
        $token = $this->registerAndLogin('placeholder-prints@example.test', 'Placeholder Prints');
        $englishPrint = $this->seedCard('00000000-0000-0000-0000-000000000207', 'Placeholder Ring', [
            'set' => 'one',
            'collector_number' => '1',
            'lang' => 'en',
            'image_status' => 'highres_scan',
        ]);
        $placeholderPrint = $this->seedCard('00000000-0000-0000-0000-000000000208', 'Placeholder Ring', [
            'set' => 'two',
            'collector_number' => '2',
            'lang' => 'es',
            'printed_name' => 'Anillo placeholder',
            'image_status' => 'placeholder',
        ]);

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'Placeholder Prints',
            'cards' => [
                ['scryfallId' => $englishPrint->scryfallId(), 'quantity' => 1],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $deck = $this->jsonResponse()['deck'];
        $deckId = (string) $deck['id'];
        $deckCardId = (string) $deck['cards'][0]['id'];

        $this->jsonRequest('PATCH', '/me', ['cardLanguage' => 'es'], $token);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('GET', '/decks/'.$deckId.'/cards/'.$deckCardId.'/printings', token: $token);
        self::assertResponseIsSuccessful();
        $printings = $this->jsonResponse()['data'];

        self::assertSame([$englishPrint->scryfallId()], array_column($printings, 'scryfallId'));
        self::assertNotContains($placeholderPrint->scryfallId(), array_column($printings, 'scryfallId'));
    }

    public function testDeckCardPrintVersionsDoNotFallbackWhenPreferredLanguageIsEnglish(): void
    {
        $token = $this->registerAndLogin('english-prints@example.test', 'English Prints');
        $firstPrint = $this->seedCard('00000000-0000-0000-0000-000000000211', 'Language Locked', [
            'set' => 'one',
            'collector_number' => '1',
            'lang' => 'es',
            'printed_name' => 'Bloqueado por idioma',
        ]);
        $secondPrint = $this->seedCard('00000000-0000-0000-0000-000000000212', 'Language Locked', [
            'set' => 'two',
            'collector_number' => '2',
            'lang' => 'pt',
        ]);
        $commonLanguagePrint = $this->seedCard('00000000-0000-0000-0000-000000000213', 'Language Locked', [
            'set' => 'three',
            'collector_number' => '3',
            'lang' => 'ph',
        ]);

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'English Prints',
            'cards' => [
                ['scryfallId' => $firstPrint->scryfallId(), 'quantity' => 1],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $deck = $this->jsonResponse()['deck'];
        $deckId = (string) $deck['id'];
        $deckCardId = (string) $deck['cards'][0]['id'];

        $this->jsonRequest('PATCH', '/me', ['cardLanguage' => 'en'], $token);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('GET', '/decks/'.$deckId.'/cards/'.$deckCardId.'/printings', token: $token);
        self::assertResponseIsSuccessful();
        $printings = $this->jsonResponse()['data'];

        self::assertSame([$commonLanguagePrint->scryfallId()], array_column($printings, 'scryfallId'));
        self::assertNotContains($firstPrint->scryfallId(), array_column($printings, 'scryfallId'));
        self::assertNotContains($secondPrint->scryfallId(), array_column($printings, 'scryfallId'));
    }

    public function testDeckCreateRejectsUnknownFormat(): void
    {
        $token = $this->registerAndLogin('invalid-format-deck@example.test', 'Invalid Format');

        $this->jsonRequest('POST', '/decks', ['name' => 'Bad Format', 'format' => 'modern'], $token);

        self::assertResponseStatusCodeSame(400);
        self::assertSame('Deck format is invalid.', $this->jsonResponse()['error']);
    }

    public function testDeckPayloadLocalizesEveryCommanderAndKeepsLegacyCommanderAlias(): void
    {
        $token = $this->registerAndLogin('deck-commanders-localized@example.test', 'Deck Commanders');
        $this->jsonRequest('PATCH', '/me', ['cardLanguage' => 'es'], $token);
        self::assertResponseIsSuccessful();

        $firstCommander = $this->seedCard('40000000-0000-0000-0000-000000000001', 'First Partner', [
            'type_line' => 'Legendary Creature - Human Scout',
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $secondCommander = $this->seedCard('40000000-0000-0000-0000-000000000002', 'Second Partner', [
            'type_line' => 'Legendary Creature - Human Scout',
            'set' => 'tst',
            'collector_number' => '2',
        ]);
        $this->seedLocalizedPrintLocale(
            $firstCommander->scryfallId(),
            'First Partner',
            'es',
            'Primer socio',
            ['art_crop' => 'https://cards.scryfall.io/art_crop/front/first-partner-es.jpg'],
        );
        $this->seedLocalizedPrintLocale(
            $secondCommander->scryfallId(),
            'Second Partner',
            'es',
            'Segundo socio',
            ['art_crop' => 'https://cards.scryfall.io/art_crop/front/second-partner-es.jpg'],
        );

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'Localized Partners',
            'cards' => [
                ['scryfallId' => $firstCommander->scryfallId(), 'quantity' => 1, 'section' => 'commander'],
                ['scryfallId' => $secondCommander->scryfallId(), 'quantity' => 1, 'section' => 'commander'],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);

        $deck = $this->jsonResponse()['deck'];
        self::assertCount(2, $deck['commanders']);
        self::assertSame('Primer socio', $deck['commanders'][0]['printedName']);
        self::assertSame('Segundo socio', $deck['commanders'][1]['printedName']);
        self::assertSame('https://cards.scryfall.io/art_crop/front/first-partner-es.jpg', $deck['commanders'][0]['imageUris']['art_crop'] ?? null);
        self::assertSame('https://cards.scryfall.io/art_crop/front/second-partner-es.jpg', $deck['commanders'][1]['imageUris']['art_crop'] ?? null);
        self::assertArrayNotHasKey('commander', $deck);
    }

    public function testDeckPayloadKeepsCanonicalTypeLinesWhenCardLanguageIsLocalized(): void
    {
        $token = $this->registerAndLogin('deck-type-line-canonical@example.test', 'Deck Type Line');
        $this->jsonRequest('PATCH', '/me', ['cardLanguage' => 'es'], $token);
        self::assertResponseIsSuccessful();

        $arcaneSignet = $this->seedCard('41000000-0000-0000-0000-000000000001', 'Arcane Signet', [
            'type_line' => 'Artifact',
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedLocalizedPrintLocale(
            $arcaneSignet->scryfallId(),
            'Arcane Signet',
            'es',
            'Sello arcano',
            ['art_crop' => 'https://cards.scryfall.io/art_crop/front/arcane-signet-es.jpg'],
            'Artefacto',
        );

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'Canonical Types',
            'cards' => [
                ['scryfallId' => $arcaneSignet->scryfallId(), 'quantity' => 1, 'section' => 'main'],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);

        $deck = $this->jsonResponse()['deck'];
        $deckId = (string) $deck['id'];
        self::assertSame('Sello arcano', $deck['cards'][0]['card']['printedName']);
        self::assertSame('Artifact', $deck['cards'][0]['card']['typeLine']);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/sections', token: $token);
        self::assertResponseIsSuccessful();
        $sections = $this->jsonResponse()['sections'];
        self::assertSame('Sello arcano', $sections['main'][0]['card']['printedName']);
        self::assertSame('Artifact', $sections['main'][0]['card']['typeLine']);
    }

    public function testDecklistImportSelectsPersistedPrintsByUserLanguage(): void
    {
        $token = $this->registerAndLogin('language-import@example.test', 'Language Import');
        $this->jsonRequest('PATCH', '/me', ['cardLanguage' => 'es'], $token);
        self::assertResponseIsSuccessful();

        $solRingSpanishA = $this->seedCard('10000000-0000-0000-0000-000000000001', 'Sol Ring', [
            'set' => 'esa',
            'collector_number' => '1',
            'lang' => 'es',
            'printed_name' => 'Anillo solar',
        ]);
        $solRingSpanishB = $this->seedCard('10000000-0000-0000-0000-000000000002', 'Sol Ring', [
            'set' => 'esb',
            'collector_number' => '2',
            'lang' => 'es',
            'printed_name' => 'Anillo solar',
        ]);
        $this->seedCard('10000000-0000-0000-0000-000000000003', 'Sol Ring', [
            'set' => 'eng',
            'collector_number' => '3',
            'lang' => 'en',
        ]);
        $darkRitualEnglish = $this->seedCard('10000000-0000-0000-0000-000000000004', 'Dark Ritual', [
            'set' => 'eng',
            'collector_number' => '4',
            'lang' => 'en',
        ]);
        $this->seedCard('10000000-0000-0000-0000-000000000005', 'Dark Ritual', [
            'set' => 'ptg',
            'collector_number' => '5',
            'lang' => 'pt',
            'printed_name' => 'Ritual Sombrio',
        ]);
        $arcaneSignetSpanish = $this->seedCard('10000000-0000-0000-0000-000000000006', 'Arcane Signet', [
            'set' => 'esp',
            'collector_number' => '6',
            'lang' => 'es',
            'printed_name' => 'Sello arcano',
        ]);
        $this->seedCard('10000000-0000-0000-0000-000000000007', 'Arcane Signet', [
            'set' => 'frc',
            'collector_number' => '9',
            'lang' => 'fr',
            'printed_name' => 'Cachet arcanique',
        ]);
        $this->seedCard('10000000-0000-0000-0000-000000000008', 'Mana Vault', [
            'set' => 'frv',
            'collector_number' => '10',
            'lang' => 'fr',
            'printed_name' => 'Coffre de mana',
        ]);
        $this->seedCard('10000000-0000-0000-0000-000000000009', 'Mana Vault', [
            'set' => 'ptv',
            'collector_number' => '11',
            'lang' => 'pt',
            'printed_name' => 'Cofre de mana',
        ]);

        $this->jsonRequest('POST', '/decks', ['name' => 'Language Import'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'decklist' => <<<TXT
Deck
1x Sol Ring
1x Dark Ritual
1x Arcane Signet (FRC) 9
1x Mana Vault
TXT,
        ], $token);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(['Mana Vault'], $response['missing']);
        self::assertCount(1, $response['missingCards']);
        self::assertSame(4, $response['summary']['totalCards']);
        self::assertSame(3, $response['summary']['resolvedCards']);
        self::assertSame(3, $response['summary']['importedCards']);
        self::assertSame(1, $response['summary']['missingCards']);

        $storedDeck = $this->storedDeck($deckId);
        self::assertCount(3, $storedDeck->cards());
        self::assertContains(
            $this->storedDeckCardScryfallId($storedDeck, 'Sol Ring'),
            [$solRingSpanishA->scryfallId(), $solRingSpanishB->scryfallId()],
        );
        self::assertSame($darkRitualEnglish->scryfallId(), $this->storedDeckCardScryfallId($storedDeck, 'Dark Ritual'));
        self::assertSame($arcaneSignetSpanish->scryfallId(), $this->storedDeckCardScryfallId($storedDeck, 'Arcane Signet'));
    }

    public function testDecklistParseIgnoresKnownMetadataAndRecognizesDeckstatsCommanderMarker(): void
    {
        $token = $this->registerAndLogin('parse-deckstats@example.test', 'Parse Deckstats');
        $this->seedCard('90000000-0000-0000-0000-000000000001', 'Sliver Gravemother', [
            'type_line' => 'Legendary Creature - Sliver',
            'set' => 'tst',
            'collector_number' => '1',
            'legalities' => ['commander' => 'legal'],
        ]);
        $this->seedCard('90000000-0000-0000-0000-000000000002', 'Arcane Signet', [
            'type_line' => 'Artifact',
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $this->jsonRequest('POST', '/decklists/parse', [
            'decklist' => <<<TXT
About
Name Slivers from deckstats.net

1 Sliver Gravemother # !Commander
1 Arcane Signet
TXT,
        ], $token);
        self::assertResponseIsSuccessful();

        $preview = $this->jsonResponse();
        self::assertSame('plain', $preview['format']);
        self::assertSame([], $preview['missingCards']);
        self::assertSame(2, $preview['summary']['totalCards']);
        self::assertSame(1, $preview['summary']['commanderCount']);
        self::assertSame(1, $preview['summary']['mainCount']);
        self::assertSame('Sliver Gravemother', $preview['entries'][0]['name']);
        self::assertSame('commander', $preview['entries'][0]['section']);
    }

    public function testDecklistParseRecognizesArchidektInlineCommanderTags(): void
    {
        $token = $this->registerAndLogin('parse-archidekt@example.test', 'Parse Archidekt');
        $this->seedCard('91000000-0000-0000-0000-000000000001', 'Ghyrson Starn, Kelermorph', [
            'type_line' => 'Legendary Creature - Human Tyranid',
            'set' => '40k',
            'collector_number' => '124',
            'legalities' => ['commander' => 'legal'],
        ]);
        $this->seedCard('91000000-0000-0000-0000-000000000002', 'Island', [
            'type_line' => 'Basic Land - Island',
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $this->jsonRequest('POST', '/decklists/parse', [
            'decklist' => <<<TXT
1x Ghyrson Starn, Kelermorph (40k) 124 [Commander{top}]
14x Island (TST) 2 [Land]
TXT,
        ], $token);
        self::assertResponseIsSuccessful();

        $preview = $this->jsonResponse();
        self::assertSame('archidekt', $preview['format']);
        self::assertSame([], $preview['missingCards']);
        self::assertSame(15, $preview['summary']['totalCards']);
        self::assertSame(1, $preview['summary']['commanderCount']);
        self::assertSame(14, $preview['summary']['mainCount']);
        self::assertSame('Ghyrson Starn, Kelermorph', $preview['entries'][0]['name']);
        self::assertSame('commander', $preview['entries'][0]['section']);
    }

    public function testDecklistImportInfersCommanderFromFirstBoundaryEntryInMoxfieldExports(): void
    {
        $token = $this->registerAndLogin('import-moxfield-first@example.test', 'Import Mox First');
        $commander = $this->seedCard('92000000-0000-0000-0000-000000000001', 'Muldrotha, the Gravetide', [
            'type_line' => 'Legendary Creature - Elemental Avatar',
            'set' => 'fdn',
            'collector_number' => '243',
            'legalities' => ['commander' => 'legal'],
        ]);
        $signet = $this->seedCard('92000000-0000-0000-0000-000000000002', 'Arcane Signet', [
            'type_line' => 'Artifact',
            'set' => 'mkc',
            'collector_number' => '223',
        ]);
        $island = $this->seedCard('92000000-0000-0000-0000-000000000003', 'Island', [
            'type_line' => 'Basic Land - Island',
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $this->jsonRequest('POST', '/decks', ['name' => 'Moxfield First'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'decklist' => <<<TXT
1 Muldrotha, the Gravetide (FDN) 243
1 Arcane Signet (MKC) 223
98 Island (TST) 2
TXT,
        ], $token);
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        self::assertSame('moxfield', $response['format']);
        self::assertSame([], $response['missing']);
        self::assertSame(100, $response['summary']['totalCards']);
        self::assertSame(1, $response['summary']['commanderCount']);
        self::assertSame(99, $response['summary']['mainCount']);
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $commander->scryfallId(), 'commander')['quantity']);
        self::assertNull($this->lineByScryfallIdOrNull($response['deck']['cards'], $commander->scryfallId(), 'main'));
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $signet->scryfallId(), 'main')['quantity']);
        self::assertSame(98, $this->lineByScryfallId($response['deck']['cards'], $island->scryfallId(), 'main')['quantity']);
    }

    public function testDecklistImportInfersCommanderFromLastBoundaryEntryInMtgoExports(): void
    {
        $token = $this->registerAndLogin('import-mtgo-last@example.test', 'Import MTGO Last');
        $commander = $this->seedCard('93000000-0000-0000-0000-000000000001', 'Muldrotha, the Gravetide', [
            'type_line' => 'Legendary Creature - Elemental Avatar',
            'set' => 'tst',
            'collector_number' => '1',
            'legalities' => ['commander' => 'legal'],
        ]);
        $signet = $this->seedCard('93000000-0000-0000-0000-000000000002', 'Arcane Signet', [
            'type_line' => 'Artifact',
            'set' => 'tst',
            'collector_number' => '2',
        ]);
        $island = $this->seedCard('93000000-0000-0000-0000-000000000003', 'Island', [
            'type_line' => 'Basic Land - Island',
            'set' => 'tst',
            'collector_number' => '3',
        ]);

        $this->jsonRequest('POST', '/decks', ['name' => 'MTGO Last'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'decklist' => <<<TXT
1 Arcane Signet
98 Island
1 Muldrotha, the Gravetide
TXT,
        ], $token);
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        self::assertSame('plain', $response['format']);
        self::assertSame([], $response['missing']);
        self::assertSame(100, $response['summary']['totalCards']);
        self::assertSame(1, $response['summary']['commanderCount']);
        self::assertSame(99, $response['summary']['mainCount']);
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $commander->scryfallId(), 'commander')['quantity']);
        self::assertNull($this->lineByScryfallIdOrNull($response['deck']['cards'], $commander->scryfallId(), 'main'));
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $signet->scryfallId(), 'main')['quantity']);
        self::assertSame(98, $this->lineByScryfallId($response['deck']['cards'], $island->scryfallId(), 'main')['quantity']);
    }

    public function testDecklistImportSupportsCommanderZoneExportsInUserLanguageOrEnglish(): void
    {
        $token = $this->registerAndLogin('import-cz-export@example.test', 'Import CZ Export');
        $this->jsonRequest('PATCH', '/me', ['cardLanguage' => 'es'], $token);
        self::assertResponseIsSuccessful();

        $talrand = $this->seedCard('94000000-0000-0000-0000-000000000001', 'Talrand, Sky Summoner', [
            'type_line' => 'Legendary Creature - Merfolk Wizard',
            'set' => 'tst',
            'collector_number' => '1',
            'legalities' => ['commander' => 'legal'],
        ]);
        $solRing = $this->seedCard('94000000-0000-0000-0000-000000000002', 'Sol Ring', [
            'type_line' => 'Artifact',
            'set' => 'tst',
            'collector_number' => '2',
        ]);
        $counterspell = $this->seedCard('94000000-0000-0000-0000-000000000003', 'Counterspell', [
            'type_line' => 'Instant',
            'set' => 'tst',
            'collector_number' => '3',
        ]);

        $this->seedLocalizedPrintLocale($talrand->scryfallId(), 'Talrand, Sky Summoner', 'es', 'Talrand, invocador celeste');
        $this->seedLocalizedPrintLocale($solRing->scryfallId(), 'Sol Ring', 'es', 'Anillo solar');

        $this->jsonRequest('POST', '/decks', ['name' => 'CZ Export'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'decklist' => <<<TXT
Commander
1 Talrand, invocador celeste

Deck
1 Anillo solar
1 Counterspell
TXT,
        ], $token);
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        self::assertSame([], $response['missing']);
        self::assertSame(3, $response['summary']['totalCards']);
        self::assertSame(1, $response['summary']['commanderCount']);
        self::assertSame(2, $response['summary']['mainCount']);
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $talrand->scryfallId(), 'commander')['quantity']);
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $solRing->scryfallId(), 'main')['quantity']);
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $counterspell->scryfallId(), 'main')['quantity']);
    }

    public function testDecklistImportResolvesSpanishNamesFromLocalizedPrintTables(): void
    {
        $token = $this->registerAndLogin('localized-import@example.test', 'Localized Import');
        $this->jsonRequest('PATCH', '/me', ['cardLanguage' => 'es'], $token);
        self::assertResponseIsSuccessful();

        $solRing = $this->seedCard('20000000-0000-0000-0000-000000000001', 'Sol Ring', [
            'set' => 'eng',
            'collector_number' => '1',
            'lang' => 'en',
        ]);
        $darkRitual = $this->seedCard('20000000-0000-0000-0000-000000000002', 'Dark Ritual', [
            'set' => 'eng',
            'collector_number' => '2',
            'lang' => 'en',
        ]);
        $island = $this->seedCard('20000000-0000-0000-0000-000000000003', 'Island', [
            'set' => 'eng',
            'collector_number' => '3',
            'lang' => 'en',
        ]);

        $this->seedLocalizedPrintLocale($solRing->scryfallId(), 'Sol Ring', 'es', 'Anillo solar');
        $this->seedLocalizedPrintLocale($darkRitual->scryfallId(), 'Dark Ritual', 'es', 'Ritual oscuro');
        $this->seedLocalizedPrintLocale($island->scryfallId(), 'Island', 'es', 'Isla');

        $this->jsonRequest('POST', '/decks', ['name' => 'Localized Names'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'decklist' => <<<TXT
Deck
\u{FEFF}1x Anillo solar
1x Ritual oscuro
2x Isla
TXT,
        ], $token);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame([], $response['missing']);
        self::assertSame(4, $response['summary']['totalCards']);
        self::assertSame(4, $response['summary']['resolvedCards']);
        self::assertSame(4, $response['summary']['importedCards']);
        self::assertSame(0, $response['summary']['missingCards']);

        $storedDeck = $this->storedDeck($deckId);
        self::assertSame($solRing->scryfallId(), $this->storedDeckCardScryfallId($storedDeck, 'Sol Ring'));
        self::assertSame($darkRitual->scryfallId(), $this->storedDeckCardScryfallId($storedDeck, 'Dark Ritual'));
        self::assertSame($island->scryfallId(), $this->storedDeckCardScryfallId($storedDeck, 'Island'));
    }

    public function testDecklistImportSkipsPlaceholderPreferredPrintsAndFallsBackToEnglish(): void
    {
        $token = $this->registerAndLogin('placeholder-import@example.test', 'Placeholder Import');
        $this->jsonRequest('PATCH', '/me', ['cardLanguage' => 'es'], $token);
        self::assertResponseIsSuccessful();

        $arcaneSignetEnglish = $this->seedCard('30000000-0000-0000-0000-000000000001', 'Arcane Signet', [
            'set' => 'eng',
            'collector_number' => '1',
            'lang' => 'en',
            'image_status' => 'highres_scan',
        ]);
        $this->seedCard('30000000-0000-0000-0000-000000000002', 'Arcane Signet', [
            'set' => 'esp',
            'collector_number' => '2',
            'lang' => 'es',
            'printed_name' => 'Sello arcano',
            'image_status' => 'placeholder',
        ]);

        $this->jsonRequest('POST', '/decks', ['name' => 'Placeholder Import'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'decklist' => <<<TXT
Deck
1x Sello arcano
TXT,
        ], $token);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame([], $response['missing']);
        self::assertSame(1, $response['summary']['importedCards']);

        $storedDeck = $this->storedDeck($deckId);
        self::assertSame($arcaneSignetEnglish->scryfallId(), $this->storedDeckCardScryfallId($storedDeck, 'Arcane Signet'));
    }

    public function testDecklistImportRemovesBothExplicitSelectedCommandersFromMainDecklist(): void
    {
        $token = $this->registerAndLogin('dual-selected-commanders-import@example.test', 'Dual Commanders');
        $firstCommander = $this->seedCard('50000000-0000-0000-0000-000000000001', 'Birgi, God of Storytelling // Harnfel, Horn of Bounty', [
            'type_line' => 'Legendary Creature // Legendary Artifact',
            'oracle_text' => 'Boast abilities you activate cost {1} less to activate.',
            'set' => 'khm',
            'collector_number' => '123',
        ]);
        $secondCommander = $this->seedCard('50000000-0000-0000-0000-000000000002', 'Krark, the Thumbless', [
            'type_line' => 'Legendary Creature - Goblin Wizard',
            'oracle_text' => 'Whenever you cast an instant or sorcery spell, flip a coin.',
            'set' => 'cmr',
            'collector_number' => '188',
        ]);
        $island = $this->seedCard('50000000-0000-0000-0000-000000000003', 'Island', [
            'type_line' => 'Basic Land - Island',
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $this->jsonRequest('POST', '/decks', ['name' => 'Dual Cmd Import'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'commanderScryfallIds' => [$firstCommander->scryfallId(), $secondCommander->scryfallId()],
            'decklist' => <<<TXT
Deck
1 Birgi, God of Storytelling // Harnfel, Horn of Bounty
1 Krark, the Thumbless
98 Island (TST) 2
TXT,
        ], $token);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(100, $response['summary']['totalCards']);
        self::assertSame(2, $response['summary']['commanderCount']);
        self::assertSame(98, $response['summary']['mainCount']);
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $firstCommander->scryfallId(), 'commander')['quantity']);
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $secondCommander->scryfallId(), 'commander')['quantity']);
        self::assertNull($this->lineByScryfallIdOrNull($response['deck']['cards'], $firstCommander->scryfallId(), 'main'));
        self::assertNull($this->lineByScryfallIdOrNull($response['deck']['cards'], $secondCommander->scryfallId(), 'main'));
        self::assertSame(98, $this->lineByScryfallId($response['deck']['cards'], $island->scryfallId(), 'main')['quantity']);
        self::assertCount(2, $response['deck']['commanders']);
    }

    public function testDecklistImportRemovesSingleExplicitSelectedCommanderFromMainDecklist(): void
    {
        $token = $this->registerAndLogin('single-selected-commander-import@example.test', 'Single Commander');
        $commander = $this->seedCard('51000000-0000-0000-0000-000000000001', 'Derevi, Empyrial Tactician', [
            'type_line' => 'Legendary Creature - Bird Wizard',
            'oracle_text' => 'Flying',
            'set' => 'oc13',
            'collector_number' => '186',
        ]);
        $island = $this->seedCard('51000000-0000-0000-0000-000000000002', 'Island', [
            'type_line' => 'Basic Land - Island',
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $this->jsonRequest('POST', '/decks', ['name' => 'Single Cmd'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'commanderScryfallIds' => [$commander->scryfallId()],
            'decklist' => <<<TXT
Deck
1 Derevi, Empyrial Tactician
99 Island (TST) 2
TXT,
        ], $token);
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        self::assertSame(100, $response['summary']['totalCards']);
        self::assertSame(1, $response['summary']['commanderCount']);
        self::assertSame(99, $response['summary']['mainCount']);
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $commander->scryfallId(), 'commander')['quantity']);
        self::assertNull($this->lineByScryfallIdOrNull($response['deck']['cards'], $commander->scryfallId(), 'main'));
        self::assertSame(99, $this->lineByScryfallId($response['deck']['cards'], $island->scryfallId(), 'main')['quantity']);
        self::assertCount(1, $response['deck']['commanders']);
    }

    public function testDecklistImportMatchesExplicitSelectedCommanderAcrossPreferredLanguagePrints(): void
    {
        $token = $this->registerAndLogin('selected-commander-language-print@example.test', 'Commander Lang');
        $this->jsonRequest('PATCH', '/me', ['cardLanguage' => 'de'], $token);
        self::assertResponseIsSuccessful();

        $selectedCommander = $this->seedCard('60000000-0000-0000-0000-000000000001', 'Derevi, Empyrial Tactician', [
            'type_line' => 'Legendary Creature - Bird Wizard',
            'oracle_text' => 'Flying',
            'set' => 'oc13',
            'collector_number' => '186',
            'lang' => 'en',
        ]);
        $preferredLanguagePrint = $this->seedCard('60000000-0000-0000-0000-000000000002', 'Derevi, Empyrial Tactician', [
            'type_line' => 'Legendary Creature - Bird Wizard',
            'oracle_text' => 'Flying',
            'set' => 'c13',
            'collector_number' => '186',
            'lang' => 'de',
            'printed_name' => 'Derevi, Himmlische Taktikerin',
        ]);
        $island = $this->seedCard('60000000-0000-0000-0000-000000000003', 'Island', [
            'type_line' => 'Basic Land - Island',
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $this->jsonRequest('POST', '/decks', ['name' => 'Derevi Print'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'commanderScryfallIds' => [$selectedCommander->scryfallId()],
            'decklist' => <<<TXT
Deck
1 Derevi, Empyrial Tactician
99 Island (TST) 2
TXT,
        ], $token);
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        self::assertSame(1, $response['summary']['commanderCount']);
        self::assertSame(99, $response['summary']['mainCount']);
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $selectedCommander->scryfallId(), 'commander')['quantity']);
        self::assertNull($this->lineByScryfallIdOrNull($response['deck']['cards'], $selectedCommander->scryfallId(), 'main'));
        self::assertNull($this->lineByScryfallIdOrNull($response['deck']['cards'], $preferredLanguagePrint->scryfallId(), 'main'));
        self::assertSame(99, $this->lineByScryfallId($response['deck']['cards'], $island->scryfallId(), 'main')['quantity']);
    }

    public function testDecklistImportMatchesExplicitSelectedCommanderAcrossPrintedNames(): void
    {
        $token = $this->registerAndLogin('selected-commander-printed-name@example.test', 'Commander Print');
        $selectedCommander = $this->seedCard('70000000-0000-0000-0000-000000000001', 'Lucille, Barbed Bat', [
            'type_line' => 'Legendary Creature - Human Rogue',
            'oracle_text' => 'Menace',
            'set' => 'slx',
            'collector_number' => '1',
            'lang' => 'en',
            'printed_name' => 'Negan, the Cold-Blooded',
        ]);
        $island = $this->seedCard('70000000-0000-0000-0000-000000000002', 'Island', [
            'type_line' => 'Basic Land - Island',
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $this->jsonRequest('POST', '/decks', ['name' => 'Printed Cmd'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'commanderScryfallIds' => [$selectedCommander->scryfallId()],
            'decklist' => <<<TXT
Deck
1 Negan, the Cold-Blooded
99 Island (TST) 2
TXT,
        ], $token);
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        self::assertSame(1, $response['summary']['commanderCount']);
        self::assertSame(99, $response['summary']['mainCount']);
        self::assertSame(1, $this->lineByScryfallId($response['deck']['cards'], $selectedCommander->scryfallId(), 'commander')['quantity']);
        self::assertNull($this->lineByScryfallIdOrNull($response['deck']['cards'], $selectedCommander->scryfallId(), 'main'));
        self::assertSame(99, $this->lineByScryfallId($response['deck']['cards'], $island->scryfallId(), 'main')['quantity']);
    }

    public function testDecklistImportIgnoresNonCommanderLegalArtVariantsWhenResolvingCards(): void
    {
        $token = $this->registerAndLogin('import-legal-candidates-only@example.test', 'Legal Import');
        $legalBirgi = $this->seedCard('80000000-0000-0000-0000-000000000001', 'Birgi, God of Storytelling // Harnfel, Horn of Bounty', [
            'type_line' => 'Legendary Creature // Legendary Artifact',
            'oracle_text' => 'Boast abilities you activate cost {1} less to activate.',
            'set' => 'khm',
            'collector_number' => '123',
            'lang' => 'en',
            'legalities' => ['commander' => 'legal'],
        ]);
        $illegalArtVariant = $this->seedCard('80000000-0000-0000-0000-000000000002', 'Birgi, God of Storytelling // Harnfel, Horn of Bounty', [
            'type_line' => 'Card // Card',
            'oracle_text' => '',
            'set' => 'akhm',
            'collector_number' => '31',
            'lang' => 'en',
        ]);
        $this->entityManager->getConnection()->executeStatement(
            "UPDATE card SET commander_legal = false, legalities = :legalities WHERE scryfall_id = :scryfallId",
            [
                'legalities' => json_encode(['commander' => 'not_legal'], JSON_THROW_ON_ERROR),
                'scryfallId' => $illegalArtVariant->scryfallId(),
            ],
        );
        $island = $this->seedCard('80000000-0000-0000-0000-000000000003', 'Island', [
            'type_line' => 'Basic Land - Island',
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $this->jsonRequest('POST', '/decks', ['name' => 'Legal Only'], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'decklist' => <<<TXT
Deck
1 Birgi, God of Storytelling
99 Island (TST) 2
TXT,
        ], $token);
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        self::assertSame([], $response['missing']);
        self::assertSame($legalBirgi->scryfallId(), $this->lineByScryfallId($response['deck']['cards'], $legalBirgi->scryfallId(), 'main')['card']['scryfallId']);
        self::assertNull($this->lineByScryfallIdOrNull($response['deck']['cards'], $illegalArtVariant->scryfallId(), 'main'));
        self::assertSame(99, $this->lineByScryfallId($response['deck']['cards'], $island->scryfallId(), 'main')['quantity']);
    }

    private function lineByScryfallId(array $cards, string $scryfallId, string $section): array
    {
        $line = $this->lineByScryfallIdOrNull($cards, $scryfallId, $section);
        self::assertIsArray($line);

        return $line;
    }

    private function deckById(array $decks, string $deckId): array
    {
        foreach ($decks as $deck) {
            if (($deck['id'] ?? null) === $deckId) {
                return $deck;
            }
        }

        self::fail('Expected deck was not found.');
    }

    private function lineByScryfallIdOrNull(array $cards, string $scryfallId, string $section): ?array
    {
        foreach ($cards as $line) {
            if (($line['card']['scryfallId'] ?? null) === $scryfallId && ($line['section'] ?? null) === $section) {
                return $line;
            }
        }

        return null;
    }

    private function storedDeck(string $deckId): Deck
    {
        $this->entityManager->clear();
        $deck = $this->entityManager->getRepository(Deck::class)->find($deckId);
        self::assertInstanceOf(Deck::class, $deck);

        return $deck;
    }

    private function assertDeckValidity(string $deckId, bool $expected): void
    {
        $deck = $this->storedDeck($deckId);

        self::assertSame($expected, $deck->isValid());
        self::assertSame($expected, $deck->toArray()['valid']);
    }

    private function storedDeckCardId(string $deckId, string $name, string $section = DeckCard::SECTION_MAIN): string
    {
        return $this->storedDeckCard($deckId, $name, $section)->id();
    }

    private function storedDeckCard(string $deckId, string $name, string $section = DeckCard::SECTION_MAIN): DeckCard
    {
        $deck = $this->storedDeck($deckId);
        foreach ($deck->cards() as $deckCard) {
            if (!$deckCard instanceof DeckCard) {
                continue;
            }

            if ($deckCard->section() === $section && $deckCard->card()->name() === $name) {
                return $deckCard;
            }
        }

        self::fail('Expected stored deck card was not found.');
    }

    private function storedDeckCardScryfallId(Deck $deck, string $name, string $section = DeckCard::SECTION_MAIN): string
    {
        foreach ($deck->cards() as $deckCard) {
            if (!$deckCard instanceof DeckCard) {
                continue;
            }

            if ($deckCard->section() === $section && $deckCard->card()->name() === $name) {
                return $deckCard->card()->scryfallId();
            }
        }

        self::fail('Expected stored deck card was not found.');
    }

    private function seedLocalizedPrintLocale(string $scryfallId, string $defaultName, string $lang, string $printedName, array $imageUris = []): void
    {
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
    :scryfallId,
    :lang,
    :defaultName,
    :printedName,
    '{1}',
    'Artifact',
    '',
    :imageUris,
    '[]',
    'highres_scan',
    NOW()
)
ON CONFLICT (print_scryfall_id, lang) DO UPDATE SET
    name = EXCLUDED.name,
    printed_name = EXCLUDED.printed_name,
    mana_cost = EXCLUDED.mana_cost,
    type_line = EXCLUDED.type_line,
    oracle_text = EXCLUDED.oracle_text,
    image_uris = EXCLUDED.image_uris,
    card_faces = EXCLUDED.card_faces,
    image_status = EXCLUDED.image_status,
    updated_at = NOW()
SQL,
            [
                'scryfallId' => $scryfallId,
                'lang' => $lang,
                'defaultName' => $defaultName,
                'printedName' => $printedName,
                'imageUris' => json_encode($imageUris, JSON_THROW_ON_ERROR),
            ],
        );
    }
}
