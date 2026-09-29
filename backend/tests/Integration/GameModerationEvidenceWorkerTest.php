<?php

namespace App\Tests\Integration;

use App\Application\Moderation\GameModerationEvidenceQueueInterface;
use App\Application\Moderation\GameModerationEvidenceWorker;
use App\Application\Moderation\GameModerationRetentionService;
use App\Application\Moderation\ModerationSummaryPublisher;
use App\Application\Moderation\ProfileModerationEvidenceQueue;
use App\Application\Moderation\ProfileModerationEvidenceWorker;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckFolder;
use App\Domain\Game\Game;
use App\Domain\Game\GameChatMessage;
use App\Domain\Game\GameLogEntry;
use App\Domain\Report\GameModerationEvidenceSnapshot;
use App\Domain\Report\GameModerationEvidenceStatus;
use App\Domain\Report\ReportCategory;
use App\Domain\Report\ReportSource;
use App\Domain\Report\ReportState;
use App\Domain\Report\UserReport;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use App\Tests\Support\RecordingMercureHub;

final class GameModerationEvidenceWorkerTest extends ApiTestCase
{
    public function testItDefersAnActiveGameUntilLifecycleMakesItTerminalAndArchived(): void
    {
        [, , $room, $game] = $this->createStartedGame('active-evidence');
        $game->requireModerationReview();
        $this->entityManager->flush();
        $this->gameQueue()->enqueue($game->id());

        $result = $this->gameWorker()->drain(250);

        self::assertSame(['processed' => 0, 'retried' => 0, 'deferred' => 1], $result);
        $this->entityManager->clear();
        self::assertInstanceOf(Game::class, $this->entityManager->find(Game::class, $game->id()));
        self::assertInstanceOf(Room::class, $this->entityManager->find(Room::class, $room->id()));
        self::assertSame(0, $this->entityManager->getRepository(GameModerationEvidenceSnapshot::class)->count(['gameId' => $game->id()]));
        self::assertSame(1, (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT COUNT(*) FROM game_moderation_evidence_queue WHERE game_id = :gameId',
            ['gameId' => $game->id()],
        ));
    }

