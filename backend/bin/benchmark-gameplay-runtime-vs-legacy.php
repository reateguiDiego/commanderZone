#!/usr/bin/env php
<?php

declare(strict_types=1);

use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\GameActivityStreamService;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameDisconnectVoteService;
use App\Application\Game\GameplayStreamsFlags;
use App\Application\Game\GameProjectionService;
use App\Application\Game\Performance\GameplayBaselineFixture;
use App\Application\Game\Performance\GameplayBaselineFixtureFactory;
use App\Application\Game\Performance\GameplayMetricsInspector;
use App\Application\Game\Performance\GameplayMetricsStore;
use App\Application\Game\Runtime\GameRuntimeCommandClient;
use App\Application\Game\Runtime\GameplayRuntimeGateway;
use App\Application\Game\Runtime\GameplayRuntimePatchAdapter;
use App\Application\Game\Runtime\GameplayRuntimeRouter;
use App\Application\Game\Runtime\LegacyMulliganRuntimeStateMapper;
use App\Application\Game\WebSocket\GameWebsocketCommandPatchService;
use App\Application\Game\WebSocket\GameWebsocketMessageFactory;
use App\Application\Game\WebSocket\GameWebsocketPatchBuilder;
use App\Application\Game\WebSocket\GameWebsocketRoomRegistry;
use App\Domain\Game\Game;
use App\Domain\Room\RoomPlayer;
use Doctrine\Persistence\ManagerRegistry;
use Symfony\Component\Dotenv\Dotenv;
use Symfony\Component\HttpClient\HttpClient;

require dirname(__DIR__).'/vendor/autoload.php';

$_SERVER['APP_ENV'] = $_SERVER['APP_ENV'] ?? $_ENV['APP_ENV'] ?? getenv('APP_ENV') ?: 'test';
$_SERVER['APP_DEBUG'] = $_SERVER['APP_DEBUG'] ?? $_ENV['APP_DEBUG'] ?? '1';
if (class_exists(Dotenv::class)) {
    (new Dotenv())->bootEnv(dirname(__DIR__).'/.env', (string) $_SERVER['APP_ENV']);
}

/**
 * Comparative benchmark for the current legacy WebSocket command path versus the
 * optimized runtime/stream paths. This is intentionally a standalone script so
 * the normal PHPUnit suite does not depend on a live game-runtime process.
 */
final class GameplayRuntimeLegacyComparisonBenchmark
{
    public const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:8091';
    private const COMMANDS = [
        'life.changed',
        'turn.changed',
        'dice.rolled',
        'card.tapped',
        'card.counter.changed',
        'library.draw',
        'library.draw_many',
        'card.moved',
        'cards.moved',
        'token_create_1',
        'token_create_20',
        'chat.message',
    ];

    public function __construct(
        private readonly string $runtimeUrl,
        private readonly int $iterations,
        /** @var list<int> */
        private readonly array $chatCounts,
        private readonly string $outputDir,
        private readonly ManagerRegistry $registry,
    ) {
    }

    public function run(): int
    {
        $this->assertRuntimeReady();
        $rows = [];

        foreach ($this->chatCounts as $chatCount) {
            foreach (self::COMMANDS as $commandName) {
                $legacySamples = [];
                $optimizedSamples = [];
                for ($iteration = 1; $iteration <= $this->iterations; $iteration++) {
                    $legacySamples[] = $this->runOne($commandName, $chatCount, false, $iteration);
                    $optimizedSamples[] = $this->runOne($commandName, $chatCount, true, $iteration);
                }

                $rows[] = $this->summarize($commandName, $chatCount, $legacySamples, $optimizedSamples);
            }
        }

        $report = [
            'generatedAt' => (new DateTimeImmutable())->format(DATE_ATOM),
            'runtimeUrl' => $this->runtimeUrl,
            'iterations' => $this->iterations,
            'scenario' => [
                'players' => 4,
                'cardsPerPlayerFixture' => '60 library, 7 hand, 20 battlefield, 10 graveyard, 3 exile, 2 commanders',
                'battlefieldPerPlayer' => 20,
                'chatCounts' => $this->chatCounts,
                'tokenQuantities' => [1, 20],
            ],
            'rows' => $rows,
            'notes' => [
                'legacy' => 'GameWebsocketCommandPatchService legacy path: snapshot load, normalize/apply, mocked DB transaction/persist, projection and legacy patch builder.',
                'runtime' => 'GameWebsocketCommandPatchService runtime primary path over real HTTP GameRuntimeCommandClient, then Symfony patch.v2 fanout. chat.message uses optimized stream path, not Go runtime.',
                'database' => 'EntityManager is mocked in-process to isolate command hot path from external DB latency while preserving transaction/persist calls and metrics.',
            ],
        ];

        if (!is_dir($this->outputDir)) {
            mkdir($this->outputDir, 0777, true);
        }
        $jsonPath = $this->outputDir.'/gameplay-runtime-vs-legacy.json';
        $mdPath = $this->outputDir.'/gameplay-runtime-vs-legacy.md';
        file_put_contents($jsonPath, json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL);
        file_put_contents($mdPath, $this->markdown($report));

        echo sprintf("Wrote %s\n", $jsonPath);
        echo sprintf("Wrote %s\n", $mdPath);
        echo $this->consoleTable($rows, 50);

        return 0;
    }

