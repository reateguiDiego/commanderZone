<?php

namespace App\Tests\Integration;

use App\Application\Auth\AuthMailer;
use App\Application\Auth\AuthTokenService;
use App\Domain\User\User;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class AuthApiTest extends ApiTestCase
{
    public function testRegisterLoginMeAndProfileUpdates(): void
    {
        $token = $this->registerAndLogin('player@example.test', 'Player');
        $this->registerAndLogin('taken-profile@example.test', 'Taken Name');

        $this->jsonRequest('GET', '/me', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('player@example.test', $this->jsonResponse()['user']['email']);
        self::assertTrue($this->jsonResponse()['user']['emailVerified']);
        self::assertSame('initial', $this->jsonResponse()['user']['avatar']['type']);
        self::assertSame('P', $this->jsonResponse()['user']['avatar']['initial']['letter']);
        self::assertSame(['type' => 'plain', 'presetId' => 'plain'], $this->jsonResponse()['user']['displayNameStyle']);

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
        self::assertSame('player@example.test', $this->jsonResponse()['user']['email']);
        self::assertSame('renamed-player@example.test', $this->jsonResponse()['user']['pendingEmail']);
        self::assertTrue($this->jsonResponse()['emailChangeVerificationRequired']);
        $emailVerificationToken = $this->jsonResponse()['emailVerificationToken'];
        self::assertIsString($emailVerificationToken);

        $this->jsonRequest('POST', '/auth/email-verification/confirm', ['token' => $emailVerificationToken]);
        self::assertResponseIsSuccessful();
        self::assertSame('renamed-player@example.test', $this->jsonResponse()['user']['email']);
        self::assertNull($this->jsonResponse()['user']['pendingEmail']);

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
        self::assertArrayHasKey('passwordResetToken', $requestResponse);
        self::assertIsString($requestResponse['passwordResetToken']);
        $passwordResetToken = $requestResponse['passwordResetToken'];

        $this->jsonRequest('POST', '/auth/password-reset/confirm', [
            'token' => '',
            'newPassword' => 'password456',
        ]);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/auth/password-reset/confirm', [
            'token' => $passwordResetToken,
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

    public function testPasswordResetTokenCannotBeReused(): void
    {
        $this->registerAndLogin('reset-reuse@example.test', 'Reset Reuse', 'password123');

        $this->jsonRequest('POST', '/auth/password-reset/request', ['email' => 'reset-reuse@example.test']);
        self::assertResponseStatusCodeSame(202);
        $passwordResetToken = $this->jsonResponse()['passwordResetToken'];
        self::assertIsString($passwordResetToken);

        $this->jsonRequest('POST', '/auth/password-reset/confirm', [
            'token' => $passwordResetToken,
            'newPassword' => 'password456',
        ]);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/auth/password-reset/confirm', [
            'token' => $passwordResetToken,
            'newPassword' => 'password789',
        ]);
        self::assertResponseStatusCodeSame(400);
    }

    public function testPasswordResetRejectsExpiredToken(): void
    {
        $this->registerAndLogin('reset-expired@example.test', 'Reset Expired', 'password123');

        $this->jsonRequest('POST', '/auth/password-reset/request', ['email' => 'reset-expired@example.test']);
        self::assertResponseStatusCodeSame(202);
        $passwordResetToken = $this->jsonResponse()['passwordResetToken'];
        self::assertIsString($passwordResetToken);

        $tokenHash = static::getContainer()->get(AuthTokenService::class)->hashToken($passwordResetToken);
        $this->entityManager->getConnection()->executeStatement(
            "UPDATE password_reset_token SET expires_at = NOW() - INTERVAL '1 hour' WHERE token_hash = :tokenHash",
            ['tokenHash' => $tokenHash]
        );

        $this->jsonRequest('POST', '/auth/password-reset/confirm', [
            'token' => $passwordResetToken,
            'newPassword' => 'password456',
        ]);
        self::assertResponseStatusCodeSame(400);
    }

    public function testEmailVerificationResendInvalidatesPreviousToken(): void
    {
        $this->jsonRequest('POST', '/auth/register', [
            'email' => 'verify-me@example.test',
            'displayName' => 'Verify User',
            'password' => 'password123',
        ]);
        self::assertResponseStatusCodeSame(201);
        $firstToken = $this->jsonResponse()['emailVerificationToken'];
        self::assertIsString($firstToken);

        $this->jsonRequest('POST', '/auth/email-verification/request', [
            'email' => 'verify-me@example.test',
        ]);
        self::assertResponseStatusCodeSame(202);
        $secondToken = $this->jsonResponse()['emailVerificationToken'];
        self::assertIsString($secondToken);
        self::assertNotSame($firstToken, $secondToken);

        $this->jsonRequest('POST', '/auth/email-verification/confirm', ['token' => $firstToken]);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/auth/email-verification/confirm', ['token' => $secondToken]);
        self::assertResponseIsSuccessful();
        self::assertTrue($this->jsonResponse()['verified']);

        $this->jsonRequest('POST', '/auth/login', [
            'email' => 'verify-me@example.test',
            'password' => 'password123',
        ]);
        self::assertResponseIsSuccessful();
    }

    public function testLoginIsLockedAfterRepeatedFailures(): void
    {
        $this->registerAndLogin('lockout@example.test', 'Lockout User', 'password123');

        for ($i = 0; $i < 5; $i++) {
            $this->jsonRequest('POST', '/auth/login', [
                'email' => 'lockout@example.test',
                'password' => 'wrong-password',
            ]);
            self::assertResponseStatusCodeSame(401);
        }

        $this->jsonRequest('POST', '/auth/login', [
            'email' => 'lockout@example.test',
            'password' => 'password123',
        ]);
        self::assertResponseStatusCodeSame(429);
    }

    public function testRegisterKeepsSuccessWhenMailerFails(): void
    {
        $failingMailer = $this->getMockBuilder(AuthMailer::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['sendEmailVerification'])
            ->getMock();
        $failingMailer
            ->expects(self::once())
            ->method('sendEmailVerification')
            ->willThrowException(new \RuntimeException('smtp offline'));

        static::getContainer()->set(AuthMailer::class, $failingMailer);

        $this->jsonRequest('POST', '/auth/register', [
            'email' => 'mail-fail-register@example.test',
            'displayName' => 'Mail Fails Register',
            'password' => 'password123',
        ]);
        self::assertResponseStatusCodeSame(201);
        self::assertTrue($this->jsonResponse()['verificationRequired']);
    }

    public function testPasswordResetRequestKeepsAcceptedWhenMailerFails(): void
    {
        $user = new User('mail-fail-reset@example.test', 'Mail Fails Reset');
        $passwordHasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        $user->setPassword($passwordHasher->hashPassword($user, 'password123'));
        $user->markEmailVerified();
        $this->entityManager->persist($user);
        $this->entityManager->flush();

        $failingMailer = $this->getMockBuilder(AuthMailer::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['sendPasswordReset'])
            ->getMock();
        $failingMailer
            ->expects(self::once())
            ->method('sendPasswordReset')
            ->willThrowException(new \RuntimeException('smtp offline'));

        static::getContainer()->set(AuthMailer::class, $failingMailer);

        $this->jsonRequest('POST', '/auth/password-reset/request', [
            'email' => 'mail-fail-reset@example.test',
        ]);
        self::assertResponseStatusCodeSame(202);
        self::assertTrue($this->jsonResponse()['accepted']);
    }

    public function testDisplayNameStyleCanBeUpdated(): void
    {
        $token = $this->registerAndLogin('style@example.test', 'Style User');

        $this->jsonRequest('PATCH', '/me/display-name-style', [
            'presetId' => 'obsidian-crown',
            'textColor' => '#ffeeaa',
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertSame([
            'type' => 'preset',
            'presetId' => 'obsidian-crown',
            'textColor' => '#ffeeaa',
        ], $this->jsonResponse()['user']['displayNameStyle']);

        $this->jsonRequest('PATCH', '/me/display-name-style', [
            'presetId' => 'basic-green',
            'textColor' => '#d7ffd0',
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertSame([
            'type' => 'preset',
            'presetId' => 'basic-green',
            'textColor' => '#d7ffd0',
        ], $this->jsonResponse()['user']['displayNameStyle']);

        $this->jsonRequest('PATCH', '/me/display-name-style', [
            'presetId' => 'plain',
            'textColor' => '#ffffff',
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertSame([
            'type' => 'plain',
            'presetId' => 'plain',
            'textColor' => '#ffffff',
        ], $this->jsonResponse()['user']['displayNameStyle']);

        $this->jsonRequest('PATCH', '/me/display-name-style', [
            'presetId' => 'basic-colorless',
            'textColor' => '#f8f0d0',
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertSame([
            'type' => 'preset',
            'presetId' => 'basic-colorless',
            'textColor' => '#f8f0d0',
        ], $this->jsonResponse()['user']['displayNameStyle']);

        $this->jsonRequest('PATCH', '/me/display-name-style', [
            'presetId' => 'not-available',
        ], $token);
        self::assertResponseStatusCodeSame(400);
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
