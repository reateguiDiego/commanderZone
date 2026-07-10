<?php

namespace App\Tests\Application;

use App\Application\Auth\RefreshSessionCookieManager;
use PHPUnit\Framework\TestCase;

class RefreshSessionCookieManagerTest extends TestCase
{
    public function testAllowsValidProductionConfiguration(): void
    {
        $manager = new RefreshSessionCookieManager(
            refreshTokenTtlSeconds: 604800,
            cookieDomain: '.commanderzone.com',
            cookieSameSite: 'none',
            kernelEnvironment: 'prod',
        );

        self::assertSame('commanderzone.refresh', $manager->cookieName());
    }

    public function testRejectsInvalidProductionConfiguration(): void
    {
        $this->assertInvalidProductionConfiguration(
            refreshTokenTtlSeconds: 0,
            cookieDomain: '.commanderzone.com',
            expectedMessage: 'AUTH_REFRESH_TOKEN_TTL must be a positive integer in production.',
        );
        $this->assertInvalidProductionConfiguration(
            refreshTokenTtlSeconds: 604800,
            cookieDomain: 'https://commanderzone.com',
            expectedMessage: 'AUTH_REFRESH_COOKIE_DOMAIN must be a valid domain name in production.',
        );
    }

    public function testAllowsNonProductionInvalidValues(): void
    {
        $manager = new RefreshSessionCookieManager(
            refreshTokenTtlSeconds: 0,
            cookieDomain: 'https://localhost:8000',
            cookieSameSite: 'lax',
            kernelEnvironment: 'dev',
        );

        self::assertSame('commanderzone.refresh', $manager->cookieName());
    }

    private function assertInvalidProductionConfiguration(
        int $refreshTokenTtlSeconds,
        string $cookieDomain,
        string $expectedMessage,
    ): void {
        try {
            new RefreshSessionCookieManager(
                refreshTokenTtlSeconds: $refreshTokenTtlSeconds,
                cookieDomain: $cookieDomain,
                cookieSameSite: 'none',
                kernelEnvironment: 'prod',
            );
            self::fail('Expected invalid refresh session cookie configuration to be rejected.');
        } catch (\LogicException $exception) {
            self::assertSame($expectedMessage, $exception->getMessage());
        }
    }
}