    private function assertRuntimeReady(): void
    {
        $client = HttpClient::create();
        $response = $client->request('GET', rtrim($this->runtimeUrl, '/').'/readyz', ['timeout' => 3]);
        $status = $response->getStatusCode();
        $body = trim($response->getContent(false));
        if ($status !== 200 || $body !== 'ready') {
            throw new RuntimeException(sprintf('Runtime is not ready at %s/readyz: HTTP %d %s', rtrim($this->runtimeUrl, '/'), $status, $body));
        }
    }

    /**
     * @return array<string,mixed>
     */
    private function runOne(string $commandName, int $chatCount, bool $optimized, int $iteration): array
    {
        $fixture = (new GameplayBaselineFixtureFactory())->create(sprintf(
            'bench-%s-%d-%d-%s-%s',
            str_replace('.', '-', $commandName),
            $chatCount,
            $iteration,
            $optimized ? 'runtime' : 'legacy',
            bin2hex(random_bytes(4)),
        ));
        $this->replaceChatMessages($fixture, $chatCount);
        $this->persistFixture($fixture);
        $metrics = new GameplayMetricsStore();
        $metrics->configureOutput(null);
        $type = $this->actualCommandType($commandName);
        $payload = $this->payload($fixture, $commandName);
        $service = $this->service($fixture, $metrics, $optimized, $type);
        $baseVersion = max(1, (int) ($fixture->game()->snapshot()['version'] ?? 1));
        $result = $service->apply(
            $fixture->game()->id(),
            $fixture->user('p1')->id(),
            $type,
            $payload,
            sprintf('bench-%s-%s-%d-%s', str_replace('.', '-', $commandName), $optimized ? 'runtime' : 'legacy', $iteration, bin2hex(random_bytes(3))),
            $baseVersion,
            null,
            'v2',
        );

        $records = $metrics->records();
        $metric = $records[count($records) - 1] ?? [];

        return [
            'status' => $metric['status'] ?? 'missing_metric',
            'result_kind' => is_array($result) ? ($result['kind'] ?? 'array') : 'viewer_message_lists',
            'result_error_code' => $this->resultErrorCode($result, $fixture->user('p1')->id()),
            'result_error_message' => $this->resultErrorMessage($result, $fixture->user('p1')->id()),
            'total_server_ms' => $this->floatMetric($metric, 'total_server_ms'),
            'snapshot_bytes_before' => $this->intMetric($metric, 'snapshot_bytes_before'),
            'snapshot_bytes_after' => $this->intMetric($metric, 'snapshot_bytes_after'),
            'normalize_ms' => $this->floatMetric($metric, 'normalize_ms'),
            'projection_ms' => $this->floatMetric($metric, 'projection_ms'),
            'persist_ms' => $this->floatMetric($metric, 'persist_ms'),
            'patch_build_ms' => $this->floatMetric($metric, 'patch_build_ms'),
            'patch_bytes' => $this->intMetric($metric, 'patch_bytes'),
            'memory_peak_bytes' => $this->intMetric($metric, 'memory_peak_bytes'),
            'runtime_apply_ms' => $this->runtimeApplyMs($metric),
            'runtime_fallback_count' => $this->intMetric($metric, 'gameplay.runtime_fallback_count'),
            'runtime_error_count' => $this->intMetric($metric, 'gameplay.runtime_error_count'),
            'snapshot_write_count' => $this->snapshotWriteCount($metric, $optimized, $type),
            'chat_snapshot_write_count' => $this->intMetric($metric, 'chat.snapshot_write_count'),
        ];
    }

