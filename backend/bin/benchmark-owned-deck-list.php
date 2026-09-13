#!/usr/bin/env php
<?php

declare(strict_types=1);

use App\Application\Card\CardLocalizationService;
use App\Application\Deck\OwnedDeckListQuery;
use App\Domain\User\User;
use App\Infrastructure\Observability\RequestPerformanceContext;
use App\Tests\Integration\Support\OwnedDeckListFixture;
use App\UI\Http\DecksController;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\Request;

// Uses only the test database and temporary tables. Includes controller
// serialization/localization, excludes HTTP transport and authentication.
require dirname(__DIR__).'/tests/bootstrap.php';
$kernel = new App\Kernel('test', true);
$kernel->boot();
$container = $kernel->getContainer()->get('test.service_container');
$em = $container->get(EntityManagerInterface::class);
$metrics = $container->get(RequestPerformanceContext::class);
$options = getopt('', ['decks:', 'iterations:', 'output:']);
$count = max(100, min(10000, (int) ($options['decks'] ?? 1000)));
$iterations = max(5, min(200, (int) ($options['iterations'] ?? 30)));
$controller = $container->get(DecksController::class);
$user = new User('deck-volume@example.test', 'Deck volume benchmark');
(new ReflectionProperty(User::class, 'id'))->setValue($user, OwnedDeckListFixture::OWNER);
$query = $container->get(OwnedDeckListQuery::class);
$localization = $container->get(CardLocalizationService::class);
try {
    OwnedDeckListFixture::create($em, $count);
    $report = ['decks' => $count, 'deck_cards' => $count * 100, 'scope' => 'controller + SQL + localization + JSON; no auth/transport'];
    $explain = static function (?string $folder) use ($em): array {
        return json_decode($em->getConnection()->fetchOne('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT id, name, format, visibility, updated_at FROM deck WHERE owner_id = :owner'.
            ($folder === null ? '' : ' AND folder_id = :folder').' ORDER BY updated_at DESC, id DESC LIMIT 51',
            $folder === null ? ['owner' => OwnedDeckListFixture::OWNER] : ['owner' => OwnedDeckListFixture::OWNER, 'folder' => $folder]), true, 512, JSON_THROW_ON_ERROR)[0];
    };
    $report['plans_before'] = ['all' => $explain(null), 'folder' => $explain(OwnedDeckListFixture::FOLDER)];
    OwnedDeckListFixture::indexes($em);
    $report['plans_after'] = ['all' => $explain(null), 'folder' => $explain(OwnedDeckListFixture::FOLDER)];
    foreach ([1, 50, 100] as $limit) {
        $samples = [];
        for ($i = -1; $i < $iterations; ++$i) {
            $em->clear();
            $metrics->reset();
            $start = hrtime(true);
            $response = $controller->list(Request::create('/decks', parameters: ['limit' => $limit]), $user, $em, $localization, $query);
            $sample = $metrics->metrics() + ['duration_ms' => (hrtime(true) - $start) / 1e6,
                'payload_bytes' => strlen($response->getContent()), 'orm_entities' => $em->getUnitOfWork()->size()];
            if ($response->getStatusCode() !== 200) throw new RuntimeException('Benchmark request failed.');
            if ($i >= 0) $samples[] = $sample;
        }
        $durations = array_column($samples, 'duration_ms');
        sort($durations);
        $report['pages'][$limit] = ['p95_ms' => $durations[(int) ceil(count($durations) * .95) - 1],
            'max_queries' => max(array_column($samples, 'query_count')), 'max_sql_rows' => max(array_column($samples, 'rows')),
            'max_orm_entities' => max(array_column($samples, 'orm_entities')), 'payload_bytes' => max(array_column($samples, 'payload_bytes'))];
    }
    $json = json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
    if (isset($options['output'])) file_put_contents($options['output'], $json."\n");
    echo $json."\n";
} finally {
    OwnedDeckListFixture::drop($em);
    $kernel->shutdown();
}
