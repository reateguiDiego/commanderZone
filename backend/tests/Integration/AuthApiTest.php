<?php

namespace App\Tests\Integration;

class AuthApiTest extends ApiTestCase
{
    public function testRegisterLoginMeAndProfileUpdates(): void
    {
        $token = $this->registerAndLogin('player@example.test', 'Player');

        $this->jsonRequest('GET', '/me', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('player@example.test', $this->jsonResponse()['user']['email']);

        $this->jsonRequest('PATCH', '/me', ['displayName' => 'Renamed Player'], $token);
        self::assertResponseIsSuccessful();
        self::assertSame('Renamed Player', $this->jsonResponse()['user']['displayName']);

        $this->jsonRequest('PATCH', '/me/password', [
            'currentPassword' => 'bad-password',
            'newPassword' => 'password456',
        ], $token);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('PATCH', '/me/password', [
            'currentPassword' => 'password123',
            'newPassword' => 'password456',
        ], $token);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/auth/login', [
            'email' => 'player@example.test',
            'password' => 'password456',
        ]);
        self::assertResponseIsSuccessful();
        self::assertArrayHasKey('token', $this->jsonResponse());
    }

    public function testMeRequiresAuthentication(): void
    {
        $this->jsonRequest('GET', '/me');

        self::assertResponseStatusCodeSame(401);
    }
}