    public function testChatMessageReportsCaptureTheEntireChatAsReduced24HourEvidence(): void
    {
        [$reporter, $reportedUser, $room, $game] = $this->createStartedGame('complete-evidence');
        $reportedNameAtSend = $reportedUser->displayName();
        $publicMessage = new GameChatMessage($game, $reporter, 'Public moderation context.');
        $privateMessage = new GameChatMessage(
            $game,
            $reportedUser,
            'Private moderation evidence.',
            $reporter->id(),
            $reporter->displayName(),
        );
        // A chat report must not pull in the game log, even if its category
        // happens to be a gameplay category.
        $log = new GameLogEntry($game, 2, 'life.changed', 'Life total changed.', [
            'amount' => -4,
            'internalPayload' => 'must-not-enter-moderation-evidence',
        ]);
        $report = new UserReport(
            $reporter,
            $reportedUser,
            ReportSource::CHAT_MESSAGE,
            ReportCategory::INTENTIONAL_DISRUPTIVE_GAMEPLAY,
            null,
            $game,
            $privateMessage->messageId(),
        );
        // The source chat row owns the historical display name; a later
        // profile rename must not rewrite the evidence shown to reviewers.
        $reportedUser->rename('Renamed Target');
        $game->projectFinished($reporter->id(), new \DateTimeImmutable('2026-08-10T12:00:00+00:00'), 'last_player_standing');
        $game->requireModerationReview();
        $this->entityManager->persist($publicMessage);
        $this->entityManager->persist($privateMessage);
        $this->entityManager->persist($log);
        $this->entityManager->persist($report);
        $this->entityManager->flush();

        $this->setChatMessageTime($publicMessage->messageId(), '2026-08-10 13:04:00');
        $this->setChatMessageTime($privateMessage->messageId(), '2026-08-10 21:45:00');
        $this->setGameLogTime($log->id(), '2026-08-10 21:45:30');
        $gameId = $game->id();
        $roomId = $room->id();
        $reportId = $report->id();
        $this->entityManager->clear();
        $game = $this->entityManager->find(Game::class, $gameId);
        self::assertInstanceOf(Game::class, $game);
        $this->retention()->retainForEvidenceIfRequired($game);
        $this->entityManager->flush();

        RecordingMercureHub::reset();
        $result = $this->gameWorker()->drain(250);

        self::assertSame(['processed' => 1, 'retried' => 0, 'deferred' => 0], $result);
        $this->entityManager->clear();
        self::assertNull($this->entityManager->find(Game::class, $gameId));
        self::assertNull($this->entityManager->find(Room::class, $roomId));

        $snapshot = $this->entityManager->getRepository(GameModerationEvidenceSnapshot::class)->findOneBy(['gameId' => $gameId]);
        self::assertInstanceOf(GameModerationEvidenceSnapshot::class, $snapshot);
        $persistedReport = $this->entityManager->find(UserReport::class, $reportId);
        self::assertInstanceOf(UserReport::class, $persistedReport);
        self::assertSame(ReportState::PENDING_REVIEW, $persistedReport->status());
        $gameEvidence = $persistedReport->toAdminDetailArray()['evidence']['game'];
        self::assertIsArray($gameEvidence);
        self::assertSame(['capturedAt', 'chat', 'gameLog'], array_keys($gameEvidence));
        self::assertIsString($gameEvidence['capturedAt']);
        self::assertSame([
            ['time' => '13:04', 'actorDisplayName' => $reporter->displayName(), 'body' => 'Public moderation context.'],
            ['time' => '21:45', 'actorDisplayName' => $reportedNameAtSend, 'body' => 'Private moderation evidence.'],
        ], $gameEvidence['chat']);
        self::assertSame([], $gameEvidence['gameLog']);
        self::assertNull($persistedReport->reportedUserSnapshot());
        self::assertNotEmpty(array_filter(
            RecordingMercureHub::updates(),
            static fn (array $update): bool => $update['topics'] === [ModerationSummaryPublisher::TOPIC],
        ));
        self::assertSame(0, $this->gameWorker()->drain(250)['processed']);
    }

