<?php

namespace App\Tests\Integration;

use App\Application\User\IpGeolocationResult;
use App\Application\User\IpGeolocationServiceInterface;
use App\Application\User\UserDailyVisitRecorder;
use App\Domain\User\User;
use App\UI\Console\UserDailyVisitsPruneCommand;
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Component\Clock\MockClock;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\HttpFoundation\Request;

final class UserDailyVisitRecorderTest extends ApiTestCase
{
    private const HMAC_SECRET = '$ecretf0rt3st';
    private const DIRECT_CLIENT_IP = '192.168.50.42';
    private const DIRECT_CLIENT_PREFIX = '192.168.50.0/24';
    private const DIRECT_USER_AGENT = 'DailyVisitTest/1';
    private const TRUSTED_PROXY_IP = '10.0.0.1';
    private const UNTRUSTED_PROXY_IP = '10.0.0.2';
    private const FORWARDED_CLIENT_IP = '198.51.100.99';

    protected function setUp(): void
    {
        Request::setTrustedProxies([], Request::HEADER_X_FORWARDED_FOR);
        parent::setUp();
    }

    protected function tearDown(): void
    {
        Request::setTrustedProxies([], Request::HEADER_X_FORWARDED_FOR);
        parent::tearDown();
    }

    public function testFirstAuthenticatedRequestOfDayCreatesDailyVisit(): void
    {
        $email = 'daily-first@example.test';
        $token = $this->registerAndLogin($email, 'Daily First');
        $userId = $this->userIdForEmail($email);

        self::assertSame(0, $this->dailyVisitCount($userId));

        $this->authenticatedGet('/me', $token, [
            'REMOTE_ADDR' => self::DIRECT_CLIENT_IP,
            'HTTP_USER_AGENT' => self::DIRECT_USER_AGENT,
        ]);

        self::assertResponseIsSuccessful();
        self::assertSame(1, $this->dailyVisitCount($userId));
        $row = $this->dailyVisitRow($userId);
        self::assertSame(gmdate('Y-m-d'), $row['visit_date']);
        self::assertNotEmpty($row['first_seen_at']);
        self::assertSame(self::DIRECT_CLIENT_PREFIX, $row['ip_prefix']);
        self::assertSame(hash_hmac('sha256', self::DIRECT_USER_AGENT, self::HMAC_SECRET), $row['user_agent_hash']);
        self::assertNull($row['country_code']);
        self::assertSame('local', $row['geo_source']);
    }

    public function testSecondAuthenticatedRequestSameDayDoesNotDuplicate(): void
    {
        $email = 'daily-second@example.test';
        $token = $this->registerAndLogin($email, 'Daily Second');
        $userId = $this->userIdForEmail($email);

        $this->authenticatedGet('/me', $token, ['REMOTE_ADDR' => '203.0.113.43']);
        self::assertResponseIsSuccessful();
        $this->authenticatedGet('/me', $token, ['REMOTE_ADDR' => '203.0.113.44']);
        self::assertResponseIsSuccessful();

        self::assertSame(1, $this->dailyVisitCount($userId));
    }

    public function testConcurrentInsertPathDoesNotDuplicateBecauseOfUniqueConstraint(): void
    {
        $user = $this->createPersistedUser('daily-race@example.test', 'Daily Race');
        $clock = new MockClock('2026-07-08 10:00:00', 'UTC');

        $firstRecorder = $this->recorder($clock, new ArrayAdapter());
        $secondRecorder = $this->recorder($clock, new ArrayAdapter());

        self::assertTrue($firstRecorder->record($user, '198.51.100.7', 'RaceTest/1'));
        self::assertFalse($secondRecorder->record($user, '198.51.100.7', 'RaceTest/1'));
        self::assertSame(1, $this->dailyVisitCount($user->id()));
    }

    public function testAnonymousRequestDoesNotCreateDailyVisit(): void
    {
        $this->jsonRequest('GET', '/auth/email-availability?email=anon@example.test');

        self::assertResponseIsSuccessful();
        self::assertSame(0, $this->dailyVisitCount());
    }

