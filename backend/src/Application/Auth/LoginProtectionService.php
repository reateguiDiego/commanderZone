<?php

namespace App\Application\Auth;

use App\Domain\Auth\LoginAttempt;
use Doctrine\ORM\EntityManagerInterface;

class LoginProtectionService
{
    public function __construct(
        private readonly EntityManagerInterface $entityManager,
    ) {
    }

    public function isLocked(?string $email, ?string $ip): bool
    {
        $now = new \DateTimeImmutable();

        foreach ($this->identifiers($email, $ip) as [$scope, $identifier]) {
            $attempt = $this->entityManager->getRepository(LoginAttempt::class)->findOneBy([
                'scope' => $scope,
                'identifier' => $identifier,
            ]);

            if ($attempt instanceof LoginAttempt && $attempt->isLockedAt($now)) {
                return true;
            }
        }

        return false;
    }

    public function recordFailure(?string $email, ?string $ip): void
    {
        $now = new \DateTimeImmutable();

        foreach ($this->identifiers($email, $ip) as [$scope, $identifier]) {
            $attempt = $this->entityManager->getRepository(LoginAttempt::class)->findOneBy([
                'scope' => $scope,
                'identifier' => $identifier,
            ]);

            if (!$attempt instanceof LoginAttempt) {
                $attempt = new LoginAttempt($scope, $identifier);
                $this->entityManager->persist($attempt);
            }

            $attempt->registerFailure($now);
        }

        $this->entityManager->flush();
    }

    public function resetFailures(?string $email, ?string $ip): void
    {
        $changed = false;

        foreach ($this->identifiers($email, $ip) as [$scope, $identifier]) {
            $attempt = $this->entityManager->getRepository(LoginAttempt::class)->findOneBy([
                'scope' => $scope,
                'identifier' => $identifier,
            ]);

            if (!$attempt instanceof LoginAttempt) {
                continue;
            }

            $attempt->resetFailures();
            $changed = true;
        }

        if ($changed) {
            $this->entityManager->flush();
        }
    }

    /**
     * @return list<array{0:string,1:string}>
     */
    private function identifiers(?string $email, ?string $ip): array
    {
        $identifiers = [];
        $normalizedEmail = mb_strtolower(trim((string) $email));
        if ($normalizedEmail !== '') {
            $identifiers[] = ['email', $normalizedEmail];
        }

        $normalizedIp = trim((string) $ip);
        if ($normalizedIp !== '') {
            $identifiers[] = ['ip', $normalizedIp];
        }

        return $identifiers;
    }
}