    public function testItCapturesLargeEvidenceInBoundedClaimsBeforeReleasingTheSource(): void
    {
        [$reporter, $reportedUser, $room, $game] = $this->createStartedGame('batched-evidence');
        $report = new UserReport(
            $reporter,
            $reportedUser,
            ReportSource::GAME_PLAYER,
            ReportCategory::INTENTIONAL_DISRUPTIVE_GAMEPLAY,
            null,
            $game,
        );
        for ($index = 0; $index < 251; ++$index) {
            $this->entityManager->persist(new GameChatMessage(
                $game,
                $reportedUser,
                sprintf('Moderation batch message %03d', $index),
            ));
        }
        $log = new GameLogEntry($game, 2, 'life.changed', 'A bounded log entry.');
        $game->projectFinished($reporter->id(), new \DateTimeImmutable('2026-08-10T12:00:00+00:00'), 'last_player_standing');
        $game->requireModerationReview();
        $this->entityManager->persist($log);
        $this->entityManager->persist($report);
        $this->entityManager->flush();

        $gameId = $game->id();
        $roomId = $room->id();
        $reportId = $report->id();
        $this->entityManager->clear();
        $game = $this->entityManager->find(Game::class, $gameId);
        self::assertInstanceOf(Game::class, $game);
        $this->retention()->retainForEvidenceIfRequired($game);
        $this->entityManager->flush();

        self::assertSame(['processed' => 1, 'retried' => 0, 'deferred' => 0], $this->gameWorker()->drain(1));

        $this->entityManager->clear();
        $snapshot = $this->entityManager->getRepository(GameModerationEvidenceSnapshot::class)->findOneBy(['gameId' => $gameId]);
        $persistedReport = $this->entityManager->find(UserReport::class, $reportId);
        self::assertInstanceOf(GameModerationEvidenceSnapshot::class, $snapshot);
        self::assertInstanceOf(UserReport::class, $persistedReport);
        self::assertSame(GameModerationEvidenceStatus::CAPTURING, $snapshot->status());
        self::assertSame(ReportState::COLLECTING_EVIDENCE, $persistedReport->status());
        self::assertSame(250, (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT COUNT(*) FROM game_moderation_evidence_chat_message WHERE snapshot_id = :snapshotId',
            ['snapshotId' => $snapshot->id()],
        ));
        self::assertSame(0, (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT COUNT(*) FROM game_moderation_evidence_log_entry WHERE snapshot_id = :snapshotId',
            ['snapshotId' => $snapshot->id()],
        ));
        self::assertInstanceOf(Game::class, $this->entityManager->find(Game::class, $gameId));
        self::assertInstanceOf(Room::class, $this->entityManager->find(Room::class, $roomId));
        self::assertSame(1, (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT COUNT(*) FROM game_moderation_evidence_queue WHERE game_id = :gameId',
            ['gameId' => $gameId],
        ));

        self::assertSame(['processed' => 1, 'retried' => 0, 'deferred' => 0], $this->gameWorker()->drain(1));

        $this->entityManager->clear();
        $persistedReport = $this->entityManager->find(UserReport::class, $reportId);
        self::assertInstanceOf(UserReport::class, $persistedReport);
        self::assertSame(ReportState::PENDING_REVIEW, $persistedReport->status());
        self::assertNull($this->entityManager->find(Game::class, $gameId));
        self::assertNull($this->entityManager->find(Room::class, $roomId));
        $gameEvidence = $persistedReport->toAdminDetailArray()['evidence']['game'];
        self::assertIsArray($gameEvidence);
        self::assertCount(251, $gameEvidence['chat']);
        self::assertCount(1, $gameEvidence['gameLog']);
        self::assertSame(['time', 'actorDisplayName', 'action'], array_keys($gameEvidence['gameLog'][0]));
        self::assertSame('A bounded log entry.', $gameEvidence['gameLog'][0]['action']);
        self::assertSame(0, $this->gameWorker()->drain(1)['processed']);
    }

