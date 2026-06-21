<?php

namespace App\Tests\Integration;

use App\Tests\Support\RecordingMercureHub;

class FriendsApiTest extends ApiTestCase
{
    public function testFriendRequestsCanBeAcceptedAndListedWithPresence(): void
    {
        $aliceToken = $this->registerAndLogin('alice@example.test', 'Alice');
        $bobToken = $this->registerAndLogin('bob@example.test', 'Bobby');
        $bobId = $this->currentUserId($bobToken);

        $this->jsonRequest('POST', '/friends/requests', ['userId' => $bobId], $aliceToken);
        self::assertResponseStatusCodeSame(201);
        $friendshipId = (string) $this->jsonResponse()['friendship']['id'];

        $this->jsonRequest('GET', '/friends/search?q=bob', token: $aliceToken);
        self::assertResponseIsSuccessful();
        self::assertSame('Bobby', $this->jsonResponse()['data'][0]['displayName']);
        self::assertSame('pending', $this->jsonResponse()['data'][0]['friendshipStatus']);
        self::assertArrayNotHasKey('email', $this->jsonResponse()['data'][0]);

        $this->jsonRequest('GET', '/friends/search?q=bob@example.test', token: $aliceToken);
        self::assertResponseIsSuccessful();
        self::assertSame([], $this->jsonResponse()['data']);

        $this->jsonRequest('GET', '/friends/requests/incoming', token: $bobToken);
        self::assertResponseIsSuccessful();
        self::assertSame($friendshipId, $this->jsonResponse()['data'][0]['id']);

        $this->jsonRequest('POST', '/friends/requests/'.$friendshipId.'/accept', token: $bobToken);
        self::assertResponseIsSuccessful();
        self::assertSame('accepted', $this->jsonResponse()['friendship']['status']);

        $this->jsonRequest('GET', '/friends', token: $aliceToken);
        self::assertResponseIsSuccessful();
        $friend = $this->jsonResponse()['data'][0]['friend'];
        self::assertSame('Bobby', $friend['displayName']);
        self::assertSame('initial', $friend['avatar']['type']);
        self::assertSame('B', $friend['avatar']['initial']['letter']);
        self::assertContains($friend['presence'], ['online', 'in_game']);

        $this->jsonRequest('POST', '/me/offline', token: $bobToken);
        self::assertResponseStatusCodeSame(204);
        $updates = RecordingMercureHub::updates();
        $topics = array_merge(...array_map(
            static fn (array $update): array => $update['topics'],
            $updates,
        ));
        self::assertContains('friends/users/'.$this->currentUserId($aliceToken), $topics);

        $this->jsonRequest('GET', '/friends', token: $aliceToken);
        self::assertResponseIsSuccessful();
        self::assertSame('offline', $this->jsonResponse()['data'][0]['friend']['presence']);
    }

    public function testFriendPresencePublishesMercureUpdateWhenFriendComesOnline(): void
    {
        $aliceToken = $this->registerAndLogin('alice-presence@example.test', 'Alice Presence');
        $bobToken = $this->registerAndLogin('bob-presence@example.test', 'Bob Presence');
        $bobId = $this->currentUserId($bobToken);

        $this->jsonRequest('POST', '/friends/requests', ['userId' => $bobId], $aliceToken);
        $friendshipId = (string) $this->jsonResponse()['friendship']['id'];
        $this->jsonRequest('POST', '/friends/requests/'.$friendshipId.'/accept', token: $bobToken);
        self::assertResponseIsSuccessful();

        $aliceId = $this->currentUserId($aliceToken);
        $this->jsonRequest('POST', '/me/offline', token: $bobToken);
        self::assertResponseStatusCodeSame(204);

        RecordingMercureHub::reset();
        $this->jsonRequest('GET', '/me', token: $bobToken);
        self::assertResponseIsSuccessful();

        $updates = RecordingMercureHub::updates();
        self::assertNotEmpty($updates);
        self::assertSame(['friends/users/'.$aliceId], $updates[0]['topics']);
        $payload = json_decode($updates[0]['data'], true, flags: JSON_THROW_ON_ERROR);
        self::assertSame('friend.presence.changed', $payload['type']);
        self::assertSame('online', $payload['user']['presence']);
        self::assertSame('initial', $payload['user']['avatar']['type']);
    }

    public function testOutgoingFriendRequestCanBeCancelled(): void
    {
        $aliceToken = $this->registerAndLogin('alice-cancel@example.test', 'Alice Cancel');
        $this->registerAndLogin('bob-cancel@example.test', 'Bob Cancel');

        $this->jsonRequest('GET', '/friends/search?q=cancel', token: $aliceToken);
        $bobId = (string) $this->jsonResponse()['data'][0]['id'];

        $this->jsonRequest('POST', '/friends/requests', ['userId' => $bobId], $aliceToken);
        self::assertResponseStatusCodeSame(201);
        $friendshipId = (string) $this->jsonResponse()['friendship']['id'];

        $this->jsonRequest('DELETE', '/friends/requests/'.$friendshipId, token: $aliceToken);
        self::assertResponseStatusCodeSame(204);

        $this->jsonRequest('GET', '/friends/requests/outgoing', token: $aliceToken);
        self::assertResponseIsSuccessful();
        self::assertSame([], $this->jsonResponse()['data']);
    }

    public function testAcceptedFriendsCanBeInvitedToWaitingRooms(): void
    {
        $this->seedCard('bbbbbbbb-0000-7000-8000-000000000001', 'Commander Invite', [
            'type_line' => 'Legendary Creature - Human Advisor',
            'set' => 'tst',
            'collector_number' => '19',
        ]);
        $this->seedCard('bbbbbbbb-1111-7111-8111-111111111111', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'set' => 'tst',
            'collector_number' => '20',
        ]);
        $ownerToken = $this->registerAndLogin('owner@example.test', 'Owner');
        $guestToken = $this->registerAndLogin('guest@example.test', 'Guest');
        $guestUserId = $this->currentUserId($guestToken);
        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Invite Deck', [
            ['scryfallId' => 'bbbbbbbb-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'bbbbbbbb-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $guestDeckId = $this->quickBuildDeck($guestToken, 'Invite Guest Deck', [
            ['scryfallId' => 'bbbbbbbb-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'bbbbbbbb-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/friends/requests', ['userId' => $guestUserId], $ownerToken);
        $friendshipId = (string) $this->jsonResponse()['friendship']['id'];
        $this->jsonRequest('POST', '/friends/requests/'.$friendshipId.'/accept', token: $guestToken);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'deckId' => $ownerDeckId], $ownerToken);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/friends', token: $ownerToken);
        $guestId = (string) $this->jsonResponse()['data'][0]['friend']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/invites', ['userId' => $guestId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $inviteId = (string) $this->jsonResponse()['invite']['id'];

        $this->jsonRequest('GET', '/rooms/'.$roomId.'/invites', token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertSame($inviteId, $this->jsonResponse()['data'][0]['id']);

        $this->jsonRequest('GET', '/rooms/invites/incoming', token: $guestToken);
        self::assertResponseIsSuccessful();
        self::assertSame($inviteId, $this->jsonResponse()['data'][0]['id']);

        $this->jsonRequest('POST', '/rooms/invites/'.$inviteId.'/accept', ['deckId' => $guestDeckId], $guestToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);
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

}
