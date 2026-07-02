<?php

namespace App\Application\Auth;

interface GoogleIdTokenVerifierInterface
{
    public function verify(string $idToken): GoogleIdTokenClaims;
}
