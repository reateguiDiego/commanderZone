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

        $this->jsonRequest('POST', '/deck-folders', ['name' => 'Commander'], $token);
        self::assertResponseStatusCodeSame(201);
        $folderId = (string) $this->jsonResponse()['folder']['id'];

        $this->jsonRequest('GET', '/deck-folders/names', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('Commander', $this->jsonResponse()['data'][0]['name']);

        $this->jsonRequest('GET', '/deck-formats', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('commander', $this->jsonResponse()['data'][0]['id']);

        $this->jsonRequest('POST', '/decks', ['name' => 'Test Deck', 'folderId' => $folderId], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('GET', '/decks?folderId='.$folderId, token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame($deckId, $this->jsonResponse()['data'][0]['id']);

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
1 Sol Ring (TST) 1
2 Island
TXT,
        ], $token);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
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
        self::assertSame(3, $analysis['totalCards']);
        self::assertSame(2, $analysis['landCount']);
        self::assertSame(1, $analysis['nonlandCount']);
        self::assertSame(1, $analysis['artifacts']['count']);
        self::assertSame(['Sol Ring'], $analysis['ramp']['cards']);

        $this->jsonRequest('POST', '/decks/'.$deckId.'/validate-commander', token: $token);
        self::assertResponseIsSuccessful();
        $validation = $this->jsonResponse();
        self::assertFalse($validation['valid']);
        self::assertNotEmpty($validation['errors']);
        self::assertContains('Missing commander', array_column($validation['issues'], 'title'));

        $this->jsonRequest('GET', '/decks/'.$deckId.'/analysis', token: $otherToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/export', token: $otherToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('POST', '/decks/'.$deckId.'/import', [
            'decklist' => '1 Sol Ring',
        ], $otherToken);
        self::assertResponseStatusCodeSame(404);
    }
}