    public function testGamePlayerReportsShareOneCondensedLogWhenAnyOpenReportRequiresIt(): void
    {
        [$firstReporter, $reportedUser, $room, $game] = $this->createStartedGame('shared-log');
        $secondReporter = new User('shared-log-second@example.test', 'Second Reporter');
        $secondReporter->setPassword('test-password-hash');
        $secondPlayer = new RoomPlayer($room, $secondReporter);
        $room->addPlayer($secondPlayer);
        $gameSnapshot = $game->snapshot();
        $gameSnapshot['players'][$secondReporter->id()] = ['status' => 'active'];
        $game->replaceSnapshot($gameSnapshot);

        $message = new GameChatMessage($game, $reportedUser, 'Full game chat remains available.');
        $firstLog = new GameLogEntry($game, 2, 'life.changed', 'Life total changed.', [
            'actorId' => $reportedUser->id(),
            'displayName' => $reportedUser->displayName(),
            'amount' => -4,
            'internalPayload' => 'must-not-be-exposed',
        ]);
        $secondLog = new GameLogEntry($game, 3, 'card.moved', 'A card changed zones.', [
            'cardNames' => ['A private card name that must not be copied'],
            'sourceInstanceId' => 'must-not-be-exposed',
            'nested' => ['must-not-be-exposed'],
        ]);
        $otherProblemReport = new UserReport(
            $firstReporter,
            $reportedUser,
            ReportSource::GAME_PLAYER,
            ReportCategory::OTHER_PROBLEM,
            'Please review the conduct at the table.',
            $game,
        );
        $disruptionReport = new UserReport(
            $secondReporter,
            $reportedUser,
            ReportSource::GAME_PLAYER,
            ReportCategory::INTENTIONAL_DISRUPTIVE_GAMEPLAY,
            null,
            $game,
        );
        $game->projectFinished($firstReporter->id(), new \DateTimeImmutable('2026-08-10T12:00:00+00:00'), 'last_player_standing');
        $game->requireModerationReview();

        $this->entityManager->persist($secondReporter);
        $this->entityManager->persist($secondPlayer);
        $this->entityManager->persist($message);
        $this->entityManager->persist($firstLog);
        $this->entityManager->persist($secondLog);
        $this->entityManager->persist($otherProblemReport);
        $this->entityManager->persist($disruptionReport);
        $this->entityManager->flush();

        $this->setChatMessageTime($message->messageId(), '2026-08-10 11:12:00');
        $this->setGameLogTime($firstLog->id(), '2026-08-10 21:45:30');
        $this->setGameLogTime($secondLog->id(), '2026-08-10 21:46:05');
        $gameId = $game->id();
        $otherProblemReportId = $otherProblemReport->id();
        $disruptionReportId = $disruptionReport->id();
        $this->entityManager->clear();
        $game = $this->entityManager->find(Game::class, $gameId);
        self::assertInstanceOf(Game::class, $game);
        $this->retention()->retainForEvidenceIfRequired($game);
        $this->entityManager->flush();

        self::assertSame(['processed' => 1, 'retried' => 0, 'deferred' => 0], $this->gameWorker()->drain(250));

        $this->entityManager->clear();
        $persistedOtherProblem = $this->entityManager->find(UserReport::class, $otherProblemReportId);
        $persistedDisruption = $this->entityManager->find(UserReport::class, $disruptionReportId);
        self::assertInstanceOf(UserReport::class, $persistedOtherProblem);
        self::assertInstanceOf(UserReport::class, $persistedDisruption);
        self::assertSame(ReportState::PENDING_REVIEW, $persistedOtherProblem->status());
        self::assertSame(ReportState::PENDING_REVIEW, $persistedDisruption->status());
        self::assertSame(
            $persistedDisruption->gameEvidenceSnapshot()?->id(),
            $persistedOtherProblem->gameEvidenceSnapshot()?->id(),
        );

        $gameEvidence = $persistedOtherProblem->toAdminDetailArray()['evidence']['game'];
        self::assertIsArray($gameEvidence);
        self::assertSame([
            ['time' => '11:12', 'actorDisplayName' => $reportedUser->displayName(), 'body' => 'Full game chat remains available.'],
        ], $gameEvidence['chat']);
        self::assertCount(2, $gameEvidence['gameLog']);
        self::assertSame('21:45:30', $gameEvidence['gameLog'][0]['time']);
        self::assertSame($reportedUser->displayName(), $gameEvidence['gameLog'][0]['actorDisplayName']);
        self::assertSame('Life total changed.', $gameEvidence['gameLog'][0]['action']);
        self::assertSame('21:46:05', $gameEvidence['gameLog'][1]['time']);
        self::assertNull($gameEvidence['gameLog'][1]['actorDisplayName']);
        self::assertSame('A card changed zones.', $gameEvidence['gameLog'][1]['action']);
        foreach ($gameEvidence['gameLog'] as $entry) {
            self::assertIsArray($entry);
            self::assertSame(['time', 'actorDisplayName', 'action'], array_keys($entry));
            self::assertArrayNotHasKey('id', $entry);
            self::assertArrayNotHasKey('version', $entry);
            self::assertArrayNotHasKey('type', $entry);
            self::assertArrayNotHasKey('createdAt', $entry);
            self::assertArrayNotHasKey('internalPayload', $entry);
            self::assertArrayNotHasKey('sourceInstanceId', $entry);
            self::assertArrayNotHasKey('nested', $entry);
            self::assertStringNotContainsString('private card name', mb_strtolower($entry['action']));
        }
        self::assertNull($persistedOtherProblem->reportedUserSnapshot());
        self::assertNull($persistedDisruption->reportedUserSnapshot());
    }