    private function service(GameplayBaselineFixture $fixture, GameplayMetricsStore $metrics, bool $optimized, string $type): GameWebsocketCommandPatchService
    {
        $handler = new GameCommandHandler(streamFlags: new GameplayStreamsFlags($optimized && $type === 'chat.message'));
        $messages = new GameWebsocketMessageFactory();
        $streamFlags = new GameplayStreamsFlags($optimized && $type === 'chat.message');
        $activityStreams = $optimized && $type === 'chat.message'
            ? new GameActivityStreamService($this->registry, $streamFlags)
            : null;
        $runtimeGateway = null;
        $flags = null;
        if ($optimized && $type !== 'chat.message') {
            $flags = new GameplayV2Flags(
                commandEnabled: false,
                patchEnabled: true,
                bootstrapEnabled: false,
                eventEnabled: false,
                visibilityEnabled: true,
                enabled: true,
                commandsAllowlist: $type,
                runtimeServiceEnabled: true,
                semanticPatchesEnabled: true,
                compactBootstrapEnabled: true,
                shadowCompareEnabled: false,
            );
            $runtimeClient = new GameRuntimeCommandClient(
                HttpClient::create(),
                new LegacyMulliganRuntimeStateMapper(),
                $this->runtimeUrl,
            );
            $runtimeGateway = new GameplayRuntimeGateway(
                new GameplayRuntimeRouter($flags, $runtimeClient),
                new GameplayRuntimePatchAdapter(),
            );
        }

        return new GameWebsocketCommandPatchService(
            $handler,
            new GameDisconnectVoteService($handler),
            new GameWebsocketPatchBuilder($messages),
            $messages,
            new GameWebsocketRoomRegistry(),
            $this->registry,
            new GameProjectionService($handler, streamFlags: $streamFlags, activityStreams: $activityStreams),
            null,
            $metrics,
            new GameplayMetricsInspector(),
            new GameplayV2ContractFactory(),
            $flags,
            null,
            $activityStreams,
            $streamFlags,
            $runtimeGateway,
        );
    }

    private function persistFixture(GameplayBaselineFixture $fixture): void
    {
        $manager = $this->registry->getManagerForClass(Game::class) ?? $this->registry->getManager();
        foreach (['p1', 'p2', 'p3', 'p4'] as $key) {
            $manager->persist($fixture->user($key));
        }
        $room = $fixture->game()->room();
        $manager->persist($room);
        foreach ($room->players() as $roomPlayer) {
            if ($roomPlayer instanceof RoomPlayer) {
                $manager->persist($roomPlayer);
            }
        }
        $manager->persist($fixture->game());
        $manager->flush();
        $manager->clear();
    }

    /**
     * @return array<string,mixed>
     */
    private function payload(GameplayBaselineFixture $fixture, string $commandName): array
    {
        $playerId = $fixture->playerId('p1');
        $p2 = $fixture->playerId('p2');
        $battlefield = $this->zoneInstanceIds($fixture, $playerId, 'battlefield');
        $hand = $this->zoneInstanceIds($fixture, $playerId, 'hand');

        return match ($commandName) {
            'life.changed' => ['playerId' => $playerId, 'delta' => -1],
            'turn.changed' => ['activePlayerId' => $p2, 'phase' => 'combat', 'number' => 9],
            'dice.rolled' => ['kind' => 'd20'],
            'card.tapped' => ['playerId' => $playerId, 'instanceId' => $battlefield[1] ?? $battlefield[0], 'tapped' => true],
            'card.counter.changed' => ['playerId' => $playerId, 'instanceId' => $battlefield[0], 'key' => '+1/+1', 'counter' => '+1/+1', 'value' => 3],
            'library.draw' => ['playerId' => $playerId],
            'library.draw_many' => ['playerId' => $playerId, 'count' => 7],
            'card.moved' => ['playerId' => $playerId, 'fromZone' => 'hand', 'toZone' => 'battlefield', 'instanceId' => $hand[0], 'position' => ['x' => 0.42, 'y' => 0.24, 'unit' => 'ratio']],
            'cards.moved' => ['playerId' => $playerId, 'fromZone' => 'hand', 'toZone' => 'graveyard', 'instanceIds' => array_slice($hand, 0, 7)],
            'token_create_1' => ['playerId' => $playerId, 'quantity' => 1],
            'token_create_20' => ['playerId' => $playerId, 'quantity' => 20],
            'chat.message' => ['message' => 'benchmark chat message'],
            default => throw new InvalidArgumentException(sprintf('Unsupported benchmark command "%s".', $commandName)),
        };
    }

