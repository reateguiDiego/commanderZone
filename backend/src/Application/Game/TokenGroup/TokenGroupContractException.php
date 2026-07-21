<?php

namespace App\Application\Game\TokenGroup;

final class TokenGroupContractException extends \RuntimeException
{
    /**
     * @param array<string,int|string> $safeContext
     */
    public function __construct(
        private readonly string $errorCode,
        private readonly array $safeContext = [],
    ) {
        parent::__construct($errorCode);
    }

    public function errorCode(): string
    {
        return $this->errorCode;
    }

    /** @return array<string,int|string> */
    public function safeContext(): array
    {
        return $this->safeContext;
    }

    /** @return array<string,int|string> */
    public function errorPayload(): array
    {
        return ['code' => $this->errorCode, ...$this->safeContext];
    }
}
