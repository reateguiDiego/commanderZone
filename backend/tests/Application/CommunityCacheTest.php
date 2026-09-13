<?php

namespace App\Tests\Application;

use App\Application\Community\CommunityCache;
use App\Infrastructure\Observability\RequestPerformanceContext;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Component\Cache\Adapter\TagAwareAdapter;

final class CommunityCacheTest extends TestCase
{
    public function testIndependentProcessesShareOneColdCalculation(): void
    {
        $directory = dirname(__DIR__, 2).'/var/community-cache-test-'.bin2hex(random_bytes(8));
        mkdir($directory, 0700, true);
        touch($directory.'/lock');
        $children = [];
        try {
            for ($i = 0; $i < 4; ++$i) {
                $pipes = [];
                $process = proc_open([PHP_BINARY, __DIR__.'/../Support/community-cache-worker.php', $directory], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
                self::assertIsResource($process);
                fclose($pipes[0]);
                $children[] = [$process, $pipes];
            }
            foreach ($children as [$process, $pipes]) {
                $output = stream_get_contents($pipes[1]);
                $error = stream_get_contents($pipes[2]);
                fclose($pipes[1]); fclose($pipes[2]);
                self::assertSame(0, proc_close($process), $error);
                self::assertSame('shared', $output);
            }
            self::assertSame("computed\n", file_get_contents($directory.'/computations.txt'));
        } finally {
            (new \Symfony\Component\Filesystem\Filesystem())->remove($directory);
        }
    }

    public function testHitsExpiryAndOwnerScopedInvalidation(): void
    {
        $cache = new CommunityCache(new TagAwareAdapter(new ArrayAdapter()), new RequestPerformanceContext());
        $calls = 0;
        $compute = function () use (&$calls): array { return ['revision' => ++$calls]; };
        self::assertSame(['revision' => 1], $cache->remember('community.user.a', 60, $compute, ['community.user.a']));
        self::assertSame(['revision' => 2], $cache->remember('community.user.b', 60, $compute, ['community.user.b']));
        $cache->invalidate(['community.user.a']);
        self::assertSame(['revision' => 3], $cache->remember('community.user.a', 60, $compute, ['community.user.a']));
        self::assertSame(['revision' => 2], $cache->remember('community.user.b', 60, $compute, ['community.user.b']));
        $cache->remember('community.home.expired', -1, $compute);
        self::assertSame(['revision' => 5], $cache->remember('community.home.expired', 60, $compute));
    }

    public function testUncacheableQueriesAndFailuresAreNotStored(): void
    {
        $cache = new CommunityCache(new TagAwareAdapter(new ArrayAdapter()), new RequestPerformanceContext());
        $calls = 0;
        $compute = function () use (&$calls): int { return ++$calls; };
        self::assertSame(1, $cache->remember('community.uncached-decks.query', 60, $compute));
        self::assertSame(2, $cache->remember('community.uncached-decks.query', 60, $compute));
        try { $cache->remember('community.home.failed', 60, fn () => throw new \RuntimeException('failed')); }
        catch (\RuntimeException $error) { self::assertSame('failed', $error->getMessage()); }
        self::assertSame(3, $cache->remember('community.home.failed', 60, $compute));
    }
}
