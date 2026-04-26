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

    public function testAmbiguousNameResolutionReturnsConflict(): void
    {
        $this->seedCard('00000000-0000-0000-0000-000000000001', 'Opt', ['set' => 'one', 'collector_number' => '1']);
        $this->seedCard('00000000-0000-0000-0000-000000000002', 'Opt', ['set' => 'two', 'collector_number' => '2']);

        $this->jsonRequest('GET', '/cards/resolve?name=Opt');

        self::assertResponseStatusCodeSame(409);
        self::assertCount(2, $this->jsonResponse()['matches']);
    }
}
