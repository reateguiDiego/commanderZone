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

        $entry = $this->findEntry(trim($scope), $normalizedIdentifier);

        if (!$entry instanceof AuthRequestThrottle) {
            return false;
        }

        return $entry->exceedsLimit(new \DateTimeImmutable(), $windowSeconds, $maxHits);
    }

    /**
     * @return array{limited: bool, retryAfterSeconds: int}
     */
    public function limitStatus(string $scope, string $identifier, int $maxHits, int $windowSeconds): array
    {
        $normalizedIdentifier = trim($identifier);
        if ($normalizedIdentifier === '') {
            return ['limited' => false, 'retryAfterSeconds' => 0];
        }

        $entry = $this->findEntry(trim($scope), $normalizedIdentifier);
        if (!$entry instanceof AuthRequestThrottle) {
            return ['limited' => false, 'retryAfterSeconds' => 0];
        }

        $now = new \DateTimeImmutable();

        return [
            'limited' => $entry->exceedsLimit($now, $windowSeconds, $maxHits),
            'retryAfterSeconds' => $entry->remainingWindowSeconds($now, $windowSeconds),
        ];
    }

    public function consume(string $scope, string $identifier, int $windowSeconds): void
    {
        $normalizedIdentifier = trim($identifier);
        if ($normalizedIdentifier === '') {
            return;
        }

        $normalizedScope = trim($scope);
        $now = new \DateTimeImmutable();
        $entry = $this->findEntry($normalizedScope, $normalizedIdentifier);

        if (!$entry instanceof AuthRequestThrottle) {
            $entry = new AuthRequestThrottle($normalizedScope, $normalizedIdentifier, $now);
            $this->entityManager->persist($entry);
        }

        $entry->consume($now, $windowSeconds);
        $this->entityManager->flush();
    }

    private function findEntry(string $scope, string $identifier): ?AuthRequestThrottle
    {
        return $this->entityManager->getRepository(AuthRequestThrottle::class)->findOneBy([
            'scope' => $scope,
            'identifier' => $identifier,
        ]);
    }
}
