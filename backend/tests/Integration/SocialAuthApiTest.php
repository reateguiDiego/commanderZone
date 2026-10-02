<?php

namespace App\Tests\Integration;

use App\Application\Auth\GoogleIdTokenClaims;
use App\Application\Auth\GoogleIdTokenVerifierInterface;
use App\Application\Auth\InvalidGoogleIdToken;
use App\Application\Auth\RegistrationWelcomeEmailSender;
use App\Application\Auth\SecurityAuditLogger;
use App\Application\Auth\SocialAuthService;
use App\Application\Message\RegistrationWelcomeMessageService;
use App\Domain\Auth\AuthIdentity;
use App\Domain\User\User;
use App\Infrastructure\Realtime\MessageEventPublisher;
use App\Tests\Support\RecordingMercureHub;
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
        $emailCountBeforeExchange = count(self::getMailerMessages());

        $this->jsonRequest('POST', '/auth/google/exchange', ['credential' => 'valid-google-credential']);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertArrayHasKey('token', $response);
        self::assertNotNull($this->refreshCookieFromResponse());
        self::assertCount($emailCountBeforeExchange + 1, self::getMailerMessages());
        $welcomeEmail = self::getMailerMessage($emailCountBeforeExchange);
        self::assertNotNull($welcomeEmail);
        self::assertEmailAddressContains($welcomeEmail, 'To', 'google-player@example.test');
        self::assertEmailSubjectContains($welcomeEmail, 'Welcome');
        self::assertEmailTextBodyContains($welcomeEmail, 'Welcome to CommanderZone!');

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

        $updates = RecordingMercureHub::updates();
        self::assertCount(1, $updates);
        self::assertSame(['messages/users/'.$user->id()], $updates[0]['topics']);
        self::assertTrue($updates[0]['private']);
        self::assertSame(['type' => 'message.list.changed'], json_decode($updates[0]['data'], true, flags: JSON_THROW_ON_ERROR));

        $this->jsonRequest('GET', '/messages', token: (string) $response['token']);
        self::assertResponseIsSuccessful();
        $messages = $this->jsonResponse();
        self::assertSame(1, $messages['unreadCount']);
        self::assertCount(1, $messages['data']);
        self::assertSame('Welcome', $messages['data'][0]['subject']);
    }

    public function testGoogleExchangeReusesExistingProviderIdentity(): void
    {
        $welcomeEmailSender = $this->createMock(RegistrationWelcomeEmailSender::class);
        $welcomeEmailSender
            ->expects(self::once())
            ->method('sendFailOpen');
        static::getContainer()->set(RegistrationWelcomeEmailSender::class, $welcomeEmailSender);

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
        self::assertSame(1, (int) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM user_message'));
        self::assertCount(1, RecordingMercureHub::updates());
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
            static::getContainer()->get(RegistrationWelcomeMessageService::class),
            static::getContainer()->get(RegistrationWelcomeEmailSender::class),
            static::getContainer()->get(MessageEventPublisher::class),
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
