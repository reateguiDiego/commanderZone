<?php

declare(strict_types=1);

namespace App\Domain\Report;

/**
 * Closed set intentionally limited to conduct/content moderation. It is not a
 * rules-engine dispute taxonomy.
 */
enum ReportCategory: string
{
    case HARASSMENT = 'harassment';
    case DISCRIMINATION_OR_UNWANTED_SEXUAL_CONTENT = 'discrimination_or_unwanted_sexual_content';
    case THREAT_OR_SAFETY_RISK = 'threats_or_safety';
    case PERSONAL_DATA_EXPOSURE = 'personal_data_exposure';
    case SPAM_ADVERTISING_SCAM_OR_PHISHING = 'spam_advertising_scam_phishing';
    case IMPERSONATION = 'impersonation';
    case PUBLIC_OFFENSIVE_CONTENT = 'public_offensive_content';
    case INTENTIONAL_DISRUPTIVE_GAMEPLAY = 'intentional_game_disruption';
    case DELIBERATE_MANIPULATION_OR_SERIOUS_DECEPTION = 'serious_gameplay_deception';
    case OTHER_PROBLEM = 'other_problem';

    public function requiresComment(): bool
    {
        return $this === self::OTHER_PROBLEM;
    }

    public function requiresGameLog(): bool
    {
        return $this === self::INTENTIONAL_DISRUPTIVE_GAMEPLAY
            || $this === self::DELIBERATE_MANIPULATION_OR_SERIOUS_DECEPTION;
    }
}
