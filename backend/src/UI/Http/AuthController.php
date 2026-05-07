<?php

namespace App\UI\Http;

use App\Domain\User\User;
use App\Infrastructure\Realtime\FriendEventPublisher;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class AuthController extends ApiController
{
    private const MIN_DISPLAY_NAME_LENGTH = 4;

    #[Route('/auth/email-availability', methods: ['GET'])]
    public function emailAvailability(Request $request, EntityManagerInterface $entityManager): JsonResponse
    {
        $email = trim((string) $request->query->get('email', ''));

        return $this->json([
            'available' => filter_var($email, FILTER_VALIDATE_EMAIL) !== false && !$this->emailExists($entityManager, $email),
        ]);
    }

    #[Route('/auth/display-name-availability', methods: ['GET'])]
    public function displayNameAvailability(Request $request, EntityManagerInterface $entityManager): JsonResponse
    {
        $displayName = trim((string) $request->query->get('displayName', ''));

        return $this->json([
            'available' => $this->isDisplayNameValid($displayName) && !$this->displayNameExists($entityManager, $displayName),
        ]);
    }

    #[Route('/auth/register', methods: ['POST'])]
    public function register(Request $request, EntityManagerInterface $entityManager, UserPasswordHasherInterface $passwordHasher): JsonResponse
    {
        $payload = $this->payload($request);
        $email = trim((string) ($payload['email'] ?? ''));
        $password = (string) ($payload['password'] ?? '');
        $displayName = trim((string) ($payload['displayName'] ?? ''));

        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($password) < 8 || !$this->isDisplayNameValid($displayName)) {
            return $this->fail('email, user name of at least 4 chars and a password of at least 8 chars are required.');
        }

        if ($this->emailExists($entityManager, $email)) {
            return $this->fail('Email is already registered.', 409);
        }

        if ($this->displayNameExists($entityManager, $displayName)) {
            return $this->fail('User name is already taken.', 409);
        }

        $user = new User($email, $displayName);
        $user->setPassword($passwordHasher->hashPassword($user, $password));
        $entityManager->persist($user);
        $entityManager->flush();

        return $this->json(['user' => $user->toArray()], 201);
    }

    #[Route('/auth/login', methods: ['POST'])]
    public function login(): JsonResponse
    {
        throw new \LogicException('This endpoint is handled by the security firewall.');
    }

    #[Route('/me', methods: ['GET'])]
    public function me(#[CurrentUser] ?User $user): JsonResponse
    {
        if (!$user) {
            return $this->fail('Authentication required.', 401);
        }

        return $this->json(['user' => $user->toArray()]);
    }

    #[Route('/me', methods: ['PATCH'])]
    public function updateMe(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $payload = $this->payload($request);
        $displayName = trim((string) ($payload['displayName'] ?? ''));
        if (!$this->isDisplayNameValid($displayName)) {
            return $this->fail('User name must contain at least 4 chars.');
        }

        if ($this->displayNameExists($entityManager, $displayName, $user)) {
            return $this->fail('User name is already taken.', 409);
        }

        $user->rename($displayName);
        $entityManager->flush();

        return $this->json(['user' => $user->toArray()]);
    }

    private function isDisplayNameValid(string $displayName): bool
    {
        return mb_strlen(trim($displayName)) >= self::MIN_DISPLAY_NAME_LENGTH;
    }

    private function emailExists(EntityManagerInterface $entityManager, string $email): bool
    {
        return $entityManager->getRepository(User::class)->findOneBy(['email' => mb_strtolower(trim($email))]) !== null;
    }

    private function displayNameExists(EntityManagerInterface $entityManager, string $displayName, ?User $ignoredUser = null): bool
    {
        $queryBuilder = $entityManager->getRepository(User::class)->createQueryBuilder('user')
            ->select('user.id')
            ->where('LOWER(user.displayName) = :displayName')
            ->setParameter('displayName', mb_strtolower(trim($displayName)))
            ->setMaxResults(1);

        if ($ignoredUser !== null) {
            $queryBuilder
                ->andWhere('user.id != :ignoredUserId')
                ->setParameter('ignoredUserId', $ignoredUser->id());
        }

        return $queryBuilder->getQuery()->getOneOrNullResult() !== null;
    }

    #[Route('/me/password', methods: ['PATCH'])]
    public function updatePassword(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, UserPasswordHasherInterface $passwordHasher): JsonResponse
    {
        $payload = $this->payload($request);
        $currentPassword = (string) ($payload['currentPassword'] ?? '');
        $newPassword = (string) ($payload['newPassword'] ?? '');

        if (mb_strlen($newPassword) < 8) {
            return $this->fail('newPassword must contain at least 8 chars.');
        }
        if (!$passwordHasher->isPasswordValid($user, $currentPassword)) {
            return $this->fail('Current password is invalid.', 403);
        }

        $user->setPassword($passwordHasher->hashPassword($user, $newPassword));
        $entityManager->flush();

        return $this->json(['user' => $user->toArray()]);
    }

    #[Route('/me/offline', methods: ['POST'])]
    public function offline(#[CurrentUser] User $user, EntityManagerInterface $entityManager, FriendEventPublisher $friendEventPublisher): JsonResponse
    {
        $user->markOffline();
        $entityManager->flush();
        $friendEventPublisher->publishPresenceChanged($user);

        return $this->json(null, 204);
    }
}
