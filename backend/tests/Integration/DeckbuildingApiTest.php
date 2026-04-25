<?php

namespace App\Tests\Integration;

class DeckbuildingApiTest extends ApiTestCase
{
    public function testFoldersDecksCardsImportAndOwnership(): void
    {
        $token = $this->registerAndLogin('owner@example.test', 'Owner');
        $otherToken = $this->registerAndLogin('other@example.test', 'Other');
        $solRing = $this->seedCard('00000000-0000-0000-0000-000000000001', 'Sol Ring', [
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
        self::assertCount(2, $response['deck']['cards']);
        self::assertContains($island->scryfallId(), array_map(static fn (array $card) => $card['card']['scryfallId'], $response['deck']['cards']));
    }
}
