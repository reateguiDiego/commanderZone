<?php

namespace App\Tests\Integration;

use App\Tests\Support\RecordingMercureHub;

class RoomsGamesApiTest extends ApiTestCase
{
    public function testCreatingRoomRemovesPreviousRoomsForOwner(): void
    {
        $this->seedCard('abababab-0000-7000-8000-000000000001', 'Commander Alpha', [
            'type_line' => 'Legendary Creature - Human Soldier',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('abababab-1111-7111-8111-111111111111', 'Mountain', [
            'type_line' => 'Basic Land â€” Mountain',
            'set' => 'tst',
            'collector_number' => '30',
        ]);
        $ownerToken = $this->registerAndLogin('single-room-owner@example.test', 'Single Room Owner');
        $guestToken = $this->registerAndLogin('single-room-guest@example.test', 'Single Room Guest');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Owner Single Deck', [
            ['scryfallId' => 'abababab-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'abababab-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $guestDeckId = $this->quickBuildDeck($guestToken, 'Guest Single Deck', [
            ['scryfallId' => 'abababab-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'abababab-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
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
        self::assertArrayNotHasKey($firstRoomId, $roomsById);
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
        $this->seedCard('cccccccc-0000-7000-8000-000000000001', 'Commander Privacy', [
            'type_line' => 'Legendary Creature - Human Wizard',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
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
            ['scryfallId' => 'cccccccc-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'cccccccc-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $participantDeckId = $this->quickBuildDeck($participantToken, 'Privacy Participant Deck', [
            ['scryfallId' => 'cccccccc-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'cccccccc-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
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

    public function testRoomStartFailsWhenAnyDeckIsNotCommanderValid(): void
    {
        $this->seedCard('dddddddd-0000-7000-8000-000000000001', 'Commander Start Gate', [
            'type_line' => 'Legendary Creature - Human Knight',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('dddddddd-1111-7111-8111-111111111111', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('start-gate-owner@example.test', 'Start Gate Owner');
        $playerToken = $this->registerAndLogin('start-gate-player@example.test', 'Start Gate Player');

        $invalidOwnerDeckId = $this->quickBuildDeck($ownerToken, 'Invalid Owner Deck', [
            ['scryfallId' => 'dddddddd-1111-7111-8111-111111111111', 'quantity' => 1, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Valid Player Deck', [
            ['scryfallId' => 'dddddddd-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'dddddddd-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'deckId' => $invalidOwnerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('Commander-valid deck', (string) $this->jsonResponse()['error']);
        self::assertArrayHasKey('invalidDecks', $this->jsonResponse());
        self::assertCount(1, $this->jsonResponse()['invalidDecks']);
        self::assertSame($invalidOwnerDeckId, $this->jsonResponse()['invalidDecks'][0]['deckId']);
        self::assertSame('Start Gate Owner', $this->jsonResponse()['invalidDecks'][0]['displayName']);
        self::assertFalse($this->jsonResponse()['invalidDecks'][0]['validation']['valid']);
        self::assertContains('deck.size.invalid', array_column($this->jsonResponse()['invalidDecks'][0]['validation']['errors'], 'code'));

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertSame('waiting', $this->jsonResponse()['room']['status']);
        self::assertNull($this->jsonResponse()['room']['gameId']);
    }

    public function testJoinPublicRoomRejectsCommanderInvalidDeck(): void
    {
        $this->seedCard('eeeeeeee-0000-7000-8000-000000000001', 'Commander Join Gate', [
            'type_line' => 'Legendary Creature - Human Knight',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('eeeeeeee-1111-7111-8111-111111111111', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('join-gate-owner@example.test', 'Join Gate Owner');
        $playerToken = $this->registerAndLogin('join-gate-player@example.test', 'Join Gate Player');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Join Gate Owner Deck', [
            ['scryfallId' => 'eeeeeeee-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'eeeeeeee-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $invalidPlayerDeckId = $this->quickBuildDeck($playerToken, 'Join Gate Invalid Deck', [
            ['scryfallId' => 'eeeeeeee-1111-7111-8111-111111111111', 'quantity' => 1, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $invalidPlayerDeckId], $playerToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('Commander-valid deck', (string) $this->jsonResponse()['error']);
        self::assertArrayHasKey('validation', $this->jsonResponse());
        self::assertFalse($this->jsonResponse()['validation']['valid']);
    }

    public function testPrivateInviteAcceptRejectsCommanderInvalidDeck(): void
    {
        $this->seedCard('fefefefe-0000-7000-8000-000000000001', 'Commander Invite Gate', [
            'type_line' => 'Legendary Creature - Human Knight',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('fefefefe-1111-7111-8111-111111111111', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('invite-gate-owner@example.test', 'Invite Gate Owner');
        $invitedToken = $this->registerAndLogin('invite-gate-invited@example.test', 'Invite Gate Invited');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Invite Gate Owner Deck', [
            ['scryfallId' => 'fefefefe-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'fefefefe-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $invalidInvitedDeckId = $this->quickBuildDeck($invitedToken, 'Invite Gate Invalid Deck', [
            ['scryfallId' => 'fefefefe-1111-7111-8111-111111111111', 'quantity' => 1, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'invite-gate-invited@example.test'], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $friendshipId = (string) $this->jsonResponse()['friendship']['id'];
        $this->jsonRequest('POST', '/friends/requests/'.$friendshipId.'/accept', token: $invitedToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/friends', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $invitedUserId = (string) $this->jsonResponse()['data'][0]['friend']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/invites', ['userId' => $invitedUserId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $inviteId = (string) $this->jsonResponse()['invite']['id'];

        $this->jsonRequest('POST', '/rooms/invites/'.$inviteId.'/accept', ['deckId' => $invalidInvitedDeckId], $invitedToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('Commander-valid deck', (string) $this->jsonResponse()['error']);
        self::assertArrayHasKey('validation', $this->jsonResponse());
        self::assertFalse($this->jsonResponse()['validation']['valid']);

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertCount(1, $this->jsonResponse()['room']['players']);
    }

    public function testRoomInvitePublishesMercureUpdatesForRecipientAndOwner(): void
    {
        $this->seedCard('abababab-2222-7222-8222-222222222222', 'Commander Invite Realtime', [
            'type_line' => 'Legendary Creature - Human Scout',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('abababab-3333-7333-8333-333333333333', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('invite-realtime-owner@example.test', 'Invite Realtime Owner');
        $recipientToken = $this->registerAndLogin('invite-realtime-recipient@example.test', 'Invite Realtime Recipient');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Invite Realtime Owner Deck', [
            ['scryfallId' => 'abababab-2222-7222-8222-222222222222', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'abababab-3333-7333-8333-333333333333', 'quantity' => 99, 'section' => 'main'],
        ]);
        $recipientDeckId = $this->quickBuildDeck($recipientToken, 'Invite Realtime Recipient Deck', [
            ['scryfallId' => 'abababab-2222-7222-8222-222222222222', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'abababab-3333-7333-8333-333333333333', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'invite-realtime-recipient@example.test'], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $friendshipId = (string) $this->jsonResponse()['friendship']['id'];
        $this->jsonRequest('POST', '/friends/requests/'.$friendshipId.'/accept', token: $recipientToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/me', token: $recipientToken);
        self::assertResponseIsSuccessful();
        $recipientId = (string) $this->jsonResponse()['user']['id'];
        $this->jsonRequest('GET', '/me', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $ownerId = (string) $this->jsonResponse()['user']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/invites', ['userId' => $recipientId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $inviteId = (string) $this->jsonResponse()['invite']['id'];

        $updates = RecordingMercureHub::updates();
        self::assertNotEmpty($updates);
        self::assertContains('rooms/invites/users/'.$recipientId, $updates[array_key_last($updates)]['topics']);

        $this->jsonRequest('POST', '/rooms/invites/'.$inviteId.'/accept', ['deckId' => $recipientDeckId], $recipientToken);
        self::assertResponseIsSuccessful();

        $updates = RecordingMercureHub::updates();
        $topics = array_merge(...array_map(
            static fn (array $update): array => $update['topics'],
            $updates,
        ));
        self::assertContains('rooms/invites/users/'.$recipientId, $topics);
        self::assertContains('rooms/invites/users/'.$ownerId, $topics);
    }

    public function testPrivateRoomInviteRequiresAcceptedFriendship(): void
    {
        $this->seedCard('ababcdab-0000-7000-8000-000000000001', 'Commander Invite Permission', [
            'type_line' => 'Legendary Creature - Human Scout',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('ababcdab-1111-7111-8111-111111111111', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('invite-permission-owner@example.test', 'Invite Permission Owner');
        $strangerToken = $this->registerAndLogin('invite-permission-stranger@example.test', 'Invite Permission Stranger');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Invite Permission Owner Deck', [
            ['scryfallId' => 'ababcdab-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'ababcdab-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('GET', '/me', token: $strangerToken);
        self::assertResponseIsSuccessful();
        $strangerUserId = (string) $this->jsonResponse()['user']['id'];

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/invites', ['userId' => $strangerUserId], $ownerToken);
        self::assertResponseStatusCodeSame(403);
        self::assertStringContainsString('accepted friends', (string) $this->jsonResponse()['error']);
    }

    public function testCardsMovedAndZoneChangedAllowReorderButRejectInjection(): void
    {
        $this->seedCard('cabacaba-0000-7000-8000-000000000001', 'Commander Move Test', [
            'type_line' => 'Legendary Creature - Human Wizard',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('cabacaba-1111-7111-8111-111111111111', 'Island', [
            'type_line' => 'Basic Land - Island',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('cards-moved-owner@example.test', 'Cards Move Owner');
        $playerToken = $this->registerAndLogin('cards-moved-player@example.test', 'Cards Move Player');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Cards Move Owner Deck', [
            ['scryfallId' => 'cabacaba-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'cabacaba-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Cards Move Player Deck', [
            ['scryfallId' => 'cabacaba-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'cabacaba-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $gameId = (string) $this->jsonResponse()['game']['id'];

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $snapshot = $this->jsonResponse()['game']['snapshot'];
        $ownerPlayerId = $this->playerIdByName($snapshot, 'Cards Move Owner');
        $hand = $snapshot['players'][$ownerPlayerId]['zones']['hand'];
        self::assertGreaterThanOrEqual(2, count($hand));
        $firstId = (string) $hand[0]['instanceId'];
        $secondId = (string) $hand[1]['instanceId'];

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'cards.moved',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'fromZone' => 'hand',
                'toZone' => 'battlefield',
                'instanceIds' => [$firstId, $secondId],
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $afterMove = $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones']['battlefield'];
        self::assertCount(2, $afterMove);

        $reordered = [$afterMove[1], $afterMove[0]];
        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'zone.changed',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'zone' => 'battlefield',
                'cards' => $reordered,
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $afterReorder = $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones']['battlefield'];
        self::assertSame((string) $reordered[0]['instanceId'], (string) $afterReorder[0]['instanceId']);
        self::assertSame((string) $reordered[1]['instanceId'], (string) $afterReorder[1]['instanceId']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'zone.changed',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'zone' => 'battlefield',
                'cards' => [[
                    'instanceId' => 'injected-instance',
                    'name' => 'Injected',
                ]],
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('reorder existing cards', (string) $this->jsonResponse()['error']);
    }

    public function testLibraryCommandsPreserveTotalsAndRevealVisibility(): void
    {
        $this->seedCard('decafbad-0000-7000-8000-000000000001', 'Commander Library Test', [
            'type_line' => 'Legendary Creature - Human Wizard',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('decafbad-1111-7111-8111-111111111111', 'Island', [
            'type_line' => 'Basic Land - Island',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('library-owner@example.test', 'Library Owner');
        $playerToken = $this->registerAndLogin('library-player@example.test', 'Library Player');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Library Owner Deck', [
            ['scryfallId' => 'decafbad-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'decafbad-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Library Player Deck', [
            ['scryfallId' => 'decafbad-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'decafbad-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $gameId = (string) $this->jsonResponse()['game']['id'];

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $snapshot = $this->jsonResponse()['game']['snapshot'];
        $ownerPlayerId = $this->playerIdByName($snapshot, 'Library Owner');

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.draw_many',
            'payload' => ['playerId' => $ownerPlayerId, 'count' => 3],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $afterDrawMany = $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones'];
        self::assertCount(89, $afterDrawMany['library']);
        self::assertCount(10, $afterDrawMany['hand']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.move_top',
            'payload' => ['playerId' => $ownerPlayerId, 'toZone' => 'graveyard', 'count' => 2],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $afterMoveTop = $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones'];
        self::assertCount(87, $afterMoveTop['library']);
        self::assertCount(2, $afterMoveTop['graveyard']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.shuffle',
            'payload' => ['playerId' => $ownerPlayerId],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $afterShuffle = $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones'];
        self::assertCount(87, $afterShuffle['library']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.reveal_top',
            'payload' => ['playerId' => $ownerPlayerId, 'count' => 1, 'to' => 'all'],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $playerToken);
        self::assertResponseIsSuccessful();
        $playerProjection = $this->jsonResponse()['game']['snapshot']['players'][$ownerPlayerId];
        self::assertCount(1, $playerProjection['zones']['library']);
        self::assertSame(87, $playerProjection['zoneCounts']['library']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.play_top_revealed',
            'payload' => ['playerId' => $ownerPlayerId],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $afterPlayTop = $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones'];
        self::assertCount(86, $afterPlayTop['library']);
        self::assertCount(1, $afterPlayTop['battlefield']);
    }

    public function testLifeCommanderDamageAndCountersCommandsUpdateSnapshot(): void
    {
        $this->seedCard('feedfeed-0000-7000-8000-000000000001', 'Commander Counters Test', [
            'type_line' => 'Legendary Creature - Human Wizard',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('feedfeed-1111-7111-8111-111111111111', 'Island', [
            'type_line' => 'Basic Land - Island',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('counters-owner@example.test', 'Counters Owner');
        $playerToken = $this->registerAndLogin('counters-player@example.test', 'Counters Player');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Counters Owner Deck', [
            ['scryfallId' => 'feedfeed-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'feedfeed-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Counters Player Deck', [
            ['scryfallId' => 'feedfeed-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'feedfeed-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $gameId = (string) $this->jsonResponse()['game']['id'];

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $snapshot = $this->jsonResponse()['game']['snapshot'];
        $ownerPlayerId = $this->playerIdByName($snapshot, 'Counters Owner');
        $playerPlayerId = $this->playerIdByName($snapshot, 'Counters Player');
        $commanderInstanceId = (string) $snapshot['players'][$ownerPlayerId]['zones']['command'][0]['instanceId'];

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'life.changed',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'delta' => -1,
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(39, $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['life']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'commander.damage.changed',
            'payload' => [
                'targetPlayerId' => $ownerPlayerId,
                'sourcePlayerId' => $playerPlayerId,
                'damage' => 5,
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(5, $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['commanderDamage'][$playerPlayerId]);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'counter.changed',
            'payload' => [
                'scope' => 'global',
                'key' => 'storm',
                'value' => 2,
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(2, $this->jsonResponse()['snapshot']['counters']['global']['storm']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'card.counter.changed',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'zone' => 'command',
                'instanceId' => $commanderInstanceId,
                'key' => '+1/+1',
                'value' => 3,
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $commandZone = $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones']['command'];
        self::assertSame(3, $commandZone[0]['counters']['+1/+1']);
    }

    public function testInitialSnapshotUsesCommanderZoneOpeningHandAndUniqueInstanceIds(): void
    {
        $this->seedCard('abab1234-0000-7000-8000-000000000001', 'Snapshot Commander', [
            'type_line' => 'Legendary Creature - Human Wizard',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('abab1234-1111-7111-8111-111111111111', 'Island', [
            'type_line' => 'Basic Land - Island',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('snapshot-owner@example.test', 'Snapshot Owner');
        $playerToken = $this->registerAndLogin('snapshot-player@example.test', 'Snapshot Player');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Snapshot Owner Deck', [
            ['scryfallId' => 'abab1234-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'abab1234-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Snapshot Player Deck', [
            ['scryfallId' => 'abab1234-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'abab1234-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $gameId = (string) $this->jsonResponse()['game']['id'];

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $snapshot = $this->jsonResponse()['game']['snapshot'];

        $ownerPlayerId = (string) $snapshot['ownerId'];
        foreach ($snapshot['players'] as $playerId => $playerState) {
            self::assertSame(40, $playerState['life']);
            self::assertCount(1, $playerState['zones']['command']);
            self::assertSame('command', $playerState['zones']['command'][0]['zone']);
            self::assertSame((string) $playerId, $playerState['zones']['command'][0]['ownerId']);
            self::assertSame(7, $playerState['zoneCounts']['hand']);
            self::assertSame(92, $playerState['zoneCounts']['library']);
            if ((string) $playerId === $ownerPlayerId) {
                self::assertCount(7, $playerState['zones']['hand']);
                self::assertCount(92, $playerState['zones']['library']);
            } else {
                self::assertCount(0, $playerState['zones']['hand']);
            }

            $instanceIds = [];
            $visibleZoneTotal = 0;
            foreach ($playerState['zones'] as $zoneName => $cards) {
                $visibleZoneTotal += count($cards);
                foreach ($cards as $card) {
                    self::assertSame($zoneName, $card['zone']);
                    $instanceIds[] = (string) $card['instanceId'];
                }
            }

            self::assertSame(100, array_sum($playerState['zoneCounts']));
            self::assertSame(count($instanceIds), count(array_unique($instanceIds)));
            if ((string) $playerId === $ownerPlayerId) {
                self::assertSame(100, $visibleZoneTotal);
                self::assertCount(100, $instanceIds);
            }
        }
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
        $this->seedCard('44444444-4444-7444-8444-444444444444', 'Commander Root', [
            'type_line' => 'Legendary Creature - Elf Druid',
            'color_identity' => ['G'],
            'oracle_text' => 'Vigilance',
            'set' => 'tst',
            'collector_number' => '4',
        ]);

        $ownerToken = $this->registerAndLogin('owner@example.test', 'Owner');
        $playerToken = $this->registerAndLogin('player@example.test', 'Player');
        $externalToken = $this->registerAndLogin('external@example.test', 'External');

        $this->jsonRequest('GET', '/me', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertSame('Player', $this->jsonResponse()['user']['displayName']);

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Owner Deck', [
            ['scryfallId' => '44444444-4444-7444-8444-444444444444', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => '11111111-1111-7111-8111-111111111111', 'quantity' => 98, 'section' => 'main'],
            ['scryfallId' => '22222222-2222-7222-8222-222222222222', 'quantity' => 1, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Player Deck', [
            ['scryfallId' => '44444444-4444-7444-8444-444444444444', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => '11111111-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
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
        self::assertCount(92, $ownerSnapshot['players'][$ownerPlayerId]['zones']['library']);
        self::assertSame(['G'], $ownerSnapshot['players'][$ownerPlayerId]['colorIdentity']);
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
        self::assertCount(8, $ownerSnapshot['players'][$ownerPlayerId]['zones']['hand']);
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
        self::assertSame(7, $playerProjection['players'][$ownerPlayerId]['zoneCounts']['hand']);

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