    public function testCountryIsStoredWhenGeoIpResolves(): void
    {
        $user = $this->createPersistedUser('daily-country@example.test', 'Daily Country');
        $clock = new MockClock('2026-07-08 10:00:00', 'UTC');
        $recorder = $this->recorder(
            $clock,
            new ArrayAdapter(),
            new IpGeolocationResult('es', 'Spain', 'eu', 'test-geoip'),
        );

        self::assertTrue($recorder->record($user, '8.8.8.8', 'CountryTest/1'));

        $row = $this->dailyVisitRow($user->id());
        self::assertSame('ES', $row['country_code']);
        self::assertSame('Spain', $row['country_name']);
        self::assertSame('EU', $row['continent_code']);
        self::assertSame('test-geoip', $row['geo_source']);
        self::assertSame(
            'ES',
            (string) $this->entityManager->getConnection()->fetchOne(
                'SELECT last_seen_country_code FROM app_user WHERE id = :user_id',
                ['user_id' => $user->id()],
            ),
        );
    }

    public function testCountryIsNullWhenGeoIpDoesNotResolve(): void
    {
        $user = $this->createPersistedUser('daily-country-null@example.test', 'Daily Country Null');
        $clock = new MockClock('2026-07-08 10:00:00', 'UTC');
        $recorder = $this->recorder(
            $clock,
            new ArrayAdapter(),
            IpGeolocationResult::unresolved('unresolved'),
        );

        self::assertTrue($recorder->record($user, '8.8.4.4', 'CountryNullTest/1'));

        $row = $this->dailyVisitRow($user->id());
        self::assertNull($row['country_code']);
        self::assertNull($row['country_name']);
        self::assertNull($row['continent_code']);
        self::assertSame('unresolved', $row['geo_source']);
        self::assertNull($this->entityManager->getConnection()->fetchOne(
            'SELECT last_seen_country_code FROM app_user WHERE id = :user_id',
            ['user_id' => $user->id()],
        ));
    }

    public function testGeoIpProviderFailureDoesNotBreakRecording(): void
    {
        $user = $this->createPersistedUser('daily-country-error@example.test', 'Daily Country Error');
        $clock = new MockClock('2026-07-08 10:00:00', 'UTC');
        $geolocation = new class implements IpGeolocationServiceInterface {
            public function locate(?string $ip): IpGeolocationResult
            {
                throw new \RuntimeException('GeoIP unavailable');
            }
        };

        $recorder = new UserDailyVisitRecorder(
            $this->entityManager->getConnection(),
            new ArrayAdapter(),
            $clock,
            $geolocation,
            self::HMAC_SECRET,
        );

        self::assertTrue($recorder->record($user, '8.8.4.4', 'CountryErrorTest/1'));

        $row = $this->dailyVisitRow($user->id());
        self::assertNull($row['country_code']);
        self::assertSame('error', $row['geo_source']);
    }

    public function testIpIsStoredHashedAndRawIpIsNotStored(): void
    {
        $email = 'daily-ip@example.test';
        $token = $this->registerAndLogin($email, 'Daily Ip');
        $userId = $this->userIdForEmail($email);
        $rawIp = self::DIRECT_CLIENT_IP;

        $this->authenticatedGet('/me', $token, ['REMOTE_ADDR' => $rawIp]);

        self::assertResponseIsSuccessful();
        $row = $this->dailyVisitRow($userId);
        $expectedHash = hash_hmac('sha256', $rawIp, self::HMAC_SECRET);
        self::assertSame($expectedHash, $row['ip_hash']);
        self::assertNotSame($rawIp, $row['ip_hash']);
        self::assertStringNotContainsString($rawIp, $row['ip_hash']);
        self::assertStringNotContainsString($rawIp, json_encode($row, JSON_THROW_ON_ERROR));
        self::assertSame(self::DIRECT_CLIENT_PREFIX, $row['ip_prefix']);
        self::assertSame('local', $row['geo_source']);
        self::assertSame(
            $expectedHash,
            (string) $this->entityManager->getConnection()->fetchOne(
                'SELECT last_seen_ip_hash FROM app_user WHERE id = :user_id',
                ['user_id' => $userId],
            ),
        );
    }

