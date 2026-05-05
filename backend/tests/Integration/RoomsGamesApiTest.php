<?php

namespace App\Tests\Integration;

use App\Tests\Support\RecordingMercureHub;

class RoomsGamesApiTest extends ApiTestCase
{
    public function testCreatingRoomClosesPreviousActiveRoomsForOwner(): void
    {
        $this->seedCard('abababab-1111-7111-8111-111111111111', 'Mountain', [
            'type_line' => 'Basic Land â€” Mountain',
            'set' => 'tst',
            'collector_number' => '30',
        ]);
        $ownerToken = $this->registerAndLogin('single-room-owner@example.test', 'Single Room Owner');
        $guestToken = $this->registerAndLogin('single-room-guest@example.test', 'Single Room Guest');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Owner Single Deck', [
            ['scryfallId' => 'abababab-1111-7111-8111-111111111111', 'quantity' => 1, 'section' => 'main'],
        ]);
        $guestDeckId = $this->quickBuildDeck($guestToken, 'Guest Single Deck', [
            ['scryfallId' => 'abababab-1111-7111-8111-111111111111', 'quantity' => 1, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $firstRoomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$firstRoomId.'/join', ['deckId' => $guestDeckId], $guestToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms/'.$firstRoomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $secondRoomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/rooms?status=all', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $roomsById = [];
        foreach ($this->jsonResponse()['data'] as $room) {
            $roomsById[(string) $room['id']] = $room;
        }

        self::assertArrayHasKey($secondRoomId, $roomsById);
        self::assertSame('waiting', $roomsById[$secondRoomId]['status']);
        self::assertArrayHasKey($firstRoomId, $roomsById);
        self::assertSame('archived', $roomsById[$firstRoomId]['status']);
    }

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

    public function testPrivateRoomVisibilityForOutsiderInvitedAndParticipant(): void
    {
        $this->seedCard('cccccccc-1111-7111-8111-111111111111', 'Swamp', [
            'type_line' => 'Basic Land â€” Swamp',
            'set' => 'tst',
            'collector_number' => '40',
        ]);
        $ownerToken = $this->registerAndLogin('privacy-owner@example.test', 'Privacy Owner');
        $invitedToken = $this->registerAndLogin('privacy-invited@example.test', 'Privacy Invited');
        $participantToken = $this->registerAndLogin('privacy-participant@example.test', 'Privacy Participant');
        $outsiderToken = $this->registerAndLogin('privacy-outsider@example.test', 'Privacy Outsider');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Privacy Owner Deck', [
            ['scryfallId' => 'cccccccc-1111-7111-8111-111111111111', 'quantity' => 1, 'section' => 'main'],
        ]);
        $participantDeckId = $this->quickBuildDeck($participantToken, 'Privacy Participant Deck', [
            ['scryfallId' => 'cccccccc-1111-7111-8111-111111111111', 'quantity' => 1, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'privacy-invited@example.test'], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $invitedFriendshipId = (string) $this->jsonResponse()['friendship']['id'];
        $this->jsonRequest('POST', '/friends/requests/'.$invitedFriendshipId.'/accept', token: $invitedToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'privacy-participant@example.test'], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $participantFriendshipId = (string) $this->jsonResponse()['friendship']['id'];
        $this->jsonRequest('POST', '/friends/requests/'.$participantFriendshipId.'/accept', token: $participantToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/friends', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $friendIdsByName = [];
        foreach ($this->jsonResponse()['data'] as $friendship) {
            $friend = $friendship['friend'] ?? null;
            if (!is_array($friend)) {
                continue;
            }
            $friendIdsByName[(string) ($friend['displayName'] ?? '')] = (string) ($friend['id'] ?? '');
        }
        self::assertArrayHasKey('Privacy Invited', $friendIdsByName);
        self::assertArrayHasKey('Privacy Participant', $friendIdsByName);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/invites', ['userId' => $friendIdsByName['Privacy Invited']], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $invitedInviteId = (string) $this->jsonResponse()['invite']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/invites', ['userId' => $friendIdsByName['Privacy Participant']], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $participantInviteId = (string) $this->jsonResponse()['invite']['id'];

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $outsiderToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $participantDeckId], $outsiderToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $invitedToken);
        self::assertResponseIsSuccessful();
        self::assertSame($roomId, $this->jsonResponse()['room']['id']);

        $this->jsonRequest('GET', '/rooms/invites/incoming', token: $participantToken);
        self::assertResponseIsSuccessful();
        self::assertContains($participantInviteId, array_column($this->jsonResponse()['data'], 'id'));
        self::assertNotContains($invitedInviteId, array_column($this->jsonResponse()['data'], 'id'));

        $this->jsonRequest('POST', '/rooms/invites/'.$participantInviteId.'/accept', ['deckId' => $participantDeckId], $participantToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $participantToken);
        self::assertResponseIsSuccessful();
        self::assertSame($roomId, $this->jsonResponse()['room']['id']);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/archive', token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertSame('archived', $this->jsonResponse()['room']['status']);
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

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'chat.message',
            'payload' => ['message' => 'external attempt'],
        ], $externalToken);
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
            'type' => 'unknown.command',
            'payload' => [],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('Unknown game command: unknown.command', (string) $this->jsonResponse()['error']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'life.changed',
            'payload' => ['playerId' => $ownerPlayerId],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'turn.changed',
            'payload' => [],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'arrow.created',
            'payload' => ['fromInstanceId' => 'from-only'],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'stack.item_removed',
            'payload' => [],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'zone.changed',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'zone' => 'graveyard',
                'cards' => [[
                    'instanceId' => 'injected-card',
                    'name' => 'Injected Card',
                ]],
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);

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

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.draw',
            'payload' => ['playerId' => $ownerPlayerId],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(409);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'chat.message',
            'payload' => ['message' => 'post-finish chat'],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);

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
