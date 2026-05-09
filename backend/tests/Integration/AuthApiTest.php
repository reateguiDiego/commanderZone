<?php

namespace App\Tests\Integration;

class AuthApiTest extends ApiTestCase
{
    public function testRegisterLoginMeAndProfileUpdates(): void
    {
        $token = $this->registerAndLogin('player@example.test', 'Player');
        $this->registerAndLogin('taken-profile@example.test', 'Taken Name');

        $this->jsonRequest('GET', '/me', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('player@example.test', $this->jsonResponse()['user']['email']);
        self::assertSame('initial', $this->jsonResponse()['user']['avatar']['type']);
        self::assertSame('P', $this->jsonResponse()['user']['avatar']['initial']['letter']);

        $this->jsonRequest('PATCH', '/me', ['displayName' => 'Taken Name'], $token);
        self::assertResponseStatusCodeSame(409);

        $this->jsonRequest('PATCH', '/me', ['email' => 'taken-profile@example.test'], $token);
        self::assertResponseStatusCodeSame(409);

        $this->jsonRequest('PATCH', '/me', [
            'displayName' => 'Renamed Player',
            'email' => 'renamed-player@example.test',
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertSame('Renamed Player', $this->jsonResponse()['user']['displayName']);
        self::assertSame('renamed-player@example.test', $this->jsonResponse()['user']['email']);

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
            'email' => 'renamed-player@example.test',
            'password' => 'password456',
        ]);
        self::assertResponseIsSuccessful();
        self::assertArrayHasKey('token', $this->jsonResponse());
    }

    public function testDisplayNameAvailabilityAndUniqueness(): void
    {
        $this->registerAndLogin('unique-owner@example.test', 'Unique Player');

        $this->jsonRequest('GET', '/auth/display-name-availability?displayName=AvailableName');
        self::assertResponseIsSuccessful();
        self::assertTrue($this->jsonResponse()['available']);

        $this->jsonRequest('GET', '/auth/display-name-availability?displayName=unique%20player');
        self::assertResponseIsSuccessful();
        self::assertFalse($this->jsonResponse()['available']);

        $this->jsonRequest('GET', '/auth/display-name-availability?displayName=abcdefghijklmnopqrstuvwxyz');
        self::assertResponseIsSuccessful();
        self::assertFalse($this->jsonResponse()['available']);

        $this->jsonRequest('POST', '/auth/register', [
            'email' => 'duplicate-name@example.test',
            'displayName' => 'Unique Player',
            'password' => 'password123',
        ]);
        self::assertResponseStatusCodeSame(409);
    }

    public function testEmailAvailability(): void
    {
        $this->registerAndLogin('email-owner@example.test', 'Email Owner');

        $this->jsonRequest('GET', '/auth/email-availability?email=free@example.test');
        self::assertResponseIsSuccessful();
        self::assertTrue($this->jsonResponse()['available']);

        $this->jsonRequest('GET', '/auth/email-availability?email=EMAIL-OWNER@example.test');
        self::assertResponseIsSuccessful();
        self::assertFalse($this->jsonResponse()['available']);

        $this->jsonRequest('GET', '/auth/email-availability?email=not-an-email');
        self::assertResponseIsSuccessful();
        self::assertFalse($this->jsonResponse()['available']);
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

    public function testPasswordResetRequestAndConfirmFlow(): void
    {
        $this->registerAndLogin('reset@example.test', 'Reset User', 'password123');

        $this->jsonRequest('POST', '/auth/password-reset/request', [
            'email' => 'reset@example.test',
        ]);
        self::assertResponseStatusCodeSame(202);
        $requestResponse = $this->jsonResponse();
        self::assertTrue($requestResponse['accepted']);

        $this->jsonRequest('POST', '/auth/password-reset/confirm', [
            'email' => 'missing@example.test',
            'newPassword' => 'password456',
        ]);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/auth/password-reset/confirm', [
            'email' => 'reset@example.test',
            'newPassword' => 'password456',
        ]);
        self::assertResponseIsSuccessful();
        self::assertTrue($this->jsonResponse()['updated']);

        $this->jsonRequest('POST', '/auth/login', [
            'email' => 'reset@example.test',
            'password' => 'password123',
        ]);
        self::assertResponseStatusCodeSame(401);

        $this->jsonRequest('POST', '/auth/login', [
            'email' => 'reset@example.test',
            'password' => 'password456',
        ]);
        self::assertResponseIsSuccessful();
        self::assertArrayHasKey('token', $this->jsonResponse());
    }

