<?php

namespace App\Application\Auth;

class PasswordPolicy
{
    public function isValid(string $password): bool
    {
        if (mb_strlen($password) < 8) {
            return false;
        }

        return preg_match('/[a-z]/', $password) === 1
            && preg_match('/[A-Z]/', $password) === 1
            && preg_match('/\d/', $password) === 1
            && preg_match('/[^A-Za-z0-9]/', $password) === 1;
    }

    public function requirementMessage(string $fieldName = 'Password'): string
    {
        return sprintf(
            '%s must be at least 8 chars and include at least one lowercase letter, one uppercase letter, one number, and one special character.',
            $fieldName
        );
    }
}
