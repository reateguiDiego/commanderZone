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
        return Cookie::create(self::COOKIE_NAME)
            ->withValue($refreshToken)
            ->withHttpOnly(true)
            ->withSecure($this->isSecureRequest($request))
            ->withSameSite(Cookie::SAMESITE_LAX)
            ->withPath('/auth')
            ->withExpires((new \DateTimeImmutable())->modify(sprintf('+%d seconds', $this->refreshTokenTtlSeconds)));
    }

    public function makeClearedCookie(Request $request): Cookie
    {
        return Cookie::create(self::COOKIE_NAME)
            ->withValue('')
            ->withHttpOnly(true)
            ->withSecure($this->isSecureRequest($request))
            ->withSameSite(Cookie::SAMESITE_LAX)
            ->withPath('/auth')
            ->withExpires((new \DateTimeImmutable())->modify('-1 year'));
    }

    private function isSecureRequest(Request $request): bool
    {
        if ($this->kernelEnvironment === 'prod') {
            return true;
        }

        return $request->isSecure();
    }
}