    private function actualCommandType(string $commandName): string
    {
        return match ($commandName) {
            'token_create_1', 'token_create_20' => 'card.token.created',
            default => $commandName,
        };
    }

    /**
     * @return list<string>
     */
    private function zoneInstanceIds(GameplayBaselineFixture $fixture, string $playerId, string $zone): array
    {
        $cards = $fixture->game()->snapshot()['players'][$playerId]['zones'][$zone] ?? [];

        return array_values(array_map(
            static fn (array $card): string => (string) $card['instanceId'],
            array_values(array_filter($cards, static fn (mixed $card): bool => is_array($card) && is_string($card['instanceId'] ?? null))),
        ));
    }

    private function replaceChatMessages(GameplayBaselineFixture $fixture, int $count): void
    {
        $snapshot = $fixture->game()->snapshot();
        $users = [$fixture->user('p1'), $fixture->user('p2'), $fixture->user('p3'), $fixture->user('p4')];
        $snapshot['chat'] = [];
        for ($i = 1; $i <= $count; $i++) {
            $user = $users[($i - 1) % count($users)];
            $snapshot['chat'][] = [
                'id' => sprintf('bench-chat-%03d', $i),
                'userId' => $user->id(),
                'displayName' => $user->displayName(),
                'message' => sprintf('Benchmark chat backlog message %03d', $i),
                'createdAt' => sprintf('2026-01-01T00:%02d:%02d+00:00', intdiv($i, 60) % 60, $i % 60),
            ];
        }
        $fixture->game()->replaceSnapshot($snapshot);
    }

    /**
     * @param list<array<string,mixed>> $legacySamples
     * @param list<array<string,mixed>> $optimizedSamples
     *
     * @return array<string,mixed>
     */
    private function summarize(string $commandName, int $chatCount, array $legacySamples, array $optimizedSamples): array
    {
        $legacy = $this->averages($legacySamples);
        $optimized = $this->averages($optimizedSamples);
        $legacyTotal = max(0.0001, (float) $legacy['total_server_ms']);
        $optimizedTotal = max(0.0001, (float) $optimized['total_server_ms']);
        $legacyPatch = max(1, (int) $legacy['patch_bytes']);
        $optimizedPatch = max(0, (int) $optimized['patch_bytes']);

        return [
            'command' => $commandName,
            'chat_messages' => $chatCount,
            'legacy' => $legacy,
            'runtime_or_stream' => $optimized,
            'speedup' => round($legacyTotal / $optimizedTotal, 2),
            'snapshot_write_bytes_reduction' => (int) $legacy['snapshot_bytes_after'] - ((int) $optimized['snapshot_write_count'] > 0 ? (int) $optimized['snapshot_bytes_after'] : 0),
            'patch_bytes_reduction_pct' => round((($legacyPatch - $optimizedPatch) / $legacyPatch) * 100, 1),
            'runtime_wins' => $optimizedTotal < $legacyTotal && ((int) $optimized['runtime_fallback_count']) === 0 && ((int) $optimized['runtime_error_count']) === 0,
            'legacy_statuses' => array_values(array_unique(array_map(static fn (array $sample): string => (string) ($sample['status'] ?? ''), $legacySamples))),
            'runtime_statuses' => array_values(array_unique(array_map(static fn (array $sample): string => (string) ($sample['status'] ?? ''), $optimizedSamples))),
        ];
    }

    /**
     * @param list<array<string,mixed>> $samples
     *
     * @return array<string,float|int|string>
     */
    private function averages(array $samples): array
    {
        $fields = [
            'total_server_ms',
            'snapshot_bytes_before',
            'snapshot_bytes_after',
            'normalize_ms',
            'projection_ms',
            'persist_ms',
            'patch_build_ms',
            'patch_bytes',
            'memory_peak_bytes',
            'runtime_apply_ms',
            'runtime_fallback_count',
            'runtime_error_count',
            'snapshot_write_count',
            'chat_snapshot_write_count',
        ];
        $out = [];
        foreach ($fields as $field) {
            $values = array_map(static fn (array $sample): float => (float) ($sample[$field] ?? 0), $samples);
            $avg = array_sum($values) / max(1, count($values));
            $out[$field] = str_ends_with($field, '_bytes') || str_ends_with($field, '_count')
                ? (int) round($avg)
                : round($avg, 3);
        }
        $out['status'] = implode(',', array_values(array_unique(array_map(static fn (array $sample): string => (string) ($sample['status'] ?? ''), $samples))));
        $errors = array_values(array_unique(array_filter(array_map(
            static fn (array $sample): string => trim((string) (($sample['result_error_code'] ?? '').' '.($sample['result_error_message'] ?? ''))),
            $samples,
        ))));
        $out['error'] = implode(' | ', $errors);

        return $out;
    }

