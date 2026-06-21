<?php

namespace App\Application\Game\Contract\V2;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

final readonly class GameplayV2Flags
{
    public function __construct(
        #[Autowire('%gameplay_v2_command_enabled%')]
        private bool $commandEnabled = false,
        #[Autowire('%gameplay_v2_patch_enabled%')]
        private bool $patchEnabled = false,
        #[Autowire('%gameplay_v2_bootstrap_enabled%')]
        private bool $bootstrapEnabled = false,
        #[Autowire('%gameplay_v2_event_enabled%')]
        private bool $eventEnabled = false,
        #[Autowire('%gameplay_v2_visibility_enabled%')]
        private bool $visibilityEnabled = false,
    ) {
    }

    public function commandEnabled(): bool
    {
        return $this->commandEnabled;
    }

    public function patchEnabled(): bool
    {
        return $this->patchEnabled;
    }

    public function bootstrapEnabled(): bool
    {
        return $this->bootstrapEnabled;
    }

    public function eventEnabled(): bool
    {
        return $this->eventEnabled;
    }

    public function visibilityEnabled(): bool
    {
        return $this->visibilityEnabled;
    }
}
