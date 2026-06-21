<?php

namespace App\Application\Game;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

final readonly class GameplayStreamsFlags
{
    public function __construct(
        #[Autowire('%gameplay_streams_enabled%')]
        private bool $enabled = false,
    ) {
    }

    public function enabled(): bool
    {
        return $this->enabled;
    }
}
