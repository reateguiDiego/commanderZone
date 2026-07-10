<?php

namespace App\Application\User;

use GeoIp2\Database\Reader;
use GeoIp2\Exception\AddressNotFoundException;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Best-effort IP geolocation boundary.
 *
 * IP geolocation is contextual moderation metadata, not a source of truth and not an input
 * for automatic moderation decisions. Provider failures are fail-open.
 */
final class IpGeolocationService implements IpGeolocationServiceInterface
{
    private const SOURCE_LOCAL = 'local';
    private const SOURCE_UNCONFIGURED = 'unconfigured';
    private const SOURCE_UNRESOLVED = 'unresolved';
    private const SOURCE_PROVIDER = 'geoip2-country';
    private const SOURCE_ERROR = 'geoip-error';

    private ?Reader $reader = null;

    public function __construct(
        #[Autowire('%user_visit_geoip_country_database%')]
        private readonly string $countryDatabasePath = '',
    ) {
    }

    public function locate(?string $ip): IpGeolocationResult
    {
        $normalizedIp = trim((string) $ip);
        if ($normalizedIp === '' || !filter_var($normalizedIp, FILTER_VALIDATE_IP)) {
            return IpGeolocationResult::unresolved(self::SOURCE_UNRESOLVED);
        }

        if (!filter_var($normalizedIp, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return IpGeolocationResult::unresolved(self::SOURCE_LOCAL);
        }

        $reader = $this->reader();
        if ($reader === null) {
            return IpGeolocationResult::unresolved(self::SOURCE_UNCONFIGURED);
        }

        try {
            $record = $reader->country($normalizedIp);

            return new IpGeolocationResult(
                $record->country->isoCode,
                $record->country->name,
                $record->continent->code,
                self::SOURCE_PROVIDER,
            );
        } catch (AddressNotFoundException) {
            return IpGeolocationResult::unresolved(self::SOURCE_UNRESOLVED);
        } catch (\Throwable) {
            return IpGeolocationResult::unresolved(self::SOURCE_ERROR);
        }
    }

    private function reader(): ?Reader
    {
        if ($this->reader instanceof Reader) {
            return $this->reader;
        }

        $path = trim($this->countryDatabasePath);
        if ($path === '' || !is_file($path) || !is_readable($path)) {
            return null;
        }

        try {
            $this->reader = new Reader($path);
        } catch (\Throwable) {
            return null;
        }

        return $this->reader;
    }
}
