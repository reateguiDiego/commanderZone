<?php

// Read-only diagnostic: php scripts/explain-card-search.php /path/to/backend [on|off]
// Uses the deployed SQL builders directly; bypasses the result cache on purpose.
use App\Application\Card\CardSearchFilterBuilder;
use App\Domain\Card\Card;
use App\Kernel;
use App\UI\Http\CardsController;
use Symfony\Component\Dotenv\Dotenv;
use Symfony\Component\HttpFoundation\Request;

$backend = $argv[1] ?? dirname(__DIR__).'/backend';
require $backend.'/vendor/autoload.php';
(new Dotenv())->bootEnv($backend.'/.env');
$kernel = new Kernel($_SERVER['APP_ENV'] ?? 'prod', false);
$connection = null;
$exitCode = 0;

try {
    $kernel->boot();
    $manager = $kernel->getContainer()->get('doctrine')->getManager();
    $connection = $manager->getConnection();
    $connection->beginTransaction();
    $connection->executeStatement('SET TRANSACTION READ ONLY');
    // CZ_JIT_AB: optional setting, limited to this diagnostic transaction.
    $jitMode = $argv[2] ?? null;
    if ($jitMode !== null) {
        if (!in_array($jitMode, ['on', 'off'], true)) {
            throw new InvalidArgumentException('JIT mode must be on or off.');
        }
        $connection->executeStatement('SET LOCAL jit = '.$jitMode);
    }
    $connection->executeStatement("SET LOCAL statement_timeout = '10s'");
    $connection->executeStatement("SET LOCAL lock_timeout = '1s'");

    $result = [
        'capturedAt' => gmdate('c'),
        'serverVersion' => $connection->fetchOne('SHOW server_version'),
        'cacheBypassed' => true,
        'settings' => $connection->fetchAllAssociative("SELECT name, setting, unit FROM pg_settings WHERE name IN ('work_mem', 'shared_buffers', 'effective_cache_size', 'random_page_cost', 'jit', 'max_parallel_workers_per_gather', 'track_io_timing') ORDER BY name"),
        'tables' => $connection->fetchAllAssociative("SELECT s.relname, s.n_live_tup, s.n_dead_tup, s.last_analyze, s.last_autoanalyze, s.last_vacuum, s.last_autovacuum, c.relpages, c.reltuples, c.relallvisible FROM pg_stat_user_tables s JOIN pg_class c ON c.oid = s.relid WHERE s.schemaname = 'public' AND s.relname IN ('card', 'card_print', 'card_print_locale') ORDER BY s.relname"),
        'indexes' => $connection->fetchAllAssociative("SELECT t.relname AS table_name, i.indexrelid::regclass::text AS name, i.indisvalid, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND t.relname IN ('card', 'card_print', 'card_print_locale') ORDER BY t.relname, name"),
        'cases' => [],
    ];
    $invoke = static function (CardsController $controller, string $method, mixed ...$args): mixed {
        return (new ReflectionMethod(CardsController::class, $method))->invoke($controller, ...$args);
    };
    foreach ([
        'prefix' => '/cards/search?q=sol&lang=en&limit=25',
        'filtered_page' => '/cards/search?q=dragon&commanderLegal=true&lang=en&limit=25&page=2',
    ] as $name => $uri) {
        $controller = new CardsController();
        $request = Request::create($uri);
        $filters = (new CardSearchFilterBuilder())->build($request);
        $patterns = $invoke($controller, 'searchPatterns', Card::normalizeName($request->query->get('q')));
        $case = ['uri' => $uri, 'buckets' => []];
        foreach ($invoke($controller, 'searchBuckets', 'en') as $bucket) {
            $args = [$manager, $bucket, 'en', $filters->filters, $filters->params, $filters->types, $patterns];
            [$sql, $params, $types] = $invoke($controller, 'buildBucketedSearchSql', ...[...$args, 26, 25, (int) $request->query->get('page', 1), 'relevance']);
            // Preserve bucket fallback and record that this read warms the measured query.
            $rows = $connection->fetchAllAssociative($sql, $params, $types);
            $total = (int) $rows[0]['total_count'];
            $queries = ['selection' => [$sql, $params, $types]];
            $entry = ['bucket' => $bucket, 'total' => $total, 'plans' => []];
            foreach ($queries as $kind => [$sql, $params, $types]) {
                $plan = $connection->fetchOne('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '.$sql, $params, $types);
                $entry['plans'][$kind] = [
                    'sql' => $sql,
                    'params' => $params,
                    'plan' => json_decode($plan, true, 512, JSON_THROW_ON_ERROR),
                ];
            }
            $case['buckets'][] = $entry;
            if ($total > 0) {
                break;
            }
        }
        $result['cases'][$name] = $case;
    }
    echo json_encode($result, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES).PHP_EOL;
} catch (Throwable $error) {
    fwrite(STDERR, 'Diagnostic failed: '.$error->getMessage().PHP_EOL);
    $exitCode = 1;
} finally {
    if ($connection !== null && $connection->isTransactionActive()) {
        $connection->rollBack();
    }
    $kernel->shutdown();
}
exit($exitCode);
