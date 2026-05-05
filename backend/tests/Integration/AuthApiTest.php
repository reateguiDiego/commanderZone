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

    public function testMercureCookieEndpointRequiresAuthAndSetsCookie(): void
    {
        $this->jsonRequest('POST', '/realtime/mercure-cookie');
        self::assertResponseStatusCodeSame(401);

        $token = $this->registerAndLogin('mercure@example.test', 'Mercure User');
        $this->client->request(
            'POST',
            'http://127.0.0.1/realtime/mercure-cookie',
            [],
            [],
            [
                'CONTENT_TYPE' => 'application/json',
                'HTTP_ACCEPT' => 'application/json',
                'HTTP_AUTHORIZATION' => 'Bearer '.$token,
            ],
            ''
        );
        self::assertResponseStatusCodeSame(204);

        $cookies = $this->client->getResponse()->headers->getCookies();
        self::assertNotEmpty($cookies);
        self::assertTrue(
            array_any(
                $cookies,
                static fn ($cookie): bool => $cookie->getName() === 'mercureAuthorization'
            )
        );
    }
}
