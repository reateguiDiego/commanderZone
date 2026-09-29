<?php

namespace App\Tests\Integration;

use App\Domain\Report\ReportCategory;
use App\Domain\Report\ReportSource;
use App\Domain\Report\UserReport;
use App\Domain\User\Role;
use App\Domain\User\User;

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
INSERT INTO user_report (id, reporter_id, reporter_display_name, reported_user_id, reported_user_display_name, source, category, comment, status, created_at, updated_at)
VALUES ('018fc000-0000-7000-8000-000000000001', :reporterId, 'Reporter User', :reportedId, 'Reported User', 'legacy', 'other_problem', 'Unsporting behavior in chat.', 'pending_review', NOW(), NOW())
SQL,
            ['reporterId' => $reporterId, 'reportedId' => $reportedId],
        );

        $this->jsonRequest('GET', '/admin/reports', token: $adminToken);

        self::assertResponseIsSuccessful();
        $reports = $this->jsonResponse()['reports'];
        self::assertCount(1, $reports);
        self::assertSame('Reporter User', $reports[0]['reporter']['displayName']);
        self::assertSame('Reported User', $reports[0]['reportedUser']['displayName']);
        self::assertArrayNotHasKey('email', $reports[0]['reportedUser']);
        self::assertSame('Unsporting behavior in chat.', $reports[0]['comment']);
        self::assertSame('pending_review', $reports[0]['status']);
    }

    public function testReportListUsesFrozenNamesAfterTheAccountsAreRenamed(): void
    {
        $adminToken = $this->adminToken('historic-reports-admin@example.test', 'Historic Admin');
        $reporterToken = $this->registerAndLogin('historic-reporter@example.test', 'Original Reporter');
        $reportedToken = $this->registerAndLogin('historic-reported@example.test', 'Original Reported');
        $reporter = $this->entityManager->find(User::class, $this->currentUserId($reporterToken));
        $reported = $this->entityManager->find(User::class, $this->currentUserId($reportedToken));
        self::assertInstanceOf(User::class, $reporter);
        self::assertInstanceOf(User::class, $reported);

        $report = new UserReport(
            $reporter,
            $reported,
            ReportSource::PROFILE,
            ReportCategory::HARASSMENT,
        );
        $report->markProfileEvidenceCollected([
            'capturedAt' => '2026-09-29T12:00:00+00:00',
            'user' => ['displayName' => 'Original Reported', 'publicHandle' => null],
            'folders' => [],
            'decks' => [],
            'ownedRooms' => [],
        ]);
        $this->entityManager->persist($report);
        $reporter->rename('Renamed Reporter');
        $reported->rename('Renamed Reported');
        $this->entityManager->flush();

        $this->jsonRequest('GET', '/admin/reports', token: $adminToken);

        self::assertResponseIsSuccessful();
        self::assertSame('Original Reporter', $this->jsonResponse()['reports'][0]['reporter']['displayName']);
        self::assertSame('Original Reported', $this->jsonResponse()['reports'][0]['reportedUser']['displayName']);
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
