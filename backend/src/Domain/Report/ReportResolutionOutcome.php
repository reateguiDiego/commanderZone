<?php

declare(strict_types=1);

namespace App\Domain\Report;

enum ReportResolutionOutcome: string
{
    case STRIKE = 'strike';
    case NOTHING = 'nothing';
}
