<?php

namespace App\Application\Game;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

final readonly class GameplayRuntimeLimits
{
    public function __construct(
        #[Autowire('%gameplay_max_token_create_quantity%')]
        private int $maxTokenCreateQuantity = 20,
    ) {
    }

    public function maxTokenCreateQuantity(): int
    {
        return max(1, $this->maxTokenCreateQuantity);
    }
}
