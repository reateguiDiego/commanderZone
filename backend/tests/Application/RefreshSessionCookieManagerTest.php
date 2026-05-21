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

    public function testRejectsProductionConfigurationWhenTtlIsNotPositive(): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('AUTH_REFRESH_TOKEN_TTL must be a positive integer in production.');

        new RefreshSessionCookieManager(
            refreshTokenTtlSeconds: 0,
            cookieDomain: '.commanderzone.com',
            cookieSameSite: 'none',
            kernelEnvironment: 'prod',
        );
    }

    public function testRejectsProductionConfigurationWhenCookieDomainIsInvalid(): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('AUTH_REFRESH_COOKIE_DOMAIN must be a valid domain name in production.');

        new RefreshSessionCookieManager(
            refreshTokenTtlSeconds: 604800,
            cookieDomain: 'https://commanderzone.com',
            cookieSameSite: 'none',
            kernelEnvironment: 'prod',
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
}
