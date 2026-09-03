<?php

namespace App\UI\Http;

use App\Application\Auth\RefreshSessionService;
use App\Application\Auth\SecurityAuditLogger;
use App\Application\Friendship\FriendPresenceService;
use App\Application\User\AdminUserLocalizationSummaryFactory;
use App\Application\User\UserAccountDeletionResult;
use App\Application\User\UserAccountDeletionService;
use App\Domain\Auth\RefreshSession;
use App\Domain\Deck\Deck;
use App\Domain\User\Role;
use App\Domain\User\User;
use App\Domain\User\UserDailyVisit;
use App\Infrastructure\Realtime\GameEventPublisher;
use App\Infrastructure\Realtime\RoomEventPublisher;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\EntityManagerInterface;
use Lexik\Bundle\JWTAuthenticationBundle\Services\JWTTokenManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class AdminUsersController extends ApiController
{
    private const IMPERSONATION_JWT_TTL_SECONDS = 900;
    private const DEFAULT_USERS_PAGE_SIZE = 30;
    private const MAX_USERS_PAGE_SIZE = 100;

    #[Route('/admin/users', methods: ['GET'])]
    public function list(
        Request $request,
        #[CurrentUser] User $actor,
        EntityManagerInterface $entityManager,
        FriendPresenceService $presence,
        AdminUserLocalizationSummaryFactory $localizationSummaryFactory,
    ): JsonResponse
    {
        if (!$this->canAccessAdmin($actor)) {
            return $this->fail('Admin access is required.', 403);
        }

        $criteria = $this->listCriteria($request);
        $users = $entityManager->getRepository(User::class)->createQueryBuilder('user')
            ->leftJoin('user.roles', 'role')
            ->addSelect('role')
            ->orderBy('user.createdAt', 'DESC')
            ->getQuery()
            ->getResult();

        $adminUsers = array_values(array_filter($users, static fn (mixed $user): bool => $user instanceof User));
        $presenceStatusesByUserId = $presence->statusesFor($adminUsers);
        $deckCountsByUserId = $this->deckCountsByUserId($adminUsers, $entityManager);
        $localizationByUserId = $this->localizationByUserId($adminUsers, $entityManager);
        $filteredUsers = $this->filterAdminUsers($adminUsers, $criteria, $presenceStatusesByUserId);
        $this->sortAdminUsers($filteredUsers, $criteria['sort'], $criteria['direction'], $deckCountsByUserId);

        $total = count($filteredUsers);
        $limit = $criteria['paginate'] ? $criteria['limit'] : max(1, $total);
        $totalPages = max(1, (int) ceil($total / $limit));
        $page = min($criteria['page'], $totalPages);
        $pageUsers = array_slice($filteredUsers, ($page - 1) * $limit, $limit);
        $authProvidersByUserId = $this->authProvidersByUserId($pageUsers, $entityManager);
        $activeSessionsByUserId = $this->activeSessionCountsByUserId($pageUsers, $entityManager);

        return $this->json([
            'users' => array_map(
                fn (User $user): array => $this->adminUserArray(
                    $user,
                    $authProvidersByUserId[$user->id()] ?? [],
                    $deckCountsByUserId[$user->id()] ?? $this->emptyDeckCounts(),
                    $localizationByUserId[$user->id()] ?? $this->emptyLocalization($user),
                    $presenceStatusesByUserId[$user->id()] ?? FriendPresenceService::STATUS_OFFLINE,
                    $activeSessionsByUserId[$user->id()] ?? 0,
                ),
                $pageUsers,
            ),
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'totalPages' => $totalPages,
            'summary' => $this->usersSummary($adminUsers, $presenceStatusesByUserId, $deckCountsByUserId),
            'countries' => $this->countriesSummary($adminUsers, $localizationByUserId),
            'localizationSummary' => $localizationSummaryFactory->create(
                $this->localizationSummaryInput($adminUsers, $localizationByUserId, $presenceStatusesByUserId),
            ),
        ]);
    }

    #[Route('/admin/users/{id}', methods: ['PATCH'])]
    public function update(
        string $id,
        Request $request,
        #[CurrentUser] User $actor,
        EntityManagerInterface $entityManager,
        FriendPresenceService $presence,
    ): JsonResponse {
        if (!$this->canAccessAdmin($actor)) {
            return $this->fail('Admin access is required.', 403);
        }
        if (!$this->canManageAdminActions($actor)) {
            return $this->fail('Admin or owner access is required for this action.', 403);
        }

        $target = $this->targetUser($id, $entityManager);
        if (!$target instanceof User) {
            return $this->fail('User not found.', 404);
        }

        $payload = $this->payload($request);
        $hasAuthorizationRole = array_key_exists('authorizationRole', $payload);
        $hasPremiumTier = array_key_exists('premiumTier', $payload);
        if (!$hasAuthorizationRole && !$hasPremiumTier) {
            return $this->fail('No supported admin user fields were provided.');
        }

        if ($hasAuthorizationRole) {
            if (!$actor->hasRole(Role::OWNER)) {
                return $this->fail('Only the owner can modify authorization roles.', 403);
            }
            $permissionError = $this->validateActorCanManageLowerRoleTarget($actor, $target);
            if ($permissionError instanceof JsonResponse) {
                return $permissionError;
            }

            $authorizationRole = (string) $payload['authorizationRole'];
            $roleError = $this->validateAuthorizationRoleChange($target, $authorizationRole, $entityManager);
            if ($roleError instanceof JsonResponse) {
                return $roleError;
            }

            $this->applyAuthorizationRole($target, $authorizationRole, $entityManager);
        }

        if ($hasPremiumTier) {
            $permissionError = $this->validateActorCanManagePremiumAndPresenceTarget($actor, $target);
            if ($permissionError instanceof JsonResponse) {
                return $permissionError;
            }

            $premiumTier = (string) $payload['premiumTier'];
            if (!User::isSupportedPremiumTier($premiumTier)) {
                return $this->fail('Unsupported premium tier.');
            }

            $target->updatePremiumTier($premiumTier);
        }

        try {
            $entityManager->flush();
        } catch (UniqueConstraintViolationException) {
            return $this->fail('Only one owner user is allowed.', 409);
        }

        return $this->json(['user' => $this->adminUserArray(
            $target,
            $this->authProvidersForUser($target, $entityManager),
            $this->deckCountsForUser($target, $entityManager),
            $this->localizationForUser($target, $entityManager),
            $presence->statusFor($target),
            $this->activeSessionsCount($target, $entityManager),
        )]);
    }

    #[Route('/admin/users/{id}', methods: ['DELETE'])]
    public function delete(
        string $id,
        #[CurrentUser] User $actor,
        EntityManagerInterface $entityManager,
        RefreshSessionService $refreshSessions,
        UserAccountDeletionService $accountDeletion,
        RoomEventPublisher $roomEventPublisher,
        GameEventPublisher $gameEventPublisher,
    ): JsonResponse {
        if (!$this->canAccessAdmin($actor)) {
            return $this->fail('Admin access is required.', 403);
        }
        if (!$this->canManageAdminActions($actor)) {
            return $this->fail('Admin or owner access is required for this action.', 403);
        }

        $target = $this->targetUser($id, $entityManager);
        if (!$target instanceof User) {
            return $this->fail('User not found.', 404);
        }
        $permissionError = $this->validateActorCanManageLowerRoleTarget($actor, $target);
        if ($permissionError instanceof JsonResponse) {
            return $permissionError;
        }

        $refreshSessions->revokeAllActiveSessionsForUser($target);
        $result = $accountDeletion->delete($target, $entityManager);
        $this->publishRoomRemovalResult($result, $roomEventPublisher, $gameEventPublisher);

        return $this->json(null, 204);
    }

    #[Route('/admin/users/{id}/sessions/revoke', methods: ['POST'])]
    public function revokeSessions(
        string $id,
        #[CurrentUser] User $actor,
        EntityManagerInterface $entityManager,
        RefreshSessionService $refreshSessions,
        FriendPresenceService $presence,
    ): JsonResponse {
        if (!$this->canAccessAdmin($actor)) {
            return $this->fail('Admin access is required.', 403);
        }
        if (!$this->canManageAdminActions($actor)) {
            return $this->fail('Admin or owner access is required for this action.', 403);
        }

        $target = $this->targetUser($id, $entityManager);
        if (!$target instanceof User) {
            return $this->fail('User not found.', 404);
        }
        $permissionError = $this->validateActorCanManagePremiumAndPresenceTarget($actor, $target);
        if ($permissionError instanceof JsonResponse) {
            return $permissionError;
        }

        $refreshSessions->revokeAllActiveSessionsForUser($target);

        return $this->json(['user' => $this->adminUserArray(
            $target,
            $this->authProvidersForUser($target, $entityManager),
            $this->deckCountsForUser($target, $entityManager),
            $this->localizationForUser($target, $entityManager),
            $presence->statusFor($target),
            $this->activeSessionsCount($target, $entityManager),
        )]);
    }

    #[Route('/admin/users/{id}/impersonate', methods: ['POST'])]
    public function impersonate(
        string $id,
        Request $request,
        #[CurrentUser] User $actor,
        EntityManagerInterface $entityManager,
        JWTTokenManagerInterface $jwtTokenManager,
        SecurityAuditLogger $securityAuditLogger,
    ): JsonResponse {
        if (!$this->canAccessImpersonation($actor)) {
            $this->logImpersonationBlocked($securityAuditLogger, $actor, $request, 'impersonation_role_required', $id);

            return $this->fail('Support, admin or owner access is required to impersonate users.', 403);
        }

        $target = $this->targetUser($id, $entityManager);
        if (!$target instanceof User) {
            $this->logImpersonationBlocked($securityAuditLogger, $actor, $request, 'target_not_found', $id);

            return $this->fail('User not found.', 404);
        }

        $permissionError = $this->validateActorCanImpersonateTarget($actor, $target);
        if ($permissionError instanceof JsonResponse) {
            $this->logImpersonationBlocked(
                $securityAuditLogger,
                $actor,
                $request,
                $target->id() === $actor->id() ? 'self_target' : 'target_role_not_allowed',
                $target->id(),
                $this->authorizationRole($target),
            );

            return $permissionError;
        }

        $token = $jwtTokenManager->createFromPayload($target, [
            'impersonated' => true,
            'impersonatorId' => $actor->id(),
            'targetUserId' => $target->id(),
            'exp' => (new \DateTimeImmutable(sprintf('+%d seconds', self::IMPERSONATION_JWT_TTL_SECONDS)))->getTimestamp(),
        ]);

        $securityAuditLogger->log('admin.impersonation.started', $actor->email(), $actor->id(), $request->getClientIp(), [
            'targetUserId' => $target->id(),
            'targetRole' => $this->authorizationRole($target),
        ]);

        return $this->json([
            'token' => $token,
            'user' => $target->toArray(),
            'impersonation' => [
                'active' => true,
                'impersonatorId' => $actor->id(),
                'targetUserId' => $target->id(),
            ],
        ]);
    }

    private function canAccessAdmin(User $user): bool
    {
        return $user->hasRole(Role::SUPPORT) || $user->hasRole(Role::ADMIN) || $user->hasRole(Role::OWNER);
    }

    private function canManageAdminActions(User $user): bool
    {
        return $user->hasRole(Role::ADMIN) || $user->hasRole(Role::OWNER);
    }

    private function canAccessImpersonation(User $user): bool
    {
        return $user->hasRole(Role::SUPPORT) || $user->hasRole(Role::ADMIN) || $user->hasRole(Role::OWNER);
    }

    private function targetUser(string $id, EntityManagerInterface $entityManager): ?User
    {
        $user = $entityManager->getRepository(User::class)->find($id);

        return $user instanceof User ? $user : null;
    }

    private function validateAuthorizationRoleChange(
        User $target,
        string $authorizationRole,
        EntityManagerInterface $entityManager,
    ): ?JsonResponse {
        if (!Role::isSupported($authorizationRole)) {
            return $this->fail('Unsupported authorization role.');
        }

        if ($authorizationRole !== Role::OWNER || $target->hasRole(Role::OWNER)) {
            return null;
        }

        $existingOwner = $entityManager->getRepository(User::class)->createQueryBuilder('user')
            ->innerJoin('user.roles', 'role')
            ->where('role.code = :ownerRole')
            ->andWhere('user != :target')
            ->setParameter('ownerRole', Role::OWNER)
            ->setParameter('target', $target)
            ->setMaxResults(1)
            ->getQuery()
            ->getOneOrNullResult();

        return $existingOwner instanceof User
            ? $this->fail('Only one owner user is allowed.', 409)
            : null;
    }

    private function validateActorCanManageLowerRoleTarget(User $actor, User $target): ?JsonResponse
    {
        if ($target->id() === $actor->id()) {
            return $this->fail('You cannot manage your own user from the admin panel.', 400);
        }

        if ($this->roleRank($this->authorizationRole($target)) >= $this->roleRank($this->authorizationRole($actor))) {
            return $this->fail('You can only manage users with a lower authorization role.', 403);
        }

        return null;
    }

    private function validateActorCanImpersonateTarget(User $actor, User $target): ?JsonResponse
    {
        if ($target->id() === $actor->id()) {
            return $this->fail('You cannot impersonate your own user.', 400);
        }

        $actorRole = $this->authorizationRole($actor);
        $targetRole = $this->authorizationRole($target);

        if ($actorRole === Role::OWNER) {
            return null;
        }

        if ($actorRole === Role::ADMIN && in_array($targetRole, [Role::SUPPORT, Role::USER], true)) {
            return null;
        }

        if ($actorRole === Role::SUPPORT && $targetRole === Role::USER) {
            return null;
        }

        return $this->fail('You cannot impersonate a user with that authorization role.', 403);
    }

    private function validateActorCanManagePremiumAndPresenceTarget(User $actor, User $target): ?JsonResponse
    {
        if ($actor->hasRole(Role::OWNER) && $target->hasRole(Role::OWNER)) {
            return null;
        }

        return $this->validateActorCanManageLowerRoleTarget($actor, $target);
    }

    private function applyAuthorizationRole(User $user, string $authorizationRole, EntityManagerInterface $entityManager): void
    {
        $user->grantRole($this->requiredRole($entityManager, Role::USER));
        $user->revokeRole(Role::SUPPORT);
        $user->revokeRole(Role::ADMIN);
        $user->revokeRole(Role::OWNER);

        if ($authorizationRole === Role::USER) {
            return;
        }

        $user->grantRole($this->requiredRole($entityManager, $authorizationRole));
    }

    private function requiredRole(EntityManagerInterface $entityManager, string $roleCode): Role
    {
        $role = $entityManager->getRepository(Role::class)->find($roleCode);
        if (!$role instanceof Role) {
            throw new \RuntimeException(sprintf('Required role "%s" is not configured.', $roleCode));
        }

        return $role;
    }

    /**
     * @return array{
     *   id: string,
     *   displayName: string,
     *   publicProfilePath: string|null,
     *   email: string,
     *   authProviders: list<string>,
     *   roles: list<string>,
     *   authorizationRole: string,
     *   premiumTier: string,
     *   lastConnectedAt: string|null,
     *   presenceStatus: string,
     *   isOnline: bool,
     *   activeSessionsCount: int,
     *   deckCounts: array{total:int, privateCount:int, publicCount:int},
     *   localization: array{countryCode:string|null, countryName:string|null, appLanguage:string},
     *   createdAt: string
     * }
     */
    private function adminUserArray(
        User $user,
        array $authProviders,
        array $deckCounts,
        array $localization,
        string $presenceStatus,
        int $activeSessionsCount,
    ): array
    {
        return [
            'id' => $user->id(),
            'displayName' => $user->displayName(),
            'publicProfilePath' => $user->publicPath(),
            'email' => $user->email(),
            'authProviders' => $authProviders,
            'roles' => $user->getRoles(),
            'authorizationRole' => $this->authorizationRole($user),
            'premiumTier' => $user->premiumTier(),
            'lastConnectedAt' => $user->lastSeenAt()?->format(DATE_ATOM),
            'presenceStatus' => $presenceStatus,
            'isOnline' => $presenceStatus !== FriendPresenceService::STATUS_OFFLINE,
            'activeSessionsCount' => $activeSessionsCount,
            'deckCounts' => $deckCounts,
            'localization' => $localization,
            'createdAt' => $user->createdAt()->format(DATE_ATOM),
        ];
    }

    /**
     * @return list<string>
     */
    private function authProvidersForUser(User $user, EntityManagerInterface $entityManager): array
    {
        $providers = $entityManager->getConnection()->fetchFirstColumn(
            <<<'SQL'
SELECT DISTINCT provider
FROM auth_identity
WHERE user_id = :userId
ORDER BY provider ASC
SQL,
            ['userId' => $user->id()],
        );

        return array_values(array_unique(array_filter(array_map(
            fn (mixed $provider): ?string => $this->normalizeAuthProvider($provider),
            $providers,
        ))));
    }

    /**
     * @param list<User> $users
     * @return array<string, list<string>>
     */
    private function authProvidersByUserId(array $users, EntityManagerInterface $entityManager): array
    {
        if ($users === []) {
            return [];
        }

        $providersByUserId = [];
        foreach ($users as $user) {
            $providersByUserId[$user->id()] = [];
        }

        $rows = $entityManager->getConnection()->fetchAllAssociative(
            <<<'SQL'
SELECT DISTINCT user_id, provider
FROM auth_identity
WHERE user_id IN (:userIds)
ORDER BY user_id ASC, provider ASC
SQL,
            ['userIds' => array_keys($providersByUserId)],
            ['userIds' => ArrayParameterType::STRING],
        );

        foreach ($rows as $row) {
            $userId = $row['user_id'] ?? null;
            $provider = $row['provider'] ?? null;
            if (!is_string($userId) || !array_key_exists($userId, $providersByUserId) || !is_string($provider)) {
                continue;
            }

            $normalizedProvider = $this->normalizeAuthProvider($provider);
            if ($normalizedProvider === null) {
                continue;
            }

            $providersByUserId[$userId][$normalizedProvider] = true;
        }

        foreach ($providersByUserId as $userId => $providers) {
            $providersByUserId[$userId] = array_keys($providers);
        }

        return $providersByUserId;
    }

    private function normalizeAuthProvider(mixed $provider): ?string
    {
        if (!is_string($provider)) {
            return null;
        }

        $normalizedProvider = trim($provider);

        return $normalizedProvider === '' ? null : ucfirst(strtolower($normalizedProvider));
    }

    /**
     * @param list<User> $users
     * @return array<string, array{total:int, privateCount:int, publicCount:int}>
     */
    private function deckCountsByUserId(array $users, EntityManagerInterface $entityManager): array
    {
        if ($users === []) {
            return [];
        }

        $countsByUserId = [];
        foreach ($users as $user) {
            $countsByUserId[$user->id()] = $this->emptyDeckCounts();
        }

        $rows = $entityManager->getRepository(Deck::class)->createQueryBuilder('deck')
            ->select('IDENTITY(deck.owner) AS ownerId, deck.visibility AS visibility, COUNT(deck.id) AS deckCount')
            ->where('deck.owner IN (:users)')
            ->setParameter('users', $users)
            ->groupBy('ownerId')
            ->addGroupBy('deck.visibility')
            ->getQuery()
            ->getArrayResult();

        foreach ($rows as $row) {
            $userId = $row['ownerId'] ?? null;
            $visibility = $row['visibility'] ?? null;
            if (!is_string($userId) || !isset($countsByUserId[$userId]) || !is_string($visibility)) {
                continue;
            }

            $count = (int) ($row['deckCount'] ?? 0);
            if ($visibility === Deck::VISIBILITY_PUBLIC) {
                $countsByUserId[$userId]['publicCount'] = $count;
            }
            if ($visibility === Deck::VISIBILITY_PRIVATE) {
                $countsByUserId[$userId]['privateCount'] = $count;
            }
        }

        foreach ($countsByUserId as &$deckCounts) {
            $deckCounts['total'] = $deckCounts['privateCount'] + $deckCounts['publicCount'];
        }
        unset($deckCounts);

        return $countsByUserId;
    }

    /** @return array{total:int, privateCount:int, publicCount:int} */
    private function deckCountsForUser(User $user, EntityManagerInterface $entityManager): array
    {
        return $this->deckCountsByUserId([$user], $entityManager)[$user->id()] ?? $this->emptyDeckCounts();
    }

    /** @return array{total:int, privateCount:int, publicCount:int} */
    private function emptyDeckCounts(): array
    {
        return ['total' => 0, 'privateCount' => 0, 'publicCount' => 0];
    }

    /**
     * @param list<User> $users
     * @return array<string, array{countryCode:string|null, countryName:string|null, appLanguage:string}>
     */
    private function localizationByUserId(array $users, EntityManagerInterface $entityManager): array
    {
        if ($users === []) {
            return [];
        }

        $localizationByUserId = [];
        foreach ($users as $user) {
            $localizationByUserId[$user->id()] = $this->emptyLocalization($user);
        }

        $visits = $entityManager->getRepository(UserDailyVisit::class)->createQueryBuilder('visit')
            ->select('IDENTITY(visit.user) AS userId, visit.countryCode AS countryCode, visit.countryName AS countryName')
            ->where('visit.user IN (:users)')
            ->setParameter('users', $users)
            ->orderBy('visit.firstSeenAt', 'DESC')
            ->getQuery()
            ->getArrayResult();

        foreach ($visits as $visit) {
            $userId = $visit['userId'] ?? null;
            $countryCode = $visit['countryCode'] ?? null;
            $countryName = $visit['countryName'] ?? null;
            if (
                !is_string($userId)
                || !isset($localizationByUserId[$userId])
                || !is_string($countryCode)
                || $localizationByUserId[$userId]['countryName'] !== null
                || $localizationByUserId[$userId]['countryCode'] !== $countryCode
                || !is_string($countryName)
                || trim($countryName) === ''
            ) {
                continue;
            }

            $localizationByUserId[$userId]['countryName'] = trim($countryName);
        }

        foreach ($localizationByUserId as &$localization) {
            if ($localization['countryName'] !== null || $localization['countryCode'] === null) {
                continue;
            }

            $localization['countryName'] = $this->countryNameForCode($localization['countryCode']);
        }
        unset($localization);

        return $localizationByUserId;
    }

    /** @return array{countryCode:string|null, countryName:string|null, appLanguage:string} */
    private function localizationForUser(User $user, EntityManagerInterface $entityManager): array
    {
        return $this->localizationByUserId([$user], $entityManager)[$user->id()] ?? $this->emptyLocalization($user);
    }

    /** @return array{countryCode:string|null, countryName:string|null, appLanguage:string} */
    private function emptyLocalization(User $user): array
    {
        return [
            'countryCode' => $user->lastSeenCountryCode(),
            'countryName' => null,
            'appLanguage' => $user->appLanguage(),
        ];
    }

    /**
     * @return array{
     *   query:string,
     *   role:string|null,
     *   premiumTier:string|null,
     *   presence:string,
     *   sort:string,
     *   direction:'asc'|'desc',
     *   paginate:bool,
     *   page:int,
     *   limit:int
     * }
     */
    private function listCriteria(Request $request): array
    {
        $role = $this->queryString($request, 'role', 'all');
        $premiumTier = $this->queryString($request, 'premiumTier', 'all');
        $presence = $this->queryString($request, 'status', 'all');
        $sort = $this->queryString($request, 'sort', 'createdAt');
        $direction = $this->queryString($request, 'direction', 'desc');

        return [
            'query' => $this->queryString($request, 'q'),
            'role' => $role !== 'all' && Role::isSupported($role) ? $role : null,
            'premiumTier' => $premiumTier !== 'all' && User::isSupportedPremiumTier($premiumTier) ? $premiumTier : null,
            'presence' => in_array($presence, [
                'all',
                'active',
                FriendPresenceService::STATUS_ONLINE,
                FriendPresenceService::STATUS_IN_GAME,
                FriendPresenceService::STATUS_OFFLINE,
                'recently_connected',
                'recently_created',
                'never_connected',
            ], true) ? $presence : 'active',
            'sort' => in_array($sort, ['name', 'email', 'lastConnectedAt', 'createdAt', 'role', 'premium', 'totalDecks'], true)
                ? $sort
                : 'createdAt',
            'direction' => $direction === 'asc' ? 'asc' : 'desc',
            'paginate' => $request->query->has('page') || $request->query->has('limit'),
            'page' => $this->positiveQueryInteger($request, 'page', 1),
            'limit' => min(self::MAX_USERS_PAGE_SIZE, $this->positiveQueryInteger($request, 'limit', self::DEFAULT_USERS_PAGE_SIZE)),
        ];
    }

    private function queryString(Request $request, string $name, string $default = ''): string
    {
        $value = $request->query->get($name, $default);

        return is_string($value) ? trim($value) : $default;
    }

    private function positiveQueryInteger(Request $request, string $name, int $default): int
    {
        $value = filter_var($request->query->get($name), FILTER_VALIDATE_INT);

        return is_int($value) && $value > 0 ? $value : $default;
    }

    /**
     * @param list<User> $users
     * @param array{query:string, role:string|null, premiumTier:string|null, presence:string, sort:string, direction:'asc'|'desc', paginate:bool, page:int, limit:int} $criteria
     * @param array<string, string> $presenceStatusesByUserId
     * @return list<User>
     */
    private function filterAdminUsers(array $users, array $criteria, array $presenceStatusesByUserId): array
    {
        $query = mb_strtolower($criteria['query']);
        $now = new \DateTimeImmutable();
        $recentSince = $now->modify('-7 days');

        return array_values(array_filter($users, function (User $user) use ($criteria, $presenceStatusesByUserId, $query, $now, $recentSince): bool {
            if ($criteria['role'] !== null && $this->authorizationRole($user) !== $criteria['role']) {
                return false;
            }
            if ($criteria['premiumTier'] !== null && $user->premiumTier() !== $criteria['premiumTier']) {
                return false;
            }
            if (!$this->matchesPresenceFilter(
                $user,
                $criteria['presence'],
                $presenceStatusesByUserId[$user->id()] ?? FriendPresenceService::STATUS_OFFLINE,
                $now,
                $recentSince,
            )) {
                return false;
            }
            if ($query === '') {
                return true;
            }

            return str_contains(mb_strtolower($user->displayName()), $query)
                || str_contains(mb_strtolower($user->email()), $query);
        }));
    }

    private function matchesPresenceFilter(
        User $user,
        string $presenceFilter,
        string $presenceStatus,
        \DateTimeImmutable $now,
        \DateTimeImmutable $recentSince,
    ): bool {
        return match ($presenceFilter) {
            'all' => true,
            'active' => $presenceStatus !== FriendPresenceService::STATUS_OFFLINE,
            FriendPresenceService::STATUS_ONLINE,
            FriendPresenceService::STATUS_IN_GAME,
            FriendPresenceService::STATUS_OFFLINE => $presenceStatus === $presenceFilter,
            'recently_connected' => $this->isWithinRange($user->lastSeenAt(), $recentSince, $now),
            'recently_created' => $this->isWithinRange($user->createdAt(), $recentSince, $now),
            'never_connected' => $user->lastSeenAt() === null,
            default => false,
        };
    }

    private function isWithinRange(?\DateTimeImmutable $date, \DateTimeImmutable $start, \DateTimeImmutable $end): bool
    {
        return $date !== null && $date >= $start && $date <= $end;
    }

    /**
     * @param list<User> $users
     * @param array<string, array{total:int, privateCount:int, publicCount:int}> $deckCountsByUserId
     */
    private function sortAdminUsers(array &$users, string $sort, string $direction, array $deckCountsByUserId): void
    {
        usort($users, function (User $left, User $right) use ($sort, $direction, $deckCountsByUserId): int {
            $leftValue = $this->adminUserSortValue($left, $sort, $deckCountsByUserId);
            $rightValue = $this->adminUserSortValue($right, $sort, $deckCountsByUserId);
            $comparison = is_int($leftValue)
                ? $leftValue <=> $rightValue
                : strcasecmp($leftValue, $rightValue);

            if ($comparison === 0) {
                return strcmp($left->id(), $right->id());
            }

            return $direction === 'asc' ? $comparison : -$comparison;
        });
    }

    /**
     * @param array<string, array{total:int, privateCount:int, publicCount:int}> $deckCountsByUserId
     */
    private function adminUserSortValue(User $user, string $sort, array $deckCountsByUserId): int|string
    {
        return match ($sort) {
            'name' => $user->displayName(),
            'email' => $user->email(),
            'lastConnectedAt' => $user->lastSeenAt()?->getTimestamp() ?? PHP_INT_MIN,
            'role' => $this->roleRank($this->authorizationRole($user)),
            'premium' => $this->premiumTierRank($user->premiumTier()),
            'totalDecks' => $deckCountsByUserId[$user->id()]['total'] ?? 0,
            default => $user->createdAt()->getTimestamp(),
        };
    }

    private function premiumTierRank(string $premiumTier): int
    {
        return match ($premiumTier) {
            User::PREMIUM_TIER_1 => 1,
            User::PREMIUM_TIER_2 => 2,
            User::PREMIUM_TIER_3 => 3,
            default => 0,
        };
    }

    /**
     * @param list<User> $users
     * @param array<string, string> $presenceStatusesByUserId
     * @param array<string, array{total:int, privateCount:int, publicCount:int}> $deckCountsByUserId
     * @return array{total:int, online:int, recentlyConnected:int, recentlyCreated:int, neverConnected:int, totalDecks:int, tier0:int, tier1:int, tier2:int, tier3:int}
     */
    private function usersSummary(array $users, array $presenceStatusesByUserId, array $deckCountsByUserId): array
    {
        $summary = [
            'total' => 0,
            'online' => 0,
            'recentlyConnected' => 0,
            'recentlyCreated' => 0,
            'neverConnected' => 0,
            'totalDecks' => 0,
            'tier0' => 0,
            'tier1' => 0,
            'tier2' => 0,
            'tier3' => 0,
        ];
        $now = new \DateTimeImmutable();
        $recentSince = $now->modify('-7 days');

        foreach ($users as $user) {
            $summary['total']++;
            $summary['online'] += ($presenceStatusesByUserId[$user->id()] ?? FriendPresenceService::STATUS_OFFLINE) !== FriendPresenceService::STATUS_OFFLINE ? 1 : 0;
            $summary['recentlyConnected'] += $this->isWithinRange($user->lastSeenAt(), $recentSince, $now) ? 1 : 0;
            $summary['recentlyCreated'] += $this->isWithinRange($user->createdAt(), $recentSince, $now) ? 1 : 0;
            $summary['neverConnected'] += $user->lastSeenAt() === null ? 1 : 0;
            $summary['totalDecks'] += $deckCountsByUserId[$user->id()]['total'] ?? 0;

            match ($user->premiumTier()) {
                User::PREMIUM_TIER_1 => $summary['tier1']++,
                User::PREMIUM_TIER_2 => $summary['tier2']++,
                User::PREMIUM_TIER_3 => $summary['tier3']++,
                default => $summary['tier0']++,
            };
        }

        return $summary;
    }

    /**
     * @param list<User> $users
     * @param array<string, array{countryCode:string|null, countryName:string|null, appLanguage:string}> $localizationByUserId
     * @return list<array{countryCode:string|null, countryName:string|null, userCount:int, share:int}>
     */
    private function countriesSummary(array $users, array $localizationByUserId): array
    {
        if ($users === []) {
            return [];
        }

        $countries = [];
        foreach ($users as $user) {
            $localization = $localizationByUserId[$user->id()] ?? $this->emptyLocalization($user);
            $countryCode = $localization['countryCode'] !== null ? strtoupper(trim($localization['countryCode'])) : null;
            $countryName = $localization['countryName'] !== null ? trim($localization['countryName']) : null;
            $countryKey = $countryCode ?? 'unknown';

            if (!isset($countries[$countryKey])) {
                $countries[$countryKey] = [
                    'countryCode' => $countryCode,
                    'countryName' => $countryName === '' ? null : $countryName,
                    'userCount' => 0,
                ];
            }

            $countries[$countryKey]['userCount']++;
            if ($countries[$countryKey]['countryName'] === null && $countryName !== null && $countryName !== '') {
                $countries[$countryKey]['countryName'] = $countryName;
            }
        }

        $summary = array_map(
            static fn (array $country): array => [
                ...$country,
                'share' => (int) round(($country['userCount'] / count($users)) * 100),
            ],
            array_values($countries),
        );

        usort($summary, static fn (array $left, array $right): int => ($right['userCount'] <=> $left['userCount'])
            ?: strcasecmp((string) $left['countryName'], (string) $right['countryName']));

        return $summary;
    }

    /**
     * @param list<User> $users
     * @param array<string, array{countryCode:string|null, countryName:string|null, appLanguage:string}> $localizationByUserId
     * @param array<string, string> $presenceStatusesByUserId
     * @return list<array{countryCode:string|null, countryName:string|null, appLanguage:string, isActive:bool}>
     */
    private function localizationSummaryInput(array $users, array $localizationByUserId, array $presenceStatusesByUserId): array
    {
        return array_map(function (User $user) use ($localizationByUserId, $presenceStatusesByUserId): array {
            $localization = $localizationByUserId[$user->id()] ?? $this->emptyLocalization($user);

            return [
                'countryCode' => $localization['countryCode'],
                'countryName' => $localization['countryName'],
                'appLanguage' => $localization['appLanguage'],
                'isActive' => ($presenceStatusesByUserId[$user->id()] ?? FriendPresenceService::STATUS_OFFLINE) !== FriendPresenceService::STATUS_OFFLINE,
            ];
        }, $users);
    }

    private function countryNameForCode(string $countryCode): ?string
    {
        $normalizedCode = strtoupper(trim($countryCode));
        if (preg_match('/^[A-Z]{2}$/', $normalizedCode) !== 1) {
            return null;
        }

        try {
            $countryName = \Locale::getDisplayRegion('und_'.$normalizedCode, 'en');
        } catch (\Throwable) {
            return null;
        }

        $trimmedCountryName = trim($countryName);

        return $trimmedCountryName === '' || $trimmedCountryName === $normalizedCode
            ? null
            : $trimmedCountryName;
    }

    private function activeSessionsCount(User $user, EntityManagerInterface $entityManager): int
    {
        return (int) $entityManager->getRepository(RefreshSession::class)->createQueryBuilder('session')
            ->select('COUNT(session.id)')
            ->where('session.user = :user')
            ->andWhere('session.revokedAt IS NULL')
            ->andWhere('session.rotatedAt IS NULL')
            ->andWhere('session.expiresAt > :now')
            ->setParameter('user', $user)
            ->setParameter('now', new \DateTimeImmutable())
            ->getQuery()
            ->getSingleScalarResult();
    }

    /**
     * @param list<User> $users
     * @return array<string, int>
     */
    private function activeSessionCountsByUserId(array $users, EntityManagerInterface $entityManager): array
    {
        if ($users === []) {
            return [];
        }

        $countsByUserId = [];
        foreach ($users as $user) {
            $countsByUserId[$user->id()] = 0;
        }

        $rows = $entityManager->getConnection()->fetchAllAssociative(
            <<<'SQL'
SELECT user_id, COUNT(id) AS session_count
FROM refresh_session
WHERE user_id IN (:userIds)
  AND revoked_at IS NULL
  AND rotated_at IS NULL
  AND expires_at > :now
GROUP BY user_id
SQL,
            ['userIds' => array_keys($countsByUserId), 'now' => new \DateTimeImmutable()],
            ['userIds' => ArrayParameterType::STRING, 'now' => Types::DATETIME_IMMUTABLE],
        );

        foreach ($rows as $row) {
            $userId = $row['user_id'] ?? null;
            if (is_string($userId) && array_key_exists($userId, $countsByUserId)) {
                $countsByUserId[$userId] = (int) ($row['session_count'] ?? 0);
            }
        }

        return $countsByUserId;
    }

    private function authorizationRole(User $user): string
    {
        if ($user->hasRole(Role::OWNER)) {
            return Role::OWNER;
        }
        if ($user->hasRole(Role::ADMIN)) {
            return Role::ADMIN;
        }
        if ($user->hasRole(Role::SUPPORT)) {
            return Role::SUPPORT;
        }

        return Role::USER;
    }

    private function roleRank(string $role): int
    {
        return match ($role) {
            Role::OWNER => 4,
            Role::ADMIN => 3,
            Role::SUPPORT => 2,
            default => 1,
        };
    }

    private function logImpersonationBlocked(
        SecurityAuditLogger $securityAuditLogger,
        User $actor,
        Request $request,
        string $reason,
        ?string $targetUserId,
        ?string $targetRole = null,
    ): void {
        $securityAuditLogger->log('admin.impersonation.blocked', $actor->email(), $actor->id(), $request->getClientIp(), [
            'reason' => $reason,
            'targetUserId' => $targetUserId,
            'targetRole' => $targetRole,
        ]);
    }

    private function publishRoomRemovalResult(
        UserAccountDeletionResult $result,
        RoomEventPublisher $roomEventPublisher,
        GameEventPublisher $gameEventPublisher,
    ): void {
        foreach ($result->gameEvents as $entry) {
            $gameEventPublisher->publish($entry['game'], $entry['event']);
        }
        foreach ($result->controlPlaneEvents as $entry) {
            $gameEventPublisher->publishControlPlane($entry['game'], $entry['event']);
        }

        foreach ($result->changedRooms as $room) {
            $roomEventPublisher->publish($room, 'room.player.left');
        }

        foreach ($result->deletedRoomIds as $roomId) {
            $roomEventPublisher->publishDeleted($roomId);
        }
    }
}
