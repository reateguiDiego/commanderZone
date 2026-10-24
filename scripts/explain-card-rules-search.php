<?php

declare(strict_types=1);

// php /tmp/explain-card-rules-search.php /app aterrizaje|landfall
// Diagnostic only: no authentication, HTTP traffic or result-cache population.
use App\Application\Card\CardSearchFilterBuilder;
use App\Application\Card\CardSearchSelection;
use App\Kernel;
use App\UI\Http\CardsController;
use Doctrine\DBAL\DriverManager;
use Doctrine\DBAL\Logging\Middleware;
use Doctrine\ORM\EntityManager;
use Psr\Log\AbstractLogger;
use Symfony\Component\Dotenv\Dotenv;
use Symfony\Component\HttpFoundation\Request;

$backend = $argv[1] ?? dirname(__DIR__).'/backend';
$term = $argv[2] ?? 'aterrizaje';
if (!in_array($term, ['aterrizaje', 'landfall'], true)) {
    fwrite(STDERR, "Expected aterrizaje or landfall.\n");
    exit(1);
}
require $backend.'/vendor/autoload.php';
(new Dotenv())->bootEnv($backend.'/.env');
$kernel = new Kernel($_SERVER['APP_ENV'] ?? 'prod', false);
$connection = null;
$exitCode = 0;
try {
    $kernel->boot();
    $original = $kernel->getContainer()->get('doctrine')->getManager();
    $logger = new class extends AbstractLogger {
        public bool $capture = false;
        public array $queries = [];
        public function log($level, string|Stringable $message, array $context = []): void
        {
            $sql = $context['sql'] ?? '';
            if ($this->capture && preg_match('/^\s*SELECT\b/i', $sql)
                && preg_match('/\b(?:FROM|JOIN)\s+(?:public\.)?card(?:_search_entry|_print_locale|_print)?\b/i', $sql)) {
                // Driver middleware sees expanded positional parameters, not array bindings.
                $this->queries[] = ['sql' => $sql, 'params' => array_values($context['params'] ?? []), 'types' => array_values($context['types'] ?? [])];
            }
        }
    };
    $config = clone $original->getConnection()->getConfiguration();
    $config->setMiddlewares([new Middleware($logger)]);
    $params = $original->getConnection()->getParams();
    $params['persistent'] = false;
    $connection = DriverManager::getConnection($params, $config);
    $manager = new EntityManager($connection, $original->getConfiguration());
    $connection->beginTransaction();
    $connection->executeStatement('SET TRANSACTION READ ONLY');
    $connection->executeStatement("SET LOCAL statement_timeout = '30s'");
    $connection->executeStatement("SET LOCAL lock_timeout = '1s'");
    $connection->executeStatement('SET LOCAL jit = off');
    $request = Request::create('/cards/search', 'GET', [
        'q' => '', 'page' => 1, 'limit' => 20, 'lang' => 'es', 'sort' => 'name_asc',
        'oracleTextA' => $term, 'oracleTextMode' => 'and',
    ]);
    $builder = new CardSearchFilterBuilder();
    $filters = $builder->build($request);
    $entryFilters = $builder->build($request, false, false);
    $controller = new CardsController();
    $logger->capture = true;
    $started = hrtime(true);
    $result = (new CardSearchSelection($connection))->run(fn () =>
        (new ReflectionMethod(CardsController::class, 'resolveSearchPage'))->invoke(
            $controller, $manager, 'es', '', 1, 20, 21, 'name_asc', $filters, $entryFilters, $request,
        ));
    $selectionMs = (hrtime(true) - $started) / 1e6;
    $logger->capture = false;
    if ($logger->queries === []) throw new RuntimeException('No selection SQL captured; do not infer a plan.');
    $plans = [];
    foreach ($logger->queries as $query) {
        $plan = $connection->fetchOne('EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON) '.$query['sql'], $query['params'], $query['types']);
        $plans[] = ['sql' => $query['sql'], 'params' => $query['params'], 'plan' => json_decode($plan, true, 512, JSON_THROW_ON_ERROR)];
    }
    echo json_encode([
        'capturedAt' => gmdate('c'), 'term' => $term, 'request' => $request->query->all(),
        'cacheBypassed' => true, 'selectionMs' => $selectionMs, 'total' => $result['total'], 'returnedIds' => count($result['ids']),
        'note' => 'The real selection runs once; EXPLAIN ANALYZE repeats its captured reads with warmed buffers. Each statement is limited to 30s. Transaction rolls back.',
        'serverVersion' => $connection->fetchOne('SHOW server_version'),
        'settings' => $connection->fetchAllAssociative("SELECT name, setting, unit FROM pg_settings WHERE name IN ('jit', 'work_mem', 'random_page_cost', 'effective_cache_size', 'statement_timeout', 'lock_timeout') ORDER BY name"),
        'tables' => $connection->fetchAllAssociative("SELECT s.relname, s.n_live_tup, s.n_dead_tup, s.last_analyze, s.last_autoanalyze, c.relpages, c.relallvisible FROM pg_stat_user_tables s JOIN pg_class c ON c.oid=s.relid WHERE s.schemaname='public' AND s.relname IN ('card','card_print_locale','card_search_entry')"),
        'indexes' => $connection->fetchAllAssociative("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('card','card_print_locale','card_search_entry')"),
        'plans' => $plans,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR).PHP_EOL;
} catch (Throwable $error) {
    fwrite(STDERR, 'Diagnostic failed: '.$error->getMessage().PHP_EOL);
    $exitCode = 1;
} finally {
    if ($connection?->isTransactionActive()) $connection->rollBack();
    $connection?->close();
    $kernel->shutdown();
}
exit($exitCode);
