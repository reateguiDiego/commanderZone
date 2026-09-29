<?php

namespace App\Tests\Integration;

use App\Application\Moderation\ProfileModerationEvidenceWorker;
use App\Domain\Game\Game;
use App\Domain\Game\GameChatMessage;
use App\Domain\Report\ReportCategory;
use App\Domain\Report\ReportSource;
use App\Domain\Report\UserReport;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\Role;
use App\Domain\User\User;

final class ModerationReportsApiTest extends ApiTestCase
{
    public function testProfileReportUsesStrictReferencesAndKeepsHistoricalCounters(): void
    {
        $reporterToken = $this->registerAndLogin('moderation-profile-reporter@example.test', 'Profile Reporter');
        $targetToken = $this->registerAndLogin('moderation-profile-target@example.test', 'Profile Target');
        $reporterId = $this->currentUserId($reporterToken);
        $targetId = $this->currentUserId($targetToken);

        $this->jsonRequest('POST', '/reports', [
            'source' => 'profile',
            'category' => 'harassment',
            'reportedUserId' => $targetId,
        ], $reporterToken);

        self::assertResponseStatusCodeSame(201);
        $created = $this->jsonResponse()['report'];
        self::assertSame('profile', $created['source']);
        self::assertSame('collecting_evidence', $created['status']);
        self::assertArrayNotHasKey('evidence', $created);
        self::assertSame(1, (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT COUNT(*) FROM report_profile_evidence_queue WHERE report_id = :reportId',
            ['reportId' => $created['id']],
        ));
        self::assertSame(1, (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT reports_made_count FROM app_user WHERE id = :id',
            ['id' => $reporterId],
        ));
        self::assertSame(1, (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT reports_received_count FROM app_user WHERE id = :id',
            ['id' => $targetId],
        ));

        $this->jsonRequest('POST', '/reports', [
            'source' => 'profile',
            'category' => 'harassment',
            'reportedUserId' => $targetId,
        ], $reporterToken);
        self::assertResponseStatusCodeSame(409);

        $this->jsonRequest('POST', '/reports', [
            'source' => 'legacy',
            'category' => 'other_problem',
            'comment' => 'A legacy source must never be submitted.',
            'reportedUserId' => $targetId,
        ], $reporterToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/reports', [
            'source' => 'profile',
            'category' => 'harassment',
            'reportedUserId' => $targetId,
            'gameId' => 'forbidden-extra-reference',
        ], $reporterToken);
        self::assertResponseStatusCodeSame(400);

