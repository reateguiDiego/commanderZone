<?php

namespace App\UI\Http;

use App\Domain\User\User;
use App\Infrastructure\Realtime\FriendEventPublisher;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class AuthController extends ApiController
{
    private const MIN_DISPLAY_NAME_LENGTH = 4;
    private const MAX_DISPLAY_NAME_LENGTH = 25;
    private const MAX_AVATAR_IMAGE_BYTES = 2_097_152;
    private const MAX_INITIAL_AVATAR_LETTERS = 2;
    private const DEFAULT_INITIAL_AVATAR_BACKGROUND = '#edcd83';
    private const DEFAULT_INITIAL_AVATAR_TEXT = '#16120a';
    private const ALLOWED_AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
    private const PRESET_AVATARS = [
        'assets/images/avatars/arcane-duelist.png',
        'assets/images/avatars/storm-seer.png',
        'assets/images/avatars/verdant-warden.png',
        'assets/images/avatars/rune-knight.png',
        'assets/images/avatars/ember-marshal.png',
        'assets/images/avatars/moonlit-necromancer.png',
        'assets/images/avatars/black-clad-mage.png',
        'assets/images/avatars/friendly-robot.png',
        'assets/images/avatars/ironroot-boar.png',
        'assets/images/avatars/elderwood-ent.png',
        'assets/images/avatars/shadow-necromancer.png',
        'assets/images/avatars/serpent-assassin.png',
        'assets/images/avatars/wandering-blade.png',
        'assets/images/avatars/abyssal-overlord.png',
        'assets/images/avatars/radiant-paladin.png',
        'assets/images/avatars/porcelain-priestess.png',
        'assets/images/avatars/chaos-court-mage.png',
        'assets/images/avatars/rootbound-dryad.png',
        'assets/images/avatars/leonine-champion.png',
        'assets/images/avatars/spectral-dragon-sage.png',
        'assets/images/avatars/emerald-prophet.png',
        'assets/images/avatars/temporal-scholar.png',
        'assets/images/avatars/mind-illusionist.png',
        'assets/images/avatars/dragonblood-shaman.png',
        'assets/images/avatars/wild-beastmaster.png',
        'assets/images/avatars/tidecaller-oracle.png',
        'assets/images/avatars/nightblade-agent.png',
        'assets/images/avatars/elder-dragon-tyrant.png',
        'assets/images/avatars/moonlit-vampire.png',
        'assets/images/avatars/crimson-patriarch.png',
        'assets/images/avatars/golden-lawkeeper.png',
        'assets/images/avatars/sky-law-artificer.png',
        'assets/images/avatars/sunlit-archon.png',
        'assets/images/avatars/living-metal-sage.png',
        'assets/images/avatars/volcanic-forger.png',
        'assets/images/avatars/nightmare-oracle.png',
        'assets/images/avatars/hawk-wildwarden.png',
        'assets/images/avatars/infernal-noble.png',
        'assets/images/avatars/moonstone-seer.png',
        'assets/images/avatars/obsidian-geomancer.png',
    ];

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

    #[Route('/me/avatar', methods: ['PATCH'])]
    public function updateAvatar(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $payload = $this->payload($request);
        $type = (string) ($payload['type'] ?? '');

        if ($type === 'initial') {
            $letter = $this->avatarInitialLetter((string) ($payload['letter'] ?? ''), $user->displayName());
            $backgroundColor = $this->avatarHexColor((string) ($payload['backgroundColor'] ?? ''), self::DEFAULT_INITIAL_AVATAR_BACKGROUND);
            $textColor = $this->avatarHexColor((string) ($payload['textColor'] ?? ''), self::DEFAULT_INITIAL_AVATAR_TEXT);

            $user->useInitialAvatar($letter, $backgroundColor, $textColor);
        } elseif ($type === 'preset') {
            $imageUrl = (string) ($payload['imageUrl'] ?? '');
            if (!in_array($imageUrl, self::PRESET_AVATARS, true)) {
                return $this->fail('Selected avatar is not available.');
            }

            $user->selectPresetAvatar($imageUrl);
        } elseif ($type === 'upload') {
            $imageData = (string) ($payload['imageData'] ?? '');
            if (!$this->isValidAvatarImageData($imageData)) {
                return $this->fail('Avatar image must be a PNG, JPG or WEBP image up to 2MB.');
            }

            $user->uploadAvatarImage($imageData);
        } else {
            return $this->fail('Avatar type must be initial, preset or upload.');
        }

        $entityManager->flush();

        return $this->json(['user' => $user->toArray()]);
    }

    #[Route('/users/{id}/avatar', methods: ['GET'])]
    public function avatarImage(string $id, EntityManagerInterface $entityManager): Response
    {
        $user = $entityManager->getRepository(User::class)->find($id);
        if (!$user instanceof User || $user->avatar()['type'] !== 'upload') {
            return new Response('', 404);
        }

        $imageData = $user->avatarImageData();
        if (!is_string($imageData) || !preg_match('/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+\/=]+)$/', $imageData, $matches)) {
            return new Response('', 404);
        }

        $decoded = base64_decode($matches[2], true);
        if (!is_string($decoded)) {
            return new Response('', 404);
        }

        return new Response($decoded, 200, [
            'Content-Type' => $matches[1],
            'Cache-Control' => 'public, max-age=3600',
        ]);
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
        $user->useInitialAvatar();

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

    private function isValidAvatarImageData(string $imageData): bool
    {
        if (!preg_match('/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+\/=]+)$/', $imageData, $matches)) {
            return false;
        }

        if (!in_array($matches[1], self::ALLOWED_AVATAR_MIME_TYPES, true)) {
            return false;
        }

        $decoded = base64_decode($matches[2], true);

        return is_string($decoded) && strlen($decoded) <= self::MAX_AVATAR_IMAGE_BYTES;
    }

    private function avatarInitialLetter(string $letter, string $displayName): string
    {
        $normalizedLetter = mb_strtoupper(mb_substr(trim($letter), 0, self::MAX_INITIAL_AVATAR_LETTERS));
        if ($normalizedLetter !== '') {
            return $normalizedLetter;
        }

        $displayNameInitial = mb_strtoupper(mb_substr(trim($displayName), 0, 1));

        return $displayNameInitial !== '' ? $displayNameInitial : 'P';
    }

    private function avatarHexColor(string $color, string $fallback): string
    {
        return preg_match('/^#[0-9a-fA-F]{6}$/', $color) ? $color : $fallback;
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
