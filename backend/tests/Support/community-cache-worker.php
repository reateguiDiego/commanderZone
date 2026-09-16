<?php
require dirname(__DIR__, 2).'/vendor/autoload.php';
// CLI/Windows disables native locking by default. Enable the HTTP/Linux callback
// explicitly so this process test exercises the production lock implementation.
Symfony\Component\Cache\LockRegistry::setFiles([$argv[1].'/lock']);
$pool = new Symfony\Component\Cache\Adapter\TagAwareAdapter(new Symfony\Component\Cache\Adapter\FilesystemAdapter('concurrency', 60, $argv[1]));
$pool->setCallbackWrapper(Symfony\Component\Cache\LockRegistry::compute(...));
$cache = new App\Application\Community\CommunityCache(
    $pool,
    new App\Infrastructure\Observability\RequestPerformanceContext(),
);
echo $cache->remember('community.home.cold', 60, static function () use ($argv): string {
    file_put_contents($argv[1].'/computations.txt', "computed\n", FILE_APPEND | LOCK_EX);
    usleep(200000); // Deliberately overlap the independent processes' cold reads.
    return 'shared';
});
