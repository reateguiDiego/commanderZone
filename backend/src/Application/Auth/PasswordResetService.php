<?php

namespace App\Application\Auth;

use App\Domain\Auth\PasswordResetToken;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;

class PasswordResetService
{
    private const PASSWORD_RESET_TTL_SECONDS = 1800;

    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        private readonly AuthTokenService $tokenService,
    ) {
    }

    public function issueToken(User $user, ?string $requestIp, ?string $requestUserAgent): string
    {
        $now = new \DateTimeImmutable();
        $this->invalidateActiveTokensForUser($user, $now);

        $plainToken = $this->tokenService->generatePlainToken();
        $token = new PasswordResetToken(
            $user,
            $this->tokenService->hashToken($plainToken),
            $now->modify(sprintf('+%d seconds', self::PASSWORD_RESET_TTL_SECONDS)),
            $requestIp,
            $requestUserAgent,
        );

        $this->entityManager->persist($token);
        $this->entityManager->flush();

        return $plainToken;
    }

    public function consumeValidToken(string $plainToken): ?PasswordResetToken
    {
        $hash = $this->tokenService->hashToken($plainToken);
        $token = $this->entityManager->getRepository(PasswordResetToken::class)->findOneBy([
            'tokenHash' => $hash,
        ]);

        if (!$token instanceof PasswordResetToken) {
            return null;
        }

        if (!$token->isUsableAt(new \DateTimeImmutable())) {
            return null;
        }

        return $token;
    }

    private function invalidateActiveTokensForUser(User $user, \DateTimeImmutable $now): void
    {
        $tokens = $this->entityManager->getRepository(PasswordResetToken::class)
            ->createQueryBuilder('token')
            ->where('token.user = :user')
            ->andWhere('token.usedAt IS NULL')
            ->andWhere('token.expiresAt > :now')
            ->setParameter('user', $user)
            ->setParameter('now', $now)
            ->getQuery()
            ->getResult();

        foreach ($tokens as $token) {
            if ($token instanceof PasswordResetToken) {
                $token->markUsed($now);
            }
        }
    }
}
