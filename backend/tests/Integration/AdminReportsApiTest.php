<?php

namespace App\Tests\Integration;

use App\Domain\User\Role;

final class AdminReportsApiTest extends ApiTestCase
{
    public function testAdminReportsListRequiresAdminAccess(): void
    {
        $userToken = $this->registerAndLogin('regular-reports@example.test', 'Regular Reports');

        $this->jsonRequest('GET', '/admin/reports', token: $userToken);

        self::assertResponseStatusCodeSame(403);
    }

    public function testAdminCanListUserReports(): void
    {
        $adminToken = $this->adminToken('reports-admin@example.test', 'Reports Admin');
        $reporterToken = $this->registerAndLogin('reporter@example.test', 'Reporter User');
        $reportedToken = $this->registerAndLogin('reported@example.test', 'Reported User');
        $reporterId = $this->currentUserId($reporterToken);
        $reportedId = $this->currentUserId($reportedToken);

        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO user_report (id, reporter_id, reported_user_id, reason, created_at)
VALUES ('018fc000-0000-7000-8000-000000000001', :reporterId, :reportedId, 'Unsporting behavior in chat.', NOW())
SQL,
            ['reporterId' => $reporterId, 'reportedId' => $reportedId],
        );

        $this->jsonRequest('GET', '/admin/reports', token: $adminToken);

        self::assertResponseIsSuccessful();
        $reports = $this->jsonResponse()['reports'];
        self::assertCount(1, $reports);
        self::assertSame('Reporter User', $reports[0]['reporter']['displayName']);
        self::assertSame('reported@example.test', $reports[0]['reportedUser']['email']);
        self::assertSame('Unsporting behavior in chat.', $reports[0]['reason']);
    }

    private function adminToken(string $email, string $displayName): string
    {
        $token = $this->registerAndLogin($email, $displayName);
        $this->entityManager->getConnection()->executeStatement(
            'INSERT INTO app_user_role (user_id, role_code) VALUES (:userId, :roleCode) ON CONFLICT DO NOTHING',
            ['userId' => $this->currentUserId($token), 'roleCode' => Role::ADMIN],
        );
        $this->entityManager->clear();

        return $token;
    }
}
