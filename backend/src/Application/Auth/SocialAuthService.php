<?php

namespace App\Application\Auth;

use App\Domain\Auth\AuthIdentity;
use App\Domain\User\Role;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class SocialAuthService
{
    private const MIN_DISPLAY_NAME_LENGTH = 2;
    private const MAX_DISPLAY_NAME_LENGTH = 20;

    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        private readonly GoogleIdTokenVerifierInterface $googleIdTokenVerifier,
        private readonly UserPasswordHasherInterface $passwordHasher,
        private readonly SecurityAuditLogger $securityAuditLogger,
    ) {
    }

    public function authenticateWithGoogle(string $credential, ?string $clientIp): User
    {
        $claims = $this->googleIdTokenVerifier->verify($credential);
        if (!$claims->emailVerified) {
            throw new InvalidGoogleIdToken('Google email verification is required.');
        }

        $identity = $this->entityManager->getRepository(AuthIdentity::class)->findOneBy([
            'provider' => AuthIdentity::PROVIDER_GOOGLE,
            'providerUserId' => $claims->subject,
        ]);

        if ($identity instanceof AuthIdentity) {
            $identity->markUsed();
            $this->entityManager->flush();
            $user = $identity->user();
            $this->securityAuditLogger->log('auth.google_login.succeeded', $user->email(), $user->id(), $clientIp);

            return $user;
        }

        if ($this->emailExists($claims->email)) {
            $this->securityAuditLogger->log('auth.google_login.link_required', $claims->email, null, $clientIp);
            throw new SocialAuthEmailLinkRequired('This email is already registered. Log in with your password before linking Google.');
        }

        $user = new User($claims->email, $this->uniqueDisplayName($claims->name, $claims->email));
        $user->setPassword($this->passwordHasher->hashPassword($user, bin2hex(random_bytes(32))));
        $user->markEmailVerified();
        $user->grantRole($this->requiredRole(Role::USER));

        $identity = new AuthIdentity(
            $user,
            AuthIdentity::PROVIDER_GOOGLE,
            $claims->subject,
            $claims->email,
            $claims->emailVerified,
        );
        $identity->markUsed();

        $this->entityManager->persist($user);
        $this->entityManager->persist($identity);
        $this->entityManager->flush();

        $this->securityAuditLogger->log('auth.google_login.provisioned', $user->email(), $user->id(), $clientIp);

        return $user;
    }

    private function uniqueDisplayName(?string $providerName, string $email): string
    {
        $emailLocalPart = explode('@', $email)[0] ?? '';
        $base = $this->normalizeDisplayName($providerName ?: $emailLocalPart);
        if ($base === '') {
            $base = 'Player';
        }

        if (!$this->displayNameExists($base)) {
            return $base;
        }

        for ($suffix = 2; $suffix <= 999; ++$suffix) {
            $suffixText = ' '.$suffix;
            $candidate = mb_substr($base, 0, self::MAX_DISPLAY_NAME_LENGTH - mb_strlen($suffixText)).$suffixText;
            if (mb_strlen($candidate) >= self::MIN_DISPLAY_NAME_LENGTH && !$this->displayNameExists($candidate)) {
                return $candidate;
            }
        }

        return 'Player '.bin2hex(random_bytes(3));
    }

    private function normalizeDisplayName(string $displayName): string
    {
        $normalized = preg_replace('/[\x00-\x1F\x7F]+/u', '', trim($displayName));
        $normalized = preg_replace('/\s+/u', ' ', $normalized ?? '');
        $normalized = trim($normalized ?? '');
        if (mb_strlen($normalized) < self::MIN_DISPLAY_NAME_LENGTH) {
            return 'Player';
        }

        return mb_substr($normalized, 0, self::MAX_DISPLAY_NAME_LENGTH);
    }

    private function emailExists(string $email): bool
    {
        return $this->entityManager->getRepository(User::class)->createQueryBuilder('user')
            ->select('user.id')
            ->where('LOWER(user.email) = :email')
            ->setParameter('email', mb_strtolower(trim($email)))
            ->setMaxResults(1)
            ->getQuery()
            ->getOneOrNullResult() !== null;
    }

    private function displayNameExists(string $displayName): bool
    {
        return $this->entityManager->getRepository(User::class)->createQueryBuilder('user')
            ->select('user.id')
            ->where('LOWER(user.displayName) = :displayName')
            ->setParameter('displayName', mb_strtolower(trim($displayName)))
            ->setMaxResults(1)
            ->getQuery()
            ->getOneOrNullResult() !== null;
    }

    private function requiredRole(string $roleCode): Role
    {
        $role = $this->entityManager->getRepository(Role::class)->find($roleCode);
        if (!$role instanceof Role) {
            throw new \RuntimeException(sprintf('Required role "%s" is not configured.', $roleCode));
        }

        return $role;
    }
}
