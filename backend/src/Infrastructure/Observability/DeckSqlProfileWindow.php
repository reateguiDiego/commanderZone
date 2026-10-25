<?php

namespace App\Infrastructure\Observability;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/** A shared, bounded capture budget across PHP workers in this API container. */
final class DeckSqlProfileWindow
{
    public function __construct(
        #[Autowire('%kernel.cache_dir%')] private readonly string $cacheDir,
        #[Autowire(env: 'default::DECK_DETAIL_SQL_PROFILE_USER_ID')] private readonly ?string $userId = null,
        #[Autowire(env: 'default::DECK_DETAIL_SQL_PROFILE_UNTIL')] private readonly ?string $until = null,
    ) {
    }

    public function configured(): bool
    {
        return ($this->userId ?? '') !== '' || ($this->until ?? '') !== '';
    }

    public function claim(?string $userId): bool
    {
        if (!$userId || $userId !== $this->userId || !ctype_digit($this->until ?? '') || (int) $this->until <= time()) {
            return false;
        }
        // No user IDs in filenames. Failed/unwritable budget storage disables profiling.
        $file = $this->cacheDir.'/deck-sql-profile-'.hash('sha256', $userId.'|'.$this->until).'.budget';
        $handle = @fopen($file, 'c+');
        if ($handle === false) return false;
        try {
            if (!flock($handle, LOCK_EX)) return false;
            $raw = stream_get_contents($handle);
            if ($raw === false || ($raw !== '' && !ctype_digit($raw))) return false;
            $used = (int) $raw;
            if ($used >= 40 || (int) $this->until <= time()) return false;
            rewind($handle);
            $next = (string) ($used + 1);
            return fwrite($handle, $next) === strlen($next) && fflush($handle);
        } finally {
            fclose($handle);
        }
    }
}
