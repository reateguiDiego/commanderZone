<?php

namespace App\Application\Game\Compact;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

final readonly class GameplayCompactRuntimeFlags
{
    public function __construct(
        #[Autowire('%gameplay_compact_runtime_enabled%')]
        private bool $enabled = false,
    ) {
    }

    public function enabled(): bool
    {
        return $this->enabled;
    }
}
