<?php

namespace App\Application\User;

use App\Domain\User\User;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Clock\ClockInterface;

final readonly class UserActivityRecorder
{
    public const REFRESH_SECONDS = 30;

    public function __construct(private EntityManagerInterface $entityManager, private ClockInterface $clock)
    {
    }

    public function record(User $user): bool
    {
        $now = $this->clock->now();
        $previous = $user->lastSeenAt();
        $cutoff = $now->modify('-'.self::REFRESH_SECONDS.' seconds');
        if ($previous !== null && $previous > $cutoff) {
            return false;
        }

        // Compare the value loaded by authentication: a concurrent refresh or
        // explicit offline action must not be overwritten by this stale request.
        $predicate = $previous === null ? 'last_seen_at IS NULL' : 'last_seen_at = :previous';
        $params = ['now' => $now, 'id' => $user->id()];
        $types = ['now' => Types::DATETIME_IMMUTABLE];
        if ($previous !== null) {
            $params['previous'] = $previous;
            $types['previous'] = Types::DATETIME_IMMUTABLE;
        }
        $updated = $this->entityManager->getConnection()->executeStatement(
            'UPDATE app_user SET last_seen_at = :now, updated_at = :now WHERE id = :id AND '.$predicate,
            $params,
            $types,
        );
        // Keep Doctrine's original data in sync, including a concurrent winner,
        // so a later controller flush cannot undo the targeted update.
        $this->entityManager->refresh($user);

        return $updated === 1;
    }
}
