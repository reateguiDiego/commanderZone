<?php

namespace App\Application\Auth;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\Request;

class RefreshSessionCookieManager
{
    private const COOKIE_NAME = 'commanderzone.refresh';

    public function __construct(
        #[Autowire('%env(int:AUTH_REFRESH_TOKEN_TTL)%')]
        private readonly int $refreshTokenTtlSeconds,
        #[Autowire('%env(string:AUTH_REFRESH_COOKIE_DOMAIN)%')]
        private readonly string $cookieDomain,
        #[Autowire('%env(string:AUTH_REFRESH_COOKIE_SAMESITE)%')]
        private readonly string $cookieSameSite,
        #[Autowire('%kernel.environment%')]
        private readonly string $kernelEnvironment,
    ) {
    }

    public function cookieName(): string
    {
        return self::COOKIE_NAME;
    }

    public function makeRefreshCookie(Request $request, string $refreshToken): Cookie
    {
        $cookie = Cookie::create(self::COOKIE_NAME)
            ->withValue($refreshToken)
            ->withHttpOnly(true)
            ->withSecure($this->isSecureRequest($request))
            ->withSameSite($this->resolvedSameSite())
            ->withPath('/auth')
            ->withExpires((new \DateTimeImmutable())->modify(sprintf('+%d seconds', $this->refreshTokenTtlSeconds)));

        $domain = trim($this->cookieDomain);
        if ($domain !== '') {
            $cookie = $cookie->withDomain($domain);
        }

        return $cookie;
    }

    public function makeClearedCookie(Request $request): Cookie
    {
        $cookie = Cookie::create(self::COOKIE_NAME)
            ->withValue('')
            ->withHttpOnly(true)
            ->withSecure($this->isSecureRequest($request))
            ->withSameSite($this->resolvedSameSite())
            ->withPath('/auth')
            ->withExpires((new \DateTimeImmutable())->modify('-1 year'));

        $domain = trim($this->cookieDomain);
        if ($domain !== '') {
            $cookie = $cookie->withDomain($domain);
        }

        return $cookie;
    }

    private function isSecureRequest(Request $request): bool
    {
        if ($this->kernelEnvironment === 'prod') {
            return true;
        }

        return $request->isSecure();
    }

    private function resolvedSameSite(): ?string
    {
        $configured = mb_strtolower(trim($this->cookieSameSite));
        if ($configured === 'lax') {
            return Cookie::SAMESITE_LAX;
        }
        if ($configured === 'strict') {
            return Cookie::SAMESITE_STRICT;
        }
        if ($configured === 'none') {
            return Cookie::SAMESITE_NONE;
        }

        return $this->kernelEnvironment === 'prod'
            ? Cookie::SAMESITE_NONE
            : Cookie::SAMESITE_LAX;
    }
}
