<?php

namespace App\Tests\Integration;

class FriendsApiTest extends ApiTestCase
{
    public function testFriendRequestsCanBeAcceptedAndListedWithPresence(): void
    {
        $aliceToken = $this->registerAndLogin('alice@example.test', 'Alice');
        $bobToken = $this->registerAndLogin('bob@example.test', 'Bob');

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'bob@example.test'], $aliceToken);
        self::assertResponseStatusCodeSame(201);
        $friendshipId = (string) $this->jsonResponse()['friendship']['id'];

        $this->jsonRequest('GET', '/friends/search?q=bob', token: $aliceToken);
        self::assertResponseIsSuccessful();
        self::assertSame('Bob', $this->jsonResponse()['data'][0]['displayName']);
        self::assertSame('pending', $this->jsonResponse()['data'][0]['friendshipStatus']);

        $this->jsonRequest('GET', '/friends/requests/incoming', token: $bobToken);
        self::assertResponseIsSuccessful();
        self::assertSame($friendshipId, $this->jsonResponse()['data'][0]['id']);

        $this->jsonRequest('POST', '/friends/requests/'.$friendshipId.'/accept', token: $bobToken);
        self::assertResponseIsSuccessful();
        self::assertSame('accepted', $this->jsonResponse()['friendship']['status']);

        $this->jsonRequest('GET', '/friends', token: $aliceToken);
        self::assertResponseIsSuccessful();
        $friend = $this->jsonResponse()['data'][0]['friend'];
        self::assertSame('Bob', $friend['displayName']);
        self::assertContains($friend['presence'], ['online', 'in_game']);

        $this->jsonRequest('POST', '/me/offline', token: $bobToken);
        self::assertResponseStatusCodeSame(204);

        $this->jsonRequest('GET', '/friends', token: $aliceToken);
        self::assertResponseIsSuccessful();
        self::assertSame('offline', $this->jsonResponse()['data'][0]['friend']['presence']);
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
        $ownerToken = $this->registerAndLogin('owner@example.test', 'Owner');
        $guestToken = $this->registerAndLogin('guest@example.test', 'Guest');

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'guest@example.test'], $ownerToken);
        $friendshipId = (string) $this->jsonResponse()['friendship']['id'];
        $this->jsonRequest('POST', '/friends/requests/'.$friendshipId.'/accept', token: $guestToken);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private'], $ownerToken);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/friends', token: $ownerToken);
        $guestId = (string) $this->jsonResponse()['data'][0]['friend']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/invites', ['userId' => $guestId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $inviteId = (string) $this->jsonResponse()['invite']['id'];

        $this->jsonRequest('GET', '/rooms/invites/incoming', token: $guestToken);
        self::assertResponseIsSuccessful();
        self::assertSame($inviteId, $this->jsonResponse()['data'][0]['id']);

        $this->jsonRequest('POST', '/rooms/invites/'.$inviteId.'/accept', token: $guestToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);
    }
}
