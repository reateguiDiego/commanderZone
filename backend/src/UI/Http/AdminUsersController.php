<?php

namespace App\UI\Http;

use App\Application\Auth\RefreshSessionService;
use App\Application\Friendship\FriendPresenceService;
use App\Application\User\UserAccountDeletionResult;
use App\Application\User\UserAccountDeletionService;
use App\Domain\Auth\RefreshSession;
use App\Domain\Room\Room;
use App\Domain\User\Role;
use App\Domain\User\User;
use App\Infrastructure\Realtime\GameEventPublisher;
use App\Infrastructure\Realtime\RoomEventPublisher;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class AdminUsersController extends ApiController
{
    #[Route('/admin/users', methods: ['GET'])]
    public function list(
        #[CurrentUser] User $actor,
        EntityManagerInterface $entityManager,
        FriendPresenceService $presence,
    ): JsonResponse
    {
        if (!$this->canAccessAdmin($actor)) {
            return $this->fail('Admin access is required.', 403);
        }

        $users = $entityManager->getRepository(User::class)->createQueryBuilder('user')
            ->leftJoin('user.roles', 'role')
            ->addSelect('role')
            ->orderBy('user.createdAt', 'DESC')
            ->getQuery()
            ->getResult();

        return $this->json([
            'users' => array_map(
                fn (User $user): array => $this->adminUserArray($user, $entityManager, $presence),
                array_values(array_filter($users, static fn (mixed $user): bool => $user instanceof User)),
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

        return $this->json(['user' => $this->adminUserArray($target, $entityManager, $presence)]);
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

        $target = $this->targetUser($id, $entityManager);
        if (!$target instanceof User) {
            return $this->fail('User not found.', 404);
        }
        $permissionError = $this->validateActorCanManagePremiumAndPresenceTarget($actor, $target);
        if ($permissionError instanceof JsonResponse) {
            return $permissionError;
        }

        $refreshSessions->revokeAllActiveSessionsForUser($target);

        return $this->json(['user' => $this->adminUserArray($target, $entityManager, $presence)]);
    }

    #[Route('/admin/users/{id}/rooms/leave', methods: ['POST'])]
    public function leaveRooms(
        string $id,
        #[CurrentUser] User $actor,
        EntityManagerInterface $entityManager,
        UserAccountDeletionService $accountDeletion,
        RoomEventPublisher $roomEventPublisher,
        GameEventPublisher $gameEventPublisher,
        FriendPresenceService $presence,
    ): JsonResponse {
        if (!$this->canAccessAdmin($actor)) {
            return $this->fail('Admin access is required.', 403);
        }

        $target = $this->targetUser($id, $entityManager);
        if (!$target instanceof User) {
            return $this->fail('User not found.', 404);
        }
        $permissionError = $this->validateActorCanManagePremiumAndPresenceTarget($actor, $target);
        if ($permissionError instanceof JsonResponse) {
            return $permissionError;
        }

        $result = $accountDeletion->removeFromRooms($target, $entityManager);
        $this->publishRoomRemovalResult($result, $roomEventPublisher, $gameEventPublisher);

        return $this->json(['user' => $this->adminUserArray($target, $entityManager, $presence)]);
    }

    private function canAccessAdmin(User $user): bool
    {
        return $user->hasRole(Role::ADMIN) || $user->hasRole(Role::OWNER);
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
     *   email: string,
     *   roles: list<string>,
     *   authorizationRole: string,
     *   premiumTier: string,
     *   lastConnectedAt: string|null,
     *   presenceStatus: string,
     *   isOnline: bool,
     *   activeRoomsCount: int,
     *   activeSessionsCount: int,
     *   createdAt: string
     * }
     */
    private function adminUserArray(User $user, EntityManagerInterface $entityManager, FriendPresenceService $presence): array
    {
        $presenceStatus = $presence->statusFor($user);

        return [
            'id' => $user->id(),
            'displayName' => $user->displayName(),
            'email' => $user->email(),
            'roles' => $user->getRoles(),
            'authorizationRole' => $this->authorizationRole($user),
            'premiumTier' => $user->premiumTier(),
            'lastConnectedAt' => $user->lastSeenAt()?->format(DATE_ATOM),
            'presenceStatus' => $presenceStatus,
            'isOnline' => $presenceStatus !== FriendPresenceService::STATUS_OFFLINE,
            'activeRoomsCount' => $this->activeRoomsCount($user, $entityManager),
            'activeSessionsCount' => $this->activeSessionsCount($user, $entityManager),
            'createdAt' => $user->createdAt()->format(DATE_ATOM),
        ];
    }

    private function activeRoomsCount(User $user, EntityManagerInterface $entityManager): int
    {
        return (int) $entityManager->getRepository(Room::class)->createQueryBuilder('room')
            ->select('COUNT(DISTINCT room.id)')
            ->innerJoin('room.players', 'player')
            ->where('room.status != :archived')
            ->andWhere('player.user = :user')
            ->setParameter('archived', Room::STATUS_ARCHIVED)
            ->setParameter('user', $user)
            ->getQuery()
            ->getSingleScalarResult();
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

    private function authorizationRole(User $user): string
    {
        if ($user->hasRole(Role::OWNER)) {
            return Role::OWNER;
        }
        if ($user->hasRole(Role::ADMIN)) {
            return Role::ADMIN;
        }

        return Role::USER;
    }

    private function roleRank(string $role): int
    {
        return match ($role) {
            Role::OWNER => 3,
            Role::ADMIN => 2,
            default => 1,
        };
    }

    private function publishRoomRemovalResult(
        UserAccountDeletionResult $result,
        RoomEventPublisher $roomEventPublisher,
        GameEventPublisher $gameEventPublisher,
    ): void {
        foreach ($result->gameEvents as $entry) {
            $gameEventPublisher->publish($entry['game'], $entry['event']);
        }

        foreach ($result->changedRooms as $room) {
            $roomEventPublisher->publish($room, 'room.player.left');
        }

        foreach ($result->deletedRoomIds as $roomId) {
            $roomEventPublisher->publishDeleted($roomId);
        }
    }
}
