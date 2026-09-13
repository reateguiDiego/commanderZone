<?php

namespace App\Application\Community;

use App\Infrastructure\Observability\RequestPerformanceContext;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\Cache\ItemInterface;
use Symfony\Contracts\Cache\TagAwareCacheInterface;

final class CommunityCache
{
    public function __construct(
        #[Autowire(service: 'cache.community')] private readonly TagAwareCacheInterface $cache,
        private readonly RequestPerformanceContext $performance,
    ) {
    }

    public function remember(string $key, int $ttl, callable $resolver, array $tags = []): mixed
    {
        $family = explode('.', $key)[1] ?? 'unknown';
        if (str_starts_with($family, 'uncached-')) return $resolver();
        $computed = false;
        $value = $this->cache->get($key, function (ItemInterface $item) use ($ttl, $resolver, $tags, $family, &$computed): mixed {
            $computed = true;
            $item->expiresAfter($ttl);
            $item->tag($tags !== [] ? $tags : ['community.'.$family]);
            return $this->performance->measure('community.'.$family.'.compute', $resolver);
        });
        return $this->performance->measure('community.'.$family.'.'.($computed ? 'miss' : 'hit'), fn () => $value);
    }

    public function invalidate(array $tags): void
    {
        if ($tags !== []) $this->cache->invalidateTags(array_values(array_unique($tags)));
    }
}
