<?php

namespace App\Application\Game;

final class InvalidTokenQuantityException extends \InvalidArgumentException
{
    public const CODE = 'INVALID_TOKEN_QUANTITY';
    public const MIN = 1;
    public const MAX = 20;

    public function __construct(?string $message = null)
    {
        parent::__construct($message ?? sprintf(
            '%s: quantity must be an integer between %d and %d.',
            self::CODE,
            self::MIN,
            self::MAX,
        ));
    }

    /**
     * @return array{code:string,min:int,max:int}
     */
    public function errorPayload(): array
    {
        return ['code' => self::CODE, 'min' => self::MIN, 'max' => self::MAX];
    }
}
