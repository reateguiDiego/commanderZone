<?php

namespace App\Application\Auth;

use Lexik\Bundle\JWTAuthenticationBundle\Exception\JWTDecodeFailureException;
use Lexik\Bundle\JWTAuthenticationBundle\Services\JWTTokenManagerInterface;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorageInterface;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;

final readonly class ImpersonationContext
{
    public function __construct(
        private TokenStorageInterface $tokenStorage,
        private JWTTokenManagerInterface $jwtTokenManager,
    ) {
    }

    public function isImpersonated(): bool
    {
        $token = $this->tokenStorage->getToken();
        if (!$token instanceof TokenInterface) {
            return false;
        }

        try {
            $payload = $this->jwtTokenManager->decode($token);
        } catch (JWTDecodeFailureException) {
            return false;
        }

        return is_array($payload) && ($payload['impersonated'] ?? false) === true;
    }
}
