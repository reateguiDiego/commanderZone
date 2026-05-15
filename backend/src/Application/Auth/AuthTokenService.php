<?php

namespace App\Application\Auth;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

class AuthTokenService
{
    public function __construct(
        #[Autowire('%kernel.secret%')]
        private readonly string $secret,
    ) {
    }

    public function generatePlainToken(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    public function hashToken(string $plainToken): string
    {
        return hash_hmac('sha256', $plainToken, $this->secret);
    }

    public function hashEmail(string $email): string
    {
        return hash_hmac('sha256', mb_strtolower(trim($email)), $this->secret);
    }
}
