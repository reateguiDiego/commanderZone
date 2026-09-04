<?php

namespace App\Tests\Integration;

use App\Domain\User\Role;

final class AdminUsersApiTest extends ApiTestCase
{
    public function testAdminUsersListRequiresAdminAccess(): void
    {
        $userToken = $this->registerAndLogin('regular-admin-list@example.test', 'Regular List');

        $this->jsonRequest('GET', '/admin/users', token: $userToken);

        self::assertResponseStatusCodeSame(403);
    }

    public function testOwnerCanListAndUpdateUserRoleAndPremiumTier(): void
    {
        $ownerToken = $this->ownerToken('owner-admin-users@example.test', 'Owner Admin');
        $targetToken = $this->registerAndLogin('target-admin-users@example.test', 'Target Admin');
        $targetId = $this->currentUserId($targetToken);
        $this->insertGoogleAuthIdentity($targetId, 'google-target-subject', 'google-target@example.test', true);
        $this->setUserLocalization($targetId, 'ES', 'Spain', 'es');
        $this->jsonRequest('POST', '/decks', ['name' => 'Private Admin Deck'], $targetToken);
        self::assertResponseStatusCodeSame(201);
        $this->jsonRequest('POST', '/decks', ['name' => 'Public Admin Deck 1', 'visibility' => 'public'], $targetToken);
        self::assertResponseStatusCodeSame(201);
        $this->jsonRequest('POST', '/decks', ['name' => 'Public Admin Deck 2', 'visibility' => 'public'], $targetToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('GET', '/admin/users', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $users = $this->jsonResponse()['users'];
        self::assertIsArray($users);
        self::assertNotEmpty($users);
        self::assertArrayHasKey('displayName', $users[0]);
        self::assertArrayHasKey('email', $users[0]);
        self::assertArrayHasKey('publicProfilePath', $users[0]);
        self::assertArrayHasKey('authProviders', $users[0]);
        self::assertArrayHasKey('lastConnectedAt', $users[0]);
        self::assertArrayHasKey('presenceStatus', $users[0]);
        self::assertArrayHasKey('isOnline', $users[0]);
        self::assertArrayHasKey('activeSessionsCount', $users[0]);
        self::assertArrayHasKey('deckCounts', $users[0]);
        self::assertArrayHasKey('createdAt', $users[0]);
        self::assertSame(1, $this->jsonResponse()['page']);
        self::assertSame($this->jsonResponse()['total'], $this->jsonResponse()['limit']);
        self::assertSame(1, $this->jsonResponse()['totalPages']);
        self::assertArrayHasKey('summary', $this->jsonResponse());
        self::assertArrayHasKey('countries', $this->jsonResponse());
        self::assertArrayHasKey('localizationSummary', $this->jsonResponse());
        self::assertSame(
            $this->jsonResponse()['summary']['total'],
            $this->jsonResponse()['localizationSummary']['all']['totalUsers'],
        );
        self::assertContains([
            'code' => 'ES',
            'name' => 'Spain',
            'userCount' => 1,
            'share' => 50,
        ], $this->jsonResponse()['localizationSummary']['all']['countries']);
        $targetUser = $this->adminUserById($users, $targetId);
        self::assertSame('/community/users/Target-Admin', $targetUser['publicProfilePath']);
        self::assertSame(['Google'], $targetUser['authProviders']);
        self::assertArrayNotHasKey('authIdentities', $targetUser);
        self::assertSame(['total' => 3, 'privateCount' => 1, 'publicCount' => 2], $targetUser['deckCounts']);
        self::assertSame(['countryCode' => 'ES', 'countryName' => 'Spain', 'appLanguage' => 'es'], $targetUser['localization']);

        $this->jsonRequest('PATCH', '/admin/users/'.$targetId, [
            'authorizationRole' => Role::ADMIN,
            'premiumTier' => 'tier2',
        ], $ownerToken);

        self::assertResponseIsSuccessful();
        $user = $this->jsonResponse()['user'];
        self::assertSame(Role::ADMIN, $user['authorizationRole']);
        self::assertSame('tier2', $user['premiumTier']);
        self::assertContains(Role::USER, $user['roles']);
        self::assertContains(Role::ADMIN, $user['roles']);
    }

    public function testSupportCanListAdminUsers(): void
    {
        $supportToken = $this->registerAndLogin('support-admin-list@example.test', 'Support List');
        $this->grantRole($this->currentUserId($supportToken), Role::SUPPORT);

        $this->jsonRequest('GET', '/admin/users', token: $supportToken);

        self::assertResponseIsSuccessful();
        self::assertIsArray($this->jsonResponse()['users']);
    }

    public function testAdminUsersListReturnsProvidersForEveryUser(): void
    {
        $ownerToken = $this->ownerToken('providers-owner@example.test', 'Providers Owner');
        $firstUserToken = $this->registerAndLogin('providers-first@example.test', 'Providers First');
        $secondUserToken = $this->registerAndLogin('providers-second@example.test', 'Providers Second');
        $firstUserId = $this->currentUserId($firstUserToken);
        $secondUserId = $this->currentUserId($secondUserToken);
        $this->insertGoogleAuthIdentity($firstUserId, 'first-subject', 'providers-first@example.test', true);
        $this->insertGoogleAuthIdentity($secondUserId, 'second-subject', 'providers-second@example.test', true);

        $this->jsonRequest('GET', '/admin/users', token: $ownerToken);

        self::assertResponseIsSuccessful();
        $users = $this->jsonResponse()['users'];
        self::assertSame(['Google'], $this->adminUserById($users, $firstUserId)['authProviders']);
        self::assertSame(['Google'], $this->adminUserById($users, $secondUserId)['authProviders']);
    }

    public function testAdminUsersListFiltersSortsAndPaginatesOnTheServer(): void
    {
        $ownerToken = $this->ownerToken('page-owner@example.test', 'Page Owner');
        $firstToken = $this->registerAndLogin('target-first@example.test', 'Target First');
        $secondToken = $this->registerAndLogin('target-second@example.test', 'Target Second');

        $this->jsonRequest('POST', '/decks', ['name' => 'First deck one'], $firstToken);
        self::assertResponseStatusCodeSame(201);
        $this->jsonRequest('POST', '/decks', ['name' => 'First deck two'], $firstToken);
        self::assertResponseStatusCodeSame(201);
        $this->jsonRequest('POST', '/decks', ['name' => 'Second deck'], $secondToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest(
            'GET',
            '/admin/users?q=target&status=all&sort=totalDecks&direction=desc&page=1&limit=1',
            token: $ownerToken,
        );

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(1, $response['page']);
        self::assertSame(1, $response['limit']);
        self::assertSame(2, $response['total']);
        self::assertSame(2, $response['totalPages']);
        self::assertCount(1, $response['users']);
        self::assertSame('Target First', $response['users'][0]['displayName']);
        self::assertSame(2, $response['users'][0]['deckCounts']['total']);
        self::assertSame(3, $response['summary']['totalDecks']);
    }

    /**
     * @param list<array<string,mixed>> $users
     *
     * @return array<string,mixed>
     */
    private function adminUserById(array $users, string $userId): array
    {
        foreach ($users as $user) {
            if (($user['id'] ?? null) === $userId) {
                return $user;
            }
        }

        self::fail(sprintf('Admin user "%s" was not returned.', $userId));
    }

    public function testAdminCannotModifyAuthorizationRoles(): void
    {
        $ownerToken = $this->ownerToken('role-owner@example.test', 'Role Owner');
        $adminToken = $this->registerAndLogin('role-admin@example.test', 'Role Admin');
        $adminId = $this->currentUserId($adminToken);
        $targetToken = $this->registerAndLogin('role-target@example.test', 'Role Target');
        $targetId = $this->currentUserId($targetToken);

        $this->jsonRequest('PATCH', '/admin/users/'.$adminId, [
            'authorizationRole' => Role::ADMIN,
        ], $ownerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('PATCH', '/admin/users/'.$targetId, [
            'authorizationRole' => Role::ADMIN,
        ], $adminToken);

        self::assertResponseStatusCodeSame(403);
    }

    public function testAdminCanManageLowerRoleUserButCannotChangeRoles(): void
    {
        $ownerToken = $this->ownerToken('lower-owner@example.test', 'Lower Owner');
        $adminToken = $this->registerAndLogin('lower-admin@example.test', 'Lower Admin');
        $adminId = $this->currentUserId($adminToken);
        $targetToken = $this->registerAndLogin('lower-target@example.test', 'Lower Target');
        $targetId = $this->currentUserId($targetToken);

        $this->jsonRequest('PATCH', '/admin/users/'.$adminId, [
            'authorizationRole' => Role::ADMIN,
        ], $ownerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('PATCH', '/admin/users/'.$targetId, [
            'premiumTier' => 'tier1',
        ], $adminToken);
        self::assertResponseIsSuccessful();
        self::assertSame('tier1', $this->jsonResponse()['user']['premiumTier']);

        $this->jsonRequest('PATCH', '/admin/users/'.$targetId, [
            'authorizationRole' => Role::ADMIN,
        ], $adminToken);

        self::assertResponseStatusCodeSame(403);
    }

    public function testOwnerCanAssignSupportRole(): void
    {
        $ownerToken = $this->ownerToken('support-role-owner@example.test', 'Support Owner');
        $targetToken = $this->registerAndLogin('support-role-target@example.test', 'Support Target');
        $targetId = $this->currentUserId($targetToken);

        $this->jsonRequest('PATCH', '/admin/users/'.$targetId, [
            'authorizationRole' => Role::SUPPORT,
        ], $ownerToken);

        self::assertResponseIsSuccessful();
        self::assertSame(Role::SUPPORT, $this->jsonResponse()['user']['authorizationRole']);
        self::assertContains(Role::SUPPORT, $this->jsonResponse()['user']['roles']);
    }

    public function testAdminCannotManageSameOrHigherRoleUsers(): void
    {
        $ownerToken = $this->ownerToken('hierarchy-owner@example.test', 'Hierarchy Owner');
        $adminToken = $this->registerAndLogin('hierarchy-admin@example.test', 'Hierarchy Admin');
        $adminId = $this->currentUserId($adminToken);
        $peerToken = $this->registerAndLogin('hierarchy-peer@example.test', 'Hierarchy Peer');
        $peerId = $this->currentUserId($peerToken);
        $ownerId = $this->currentUserId($ownerToken);

        $this->jsonRequest('PATCH', '/admin/users/'.$adminId, [
            'authorizationRole' => Role::ADMIN,
        ], $ownerToken);
        self::assertResponseIsSuccessful();
        $this->jsonRequest('PATCH', '/admin/users/'.$peerId, [
            'authorizationRole' => Role::ADMIN,
        ], $ownerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('PATCH', '/admin/users/'.$peerId, [
            'premiumTier' => 'tier2',
        ], $adminToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('POST', '/admin/users/'.$peerId.'/sessions/revoke', token: $adminToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('DELETE', '/admin/users/'.$peerId, token: $adminToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('PATCH', '/admin/users/'.$ownerId, [
            'premiumTier' => 'tier3',
        ], $adminToken);
        self::assertResponseStatusCodeSame(403);
    }

    public function testOwnerRoleCannotBeDuplicatedFromAdminApi(): void
    {
        $ownerToken = $this->ownerToken('single-owner@example.test', 'Single Owner');
        $targetToken = $this->registerAndLogin('second-owner@example.test', 'Second Owner');
        $targetId = $this->currentUserId($targetToken);

        $this->jsonRequest('PATCH', '/admin/users/'.$targetId, [
            'authorizationRole' => Role::OWNER,
        ], $ownerToken);

        self::assertResponseStatusCodeSame(409);
    }

    public function testOwnerCanImpersonateRegularUserWithoutIssuingRefreshCookie(): void
    {
        $ownerToken = $this->ownerToken('impersonate-owner@example.test', 'Impersonate Owner');
        $ownerId = $this->currentUserId($ownerToken);
        $targetToken = $this->registerAndLogin('impersonate-target@example.test', 'Impersonate Target');
        $targetId = $this->currentUserId($targetToken);
        $targetSessionCount = $this->activeRefreshSessionCount($targetId);

        $this->jsonRequest('POST', '/admin/users/'.$targetId.'/impersonate', token: $ownerToken);

        self::assertResponseIsSuccessful();
        self::assertNull($this->refreshCookieFromResponse());
        self::assertSame($targetSessionCount, $this->activeRefreshSessionCount($targetId));
        $response = $this->jsonResponse();
        self::assertSame($targetId, $response['user']['id']);
        self::assertTrue($response['impersonation']['active']);
        self::assertSame($ownerId, $response['impersonation']['impersonatorId']);
        self::assertSame($targetId, $response['impersonation']['targetUserId']);

        $this->jsonRequest('GET', '/me', token: (string) $response['token']);

        self::assertResponseIsSuccessful();
        self::assertSame($targetId, $this->jsonResponse()['user']['id']);
    }

    public function testOwnerCanImpersonateAdminUser(): void
    {
        $ownerToken = $this->ownerToken('impersonate-admin-owner@example.test', 'Admin Owner');
        $targetToken = $this->registerAndLogin('impersonate-admin-target@example.test', 'Admin Target');
        $targetId = $this->currentUserId($targetToken);

        $this->jsonRequest('PATCH', '/admin/users/'.$targetId, [
            'authorizationRole' => Role::ADMIN,
        ], $ownerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/admin/users/'.$targetId.'/impersonate', token: $ownerToken);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame($targetId, $response['user']['id']);
        self::assertContains(Role::ADMIN, $response['user']['roles']);
    }

    public function testImpersonatedSessionCannotCreateOrJoinRooms(): void
    {
        $ownerToken = $this->ownerToken('impersonate-room-owner@example.test', 'Room Owner');
        $targetToken = $this->registerAndLogin('impersonate-room-target@example.test', 'Room Target');
        $targetId = $this->currentUserId($targetToken);
        $impersonatedToken = $this->impersonatedToken($ownerToken, $targetId);

        $this->jsonRequest('GET', '/rooms', token: $impersonatedToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 3], $impersonatedToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 3], $ownerToken);
        self::assertResponseIsSuccessful();
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', token: $impersonatedToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', token: $targetToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/leave', token: $impersonatedToken);
        self::assertResponseIsSuccessful();
    }

    public function testImpersonatedSessionCannotOpenGameEndpoints(): void
    {
        $ownerToken = $this->ownerToken('impersonate-game-owner@example.test', 'Game Owner');
        $targetToken = $this->registerAndLogin('impersonate-game-target@example.test', 'Game Target');
        $targetId = $this->currentUserId($targetToken);
        $impersonatedToken = $this->impersonatedToken($ownerToken, $targetId);

        $this->jsonRequest('GET', '/games/00000000-0000-7000-8000-000000000000/snapshot', token: $impersonatedToken);

        self::assertResponseStatusCodeSame(403);
        self::assertSame('Impersonated sessions cannot enter rooms or games.', $this->jsonResponse()['error']);
    }

    public function testAdminCanImpersonateSupportAndRegularUsers(): void
    {
        $ownerToken = $this->ownerToken('impersonate-admin-matrix-owner@example.test', 'Block Owner');
        $adminToken = $this->registerAndLogin('impersonate-admin-user@example.test', 'Block Admin');
        $adminId = $this->currentUserId($adminToken);
        $supportToken = $this->registerAndLogin('impersonate-admin-support@example.test', 'Block Support');
        $supportId = $this->currentUserId($supportToken);
        $userToken = $this->registerAndLogin('impersonate-admin-target@example.test', 'Block Target');
        $userId = $this->currentUserId($userToken);

        $this->jsonRequest('PATCH', '/admin/users/'.$adminId, [
            'authorizationRole' => Role::ADMIN,
        ], $ownerToken);
        self::assertResponseIsSuccessful();
        $this->jsonRequest('PATCH', '/admin/users/'.$supportId, [
            'authorizationRole' => Role::SUPPORT,
        ], $ownerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/admin/users/'.$supportId.'/impersonate', token: $adminToken);
        self::assertResponseIsSuccessful();
        self::assertSame($supportId, $this->jsonResponse()['impersonation']['targetUserId']);

        $this->jsonRequest('POST', '/admin/users/'.$userId.'/impersonate', token: $adminToken);
        self::assertResponseIsSuccessful();
        self::assertSame($userId, $this->jsonResponse()['impersonation']['targetUserId']);

        $this->jsonRequest('POST', '/admin/users/'.$adminId.'/impersonate', token: $adminToken);
        self::assertResponseStatusCodeSame(400);
        self::assertSame('You cannot impersonate your own user.', $this->jsonResponse()['error']);
    }

    public function testSupportCanOnlyImpersonateRegularUsers(): void
    {
        $ownerToken = $this->ownerToken('impersonate-support-owner@example.test', 'Support Owner');
        $supportToken = $this->registerAndLogin('impersonate-support-user@example.test', 'Support User');
        $supportId = $this->currentUserId($supportToken);
        $adminToken = $this->registerAndLogin('impersonate-support-admin@example.test', 'Support Admin');
        $adminId = $this->currentUserId($adminToken);
        $targetToken = $this->registerAndLogin('impersonate-support-target@example.test', 'Support Target');
        $targetId = $this->currentUserId($targetToken);

        $this->jsonRequest('PATCH', '/admin/users/'.$supportId, [
            'authorizationRole' => Role::SUPPORT,
        ], $ownerToken);
        self::assertResponseIsSuccessful();
        $this->jsonRequest('PATCH', '/admin/users/'.$adminId, [
            'authorizationRole' => Role::ADMIN,
        ], $ownerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/admin/users/'.$targetId.'/impersonate', token: $supportToken);
        self::assertResponseIsSuccessful();
        self::assertSame($targetId, $this->jsonResponse()['impersonation']['targetUserId']);

        $this->jsonRequest('POST', '/admin/users/'.$supportId.'/impersonate', token: $supportToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/admin/users/'.$adminId.'/impersonate', token: $supportToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('PATCH', '/admin/users/'.$targetId, [
            'premiumTier' => 'tier1',
        ], $supportToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('DELETE', '/admin/users/'.$targetId, token: $supportToken);
        self::assertResponseStatusCodeSame(403);
    }

    public function testOwnerCannotImpersonateSelf(): void
    {
        $ownerToken = $this->ownerToken('impersonate-self-owner@example.test', 'Self Owner');
        $ownerId = $this->currentUserId($ownerToken);

        $this->jsonRequest('POST', '/admin/users/'.$ownerId.'/impersonate', token: $ownerToken);

        self::assertResponseStatusCodeSame(400);
    }

    public function testAdminCanRevokeUserSessions(): void
    {
        $ownerToken = $this->ownerToken('session-owner@example.test', 'Session Owner');
        $targetToken = $this->registerAndLogin('session-target@example.test', 'Session Target');
        $targetId = $this->currentUserId($targetToken);

        self::assertGreaterThan(0, $this->activeRefreshSessionCount($targetId));

        $this->jsonRequest('POST', '/admin/users/'.$targetId.'/sessions/revoke', token: $ownerToken);

        self::assertResponseIsSuccessful();
        self::assertSame(0, $this->jsonResponse()['user']['activeSessionsCount']);
        self::assertSame(0, $this->activeRefreshSessionCount($targetId));
    }

    public function testOwnerCanManageOwnPremiumButCannotDeleteSelf(): void
    {
        $ownerToken = $this->ownerToken('delete-owner@example.test', 'Delete Owner');
        $ownerId = $this->currentUserId($ownerToken);

        $this->jsonRequest('PATCH', '/admin/users/'.$ownerId, [
            'premiumTier' => 'tier1',
        ], $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertSame('tier1', $this->jsonResponse()['user']['premiumTier']);

        $this->jsonRequest('DELETE', '/admin/users/'.$ownerId, token: $ownerToken);

        self::assertResponseStatusCodeSame(400);
    }

    private function ownerToken(string $email, string $displayName): string
    {
        $token = $this->registerAndLogin($email, $displayName);
        $this->grantRole($this->currentUserId($token), Role::OWNER);

        return $token;
    }

    private function impersonatedToken(string $ownerToken, string $targetId): string
    {
        $this->jsonRequest('POST', '/admin/users/'.$targetId.'/impersonate', token: $ownerToken);
        self::assertResponseIsSuccessful();

        return (string) $this->jsonResponse()['token'];
    }

    private function grantRole(string $userId, string $roleCode): void
    {
        $this->entityManager->getConnection()->executeStatement(
            'INSERT INTO app_user_role (user_id, role_code) VALUES (:userId, :roleCode) ON CONFLICT DO NOTHING',
            ['userId' => $userId, 'roleCode' => $roleCode],
        );
        $this->entityManager->clear();
    }

    private function insertGoogleAuthIdentity(string $userId, string $providerUserId, string $providerEmail, bool $verified): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO auth_identity (
    id,
    user_id,
    provider,
    provider_user_id,
    provider_email,
    provider_email_verified,
    created_at,
    updated_at,
    last_used_at
) VALUES (
    :id,
    :userId,
    'google',
    :providerUserId,
    :providerEmail,
    :verified,
    '2026-07-01 10:00:00',
    '2026-07-01 10:00:00',
    '2026-07-02 10:00:00'
)
SQL,
            [
                'id' => 'google-admin-'.$providerUserId,
                'userId' => $userId,
                'providerUserId' => $providerUserId,
                'providerEmail' => $providerEmail,
                'verified' => $verified,
            ],
        );
        $this->entityManager->clear();
    }

    private function setUserLocalization(string $userId, string $countryCode, string $countryName, string $appLanguage): void
    {
        $connection = $this->entityManager->getConnection();
        $connection->executeStatement(
            'UPDATE app_user SET last_seen_country_code = :countryCode, app_language = :appLanguage WHERE id = :userId',
            ['countryCode' => $countryCode, 'appLanguage' => $appLanguage, 'userId' => $userId],
        );
        $connection->executeStatement(
            <<<'SQL'
INSERT INTO user_daily_visit (id, user_id, visit_date, first_seen_at, country_code, country_name, created_at)
VALUES (:id, :userId, '2026-09-03', '2026-09-03 10:00:00', :countryCode, :countryName, '2026-09-03 10:00:00')
ON CONFLICT (user_id, visit_date) DO UPDATE
SET first_seen_at = EXCLUDED.first_seen_at,
    country_code = EXCLUDED.country_code,
    country_name = EXCLUDED.country_name
SQL,
            [
                'id' => \Symfony\Component\Uid\Uuid::v7()->toRfc4122(),
                'userId' => $userId,
                'countryCode' => $countryCode,
                'countryName' => $countryName,
            ],
        );
        $this->entityManager->clear();
    }

    private function activeRefreshSessionCount(string $userId): int
    {
        return (int) $this->entityManager->getConnection()->fetchOne(
            <<<'SQL'
SELECT COUNT(*)
FROM refresh_session
WHERE user_id = :userId
  AND revoked_at IS NULL
  AND rotated_at IS NULL
  AND expires_at > NOW()
SQL,
            ['userId' => $userId],
        );
    }

    private function refreshCookieFromResponse(): ?\Symfony\Component\HttpFoundation\Cookie
    {
        foreach ($this->client->getResponse()->headers->getCookies() as $cookie) {
            if ($cookie->getName() === 'commanderzone.refresh') {
                return $cookie;
            }
        }

        return null;
    }
}
