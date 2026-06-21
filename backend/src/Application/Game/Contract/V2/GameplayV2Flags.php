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
        #[Autowire('%gameplay_v2_enabled%')]
        private bool $enabled = true,
        #[Autowire('%gameplay_v2_commands_allowlist%')]
        private string $commandsAllowlist = '',
        #[Autowire('%runtime_service_enabled%')]
        private bool $runtimeServiceEnabled = false,
        #[Autowire('%semantic_patches_enabled%')]
        private bool $semanticPatchesEnabled = true,
        #[Autowire('%compact_bootstrap_enabled%')]
        private bool $compactBootstrapEnabled = true,
        #[Autowire('%shadow_compare_enabled%')]
        private bool $shadowCompareEnabled = false,
    ) {
    }

    public function enabled(): bool
    {
        return $this->enabled;
    }

    public function commandEnabled(): bool
    {
        return $this->enabled && $this->commandEnabled;
    }

    public function patchEnabled(): bool
    {
        return $this->enabled && $this->patchEnabled && $this->semanticPatchesEnabled;
    }

    public function bootstrapEnabled(): bool
    {
        return $this->enabled && $this->bootstrapEnabled && $this->compactBootstrapEnabled;
    }

    public function eventEnabled(): bool
    {
        return $this->enabled && $this->eventEnabled;
    }

    public function visibilityEnabled(): bool
    {
        return $this->enabled && $this->visibilityEnabled;
    }

    public function runtimeServiceEnabled(): bool
    {
        return $this->enabled && $this->runtimeServiceEnabled;
    }

    public function semanticPatchesEnabled(): bool
    {
        return $this->enabled && $this->semanticPatchesEnabled;
    }

    public function compactBootstrapEnabled(): bool
    {
        return $this->enabled && $this->compactBootstrapEnabled;
    }

    public function shadowCompareEnabled(): bool
    {
        return $this->enabled && $this->shadowCompareEnabled;
    }

    public function commandAllowed(string $type): bool
    {
        $allowlist = $this->commandsAllowlist();
        if ($allowlist === []) {
            return true;
        }

        return in_array($type, $allowlist, true);
    }

    /**
     * @return list<string>
     */
    public function commandsAllowlist(): array
    {
        $items = array_filter(
            array_map('trim', explode(',', $this->commandsAllowlist)),
            static fn (string $item): bool => $item !== '',
        );

        return array_values(array_unique($items));
    }
}
