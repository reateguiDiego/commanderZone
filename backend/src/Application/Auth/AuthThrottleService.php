<?php

namespace App\Application\Auth;

use App\Domain\Auth\AuthRequestThrottle;
use Doctrine\ORM\EntityManagerInterface;

class AuthThrottleService
{
    public function __construct(
        private readonly EntityManagerInterface $entityManager,
    ) {
    }

    public function isLimited(string $scope, string $identifier, int $maxHits, int $windowSeconds): bool
    {
        $normalizedIdentifier = trim($identifier);
        if ($normalizedIdentifier === '') {
            return false;
        }

        $entry = $this->entityManager->getRepository(AuthRequestThrottle::class)->findOneBy([
            'scope' => trim($scope),
            'identifier' => $normalizedIdentifier,
        ]);

        if (!$entry instanceof AuthRequestThrottle) {
            return false;
        }

        return $entry->exceedsLimit(new \DateTimeImmutable(), $windowSeconds, $maxHits);
    }

    public function consume(string $scope, string $identifier, int $windowSeconds): void
    {
        $normalizedIdentifier = trim($identifier);
        if ($normalizedIdentifier === '') {
            return;
        }

        $normalizedScope = trim($scope);
        $now = new \DateTimeImmutable();
        $entry = $this->entityManager->getRepository(AuthRequestThrottle::class)->findOneBy([
            'scope' => $normalizedScope,
            'identifier' => $normalizedIdentifier,
        ]);

        if (!$entry instanceof AuthRequestThrottle) {
            $entry = new AuthRequestThrottle($normalizedScope, $normalizedIdentifier, $now);
            $this->entityManager->persist($entry);
        }

        $entry->consume($now, $windowSeconds);
        $this->entityManager->flush();
    }
}
