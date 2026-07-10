<?php

namespace App\Application\User;

/**
 * Best-effort IP geolocation boundary.
 *
 * This implementation intentionally returns unresolved results until a local country database
 * is wired behind the interface. IP geolocation is contextual moderation metadata, not a source
 * of truth and not an input for automatic moderation decisions.
 */
final class IpGeolocationService implements IpGeolocationServiceInterface
{
    public function locate(?string $ip): IpGeolocationResult
    {
        $normalizedIp = trim((string) $ip);
        if ($normalizedIp === '' || !filter_var($normalizedIp, FILTER_VALIDATE_IP)) {
            return IpGeolocationResult::unresolved('unresolved');
        }

        if (!filter_var($normalizedIp, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return IpGeolocationResult::unresolved('local');
        }

        return IpGeolocationResult::unresolved('unconfigured');
    }
}
