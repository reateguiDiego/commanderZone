<?php

namespace App\Tests\Integration;

class FriendsApiTest extends ApiTestCase
{
    public function testFriendRequestAcceptDeleteAndDeclineFlow(): void
    {
        $aliceToken = $this->registerAndLogin('alice@example.test', 'Alice');
        $aliceId = $this->currentUserId($aliceToken);
        $bobToken = $this->registerAndLogin('bob@example.test', 'Bob');
        $bobId = $this->currentUserId($bobToken);
        $charlieToken = $this->registerAndLogin('charlie@example.test', 'Charlie');

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'alice@example.test'], $aliceToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'missing@example.test'], $aliceToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'bob@example.test'], $aliceToken);
        self::assertResponseStatusCodeSame(201);
        $request = $this->jsonResponse()['friendship'];
        $requestId = (string) $request['id'];
        self::assertSame('pending', $request['status']);
        self::assertSame($aliceId, $request['requester']['id']);
        self::assertSame($bobId, $request['recipient']['id']);
        self::assertSame($bobId, $request['friend']['id']);

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'bob@example.test'], $aliceToken);
        self::assertResponseStatusCodeSame(409);

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'alice@example.test'], $bobToken);
        self::assertResponseStatusCodeSame(409);

        $this->jsonRequest('GET', '/friends/requests/outgoing', token: $aliceToken);
        self::assertResponseIsSuccessful();
        self::assertSame($requestId, $this->jsonResponse()['data'][0]['id']);

        $this->jsonRequest('GET', '/friends/requests/incoming', token: $bobToken);
        self::assertResponseIsSuccessful();
        self::assertSame($requestId, $this->jsonResponse()['data'][0]['id']);

        $this->jsonRequest('POST', '/friends/requests/'.$requestId.'/accept', token: $charlieToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('POST', '/friends/requests/'.$requestId.'/accept', token: $bobToken);
        self::assertResponseIsSuccessful();
        self::assertSame('accepted', $this->jsonResponse()['friendship']['status']);

        $this->jsonRequest('GET', '/friends', token: $aliceToken);
        self::assertResponseIsSuccessful();
        self::assertSame($bobId, $this->jsonResponse()['data'][0]['friend']['id']);

        $this->jsonRequest('GET', '/friends', token: $bobToken);
        self::assertResponseIsSuccessful();
        self::assertSame($aliceId, $this->jsonResponse()['data'][0]['friend']['id']);

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'bob@example.test'], $aliceToken);
        self::assertResponseStatusCodeSame(409);

        $this->jsonRequest('DELETE', '/friends/'.$bobId, token: $aliceToken);
        self::assertResponseStatusCodeSame(204);

        $this->jsonRequest('GET', '/friends', token: $aliceToken);
        self::assertResponseIsSuccessful();
        self::assertSame([], $this->jsonResponse()['data']);

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'bob@example.test'], $aliceToken);
        self::assertResponseStatusCodeSame(201);
        $secondRequestId = (string) $this->jsonResponse()['friendship']['id'];

        $this->jsonRequest('POST', '/friends/requests/'.$secondRequestId.'/decline', token: $bobToken);
        self::assertResponseIsSuccessful();
        self::assertSame('declined', $this->jsonResponse()['friendship']['status']);

        $this->jsonRequest('GET', '/friends', token: $bobToken);
        self::assertResponseIsSuccessful();
        self::assertSame([], $this->jsonResponse()['data']);
    }

    private function currentUserId(string $token): string
    {
        $this->jsonRequest('GET', '/me', token: $token);
        self::assertResponseIsSuccessful();

        return (string) $this->jsonResponse()['user']['id'];
    }
}
