<?php

namespace App\Application\Auth;

use App\Domain\Auth\EmailVerificationToken;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;

class EmailVerificationService
{
    private const EMAIL_VERIFICATION_TTL_SECONDS = 86400;

    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        private readonly AuthTokenService $tokenService,
    ) {
    }

    public function issueRegisterVerification(User $user, ?string $requestIp, ?string $requestUserAgent): string
    {
        return $this->issueToken(
            $user,
            $user->email(),
            EmailVerificationToken::PURPOSE_REGISTER,
            $requestIp,
            $requestUserAgent,
        );
    }

    public function issueEmailChangeVerification(User $user, string $targetEmail, ?string $requestIp, ?string $requestUserAgent): string
    {
        return $this->issueToken(
            $user,
            $targetEmail,
            EmailVerificationToken::PURPOSE_EMAIL_CHANGE,
            $requestIp,
            $requestUserAgent,
        );
    }

    public function consumeValidToken(string $plainToken): ?EmailVerificationToken
    {
        $hash = $this->tokenService->hashToken($plainToken);
        $token = $this->entityManager->getRepository(EmailVerificationToken::class)->findOneBy([
            'tokenHash' => $hash,
        ]);

        if (!$token instanceof EmailVerificationToken) {
            return null;
        }

        if (!$token->isUsableAt(new \DateTimeImmutable())) {
            return null;
        }

        return $token;
    }

    private function issueToken(
        User $user,
        string $targetEmail,
        string $purpose,
        ?string $requestIp,
        ?string $requestUserAgent,
    ): string {
        $now = new \DateTimeImmutable();
        $this->invalidateActiveTokens($user, $purpose, $now);

        $plainToken = $this->tokenService->generatePlainToken();
        $token = new EmailVerificationToken(
            $user,
            $this->tokenService->hashToken($plainToken),
            $targetEmail,
            $purpose,
            $now->modify(sprintf('+%d seconds', self::EMAIL_VERIFICATION_TTL_SECONDS)),
            $requestIp,
            $requestUserAgent,
        );

        $this->entityManager->persist($token);
        $this->entityManager->flush();

        return $plainToken;
    }

    private function invalidateActiveTokens(User $user, string $purpose, \DateTimeImmutable $now): void
    {
        $tokens = $this->entityManager->getRepository(EmailVerificationToken::class)
            ->createQueryBuilder('token')
            ->where('token.user = :user')
            ->andWhere('token.purpose = :purpose')
            ->andWhere('token.usedAt IS NULL')
            ->andWhere('token.expiresAt > :now')
            ->setParameter('user', $user)
            ->setParameter('purpose', $purpose)
            ->setParameter('now', $now)
            ->getQuery()
            ->getResult();

        foreach ($tokens as $token) {
            if ($token instanceof EmailVerificationToken) {
                $token->markUsed($now);
            }
        }
    }
}
