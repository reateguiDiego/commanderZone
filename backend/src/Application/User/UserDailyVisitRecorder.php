<?php

namespace App\Application\User;

use App\Domain\User\User;
use Doctrine\DBAL\Connection;
use Symfony\Component\Clock\ClockInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Uid\Uuid;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;

/**
 * Records minimal daily authenticated visits.
 *
 * IP hashes, coarse prefixes, and geolocation are personal or potentially personal data:
 * do not expose them in public UI/API, do not use them for automatic moderation decisions,
 * and prune rows with app:user-daily-visits:prune according to the configured retention.
 */
final class UserDailyVisitRecorder
{
    private readonly \DateTimeZone $utc;

    public function __construct(
        private readonly Connection $connection,
        private readonly CacheInterface $cache,
        private readonly ClockInterface $clock,
        private readonly IpGeolocationServiceInterface $geolocation,
        #[Autowire('%user_visit_hash_secret%')]
        private readonly string $hmacSecret,
    ) {
        if (trim($this->hmacSecret) === '') {
            throw new \LogicException('USER_VISIT_HASH_SECRET or APP_SECRET must be configured to hash user daily visit IP metadata.');
        }

        $this->utc = new \DateTimeZone('UTC');
    }

    public function record(User $user, ?string $clientIp, ?string $userAgent): bool
    {
        $now = $this->clock->now()->setTimezone($this->utc);
        $visitDate = $now->format('Y-m-d');
        $inserted = false;
        $cacheKey = sprintf('user_daily_visit.%s.%s', $user->id(), $visitDate);

        $this->cache->get($cacheKey, function (ItemInterface $item) use ($user, $clientIp, $userAgent, $now, $visitDate, &$inserted): bool {
            $item->expiresAfter($this->secondsUntilNextUtcDay($now));
            $inserted = $this->insertDailyVisit($user, $clientIp, $userAgent, $now, $visitDate);

            return true;
        });

        return $inserted;
    }

    private function insertDailyVisit(User $user, ?string $clientIp, ?string $userAgent, \DateTimeImmutable $now, string $visitDate): bool
    {
        $normalizedIp = $this->normalizeIp($clientIp);
        $geolocation = $this->locate($normalizedIp);
        $ipHash = $normalizedIp !== null ? $this->hash($normalizedIp) : null;
        $timestamp = $now->format('Y-m-d H:i:s');
        $rowCount = $this->connection->executeStatement(
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
    :country_code,
    :country_name,
    :continent_code,
    :ip_hash,
    :ip_prefix,
    :user_agent_hash,
    :geo_source,
    :created_at
)
ON CONFLICT (user_id, visit_date) DO NOTHING
SQL,
            [
                'id' => Uuid::v7()->toRfc4122(),
                'user_id' => $user->id(),
                'visit_date' => $visitDate,
                'first_seen_at' => $timestamp,
                'country_code' => $geolocation->countryCode(),
                'country_name' => $geolocation->countryName(),
                'continent_code' => $geolocation->continentCode(),
                'ip_hash' => $ipHash,
                'ip_prefix' => $this->ipPrefix($normalizedIp),
                'user_agent_hash' => $this->hashNullable($userAgent),
                'geo_source' => $geolocation->source(),
                'created_at' => $timestamp,
            ],
        );

        if ($rowCount < 1) {
            return false;
        }

        $this->connection->executeStatement(
            <<<'SQL'
UPDATE app_user
SET last_seen_at = :last_seen_at,
    last_seen_country_code = :last_seen_country_code,
    last_seen_ip_hash = :last_seen_ip_hash
WHERE id = :user_id
SQL,
            [
                'last_seen_at' => $timestamp,
                'last_seen_country_code' => $geolocation->countryCode(),
                'last_seen_ip_hash' => $ipHash,
                'user_id' => $user->id(),
            ],
        );

        return true;
    }

    private function normalizeIp(?string $clientIp): ?string
    {
        $ip = trim((string) $clientIp);
        if ($ip === '' || !filter_var($ip, FILTER_VALIDATE_IP)) {
            return null;
        }

        return $ip;
    }

    private function hashNullable(?string $value): ?string
    {
        $normalized = trim((string) $value);
        if ($normalized === '') {
            return null;
        }

        return $this->hash($normalized);
    }

    private function hash(string $value): string
    {
        return hash_hmac('sha256', $value, $this->hmacSecret);
    }

    private function locate(?string $ip): IpGeolocationResult
    {
        try {
            return $this->geolocation->locate($ip);
        } catch (\Throwable) {
            return IpGeolocationResult::unresolved('error');
        }
    }

    private function ipPrefix(?string $ip): ?string
    {
        if ($ip === null) {
            return null;
        }

        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $parts = explode('.', $ip);

            return sprintf('%s.%s.%s.0/24', $parts[0], $parts[1], $parts[2]);
        }

        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
            return null;
        }

        $packed = inet_pton($ip);
        if ($packed === false) {
            return null;
        }

        $groups = unpack('n8', $packed);
        if ($groups === false) {
            return null;
        }

        return sprintf('%x:%x:%x::/48', $groups[1], $groups[2], $groups[3]);
    }

    private function secondsUntilNextUtcDay(\DateTimeImmutable $now): int
    {
        $nextDay = $now->setTime(0, 0)->modify('+1 day');

        return max(60, $nextDay->getTimestamp() - $now->getTimestamp());
    }
}