    public function testChangeOfUtcDayCreatesNewDailyVisit(): void
    {
        $user = $this->createPersistedUser('daily-next-day@example.test', 'Daily Next');
        $clock = new MockClock('2026-07-08 23:55:00', 'UTC');
        $recorder = $this->recorder($clock, new ArrayAdapter());

        self::assertTrue($recorder->record($user, '198.51.100.10', null));
        $clock->modify('+10 minutes');
        self::assertTrue($recorder->record($user, '198.51.100.10', null));

        self::assertSame(
            ['2026-07-08', '2026-07-09'],
            $this->entityManager->getConnection()->fetchFirstColumn(
                'SELECT visit_date::text FROM user_daily_visit WHERE user_id = :user_id ORDER BY visit_date',
                ['user_id' => $user->id()],
            ),
        );
    }

    public function testPruneCommandDeletesVisitsOlderThanRetention(): void
    {
        $user = $this->createPersistedUser('daily-prune@example.test', 'Daily Prune');
        $this->insertDailyVisit($user->id(), '2026-05-01');
        $this->insertDailyVisit($user->id(), '2026-06-20');
        $command = new UserDailyVisitsPruneCommand(
            $this->entityManager->getConnection(),
            new MockClock('2026-07-08 12:00:00', 'UTC'),
            90,
        );

        $tester = new CommandTester($command);
        $status = $tester->execute(['--retention-days' => '30']);

        self::assertSame(Command::SUCCESS, $status, $tester->getDisplay());
        self::assertStringContainsString('Pruned 1 user daily visit row(s)', $tester->getDisplay());
        self::assertSame(
            ['2026-06-20'],
            $this->entityManager->getConnection()->fetchFirstColumn(
                'SELECT visit_date::text FROM user_daily_visit WHERE user_id = :user_id ORDER BY visit_date',
                ['user_id' => $user->id()],
            ),
        );
    }

    public function testTrustedClientIpIsResolvedByRequestGetClientIp(): void
    {
        $email = 'daily-trusted-ip@example.test';
        $token = $this->registerAndLogin($email, 'Daily Trusted');
        $userId = $this->userIdForEmail($email);

        Request::setTrustedProxies([self::TRUSTED_PROXY_IP], Request::HEADER_X_FORWARDED_FOR);
        try {
            $this->authenticatedGet('/me', $token, [
                'REMOTE_ADDR' => self::TRUSTED_PROXY_IP,
                'HTTP_X_FORWARDED_FOR' => self::FORWARDED_CLIENT_IP,
            ]);
        } finally {
            Request::setTrustedProxies([], Request::HEADER_X_FORWARDED_FOR);
        }

        self::assertResponseIsSuccessful();
        $row = $this->dailyVisitRow($userId);
        self::assertSame(hash_hmac('sha256', self::FORWARDED_CLIENT_IP, self::HMAC_SECRET), $row['ip_hash']);
        self::assertNotSame(hash_hmac('sha256', self::TRUSTED_PROXY_IP, self::HMAC_SECRET), $row['ip_hash']);
        self::assertSame('198.51.100.0/24', $row['ip_prefix']);
    }

    public function testUntrustedForwardedHeaderDoesNotOverrideRemoteAddr(): void
    {
        $email = 'daily-untrusted-forwarded-ip@example.test';
        $token = $this->registerAndLogin($email, 'Daily Untrusted');
        $userId = $this->userIdForEmail($email);

        Request::setTrustedProxies([], Request::HEADER_X_FORWARDED_FOR);
        $this->authenticatedGet('/me', $token, [
            'REMOTE_ADDR' => self::UNTRUSTED_PROXY_IP,
            'HTTP_X_FORWARDED_FOR' => self::FORWARDED_CLIENT_IP,
        ]);

        self::assertResponseIsSuccessful();
        $row = $this->dailyVisitRow($userId);
        self::assertSame(hash_hmac('sha256', self::UNTRUSTED_PROXY_IP, self::HMAC_SECRET), $row['ip_hash']);
        self::assertNotSame(hash_hmac('sha256', self::FORWARDED_CLIENT_IP, self::HMAC_SECRET), $row['ip_hash']);
        self::assertSame('10.0.0.0/24', $row['ip_prefix']);
        self::assertSame('local', $row['geo_source']);
    }

