<?php

namespace App\Tests\Integration;

use App\Application\Moderation\GameModerationRetentionService;
use App\Application\Moderation\ModerationSummaryPublisher;
use App\Domain\Game\Game;
use App\Domain\Report\ReportCategory;
use App\Domain\Report\ReportResolutionOutcome;
use App\Domain\Report\ReportSource;
use App\Domain\Report\UserReport;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use App\Tests\Support\RecordingMercureHub;

final class ModerationAccountDeletionTest extends ApiTestCase
{
    public function testDeletingAnyGameParticipantPurgesAllIncompleteGameReportsButPreservesResolvedHistory(): void
    {
        $ownerToken = $this->registerAndLogin('moderation-delete-owner@example.test', 'Delete Owner');
        $targetToken = $this->registerAndLogin('moderation-delete-target@example.test', 'Delete Target');
        $participantToken = $this->registerAndLogin('moderation-delete-participant@example.test', 'Delete Player');
        $owner = $this->userForToken($ownerToken);
        $target = $this->userForToken($targetToken);
        $participant = $this->userForToken($participantToken);
        $participantId = $participant->id();

        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $room->addPlayer(new RoomPlayer($room, $target));
        $room->addPlayer(new RoomPlayer($room, $participant));
        $game = new Game($room, [
            'version' => 1,
            'players' => [
                $owner->id() => ['status' => 'active'],
                $target->id() => ['status' => 'active'],
                $participant->id() => ['status' => 'active'],
            ],
        ]);
        $room->start($game);
        $game->projectFinished($owner->id(), new \DateTimeImmutable('2026-08-10T12:00:00+00:00'), 'last_player_standing');
        $game->requireModerationReview();
        $incompleteGameReport = new UserReport(
            $owner,
            $target,
            ReportSource::GAME_PLAYER,
            ReportCategory::HARASSMENT,
            null,
            $game,
        );
        $resolvedHistory = UserReport::legacy(
            $participant,
            $target,
            'Resolved history must remain after account deletion.',
            new \DateTimeImmutable('2026-08-09T12:00:00+00:00'),
        );
        $resolvedHistory->resolve(ReportResolutionOutcome::NOTHING, null, $owner);

        $this->entityManager->persist($room);
        $this->entityManager->persist($game);
        $this->entityManager->persist($incompleteGameReport);
        $this->entityManager->persist($resolvedHistory);
        $this->entityManager->flush();
        static::getContainer()->get(GameModerationRetentionService::class)->retainForEvidenceIfRequired($game);
        $this->entityManager->flush();

        RecordingMercureHub::reset();
        $this->jsonRequest('DELETE', '/me', token: $participantToken);

        self::assertResponseStatusCodeSame(204);
        $this->entityManager->clear();
        self::assertNull($this->entityManager->find(User::class, $participantId));
        self::assertNull($this->entityManager->find(UserReport::class, $incompleteGameReport->id()));

        $persistedHistory = $this->entityManager->find(UserReport::class, $resolvedHistory->id());
        self::assertInstanceOf(UserReport::class, $persistedHistory);
        self::assertNull($persistedHistory->reporter());
        self::assertSame($target->id(), $persistedHistory->reportedUser()?->id());
        self::assertSame('Delete Player', $persistedHistory->toAdminDetailArray()['reporter']['displayName']);

        $persistedGame = $this->entityManager->find(Game::class, $game->id());
        $persistedRoom = $this->entityManager->find(Room::class, $room->id());
        self::assertInstanceOf(Game::class, $persistedGame);
        self::assertInstanceOf(Room::class, $persistedRoom);
        self::assertSame(Room::STATUS_ARCHIVED, $persistedRoom->status());
        self::assertTrue($persistedGame->requiresModerationReview());
        self::assertSame(1, (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT COUNT(*) FROM game_moderation_evidence_queue WHERE game_id = :gameId',
            ['gameId' => $game->id()],
        ));
        self::assertNotEmpty(array_filter(
            RecordingMercureHub::updates(),
            static fn (array $update): bool => $update['topics'] === [ModerationSummaryPublisher::TOPIC],
        ));
        self::assertSame([], array_values(array_filter(
            RecordingMercureHub::updates(),
            static fn (array $update): bool => $update['topics'] === ['rooms/'.$room->id().'/waiting']
                && (json_decode($update['data'], true)['type'] ?? null) === 'room.player.left',
        )));
    }

    private function userForToken(string $token): User
    {
        $user = $this->entityManager->find(User::class, $this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);

        return $user;
    }
}
