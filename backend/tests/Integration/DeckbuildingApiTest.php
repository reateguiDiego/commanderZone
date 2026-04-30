<?php

namespace App\Tests\Integration;

class DeckbuildingApiTest extends ApiTestCase
{
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
            'set' => 'tst',
            'collector_number' => '3',
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

        $this->jsonRequest('POST', '/deck-folders', ['name' => 'Commander', 'visibility' => 'public'], $token);
        self::assertResponseStatusCodeSame(201);
        $folder = $this->jsonResponse()['folder'];
        $folderId = (string) $folder['id'];
        self::assertSame('public', $folder['visibility']);

        $this->jsonRequest('GET', '/deck-folders/names', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('Commander', $this->jsonResponse()['data'][0]['name']);

        $this->jsonRequest('GET', '/deck-formats', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('commander', $this->jsonResponse()['data'][0]['id']);

        $this->jsonRequest('POST', '/decks', ['name' => 'Test Deck', 'folderId' => $folderId, 'visibility' => 'public'], $token);
        self::assertResponseStatusCodeSame(201);
        $createdDeck = $this->jsonResponse()['deck'];
        $deckId = (string) $createdDeck['id'];
        self::assertSame('public', $createdDeck['visibility']);

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
        self::assertNotEmpty($validation['errors']);
        self::assertContains('Missing commander', array_column($validation['issues'], 'title'));

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

        $this->jsonRequest('GET', '/decks/'.$deckId.'/sections', token: $token);
        self::assertResponseIsSuccessful();
        $sections = $this->jsonResponse();
        self::assertSame(3, $sections['counts']['playableTotal']);
        self::assertSame(2, $sections['counts']['maybeboard']);
        self::assertSame(1, $sections['counts']['tokens']);
        self::assertSame('Plant Token', $sections['sections']['tokens'][0]['token']['name']);

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
}
