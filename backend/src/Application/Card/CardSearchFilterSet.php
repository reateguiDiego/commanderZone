<?php

namespace App\Application\Card;

final readonly class CardSearchFilterSet
{
    /**
     * @param list<string> $filters
     * @param array<string,mixed> $params
     * @param array<string,mixed> $types
     * @param list<string> $formats
     */
    public function __construct(
        public array $filters,
        public array $params,
        public array $types,
        public array $formats = [],
    ) {
    }
}
