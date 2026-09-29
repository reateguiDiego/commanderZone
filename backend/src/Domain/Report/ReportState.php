<?php

declare(strict_types=1);

namespace App\Domain\Report;

enum ReportState: string
{
    case COLLECTING_EVIDENCE = 'collecting_evidence';
    case PENDING_REVIEW = 'pending_review';
    case RESOLVED = 'resolved';
}
