<?php

namespace App\Application\Game\Runtime;

enum GameplayRuntimeRoute: string
{
    case RuntimePrimary = 'runtime_primary';
    case Shadow = 'shadow';
    case LegacyOnly = 'legacy_only';
}
