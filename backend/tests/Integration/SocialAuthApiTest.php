<?php

namespace App\Tests\Integration;

use App\Application\Auth\GoogleIdTokenClaims;
use App\Application\Auth\GoogleIdTokenVerifierInterface;
use App\Application\Auth\InvalidGoogleIdToken;
use App\Application\Auth\SecurityAuditLogger;
use App\Application\Auth\SocialAuthService;
use App\Domain\Auth\AuthIdentity;
use App\Domain\User\User;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class SocialAuthApiTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->client->disableReboot();
    }

    public function testGoogleExchangeCreatesVerifiedUserAndRefreshCookie(): void
    {
        $this->replaceGoogleVerifier(new GoogleIdTokenClaims(
            'google-subject-1',
            'google-player@example.test',
            true,
            'Google Player',
        ));

        $this->jsonRequest('POST', '/auth/google/exchange', ['credential' => 'valid-google-credential']);

        self::assertResponseIsSuccessful();
        self::assertArrayHasKey('token', $this->jsonResponse());
        self::assertNotNull($this->refreshCookieFromResponse());

        $user = $this->entityManager->getRepository(User::class)->findOneBy(['email' => 'google-player@example.test']);
        self::assertInstanceOf(User::class, $user);
        self::assertTrue($user->isEmailVerified());
        self::assertSame('Google Player', $user->displayName());
        self::assertSame(['ROLE_USER'], $user->getRoles());

        $identity = $this->entityManager->getRepository(AuthIdentity::class)->findOneBy([
            'provider' => AuthIdentity::PROVIDER_GOOGLE,
            'providerUserId' => 'google-subject-1',
        ]);
        self::assertInstanceOf(AuthIdentity::class, $identity);
        self::assertSame($user->id(), $identity->user()->id());
    }

    public function testGoogleExchangeReusesExistingProviderIdentity(): void
    {
        $this->replaceGoogleVerifier(new GoogleIdTokenClaims(
            'google-subject-1',
            'google-player@example.test',
            true,
            'Google Player',
        ));

        $this->jsonRequest('POST', '/auth/google/exchange', ['credential' => 'valid-google-credential']);
        self::assertResponseIsSuccessful();
        $firstToken = $this->jsonResponse()['token'] ?? null;
        self::assertIsString($firstToken);
        $this->jsonRequest('GET', '/me', token: $firstToken);
        $firstUserId = (string) $this->jsonResponse()['user']['id'];

        $this->jsonRequest('POST', '/auth/google/exchange', ['credential' => 'valid-google-credential']);
        self::assertResponseIsSuccessful();
        $secondToken = $this->jsonResponse()['token'] ?? null;
        self::assertIsString($secondToken);
        $this->jsonRequest('GET', '/me', token: $secondToken);

        self::assertSame($firstUserId, (string) $this->jsonResponse()['user']['id']);
        self::assertSame(1, (int) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM app_user'));
        self::assertSame(1, (int) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM auth_identity'));
    }

    public function testGoogleExchangeBlocksExistingLocalEmailWithoutLinking(): void
    {
        $this->registerAndLogin('existing@example.test', 'Existing User');
        $this->replaceGoogleVerifier(new GoogleIdTokenClaims(
            'google-subject-existing',
            'existing@example.test',
            true,
            'Existing User',
        ));

        $this->jsonRequest('POST', '/auth/google/exchange', ['credential' => 'valid-google-credential']);

        self::assertResponseStatusCodeSame(409);
        self::assertSame('link_required', $this->jsonResponse()['code'] ?? null);
        self::assertSame(0, (int) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM auth_identity'));
    }

    public function testGoogleExchangeRejectsInvalidCredential(): void
    {
        $verifier = $this->createMock(GoogleIdTokenVerifierInterface::class);
        $verifier
            ->method('verify')
            ->willThrowException(new InvalidGoogleIdToken('Google credential signature is invalid.'));
        $this->replaceSocialAuthService($verifier);

        $this->jsonRequest('POST', '/auth/google/exchange', ['credential' => 'bad-google-credential']);

        self::assertResponseStatusCodeSame(401);
        self::assertSame('invalid_google_credential', $this->jsonResponse()['code'] ?? null);
    }

    public function testGoogleExchangeRejectsUnverifiedEmail(): void
    {
        $this->replaceGoogleVerifier(new GoogleIdTokenClaims(
            'google-subject-unverified',
            'unverified@example.test',
            false,
            'Unverified User',
        ));

        $this->jsonRequest('POST', '/auth/google/exchange', ['credential' => 'valid-google-credential']);

        self::assertResponseStatusCodeSame(401);
        self::assertSame('invalid_google_credential', $this->jsonResponse()['code'] ?? null);
    }

    private function replaceGoogleVerifier(GoogleIdTokenClaims $claims): void
    {
        $verifier = $this->createMock(GoogleIdTokenVerifierInterface::class);
        $verifier
            ->method('verify')
            ->willReturn($claims);
        $this->replaceSocialAuthService($verifier);
    }

    private function replaceSocialAuthService(GoogleIdTokenVerifierInterface $verifier): void
    {
        static::getContainer()->set(SocialAuthService::class, new SocialAuthService(
            $this->entityManager,
            $verifier,
            static::getContainer()->get(UserPasswordHasherInterface::class),
            static::getContainer()->get(SecurityAuditLogger::class),
        ));
    }

    private function refreshCookieFromResponse(): ?Cookie
    {
        foreach ($this->client->getResponse()->headers->getCookies() as $cookie) {
            if ($cookie->getName() === 'commanderzone.refresh') {
                return $cookie;
            }
        }

        return null;
    }
}
