<?php

declare(strict_types=1);

namespace App\Application\Moderation;

use App\Domain\Report\UserReport;
use App\Domain\User\Role;
use App\Domain\User\User;

/** Single source of truth for moderation visibility and target permissions. */
class ModerationPermissionPolicy
{
    public function canSubmitAgainst(User $actor, User $target): bool
    {
        return $actor->id() !== $target->id() && !$target->hasRole(Role::OWNER);
    }

    public function canReviewTarget(User $actor, User $target): bool
    {
        if ($target->hasRole(Role::OWNER)) {
            return false;
        }
        if ($target->hasRole(Role::ADMIN)) {
            return $actor->hasRole(Role::OWNER);
        }

        return $actor->hasRole(Role::ADMIN) || $actor->hasRole(Role::OWNER);
    }

    public function canReviewReport(User $actor, UserReport $report): bool
    {
        $target = $report->reportedUser();

        return $target instanceof User && $this->canReviewTarget($actor, $target);
    }

    public function canAccessModeration(User $actor): bool
    {
        return $actor->hasRole(Role::ADMIN) || $actor->hasRole(Role::OWNER);
    }
}
