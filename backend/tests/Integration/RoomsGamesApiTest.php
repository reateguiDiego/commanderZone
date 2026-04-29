<?php

namespace App\Tests\Integration;

use App\Tests\Support\RecordingMercureHub;

class RoomsGamesApiTest extends ApiTestCase
{
    public function testRoomOwnerCanDeleteWaitingRooms(): void
    {
        $ownerToken = $this->registerAndLogin('delete-owner@example.test', 'Delete Owner');
        $externalToken = $this->registerAndLogin('delete-external@example.test', 'Delete External');

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private'], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('DELETE', '/rooms/'.$roomId, token: $externalToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('DELETE', '/rooms/'.$roomId, token: $ownerToken);
        self::assertResponseStatusCodeSame(204);

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $ownerToken);
        self::assertResponseStatusCodeSame(404);
    }

    public function testRoomGameCommandEventsAndAccessControl(): void
    {
        $ownerToken = $this->registerAndLogin('owner@example.test', 'Owner');
        $playerToken = $this->registerAndLogin('player@example.test', 'Player');
        $externalToken = $this->registerAndLogin('external@example.test', 'External');

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public'], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/rooms', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertSame($roomId, $this->jsonResponse()['data'][0]['id']);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $gameId = (string) $this->jsonResponse()['game']['id'];

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $externalToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertArrayHasKey('snapshot', $this->jsonResponse()['game']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'chat.message',
            'payload' => ['message' => 'hello'],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame('chat.message', $this->jsonResponse()['event']['type']);

        $updates = RecordingMercureHub::updates();
        self::assertCount(1, $updates);
        self::assertSame(['games/'.$gameId], $updates[0]['topics']);

        $this->jsonRequest('GET', '/games/'.$gameId.'/events?limit=10', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertSame('chat.message', $this->jsonResponse()['data'][0]['type']);
    }
}
