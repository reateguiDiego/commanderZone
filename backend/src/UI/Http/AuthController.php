<?php

namespace App\UI\Http;

use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class AuthController extends ApiController
{
    #[Route('/auth/register', methods: ['POST'])]
    public function register(Request $request, EntityManagerInterface $entityManager, UserPasswordHasherInterface $passwordHasher): JsonResponse
    {
        $payload = $this->payload($request);
        $email = trim((string) ($payload['email'] ?? ''));
        $password = (string) ($payload['password'] ?? '');
        $displayName = trim((string) ($payload['displayName'] ?? ''));

        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($password) < 8 || $displayName === '') {
            return $this->fail('email, displayName and a password of at least 8 chars are required.');
        }

        if ($entityManager->getRepository(User::class)->findOneBy(['email' => mb_strtolower($email)]) !== null) {
            return $this->fail('Email is already registered.', 409);
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
        if ($displayName === '') {
            return $this->fail('displayName is required.');
        }

        $user->rename($displayName);
        $entityManager->flush();

        return $this->json(['user' => $user->toArray()]);
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
}
