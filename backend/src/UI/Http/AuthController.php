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
    private const MAX_DISPLAY_NAME_LENGTH = 25;

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
            return $this->fail('email, user name with 4-25 chars and a password of at least 8 chars are required.');
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

    #[Route('/auth/password-reset/request', methods: ['POST'])]
    public function requestPasswordReset(Request $request, EntityManagerInterface $entityManager): JsonResponse
    {
        $payload = $this->payload($request);
        $email = trim((string) ($payload['email'] ?? ''));

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return $this->json(['accepted' => true], 202);
        }

        return $this->json(['accepted' => true], 202);
    }

    #[Route('/auth/password-reset/confirm', methods: ['POST'])]
    public function confirmPasswordReset(
        Request $request,
        EntityManagerInterface $entityManager,
        UserPasswordHasherInterface $passwordHasher
    ): JsonResponse {
        $payload = $this->payload($request);
        $email = trim((string) ($payload['email'] ?? ''));
        $newPassword = (string) ($payload['newPassword'] ?? '');

        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($newPassword) < 8) {
            return $this->fail('email and a newPassword of at least 8 chars are required.');
        }

        $user = $entityManager->getRepository(User::class)->findOneBy(['email' => mb_strtolower($email)]);
        if (!$user instanceof User) {
            return $this->fail('User was not found.');
        }

        $user->setPassword($passwordHasher->hashPassword($user, $newPassword));
        $entityManager->flush();

        return $this->json(['updated' => true]);
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

        $hasDisplayNameUpdate = array_key_exists('displayName', $payload);
        $hasEmailUpdate = array_key_exists('email', $payload);
        if (!$hasDisplayNameUpdate && !$hasEmailUpdate) {
            return $this->fail('At least one profile field must be provided.');
        }

        if ($hasDisplayNameUpdate) {
            $displayName = trim((string) $payload['displayName']);
            if (!$this->isDisplayNameValid($displayName)) {
                return $this->fail('User name must contain 4-25 chars.');
            }

            if (
                mb_strtolower($displayName) !== mb_strtolower($user->displayName())
                && $this->displayNameExists($entityManager, $displayName, $user)
            ) {
                return $this->fail('User name is already taken.', 409);
            }

            $user->rename($displayName);
        }

        if ($hasEmailUpdate) {
            $email = trim((string) $payload['email']);
            if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
                return $this->fail('A valid email is required.');
            }

            if (
                mb_strtolower($email) !== mb_strtolower($user->email())
                && $this->emailExists($entityManager, $email, $user)
            ) {
                return $this->fail('Email is already registered.', 409);
            }

            $user->changeEmail($email);
        }

        $entityManager->flush();

        return $this->json(['user' => $user->toArray()]);
    }

    #[Route('/me', methods: ['DELETE'])]
    public function deleteMe(
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        UserPasswordHasherInterface $passwordHasher
    ): JsonResponse {
        $user->rename(sprintf('Deleted-%s', mb_substr($user->id(), 0, 8)));
        $user->changeEmail(sprintf('deleted+%s@commanderzone.local', $user->id()));
        $user->setPassword($passwordHasher->hashPassword($user, sprintf('deleted-password-%s', $user->id())));
        $user->markOffline();

        $entityManager->flush();

        return $this->json(null, 204);
    }

    private function isDisplayNameValid(string $displayName): bool
    {
        $length = mb_strlen(trim($displayName));

        return $length >= self::MIN_DISPLAY_NAME_LENGTH && $length <= self::MAX_DISPLAY_NAME_LENGTH;
    }

    private function emailExists(EntityManagerInterface $entityManager, string $email, ?User $ignoredUser = null): bool
    {
        $queryBuilder = $entityManager->getRepository(User::class)->createQueryBuilder('user')
            ->select('user.id')
            ->where('LOWER(user.email) = :email')
            ->setParameter('email', mb_strtolower(trim($email)))
            ->setMaxResults(1);

        if ($ignoredUser !== null) {
            $queryBuilder
                ->andWhere('user.id != :ignoredUserId')
                ->setParameter('ignoredUserId', $ignoredUser->id());
        }

        return $queryBuilder->getQuery()->getOneOrNullResult() !== null;
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
