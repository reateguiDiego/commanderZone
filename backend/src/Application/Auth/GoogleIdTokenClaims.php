<?php

namespace App\Application\Auth;

final readonly class GoogleIdTokenClaims
{
    public function __construct(
        public string $subject,
        public string $email,
        public bool $emailVerified,
        public ?string $name = null,
    ) {
    }
}
