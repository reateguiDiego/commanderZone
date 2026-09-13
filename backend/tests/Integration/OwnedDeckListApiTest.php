<?php

namespace App\Tests\Integration;

final class OwnedDeckListApiTest extends ApiTestCase
{
    public function testSearchOrderingAndSummaryUseTheCompleteOwnedCollection(): void
    {
        $token = $this->registerAndLogin('list-filters@example.test');
        foreach (['Alpha', 'beta', 'Alpine', '100%'] as $name) {
            $this->jsonRequest('POST', '/decks', ['name' => $name, 'visibility' => $name === 'Alpha' ? 'public' : 'private'], $token);
            self::assertResponseStatusCodeSame(201);
        }
        $this->jsonRequest('GET', '/decks?sort=name-asc&q=al&limit=1', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('Alpha', $this->jsonResponse()['data'][0]['name']);
        $cursor = urlencode($this->jsonResponse()['nextCursor']);
        $this->jsonRequest('GET', '/decks?sort=name-asc&q=al&limit=1&cursor='.$cursor, token: $token);
        self::assertSame('Alpine', $this->jsonResponse()['data'][0]['name']);
        self::assertNull($this->jsonResponse()['nextCursor']);
        foreach (['sort=name-desc&q=al', 'sort=name-asc&q=beta', 'sort=name-asc&q=al&color=W'] as $filters) {
            $this->jsonRequest('GET', '/decks?'.$filters.'&cursor='.$cursor, token: $token);
            self::assertResponseStatusCodeSame(400);
        }
        $this->jsonRequest('GET', '/decks?q=%25', token: $token);
        self::assertCount(1, $this->jsonResponse()['data']);
        $this->jsonRequest('GET', '/decks?color=C', token: $token);
        self::assertCount(4, $this->jsonResponse()['data']);
        $this->jsonRequest('GET', '/decks/summary', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame(['total' => 4, 'public' => 1, 'private' => 3, 'folders' => [['folderId' => null, 'count' => 4]], 'manaColorStats' => []], $this->jsonResponse());
        $other = $this->registerAndLogin('list-empty@example.test', 'Other');
        $this->jsonRequest('GET', '/decks/summary', token: $other);
        self::assertSame(0, $this->jsonResponse()['total']);
    }

    public function testCursorContractAndFolderOwnership(): void
    {
        $token = $this->registerAndLogin('owned-list@example.test');
        $other = $this->registerAndLogin('other-list@example.test', 'Other Player');
        $this->jsonRequest('POST', '/deck-folders', ['name' => 'Empty folder'], $token);
        self::assertResponseStatusCodeSame(201);
        $folder = $this->jsonResponse()['folder']['id'];
        $this->jsonRequest('GET', '/decks?folderId='.$folder, token: $token);
        self::assertSame(['data' => [], 'nextCursor' => null], $this->jsonResponse());
        $this->jsonRequest('GET', '/decks?folderId='.$folder, token: $other);
        self::assertResponseStatusCodeSame(404);
        for ($i = 0; $i < 3; ++$i) {
            $this->jsonRequest('POST', '/decks', ['name' => 'Deck '.$i], $token);
            self::assertResponseStatusCodeSame(201);
        }
        $this->jsonRequest('GET', '/decks?limit=2', token: $token);
        self::assertResponseIsSuccessful();
        $first = $this->jsonResponse();
        self::assertCount(2, $first['data']);
        self::assertSame([], $first['data'][0]['commanders']);
        self::assertArrayNotHasKey('cards', $first['data'][0]);
        $cursor = urlencode($first['nextCursor']);
        $this->jsonRequest('GET', '/decks?limit=2&cursor='.$cursor, token: $token);
        self::assertResponseIsSuccessful();
        self::assertCount(1, $this->jsonResponse()['data']);
        self::assertNull($this->jsonResponse()['nextCursor']);
        self::assertNotContains($this->jsonResponse()['data'][0]['id'], array_column($first['data'], 'id'));
        foreach (['limit=0', 'limit=101', 'limit=oops', 'cursor=oops', 'cursor=', 'folderId=null&cursor='.$cursor] as $query) {
            $this->jsonRequest('GET', '/decks?'.$query, token: $token);
            self::assertResponseStatusCodeSame(400);
        }
        $this->jsonRequest('GET', '/decks?cursor='.$cursor, token: $other);
        self::assertResponseStatusCodeSame(400);
        $position = json_decode(base64_decode(strtr($first['nextCursor'], '-_', '+/')), true, 512, JSON_THROW_ON_ERROR);
        foreach (['2026-02-30 12:00:00', '0000-01-01 00:00:00'] as $invalidDate) {
            $position['updated'] = $invalidDate;
            $invalidCursor = rtrim(strtr(base64_encode(json_encode($position, JSON_THROW_ON_ERROR)), '+/', '-_'), '=');
            $this->jsonRequest('GET', '/decks?cursor='.$invalidCursor, token: $token);
            self::assertResponseStatusCodeSame(400);
        }
    }
}