    /**
     * @param array<string,mixed> $metric
     */
    private function runtimeApplyMs(array $metric): float
    {
        foreach (['runtime.apply_ms', 'apply_ms', 'library.draw_ms', 'library.draw_many_ms', 'movement.apply_ms', 'battlefield.apply_ms', 'counters.apply_ms', 'simple.apply_ms', 'edge.token_create_ms'] as $key) {
            if (isset($metric[$key]) && (is_int($metric[$key]) || is_float($metric[$key]))) {
                return (float) $metric[$key];
            }
        }

        return $this->floatMetric($metric, 'command_apply_ms');
    }

    /**
     * @param array<string,mixed> $metric
     */
    private function snapshotWriteCount(array $metric, bool $optimized, string $type): int
    {
        if ($type === 'chat.message') {
            return $this->intMetric($metric, 'chat.snapshot_write_count');
        }
        if ($optimized && ($metric['status'] ?? null) === 'runtime_applied') {
            return 0;
        }

        return ($metric['status'] ?? null) === 'applied' ? 1 : 0;
    }

    private function resultErrorCode(mixed $result, string $viewerId): ?string
    {
        $message = $this->firstResultMessage($result, $viewerId);
        $code = $message['error']['code'] ?? null;

        return is_string($code) ? $code : null;
    }

    private function resultErrorMessage(mixed $result, string $viewerId): ?string
    {
        $message = $this->firstResultMessage($result, $viewerId);
        $error = $message['error']['message'] ?? $message['reason'] ?? null;

        return is_string($error) ? $error : null;
    }

    /**
     * @return array<string,mixed>
     */
    private function firstResultMessage(mixed $result, string $viewerId): array
    {
        if (is_array($result)) {
            return $result;
        }
        if ($result instanceof \App\Application\Game\WebSocket\GameWebsocketCommandResult) {
            return $result->messagesForUserId($viewerId)[0] ?? [];
        }

        return [];
    }

    /**
     * @param array<string,mixed> $metric
     */
    private function floatMetric(array $metric, string $key): float
    {
        return is_int($metric[$key] ?? null) || is_float($metric[$key] ?? null) ? round((float) $metric[$key], 3) : 0.0;
    }

    /**
     * @param array<string,mixed> $metric
     */
    private function intMetric(array $metric, string $key): int
    {
        return is_int($metric[$key] ?? null) || is_float($metric[$key] ?? null) ? (int) round((float) $metric[$key]) : 0;
    }

    /**
     * @param array<string,mixed> $report
     */
    private function markdown(array $report): string
    {
        $lines = [
            '# Gameplay Runtime vs Legacy Benchmark',
            '',
            sprintf('- Generated: `%s`', $report['generatedAt']),
            sprintf('- Runtime URL: `%s`', $report['runtimeUrl']),
            sprintf('- Iterations: `%d`', $report['iterations']),
            sprintf('- Scenario: `%s`', $report['scenario']['cardsPerPlayerFixture']),
            '',
        ];

        foreach ($this->chatCounts as $chatCount) {
            $lines[] = sprintf('## Chat Backlog: %d Messages', $chatCount);
            $lines[] = '| Command | Legacy ms | Runtime/stream ms | Speedup | Legacy snapshot bytes | Runtime snapshot writes | Legacy patch bytes | Runtime patch bytes | Runtime status |';
            $lines[] = '|---|---:|---:|---:|---:|---:|---:|---:|---|';
            foreach ($report['rows'] as $row) {
                if (($row['chat_messages'] ?? null) !== $chatCount) {
                    continue;
                }
                $lines[] = sprintf(
                    '| `%s` | %.3f | %.3f | %.2fx | %d | %d | %d | %d | `%s` |',
                    $row['command'],
                    $row['legacy']['total_server_ms'],
                    $row['runtime_or_stream']['total_server_ms'],
                    $row['speedup'],
                    $row['legacy']['snapshot_bytes_after'],
                    $row['runtime_or_stream']['snapshot_write_count'],
                    $row['legacy']['patch_bytes'],
                    $row['runtime_or_stream']['patch_bytes'],
                    $row['runtime_or_stream']['status'],
                );
            }
            $lines[] = '';
        }

        $notClearWins = array_values(array_filter(
            $report['rows'],
            static fn (array $row): bool => ($row['runtime_wins'] ?? false) !== true,
        ));
        $lines[] = '## Runtime/Stream Not Clear Wins';
        if ($notClearWins === []) {
            $lines[] = '- None in this run.';
        } else {
            foreach ($notClearWins as $row) {
                $lines[] = sprintf(
                    '- `%s` with %d chat messages: speedup %.2fx, runtime status `%s`.',
                    $row['command'],
                    $row['chat_messages'],
                    $row['speedup'],
                    $row['runtime_or_stream']['status'],
                );
            }
        }
        $lines[] = '';
        $lines[] = '## Notes';
        foreach ($report['notes'] as $key => $note) {
            $lines[] = sprintf('- `%s`: %s', $key, $note);
        }

        return implode(PHP_EOL, $lines).PHP_EOL;
    }