    public function testProfileEvidenceContainsOnlyEditableNamesAndAnImmutableCustomAvatar(): void
    {
        $reporter = new User('reduced-profile-reporter@example.test', 'Profile Reporter');
        $reportedUser = new User('reduced-profile-target@example.test', 'Profile Target');
        $reporter->setPassword('test-password-hash');
        $reportedUser->setPassword('test-password-hash');
        $reportedUser->uploadAvatarImage('data:image/png;base64,immutable-moderation-avatar');

        $privateFolder = new DeckFolder($reportedUser, 'Private folder name');
        $publicFolder = new DeckFolder($reportedUser, 'Public folder name');
        $publicFolder->setVisibility(DeckFolder::VISIBILITY_PUBLIC);
        $privateDeck = new Deck($reportedUser, 'Private deck name');
        $publicDeck = new Deck($reportedUser, 'Public deck name');
        $publicDeck->setVisibility(Deck::VISIBILITY_PUBLIC);
        $ownedPrivateRoom = new Room($reportedUser);
        $ownedPrivateRoom->setName('Private owned room name');
        $ownedPublicRoom = new Room($reportedUser);
        $ownedPublicRoom->setName('Public owned room name');
        $ownedPublicRoom->setVisibility(Room::VISIBILITY_PUBLIC);
        $foreignRoom = new Room($reporter);
        $foreignRoom->setName('This room belongs to the reporter');

        $report = new UserReport(
            $reporter,
            $reportedUser,
            ReportSource::PROFILE,
            ReportCategory::HARASSMENT,
        );
        $this->entityManager->persist($reporter);
        $this->entityManager->persist($reportedUser);
        $this->entityManager->persist($privateFolder);
        $this->entityManager->persist($publicFolder);
        $this->entityManager->persist($privateDeck);
        $this->entityManager->persist($publicDeck);
        $this->entityManager->persist($ownedPrivateRoom);
        $this->entityManager->persist($ownedPublicRoom);
        $this->entityManager->persist($foreignRoom);
        $this->entityManager->persist($report);
        $this->entityManager->flush();
        $reportId = $report->id();

        $this->profileQueue()->enqueue($reportId);
        self::assertSame(['processed' => 1, 'retried' => 0], $this->profileWorker()->drain(250));

        $this->entityManager->clear();
        $persistedReport = $this->entityManager->find(UserReport::class, $reportId);
        self::assertInstanceOf(UserReport::class, $persistedReport);
        self::assertSame(ReportState::PENDING_REVIEW, $persistedReport->status());
        $snapshot = $persistedReport->reportedUserSnapshot();
        self::assertIsArray($snapshot);
        self::assertSame(['capturedAt', 'user', 'folders', 'decks', 'ownedRooms'], array_keys($snapshot));
        self::assertIsString($snapshot['capturedAt']);
        self::assertSame([
            'displayName' => $reportedUser->displayName(),
            'publicHandle' => $reportedUser->publicHandle(),
            'avatar' => [
                'type' => 'upload',
                'imageData' => 'data:image/png;base64,immutable-moderation-avatar',
            ],
        ], $snapshot['user']);
        self::assertEqualsCanonicalizing(['Private folder name', 'Public folder name'], $this->snapshotItemNames($snapshot['folders']));
        self::assertEqualsCanonicalizing(['Private deck name', 'Public deck name'], $this->snapshotItemNames($snapshot['decks']));
        self::assertEqualsCanonicalizing(['Private owned room name', 'Public owned room name'], $this->snapshotItemNames($snapshot['ownedRooms']));
        foreach ([$snapshot['folders'], $snapshot['decks'], $snapshot['ownedRooms']] as $items) {
            foreach ($items as $item) {
                self::assertIsArray($item);
                self::assertSame(['name'], array_keys($item));
            }
        }
        self::assertNotContains('This room belongs to the reporter', $this->snapshotItemNames($snapshot['ownedRooms']));
        self::assertArrayNotHasKey('id', $snapshot['user']);
        self::assertArrayNotHasKey('publicProfilePath', $snapshot['user']);
        self::assertArrayNotHasKey('displayNameStyle', $snapshot['user']);
        self::assertArrayNotHasKey('imageUrl', $snapshot['user']['avatar']);
    }

