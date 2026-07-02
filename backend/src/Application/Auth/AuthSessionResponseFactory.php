<?php

namespace App\Application\Auth;

use App\Domain\User\User;
use Lexik\Bundle\JWTAuthenticationBundle\Services\JWTTokenManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

class AuthSessionResponseFactory
{
    public function __construct(
        private readonly JWTTokenManagerInterface $jwtTokenManager,
        private readonly RefreshSessionService $refreshSessionService,
        private readonly RefreshSessionCookieManager $refreshSessionCookieManager,
    ) {
    }

    /**
     * @param array<string,mixed> $payload
     */
    public function create(Request $request, array $payload, User $user, int $status = 200): JsonResponse
    {
        $refreshToken = $this->refreshSessionService->issueSession(
            $user,
            $request->getClientIp(),
            $request->headers->get('User-Agent'),
        );

        $response = new JsonResponse([
            ...$payload,
            'token' => $this->jwtTokenManager->create($user),
        ], $status);
        $response->headers->setCookie($this->refreshSessionCookieManager->makeRefreshCookie($request, $refreshToken));
        if ($this->refreshSessionCookieManager->hasCookieDomain()) {
            $response->headers->setCookie($this->refreshSessionCookieManager->makeHostOnlyRefreshCookie($request, $refreshToken));
        }

        return $response;
    }
}
