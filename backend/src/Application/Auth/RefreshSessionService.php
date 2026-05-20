<?php

namespace App\Application\Auth;

use App\Domain\Auth\RefreshSession;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

class RefreshSessionService
{
    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        private readonly AuthTokenService $tokenService,
        #[Autowire('%env(int:AUTH_REFRESH_TOKEN_TTL)%')]
        private readonly int $refreshTokenTtlSeconds,
    ) {
    }

    public function issueSession(User $user, ?string $requestIp, ?string $requestUserAgent): string
    {
        $plainToken = $this->tokenService->generatePlainToken();
        $now = new \DateTimeImmutable();

        $session = new RefreshSession(
            $user,
            $this->tokenService->hashToken($plainToken),
            $now->modify(sprintf('+%d seconds', $this->refreshTokenTtlSeconds)),
            $requestIp,
            $requestUserAgent,
        );

        $this->entityManager->persist($session);
        $this->entityManager->flush();

        return $plainToken;
    }

    public function rotateSession(string $plainToken, ?string $requestIp, ?string $requestUserAgent): ?RefreshSessionRotation
    {
        $hash = $this->tokenService->hashToken($plainToken);
        $session = $this->entityManager->getRepository(RefreshSession::class)->findOneBy([
            'tokenHash' => $hash,
        ]);

        if (!$session instanceof RefreshSession) {
            return null;
        }

        $now = new \DateTimeImmutable();
        if (!$session->isActiveAt($now)) {
            if ($session->isReplayCandidateAt($now)) {
                $this->revokeAllActiveSessionsForUser($session->user(), $now);
                throw new RefreshSessionReplayDetected('Refresh token replay detected.');
            }

            return null;
        }

        $nextPlainToken = $this->tokenService->generatePlainToken();
        $nextHash = $this->tokenService->hashToken($nextPlainToken);
        $session->markRotated($nextHash, $now);

        $nextSession = new RefreshSession(
            $session->user(),
            $nextHash,
            $now->modify(sprintf('+%d seconds', $this->refreshTokenTtlSeconds)),
            $requestIp,
            $requestUserAgent,
        );
        $nextSession->markUsed($now);

        $this->entityManager->persist($nextSession);
        $this->entityManager->flush();

        return new RefreshSessionRotation($session->user(), $nextPlainToken);
    }

    public function revokeSession(string $plainToken): void
    {
        $hash = $this->tokenService->hashToken($plainToken);
        $session = $this->entityManager->getRepository(RefreshSession::class)->findOneBy([
            'tokenHash' => $hash,
        ]);

        if (!$session instanceof RefreshSession) {
            return;
        }

        if ($session->isActiveAt(new \DateTimeImmutable())) {
            $session->revoke();
            $this->entityManager->flush();
        }
    }

    public function revokeAllActiveSessionsForUser(User $user, ?\DateTimeImmutable $now = null): void
    {
        $effectiveNow = $now ?? new \DateTimeImmutable();
        $sessions = $this->entityManager->getRepository(RefreshSession::class)
            ->createQueryBuilder('session')
            ->where('session.user = :user')
            ->andWhere('session.revokedAt IS NULL')
            ->andWhere('session.rotatedAt IS NULL')
            ->andWhere('session.expiresAt > :now')
            ->setParameter('user', $user)
            ->setParameter('now', $effectiveNow)
            ->getQuery()
            ->getResult();

        foreach ($sessions as $session) {
            if ($session instanceof RefreshSession) {
                $session->revoke($effectiveNow);
            }
        }

        $this->entityManager->flush();
    }
}
