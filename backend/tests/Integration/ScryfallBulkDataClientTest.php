<?php

namespace App\Tests\Integration;

use App\Infrastructure\Scryfall\ScryfallBulkDataClient;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

class ScryfallBulkDataClientTest extends TestCase
{
    public function testItLoadsScryfallJsonLinesGzipBulkData(): void
    {
        $firstCard = ['id' => '90000000-0000-0000-0000-000000000001', 'prices' => ['eur' => '1.00']];
        $secondCard = ['id' => '90000000-0000-0000-0000-000000000002', 'prices' => ['eur' => '2.00']];
        $compressedCards = gzencode(implode("\n", [
            json_encode($firstCard, JSON_THROW_ON_ERROR),
            json_encode($secondCard, JSON_THROW_ON_ERROR),
        ])."\n");
        self::assertIsString($compressedCards);

        $httpClient = new MockHttpClient([
            new MockResponse(json_encode(['data' => [[
                'type' => 'all_cards',
                'jsonl_download_uri' => 'https://data.scryfall.test/all-cards.jsonl.gz',
            ]]], JSON_THROW_ON_ERROR)),
            new MockResponse($compressedCards),
        ]);
        $client = new ScryfallBulkDataClient($httpClient, 'test-agent');

        self::assertSame([$firstCard, $secondCard], iterator_to_array($client->loadBulkItems('all_cards'), false));
    }
}
