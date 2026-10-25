<?php

declare(strict_types=1);

// Admin CLI diagnostic: reproduce only the selected deck's detail pipeline.
// No HTTP authentication, response payload export, cache writes or flush.
use App\Application\Card\CardLocalizationService;
use App\Application\Card\CardLocalizedPayloadResolver;
use App\Domain\Deck\Deck;
use App\Domain\User\User;
use App\Kernel;
use App\UI\Http\DecksController;
use Doctrine\DBAL\DriverManager;
use Doctrine\DBAL\Logging\Middleware;
use Doctrine\ORM\EntityManager;
use Psr\Log\AbstractLogger;
use Symfony\Component\Dotenv\Dotenv;

$backend = $argv[1] ?? dirname(__DIR__).'/backend';
$slug = $argv[2] ?? '';
if (!preg_match('/^[a-z0-9][a-z0-9-]{0,219}$/D', $slug)) {
    fwrite(STDERR, "Expected a deck slug.\n");
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
        public ?string $stage = null;
        public array $queries = [];
        public function log($level, string|Stringable $message, array $context = []): void
        {
            $sql = $context['sql'] ?? '';
            if ($this->stage !== null && preg_match('/^\s*SELECT\b/i', $sql)) {
                $this->queries[] = ['stage' => $this->stage, 'sql' => $sql,
                    'params' => array_values($context['params'] ?? []),
                    'types' => array_values($context['types'] ?? [])];
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
    // Keep deployed JIT/planner settings: the deck endpoint does not disable JIT.
    $owners = $connection->fetchFirstColumn('SELECT owner_id FROM deck WHERE slug = ?', [$slug]);
    if (count($owners) !== 1) throw new RuntimeException('Deck missing or slug ambiguous.');
    $user = $manager->find(User::class, $owners[0]);
    if (!$user instanceof User) throw new RuntimeException('Deck owner missing.');
    $controller = new DecksController();
    $localization = new CardLocalizationService($manager, new CardLocalizedPayloadResolver($connection));
    $stages = [];
    $measure = static function (string $name, callable $action) use ($logger, &$stages): mixed {
        $logger->stage = $name;
        $before = count($logger->queries);
        $start = hrtime(true);
        try { return $action(); }
        finally {
            $stages[$name] = ['durationMs' => (hrtime(true) - $start) / 1e6, 'queries' => count($logger->queries) - $before];
            $logger->stage = null;
        }
    };
    $deck = $measure('deck.load', fn () => (new ReflectionMethod(DecksController::class, 'ownedDeckBySlug'))->invoke($controller, $slug, $user, $manager));
    if (!$deck instanceof Deck) throw new RuntimeException('Deck lookup failed.');
    $measure('deck.preload', fn () => (new ReflectionMethod(DecksController::class, 'preloadDeckCards'))->invoke($controller, $deck, $manager));
    $payload = $measure('deck.serialize', fn () => $deck->toArray(true));
    $payload = $measure('deck.localize', fn () => (new ReflectionMethod(DecksController::class, 'localizeDeckPayload'))->invoke($controller, $payload, $user, $localization));
    if ($logger->queries === []) throw new RuntimeException('No SQL captured.');
    $plans = [];
    foreach ($logger->queries as $number => $query) {
        $raw = $connection->fetchOne('EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON) '.$query['sql'], $query['params'], $query['types']);
        $plan = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        $plans[] = ['number' => $number + 1, 'stage' => $query['stage'], 'fingerprint' => hash('sha256', trim((string) preg_replace('/\s+/', ' ', $query['sql']))), 'sql' => $query['sql'],
            'params' => $query['params'], 'executionMs' => $plan[0]['Execution Time'], 'plan' => $plan];
    }
    echo json_encode([
        'capturedAt' => gmdate('c'), 'slug' => $slug, 'cardLanguage' => $user->cardLanguage(),
        'cardLines' => count($payload['cards'] ?? []), 'stages' => $stages,
        'note' => 'Admin read-only detail pipeline, not a full HTTP request. Owner loaded before capture. EXPLAIN repeats reads with warmed buffers; timings are not original per-query times. No deck contents or user record exported.',
        'settings' => $connection->fetchAllAssociative("SELECT name, setting, unit FROM pg_settings WHERE name IN ('jit','work_mem','random_page_cost','effective_cache_size','statement_timeout','lock_timeout') ORDER BY name"),
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
