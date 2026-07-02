<?php

namespace App\Tests\Application;

use App\Application\Auth\GoogleIdTokenVerifier;
use App\Application\Auth\InvalidGoogleIdToken;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

class GoogleIdTokenVerifierTest extends TestCase
{
    public function testVerifiesSignedGoogleIdToken(): void
    {
        $fixture = self::tokenFixture(['aud' => 'google-client-id']);
        $verifier = new GoogleIdTokenVerifier(
            self::mockJwksClient($fixture['jwk']),
            'google-client-id',
            'https://google.test/certs',
        );

        $claims = $verifier->verify($fixture['token']);

        self::assertSame('google-subject-1', $claims->subject);
        self::assertSame('player@example.test', $claims->email);
        self::assertTrue($claims->emailVerified);
        self::assertSame('Player Example', $claims->name);
    }

    public function testRejectsWrongAudience(): void
    {
        $fixture = self::tokenFixture(['aud' => 'other-client-id']);
        $verifier = new GoogleIdTokenVerifier(
            self::mockJwksClient($fixture['jwk']),
            'google-client-id',
            'https://google.test/certs',
        );

        $this->expectException(InvalidGoogleIdToken::class);
        $this->expectExceptionMessage('audience');

        $verifier->verify($fixture['token']);
    }

    public function testRejectsInvalidSignature(): void
    {
        $fixture = self::tokenFixture();
        $tamperedToken = preg_replace('/\.[^.]+$/', '.'.self::base64UrlEncode('bad signature'), $fixture['token']);
        self::assertIsString($tamperedToken);
        $verifier = new GoogleIdTokenVerifier(
            self::mockJwksClient($fixture['jwk']),
            'google-client-id',
            'https://google.test/certs',
        );

        $this->expectException(InvalidGoogleIdToken::class);
        $this->expectExceptionMessage('signature');

        $verifier->verify($tamperedToken);
    }

    public function testRejectsUnverifiedEmail(): void
    {
        $fixture = self::tokenFixture(['email_verified' => false]);
        $verifier = new GoogleIdTokenVerifier(
            self::mockJwksClient($fixture['jwk']),
            'google-client-id',
            'https://google.test/certs',
        );

        $this->expectException(InvalidGoogleIdToken::class);
        $this->expectExceptionMessage('email verification');

        $verifier->verify($fixture['token']);
    }

    /**
     * @param array<string,mixed> $payloadOverrides
     * @return array{token: string, jwk: array<string,string>}
     */
    private static function tokenFixture(array $payloadOverrides = []): array
    {
        $privateKey = openssl_pkey_new([
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ]);
        self::assertNotFalse($privateKey);

        $details = openssl_pkey_get_details($privateKey);
        self::assertIsArray($details);
        self::assertIsArray($details['rsa']);

        $header = ['alg' => 'RS256', 'kid' => 'test-key-id', 'typ' => 'JWT'];
        $payload = [
            'iss' => 'https://accounts.google.com',
            'aud' => 'google-client-id',
            'exp' => time() + 3600,
            'sub' => 'google-subject-1',
            'email' => 'player@example.test',
            'email_verified' => true,
            'name' => 'Player Example',
            ...$payloadOverrides,
        ];

        $signedContent = self::base64UrlEncode(json_encode($header, JSON_THROW_ON_ERROR))
            .'.'
            .self::base64UrlEncode(json_encode($payload, JSON_THROW_ON_ERROR));
        $signed = openssl_sign($signedContent, $signature, $privateKey, OPENSSL_ALGO_SHA256);
        self::assertTrue($signed);

        return [
            'token' => $signedContent.'.'.self::base64UrlEncode($signature),
            'jwk' => [
                'kid' => 'test-key-id',
                'kty' => 'RSA',
                'alg' => 'RS256',
                'use' => 'sig',
                'n' => self::base64UrlEncode($details['rsa']['n']),
                'e' => self::base64UrlEncode($details['rsa']['e']),
            ],
        ];
    }

    /**
     * @param array<string,string> $jwk
     */
    private static function mockJwksClient(array $jwk): MockHttpClient
    {
        return new MockHttpClient([
            new MockResponse(json_encode(['keys' => [$jwk]], JSON_THROW_ON_ERROR)),
        ]);
    }

    private static function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
