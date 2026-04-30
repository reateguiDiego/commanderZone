<?php

namespace App\Tests\Integration;

use App\Tests\Support\RecordingMercureHub;

class RoomsGamesApiTest extends ApiTestCase
{
    public function testRoomOwnerCanDeleteWaitingRooms(): void
    {
        $this->seedCard('aaaaaaaa-1111-7111-8111-111111111111', 'Island', [
            'type_line' => 'Basic Land — Island',
            'set' => 'tst',
            'collector_number' => '10',
        ]);
        $ownerToken = $this->registerAndLogin('delete-owner@example.test', 'Delete Owner');
        $externalToken = $this->registerAndLogin('delete-external@example.test', 'Delete External');
        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Delete Deck', [
            ['scryfallId' => 'aaaaaaaa-1111-7111-8111-111111111111', 'quantity' => 1, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'deckId' => $ownerDeckId], $ownerToken);
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
        $this->seedCard('11111111-1111-7111-8111-111111111111', 'Forest', [
            'type_line' => 'Basic Land — Forest',
            'color_identity' => ['G'],
            'oracle_text' => '({T}: Add {G}.)',
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('22222222-2222-7222-8222-222222222222', 'Sol Ring', [
            'type_line' => 'Artifact',
            'oracle_text' => '{T}: Add {C}{C}.',
            'set' => 'tst',
            'collector_number' => '2',
        ]);
        $this->seedCard('33333333-3333-7333-8333-333333333333', 'Command Tower', [
            'type_line' => 'Land',
            'oracle_text' => '{T}: Add one mana of any color in your commander color identity.',
            'set' => 'tst',
            'collector_number' => '3',
        ]);

        $ownerToken = $this->registerAndLogin('owner@example.test', 'Owner');
        $playerToken = $this->registerAndLogin('player@example.test', 'Player');
        $externalToken = $this->registerAndLogin('external@example.test', 'External');

        $this->jsonRequest('GET', '/me', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertSame('Player', $this->jsonResponse()['user']['displayName']);

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Owner Deck', [
            ['scryfallId' => '11111111-1111-7111-8111-111111111111', 'quantity' => 1, 'section' => 'main'],
            ['scryfallId' => '22222222-2222-7222-8222-222222222222', 'quantity' => 1, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Player Deck', [
            ['scryfallId' => '33333333-3333-7333-8333-333333333333', 'quantity' => 1, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/rooms', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertSame($roomId, $this->jsonResponse()['data'][0]['id']);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $gameId = (string) $this->jsonResponse()['game']['id'];

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $externalToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $ownerSnapshot = $this->jsonResponse()['game']['snapshot'];
        self::assertArrayHasKey('snapshot', $this->jsonResponse()['game']);
        self::assertArrayHasKey('version', $ownerSnapshot);
        $ownerPlayerId = $this->playerIdByName($ownerSnapshot, 'Owner');
        $playerPlayerId = $this->playerIdByName($ownerSnapshot, 'Player');
        self::assertSame($ownerPlayerId, $ownerSnapshot['ownerId']);
        self::assertCount(2, $ownerSnapshot['players'][$ownerPlayerId]['zones']['library']);
        self::assertSame([], $ownerSnapshot['players'][$ownerPlayerId]['colorIdentity']);
        self::assertContains(['G'], array_column($ownerSnapshot['players'][$ownerPlayerId]['zones']['library'], 'colorIdentity'));

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'chat.message',
            'payload' => ['message' => 'hello'],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame('chat.message', $this->jsonResponse()['event']['type']);

        $updates = RecordingMercureHub::updates();
        self::assertCount(1, $updates);
        self::assertSame(['games/'.$gameId], $updates[0]['topics']);
        $mercurePayload = json_decode($updates[0]['data'], true, flags: JSON_THROW_ON_ERROR);
        self::assertArrayHasKey('version', $mercurePayload);
        self::assertArrayNotHasKey('snapshot', $mercurePayload);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.draw',
            'payload' => ['playerId' => $ownerPlayerId],
            'clientActionId' => 'draw-1',
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertTrue($this->jsonResponse()['applied']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.draw',
            'payload' => ['playerId' => $ownerPlayerId],
            'clientActionId' => 'player-draws-owner-library',
        ], $playerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.draw',
            'payload' => ['playerId' => $ownerPlayerId],
            'clientActionId' => 'draw-1',
        ], $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertFalse($this->jsonResponse()['applied']);

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $ownerSnapshot = $this->jsonResponse()['game']['snapshot'];
        self::assertCount(1, $ownerSnapshot['players'][$ownerPlayerId]['zones']['hand']);
        $drawnCardId = (string) $ownerSnapshot['players'][$ownerPlayerId]['zones']['hand'][0]['instanceId'];

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'card.moved',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'fromZone' => 'hand',
                'toZone' => 'battlefield',
                'instanceId' => $drawnCardId,
                'position' => ['x' => 320, 'y' => 180],
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(['x' => 320, 'y' => 180], $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones']['battlefield'][0]['position']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'card.position.changed',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'zone' => 'battlefield',
                'instanceId' => $drawnCardId,
                'position' => ['x' => 420, 'y' => 220],
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(['x' => 420, 'y' => 220], $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones']['battlefield'][0]['position']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'card.moved',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'fromZone' => 'battlefield',
                'toZone' => 'graveyard',
                'instanceId' => $drawnCardId,
            ],
        ], $playerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $playerToken);
        self::assertResponseIsSuccessful();
        $playerProjection = $this->jsonResponse()['game']['snapshot'];
        self::assertCount(0, $playerProjection['players'][$ownerPlayerId]['zones']['hand']);
        self::assertSame(0, $playerProjection['players'][$ownerPlayerId]['zoneCounts']['hand']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.reveal_top',
            'payload' => ['playerId' => $ownerPlayerId, 'count' => 1, 'to' => 'all'],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('GET', '/games/'.$gameId.'/zones/'.$ownerPlayerId.'/library', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertSame(1, $this->jsonResponse()['total']);
        self::assertCount(1, $this->jsonResponse()['data']);

        $this->jsonRequest('GET', '/games/'.$gameId.'/events?limit=10', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertContains('chat.message', array_column($this->jsonResponse()['data'], 'type'));

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'game.concede',
            'payload' => [],
        ], $playerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame('conceded', $this->jsonResponse()['snapshot']['players'][$playerPlayerId]['status']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'game.concede',
            'payload' => [],
        ], $playerToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.draw',
            'payload' => ['playerId' => $playerPlayerId],
        ], $playerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'card.tapped',
            'payload' => [
                'playerId' => $playerPlayerId,
                'zone' => 'battlefield',
                'instanceId' => 'missing-card',
                'tapped' => true,
            ],
        ], $playerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/archive', token: $playerToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/archive', token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertSame('archived', $this->jsonResponse()['room']['status']);

        $this->jsonRequest('GET', '/rooms', token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertNotContains($roomId, array_column($this->jsonResponse()['data'], 'id'));

        $this->jsonRequest('GET', '/rooms?status=archived', token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertContains($roomId, array_column($this->jsonResponse()['data'], 'id'));
    }

    /**
     * @param list<array<string,mixed>> $cards
     */
    private function quickBuildDeck(string $token, string $name, array $cards): string
    {
        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => $name,
            'cards' => $cards,
        ], $token);
        self::assertResponseStatusCodeSame(201);

        return (string) $this->jsonResponse()['deck']['id'];
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    private function playerIdByName(array $snapshot, string $displayName): string
    {
        foreach ($snapshot['players'] as $playerId => $player) {
            if (($player['user']['displayName'] ?? null) === $displayName) {
                return (string) $playerId;
            }
        }

        self::fail(sprintf('Player "%s" not found in snapshot.', $displayName));
    }
}