        $this->grantRole($targetId, Role::OWNER);
        $this->jsonRequest('POST', '/reports', [
            'source' => 'profile',
            'category' => 'harassment',
            'reportedUserId' => $targetId,
        ], $reporterToken);
        self::assertResponseStatusCodeSame(400);
    }

    public function testChatReportDerivesItsTargetAndMarksTheActiveGameForRetention(): void
    {
        $reporterToken = $this->registerAndLogin('moderation-chat-reporter@example.test', 'Chat Reporter');
        $reportedToken = $this->registerAndLogin('moderation-chat-target@example.test', 'Chat Target');
        $reporter = $this->userForToken($reporterToken);
        $reported = $this->userForToken($reportedToken);

        [$room, $game] = $this->createStartedGame($reporter, $reported);
        $message = new GameChatMessage($game, $reported, 'This target is derived from the message.');
        $this->entityManager->persist($message);
        $this->entityManager->flush();

        $this->jsonRequest('POST', '/reports', [
            'source' => 'chat_message',
            'category' => 'harassment',
            'gameId' => $game->id(),
            'messageId' => $message->messageId(),
            'reportedUserId' => $reported->id(),
        ], $reporterToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/reports', [
            'source' => 'chat_message',
            'category' => 'harassment',
            'gameId' => $game->id(),
            'messageId' => $message->messageId(),
        ], $reporterToken);
        self::assertResponseStatusCodeSame(201);
        $reportId = (string) $this->jsonResponse()['report']['id'];

        $this->entityManager->clear();
        $report = $this->entityManager->find(UserReport::class, $reportId);
        $persistedGame = $this->entityManager->find(Game::class, $game->id());
        self::assertInstanceOf(UserReport::class, $report);
        self::assertInstanceOf(Game::class, $persistedGame);
        self::assertSame(ReportSource::CHAT_MESSAGE, $report->source());
        self::assertSame($reported->id(), $report->reportedUser()?->id());
        self::assertSame($game->id(), $report->gameId());
        self::assertSame($message->messageId(), $report->messageId());
        self::assertTrue($persistedGame->requiresModerationReview());
        self::assertSame($room->id(), $persistedGame->room()->id());
    }

    public function testReviewCreatesOneStrikeAndPurgePreservesCountersAndStrikes(): void
    {
        $adminToken = $this->adminToken('moderation-review-admin@example.test', 'Review Admin');
        $reporterToken = $this->registerAndLogin('moderation-review-reporter@example.test', 'Review Reporter');
        $targetToken = $this->registerAndLogin('moderation-review-target@example.test', 'Review Target');
        $targetId = $this->currentUserId($targetToken);

        $this->jsonRequest('POST', '/reports', [
            'source' => 'profile',
            'category' => 'other_problem',
            'comment' => 'A concrete explanation is required.',
            'reportedUserId' => $targetId,
        ], $reporterToken);
        self::assertResponseStatusCodeSame(201);
        $reportId = (string) $this->jsonResponse()['report']['id'];

        $profileResult = static::getContainer()->get(ProfileModerationEvidenceWorker::class)->drain(250);
        self::assertSame(1, $profileResult['processed'], json_encode($profileResult, JSON_THROW_ON_ERROR));

        $this->jsonRequest('GET', '/admin/reports/summary', token: $adminToken);
        self::assertResponseIsSuccessful();
        self::assertSame(['pendingReviewCount' => 1], $this->jsonResponse());

        $this->jsonRequest('GET', '/admin/reports', token: $adminToken);
        self::assertResponseIsSuccessful();
        $list = $this->jsonResponse();
        self::assertCount(1, $list['reports']);
        self::assertArrayNotHasKey('evidence', $list['reports'][0]);

        $this->jsonRequest('GET', '/admin/reports/'.$reportId, token: $adminToken);
        self::assertResponseIsSuccessful();
        $detail = $this->jsonResponse()['report'];
        self::assertSame('Review Target', $detail['evidence']['reportedUserSnapshot']['user']['displayName']);

        $this->jsonRequest('PATCH', '/admin/reports/'.$reportId.'/resolution', [
            'outcome' => 'strike',
        ], $adminToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('PATCH', '/admin/reports/'.$reportId.'/resolution', [
            'outcome' => 'strike',
            'resolutionNote' => 'Reviewed evidence supports the decision.',
            'strikeDescription' => 'Harassing conduct in CommanderZone.',
        ], $adminToken);
        self::assertResponseIsSuccessful();
        $resolved = $this->jsonResponse();
        $strikeId = (string) $resolved['strike']['id'];
        self::assertSame('resolved', $resolved['report']['status']);
        self::assertSame('strike', $resolved['report']['resolution']['outcome']);

        $this->jsonRequest('GET', '/admin/users/'.$targetId.'/moderation', token: $adminToken);
        self::assertResponseIsSuccessful();
        self::assertSame(1, $this->jsonResponse()['user']['strikesCount']);
        self::assertCount(1, $this->jsonResponse()['strikes']);

        $this->jsonRequest('DELETE', '/admin/reports/'.$reportId, token: $adminToken);
        self::assertResponseStatusCodeSame(204);
        self::assertSame(1, (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT reports_received_count FROM app_user WHERE id = :id',
            ['id' => $targetId],
        ));
        self::assertSame(1, (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT COUNT(*) FROM user_strike WHERE id = :id',
            ['id' => $strikeId],
        ));

        $this->jsonRequest('DELETE', '/admin/users/'.$targetId.'/strikes/'.$strikeId, token: $adminToken);
        self::assertResponseIsSuccessful();
        self::assertSame(0, $this->jsonResponse()['strikesCount']);
    }

    /** @return array{0:Room,1:Game} */
    private function createStartedGame(User $reporter, User $reported): array
    {
        $room = new Room($reporter);
        $room->addPlayer(new RoomPlayer($room, $reporter));
        $room->addPlayer(new RoomPlayer($room, $reported));
        $game = new Game($room, [
            'version' => 1,
            'players' => [
                $reporter->id() => ['status' => 'active'],
                $reported->id() => ['status' => 'active'],
            ],
        ]);
        $room->start($game);
        $this->entityManager->persist($room);
        $this->entityManager->persist($game);
        $this->entityManager->flush();

        return [$room, $game];
    }

    private function userForToken(string $token): User
    {
        $user = $this->entityManager->find(User::class, $this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);

        return $user;
    }

    private function adminToken(string $email, string $displayName): string
    {
        $token = $this->registerAndLogin($email, $displayName);
        $this->grantRole($this->currentUserId($token), Role::ADMIN);

        return $token;
    }

    private function grantRole(string $userId, string $roleCode): void
    {
        $this->entityManager->getConnection()->executeStatement(
            'INSERT INTO app_user_role (user_id, role_code) VALUES (:userId, :roleCode) ON CONFLICT DO NOTHING',
            ['userId' => $userId, 'roleCode' => $roleCode],
        );
        $this->entityManager->clear();
    }
}
