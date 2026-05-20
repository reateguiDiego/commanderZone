<?php

namespace App\Application\Auth;

use App\Domain\User\User;

final class RefreshSessionRotation
{
    public function __construct(
        public readonly User $user,
        public readonly string $refreshToken,
    ) {
    }
}