    /**
     * @param list<array<string,mixed>> $rows
     */
    private function consoleTable(array $rows, int $chatCount): string
    {
        $out = "\nSummary for chat backlog ".$chatCount.":\n";
        $out .= str_pad('command', 28).str_pad('legacy_ms', 12).str_pad('runtime_ms', 12).str_pad('speedup', 10).str_pad('legacy_patch', 14).str_pad('runtime_patch', 14)."status\n";
        foreach ($rows as $row) {
            if (($row['chat_messages'] ?? null) !== $chatCount) {
                continue;
            }
            $out .= str_pad((string) $row['command'], 28)
                .str_pad((string) $row['legacy']['total_server_ms'], 12)
                .str_pad((string) $row['runtime_or_stream']['total_server_ms'], 12)
                .str_pad((string) $row['speedup'], 10)
                .str_pad((string) $row['legacy']['patch_bytes'], 14)
                .str_pad((string) $row['runtime_or_stream']['patch_bytes'], 14)
                .(string) $row['runtime_or_stream']['status']
                ."\n";
        }

        return $out;
    }
}

/**
 * @return array{runtimeUrl:string,iterations:int,chatCounts:list<int>,outputDir:string}
 */
function parseBenchmarkArgs(array $argv): array
{
    $options = [
        'runtimeUrl' => getenv('GAME_RUNTIME_INTERNAL_URL') ?: GameplayRuntimeLegacyComparisonBenchmark::DEFAULT_RUNTIME_URL,
        'iterations' => 3,
        'chatCounts' => [0, 50, 200],
        'outputDir' => __DIR__.'/../var/performance',
    ];
    foreach (array_slice($argv, 1) as $arg) {
        if (str_starts_with($arg, '--runtime-url=')) {
            $options['runtimeUrl'] = substr($arg, strlen('--runtime-url='));
        } elseif (str_starts_with($arg, '--iterations=')) {
            $options['iterations'] = max(1, (int) substr($arg, strlen('--iterations=')));
        } elseif (str_starts_with($arg, '--chat-counts=')) {
            $options['chatCounts'] = array_values(array_filter(
                array_map(static fn (string $value): int => max(0, (int) trim($value)), explode(',', substr($arg, strlen('--chat-counts=')))),
                static fn (int $value): bool => $value >= 0,
            ));
        } elseif (str_starts_with($arg, '--output-dir=')) {
            $options['outputDir'] = substr($arg, strlen('--output-dir='));
        }
    }

    return $options;
}

try {
    $args = parseBenchmarkArgs($argv);
    $_SERVER['APP_ENV'] = $_SERVER['APP_ENV'] ?? getenv('APP_ENV') ?: 'test';
    $_SERVER['APP_DEBUG'] = $_SERVER['APP_DEBUG'] ?? '1';
    $kernel = new App\Kernel((string) $_SERVER['APP_ENV'], (bool) $_SERVER['APP_DEBUG']);
    $kernel->boot();
    $container = $kernel->getContainer();
    if ($container->has('test.service_container')) {
        $container = $container->get('test.service_container');
    }
    /** @var ManagerRegistry $registry */
    $registry = $container->get(ManagerRegistry::class);
    $benchmark = new GameplayRuntimeLegacyComparisonBenchmark(
        rtrim($args['runtimeUrl'], '/'),
        $args['iterations'],
        $args['chatCounts'],
        $args['outputDir'],
        $registry,
    );
    exit($benchmark->run());
} catch (Throwable $exception) {
    fwrite(STDERR, $exception::class.': '.$exception->getMessage().PHP_EOL);
    exit(1);
}
