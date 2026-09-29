<?php

declare(strict_types=1);

namespace App\Domain\Report;

enum GameModerationEvidenceStatus: string
{
    case CAPTURING = 'capturing';
    case COMPLETE = 'complete';
    case FAILED = 'failed';
}
