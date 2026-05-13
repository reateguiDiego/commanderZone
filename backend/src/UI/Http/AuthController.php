<?php

namespace App\UI\Http;

use App\Application\Auth\AuthThrottleService;
use App\Application\Auth\AuthMailer;
use App\Application\Auth\EmailVerificationService;
use App\Application\Auth\LoginProtectionService;
use App\Application\Auth\PasswordPolicy;
use App\Application\Auth\PasswordResetService;
use App\Application\Auth\SecurityAuditLogger;
use App\Domain\Auth\EmailVerificationToken;
use App\Domain\User\User;
use App\Infrastructure\Realtime\FriendEventPublisher;
use Doctrine\ORM\EntityManagerInterface;
use Lexik\Bundle\JWTAuthenticationBundle\Services\JWTTokenManagerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
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
    private const BASIC_DISPLAY_NAME_STYLES = [
        'plain',
        'basic-colorless',
        'basic-silver',
        'basic-green',
        'basic-blue',
        'basic-black',
        'basic-plains',
        'basic-mountain',
    ];
    private const LEGACY_BASIC_DISPLAY_NAME_STYLES = [
        'copper-adventurer',
        'emerald-warden',
        'arcane-apprentice',
        'crimson-vanguard',
        'moonstone-initiate',
    ];
    private const PREMIUM_DISPLAY_NAME_STYLES = [
        'obsidian-crown',
        'astral-veil',
        'ember-forge',
        'jade-serpent',
        'frost-runeblade',
        'sanguine-royal',
        'storm-vault',
        'solar-edict',
        'void-amethyst',
        'iron-warden',
        'oceanic-oracle',
        'gilded-thorn',
        'lunar-sentinel',
        'crimson-engine',
        'arcane-prism',
        'necrosteel-relic',
        'sapphire-comet',
        'radiant-halo',
        'umbral-rose',
        'chronomancer',
    ];
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
    private const AUTH_REQUEST_WINDOW_SECONDS = 900;
    private const PASSWORD_RESET_REQUEST_LIMIT_PER_IP = 5;
    private const PASSWORD_RESET_REQUEST_LIMIT_PER_EMAIL = 3;
    private const PASSWORD_RESET_CONFIRM_LIMIT_PER_IP = 10;
    private const EMAIL_VERIFICATION_REQUEST_LIMIT_PER_IP = 5;
    private const EMAIL_VERIFICATION_REQUEST_LIMIT_PER_EMAIL = 3;

    public function __construct(
        private readonly JWTTokenManagerInterface $jwtTokenManager,
        private readonly PasswordResetService $passwordResetService,
        private readonly EmailVerificationService $emailVerificationService,
        private readonly AuthMailer $authMailer,
        private readonly LoginProtectionService $loginProtectionService,
        private readonly PasswordPolicy $passwordPolicy,
        private readonly AuthThrottleService $authThrottleService,
        private readonly SecurityAuditLogger $securityAuditLogger,
        #[Autowire('%kernel.environment%')]
        private readonly string $kernelEnvironment,
    ) {
    }

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

        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !$this->passwordPolicy->isValid($password) || !$this->isDisplayNameValid($displayName)) {
            return $this->fail(sprintf(
                'email, user name with 4-25 chars and %s',
                mb_strtolower($this->passwordPolicy->requirementMessage('Password'))
            ));
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

        $verificationToken = $this->emailVerificationService->issueRegisterVerification(
            $user,
            $request->getClientIp(),
            $request->headers->get('User-Agent'),
        );
        $this->securityAuditLogger->log('auth.registered', $user->email(), $user->id(), $request->getClientIp());
        $this->sendVerificationEmailFailOpen($user, $verificationToken, $request->getClientIp(), 'register');

        return $this->json([
            'user' => $user->toArray(),
            'verificationRequired' => true,
            ...$this->debugTokenPayload($verificationToken, 'emailVerificationToken'),
        ], 201);
    }

    #[Route('/auth/login', methods: ['POST'])]
    public function login(Request $request, EntityManagerInterface $entityManager, UserPasswordHasherInterface $passwordHasher): JsonResponse
    {
        $payload = $this->payload($request);
        $email = mb_strtolower(trim((string) ($payload['email'] ?? '')));
        $password = (string) ($payload['password'] ?? '');
        $clientIp = $request->getClientIp();

        if ($this->loginProtectionService->isLocked($email, $clientIp)) {
            $this->securityAuditLogger->log('auth.login.locked', $email, null, $clientIp);

            return $this->fail('Too many failed login attempts. Please try again later.', 429);
        }

        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || $password === '') {
            $this->loginProtectionService->recordFailure($email, $clientIp);
            $this->securityAuditLogger->log('auth.login.failed', $email, null, $clientIp, ['reason' => 'invalid_payload']);

            return $this->fail('Invalid credentials.', 401);
        }

        $user = $entityManager->getRepository(User::class)->findOneBy(['email' => $email]);
        if (!$user instanceof User || !$passwordHasher->isPasswordValid($user, $password)) {
            $this->loginProtectionService->recordFailure($email, $clientIp);
            $this->securityAuditLogger->log('auth.login.failed', $email, $user?->id(), $clientIp, ['reason' => 'invalid_credentials']);

            return $this->fail('Invalid credentials.', 401);
        }

        if (!$user->isEmailVerified()) {
            $this->securityAuditLogger->log('auth.login.failed', $email, $user->id(), $clientIp, ['reason' => 'email_not_verified']);

            return $this->fail('Email verification is required before login.', 403);
        }

        $this->loginProtectionService->resetFailures($email, $clientIp);
        $this->securityAuditLogger->log('auth.login.succeeded', $email, $user->id(), $clientIp);

        return $this->json(['token' => $this->jwtTokenManager->create($user)]);
    }

    #[Route('/auth/password-reset/request', methods: ['POST'])]
    public function requestPasswordReset(Request $request, EntityManagerInterface $entityManager): JsonResponse
    {
        $payload = $this->payload($request);
        $email = mb_strtolower(trim((string) ($payload['email'] ?? '')));
        $clientIp = trim((string) $request->getClientIp());

        if (
            $this->authThrottleService->isLimited('password-reset-request-ip', $clientIp, self::PASSWORD_RESET_REQUEST_LIMIT_PER_IP, self::AUTH_REQUEST_WINDOW_SECONDS)
            || $this->authThrottleService->isLimited('password-reset-request-email', $email, self::PASSWORD_RESET_REQUEST_LIMIT_PER_EMAIL, self::AUTH_REQUEST_WINDOW_SECONDS)
        ) {
            return $this->json(['accepted' => true], 202);
        }

        $this->authThrottleService->consume('password-reset-request-ip', $clientIp, self::AUTH_REQUEST_WINDOW_SECONDS);
        $this->authThrottleService->consume('password-reset-request-email', $email, self::AUTH_REQUEST_WINDOW_SECONDS);

        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            return $this->json(['accepted' => true], 202);
        }

        $user = $entityManager->getRepository(User::class)->findOneBy(['email' => $email]);
        $debugToken = null;
        if ($user instanceof User && $user->isEmailVerified()) {
            $debugToken = $this->passwordResetService->issueToken(
                $user,
                $request->getClientIp(),
                $request->headers->get('User-Agent'),
            );
            $this->securityAuditLogger->log('auth.password_reset.requested', $user->email(), $user->id(), $clientIp);
            $this->sendPasswordResetEmailFailOpen($user, $debugToken, $clientIp);
        } else {
            $this->securityAuditLogger->log('auth.password_reset.requested', $email, $user?->id(), $clientIp, ['acceptedWithoutToken' => true]);
        }

        return $this->json([
            'accepted' => true,
            ...$this->debugTokenPayload($debugToken, 'passwordResetToken'),
        ], 202);
    }

    #[Route('/auth/password-reset/confirm', methods: ['POST'])]
    public function confirmPasswordReset(
        Request $request,
        EntityManagerInterface $entityManager,
        UserPasswordHasherInterface $passwordHasher
    ): JsonResponse {
        $payload = $this->payload($request);
        $email = mb_strtolower(trim((string) ($payload['email'] ?? '')));
        $token = trim((string) ($payload['token'] ?? ''));
        $newPassword = (string) ($payload['newPassword'] ?? '');
        $clientIp = trim((string) $request->getClientIp());

        if ($this->authThrottleService->isLimited('password-reset-confirm-ip', $clientIp, self::PASSWORD_RESET_CONFIRM_LIMIT_PER_IP, self::AUTH_REQUEST_WINDOW_SECONDS)) {
            return $this->fail('Too many password reset attempts. Please try again later.', 429);
        }
        $this->authThrottleService->consume('password-reset-confirm-ip', $clientIp, self::AUTH_REQUEST_WINDOW_SECONDS);

        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || $token === '' || !$this->passwordPolicy->isValid($newPassword)) {
            return $this->fail(sprintf(
                'email, token and %s are required.',
                mb_strtolower($this->passwordPolicy->requirementMessage('newPassword'))
            ));
        }

        $passwordResetToken = $this->passwordResetService->consumeValidToken($token);
        if ($passwordResetToken === null) {
            $this->securityAuditLogger->log('auth.password_reset.failed', null, null, $clientIp, ['reason' => 'invalid_or_expired_token']);

            return $this->fail('Invalid or expired password reset token.');
        }

        $user = $passwordResetToken->user();
        if (mb_strtolower($user->email()) !== $email) {
            $this->securityAuditLogger->log('auth.password_reset.failed', $email, $user->id(), $clientIp, ['reason' => 'email_token_mismatch']);

            return $this->fail('Invalid or expired password reset token.');
        }

        $passwordResetToken->markUsed();
        $user->setPassword($passwordHasher->hashPassword($user, $newPassword));
        $this->securityAuditLogger->log('auth.password_reset.completed', $user->email(), $user->id(), $clientIp);

        $this->loginProtectionService->resetFailures($user->email(), $clientIp);
        $entityManager->flush();

        return $this->json([
            'updated' => true,
            'token' => $this->jwtTokenManager->create($user),
        ]);
    }

    #[Route('/auth/email-verification/request', methods: ['POST'])]
    public function requestEmailVerification(Request $request, EntityManagerInterface $entityManager): JsonResponse
    {
        $payload = $this->payload($request);
        $email = mb_strtolower(trim((string) ($payload['email'] ?? '')));
        $clientIp = trim((string) $request->getClientIp());

        if (
            $this->authThrottleService->isLimited('email-verification-request-ip', $clientIp, self::EMAIL_VERIFICATION_REQUEST_LIMIT_PER_IP, self::AUTH_REQUEST_WINDOW_SECONDS)
            || $this->authThrottleService->isLimited('email-verification-request-email', $email, self::EMAIL_VERIFICATION_REQUEST_LIMIT_PER_EMAIL, self::AUTH_REQUEST_WINDOW_SECONDS)
        ) {
            return $this->json(['accepted' => true], 202);
        }

        $this->authThrottleService->consume('email-verification-request-ip', $clientIp, self::AUTH_REQUEST_WINDOW_SECONDS);
        $this->authThrottleService->consume('email-verification-request-email', $email, self::AUTH_REQUEST_WINDOW_SECONDS);

        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            return $this->json(['accepted' => true], 202);
        }

        $user = $entityManager->getRepository(User::class)->findOneBy(['email' => $email]);
        if (!$user instanceof User || $user->isEmailVerified()) {
            return $this->json(['accepted' => true], 202);
        }

        $token = $this->emailVerificationService->issueRegisterVerification(
            $user,
            $request->getClientIp(),
            $request->headers->get('User-Agent'),
        );
        $this->securityAuditLogger->log('auth.email_verification.requested', $user->email(), $user->id(), $clientIp);
        $this->sendVerificationEmailFailOpen($user, $token, $clientIp, 'resend');

        return $this->json([
            'accepted' => true,
            ...$this->debugTokenPayload($token, 'emailVerificationToken'),
        ], 202);
    }

    #[Route('/auth/email-verification/confirm', methods: ['POST'])]
    public function confirmEmailVerification(Request $request, EntityManagerInterface $entityManager): JsonResponse
    {
        $payload = $this->payload($request);
        $token = trim((string) ($payload['token'] ?? ''));
        if ($token === '') {
            return $this->fail('token is required.');
        }

        $verificationToken = $this->emailVerificationService->consumeValidToken($token);
        if (!$verificationToken instanceof EmailVerificationToken) {
            return $this->fail('Invalid or expired email verification token.');
        }

        $user = $verificationToken->user();
        if ($verificationToken->purpose() === EmailVerificationToken::PURPOSE_EMAIL_CHANGE) {
            if ($user->pendingEmail() !== $verificationToken->email()) {
                return $this->fail('Invalid or expired email verification token.');
            }
            if ($this->emailExists($entityManager, $verificationToken->email(), $user)) {
                return $this->fail('Email is already registered.', 409);
            }

            $user->applyPendingEmail();
        } else {
            if (mb_strtolower($user->email()) !== $verificationToken->email()) {
                return $this->fail('Invalid or expired email verification token.');
            }

            $user->markEmailVerified();
        }

        $verificationToken->markUsed();
        $entityManager->flush();
        $this->securityAuditLogger->log('auth.email_verification.completed', $user->email(), $user->id(), $request->getClientIp(), [
            'purpose' => $verificationToken->purpose(),
        ]);

        return $this->json([
            'verified' => true,
            'user' => $user->toArray(),
            'token' => $this->jwtTokenManager->create($user),
        ]);
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

            if (mb_strtolower($email) !== mb_strtolower($user->email())) {
                $user->startEmailChange($email);
                $entityManager->flush();

                $token = $this->emailVerificationService->issueEmailChangeVerification(
                    $user,
                    $email,
                    $request->getClientIp(),
                    $request->headers->get('User-Agent'),
                );
                $this->securityAuditLogger->log('auth.email_change.requested', $email, $user->id(), $request->getClientIp());
                $this->sendVerificationEmailFailOpen($user, $token, $request->getClientIp(), 'email_change', $email);

                return $this->json([
                    'user' => $user->toArray(),
                    'emailChangeVerificationRequired' => true,
                    ...$this->debugTokenPayload($token, 'emailVerificationToken'),
                ]);
            }
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

    #[Route('/me/display-name-style', methods: ['PATCH'])]
    public function updateDisplayNameStyle(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $payload = $this->payload($request);
        $presetId = trim((string) ($payload['presetId'] ?? ''));

        if (!$this->isDisplayNameStylePresetAvailable($presetId)) {
            return $this->fail('Selected display name style is not available.');
        }

        $textColor = array_key_exists('textColor', $payload)
            ? $this->displayNameStyleHexColor((string) $payload['textColor'])
            : null;

        $user->selectDisplayNameStyle($presetId, $textColor);
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
        $user->clearPendingEmail();
        $user->markEmailVerified();
        $user->setPassword($passwordHasher->hashPassword($user, sprintf('deleted-password-%s', $user->id())));
        $user->markOffline();
        $user->useInitialAvatar();
        $user->resetDisplayNameStyle();

        $entityManager->flush();

        return $this->json(null, 204);
    }

    private function sendPasswordResetEmailFailOpen(User $user, string $token, ?string $clientIp): void
    {
        try {
            $this->authMailer->sendPasswordReset($user->email(), $token);
            $this->securityAuditLogger->log('auth.mail.password_reset.sent', $user->email(), $user->id(), $clientIp);
        } catch (\Throwable $exception) {
            $this->securityAuditLogger->log('auth.mail.password_reset.failed', $user->email(), $user->id(), $clientIp, [
                'reason' => 'mailer_transport_error',
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
            ]);
        }
    }

    private function sendVerificationEmailFailOpen(
        User $user,
        string $token,
        ?string $clientIp,
        string $context,
        ?string $recipientEmail = null,
    ): void {
        $targetEmail = $recipientEmail ?? $user->email();

        try {
            $this->authMailer->sendEmailVerification($targetEmail, $token);
            $this->securityAuditLogger->log('auth.mail.email_verification.sent', $targetEmail, $user->id(), $clientIp, [
                'context' => $context,
            ]);
        } catch (\Throwable $exception) {
            $this->securityAuditLogger->log('auth.mail.email_verification.failed', $targetEmail, $user->id(), $clientIp, [
                'context' => $context,
                'reason' => 'mailer_transport_error',
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
            ]);
        }
    }

    /**
     * @return array<string,string>
     */
    private function debugTokenPayload(?string $token, string $fieldName): array
    {
        if ($this->kernelEnvironment !== 'test' || $token === null) {
            return [];
        }

        return [$fieldName => $token];
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

    private function displayNameStyleHexColor(string $color): ?string
    {
        return preg_match('/^#[0-9a-fA-F]{6}$/', $color) ? $color : null;
    }

    private function isDisplayNameStylePresetAvailable(string $presetId): bool
    {
        return in_array($presetId, self::BASIC_DISPLAY_NAME_STYLES, true)
            || in_array($presetId, self::LEGACY_BASIC_DISPLAY_NAME_STYLES, true)
            || in_array($presetId, self::PREMIUM_DISPLAY_NAME_STYLES, true);
    }

    #[Route('/me/password', methods: ['PATCH'])]
    public function updatePassword(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, UserPasswordHasherInterface $passwordHasher): JsonResponse
    {
        if (!$user->isEmailVerified()) {
            return $this->fail('Email verification is required before changing password.', 403);
        }

        $payload = $this->payload($request);
        $currentPassword = (string) ($payload['currentPassword'] ?? '');
        $newPassword = (string) ($payload['newPassword'] ?? '');

        if (!$this->passwordPolicy->isValid($newPassword)) {
            return $this->fail($this->passwordPolicy->requirementMessage('newPassword'));
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