    public function testHealthzAndReadyzDoNotCreateDailyVisitEvenWithAuthHeader(): void
    {
        $email = 'daily-health@example.test';
        $token = $this->registerAndLogin($email, 'Daily Health');
        $userId = $this->userIdForEmail($email);

        $this->authenticatedGet('/healthz', $token);
        self::assertResponseIsSuccessful();
        $this->authenticatedGet('/readyz', $token);
        self::assertResponseIsSuccessful();

        self::assertSame(0, $this->dailyVisitCount($userId));
    }

    /**
     * @param array<string,string> $server
     */
    private function authenticatedGet(string $uri, string $token, array $server = []): void
    {
        $this->client->request(
            'GET',
            $uri,
            [],
            [],
            array_replace([
                'CONTENT_TYPE' => 'application/json',
                'HTTP_ACCEPT' => 'application/json',
                'HTTP_AUTHORIZATION' => 'Bearer '.$token,
                'REMOTE_ADDR' => self::DIRECT_CLIENT_IP,
                'HTTP_USER_AGENT' => self::DIRECT_USER_AGENT,
            ], $server),
            '',
        );
    }

    private function recorder(
        MockClock $clock,
        ArrayAdapter $cache,
        ?IpGeolocationResult $geolocationResult = null,
    ): UserDailyVisitRecorder {
        return new UserDailyVisitRecorder(
            $this->entityManager->getConnection(),
            $cache,
            $clock,
            $this->geolocation($geolocationResult),
            self::HMAC_SECRET,
        );
    }

    private function geolocation(?IpGeolocationResult $result): IpGeolocationServiceInterface
    {
        return new class($result ?? IpGeolocationResult::unresolved('unconfigured')) implements IpGeolocationServiceInterface {
            public function __construct(private readonly IpGeolocationResult $result)
            {
            }

            public function locate(?string $ip): IpGeolocationResult
            {
                return $this->result;
            }
        };
    }

    private function createPersistedUser(string $email, string $displayName): User
    {
        $user = new User($email, $displayName);
        $user->setPassword('hash');
        $this->entityManager->persist($user);
        $this->entityManager->flush();

        return $user;
    }

    private function userIdForEmail(string $email): string
    {
        $userId = $this->entityManager->getConnection()->fetchOne(
            'SELECT id FROM app_user WHERE email = :email',
            ['email' => $email],
        );
        self::assertIsString($userId);

        return $userId;
    }

    private function dailyVisitCount(?string $userId = null): int
    {
        if ($userId === null) {
            return (int) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM user_daily_visit');
        }

        return (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT COUNT(*) FROM user_daily_visit WHERE user_id = :user_id',
            ['user_id' => $userId],
        );
    }

    /**
     * @return array<string,string|null>
     */
    private function dailyVisitRow(string $userId): array
    {
        $row = $this->entityManager->getConnection()->fetchAssociative(
            'SELECT visit_date::text, first_seen_at::text, country_code, country_name, continent_code, ip_hash, ip_prefix, user_agent_hash, geo_source FROM user_daily_visit WHERE user_id = :user_id',
            ['user_id' => $userId],
        );
        self::assertIsArray($row);

        return $row;
    }

    private function insertDailyVisit(string $userId, string $visitDate): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO user_daily_visit (
    id,
    user_id,
    visit_date,
    first_seen_at,
    country_code,
    country_name,
    continent_code,
    ip_hash,
    ip_prefix,
    user_agent_hash,
    geo_source,
    created_at
) VALUES (
    :id,
    :user_id,
    :visit_date,
    :first_seen_at,
    NULL,
    NULL,
    NULL,
    :ip_hash,
    NULL,
    NULL,
    NULL,
    :created_at
)
SQL,
            [
                'id' => \Symfony\Component\Uid\Uuid::v7()->toRfc4122(),
                'user_id' => $userId,
                'visit_date' => $visitDate,
                'first_seen_at' => $visitDate.' 10:00:00',
                'ip_hash' => hash_hmac('sha256', '198.51.100.1', self::HMAC_SECRET),
                'created_at' => $visitDate.' 10:00:00',
            ],
        );
    }
}
