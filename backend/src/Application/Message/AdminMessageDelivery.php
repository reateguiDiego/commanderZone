<?php

namespace App\Application\Message;

enum AdminMessageDelivery: string
{
    case Internal = 'internal';
    case Email = 'email';
    case Both = 'both';

    public function sendsInternalMessage(): bool
    {
        return $this === self::Internal || $this === self::Both;
    }

    public function sendsEmail(): bool
    {
        return $this === self::Email || $this === self::Both;
    }
}