    public function testAvatarCanBeUpdatedWithPresetUploadAndInitialFallback(): void
    {
        $token = $this->registerAndLogin('avatar@example.test', 'Avatar User');

        $this->jsonRequest('PATCH', '/me/avatar', [
            'type' => 'preset',
            'imageUrl' => 'assets/images/avatars/obsidian-geomancer.png',
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertSame('preset', $this->jsonResponse()['user']['avatar']['type']);
        self::assertSame('assets/images/avatars/obsidian-geomancer.png', $this->jsonResponse()['user']['avatar']['imageUrl']);

        $imageData = 'data:image/png;base64,'.base64_encode('avatar-image-bytes');
        $this->jsonRequest('PATCH', '/me/avatar', [
            'type' => 'upload',
            'imageData' => $imageData,
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertSame('upload', $this->jsonResponse()['user']['avatar']['type']);
        $avatarUrl = $this->jsonResponse()['user']['avatar']['imageUrl'];
        self::assertIsString($avatarUrl);
        self::assertStringStartsWith('/users/', $avatarUrl);

        $this->jsonRequest('GET', $avatarUrl);
        self::assertResponseIsSuccessful();
        self::assertSame('image/png', $this->client->getResponse()->headers->get('Content-Type'));
        self::assertSame('avatar-image-bytes', $this->client->getResponse()->getContent());

        $this->jsonRequest('PATCH', '/me/avatar', [
            'type' => 'initial',
            'letter' => 'CZ',
            'backgroundColor' => '#112233',
            'textColor' => '#ffeeaa',
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertSame([
            'type' => 'initial',
            'imageUrl' => null,
            'initial' => [
                'letter' => 'CZ',
                'backgroundColor' => '#112233',
                'textColor' => '#ffeeaa',
            ],
        ], $this->jsonResponse()['user']['avatar']);
    }

    public function testAvatarRejectsUnknownPresetAndOversizedUpload(): void
    {
        $token = $this->registerAndLogin('bad-avatar@example.test', 'Bad Avatar');

        $this->jsonRequest('PATCH', '/me/avatar', [
            'type' => 'preset',
            'imageUrl' => 'assets/images/avatars/not-ours.png',
        ], $token);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('PATCH', '/me/avatar', [
            'type' => 'upload',
            'imageData' => 'data:image/png;base64,'.base64_encode(str_repeat('x', 2_097_153)),
        ], $token);
        self::assertResponseStatusCodeSame(400);
    }

    public function testDeleteAccountAnonymizesIdentityAndBlocksOldLogin(): void
    {
        $token = $this->registerAndLogin('delete-me@example.test', 'Delete Me', 'password123');

        $this->jsonRequest('DELETE', '/me', token: $token);
        self::assertResponseStatusCodeSame(204);

        $this->jsonRequest('POST', '/auth/login', [
            'email' => 'delete-me@example.test',
            'password' => 'password123',
        ]);
        self::assertResponseStatusCodeSame(401);

        $this->jsonRequest('GET', '/me', token: $token);
        self::assertResponseIsSuccessful();
        self::assertStringStartsWith('Deleted-', $this->jsonResponse()['user']['displayName']);
        self::assertStringStartsWith('deleted+', $this->jsonResponse()['user']['email']);
    }

    public function testDisplayNameLengthIsLimitedTo25Chars(): void
    {
        $this->jsonRequest('POST', '/auth/register', [
            'email' => 'too-long-name@example.test',
            'displayName' => 'abcdefghijklmnopqrstuvwxyz',
            'password' => 'password123',
        ]);
        self::assertResponseStatusCodeSame(400);

        $token = $this->registerAndLogin('valid-name@example.test', 'Valid Name');
        $this->jsonRequest('PATCH', '/me', [
            'displayName' => 'abcdefghijklmnopqrstuvwxyz',
        ], $token);
        self::assertResponseStatusCodeSame(400);
    }
}