    public function testLegacyReportsNeverBackfillProfileOrGameEvidence(): void
    {
        $reporter = new User('legacy-evidence-reporter@example.test', 'Legacy Reporter');
        $reportedUser = new User('legacy-evidence-target@example.test', 'Legacy Target');
        $reporter->setPassword('test-password-hash');
        $reportedUser->setPassword('test-password-hash');
        $legacyReport = UserReport::legacy(
            $reporter,
            $reportedUser,
            'Migrated historical report.',
            new \DateTimeImmutable('2026-08-10T12:00:00+00:00'),
        );
        $this->entityManager->persist($reporter);
        $this->entityManager->persist($reportedUser);
        $this->entityManager->persist($legacyReport);
        $this->entityManager->flush();
        $legacyReportId = $legacyReport->id();

        // A stale/accidental queue row must still not invent historic data.
        $this->profileQueue()->enqueue($legacyReportId);
        self::assertSame(['processed' => 1, 'retried' => 0], $this->profileWorker()->drain(250));

        $this->entityManager->clear();
        $persistedReport = $this->entityManager->find(UserReport::class, $legacyReportId);
        self::assertInstanceOf(UserReport::class, $persistedReport);
        self::assertSame(ReportSource::LEGACY, $persistedReport->source());
        self::assertSame(ReportState::PENDING_REVIEW, $persistedReport->status());
        self::assertFalse($persistedReport->requiresProfileEvidence());
        self::assertFalse($persistedReport->requiresGameEvidence());
        self::assertNull($persistedReport->reportedUserSnapshot());
        self::assertNull($persistedReport->gameEvidenceSnapshot());
    }

    /** @return array{0:User,1:User,2:Room,3:Game} */
    private function createStartedGame(string $prefix): array
    {
        // Display names are limited to 20 characters by the real schema;
        // keep fixture labels independent from descriptive test identifiers.
        $reporter = new User($prefix.'-reporter@example.test', 'Evidence Reporter');
        $reportedUser = new User($prefix.'-reported@example.test', 'Evidence Target');
        $reporter->setPassword('test-password-hash');
        $reportedUser->setPassword('test-password-hash');
        $room = new Room($reporter);
        $room->addPlayer(new RoomPlayer($room, $reporter));
        $room->addPlayer(new RoomPlayer($room, $reportedUser));
        $game = new Game($room, [
            'version' => 1,
            'players' => [
                $reporter->id() => ['status' => 'active'],
                $reportedUser->id() => ['status' => 'active'],
            ],
        ]);
        $room->start($game);
        $this->entityManager->persist($reporter);
        $this->entityManager->persist($reportedUser);
        $this->entityManager->persist($room);
        $this->entityManager->persist($game);
        $this->entityManager->flush();

        return [$reporter, $reportedUser, $room, $game];
    }

    private function gameQueue(): GameModerationEvidenceQueueInterface
    {
        return static::getContainer()->get(GameModerationEvidenceQueueInterface::class);
    }

    private function gameWorker(): GameModerationEvidenceWorker
    {
        return static::getContainer()->get(GameModerationEvidenceWorker::class);
    }

    private function retention(): GameModerationRetentionService
    {
        return static::getContainer()->get(GameModerationRetentionService::class);
    }

    private function profileQueue(): ProfileModerationEvidenceQueue
    {
        return static::getContainer()->get(ProfileModerationEvidenceQueue::class);
    }

    private function profileWorker(): ProfileModerationEvidenceWorker
    {
        return static::getContainer()->get(ProfileModerationEvidenceWorker::class);
    }

    private function setChatMessageTime(string $messageId, string $createdAt): void
    {
        $this->entityManager->getConnection()->executeStatement(
            'UPDATE game_chat_message SET created_at = :createdAt WHERE message_id = :messageId',
            ['createdAt' => $createdAt, 'messageId' => $messageId],
        );
    }

    private function setGameLogTime(string $logId, string $createdAt): void
    {
        $this->entityManager->getConnection()->executeStatement(
            'UPDATE game_log_entry SET created_at = :createdAt WHERE id = :logId',
            ['createdAt' => $createdAt, 'logId' => $logId],
        );
    }

    /** @param list<array{name:string}> $items @return list<string> */
    private function snapshotItemNames(array $items): array
    {
        return array_values(array_map(
            static fn (array $item): string => $item['name'],
            $items,
        ));
    }
}
