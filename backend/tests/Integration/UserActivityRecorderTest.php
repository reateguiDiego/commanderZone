<?php

namespace App\Tests\Integration;

use App\Application\User\UserActivityRecorder;
use App\Domain\User\User;
use Symfony\Component\Clock\MockClock;

final class UserActivityRecorderTest extends ApiTestCase
{
    public function testRefreshIsBoundedAndControllerFlushPreservesIt(): void
    {
        $user = new User('activity@example.test', 'Activity');
        $user->setPassword('unused');
        $this->entityManager->persist($user);
        $this->entityManager->flush();
        $clock = new MockClock('2026-09-13 12:00:00 UTC');
        $recorder = new UserActivityRecorder($this->entityManager, $clock);
        self::assertTrue($recorder->record($user));
        $first = $user->lastSeenAt();
        $queries = self::getContainer()->get('doctrine.debug_data_holder');
        $queries->reset();
        for ($i = 0; $i < 20; ++$i) {
            self::assertFalse($recorder->record($user));
        }
        self::assertSame([], $queries->getData()['default'] ?? [], 'Repeated activity must issue no SQL.');
        $clock->sleep(29);
        self::assertFalse($recorder->record($user));
        $clock->sleep(1);
        self::assertTrue($recorder->record($user));
        self::assertGreaterThan($first, $user->lastSeenAt());
        $user->setPassword('controller-change');
        $this->entityManager->flush();
        $this->entityManager->refresh($user);
        self::assertSame('12:00:30', $user->lastSeenAt()->format('H:i:s'));
    }

    public function testStaleRequestCannotOverwriteConcurrentRefreshOrOffline(): void
    {
        $user = new User('activity-race@example.test', 'Activity Race');
        $user->setPassword('unused');
        $this->entityManager->persist($user);
        $this->entityManager->flush();
        $clock = new MockClock('2026-09-13 12:00:00 UTC');
        $recorder = new UserActivityRecorder($this->entityManager, $clock);
        $db = $this->entityManager->getConnection();
        // Another request wins after this request loaded a null last_seen_at.
        $db->executeStatement('UPDATE app_user SET last_seen_at = :seen WHERE id = :id', ['seen' => '2026-09-13 12:00:00', 'id' => $user->id()]);
        self::assertFalse($recorder->record($user));
        self::assertSame('12:00:00', $user->lastSeenAt()->format('H:i:s'));
        $clock->sleep(31);
        // Explicit offline wins after this request loaded an online timestamp.
        $db->executeStatement('UPDATE app_user SET last_seen_at = NULL WHERE id = :id', ['id' => $user->id()]);
        self::assertFalse($recorder->record($user));
        self::assertNull($user->lastSeenAt());
        // A subsequent fresh request can immediately reconnect.
        self::assertTrue($recorder->record($user));
        self::assertSame('12:00:31', $user->lastSeenAt()->format('H:i:s'));
    }
}
